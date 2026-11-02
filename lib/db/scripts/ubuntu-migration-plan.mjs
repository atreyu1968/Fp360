import { createHash } from "node:crypto";
import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hashPattern = /^[a-f0-9]{64}$/;

export async function schemaSourceHash(dbDir) {
  const files = ["drizzle.config.ts"];
  async function walk(relative) {
    for (const entry of (await readdir(path.join(dbDir, relative), { withFileTypes: true }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error("No se admiten enlaces en el esquema.");
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) files.push(name);
    }
  }
  await walk("src/schema");
  const entries = [];
  for (const file of files.sort()) {
    entries.push([file, sha256(await readFile(path.join(dbDir, file)))]);
  }
  return sha256(JSON.stringify(entries));
}

// Conservative release policy, not a sandbox for untrusted SQL. Migration files
// are trusted, reviewed source code. Extended-query execution also prevents a
// second statement (including COMMIT) from escaping the enclosing transaction.
export function assertExpandStatement(statement) {
  if (typeof statement !== "string" || !statement.trim()) {
    throw new Error("La migración contiene una sentencia vacía.");
  }
  const tokens = statement.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:\"\"|[^"])*"|[A-Za-z_][A-Za-z0-9_]*|[^\s]/g) ?? [];
  const words = tokens.filter((token) => !token.startsWith("--") && !token.startsWith("/*"))
    .map((token) => token.startsWith("'") ? "LITERAL" : token.startsWith('"') ? "IDENT" : token.toUpperCase());
  const normalized = words.join(" ");
  const create = /^CREATE (TABLE|INDEX|TYPE) /.test(normalized);
  const addColumn = /^ALTER TABLE (?:ONLY )?[A-Z_][A-Z0-9_]*(?: \. [A-Z_][A-Z0-9_]*)? ADD COLUMN /.test(normalized);
  if (!create && !addColumn) {
    throw new Error("Solo se automatizan tablas, índices o tipos nuevos y columnas añadidas.");
  }
  const forbidden = new Set([
    "DROP", "TRUNCATE", "DELETE", "UPDATE", "INSERT", "MERGE", "SELECT",
    "COMMIT", "ROLLBACK", "BEGIN", "END", "SAVEPOINT", "PREPARE",
    "DO", "CALL", "EXECUTE", "GRANT", "REVOKE", "RENAME", "SET", "RESET",
    "OWNER", "ATTACH", "DETACH", "CONCURRENTLY",
  ]);
  if (words.some((word) => forbidden.has(word)) || words.slice(1).includes("ALTER")
    || words.filter((word) => word === "CREATE").length > (create ? 1 : 0)
    || words.filter((word) => word === ";").length > 1
    || (words.includes(";") && words.at(-1) !== ";")
    || (addColumn && /\bNOT NULL\b/.test(normalized))) {
    throw new Error("La sentencia necesita un procedimiento manual: no es una ampliación compatible.");
  }
  if (addColumn) {
    let depth = 0;
    for (const word of words) {
      if (word === "(") depth++;
      if (word === ")") depth--;
      if ((word === "," && depth === 0) || ["CHECK", "REFERENCES", "UNIQUE", "PRIMARY", "DEFAULT"].includes(word)) {
        throw new Error("Una columna automática debe ser opcional, sin defaults ni restricciones sobre datos existentes.");
      }
    }
  }
}

export async function loadPlan(dbDir, installedDbDir = dbDir) {
  const directory = path.join(dbDir, "migrations");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  if (manifest.format !== 1 || !Array.isArray(manifest.states) || !manifest.states.length
    || !Array.isArray(manifest.migrations) || manifest.migrations.length !== manifest.states.length - 1) {
    throw new Error("El manifiesto de migraciones no es válido.");
  }
  const usedFiles = new Set();
  async function verifiedFile(name, hash) {
    if (typeof name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)
      || !hashPattern.test(hash) || usedFiles.has(name)) {
      throw new Error("Ruta o checksum de migración inválidos o repetidos.");
    }
    usedFiles.add(name);
    const file = path.join(directory, name);
    if (!(await lstat(file)).isFile()) throw new Error("Las migraciones deben ser archivos normales.");
    const content = await readFile(file, "utf8");
    if (sha256(content) !== hash) throw new Error(`Checksum incorrecto: ${name}.`);
    return content;
  }
  const hashes = new Set();
  const states = [];
  for (const state of manifest.states) {
    if (!hashPattern.test(state.schemaHash) || hashes.has(state.schemaHash)) {
      throw new Error("Hash de esquema inválido o repetido.");
    }
    hashes.add(state.schemaHash);
    states.push({ ...state, sql: await verifiedFile(state.snapshot, state.sha256) });
  }
  const migrations = [];
  const ids = new Set();
  for (const migration of manifest.migrations) {
    if (!/^[0-9]{4}_[a-z0-9_]+$/.test(migration.id) || ids.has(migration.id)
      || migration.backwardsCompatible !== true) {
      throw new Error("La migración no tiene identidad única o aprobación de compatibilidad.");
    }
    ids.add(migration.id);
    const statements = JSON.parse(await verifiedFile(migration.file, migration.sha256));
    if (!Array.isArray(statements)) throw new Error("Falta la lista de sentencias de migración.");
    statements.forEach(assertExpandStatement);
    migrations.push({ ...migration, statements });
  }
  const targetHash = await schemaSourceHash(dbDir);
  const installedHash = await schemaSourceHash(installedDbDir);
  if (states.at(-1).schemaHash !== targetHash) {
    throw new Error("El esquema destino cambió sin actualizar su manifiesto y snapshot.");
  }
  const installedIndex = states.findIndex((state) => state.schemaHash === installedHash);
  if (installedIndex < 0) throw new Error("La versión instalada no pertenece a este historial de migraciones.");
  return { states, migrations, installedIndex };
}

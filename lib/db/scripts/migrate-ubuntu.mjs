import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadPlan } from "./ubuntu-migration-plan.mjs";
import { catalogHash, identifier, snapshotHash } from "./ubuntu-schema-catalog.mjs";

// Called only by the external Ubuntu installer/updater, never by API startup,
// the Replit build or Publish. Tests pass a client targeting disposable schemas.
export async function applyPlan(client, plan, {
  schema = "public", metadataSchema = "redfp360_migrations", initialize = false,
} = {}) {
  const ledger = `${identifier(metadataSchema)}."history"`;
  identifier(schema);
  let transaction = false;
  try {
    await client.query("BEGIN");
    transaction = true;
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    const locked = await client.query("SELECT pg_try_advisory_xact_lock(724360, hashtext($1)) AS locked", [schema]);
    if (!locked.rows[0].locked) throw new Error("Ya hay una migración en curso.");

    const exists = (await client.query("SELECT to_regclass($1) AS relation", [ledger])).rows[0].relation;
    if (initialize && exists) throw new Error("No se reinicializará una base con historial existente.");
    if (initialize) {
      const empty = await snapshotHash(client, "", schema);
      if (await catalogHash(client, schema) !== empty) {
        throw new Error("La inicialización solo admite una base completamente vacía.");
      }
      await client.query(plan.states[0].sql.replaceAll('"public".', `${identifier(schema)}.`));
    }
    let history = exists ? (await client.query(`SELECT * FROM ${ledger} ORDER BY position FOR UPDATE`)).rows : [];
    if (!history.length && exists) throw new Error("El historial existe pero está vacío; no se adoptará automáticamente.");
    if (!exists) {
      const expected = await snapshotHash(client, plan.states[0].sql, schema);
      const actual = await catalogHash(client, schema);
      if (actual !== expected) throw new Error("La base existente no coincide con el esquema inicial revisado.");
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${identifier(metadataSchema)}`);
      await client.query(`CREATE TABLE ${ledger} (
        position integer PRIMARY KEY,
        id text NOT NULL UNIQUE,
        source_hash text NOT NULL,
        snapshot_sha text NOT NULL,
        migration_sha text NOT NULL,
        catalog_hash text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      await client.query(`INSERT INTO ${ledger}
        (position,id,source_hash,snapshot_sha,migration_sha,catalog_hash)
        VALUES (0,'baseline',$1,$2,$2,$3)`, [plan.states[0].schemaHash, plan.states[0].sha256, actual]);
      history = (await client.query(`SELECT * FROM ${ledger} ORDER BY position`)).rows;
    }
    if (history.length > plan.states.length) throw new Error("Se ha rechazado una versión anterior al esquema instalado.");
    for (const [index, row] of history.entries()) {
      const state = plan.states[index];
      const migration = index ? plan.migrations[index - 1] : null;
      if (row.position !== index || row.id !== (migration?.id ?? "baseline")
        || row.source_hash !== state.schemaHash || row.snapshot_sha !== state.sha256
        || row.migration_sha !== (migration?.sha256 ?? state.sha256)) {
        throw new Error("El historial de migraciones aplicado ha sido alterado o no coincide con esta versión.");
      }
    }
    const current = history.at(-1);
    if (current.catalog_hash !== await catalogHash(client, schema)) {
      throw new Error("Se detectaron cambios de esquema ajenos al historial; no se actualizará automáticamente.");
    }
    if (current.position < plan.installedIndex) {
      throw new Error("La base está por detrás del código instalado.");
    }
    let applied = 0;
    for (let index = history.length; index < plan.states.length; index++) {
      const state = plan.states[index];
      const migration = plan.migrations[index - 1];
      await client.query(`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
      for (const text of migration.statements) {
        await client.query({ text, queryMode: "extended" });
      }
      const actual = await catalogHash(client, schema);
      const expected = await snapshotHash(client, state.sql, schema);
      if (actual !== expected) throw new Error(`El resultado no coincide con el esquema revisado: ${migration.id}.`);
      await client.query(`INSERT INTO ${ledger}
        (position,id,source_hash,snapshot_sha,migration_sha,catalog_hash) VALUES ($1,$2,$3,$4,$5,$6)`,
      [index, migration.id, state.schemaHash, state.sha256, migration.sha256, actual]);
      applied++;
    }
    await client.query("COMMIT");
    transaction = false;
    return { applied, currentSchemaHash: plan.states.at(-1).schemaHash };
  } catch (error) {
    if (transaction) await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main(args) {
  const [command, ...options] = args;
  if (command === "--help") {
    console.log("migrate-ubuntu.mjs plan|apply|initialize [--from DIRECTORIO_LIB_DB_INSTALADO]");
    return;
  }
  if (!["plan", "apply", "initialize"].includes(command) || (options.length && (options.length !== 2 || options[0] !== "--from"))) {
    throw new Error("Uso: migrate-ubuntu.mjs plan|apply|initialize [--from DIRECTORIO_LIB_DB_INSTALADO]");
  }
  const dbDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const plan = await loadPlan(dbDir, options[1] ? path.resolve(options[1]) : dbDir);
  if (command === "initialize") plan.installedIndex = 0;
  if (command === "plan") {
    console.log(`Plan verificado: ${plan.states.length - 1 - plan.installedIndex} migraciones desde el código instalado.`);
    return;
  }
  if (process.env.RED_FP360_MIGRATION_TARGET !== "ubuntu-local") {
    throw new Error("Migraciones deshabilitadas fuera del instalador/actualizador Ubuntu.");
  }
  const url = new URL(process.env.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/redfp360" || (url.port && url.port !== "5432")
    || url.search || url.hash) {
    throw new Error("Solo se admite el PostgreSQL local redfp360 de Ubuntu.");
  }
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    const result = await applyPlan(client, plan, { initialize: command === "initialize" });
    console.log(`Migraciones completadas: ${result.applied}; esquema verificado.`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    // Never log a connection string, SQL statement, row detail or supplied secret.
    const message = error.code ? `Error PostgreSQL ${error.code}; cambios revertidos.` : error.message;
    console.error(`ERROR: ${message}`);
    process.exitCode = 1;
  });
}

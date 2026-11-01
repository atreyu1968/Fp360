#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, chmodSync, readFileSync, writeFileSync, readdirSync, cpSync, rmSync, existsSync, symlinkSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seed, documentBytes, checksum, objectPath, sessionSecret } from "./recovery-fixture.mjs";

// No URL or destination parameters are accepted. This program never reads the
// inherited DATABASE_URL, PG*, App Storage configuration or credentials.
assert.equal(process.argv.length, 2, "This drill does not accept external destinations");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
process.chdir(root);
process.umask(0o077);
const generated = path.join(root, "generated-artifacts");
mkdirSync(generated, { recursive: true });
const work = mkdtempSync(path.join(generated, "recovery-"));
chmodSync(work, 0o700);
const socket = path.join(work, "socket");
const data = path.join(work, "cluster");
mkdirSync(socket);
const env = {
  PATH: process.env.PATH,
  HOME: path.join(work, "home"),
  LANG: "C.UTF-8",
  PGHOST: socket, PGPORT: "5432", PGUSER: "recovery_owner",
  PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null",
};
mkdirSync(env.HOME);
// Also isolate libraries in this process: pg must not see inherited PG* defaults.
process.env = { ...env };
const pg = (await import("pg")).default;
const resultPath = path.join(generated, "recovery-drill-result.json");
rmSync(resultPath, { force: true });
let started = false;
const clients = [];
const checks = [];
const startedAt = new Date();
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {
    cwd: root, env: { ...env, ...extra }, encoding: "utf8", timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `${command} failed: ${result.error?.message ?? ""}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
function pass(message) { checks.push(message); console.log(`PASS: ${message}`); }
function cleanup() {
  if (started || existsSync(path.join(data, "postmaster.pid"))) {
    run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]);
    started = false;
  }
  rmSync(work, { recursive: true, force: true });
  assert(!existsSync(work));
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    try { cleanup(); } finally { process.exit(signal === "SIGINT" ? 130 : 143); }
  });
}
async function connect(database) {
  const client = new pg.Client({ host: socket, port: 5432, user: "recovery_owner", database });
  clients.push(client);
  await client.connect();
  return client;
}
async function snapshot(client) {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  const result = {};
  for (const { tablename } of rows) {
    assert(/^[a-z0-9_]+$/.test(tablename));
    const rows = await client.query(`SELECT row_to_json(t)::text AS value FROM "${tablename}" t ORDER BY row_to_json(t)::text COLLATE "C"`);
    result[tablename] = {
      count: rows.rowCount,
      sha256: createHash("sha256").update(JSON.stringify(rows.rows)).digest("hex"),
    };
  }
  return result;
}
async function schemaCatalog(client) {
  return {
    columns: (await client.query(`SELECT table_name,column_name,ordinal_position,udt_name,is_nullable,column_default
      FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`)).rows,
    constraints: (await client.query(`SELECT conrelid::regclass::text AS relation,conname,contype,convalidated,
      pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE connamespace='public'::regnamespace ORDER BY relation,conname`)).rows,
    indexes: (await client.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
      WHERE schemaname='public' ORDER BY tablename,indexname`)).rows,
  };
}

let failure;
let evidence;
try {
  const version = run("pg_dump", ["--version"]).trim();
  run("initdb", ["-D", data, "--username=recovery_owner", "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"]);
  run("pg_ctl", ["-D", data, "-l", path.join(work, "postgres.log"), "-o",
    `-c listen_addresses='' -c unix_socket_permissions=0700 -k ${socket}`, "-w", "start"]);
  started = true;
  const admin = await connect("postgres");
  assert.equal((await admin.query("SHOW listen_addresses")).rows[0].listen_addresses, "");
  for (const database of ["recovery_source", "recovery_target"]) {
    await admin.query(`CREATE DATABASE ${database}`);
  }
  pass("New disposable cluster, private Unix socket, no TCP listener or inherited credentials");
  // Generate the complete current schema offline. No drizzle push and no
  // configured project database are involved.
  run("pnpm", ["--dir", "lib/db", "exec", "drizzle-kit", "generate", "--dialect=postgresql",
    "--schema=./src/schema/index.ts", `--out=${work}/schema`]);
  const sqlFiles = readdirSync(path.join(work, "schema")).filter(name => name.endsWith(".sql")).sort();
  assert(sqlFiles.length > 0);
  for (const sql of sqlFiles) {
    run("psql", ["-X", "--set=ON_ERROR_STOP=1", "-d", "recovery_source", "-f", path.join(work, "schema", sql)]);
  }
  const source = await connect("recovery_source");
  const target = await connect("recovery_target");
  await seed(source);
  const before = await snapshot(source);
  const schemaBefore = await schemaCatalog(source);
  pass(`Full current schema created; ${Object.keys(before).length} tables inventoried with row counts and SHA-256`);

  // A local adapter stands in for App Storage. Its data and metadata are backed
  // up separately from PostgreSQL, preserving logical /objects/ paths.
  const sourceObjects = path.join(work, "source-private");
  const targetObjects = path.join(work, "target-private");
  const backupObjects = path.join(work, "backup-private");
  const relativeObject = objectPath.replace("/objects/", "");
  mkdirSync(path.join(sourceObjects, "uploads"), { recursive: true });
  writeFileSync(path.join(sourceObjects, relativeObject), documentBytes);
  writeFileSync(path.join(sourceObjects, "acl.json"), JSON.stringify({
    metadata: { "custom:aclPolicy": JSON.stringify({ owner: "owner", visibility: "private" }) },
  }));
  const manifest = { objectPath, sizeBytes: documentBytes.length, checksumSha256: checksum, acl: "private", owner: "owner" };
  writeFileSync(path.join(work, "object-manifest.json"), JSON.stringify(manifest));
  run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", "--file", path.join(work, "database.dump"), "-d", "recovery_source"]);
  cpSync(sourceObjects, backupObjects, { recursive: true });
  rmSync(sourceObjects, { recursive: true });
  await source.end();
  clients.splice(clients.indexOf(source), 1);
  await admin.query("DROP DATABASE recovery_source");
  pass("Custom-format PostgreSQL dump and separate file/ACL backup created; synthetic source deleted before restore");

  run("pg_restore", ["--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
    "-d", "recovery_target", path.join(work, "database.dump")]);
  cpSync(backupObjects, targetObjects, { recursive: true });
  assert.deepEqual(await snapshot(target), before);
  assert.deepEqual(await schemaCatalog(target), schemaBefore);
  const constraints = await target.query("SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace AND convalidated");
  assert(constraints.rows[0].n > 0);
  await assert.rejects(target.query("INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,role) VALUES ('orphan','missing','network-a','student')"), { code: "23503" });
  await assert.rejects(target.query("INSERT INTO fp360_organizations SELECT * FROM fp360_organizations LIMIT 1"), { code: "23505" });
  pass(`Every table, column, constraint and index matches the backup; ${constraints.rows[0].n} validated foreign keys; orphan and duplicate rejected`);
  const economic = await target.query(`
    SELECT o.buyer_organization_id, i.issuer_organization_id, i.total_cents,
           sum(p.amount_cents)::int AS paid, (i.total_cents-sum(p.amount_cents))::int AS outstanding
    FROM fp360_orders o JOIN fp360_invoices i ON i.order_id=o.id
    JOIN fp360_payments p ON p.invoice_id=i.id GROUP BY o.buyer_organization_id,i.issuer_organization_id,i.total_cents`);
  assert.deepEqual(economic.rows, [{ buyer_organization_id: "company-b", issuer_organization_id: "company-a", total_cents: 10700, paid: 4000, outstanding: 6700 }]);
  const ledger = await target.query("SELECT sum(debit_cents)::int AS debit, sum(credit_cents)::int AS credit FROM fp360_accounting_entry_lines");
  assert.deepEqual(ledger.rows, [{ debit: 10700, credit: 10700 }]);
  const history = await target.query(`SELECT e.id FROM fp360_accounting_events e
    JOIN fp360_accounting_entries a ON a.id=e.entry_id
    JOIN fp360_invoices i ON i.id=a.source_id WHERE i.id='invoice-1'`);
  assert.equal(history.rowCount, 1);
  pass("Company trade relations, invoice 10700, payment 4000, outstanding 6700, balanced ledger 10700/10700 and event history restored");
  const bytes = readFileSync(path.join(targetObjects, relativeObject));
  assert.equal(bytes.length, manifest.sizeBytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.checksumSha256);
  assert.equal(statSync(path.join(targetObjects, relativeObject)).mode & 0o077, 0);
  assert.notEqual(sourceObjects, targetObjects);
  assert(!existsSync(sourceObjects));
  const references = await target.query(`SELECT v.object_path, v.checksum_sha256 FROM fp360_document_versions v
    JOIN fp360_documents d ON d.id=v.document_id JOIN fp360_document_dossiers x ON x.id=d.dossier_id
    JOIN fp360_organizations o ON o.id=d.organization_id
    WHERE d.visibility='restricted' AND o.tenant_id=v.tenant_id`);
  assert.equal(references.rowCount, 2);
  assert(references.rows.every(row => row.object_path === manifest.objectPath && row.checksum_sha256 === manifest.checksumSha256));
  pass("Private document, two versions, dossier/company links, logical paths, bytes, checksum and local private metadata restored to a distinct directory");

  run("node", ["artifacts/api-server/scripts/build-recovery-access.mjs", path.join(work, "access.mjs")]);
  symlinkSync(path.join(root, "artifacts/api-server/node_modules"), path.join(work, "node_modules"), "dir");
  const databaseUrl = `postgresql://recovery_owner@localhost/recovery_target?host=${encodeURIComponent(socket)}`;
  console.log(run("node", [path.join(work, "access.mjs"), targetObjects], {
    DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret, NODE_ENV: "test",
    RECOVERY_DRILL: "disposable", PRIVATE_OBJECT_DIR: "/recovery-only/private",
    PUBLIC_OBJECT_SEARCH_PATHS: "/recovery-only/public",
  }).trim());
  pass("Real document API: restored owner allowed; anonymous, inactive, same-company non-owner, other company and other network denied before storage read");
  // A target write cannot reach the (already deleted) source or any external DB.
  await target.query("UPDATE fp360_organizations SET name='Restored isolated copy' WHERE id='company-a'");
  assert.equal((await admin.query("SELECT datname FROM pg_database WHERE datname='recovery_source'")).rowCount, 0);
  pass("Restored target writable in isolation; original synthetic database and file directory no longer exist");
  evidence = {
    startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), postgres: version,
    scope: "Disposable local PostgreSQL; fictional data; local App Storage adapter, NOT live cloud recovery",
    checks, tableCount: Object.keys(before).length,
    populatedTables: Object.values(before).filter(table => table.count > 0).length,
    foreignKeys: constraints.rows[0].n, manifest, inventory: before,
    schemaSha256: createHash("sha256").update(JSON.stringify(schemaBefore)).digest("hex"),
  };
} catch (error) {
  failure = error;
} finally {
  await Promise.allSettled(clients.map(client => client.end()));
  cleanup();
  console.log("PASS: disposable cluster stopped; databases, dump, files, sessions and generated harness removed");
}
if (failure) throw failure;
evidence.cleanup = "Complete: temporary cluster stopped and entire disposable directory removed";
writeFileSync(resultPath, JSON.stringify(evidence, null, 2));
console.log("PASS: report saved to generated-artifacts/recovery-drill-result.json (synthetic evidence only)");

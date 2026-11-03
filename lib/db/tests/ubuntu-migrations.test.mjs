import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import pg from "pg";
import { applyPlan } from "../scripts/migrate-ubuntu.mjs";
import { backfillOrganizationScopes } from "../scripts/backfill-organization-scopes.mjs";
import { identifier } from "../scripts/ubuntu-schema-catalog.mjs";
import { assertExpandStatement, loadPlan, schemaSourceHash, sha256 } from "../scripts/ubuntu-migration-plan.mjs";

const dbDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "CREATE TABLE items (id integer PRIMARY KEY, value text NOT NULL);";
const target = "CREATE TABLE items (id integer PRIMARY KEY, value text NOT NULL, note text);";
function simplePlan() {
  return {
    installedIndex: 0,
    states: [
      { schemaHash: "a".repeat(64), sha256: sha256(baseline), sql: baseline },
      { schemaHash: "b".repeat(64), sha256: sha256(target), sql: target },
    ],
    migrations: [{
      id: "0001_optional_note", sha256: "c".repeat(64), backwardsCompatible: true,
      statements: ["ALTER TABLE items ADD COLUMN note text;"],
    }],
  };
}

async function fixture(t, sql = baseline) {
  assert.notEqual(process.env.NODE_ENV, "production", "Never run these tests in production");
  assert.ok(process.env.DATABASE_URL, "A development/test DATABASE_URL is required");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const schema = `migration_test_${randomBytes(10).toString("hex")}`;
  const metadataSchema = `migration_meta_${randomBytes(10).toString("hex")}`;
  t.after(async () => {
    await client.query("ROLLBACK");
    await client.query(`DROP SCHEMA IF EXISTS ${identifier(schema)} CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS ${identifier(metadataSchema)} CASCADE`);
    await client.end();
  });
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA ${identifier(schema)}`);
  await client.query(`SET LOCAL search_path TO ${identifier(schema)}, pg_catalog`);
  await client.query(sql.replaceAll('"public".', `${identifier(schema)}.`));
  await client.query("COMMIT");
  return { client, schema, metadataSchema };
}

test("repository migration manifest matches the current schema and rejects edited history", async (t) => {
  const plan = await loadPlan(dbDir);
  assert.equal(plan.installedIndex, plan.states.length - 1);
  const exported = execFileSync("pnpm", ["exec", "drizzle-kit", "export", "--dialect", "postgresql",
    "--schema", "./src/schema/index.ts"], { cwd: dbDir, encoding: "utf8", maxBuffer: 5_000_000 });
  assert.equal(sha256(exported), plan.states.at(-1).sha256, "Snapshot must match Drizzle's current schema export");
  const dir = await mkdtemp(path.join(os.tmpdir(), "redfp360-manifest-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "src/schema"), { recursive: true });
  await mkdir(path.join(dir, "migrations"));
  await writeFile(path.join(dir, "drizzle.config.ts"), "fixture");
  await writeFile(path.join(dir, "src/schema/index.ts"), "fixture");
  await writeFile(path.join(dir, "migrations/baseline.sql"), baseline);
  const manifest = { format: 1, states: [{
    schemaHash: await schemaSourceHash(dir), snapshot: "baseline.sql", sha256: sha256(baseline),
  }], migrations: [] };
  await writeFile(path.join(dir, "migrations/manifest.json"), JSON.stringify(manifest));
  await loadPlan(dir);
  await writeFile(path.join(dir, "migrations/baseline.sql"), `${baseline}\n-- edited`);
  await assert.rejects(loadPlan(dir), /Checksum/);
  await writeFile(path.join(dir, "migrations/baseline.sql"), baseline);
  await writeFile(path.join(dir, "src/schema/index.ts"), "changed without a migration");
  await assert.rejects(loadPlan(dir), /sin actualizar/);
});

test("unattended migration policy refuses destructive, data-changing and transaction SQL", () => {
  for (const sql of [
    "DROP TABLE items", "DELETE FROM items", "ALTER TABLE items DROP COLUMN value",
    "ALTER TABLE items ADD COLUMN mandatory text NOT NULL",
    "ALTER TABLE items ADD COLUMN x text; COMMIT;",
    "CREATE INDEX CONCURRENTLY test ON items (id)",
    "CREATE TABLE x AS SELECT * FROM items",
    "CREATE TABLE x (id integer); CREATE TABLE y (id integer)",
    "CREATE UNIQUE INDEX test ON items(value)",
    "ALTER TABLE items ADD COLUMN x text, ADD CONSTRAINT broken CHECK (value = 'blocked')",
    "ALTER TABLE items ADD COLUMN next_id bigint DEFAULT nextval('existing_sequence')",
  ]) assert.throws(() => assertExpandStatement(sql), /Solo|manual|restricciones/);
  assertExpandStatement('ALTER TABLE "items" ADD COLUMN "note" text;');
  assertExpandStatement("CREATE INDEX items_note_idx ON items(note);");
  assertExpandStatement("CREATE TABLE extra (id integer PRIMARY KEY, note text);");
});

test("the CLI refuses unmanaged targets and remote or overridden connection hosts", () => {
  for (const [indicator, connection] of [
    ["", "postgres://localhost/redfp360"],
    ["ubuntu-local", "postgres://example.invalid/redfp360"],
    ["ubuntu-local", "postgres://localhost/redfp360?host=example.invalid"],
    ["ubuntu-local", "postgres://localhost/another_database"],
  ]) {
    const result = spawnSync(process.execPath, [path.join(dbDir, "scripts/migrate-ubuntu.mjs"), "apply"], {
      env: { ...process.env, RED_FP360_MIGRATION_TARGET: indicator, DATABASE_URL: connection },
      encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /deshabilitadas|PostgreSQL local/);
  }
});

test("the full RED FP360 baseline can be adopted without applying its CREATE statements to existing tables", async (t) => {
  const plan = await loadPlan(dbDir);
  plan.installedIndex = 0;
  plan.states = plan.states.slice(0, 1);
  plan.migrations = [];
  const f = await fixture(t, plan.states[0].sql);
  const result = await applyPlan(f.client, plan, f);
  assert.equal(result.applied, 0);
  const tables = await f.client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname=$1", [f.schema]);
  assert.ok(tables.rows[0].count > 50);
  assert.equal((await applyPlan(f.client, plan, f)).applied, 0);
});

test("additive migrations and organization-scope backfill preserve existing companies", async (t) => {
  const plan = await loadPlan(dbDir);
  plan.installedIndex = 0;
  const f = await fixture(t, plan.states[0].sql);
  await f.client.query(`SET search_path TO ${identifier(f.schema)}, pg_catalog`);
  await f.client.query(`
    INSERT INTO fp360_organizations (id, tenant_id, name, center, island, role, is_active)
    VALUES
      ('legacy-a', 'tenant-a', 'Empresa histórica A', 'Centro Norte', 'Tenerife', 'seller', true),
      ('legacy-b', 'tenant-a', 'Empresa histórica B', 'Centro Sur', 'Tenerife', 'buyer', true),
      ('legacy-c', 'tenant-b', 'Empresa histórica C', 'Centro Norte', 'Gran Canaria', 'both', true)
  `);
  assert.equal((await applyPlan(f.client, plan, f)).applied, 6);
  const columns = await f.client.query(
    "SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema=$1 AND column_name IN ('hr_employee_id','source_payroll_run_id','source_payroll_run_ids','purchase_invoice_id','contact_id') ORDER BY table_name, column_name",
    [f.schema],
  );
  assert.deepEqual(columns.rows, [
    { table_name: "fp360_bank_transfers", column_name: "purchase_invoice_id", is_nullable: "YES" },
    { table_name: "fp360_crm_activities", column_name: "contact_id", is_nullable: "YES" },
    { table_name: "fp360_crm_opportunities", column_name: "contact_id", is_nullable: "YES" },
    { table_name: "fp360_crm_opportunity_order_links", column_name: "contact_id", is_nullable: "YES" },
    { table_name: "fp360_social_security_settlements", column_name: "source_payroll_run_id", is_nullable: "YES" },
    { table_name: "fp360_social_security_workers", column_name: "hr_employee_id", is_nullable: "YES" },
    { table_name: "fp360_tax_declarations", column_name: "source_payroll_run_ids", is_nullable: "YES" },
  ]);
  const profileColumns = await f.client.query(
    "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='fp360_organizations' AND column_name IN ('activity','commercial_name','address','municipality','postal_code','business_email','business_phone','logo_object_path','logo_content_type','logo_pending_object_path','logo_pending_content_type','logo_pending_size_bytes','logo_pending_user_id') ORDER BY column_name",
    [f.schema],
  );
  assert.deepEqual(profileColumns.rows, [
    { column_name: "activity", is_nullable: "YES" },
    { column_name: "address", is_nullable: "YES" },
    { column_name: "business_email", is_nullable: "YES" },
    { column_name: "business_phone", is_nullable: "YES" },
    { column_name: "commercial_name", is_nullable: "YES" },
    { column_name: "logo_content_type", is_nullable: "YES" },
    { column_name: "logo_object_path", is_nullable: "YES" },
    { column_name: "logo_pending_content_type", is_nullable: "YES" },
    { column_name: "logo_pending_object_path", is_nullable: "YES" },
    { column_name: "logo_pending_size_bytes", is_nullable: "YES" },
    { column_name: "logo_pending_user_id", is_nullable: "YES" },
    { column_name: "municipality", is_nullable: "YES" },
    { column_name: "postal_code", is_nullable: "YES" },
  ]);
  const crmLink = await f.client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_name='fp360_crm_opportunity_order_links'",
    [f.schema],
  );
  assert.equal(crmLink.rowCount, 1);

  const firstBackfill = await backfillOrganizationScopes(f.client);
  assert.deepEqual(firstBackfill, { centerRowsCreated: 3, scopeRowsCreated: 3 });
  const secondBackfill = await backfillOrganizationScopes(f.client);
  assert.deepEqual(secondBackfill, { centerRowsCreated: 0, scopeRowsCreated: 0 });
  const networkIsolation = await f.client.query(`
    SELECT scope.tenant_id,
      count(*)::int AS company_count,
      count(DISTINCT scope.center_id)::int AS center_count,
      count(DISTINCT scope.simulation_network_id)::int AS network_count
    FROM fp360_organization_scopes AS scope
    GROUP BY scope.tenant_id
    ORDER BY scope.tenant_id
  `);
  assert.deepEqual(networkIsolation.rows, [
    { tenant_id: "tenant-a", company_count: 2, center_count: 2, network_count: 1 },
    { tenant_id: "tenant-b", company_count: 1, center_count: 1, network_count: 1 },
  ]);
  const preservedCompanies = await f.client.query(
    "SELECT id, name FROM fp360_organizations WHERE id LIKE 'legacy-%' ORDER BY id",
  );
  assert.deepEqual(preservedCompanies.rows, [
    { id: "legacy-a", name: "Empresa histórica A" },
    { id: "legacy-b", name: "Empresa histórica B" },
    { id: "legacy-c", name: "Empresa histórica C" },
  ]);
  assert.equal((await applyPlan(f.client, plan, f)).applied, 0, "reapplying the migration must be a no-op");
});

test("fresh initialization creates the baseline and latest migrations atomically", async (t) => {
  const f = await fixture(t, "");
  const plan = simplePlan();
  assert.equal((await applyPlan(f.client, plan, { ...f, initialize: true })).applied, 1);
  await assert.rejects(applyPlan(f.client, plan, { ...f, initialize: true }), /reinicializar/);
});

test("initialization refuses any existing application data", async (t) => {
  const f = await fixture(t);
  await f.client.query(`INSERT INTO ${identifier(f.schema)}.items VALUES (1,'preserve')`);
  await assert.rejects(applyPlan(f.client, simplePlan(), { ...f, initialize: true }), /completamente vacía/);
  assert.equal((await f.client.query(`SELECT value FROM ${identifier(f.schema)}.items`)).rows[0].value, "preserve");
});

test("an additive migration preserves existing rows and a retry never repeats it", async (t) => {
  const f = await fixture(t);
  await f.client.query(`INSERT INTO ${identifier(f.schema)}.items VALUES (1,'fictional record')`);
  const plan = simplePlan();
  assert.equal((await applyPlan(f.client, plan, f)).applied, 1);
  assert.equal((await applyPlan(f.client, plan, f)).applied, 0);
  const rows = await f.client.query(`SELECT * FROM ${identifier(f.schema)}.items`);
  assert.deepEqual(rows.rows, [{ id: 1, value: "fictional record", note: null }]);
  const ledger = await f.client.query(`SELECT position FROM ${identifier(f.metadataSchema)}.history ORDER BY position`);
  assert.deepEqual(ledger.rows.map((row) => row.position), [0, 1]);
});

test("a failure midway rolls back all DDL and ledger changes", async (t) => {
  const f = await fixture(t);
  const plan = simplePlan();
  plan.migrations[0].statements.push("CREATE INDEX broken ON missing_table (id)");
  await assert.rejects(applyPlan(f.client, plan, f), /missing_table/);
  const columns = await f.client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='items' ORDER BY ordinal_position",
    [f.schema],
  );
  assert.deepEqual(columns.rows.map((row) => row.column_name), ["id", "value"]);
  const history = await f.client.query("SELECT to_regclass($1) AS relation", [`${f.metadataSchema}.history`]);
  assert.equal(history.rows[0].relation, null);
});

test("SQL that does not produce the reviewed target schema is rolled back", async (t) => {
  const f = await fixture(t);
  const plan = simplePlan();
  plan.migrations[0].statements = ["ALTER TABLE items ADD COLUMN wrong_column text"];
  await assert.rejects(applyPlan(f.client, plan, f), /no coincide/);
  const columns = await f.client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1", [f.schema]);
  assert.ok(!columns.rows.some((row) => row.column_name === "wrong_column"));
});

test("baseline adoption refuses a database with unexpected columns", async (t) => {
  const f = await fixture(t, `${baseline} ALTER TABLE items ADD COLUMN unexpected text;`);
  await assert.rejects(applyPlan(f.client, simplePlan(), f), /no coincide con el esquema inicial/);
});

test("an edited applied migration or manual schema drift prevents further updates", async (t) => {
  const f = await fixture(t);
  const plan = simplePlan();
  await applyPlan(f.client, plan, f);
  plan.migrations[0].sha256 = "d".repeat(64);
  await assert.rejects(applyPlan(f.client, plan, f), /historial/);
  plan.migrations[0].sha256 = "c".repeat(64);
  await f.client.query(`ALTER TABLE ${identifier(f.schema)}.items ADD COLUMN unexpected text`);
  await assert.rejects(applyPlan(f.client, plan, f), /ajenos al historial/);
});

test("a concurrent migrator fails immediately while the other transaction holds its lock", async (t) => {
  const f = await fixture(t);
  const other = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await other.connect();
  try {
    await other.query("BEGIN");
    await other.query("SELECT pg_advisory_xact_lock(724360, hashtext($1))", [f.schema]);
    await assert.rejects(applyPlan(f.client, simplePlan(), f), /en curso/);
  } finally {
    await other.query("ROLLBACK");
    await other.end();
  }
});

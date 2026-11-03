import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";

const { Pool } = pg;
const requiredEnvironment = ["DATABASE_URL", "SESSION_SECRET"];
const missingEnvironment = requiredEnvironment.filter((key) => !process.env[key]);

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForServer(child, baseUrl) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API test server exited with code ${child.exitCode}`);
    }
    try {
      if ((await fetch(`${baseUrl}/api/healthz`)).ok) return;
    } catch {
      // The API is still starting.
    }
    await delay(100);
  }
  throw new Error("API test server did not become ready");
}

test("changing an organization's academic period preserves accounting until an explicit close", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "Never run this test in production");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tenantId = `academic-period-accounting-test-${randomUUID()}`;
  const organizationId = randomUUID();
  const centerId = randomUUID();
  const networkId = randomUUID();
  const userId = randomUUID();
  const membershipId = randomUUID();
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString("base64url");
  const openPeriodId = randomUUID();
  const closedPeriodId = randomUUID();
  const openEntryId = randomUUID();
  const closedEntryId = randomUUID();
  const testRunId = randomUUID().replaceAll("-", "");
  let child;

  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await pool.query("DELETE FROM fp360_accounting_events WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_accounting_entry_lines WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_accounting_entries WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_accounting_periods WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_activity WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_auth_sessions WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM fp360_auth_memberships WHERE user_id = $1", [userId]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id = $1", [userId]);
    await pool.query("DELETE FROM fp360_organization_scopes WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_simulation_networks WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_centers WHERE tenant_id = $1", [tenantId]);
    await pool.end();
  });

  const requiredTables = [
    "fp360_organization_scopes",
    "fp360_accounting_periods",
    "fp360_accounting_entries",
  ];
  const existingTables = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  if (existingTables.rowCount !== requiredTables.length) {
    t.skip("Apply the current RED FP360 database migrations before running this integration test.");
    return;
  }

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPath = fileURLToPath(new URL("../../dist/index.mjs", import.meta.url));
  child = spawn(process.execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
    stdio: "ignore",
  });
  await waitForServer(child, baseUrl);

  await pool.query(
    `INSERT INTO fp360_organizations
      (id, tenant_id, name, center, island, role, is_active)
     VALUES ($1, $2, 'Empresa de prueba académica', 'Centro de prueba académica', 'Tenerife', 'both', true)`,
    [organizationId, tenantId],
  );
  await pool.query(
    `INSERT INTO fp360_centers (id, tenant_id, name, normalized_name)
     VALUES ($1, $2, 'Centro de prueba académica', 'centro de prueba académica')`,
    [centerId, tenantId],
  );
  await pool.query(
    `INSERT INTO fp360_simulation_networks
      (id, tenant_id, code, name, calendar_mode, fiscal_year_start_month)
     VALUES ($1, $2, $3, 'Red económica de prueba', 'ordinary', 9)`,
    [networkId, tenantId, `academic-period-${testRunId}`],
  );
  await pool.query(
    `INSERT INTO fp360_organization_scopes
      (organization_id, tenant_id, center_id, simulation_network_id, academic_period, origin)
     VALUES ($1, $2, $3, $4, '2025-2026', 'organization_created')`,
    [organizationId, tenantId, centerId, networkId],
  );
  await pool.query(
    `INSERT INTO fp360_auth_users (id, email, display_name, password_hash)
     VALUES ($1, $2, 'Responsable de prueba', 'test-only-password-hash')`,
    [userId, `${userId}@example.test`],
  );
  await pool.query(
    `INSERT INTO fp360_auth_memberships (id, user_id, tenant_id, organization_id, role)
     VALUES ($1, $2, $3, NULL, 'teacher')`,
    [membershipId, userId, tenantId],
  );
  const sessionHash = createHmac("sha256", process.env.SESSION_SECRET)
    .update(sessionToken)
    .digest("hex");
  await pool.query(
    `INSERT INTO fp360_auth_sessions (id, user_id, membership_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
    [sessionId, userId, membershipId, sessionHash],
  );
  await pool.query(
    `INSERT INTO fp360_accounting_periods
      (id, tenant_id, organization_id, fiscal_year, period, status)
     VALUES ($1, $2, $3, 2027, 9, 'open')`,
    [openPeriodId, tenantId, organizationId],
  );
  await pool.query(
    `INSERT INTO fp360_accounting_periods
      (id, tenant_id, organization_id, fiscal_year, period, status, closed_at, closed_by_user_id, close_reason)
     VALUES ($1, $2, $3, 2027, 8, 'closed', '2027-08-31T12:00:00Z', $4, 'Cierre previo de prueba')`,
    [closedPeriodId, tenantId, organizationId, userId],
  );
  for (const [id, period, operationId] of [
    [openEntryId, 9, `academic-open-entry-${testRunId}`],
    [closedEntryId, 8, `academic-closed-entry-${testRunId}`],
  ]) {
    await pool.query(
      `INSERT INTO fp360_accounting_entries
        (id, tenant_id, organization_id, entry_number, fiscal_year, period, entry_date, concept,
         status, source_type, debit_cents, credit_cents, operation_id, request_fingerprint,
         created_by_user_id, created_by_name, posted_at)
       VALUES ($1, $2, $3, $4, 2027, $5, $6, $7, 'posted', 'manual', 2500, 2500, $8,
         'academic-period-test', $9, 'Responsable de prueba', '2027-09-15T12:00:00Z')`,
      [
        id, tenantId, organizationId, period, period,
        period === 9 ? "2027-09-15" : "2027-08-15",
        `Asiento de prueba del periodo ${period}`,
        operationId,
        userId,
      ],
    );
  }

  const request = async (route, method = "GET", body) => {
    const response = await fetch(`${baseUrl}/api${route}`, {
      method,
      headers: {
        cookie: `redfp360_session=${sessionToken}`,
        origin: baseUrl,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsedBody = null;
    if (text) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text;
      }
    }
    return { response, body: parsedBody };
  };

  const loadAccountingSnapshot = async () => {
    const periods = await pool.query(
      `SELECT id, fiscal_year, period, status, closed_at, closed_by_user_id, reopened_at,
              reopened_by_user_id, close_reason
       FROM fp360_accounting_periods
       WHERE tenant_id = $1 AND organization_id = $2
       ORDER BY fiscal_year, period`,
      [tenantId, organizationId],
    );
    const entries = await pool.query(
      `SELECT id, entry_number, fiscal_year, period, entry_date, concept, status, source_type,
              source_id, source_reference, debit_cents, credit_cents, operation_id,
              request_fingerprint, created_by_user_id, created_by_name, posted_at,
              reversal_of_entry_id, reversed_by_entry_id
       FROM fp360_accounting_entries
       WHERE tenant_id = $1 AND organization_id = $2
       ORDER BY fiscal_year, period, entry_number`,
      [tenantId, organizationId],
    );
    return { periods: periods.rows, entries: entries.rows };
  };
  const accountingBeforeEdit = await loadAccountingSnapshot();
  assert.equal(accountingBeforeEdit.periods.length, 2);
  assert.equal(accountingBeforeEdit.entries.length, 2);

  const edit = await request(`/redfp360/organizations/${organizationId}`, "PATCH", {
    academicPeriod: "2026-2027",
  });
  assert.equal(edit.response.status, 200, JSON.stringify(edit.body));
  assert.equal(edit.body.academicPeriod, "2026-2027");
  assert.equal(edit.body.simulationCalendarMode, "ordinary");
  assert.equal(edit.body.fiscalYearStartMonth, 9);
  assert.equal(edit.body.simulationNetworkId, networkId);
  assert.deepEqual(await loadAccountingSnapshot(), accountingBeforeEdit,
    "changing the academic period must preserve fiscal years, entries, and existing close metadata");

  const updatedScope = await pool.query(
    `SELECT academic_period, simulation_network_id
     FROM fp360_organization_scopes
     WHERE tenant_id = $1 AND organization_id = $2`,
    [tenantId, organizationId],
  );
  assert.deepEqual(updatedScope.rows, [{ academic_period: "2026-2027", simulation_network_id: networkId }]);

  const explicitClose = await request("/redfp360/accounting/periods/2027/9/close", "POST", {
    organizationId,
    operationId: `academic-explicit-close-${testRunId}`,
    reason: "Cierre contable explícito",
  });
  assert.equal(explicitClose.response.status, 200, JSON.stringify(explicitClose.body));
  assert.equal(explicitClose.body.status, "closed");
  assert.equal(explicitClose.body.closeReason, "Cierre contable explícito");
  const afterExplicitClose = await loadAccountingSnapshot();
  assert.equal(
    afterExplicitClose.periods.find((period) => period.id === openPeriodId)?.status,
    "closed",
    "only the explicit accounting close action may close an open period",
  );
  assert.equal(afterExplicitClose.entries.length, accountingBeforeEdit.entries.length);
});

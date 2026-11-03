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
import {
  buildPayrollAccountingLines,
  resolvePayrollSourceRetry,
  validateIndependentPayrollReviewer,
  validatePayrollImport,
} from "./payroll-accounting.mjs";

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
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The API is still starting.
    }
    await delay(100);
  }
  throw new Error("API test server did not become ready");
}

const payroll = {
  organizationId: "company-a",
  periodKey: "2027-08",
  version: 3,
  status: "closed",
  receiptLines: [{
    workerRef: "FP-EMP-001",
    receiptRef: "REC-202708-ABC123",
    grossCents: 200_000,
    employerContributionCents: 40_000,
    netCents: 150_000,
    workerContributionCents: 12_000,
    withholdingCents: 20_000,
    advancesCents: 10_000,
    otherDeductionsCents: 8_000,
  }],
};

const accounts = {
  wagesExpenseAccountId: "wages",
  employerCostAccountId: "employer-cost",
  netPayableAccountId: "net",
  workerContributionAccountId: "worker-contribution",
  employerContributionAccountId: "employer-contribution",
  withholdingAccountId: "withholding",
  advancesAccountId: "advances",
  otherDeductionsAccountId: "other",
};

test("payroll import binds the source to company, period, version, and closed status", () => {
  const request = { organizationId: "company-a", expectedPeriodKey: "2027-08", expectedVersion: 3 };
  assert.equal(validatePayrollImport(payroll, request), null);
  assert.match(validatePayrollImport(payroll, { ...request, organizationId: "company-b" }), /empresa/);
  assert.match(validatePayrollImport(payroll, { ...request, expectedPeriodKey: "2027-09" }), /periodo/);
  assert.match(validatePayrollImport(payroll, { ...request, expectedVersion: 2 }), /versión/);
  assert.match(validatePayrollImport({ ...payroll, status: "reviewed" }, request), /cerradas/);
});

test("payroll import keeps every positive cost and deduction as a mapped draft line", () => {
  const lines = buildPayrollAccountingLines(payroll, accounts);
  assert.deepEqual(lines.map((line) => [line.accountId, line.debitCents, line.creditCents]), [
    ["wages", 200_000, 0],
    ["employer-cost", 40_000, 0],
    ["net", 0, 150_000],
    ["worker-contribution", 0, 12_000],
    ["employer-contribution", 0, 40_000],
    ["withholding", 0, 20_000],
    ["advances", 0, 10_000],
    ["other", 0, 8_000],
  ]);
  assert.equal(lines.reduce((sum, line) => sum + line.debitCents, 0), 240_000);
  assert.equal(lines.reduce((sum, line) => sum + line.creditCents, 0), 240_000);
  assert.ok(lines.every((line) => line.description.includes("REC-202708-ABC123")));
});

test("repeating an import returns its original draft and rejects changed account mappings", () => {
  const priorDraft = { id: "draft-1", requestFingerprint: "mapping-a" };
  assert.deepEqual(resolvePayrollSourceRetry(priorDraft, "mapping-a"), { entryId: "draft-1" });
  assert.deepEqual(resolvePayrollSourceRetry(priorDraft, "mapping-b"), {
    error: "Esta versión de nómina ya se importó con otras cuentas educativas.",
    status: 409,
  });
  assert.equal(resolvePayrollSourceRetry(null, "mapping-a"), null);
});

test("posting the payroll draft requires someone other than the preparer and payroll reviewer", () => {
  const run = { createdByUserId: "preparer", reviewedByUserId: "payroll-reviewer" };
  assert.match(validateIndependentPayrollReviewer(run, "preparer"), /distinta/);
  assert.match(validateIndependentPayrollReviewer(run, "payroll-reviewer"), /distinta/);
  assert.equal(validateIndependentPayrollReviewer(run, "accounting-reviewer"), null);
});

test("simultaneous payroll imports reuse one draft and reject changed account mappings", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const tenantId = `payroll-accounting-test-${randomUUID()}`;
  const userId = randomUUID();
  const membershipId = randomUUID();
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString("base64url");
  const organizationId = randomUUID();
  const policyId = randomUUID();
  const payrollRunId = randomUUID();
  let child;
  let locker;

  try {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const serverPath = fileURLToPath(new URL("../../dist/index.mjs", import.meta.url));
    child = spawn(process.execPath, [serverPath], {
      cwd: path.dirname(serverPath),
      env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
      stdio: "ignore",
    });
    await waitForServer(child, baseUrl);

    await client.query(
      `INSERT INTO fp360_auth_users (id, email, display_name, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [userId, `${userId}@example.test`, "Payroll import test", "test-only-password-hash"],
    );
    await client.query(
      `INSERT INTO fp360_auth_memberships (id, user_id, tenant_id, role)
       VALUES ($1, $2, $3, 'teacher')`,
      [membershipId, userId, tenantId],
    );
    const sessionHash = createHmac("sha256", process.env.SESSION_SECRET)
      .update(sessionToken)
      .digest("hex");
    await client.query(
      `INSERT INTO fp360_auth_sessions
        (id, user_id, membership_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
      [sessionId, userId, membershipId, sessionHash],
    );
    await client.query(
      `INSERT INTO fp360_organizations (id, tenant_id, name, center, island, role, is_active)
       VALUES ($1, $2, 'Empresa ficticia de nómina', 'Centro de prueba', 'Isla ficticia', 'company', true)`,
      [organizationId, tenantId],
    );
    await client.query(
      `INSERT INTO fp360_payroll_policies
        (id, tenant_id, organization_id, version, worker_social_security_bps,
         employer_social_security_bps, income_withholding_bps, status, operation_id,
         request_fingerprint, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, 1, 600, 3000, 1000, 'active', $4, 'test-policy', $5, 'Payroll import test')`,
      [policyId, tenantId, organizationId, `policy-${randomUUID()}`, userId],
    );

    const receiptLines = [{
      employeeId: randomUUID(),
      workerRef: "FP-EMP-TEST",
      absenceDays: 0,
      monthlyBaseCents: 200_000,
      complementCents: 0,
      absenceAdjustmentCents: 0,
      grossCents: 200_000,
      contributionBaseCents: 200_000,
      workerContributionCents: 12_000,
      employerContributionCents: 40_000,
      withholdingCents: 20_000,
      advancesCents: 10_000,
      otherDeductionsCents: 8_000,
      netCents: 150_000,
      employerCostCents: 240_000,
      receiptRef: "REC-202708-TEST",
    }];
    await client.query(
      `INSERT INTO fp360_payroll_runs
        (id, tenant_id, organization_id, period_key, version, policy_id, receipt_lines,
         employee_count, gross_total_cents, net_total_cents, employer_cost_total_cents,
         status, operation_id, request_fingerprint, created_by_user_id, created_by_name,
         reviewed_by_user_id, reviewed_by_name)
       VALUES ($1, $2, $3, '2027-08', 1, $4, $5::jsonb, 1, 200000, 150000, 240000,
         'closed', $6, 'test-run', $7, 'Payroll import test', $8, 'Payroll reviewer')`,
      [
        payrollRunId,
        tenantId,
        organizationId,
        policyId,
        JSON.stringify(receiptLines),
        `payroll-run-${randomUUID()}`,
        userId,
        randomUUID(),
      ],
    );

    const chartAccounts = [
      ["6400", "Salarios educativos", "expense", "debit"],
      ["6420", "Coste educativo empresa", "expense", "debit"],
      ["4650", "Líquidos educativos pendientes", "liability", "credit"],
      ["4760", "Cuotas educativas pendientes", "liability", "credit"],
      ["4751", "Retenciones didácticas por pagar", "liability", "credit"],
      ["4600", "Anticipos de personal", "asset", "debit"],
      ["4651", "Otras deducciones educativas", "liability", "credit"],
      ["6000", "Compras de mercaderías", "expense", "debit"],
    ];
    for (const [code, name, nature, normalBalance] of chartAccounts) {
      await client.query(
        `INSERT INTO fp360_accounting_accounts
          (id, tenant_id, organization_id, code, name, nature, normal_balance,
           parent_code, active, is_system, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, true, true, $8)`,
        [randomUUID(), tenantId, organizationId, code, name, nature, normalBalance, userId],
      );
    }
    const accountRows = await client.query(
      `SELECT code, id FROM fp360_accounting_accounts
       WHERE tenant_id = $1 AND organization_id = $2`,
      [tenantId, organizationId],
    );
    const accountIdByCode = new Map(accountRows.rows.map(({ code, id }) => [code, id]));
    const payrollAccounts = {
      wagesExpenseAccountId: accountIdByCode.get("6400"),
      employerCostAccountId: accountIdByCode.get("6420"),
      netPayableAccountId: accountIdByCode.get("4650"),
      workerContributionAccountId: accountIdByCode.get("4760"),
      employerContributionAccountId: accountIdByCode.get("4760"),
      withholdingAccountId: accountIdByCode.get("4751"),
      advancesAccountId: accountIdByCode.get("4600"),
      otherDeductionsAccountId: accountIdByCode.get("4651"),
    };
    assert.ok(Object.values(payrollAccounts).every(Boolean));

    const headers = {
      "content-type": "application/json",
      cookie: `redfp360_session=${sessionToken}`,
      origin: baseUrl,
    };
    const importPayroll = (operationId, mapping = payrollAccounts) => fetch(
      `${baseUrl}/api/redfp360/accounting/sources/payroll_run/${payrollRunId}/draft`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          organizationId,
          operationId,
          expectedPeriodKey: "2027-08",
          expectedVersion: 1,
          payrollAccounts: mapping,
        }),
      },
    );

    locker = await pool.connect();
    await locker.query("BEGIN");
    await locker.query(
      "SELECT id FROM fp360_payroll_runs WHERE id = $1 FOR UPDATE",
      [payrollRunId],
    );
    const simultaneousRequests = [
      importPayroll(`payroll-import-a-${randomUUID()}`),
      importPayroll(`payroll-import-b-${randomUUID()}`),
    ];
    let observedWaiters = 0;
    const lockDeadline = Date.now() + 5_000;
    while (Date.now() < lockDeadline) {
      const lockState = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM pg_stat_activity
         WHERE datname = current_database()
           AND wait_event_type = 'Lock'
           AND query ILIKE '%fp360_payroll_runs%'`,
      );
      observedWaiters = lockState.rows[0].count;
      if (observedWaiters >= 2) break;
      await delay(25);
    }
    await locker.query("COMMIT");
    locker.release();
    locker = undefined;

    const simultaneousResponses = await Promise.all(simultaneousRequests);
    const simultaneousBodies = await Promise.all(simultaneousResponses.map((response) => response.json()));
    assert.ok(observedWaiters >= 2, "both imports should wait on the locked payroll row");
    assert.deepEqual(simultaneousResponses.map((response) => response.status), [201, 201]);
    assert.equal(simultaneousBodies[0].id, simultaneousBodies[1].id);
    assert.equal(simultaneousBodies[0].sourceType, "payroll_run");
    assert.equal(simultaneousBodies[0].sourceId, payrollRunId);
    assert.equal(simultaneousBodies[0].status, "draft");

    const savedDrafts = await client.query(
      `SELECT id, status FROM fp360_accounting_entries
       WHERE tenant_id = $1 AND organization_id = $2
         AND source_type = 'payroll_run' AND source_id = $3`,
      [tenantId, organizationId, payrollRunId],
    );
    assert.equal(savedDrafts.rowCount, 1, "the source should have exactly one accounting entry");
    assert.equal(savedDrafts.rows[0].id, simultaneousBodies[0].id);
    assert.equal(savedDrafts.rows[0].status, "draft");

    const matchingRetryResponse = await importPayroll(`payroll-import-retry-${randomUUID()}`);
    const matchingRetry = await matchingRetryResponse.json();
    assert.equal(matchingRetryResponse.status, 201);
    assert.equal(matchingRetry.id, simultaneousBodies[0].id, "a matching retry should return the original draft");

    const changedMappingResponse = await importPayroll(
      `payroll-import-changed-${randomUUID()}`,
      { ...payrollAccounts, wagesExpenseAccountId: accountIdByCode.get("6000") },
    );
    const changedMapping = await changedMappingResponse.json();
    assert.equal(changedMappingResponse.status, 409);
    assert.match(changedMapping.error, /otras cuentas/);

    const finalDraftCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM fp360_accounting_entries
       WHERE tenant_id = $1 AND organization_id = $2
         AND source_type = 'payroll_run' AND source_id = $3 AND status = 'draft'`,
      [tenantId, organizationId, payrollRunId],
    );
    assert.equal(finalDraftCount.rows[0].count, 1, "retries must not create additional drafts");
  } finally {
    if (locker) {
      await locker.query("ROLLBACK");
      locker.release();
    }
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await client.query("DELETE FROM fp360_accounting_events WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_entry_lines WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_entries WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_periods WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_accounts WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_payroll_runs WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_payroll_policies WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_auth_sessions WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM fp360_auth_memberships WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM fp360_auth_users WHERE id = $1", [userId]);
    await client.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    client.release();
    await pool.end();
  }
});

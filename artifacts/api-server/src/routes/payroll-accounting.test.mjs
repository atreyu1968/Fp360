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

test("failed and simultaneous payroll imports leave no partial or duplicate drafts", {
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
  const otherOrganizationId = randomUUID();
  const centerId = randomUUID();
  const simulationNetworkId = randomUUID();
  const policyId = randomUUID();
  const concurrentRunId = randomUUID();
  const invalidMappingRunId = randomUUID();
  const closedPeriodRunId = randomUUID();
  const fiscalBoundaryRuns = [
    { id: randomUUID(), periodKey: "2027-06", fiscalYear: 2026, period: 12, expectedEntryNumber: 1 },
    { id: concurrentRunId, periodKey: "2027-07", fiscalYear: 2027, period: 1, expectedEntryNumber: 1 },
    { id: invalidMappingRunId, periodKey: "2027-08", fiscalYear: 2027, period: 2, expectedEntryNumber: 2 },
  ];
  const operationIds = {
    invalidMapping: `payroll-invalid-${randomUUID()}`,
    closedPeriod: `payroll-closed-${randomUUID()}`,
    validRetry: `payroll-retry-${randomUUID()}`,
  };
  const validAccounts = {
    wagesExpenseAccountId: randomUUID(),
    employerCostAccountId: randomUUID(),
    netPayableAccountId: randomUUID(),
    workerContributionAccountId: randomUUID(),
    employerContributionAccountId: randomUUID(),
    withholdingAccountId: randomUUID(),
    advancesAccountId: randomUUID(),
    otherDeductionsAccountId: randomUUID(),
  };
  const changedAccounts = {
    ...validAccounts,
    wagesExpenseAccountId: randomUUID(),
  };
  const invalidAccounts = {
    ...validAccounts,
    wagesExpenseAccountId: randomUUID(),
  };
  const accountRows = [
    [validAccounts.wagesExpenseAccountId, "test-wages", "expense"],
    [validAccounts.employerCostAccountId, "test-employer-cost", "expense"],
    [validAccounts.netPayableAccountId, "test-net-payable", "liability"],
    [validAccounts.workerContributionAccountId, "test-worker-contribution", "liability"],
    [validAccounts.employerContributionAccountId, "test-employer-contribution", "liability"],
    [validAccounts.withholdingAccountId, "test-withholding", "liability"],
    [validAccounts.advancesAccountId, "test-advances", "asset"],
    [validAccounts.otherDeductionsAccountId, "test-other-deductions", "liability"],
    [changedAccounts.wagesExpenseAccountId, "test-alternate-wages", "expense"],
  ];
  let child;
  let locker;
  let failureTriggerName;
  let failureFunctionName;

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
      `INSERT INTO fp360_organizations (id, tenant_id, name, center, island, role, is_active)
       VALUES
         ($1, $3, 'Empresa de prueba', 'Centro de prueba', 'Isla ficticia', 'company', true),
         ($2, $3, 'Otra empresa de prueba', 'Otro centro', 'Isla ficticia', 'company', true)`,
      [organizationId, otherOrganizationId, tenantId],
    );
    await client.query(
      `INSERT INTO fp360_centers (id, tenant_id, name, normalized_name)
       VALUES ($1, $2, 'Centro de prueba', 'centro-de-prueba')`,
      [centerId, tenantId],
    );
    await client.query(
      `INSERT INTO fp360_simulation_networks
         (id, tenant_id, code, name, calendar_mode, fiscal_year_start_month)
       VALUES ($1, $2, 'payroll-fiscal-test', 'Calendario fiscal de nóminas', 'ordinary', 7)`,
      [simulationNetworkId, tenantId],
    );
    await client.query(
      `INSERT INTO fp360_organization_scopes
         (organization_id, tenant_id, center_id, simulation_network_id, origin)
       VALUES ($1, $2, $3, $4, 'organization_created')`,
      [organizationId, tenantId, centerId, simulationNetworkId],
    );
    await client.query(
      `INSERT INTO fp360_auth_users (id, email, display_name, password_hash)
       VALUES ($1, $2, 'Payroll test user', 'test-only-password-hash')`,
      [userId, `${userId}@example.test`],
    );
    await client.query(
      `INSERT INTO fp360_auth_memberships (id, user_id, tenant_id, organization_id, role)
       VALUES ($1, $2, $3, $4, 'team_manager')`,
      [membershipId, userId, tenantId, organizationId],
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
      `INSERT INTO fp360_payroll_policies
         (id, tenant_id, organization_id, version, worker_social_security_bps,
          employer_social_security_bps, income_withholding_bps, status, operation_id,
          request_fingerprint, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, 1, 600, 3000, 1000, 'active', $4, 'test-policy', $5, 'Payroll test user')`,
      [policyId, tenantId, organizationId, `policy-${randomUUID()}`, userId],
    );

    for (const [id, code, nature] of accountRows) {
      await client.query(
        `INSERT INTO fp360_accounting_accounts
           (id, tenant_id, organization_id, code, name, nature, normal_balance,
            parent_code, active, is_system, created_by_user_id)
         VALUES ($1, $2, $3, $4, $4, $5, $6, NULL, true, true, $7)`,
        [
          id,
          tenantId,
          organizationId,
          code,
          nature,
          nature === "asset" || nature === "expense" ? "debit" : "credit",
          userId,
        ],
      );
    }
    await client.query(
      `INSERT INTO fp360_accounting_accounts
         (id, tenant_id, organization_id, code, name, nature, normal_balance,
          parent_code, active, is_system, created_by_user_id)
       VALUES ($1, $2, $3, 'foreign-expense', 'Foreign company expense', 'expense',
               'debit', NULL, true, true, $4)`,
      [invalidAccounts.wagesExpenseAccountId, tenantId, otherOrganizationId, userId],
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
      receiptRef: "REC-TEST-2027",
    }];
    const createRun = (id, periodKey, operationId, preparerId = userId, reviewerId = preparerId) => client.query(
      `INSERT INTO fp360_payroll_runs
         (id, tenant_id, organization_id, period_key, version, policy_id, receipt_lines,
          employee_count, gross_total_cents, net_total_cents, employer_cost_total_cents,
          status, operation_id, request_fingerprint, created_by_user_id, created_by_name,
          reviewed_by_user_id, reviewed_by_name)
       VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb, 1, 200000, 150000, 240000,
               'closed', $7, 'test-run', $8, 'Payroll test user', $9, 'Payroll reviewer')`,
      [id, tenantId, organizationId, periodKey, policyId, JSON.stringify(receiptLines), operationId, preparerId, reviewerId],
    );
    await createRun(concurrentRunId, "2027-07", `run-${randomUUID()}`, randomUUID(), randomUUID());
    await createRun(invalidMappingRunId, "2027-08", `run-${randomUUID()}`, randomUUID(), randomUUID());
    await createRun(closedPeriodRunId, "2027-09", `run-${randomUUID()}`);
    await createRun(fiscalBoundaryRuns[0].id, fiscalBoundaryRuns[0].periodKey, `run-${randomUUID()}`, randomUUID(), randomUUID());
    await client.query(
      `INSERT INTO fp360_accounting_periods
         (id, tenant_id, organization_id, fiscal_year, period, status, close_reason)
       VALUES ($1, $2, $3, 2027, 3, 'closed', 'Closed for payroll import test')`,
      [randomUUID(), tenantId, organizationId],
    );

    const headers = {
      "content-type": "application/json",
      cookie: `redfp360_session=${sessionToken}`,
      origin: baseUrl,
    };
    const importRun = (runId, periodKey, operationId, payrollAccounts = validAccounts) => fetch(
      `${baseUrl}/api/redfp360/accounting/sources/payroll_run/${runId}/draft`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          organizationId,
          operationId,
          expectedPeriodKey: periodKey,
          expectedVersion: 1,
          payrollAccounts,
        }),
      },
    );
    const persistedCounts = async (runId, operationId) => (await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM fp360_accounting_entries
          WHERE tenant_id = $1 AND source_type = 'payroll_run' AND source_id = $2) AS entries,
         (SELECT COUNT(*)::int FROM fp360_accounting_entry_lines l
          JOIN fp360_accounting_entries e ON e.id = l.entry_id
          WHERE e.tenant_id = $1 AND e.source_type = 'payroll_run' AND e.source_id = $2) AS lines,
         (SELECT COUNT(*)::int FROM fp360_accounting_events ev
          WHERE ev.tenant_id = $1 AND (
            ev.operation_id = $3 OR ev.entry_id IN (
              SELECT id FROM fp360_accounting_entries
              WHERE tenant_id = $1 AND source_type = 'payroll_run' AND source_id = $2
            )
          )) AS events`,
      [tenantId, runId, operationId],
    )).rows[0];

    const invalidResponse = await importRun(
      invalidMappingRunId,
      "2027-08",
      operationIds.invalidMapping,
      invalidAccounts,
    );
    assert.equal(invalidResponse.status, 400, JSON.stringify(await invalidResponse.json()));
    assert.deepEqual(
      await persistedCounts(invalidMappingRunId, operationIds.invalidMapping),
      { entries: 0, lines: 0, events: 0 },
      "an account belonging to another company must not leave accounting records",
    );

    const closedPeriodResponse = await importRun(
      closedPeriodRunId,
      "2027-09",
      operationIds.closedPeriod,
    );
    assert.equal(closedPeriodResponse.status, 409, JSON.stringify(await closedPeriodResponse.json()));
    assert.deepEqual(
      await persistedCounts(closedPeriodRunId, operationIds.closedPeriod),
      { entries: 0, lines: 0, events: 0 },
      "a closed accounting period must not leave accounting records",
    );

    const retryResponse = await importRun(
      invalidMappingRunId,
      "2027-08",
      operationIds.validRetry,
    );
    assert.equal(retryResponse.status, 201, JSON.stringify(await retryResponse.clone().json()));
    const retryEntry = await retryResponse.json();
    assert.ok(retryEntry.id);
    assert.deepEqual(
      await persistedCounts(invalidMappingRunId, operationIds.validRetry),
      { entries: 1, lines: 8, events: 1 },
      "a corrected import must create one complete draft and audit event",
    );

    locker = await pool.connect();
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM fp360_payroll_runs WHERE id = $1 FOR UPDATE", [concurrentRunId]);
    const simultaneousRequests = [
      importRun(concurrentRunId, "2027-07", `payroll-import-a-${randomUUID()}`),
      importRun(concurrentRunId, "2027-07", `payroll-import-b-${randomUUID()}`),
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
    assert.equal(simultaneousBodies[0].sourceId, concurrentRunId);
    assert.equal(simultaneousBodies[0].status, "draft");
    assert.deepEqual(
      await persistedCounts(concurrentRunId, "unmatched-operation"),
      { entries: 1, lines: 8, events: 1 },
      "simultaneous imports should persist one complete draft and event",
    );

    const matchingRetryResponse = await importRun(
      concurrentRunId,
      "2027-07",
      `payroll-import-retry-${randomUUID()}`,
    );
    const matchingRetry = await matchingRetryResponse.json();
    assert.equal(matchingRetryResponse.status, 201);
    assert.equal(matchingRetry.id, simultaneousBodies[0].id, "a matching retry should return the original draft");

    const changedMappingResponse = await importRun(
      concurrentRunId,
      "2027-07",
      `payroll-import-changed-${randomUUID()}`,
      changedAccounts,
    );
    const changedMapping = await changedMappingResponse.json();
    assert.equal(changedMappingResponse.status, 409);
    assert.match(changedMapping.error, /otras cuentas/);
    assert.deepEqual(
      await persistedCounts(concurrentRunId, "unmatched-operation"),
      { entries: 1, lines: 8, events: 1 },
      "retries must not create additional drafts or audit events",
    );

    const existingFiscalBoundaryEntries = new Map([
      [concurrentRunId, simultaneousBodies[0]],
      [invalidMappingRunId, retryEntry],
    ]);
    const fiscalBoundaryDrafts = [];
    for (const run of fiscalBoundaryRuns) {
      let body = existingFiscalBoundaryEntries.get(run.id);
      if (!body) {
        const response = await importRun(run.id, run.periodKey, `payroll-fiscal-${randomUUID()}`);
        body = await response.json();
        assert.equal(response.status, 201, JSON.stringify(body));
      }
      assert.equal(body.entryDate, `${run.periodKey}-01`);
      assert.equal(body.fiscalYear, run.fiscalYear, `${run.periodKey} should use the correct fiscal year`);
      assert.equal(body.period, run.period, `${run.periodKey} should use the correct fiscal period`);
      assert.equal(body.status, "draft");
      assert.equal(body.sourceType, "payroll_run");
      fiscalBoundaryDrafts.push({ run, entry: body });
    }

    const startMonthDraft = fiscalBoundaryDrafts[1];
    await client.query(
      `UPDATE fp360_accounting_entries SET fiscal_year = 2026, period = 12
       WHERE id = $1 AND tenant_id = $2`,
      [startMonthDraft.entry.id, tenantId],
    );
    const misclassifiedPost = await fetch(
      `${baseUrl}/api/redfp360/accounting/entries/${startMonthDraft.entry.id}/post`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          organizationId,
          operationId: `payroll-post-misclassified-${randomUUID()}`,
        }),
      },
    );
    const misclassifiedBody = await misclassifiedPost.json();
    assert.equal(misclassifiedPost.status, 409, JSON.stringify(misclassifiedBody));
    assert.match(misclassifiedBody.error, /origen de nómina/);
    const stillDraft = await client.query(
      "SELECT status FROM fp360_accounting_entries WHERE id = $1 AND tenant_id = $2",
      [startMonthDraft.entry.id, tenantId],
    );
    assert.equal(stillDraft.rows[0].status, "draft", "a misclassified payroll must remain unposted");
    await client.query(
      `UPDATE fp360_accounting_entries SET fiscal_year = $1, period = $2
       WHERE id = $3 AND tenant_id = $4`,
      [startMonthDraft.run.fiscalYear, startMonthDraft.run.period,
        startMonthDraft.entry.id, tenantId],
    );

    for (const { run, entry } of fiscalBoundaryDrafts) {
      const postedResponse = await fetch(
        `${baseUrl}/api/redfp360/accounting/entries/${entry.id}/post`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            organizationId,
            operationId: `payroll-post-correct-${run.periodKey}-${randomUUID()}`,
          }),
        },
      );
      const postedBody = await postedResponse.json();
      assert.equal(postedResponse.status, 200, `${run.periodKey}: ${JSON.stringify(postedBody)}`);
      assert.equal(postedBody.status, "posted");
      assert.equal(postedBody.fiscalYear, run.fiscalYear);
      assert.equal(postedBody.period, run.period);
      assert.equal(
        postedBody.entryNumber,
        run.expectedEntryNumber,
        `${run.periodKey} should use the next number in fiscal year ${run.fiscalYear}'s own sequence`,
      );
    }

    const fiscalYearSequences = await client.query(
      `SELECT fiscal_year, next_entry_number
       FROM fp360_accounting_sequences
       WHERE tenant_id = $1 AND organization_id = $2
       ORDER BY fiscal_year`,
      [tenantId, organizationId],
    );
    assert.deepEqual(
      fiscalYearSequences.rows.map(({ fiscal_year, next_entry_number }) => [fiscal_year, next_entry_number]),
      [[2026, 2], [2027, 3]],
      "each fiscal year should persist an independent next-entry number",
    );

    const failedPayrollRunId = randomUUID();
    const failureToken = randomUUID().replaceAll("-", "");
    const failedReceiptRef = `REC-FAIL-${failureToken}`;
    const failedOperationId = `payroll-fail-${failureToken}`;
    const failedReceiptLines = receiptLines.map((line) => ({
      ...line,
      workerRef: `FP-EMP-FAIL-${failureToken}`,
      receiptRef: failedReceiptRef,
    }));
    await client.query(
      `INSERT INTO fp360_payroll_runs
        (id, tenant_id, organization_id, period_key, version, policy_id, receipt_lines,
         employee_count, gross_total_cents, net_total_cents, employer_cost_total_cents,
         status, operation_id, request_fingerprint, created_by_user_id, created_by_name,
         reviewed_by_user_id, reviewed_by_name)
       VALUES ($1, $2, $3, '2027-10', 1, $4, $5::jsonb, 1, 200000, 150000, 240000,
         'closed', $6, 'test-run-failure', $7, 'Payroll import test', $8, 'Payroll reviewer')`,
      [
        failedPayrollRunId,
        tenantId,
        organizationId,
        policyId,
        JSON.stringify(failedReceiptLines),
        `payroll-run-${failureToken}`,
        userId,
        randomUUID(),
      ],
    );

    failureTriggerName = `fp360_test_fail_payroll_${failureToken}`;
    failureFunctionName = `fp360_test_fail_payroll_fn_${failureToken}`;
    await client.query(
      `CREATE FUNCTION ${failureFunctionName}() RETURNS trigger
       LANGUAGE plpgsql AS $$ BEGIN
         RAISE EXCEPTION 'Intentional isolated payroll-import rollback test failure';
       END $$`,
    );
    await client.query(
      `CREATE TRIGGER ${failureTriggerName}
       BEFORE INSERT ON fp360_accounting_entry_lines
       FOR EACH ROW
       WHEN (NEW.tenant_id = '${tenantId}' AND NEW.description LIKE '%${failedReceiptRef}%')
       EXECUTE FUNCTION ${failureFunctionName}()`,
    );

    const failedImportResponse = await fetch(
      `${baseUrl}/api/redfp360/accounting/sources/payroll_run/${failedPayrollRunId}/draft`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          organizationId,
          operationId: failedOperationId,
          expectedPeriodKey: "2027-10",
          expectedVersion: 1,
          payrollAccounts: validAccounts,
        }),
      },
    );
    const failedImportBody = await failedImportResponse.text();
    assert.equal(failedImportResponse.status, 500, failedImportBody);
    await client.query(`DROP TRIGGER ${failureTriggerName} ON fp360_accounting_entry_lines`);
    await client.query(`DROP FUNCTION ${failureFunctionName}()`);
    failureTriggerName = undefined;
    failureFunctionName = undefined;

    const failedEntryCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM fp360_accounting_entries
       WHERE tenant_id = $1 AND organization_id = $2
         AND source_type = 'payroll_run' AND source_id = $3`,
      [tenantId, organizationId, failedPayrollRunId],
    );
    const failedLineCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM fp360_accounting_entry_lines
       WHERE tenant_id = $1 AND description LIKE $2`,
      [tenantId, `%${failedReceiptRef}%`],
    );
    const failedEventCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM fp360_accounting_events
       WHERE tenant_id = $1 AND organization_id = $2 AND operation_id = $3`,
      [tenantId, organizationId, failedOperationId],
    );
    assert.equal(failedEntryCount.rows[0].count, 0, "a line-write failure must roll back the draft entry");
    assert.equal(failedLineCount.rows[0].count, 0, "a line-write failure must leave no accounting lines");
    assert.equal(failedEventCount.rows[0].count, 0, "a failed import must not leave an audit event");
  } finally {
    if (locker) {
      await locker.query("ROLLBACK");
      locker.release();
    }
    if (failureTriggerName) {
      await client.query(`DROP TRIGGER IF EXISTS ${failureTriggerName} ON fp360_accounting_entry_lines`);
    }
    if (failureFunctionName) {
      await client.query(`DROP FUNCTION IF EXISTS ${failureFunctionName}()`);
    }
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await client.query("DELETE FROM fp360_accounting_events WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_entry_lines WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_entries WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_sequences WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_periods WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_accounts WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_payroll_events WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_payroll_runs WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_payroll_policies WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_auth_sessions WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM fp360_auth_memberships WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM fp360_auth_users WHERE id = $1", [userId]);
    await client.query("DELETE FROM fp360_organization_scopes WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_simulation_networks WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_centers WHERE tenant_id = $1", [tenantId]);
    client.release();
    await pool.end();
  }
});

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
      const response = await fetch(`${baseUrl}/api/healthz`);
      if (response.ok) return;
    } catch {
      // The API is still starting.
    }
    await delay(100);
  }
  throw new Error("API test server did not become ready");
}

test("fictional HR, payroll, and social-security data stays linked, scoped, and retry-safe", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const tenantId = `labor-social-security-test-${randomUUID()}`;
  const userId = randomUUID();
  const membershipId = randomUUID();
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString("base64url");
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const foreignPolicyId = randomUUID();
  const foreignRunId = randomUUID();
  const fakeEmail = `${userId}@example.test`;
  let child;

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
      `INSERT INTO fp360_auth_users
        (id, email, display_name, password_hash, mfa_enabled_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId, fakeEmail, "Docente de prueba ficticio", "test-only-password-hash"],
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
        (id, user_id, membership_id, token_hash, expires_at, mfa_verified_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', NOW())`,
      [sessionId, userId, membershipId, sessionHash],
    );
    await client.query(
      `INSERT INTO fp360_organizations (id, tenant_id, name, center, island, role, is_active)
       VALUES
         ($1, $3, 'Empresa ficticia A', 'Centro formativo', 'Isla ficticia', 'company', true),
         ($2, $3, 'Empresa ficticia B', 'Centro formativo', 'Isla ficticia', 'company', true)`,
      [organizationA, organizationB, tenantId],
    );
    await client.query(
      `INSERT INTO fp360_payroll_policies
        (id, tenant_id, organization_id, version, worker_social_security_bps,
         employer_social_security_bps, income_withholding_bps, status, operation_id,
         request_fingerprint, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, 1, 400, 900, 0, 'active', $4, 'test-fixture', $5, $6)`,
      [foreignPolicyId, tenantId, organizationB, `foreign-policy-${randomUUID()}`, userId, "Docente de prueba ficticio"],
    );
    await client.query(
      `INSERT INTO fp360_payroll_runs
        (id, tenant_id, organization_id, period_key, version, policy_id, receipt_lines,
         employee_count, gross_total_cents, net_total_cents, employer_cost_total_cents,
         status, operation_id, request_fingerprint, created_by_user_id, created_by_name)
       VALUES ($1, $2, $3, '2027-09', 1, $4, '[]'::jsonb, 0, 0, 0, 0,
         'closed', $5, 'test-fixture', $6, $7)`,
      [foreignRunId, tenantId, organizationB, foreignPolicyId, `foreign-run-${randomUUID()}`, userId, "Docente de prueba ficticio"],
    );

    const headers = {
      "content-type": "application/json",
      cookie: `redfp360_session=${sessionToken}`,
      origin: baseUrl,
    };
    const request = (method, route, body) => fetch(`${baseUrl}/api${route}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const post = (route, body) => request("POST", route, body);
    const expectJson = async (response, status, reason) => {
      const data = await response.json();
      assert.equal(response.status, status, `${reason}: ${JSON.stringify(data)}`);
      return data;
    };
    const operation = (name) => `${name}-${randomUUID()}`;

    // Build two fully approved fictional HR records through the public HR routes.
    const employees = [];
    for (const [sequence, salary] of [["one", 2_400_000], ["two", 3_600_000]]) {
      const vacancyResponse = await post("/redfp360/hr/vacancies", {
        organizationId: organizationA,
        jobTitle: `Puesto ficticio ${sequence}`,
        department: "Administración educativa",
        contractType: "indefinite",
        description: "Vacante de prueba sin datos personales reales.",
        operationId: operation(`vacancy-${sequence}`),
      });
      const vacancy = await expectJson(vacancyResponse, 201, "HR vacancy should be created");
      const candidateResponse = await post(`/redfp360/hr/vacancies/${vacancy.id}/candidates`, {
        trainingScore: 4,
        skillsScore: 5,
        availabilityScore: 4,
        operationId: operation(`candidate-${sequence}`),
      });
      const candidate = await expectJson(candidateResponse, 201, "fictional candidate should be created");
      await expectJson(await post(`/redfp360/hr/candidates/${candidate.id}/decision`, {
        action: "select",
        operationId: operation(`selection-${sequence}`),
      }), 200, "teacher should select the fictional candidate");

      const employee = await expectJson(await post("/redfp360/hr/employees", {
        organizationId: organizationA,
        candidateId: candidate.id,
        weeklyHours: 40,
        contributionGroup: 3,
        annualSalaryCents: salary,
        conventionName: "Convenio educativo ficticio",
        startDate: "2027-01-01",
        operationId: operation(`employee-${sequence}`),
      }), 201, "fictional employee should be created");
      const [initialContract] = (await client.query(
        `SELECT id FROM fp360_hr_contracts WHERE tenant_id = $1 AND employee_id = $2`,
        [tenantId, employee.id],
      )).rows;
      assert.ok(initialContract, "employee creation should create an initial contract");
      await expectJson(await post(`/redfp360/hr/contracts/${initialContract.id}/review`, {
        action: "confirm",
        operationId: operation(`contract-confirm-${sequence}`),
      }), 200, "teacher should confirm the initial contract");
      await expectJson(await post(`/redfp360/hr/contracts/${initialContract.id}/review`, {
        action: "confirm",
        operationId: operation(`contract-confirm-repeat-${sequence}`),
      }), 409, "a contract cannot be approved a second time");
      employees.push(employee);
    }

    const [employeeA, employeeB] = employees;
    const socialWorkerInput = {
      organizationId: organizationA,
      hrEmployeeId: employeeA.id,
      contributionGroup: employeeA.contributionGroup,
      contractType: employeeA.contractType,
      startDate: employeeA.startDate,
      monthlyContributionBaseCents: 200_000,
      employerContributionCents: 18_000,
      workerContributionCents: 8_000,
      operationId: operation("ss-worker"),
    };
    const socialWorker = await expectJson(await post("/redfp360/social-security/workers", socialWorkerInput), 201,
      "an active fictional HR employee should be linked to social security");
    assert.equal(socialWorker.hrEmployeeId, employeeA.id);
    assert.equal(socialWorker.workerRef, employeeA.workerRef);
    assert.equal(socialWorker.status, "pending");
    const workerRetry = await expectJson(await post("/redfp360/social-security/workers", socialWorkerInput), 201,
      "an identical link retry should return the original worker");
    assert.equal(workerRetry.id, socialWorker.id);
    assert.equal((await client.query(
      `SELECT COUNT(*)::int AS count FROM fp360_social_security_workers
       WHERE tenant_id = $1 AND hr_employee_id = $2`,
      [tenantId, employeeA.id],
    )).rows[0].count, 1, "an identical retry must not duplicate the linked worker");
    await expectJson(await post("/redfp360/social-security/workers", {
      ...socialWorkerInput,
      operationId: operation("ss-worker-duplicate"),
    }), 409, "a linked HR employee must not receive a second social-security record");
    await expectJson(await post("/redfp360/social-security/workers", {
      ...socialWorkerInput,
      organizationId: organizationB,
      operationId: operation("ss-worker-cross-company"),
    }), 404, "an employee cannot be linked under another company");

    const overview = await expectJson(await request("GET",
      `/redfp360/social-security/overview?organizationId=${organizationA}`), 200, "social-security overview should load");
    const movement = overview.movements.find((item) => item.workerId === socialWorker.id);
    assert.ok(movement, "creating the worker should create an auditable pending movement");
    const approveMovement = {
      action: "approve",
      operationId: operation("ss-approve"),
    };
    const approvedMovement = await expectJson(await post(
      `/redfp360/social-security/movements/${movement.id}/review`, approveMovement),
    200, "teacher should approve the simulated registration");
    assert.equal(approvedMovement.status, "approved");
    const approvedRetry = await expectJson(await post(
      `/redfp360/social-security/movements/${movement.id}/review`, approveMovement),
    200, "an identical approval retry should return the approved movement");
    assert.equal(approvedRetry.id, approvedMovement.id);
    assert.equal((await client.query(
      `SELECT COUNT(*)::int AS count FROM fp360_social_security_events
       WHERE tenant_id = $1 AND operation_id = $2`,
      [tenantId, approveMovement.operationId],
    )).rows[0].count, 1, "an approval retry must not duplicate audit events");

    const policy = await expectJson(await post("/redfp360/payroll/policies", {
      organizationId: organizationA,
      workerSocialSecurityBps: 400,
      employerSocialSecurityBps: 900,
      incomeWithholdingBps: 0,
      operationId: operation("payroll-policy"),
    }), 201, "educational payroll parameters should be created");
    await expectJson(await post(`/redfp360/payroll/policies/${policy.id}/activate`, {
      operationId: operation("payroll-policy-activate"),
    }), 200, "teacher should activate the educational payroll parameters");
    const payrollInput = {
      organizationId: organizationA,
      periodKey: "2027-09",
      policyId: policy.id,
      employeeInputs: employees.map((employee) => ({
        employeeId: employee.id,
        complementCents: 0,
        absenceAdjustmentCents: 0,
        advancesCents: 0,
        otherDeductionsCents: 0,
      })),
      operationId: operation("payroll-run"),
    };
    const payrollRun = await expectJson(await post("/redfp360/payroll/runs", payrollInput), 201,
      "payroll should calculate receipts for both active HR employees");
    assert.equal(payrollRun.status, "draft");
    assert.equal(payrollRun.receiptLines.length, 2);
    const payrollRetry = await expectJson(await post("/redfp360/payroll/runs", payrollInput), 201,
      "an identical payroll calculation retry should return the original run");
    assert.equal(payrollRetry.id, payrollRun.id);
    assert.deepEqual(payrollRetry.receiptLines.map((line) => line.receiptRef), payrollRun.receiptLines.map((line) => line.receiptRef));

    const payrollAction = async (action, op) => expectJson(await post(
      `/redfp360/payroll/runs/${payrollRun.id}/actions`,
      { action, operationId: op },
    ), 200, `payroll action ${action} should succeed`);
    await payrollAction("review", operation("payroll-review"));
    const closeOperationId = operation("payroll-close");
    await payrollAction("close", closeOperationId);
    const closedPayrollRetry = await payrollAction("close", closeOperationId);
    assert.equal(closedPayrollRetry.status, "closed");

    const settlementInput = {
      organizationId: organizationA,
      periodKey: "2027-09",
      payrollRunId: payrollRun.id,
      operationId: operation("settlement-create"),
    };
    await expectJson(await post("/redfp360/social-security/settlements", settlementInput), 409,
      "a closed payroll must be rejected until every receipt has an approved social-security link");
    await expectJson(await post("/redfp360/social-security/settlements", {
      ...settlementInput,
      periodKey: "2027-08",
      operationId: operation("settlement-wrong-period"),
    }), 409, "a payroll cannot be imported into a different period");
    await expectJson(await post("/redfp360/social-security/settlements", {
      ...settlementInput,
      payrollRunId: foreignRunId,
      operationId: operation("settlement-wrong-company"),
    }), 404, "a payroll from another company must not be visible or imported");

    const socialWorkerBInput = {
      organizationId: organizationA,
      hrEmployeeId: employeeB.id,
      contributionGroup: employeeB.contributionGroup,
      contractType: employeeB.contractType,
      startDate: employeeB.startDate,
      monthlyContributionBaseCents: 300_000,
      employerContributionCents: 27_000,
      workerContributionCents: 12_000,
      operationId: operation("ss-worker-two"),
    };
    const socialWorkerB = await expectJson(await post("/redfp360/social-security/workers", socialWorkerBInput), 201,
      "the second fictional employee should be linkable");
    const overviewAfterSecondLink = await expectJson(await request("GET",
      `/redfp360/social-security/overview?organizationId=${organizationA}`), 200, "social-security overview should refresh");
    const movementB = overviewAfterSecondLink.movements.find((item) => item.workerId === socialWorkerB.id);
    assert.ok(movementB);
    await expectJson(await post(`/redfp360/social-security/movements/${movementB.id}/review`, {
      action: "approve",
      operationId: operation("ss-approve-two"),
    }), 200, "teacher should approve the second simulated registration");

    const settlement = await expectJson(await post("/redfp360/social-security/settlements", settlementInput), 201,
      "the closed payroll should create a monthly educational settlement");
    assert.equal(settlement.status, "draft");
    assert.equal(settlement.sourcePayrollRunId, payrollRun.id);
    assert.equal(settlement.periodKey, payrollRun.periodKey);
    assert.equal(settlement.workerCount, payrollRun.receiptLines.length);
    assert.deepEqual(settlement.workerRefs.sort(), payrollRun.receiptLines.map((line) => line.workerRef).sort());
    assert.equal(settlement.contributionBaseCents,
      payrollRun.receiptLines.reduce((total, line) => total + line.contributionBaseCents, 0));
    assert.equal(settlement.employerContributionCents,
      payrollRun.receiptLines.reduce((total, line) => total + line.employerContributionCents, 0));
    assert.equal(settlement.workerContributionCents,
      payrollRun.receiptLines.reduce((total, line) => total + line.workerContributionCents, 0));
    assert.equal(settlement.totalContributionCents,
      settlement.employerContributionCents + settlement.workerContributionCents);
    assert.equal(settlement.contributionBaseCents, 500_000);
    assert.equal(settlement.employerContributionCents, 45_000);
    assert.equal(settlement.workerContributionCents, 20_000);
    assert.equal(settlement.totalContributionCents, 65_000);

    const settlementRetry = await expectJson(await post("/redfp360/social-security/settlements", settlementInput), 201,
      "an identical settlement retry should return the original draft");
    assert.equal(settlementRetry.id, settlement.id);
    await expectJson(await post("/redfp360/social-security/settlements", {
      ...settlementInput,
      operationId: operation("settlement-duplicate-period"),
    }), 409, "a second settlement for the same company and period must be rejected");
    const persistedSettlement = (await client.query(
      `SELECT source_payroll_run_id, period_key, worker_count, contribution_base_cents,
              employer_contribution_cents, worker_contribution_cents, total_contribution_cents
       FROM fp360_social_security_settlements WHERE id = $1 AND tenant_id = $2`,
      [settlement.id, tenantId],
    )).rows[0];
    assert.deepEqual(persistedSettlement, {
      source_payroll_run_id: payrollRun.id,
      period_key: "2027-09",
      worker_count: 2,
      contribution_base_cents: 500_000,
      employer_contribution_cents: 45_000,
      worker_contribution_cents: 20_000,
      total_contribution_cents: 65_000,
    }, "the database should preserve the source run, period, and receipt totals");

    const reviewInput = { action: "review", operationId: operation("settlement-review") };
    const reviewed = await expectJson(await post(
      `/redfp360/social-security/settlements/${settlement.id}/review`, reviewInput),
    200, "teacher should review the settlement draft");
    assert.equal(reviewed.status, "reviewed");
    const reviewRetry = await expectJson(await post(
      `/redfp360/social-security/settlements/${settlement.id}/review`, reviewInput),
    200, "an identical settlement-review retry should return the current settlement");
    assert.equal(reviewRetry.id, settlement.id);
    const closedSettlement = await expectJson(await post(
      `/redfp360/social-security/settlements/${settlement.id}/review`,
      { action: "close", operationId: operation("settlement-close") },
    ), 200, "teacher should complete the simulated settlement approval");
    assert.equal(closedSettlement.status, "closed_simulated");

    const counts = (await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM fp360_hr_employees WHERE tenant_id = $1) AS employees,
         (SELECT COUNT(*)::int FROM fp360_payroll_runs WHERE tenant_id = $1) AS payroll_runs,
         (SELECT COUNT(*)::int FROM fp360_social_security_workers WHERE tenant_id = $1) AS social_workers,
         (SELECT COUNT(*)::int FROM fp360_social_security_movements WHERE tenant_id = $1) AS movements,
         (SELECT COUNT(*)::int FROM fp360_social_security_settlements WHERE tenant_id = $1) AS settlements`,
      [tenantId],
    )).rows[0];
    assert.deepEqual(counts, {
      employees: 2,
      payroll_runs: 2,
      social_workers: 2,
      movements: 2,
      settlements: 1,
    }, "retries, rejected imports, and duplicate submissions must not create extra records");
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    const cleanupStatements = [
      "DELETE FROM fp360_social_security_events WHERE tenant_id = $1",
      "DELETE FROM fp360_social_security_settlements WHERE tenant_id = $1",
      "DELETE FROM fp360_social_security_movements WHERE tenant_id = $1",
      "DELETE FROM fp360_social_security_workers WHERE tenant_id = $1",
      "DELETE FROM fp360_payroll_events WHERE tenant_id = $1",
      "DELETE FROM fp360_payroll_runs WHERE tenant_id = $1",
      "DELETE FROM fp360_payroll_policies WHERE tenant_id = $1",
      "DELETE FROM fp360_hr_events WHERE tenant_id = $1",
      "DELETE FROM fp360_hr_contracts WHERE tenant_id = $1",
      "DELETE FROM fp360_hr_employees WHERE tenant_id = $1",
      "DELETE FROM fp360_hr_candidates WHERE tenant_id = $1",
      "DELETE FROM fp360_hr_vacancies WHERE tenant_id = $1",
      "DELETE FROM fp360_auth_sessions WHERE user_id = $1",
      "DELETE FROM fp360_auth_memberships WHERE user_id = $1",
      "DELETE FROM fp360_auth_users WHERE id = $1",
      "DELETE FROM fp360_organizations WHERE tenant_id = $1",
    ];
    try {
      for (const statement of cleanupStatements) {
        await client.query(statement, [statement.startsWith("DELETE FROM fp360_auth_sessions")
          || statement.startsWith("DELETE FROM fp360_auth_memberships")
          || statement.startsWith("DELETE FROM fp360_auth_users")
          ? userId
          : tenantId]);
      }
      const remainingRecords = (await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM fp360_organizations WHERE tenant_id = $1) AS organizations,
           (SELECT COUNT(*)::int FROM fp360_auth_sessions WHERE user_id = $2) AS sessions,
           (SELECT COUNT(*)::int FROM fp360_auth_memberships WHERE user_id = $2) AS memberships,
           (SELECT COUNT(*)::int FROM fp360_auth_users WHERE id = $2) AS users,
           (SELECT COUNT(*)::int FROM fp360_hr_vacancies WHERE tenant_id = $1) AS vacancies,
           (SELECT COUNT(*)::int FROM fp360_hr_candidates WHERE tenant_id = $1) AS candidates,
           (SELECT COUNT(*)::int FROM fp360_hr_employees WHERE tenant_id = $1) AS employees,
           (SELECT COUNT(*)::int FROM fp360_hr_contracts WHERE tenant_id = $1) AS contracts,
           (SELECT COUNT(*)::int FROM fp360_hr_events WHERE tenant_id = $1) AS hr_events,
           (SELECT COUNT(*)::int FROM fp360_payroll_policies WHERE tenant_id = $1) AS payroll_policies,
           (SELECT COUNT(*)::int FROM fp360_payroll_runs WHERE tenant_id = $1) AS payroll_runs,
           (SELECT COUNT(*)::int FROM fp360_payroll_events WHERE tenant_id = $1) AS payroll_events,
           (SELECT COUNT(*)::int FROM fp360_social_security_workers WHERE tenant_id = $1) AS social_workers,
           (SELECT COUNT(*)::int FROM fp360_social_security_movements WHERE tenant_id = $1) AS movements,
           (SELECT COUNT(*)::int FROM fp360_social_security_settlements WHERE tenant_id = $1) AS settlements,
           (SELECT COUNT(*)::int FROM fp360_social_security_events WHERE tenant_id = $1) AS social_events`,
        [tenantId, userId],
      )).rows[0];
      assert.deepEqual(remainingRecords, {
        organizations: 0,
        sessions: 0,
        memberships: 0,
        users: 0,
        vacancies: 0,
        candidates: 0,
        employees: 0,
        contracts: 0,
        hr_events: 0,
        payroll_policies: 0,
        payroll_runs: 0,
        payroll_events: 0,
        social_workers: 0,
        movements: 0,
        settlements: 0,
        social_events: 0,
      }, "the integration test must remove every temporary row it created");
    } finally {
      client.release();
      await pool.end();
    }
  }
});

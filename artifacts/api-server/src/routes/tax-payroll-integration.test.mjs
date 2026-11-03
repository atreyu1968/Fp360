import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import test from "node:test";
import pg from "pg";

test("AEAT drafts use the latest payrolls and concurrent imports create only one draft", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "Never run this test in production");
  assert.ok(process.env.DATABASE_URL, "A development/test DATABASE_URL is required");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tenantId = `tax-payroll-test-${randomUUID()}`;
  const companyId = randomUUID();
  const secondCompanyId = randomUUID();
  const userId = randomUUID();
  const secondUserId = randomUUID();
  const membershipId = randomUUID();
  const secondMembershipId = randomUUID();
  const policyId = randomUUID();
  const secondPolicyId = randomUUID();
  const payrollRunIds = [randomUUID(), randomUUID(), randomUUID()];
  const secondPayrollRunId = randomUUID();
  const failureTriggerSuffix = randomUUID().replaceAll("-", "");
  const failureTriggerName = `tax_rectification_fail_${failureTriggerSuffix}`;
  const failureFunctionName = `${failureTriggerName}_fn`;
  const failureAuditTriggerName = `tax_rectification_audit_fail_${failureTriggerSuffix}`;
  const failureAuditFunctionName = `${failureAuditTriggerName}_fn`;
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const passwordHash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 134217728,
  }).toString("base64url")}`;
  const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:8080/api";
  let cookie;

  async function request(path, method = "GET", data, requestCookie = cookie) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(requestCookie ? { Cookie: requestCookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const responseText = await response.text();
    let body = null;
    if (responseText) {
      try {
        body = JSON.parse(responseText);
      } catch {
        body = responseText;
      }
    }
    return { status: response.status, body,
      cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }

  t.after(async () => {
    await pool.query(`DROP TRIGGER IF EXISTS ${failureTriggerName} ON fp360_tax_declarations`);
    await pool.query(`DROP FUNCTION IF EXISTS public.${failureFunctionName}()`);
    await pool.query(`DROP TRIGGER IF EXISTS ${failureAuditTriggerName} ON fp360_tax_events`);
    await pool.query(`DROP FUNCTION IF EXISTS public.${failureAuditFunctionName}()`);
    await pool.query("DELETE FROM fp360_tax_events WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_tax_declarations WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_tax_profiles WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_payroll_events WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_payroll_runs WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_payroll_policies WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_auth_audit WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_auth_sessions WHERE user_id = ANY($1::text[])", [[userId, secondUserId]]);
    await pool.query("DELETE FROM fp360_auth_memberships WHERE user_id = ANY($1::text[])", [[userId, secondUserId]]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id = ANY($1::text[])", [[userId, secondUserId]]);
    await pool.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    await pool.end();
  });

  const sourceColumn = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='fp360_tax_declarations' AND column_name='source_payroll_run_ids'",
  );
  if (sourceColumn.rowCount === 0) {
    t.skip("The new development schema is applied after the task merges; run this integration test after that migration.");
    return;
  }

  for (const [id, name] of [[companyId, "AEAT payroll test"], [secondCompanyId, "Second AEAT payroll test"]]) {
    await pool.query(
      "INSERT INTO fp360_organizations (id,tenant_id,name,center,island,role,is_active) VALUES ($1,$2,$3,'Training centre','Gran Canaria','buyer',true)",
      [id, tenantId, name],
    );
  }
  for (const [id, name] of [[userId, "AEAT payroll test user"], [secondUserId, "Second AEAT payroll test user"]]) {
    await pool.query(
      "INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,$3,$4)",
      [id, `${id}@example.test`, name, passwordHash],
    );
  }
  for (const [membership, user, organization] of [
    [membershipId, userId, companyId],
    [secondMembershipId, secondUserId, secondCompanyId],
  ]) {
    await pool.query(
      "INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,organization_id,role) VALUES ($1,$2,$3,$4,'teacher')",
      [membership, user, tenantId, organization],
    );
  }
  await pool.query(
    `INSERT INTO fp360_payroll_policies
      (id,tenant_id,organization_id,version,worker_social_security_bps,employer_social_security_bps,
       income_withholding_bps,status,operation_id,request_fingerprint,created_by_user_id,created_by_name)
     VALUES ($1,$2,$3,1,0,0,0,'active',$4,'test-fingerprint',$5,'Test teacher')`,
    [policyId, tenantId, companyId, randomUUID(), userId],
  );
  await pool.query(
    `INSERT INTO fp360_payroll_policies
      (id,tenant_id,organization_id,version,worker_social_security_bps,employer_social_security_bps,
       income_withholding_bps,status,operation_id,request_fingerprint,created_by_user_id,created_by_name)
     VALUES ($1,$2,$3,1,0,0,0,'active',$4,'second-company-test-fingerprint',$5,'Second test teacher')`,
    [secondPolicyId, tenantId, secondCompanyId, randomUUID(), secondUserId],
  );
  const payrollLines = [
    [
      { employeeId: "worker-a", workerRef: "EMP-A", grossCents: 100000, withholdingCents: 10000 },
      { employeeId: "worker-b", workerRef: "EMP-B", grossCents: 50000, withholdingCents: 5000 },
    ],
    [{ employeeId: "worker-a", workerRef: "EMP-A", grossCents: 100000, withholdingCents: 10000 }],
    [{ employeeId: "worker-c", workerRef: "EMP-C", grossCents: 999900, withholdingCents: 99990 }],
  ];
  for (const [index, periodKey] of ["2027-07", "2027-08", "2027-09"].entries()) {
    const lines = payrollLines[index];
    await pool.query(
      `INSERT INTO fp360_payroll_runs
        (id,tenant_id,organization_id,period_key,version,policy_id,receipt_lines,employee_count,
         gross_total_cents,net_total_cents,employer_cost_total_cents,status,operation_id,
         request_fingerprint,created_by_user_id,created_by_name,reviewed_by_name)
       VALUES ($1,$2,$3,$4,1,$5,$6::jsonb,$7,$8,$8,$8,'closed',$9,'test-fingerprint',$10,'Test teacher','Test teacher')`,
      [payrollRunIds[index], tenantId, companyId, periodKey, policyId, JSON.stringify(lines),
        lines.length, lines.reduce((sum, line) => sum + line.grossCents, 0), randomUUID(), userId],
    );
  }
  const secondCompanyPayrollLines = [
    { employeeId: "second-company-worker", workerRef: "EMP-C", grossCents: 80000, withholdingCents: 8000 },
  ];
  await pool.query(
    `INSERT INTO fp360_payroll_runs
      (id,tenant_id,organization_id,period_key,version,policy_id,receipt_lines,employee_count,
       gross_total_cents,net_total_cents,employer_cost_total_cents,status,operation_id,
       request_fingerprint,created_by_user_id,created_by_name,reviewed_by_name)
     VALUES ($1,$2,$3,'2027-09',1,$4,$5::jsonb,1,80000,80000,80000,'closed',$6,
       'second-company-test-fingerprint',$7,'Second test teacher','Second test teacher')`,
    [secondPayrollRunId, tenantId, secondCompanyId, secondPolicyId,
      JSON.stringify(secondCompanyPayrollLines), randomUUID(), secondUserId],
  );

  const login = await request("/auth/login", "POST", {
    email: `${userId}@example.test`, password,
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  cookie = login.cookie;
  assert.ok(cookie, "Login should return the session cookie");

  const profile = await request("/redfp360/tax/profile", "PUT", {
    organizationId: companyId, entityType: "sociedad", igicRegime: "general",
    incomeTaxMethod: "not_applicable", hasEmployees: true,
    withholdsProfessionals: false, paysBusinessRent: false, operationId: randomUUID(),
  });
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  const secondLogin = await request("/auth/login", "POST", {
    email: `${secondUserId}@example.test`, password,
  }, null);
  assert.equal(secondLogin.status, 200, JSON.stringify(secondLogin.body));
  const secondCookie = secondLogin.cookie;
  assert.ok(secondCookie, "Second company login should return its own session cookie");
  const secondProfile = await request("/redfp360/tax/profile", "PUT", {
    organizationId: secondCompanyId, entityType: "sociedad", igicRegime: "general",
    incomeTaxMethod: "not_applicable", hasEmployees: true,
    withholdsProfessionals: false, paysBusinessRent: false, operationId: randomUUID(),
  }, secondCookie);
  assert.equal(secondProfile.status, 200, JSON.stringify(secondProfile.body));
  assert.equal(secondProfile.body.organizationId, secondCompanyId);

  const overview = await request(`/redfp360/tax/overview?organizationId=${companyId}`);
  assert.equal(overview.status, 200, JSON.stringify(overview.body));
  assert.deepEqual(overview.body.payrollSources.map((source) => source.id).sort(), [...payrollRunIds].sort());
  assert.ok(overview.body.modelCatalog.some((model) => model.modelCode === "111" && model.agency === "aeat"));
  assert.ok(overview.body.modelCatalog.some((model) => model.modelCode === "190" && model.agency === "aeat"));

  const quarterlyBaseInput = {
    organizationId: companyId, taxType: "withholding", modelCode: "111",
    periodKey: "2027-Q3", sourcePayrollRunIds: payrollRunIds,
  };
  const concurrentInputs = [
    { ...quarterlyBaseInput, operationId: randomUUID() },
    { ...quarterlyBaseInput, operationId: randomUUID() },
  ];
  const concurrentResults = await Promise.all(concurrentInputs.map((input) =>
    request("/redfp360/tax/declarations", "POST", input)));
  assert.deepEqual(concurrentResults.map((result) => result.status).sort(), [201, 409]);
  const quarterly = concurrentResults.find((result) => result.status === 201);
  assert.ok(quarterly, "Exactly one simultaneous import should create the draft");
  assert.equal(quarterly.status, 201, JSON.stringify(quarterly.body));
  const validatedForFailedRectification = await request(`/redfp360/tax/declarations/${quarterly.body.id}/action`, "POST", {
    action: "validate",
    operationId: randomUUID(),
  });
  assert.equal(validatedForFailedRectification.status, 200, JSON.stringify(validatedForFailedRectification.body));
  const presentedForFailedRectification = await request(`/redfp360/tax/declarations/${quarterly.body.id}/action`, "POST", {
    action: "present",
    operationId: randomUUID(),
  });
  assert.equal(presentedForFailedRectification.status, 200, JSON.stringify(presentedForFailedRectification.body));

  const originalBeforeFailedRectification = await pool.query(
    `SELECT *
     FROM fp360_tax_declarations WHERE id = $1 AND tenant_id = $2`,
    [quarterly.body.id, tenantId],
  );
  assert.equal(originalBeforeFailedRectification.rowCount, 1);
  const failedOperationId = randomUUID();
  await pool.query(
    `CREATE FUNCTION public.${failureFunctionName}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.supersedes_id::text = TG_ARGV[0] THEN
         RAISE EXCEPTION 'controlled rectification insert failure';
       END IF;
       RETURN NEW;
     END;
     $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${failureTriggerName}
     BEFORE INSERT ON fp360_tax_declarations
     FOR EACH ROW EXECUTE FUNCTION public.${failureFunctionName}('${quarterly.body.id}')`,
  );
  const failedRectification = await request(`/redfp360/tax/declarations/${quarterly.body.id}/action`, "POST", {
    action: "rectify",
    operationId: failedOperationId,
  });
  assert.equal(failedRectification.status, 500, JSON.stringify(failedRectification.body));

  const originalAfterFailedRectification = await pool.query(
    `SELECT *
     FROM fp360_tax_declarations WHERE id = $1 AND tenant_id = $2`,
    [quarterly.body.id, tenantId],
  );
  assert.deepEqual(
    originalAfterFailedRectification.rows[0],
    originalBeforeFailedRectification.rows[0],
    "A failed rectification must leave the original declaration unchanged",
  );
  const failedVersionCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_tax_declarations
     WHERE tenant_id = $1 AND supersedes_id = $2`,
    [tenantId, quarterly.body.id],
  );
  assert.equal(failedVersionCount.rows[0].count, 0, "A failed rectification must not leave a partial version");
  const failedEventCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_tax_events
     WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, failedOperationId],
  );
  assert.equal(failedEventCount.rows[0].count, 0, "A failed rectification must not leave an incomplete event");

  await pool.query(`DROP TRIGGER ${failureTriggerName} ON fp360_tax_declarations`);
  await pool.query(`DROP FUNCTION public.${failureFunctionName}()`);

  const failedAuditOperationId = randomUUID();
  await pool.query(
    `CREATE FUNCTION public.${failureAuditFunctionName}() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       IF NEW.operation_id::text = TG_ARGV[0]
          AND NEW.event_type = 'rectification_created' THEN
         RAISE EXCEPTION 'controlled rectification audit failure';
       END IF;
       RETURN NEW;
     END;
     $$`,
  );
  await pool.query(
    `CREATE TRIGGER ${failureAuditTriggerName}
     BEFORE INSERT ON fp360_tax_events
     FOR EACH ROW EXECUTE FUNCTION public.${failureAuditFunctionName}('${failedAuditOperationId}')`,
  );
  const failedAuditRectification = await request(`/redfp360/tax/declarations/${quarterly.body.id}/action`, "POST", {
    action: "rectify",
    operationId: failedAuditOperationId,
  });
  assert.equal(failedAuditRectification.status, 500, JSON.stringify(failedAuditRectification.body));

  const originalAfterFailedAudit = await pool.query(
    `SELECT *
     FROM fp360_tax_declarations WHERE id = $1 AND tenant_id = $2`,
    [quarterly.body.id, tenantId],
  );
  assert.deepEqual(
    originalAfterFailedAudit.rows[0],
    originalBeforeFailedRectification.rows[0],
    "A failed rectification audit insert must roll back all changes to the original declaration",
  );
  const failedAuditVersionCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_tax_declarations
     WHERE tenant_id = $1 AND supersedes_id = $2`,
    [tenantId, quarterly.body.id],
  );
  assert.equal(failedAuditVersionCount.rows[0].count, 0,
    "A failed rectification audit insert must not leave a partial version");
  const failedAuditEventCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_tax_events
     WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, failedAuditOperationId],
  );
  assert.equal(failedAuditEventCount.rows[0].count, 0,
    "A failed rectification audit insert must not leave a partial event");

  await pool.query(`DROP TRIGGER ${failureAuditTriggerName} ON fp360_tax_events`);
  await pool.query(`DROP FUNCTION public.${failureAuditFunctionName}()`);

  assert.equal(quarterly.body.status, "draft");
  assert.equal(quarterly.body.withholdingBaseCents, 1249900);
  assert.equal(quarterly.body.withholdingCents, 124990);
  assert.equal(quarterly.body.resultCents, 124990);
  assert.equal(quarterly.body.formData.recipientCount, "3");
  assert.equal(quarterly.body.formData.withholdingBaseEuros, "12499.00");
  assert.deepEqual(quarterly.body.sourcePayrollRunIds.sort(), [...payrollRunIds].sort());

  const declarationCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_tax_declarations
     WHERE tenant_id = $1 AND organization_id = $2 AND tax_type = 'withholding'
       AND model_code = '111' AND period_key = '2027-Q3'`,
    [tenantId, companyId],
  );
  assert.equal(declarationCount.rows[0].count, 1, "Only one declaration should be stored for the model and period");
  const creationEventCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_tax_events
     WHERE tenant_id = $1 AND organization_id = $2 AND declaration_id = $3
       AND event_type = 'draft_created'`,
    [tenantId, companyId, quarterly.body.id],
  );
  assert.equal(creationEventCount.rows[0].count, 1, "The draft should have exactly one creation audit event");

  const winningInput = concurrentInputs[concurrentResults.indexOf(quarterly)];
  const replay = await request("/redfp360/tax/declarations", "POST", winningInput);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.id, quarterly.body.id);
  const duplicate = await request("/redfp360/tax/declarations", "POST", {
    ...quarterlyBaseInput, operationId: randomUUID(),
  });
  assert.equal(duplicate.status, 409);

  const secondCompanyDraft = await request("/redfp360/tax/declarations", "POST", {
    organizationId: secondCompanyId, taxType: "withholding", modelCode: "111",
    periodKey: "2027-Q3", sourcePayrollRunIds: [secondPayrollRunId], operationId: randomUUID(),
  }, secondCookie);
  assert.equal(secondCompanyDraft.status, 201, JSON.stringify(secondCompanyDraft.body));
  assert.equal(secondCompanyDraft.body.status, "draft");
  assert.equal(secondCompanyDraft.body.organizationId, secondCompanyId);
  assert.deepEqual(secondCompanyDraft.body.sourcePayrollRunIds, [secondPayrollRunId]);
  assert.equal(secondCompanyDraft.body.withholdingBaseCents, 80000);
  assert.equal(secondCompanyDraft.body.withholdingCents, 8000);
  assert.notEqual(secondCompanyDraft.body.id, quarterly.body.id);

  async function readDeclarationAndAudit() {
    const declaration = await pool.query(
      `SELECT to_jsonb(d) AS record FROM fp360_tax_declarations d
       WHERE tenant_id = $1 AND organization_id = $2 AND id = $3`,
      [tenantId, companyId, quarterly.body.id],
    );
    const events = await pool.query(
      `SELECT to_jsonb(e) AS record FROM fp360_tax_events e
       WHERE tenant_id = $1 AND organization_id = $2 AND declaration_id = $3
       ORDER BY id`,
      [tenantId, companyId, quarterly.body.id],
    );
    return { declaration: declaration.rows[0]?.record, events: events.rows.map((row) => row.record) };
  }

  const protectedDraftBefore = await readDeclarationAndAudit();
  for (const action of ["recalculate", "validate"]) {
    const deniedAction = await request(
      `/redfp360/tax/declarations/${quarterly.body.id}/action`,
      "POST",
      { action, operationId: randomUUID() },
      secondCookie,
    );
    assert.equal(deniedAction.status, 403, `${action} from another company must be denied`);
    assert.match(deniedAction.body.error, /No tienes acceso a este expediente/);
    assert.deepEqual(
      await readDeclarationAndAudit(),
      protectedDraftBefore,
      `${action} from another company must not change the draft or its audit`,
    );
  }

  const companyOverview = await request(`/redfp360/tax/overview?organizationId=${companyId}`);
  const secondCompanyOverview = await request(
    `/redfp360/tax/overview?organizationId=${secondCompanyId}`, "GET", undefined, secondCookie,
  );
  assert.equal(companyOverview.status, 200);
  assert.equal(secondCompanyOverview.status, 200);
  assert.deepEqual(companyOverview.body.declarations.map((declaration) => declaration.id), [quarterly.body.id]);
  assert.deepEqual(secondCompanyOverview.body.declarations.map((declaration) => declaration.id), [secondCompanyDraft.body.id]);
  assert.equal((await request(`/redfp360/tax/overview?organizationId=${secondCompanyId}`)).status, 403);
  assert.equal((await request(`/redfp360/tax/overview?organizationId=${companyId}`, "GET", undefined, secondCookie)).status, 403);

  const sameModelAndPeriodCount = await pool.query(
    `SELECT organization_id, COUNT(*)::int AS count
     FROM fp360_tax_declarations
     WHERE tenant_id = $1 AND tax_type = 'withholding' AND model_code = '111' AND period_key = '2027-Q3'
     GROUP BY organization_id`,
    [tenantId],
  );
  assert.deepEqual(
    Object.fromEntries(sameModelAndPeriodCount.rows.map((row) => [row.organization_id, row.count])),
    { [companyId]: 1, [secondCompanyId]: 1 },
    "Each company should keep exactly its own draft for the same model and period",
  );

  const annual = await request("/redfp360/tax/declarations", "POST", {
    organizationId: companyId, taxType: "withholding", modelCode: "190",
    periodKey: "2027", sourcePayrollRunIds: payrollRunIds.slice(0, 2), operationId: randomUUID(),
  });
  assert.equal(annual.status, 201, JSON.stringify(annual.body));
  assert.equal(annual.body.status, "draft");
  assert.equal(annual.body.withholdingBaseCents, 250000);
  assert.equal(annual.body.withholdingCents, 25000);
  assert.equal(annual.body.resultCents, 0, "The annual informative summary does not create a payment result.");
  assert.equal(annual.body.formData.annualBaseEuros, "2500.00");
  assert.equal(annual.body.formData.annualWithholdingEuros, "250.00");
  assert.equal(annual.body.formData.payrollCoverage, "partial");
  assert.equal(annual.body.formData.payrollIncludedMonths, "julio, agosto");
  assert.equal(annual.body.formData.payrollMissingMonths, "enero, febrero, marzo, abril, mayo, junio, septiembre, octubre, noviembre, diciembre");
  assert.deepEqual(annual.body.sourcePayrollRunIds.sort(), payrollRunIds.slice(0, 2).sort());
  assert.match(annual.body.formData.recipientSummary, /EMP-A: base 2000\.00 € · retención 200\.00 €/);
  assert.match(annual.body.formData.recipientSummary, /EMP-B: base 500\.00 € · retención 50\.00 €/);
  assert.doesNotMatch(annual.body.formData.recipientSummary, /EMP-C/);

  const rectificationDraft = await request("/redfp360/tax/declarations", "POST", {
    organizationId: companyId,
    taxType: "withholding",
    modelCode: "115",
    periodKey: "2027-Q4",
    formData: {
      leasedPropertiesCount: "1",
      withholdingBaseEuros: "1000.00",
      withholdingEuros: "190.00",
    },
    operationId: randomUUID(),
  });
  assert.equal(rectificationDraft.status, 201, JSON.stringify(rectificationDraft.body));
  assert.equal(rectificationDraft.body.status, "draft");
  const originalValues = {
    version: rectificationDraft.body.version,
    formData: rectificationDraft.body.formData,
    withholdingBaseCents: rectificationDraft.body.withholdingBaseCents,
    withholdingCents: rectificationDraft.body.withholdingCents,
    resultCents: rectificationDraft.body.resultCents,
  };

  const validated = await request(`/redfp360/tax/declarations/${rectificationDraft.body.id}/action`, "POST", {
    action: "validate",
    operationId: randomUUID(),
  });
  assert.equal(validated.status, 200, JSON.stringify(validated.body));
  assert.equal(validated.body.status, "validated");

  const presented = await request(`/redfp360/tax/declarations/${rectificationDraft.body.id}/action`, "POST", {
    action: "present",
    operationId: randomUUID(),
  });
  assert.equal(presented.status, 200, JSON.stringify(presented.body));
  assert.equal(presented.body.status, "presented");
  assert.ok(presented.body.receiptReference);

  const rectified = await request(`/redfp360/tax/declarations/${rectificationDraft.body.id}/action`, "POST", {
    action: "rectify",
    operationId: randomUUID(),
  });
  assert.equal(rectified.status, 200, JSON.stringify(rectified.body));
  assert.equal(rectified.body.status, "draft");
  assert.equal(rectified.body.version, originalValues.version + 1);
  assert.equal(rectified.body.supersedesId, rectificationDraft.body.id);
  assert.deepEqual(rectified.body.formData, originalValues.formData);

  const history = await request(`/redfp360/tax/overview?organizationId=${companyId}`);
  assert.equal(history.status, 200, JSON.stringify(history.body));
  const preservedOriginal = history.body.declarations.find((item) => item.id === rectificationDraft.body.id);
  const savedRectification = history.body.declarations.find((item) => item.id === rectified.body.id);
  assert.ok(preservedOriginal, "The original declaration should remain available in the declaration history");
  assert.equal(preservedOriginal.status, "rectified");
  assert.equal(preservedOriginal.version, originalValues.version);
  assert.deepEqual(preservedOriginal.formData, originalValues.formData);
  assert.equal(preservedOriginal.withholdingBaseCents, originalValues.withholdingBaseCents);
  assert.equal(preservedOriginal.withholdingCents, originalValues.withholdingCents);
  assert.equal(preservedOriginal.resultCents, originalValues.resultCents);
  assert.equal(preservedOriginal.receiptReference, presented.body.receiptReference);
  assert.ok(savedRectification, "The new declaration should appear alongside the original");
  assert.equal(savedRectification.supersedesId, preservedOriginal.id);
  assert.equal(savedRectification.version, preservedOriginal.version + 1);

  const rectificationEvents = await pool.query(
    `SELECT declaration_id, event_type FROM fp360_tax_events
     WHERE tenant_id = $1 AND organization_id = $2 AND declaration_id = ANY($3::text[])`,
    [tenantId, companyId, [preservedOriginal.id, savedRectification.id]],
  );
  assert.ok(rectificationEvents.rows.some((event) =>
    event.declaration_id === preservedOriginal.id && event.event_type === "draft_created"),
  "Creating the original draft should be recorded");
  assert.ok(rectificationEvents.rows.some((event) =>
    event.declaration_id === savedRectification.id && event.event_type === "rectification_created"),
  "Creating the rectified version should be recorded");
});

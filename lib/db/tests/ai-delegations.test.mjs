import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import pg from "pg";

// Integration test: run the managed API workflow first. All records belong to
// disposable tenants; the fake local model never calls an external provider.
test("delegated company isolation, idempotency, evidence and in-flight revocation", { timeout: 120000 }, async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prefix = `ai-test-${randomUUID()}`;
  const tenant = `${prefix}-network`;
  const foreign = `${prefix}-foreign`;
  const company = `${prefix}-company`;
  const peer = `${prefix}-peer`;
  const foreignCompany = `${prefix}-foreign-company`;
  const admin = `${prefix}-admin`;
  const teacher = `${prefix}-teacher`;
  const campaign = `${prefix}-campaign`;
  const event = `${prefix}-event`;
  const peerEvent = `${prefix}-peer-event`;
  const dossier = `${prefix}-dossier`;
  const evidence = `${prefix}-evidence`;
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const passwordHash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 134217728,
  }).toString("base64url")}`;
  let actions = [];
  let contexts = [];
  let heldResponse;
  let entered;
  let shouldHold = false;
  const model = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw);
    contexts.push(JSON.parse(input.messages[1].content));
    const respond = () => {
      if (res.writableEnded || res.destroyed) return;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ actions }) } }] }));
    };
    if (shouldHold) { heldResponse = respond; entered?.(); }
    else respond();
  });
  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${model.address().port}/v1`;
  const ip = `10.${Array.from(randomBytes(3), n => n || 1).join(".")}`;
  async function request(path, cookie, data, method = data ? "POST" : "GET") {
    const response = await fetch(`http://localhost:80/api${path}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json", "X-Forwarded-For": ip },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  const root = "/admin/ai-coordinator/delegations";
  let cookie;
  let revision = 0;
  async function delegate(enabled, allowedOperations = ["create_simulated_document", "complete_simulation_event"]) {
    const result = await request(`${root}/${company}`, cookie, {
      operationId: randomUUID(), expectedRevision: revision, enabled, allowedOperations,
    }, "PUT");
    assert.equal(result.status, 200, JSON.stringify(result.body));
    revision = result.body.revision;
    return result.body;
  }
  async function countDocuments(org = company) {
    return Number((await pool.query("SELECT count(*) FROM fp360_documents WHERE tenant_id=$1 AND organization_id=$2 AND origin_app='ai_delegation'", [tenant, org])).rows[0].count);
  }
  const note = { operation: "create_simulated_document", title: "Revisión didáctica de actividad", description: "Nota simulada de seguimiento; no acredita pagos ni trámites reales." };
  try {
    for (const [id, network] of [[company, tenant], [peer, tenant], [foreignCompany, foreign]]) {
      await pool.query("INSERT INTO fp360_organizations (id,tenant_id,name,center,island,role) VALUES ($1,$2,'Empresa ficticia','Centro ficticio','Tenerife','buyer')", [id, network]);
    }
    for (const [id, role] of [[admin, "administrator"], [teacher, "teacher"]]) {
      await pool.query("INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,'Persona ficticia de prueba',$3)", [id, `${id}@example.test`, passwordHash]);
      await pool.query("INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,role) VALUES ($1,$2,$3,$4)", [randomUUID(), id, tenant, role]);
    }
    const login = await request("/auth/login", null, { email: `${admin}@example.test`, password });
    assert.equal(login.status, 200);
    cookie = login.cookie;
    await pool.query("UPDATE fp360_auth_users SET mfa_enabled_at=now(),mfa_secret_encrypted='development-test-only' WHERE id=$1", [admin]);
    await pool.query("UPDATE fp360_auth_sessions SET mfa_verified_at=now() WHERE user_id=$1", [admin]);
    const teacherLogin = await request("/auth/login", null, { email: `${teacher}@example.test`, password });
    assert.equal(teacherLogin.status, 200);
    assert.equal((await request(root)).status, 401);
    assert.equal((await request(root, teacherLogin.cookie)).status, 403);

    await pool.query("INSERT INTO fp360_admin_ai_coordinator_settings (id,tenant_id,base_url,model,enabled,created_by_user_id,updated_by_user_id) VALUES ($1,$2,$3,'fake-local',true,$4,$4)",
      [randomUUID(), tenant, baseUrl, admin]);
    await pool.query(`INSERT INTO fp360_simulation_campaigns
      (id,tenant_id,owner_organization_id,title,mode,duration_weeks,difficulty,status,start_date,end_date,participant_organization_ids,operation_id,created_by_user_id)
      VALUES ($1,$2,$3,'Campaña ficticia','supervised',4,'basic','active','2027-09-01','2027-09-30',$4,$5,$6)`,
    [campaign, tenant, company, JSON.stringify([company, peer]), randomUUID(), admin]);
    for (const [id, org] of [[event, company], [peerEvent, peer]]) {
      await pool.query(`INSERT INTO fp360_simulation_events
        (id,tenant_id,campaign_id,organization_id,title,event_type,status,description,required_document_type,simulated_date,operation_id,created_by_user_id)
        VALUES ($1,$2,$3,$4,'Actividad ficticia','other','published','Actividad educativa de prueba','nota_didactica','2027-09-10',$5,$6)`,
      [id, tenant, campaign, org, randomUUID(), admin]);
    }
    await pool.query(`INSERT INTO fp360_simulation_audit_events (id,tenant_id,campaign_id,organization_id,event_id,action,actor_user_id,operation_id)
      VALUES ($1,$2,$3,$4,$5,'event:published',$6,$7)`, [randomUUID(), tenant, campaign, peer, peerEvent, admin, randomUUID()]);
    await pool.query(`INSERT INTO fp360_document_dossiers
      (id,tenant_id,organization_id,dossier_ref,title,dossier_type,department,period,created_by_user_id,created_by_name,operation_id,request_fingerprint)
      VALUES ($1,$2,$3,'TEST','Expediente ficticio','general','direccion','2027-09',$4,'Persona ficticia',$5,'test')`,
    [dossier, tenant, company, admin, randomUUID()]);
    await pool.query(`INSERT INTO fp360_documents
      (id,tenant_id,organization_id,dossier_id,document_ref,document_type,title,department,period,document_date,status,owner_user_id,owner_name,operation_id,request_fingerprint)
      VALUES ($1,$2,$3,$4,'EVIDENCE','nota_didactica','Evidencia ficticia','direccion','2027-09','2027-09-10','confirmed',$5,'Persona ficticia',$6,'evidence')`,
    [evidence, tenant, company, dossier, admin, randomUUID()]);

    // Neither campaign mode nor a model response grants write authority.
    assert.equal((await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() })).status, 409);
    assert.equal((await request(`${root}/${foreignCompany}`, cookie, {
      operationId: randomUUID(), expectedRevision: 0, enabled: true, allowedOperations: ["create_simulated_document"],
    }, "PUT")).status, 404);
    const saved = await delegate(true);
    assert.ok(saved.serviceActorId.startsWith("ai-service:"));
    assert.equal((await request(`${root}/${peer}/run`, cookie, { operationId: randomUUID() })).status, 409);
    assert.equal((await request(`${root}/${company}`, cookie, {
      operationId: randomUUID(), expectedRevision: 0, enabled: true, allowedOperations: ["create_simulated_document"],
    }, "PUT")).status, 409, "stale grant must not overwrite a new revision");

    actions = [note];
    const op = randomUUID();
    const first = await request(`${root}/${company}/run`, cookie, { operationId: op });
    assert.equal(first.body.status, "applied", JSON.stringify(first));
    assert.equal(await countDocuments(), 1);
    assert.equal(await countDocuments(peer), 0);
    const context = contexts.at(-1);
    assert.equal(context.networkSnapshotAndCompleteOperationHistory.companyCount, 2);
    assert.ok(context.networkSnapshotAndCompleteOperationHistory.operationHistory.some(o => o.organizationId === peer));
    assert.ok(!JSON.stringify(context).includes(foreignCompany));
    assert.ok(!JSON.stringify(context).includes("@example.test"));
    const replay = await request(`${root}/${company}/run`, cookie, { operationId: op });
    assert.equal(replay.body.id, first.body.id);
    assert.equal(contexts.length, 1, "replay must not call the model again");
    await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() });
    assert.equal(await countDocuments(), 1, "identical notes are not duplicated across cycles");

    // A malicious model cannot redirect writes to another company or endpoint.
    actions = [{ ...note, organizationId: peer }];
    assert.equal((await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() })).body.status, "failed");
    actions = [{ ...note, operation: "real_bank_transfer" }];
    assert.equal((await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() })).body.status, "failed");
    actions = [{ ...note, operation: "complete_simulation_event", eventId: peerEvent, documentId: evidence }];
    assert.equal((await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() })).body.status, "failed");
    assert.equal((await pool.query("SELECT status FROM fp360_simulation_events WHERE id=$1", [peerEvent])).rows[0].status, "published");

    await delegate(true, ["create_simulated_document"]);
    actions = [{ ...note, operation: "complete_simulation_event", eventId: event, documentId: evidence }];
    assert.equal((await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() })).body.status, "failed");
    await delegate(true);
    assert.equal((await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() })).body.status, "applied");
    const completed = (await pool.query("SELECT * FROM fp360_simulation_events WHERE id=$1", [event])).rows[0];
    assert.equal(completed.status, "completed");
    assert.equal(completed.completed_by_user_id, saved.serviceActorId);
    assert.equal(completed.evidence_document_id, evidence);

    actions = [{ ...note, title: "No debe registrarse tras revocar" }];
    shouldHold = true;
    const modelEntered = new Promise(resolve => { entered = resolve; });
    const pending = request(`${root}/${company}/run`, cookie, { operationId: randomUUID() });
    await modelEntered;
    const overlap = await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() });
    assert.equal(overlap.status, 409, "only one cycle may be in flight per company");
    await delegate(false);
    // Re-granting must not resurrect a response authorized under the old revision.
    await delegate(true);
    heldResponse();
    assert.equal((await pending).body.status, "cancelled");
    assert.equal(await countDocuments(), 1);
    await delegate(false);
    assert.equal((await request(`${root}/${company}/run`, cookie, { operationId: randomUUID() })).status, 409);
    const overview = await request(root, cookie);
    assert.equal(overview.body.delegations[0].enabled, false);
    assert.ok(overview.body.runs.some(r => r.status === "cancelled"));
    // Verify actual autonomous execution, not only the manual "run now" endpoint.
    shouldHold = false;
    actions = [];
    await delegate(true, ["create_simulated_document"]);
    await pool.query("UPDATE fp360_ai_delegations SET next_run_at=now()-interval '1 second' WHERE tenant_id=$1", [tenant]);
    const deadline = Date.now() + 45000;
    let scheduled = [];
    while (Date.now() < deadline) {
      scheduled = (await pool.query("SELECT * FROM fp360_ai_delegation_runs WHERE tenant_id=$1 AND requested_by=$2 AND status='applied'", [tenant, saved.serviceActorId])).rows;
      if (scheduled.length) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(scheduled.length, 1, "the managed server must autonomously run a due delegation");
    assert.ok(scheduled[0].context_hash && scheduled[0].company_count === 2);
    await delegate(false);
    const audits = await pool.query("SELECT * FROM fp360_auth_audit WHERE tenant_id=$1 AND action='ai.delegation.updated'", [tenant]);
    assert.ok(audits.rows.length >= 5);
    assert.ok(audits.rows.every(r => r.actor_user_id === admin));
    for (const table of ["fp360_bank_events", "fp360_tax_events", "fp360_hr_events", "fp360_payroll_events"]) {
      assert.equal(Number((await pool.query(`SELECT count(*) FROM ${table} WHERE tenant_id=$1`, [tenant])).rows[0].count), 0);
    }
  } finally {
    heldResponse?.();
    model.closeAllConnections();
    await new Promise(resolve => model.close(resolve));
    for (const table of [
      "fp360_ai_delegation_runs", "fp360_ai_delegations", "fp360_simulation_audit_events", "fp360_simulation_events",
      "fp360_simulation_campaigns", "fp360_document_events", "fp360_document_versions", "fp360_documents",
      "fp360_document_dossiers", "fp360_admin_ai_coordinator_settings", "fp360_auth_audit",
    ]) await pool.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1)`, [[tenant, foreign]]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id=ANY($1)", [[admin, teacher]]);
    await pool.query("DELETE FROM fp360_organizations WHERE tenant_id=ANY($1)", [[tenant, foreign]]);
    await pool.end();
  }
});

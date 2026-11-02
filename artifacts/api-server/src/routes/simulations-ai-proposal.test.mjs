import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
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

test("GroqCloud proposal flow anonymizes the network and saves only a valid draft", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const tenantId = `simulation-ai-test-${randomUUID()}`;
  const userId = randomUUID();
  const membershipId = randomUUID();
  const sessionId = randomUUID();
  const sessionToken = randomBytes(32).toString("base64url");
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const companyNameA = `Empresa Ficticia Aurora ${randomUUID()}`;
  const companyNameB = `Empresa Ficticia Brisa ${randomUUID()}`;
  const centerNameA = `Centro Ficticio Cumbre ${randomUUID()}`;
  const centerNameB = `Centro Ficticio Delta ${randomUUID()}`;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), "redfp360-groq-test-"));
  const responseFile = path.join(tempDirectory, "provider-response.json");
  const captureFile = path.join(tempDirectory, "provider-request.json");
  let child;

  try {
    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const serverPath = fileURLToPath(new URL("../../dist/index.mjs", import.meta.url));
    const providerStubPath = fileURLToPath(new URL("./groq-ai-test-provider.mjs", import.meta.url));
    child = spawn(process.execPath, [
      "--import", pathToFileURL(providerStubPath).href,
      serverPath,
    ], {
      cwd: path.dirname(serverPath),
      env: {
        ...process.env,
        PORT: String(port),
        NODE_ENV: "test",
        GROQ_API_KEY: "test-only-groq-key",
        GROQ_TEST_RESPONSE_FILE: responseFile,
        GROQ_TEST_CAPTURE_FILE: captureFile,
      },
      stdio: "ignore",
    });
    await waitForServer(child, baseUrl);

    await client.query(
      `INSERT INTO fp360_auth_users
        (id, email, display_name, password_hash, mfa_enabled_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [userId, `${userId}@example.test`, "Simulated network coordinator", "test-only-password-hash"],
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
        ($1, $3, $4, $6, 'Isla ficticia', 'company', true),
        ($2, $3, $5, $7, 'Isla ficticia', 'company', true)`,
      [
        organizationA,
        organizationB,
        tenantId,
        companyNameA,
        companyNameB,
        centerNameA,
        centerNameB,
      ],
    );
    await client.query(
      `INSERT INTO fp360_admin_ai_coordinator_settings
        (id, tenant_id, provider, base_url, model, enabled, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, 'groqcloud', '', 'openai/gpt-oss-20b', true, $3, $3)`,
      [randomUUID(), tenantId, userId],
    );

    const headers = {
      "content-type": "application/json",
      cookie: `redfp360_session=${sessionToken}`,
      origin: baseUrl,
    };
    const requestBody = (operationId) => ({
      operationId,
      ownerOrganizationId: organizationA,
      participantOrganizationIds: [organizationA, organizationB],
      objective: "Coordinar una operación ficticia de compra, venta y entrega.",
      startDate: "2027-09-20",
      durationWeeks: 2,
      difficulty: "medium",
      eventCount: 2,
    });
    const propose = (body) => fetch(`${baseUrl}/api/redfp360/simulations/ai-proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const savedCampaignCount = async () => Number((await client.query(
      `SELECT COUNT(*)::int AS count FROM fp360_simulation_campaigns WHERE tenant_id = $1`,
      [tenantId],
    )).rows[0].count);
    const savedProposalRecordCounts = async () => (await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM fp360_simulation_campaigns WHERE tenant_id = $1) AS campaigns,
        (SELECT COUNT(*)::int FROM fp360_simulation_events WHERE tenant_id = $1) AS events,
        (SELECT COUNT(*)::int FROM fp360_simulation_audit_events WHERE tenant_id = $1) AS audits`,
      [tenantId],
    )).rows[0];

    await writeFile(responseFile, JSON.stringify({ content: "{" }));
    const invalidJsonResponse = await propose(requestBody(`invalid-json-${randomUUID()}`));
    const invalidJsonBody = await invalidJsonResponse.json();
    assert.equal(invalidJsonResponse.status, 502, JSON.stringify(invalidJsonBody));
    assert.equal(await savedCampaignCount(), 0, "invalid provider JSON must not create a campaign");

    const genericProviderError = "El proveedor de IA no pudo generar una propuesta válida. Comprueba su disponibilidad y el tamaño de contexto.";
    const providerHttpDetail = "upstream-provider-internal-detail";
    await writeFile(responseFile, JSON.stringify({
      status: 503,
      body: { error: { message: providerHttpDetail } },
    }));
    const providerHttpResponse = await propose(requestBody(`provider-http-error-${randomUUID()}`));
    const providerHttpBody = await providerHttpResponse.json();
    assert.equal(providerHttpResponse.status, 502);
    assert.deepEqual(providerHttpBody, { error: genericProviderError });
    assert.equal(JSON.stringify(providerHttpBody).includes(providerHttpDetail), false);
    assert.deepEqual(await savedProposalRecordCounts(), { campaigns: 0, events: 0, audits: 0 },
      "an HTTP error from Groq must not leave campaign, event, or audit records");

    const providerTransportDetail = "upstream-connection-internal-detail";
    await writeFile(responseFile, JSON.stringify({ transportError: providerTransportDetail }));
    const providerTransportResponse = await propose(requestBody(`provider-transport-error-${randomUUID()}`));
    const providerTransportBody = await providerTransportResponse.json();
    assert.equal(providerTransportResponse.status, 502);
    assert.deepEqual(providerTransportBody, { error: genericProviderError });
    assert.equal(JSON.stringify(providerTransportBody).includes(providerTransportDetail), false);
    assert.deepEqual(await savedProposalRecordCounts(), { campaigns: 0, events: 0, audits: 0 },
      "a connection error to Groq must not leave campaign, event, or audit records");

    await writeFile(responseFile, JSON.stringify({ content: JSON.stringify({ title: "Plan incompleto" }) }));
    const incompleteResponse = await propose(requestBody(`incomplete-${randomUUID()}`));
    assert.equal(incompleteResponse.status, 502);
    assert.equal(await savedCampaignCount(), 0, "an incomplete plan must not create a partial campaign");

    await writeFile(responseFile, JSON.stringify({
      delayMs: 200,
      content: JSON.stringify({
        title: "Coordinación de suministro ficticia",
        description: "Propuesta educativa para practicar una operación entre dos empresas.",
        events: [
          {
            organizationId: organizationA,
            title: "Preparar oferta de suministro",
            eventType: "offer",
            description: "La empresa prepara una oferta didáctica para el ejercicio.",
            preconditions: [],
            requiredDocumentType: null,
            simulatedDate: "2027-09-21",
          },
          {
            organizationId: organizationB,
            title: "Confirmar recepción simulada",
            eventType: "other",
            description: "La empresa registra la recepción ficticia del suministro.",
            preconditions: ["La oferta debe estar preparada"],
            requiredDocumentType: null,
            simulatedDate: "2027-09-22",
          },
        ],
      }),
    }));
    const operationId = `valid-draft-${randomUUID()}`;
    const validRequestBody = requestBody(operationId);
    const concurrentResponses = await Promise.all([
      propose(validRequestBody),
      propose(validRequestBody),
    ]);
    assert.deepEqual(concurrentResponses.map((response) => response.status), [201, 201]);
    const concurrentResults = await Promise.all(concurrentResponses.map((response) => response.json()));
    const result = concurrentResults[0];
    assert.equal(concurrentResults[1].campaign.id, result.campaign.id,
      "simultaneous retries must return the same campaign");
    assert.deepEqual(
      concurrentResults[1].events.map((event) => event.id),
      result.events.map((event) => event.id),
      "simultaneous retries must return the same saved events",
    );
    assert.equal(result.campaign.status, "draft");
    assert.equal(result.campaign.mode, "supervised");
    assert.equal(result.approvalRequired, true);
    assert.equal(result.simulationOnly, true);
    assert.equal(result.events.length, 2);
    assert.ok(result.events.every((event) => event.status === "proposed"));

    const captured = JSON.parse(await readFile(captureFile, "utf8"));
    assert.equal(captured.url, "https://api.groq.com/openai/v1/chat/completions");
    assert.equal(captured.authorization, "Bearer test-only-groq-key");
    const externalContext = JSON.stringify(captured.requestBody.messages);
    for (const privateName of [companyNameA, companyNameB, centerNameA, centerNameB]) {
      assert.equal(externalContext.includes(privateName), false, `${privateName} must be anonymized before provider submission`);
    }
    assert.match(externalContext, /Empresa 01/);
    assert.match(externalContext, /Empresa 02/);

    const storedCampaign = await client.query(
      `SELECT status, mode FROM fp360_simulation_campaigns WHERE id = $1 AND tenant_id = $2`,
      [result.campaign.id, tenantId],
    );
    assert.deepEqual(storedCampaign.rows, [{ status: "draft", mode: "supervised" }]);
    const storedEvents = await client.query(
      `SELECT status FROM fp360_simulation_events WHERE campaign_id = $1 AND tenant_id = $2`,
      [result.campaign.id, tenantId],
    );
    assert.equal(storedEvents.rowCount, 2);
    assert.ok(storedEvents.rows.every((event) => event.status === "proposed"));
    assert.equal(await savedCampaignCount(), 1);

    const savedRecordCounts = async () => {
      const counts = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM fp360_simulation_campaigns WHERE tenant_id = $1) AS campaigns,
           (SELECT COUNT(*)::int FROM fp360_simulation_events WHERE tenant_id = $1) AS events,
           (SELECT COUNT(*)::int FROM fp360_simulation_audit_events WHERE tenant_id = $1) AS audits`,
        [tenantId],
      );
      return counts.rows[0];
    };
    const countsBeforeRetry = await savedRecordCounts();
    assert.deepEqual(countsBeforeRetry, { campaigns: 1, events: 2, audits: 4 });

    const replayResponse = await propose(validRequestBody);
    assert.equal(replayResponse.status, 201);
    const replay = await replayResponse.json();
    assert.equal(replay.campaign.id, result.campaign.id);
    assert.deepEqual(
      replay.events.map((event) => event.id),
      result.events.map((event) => event.id),
    );
    assert.deepEqual(await savedRecordCounts(), countsBeforeRetry, "an identical retry must not create campaigns, events, or audit records");

    const conflictingResponse = await propose({
      ...validRequestBody,
      objective: "Proponer un objetivo ficticio diferente para la misma operación.",
    });
    assert.equal(conflictingResponse.status, 409);
    assert.deepEqual(await savedRecordCounts(), countsBeforeRetry, "conflicting reuse must not alter the saved draft");

    const persistedDraft = await client.query(
      `SELECT title, status FROM fp360_simulation_campaigns WHERE id = $1 AND tenant_id = $2`,
      [result.campaign.id, tenantId],
    );
    assert.deepEqual(persistedDraft.rows, [{ title: "Coordinación de suministro ficticia", status: "draft" }]);
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await client.query("DELETE FROM fp360_simulation_audit_events WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_simulation_events WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_simulation_campaigns WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_admin_ai_coordinator_settings WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_auth_sessions WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM fp360_auth_memberships WHERE user_id = $1", [userId]);
    await client.query("DELETE FROM fp360_auth_users WHERE id = $1", [userId]);
    await client.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    client.release();
    await pool.end();
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import pg from "pg";

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

test("companies in different economic calendars cannot coordinate or see each other's simulations", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "Never run this test in production");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tenantId = `organization-calendar-test-${randomUUID()}`;
  const center = `Centro calendario ${randomUUID()}`;
  const supervisor = {
    id: randomUUID(),
    membershipId: randomUUID(),
    sessionId: randomUUID(),
    token: randomBytes(32).toString("base64url"),
  };
  const companies = [
    { key: "ordinary-one", name: "Ordinaria uno", mode: "ordinary", startMonth: 1 },
    { key: "ordinary-two", name: "Ordinaria dos", mode: "ordinary", startMonth: 1 },
    { key: "accelerated", name: "Acelerada", mode: "accelerated", startMonth: 1 },
    { key: "ordinary-fiscal-offset", name: "Ordinaria inicio fiscal distinto", mode: "ordinary", startMonth: 4 },
  ].map((company) => ({
    ...company,
    userId: randomUUID(),
    membershipId: randomUUID(),
    sessionId: randomUUID(),
    token: randomBytes(32).toString("base64url"),
  }));
  let child;

  const saveUserSession = async (user, role, organizationId = null) => {
    const userId = user.id ?? user.userId;
    await pool.query(
      `INSERT INTO fp360_auth_users
        (id, email, display_name, password_hash, mfa_enabled_at)
       VALUES ($1, $2, $3, 'test-only-password-hash', NOW())`,
      [userId, `${userId}@example.test`, "Usuario de calendario ficticio"],
    );
    await pool.query(
      `INSERT INTO fp360_auth_memberships (id, user_id, tenant_id, organization_id, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.membershipId, userId, tenantId, organizationId, role],
    );
    const tokenHash = createHmac("sha256", process.env.SESSION_SECRET)
      .update(user.token)
      .digest("hex");
    await pool.query(
      `INSERT INTO fp360_auth_sessions
        (id, user_id, membership_id, token_hash, expires_at, mfa_verified_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', NOW())`,
      [user.sessionId, userId, user.membershipId, tokenHash],
    );
  };

  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await pool.query("DELETE FROM fp360_simulation_audit_events WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_simulation_events WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_simulation_campaigns WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_activity WHERE tenant_id = $1", [tenantId]);
    const userIds = [supervisor.id, ...companies.map((company) => company.userId)];
    await pool.query("DELETE FROM fp360_auth_sessions WHERE user_id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_auth_memberships WHERE user_id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_organization_scopes WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_centers WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_simulation_networks WHERE tenant_id = $1", [tenantId]);
    await pool.end();
  });

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPath = fileURLToPath(new URL("../../dist/index.mjs", import.meta.url));
  child = spawn(process.execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
    stdio: "ignore",
  });
  await waitForServer(child, baseUrl);
  await saveUserSession(supervisor, "teacher");

  const request = async (token, route, method = "GET", body) => {
    const response = await fetch(`${baseUrl}/api${route}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `redfp360_session=${token}`,
        origin: baseUrl,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsedBody = null;
    if (text) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text.slice(0, 500);
      }
    }
    return { response, body: parsedBody };
  };

  for (const company of companies) {
    const created = await request(supervisor.token, "/redfp360/organizations", "POST", {
      name: `${company.name} ${company.userId.slice(0, 8)}`,
      center,
      island: "Gran Canaria",
      role: "both",
      activity: "commerce",
      simulationCalendarMode: company.mode,
      fiscalYearStartMonth: company.startMonth,
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    company.organizationId = created.body.id;
    company.centerId = created.body.centerId;
    company.simulationNetworkId = created.body.simulationNetworkId;
    assert.equal(created.body.simulationCalendarMode, company.mode);
    assert.equal(created.body.fiscalYearStartMonth, company.startMonth);
    await saveUserSession(company, "student", company.organizationId);
  }

  const [ordinaryOne, ordinaryTwo, accelerated, fiscalOffset] = companies;
  assert.equal(ordinaryOne.centerId, ordinaryTwo.centerId);
  assert.equal(ordinaryOne.centerId, accelerated.centerId);
  assert.equal(ordinaryOne.centerId, fiscalOffset.centerId);
  assert.equal(ordinaryOne.simulationNetworkId, ordinaryTwo.simulationNetworkId);
  assert.notEqual(ordinaryOne.simulationNetworkId, accelerated.simulationNetworkId,
    "ordinary and accelerated calendars must resolve to separate networks");
  assert.notEqual(ordinaryOne.simulationNetworkId, fiscalOffset.simulationNetworkId,
    "ordinary calendars with different fiscal-year starts must resolve to separate networks");

  const createCampaign = async (token, owner, participants, label) => request(
    token,
    "/redfp360/simulations/campaigns",
    "POST",
    {
      ownerOrganizationId: owner.organizationId,
      title: `Operación ${label}`,
      description: "Operación ficticia para comprobar el aislamiento por calendario.",
      mode: "manual",
      durationWeeks: 1,
      difficulty: "low",
      startDate: "2027-09-15",
      endDate: "2027-09-15",
      participantOrganizationIds: participants.map((company) => company.organizationId),
      operationId: `calendar-${label}-${randomUUID()}`,
    },
  );

  const compatibleOperation = await createCampaign(
    supervisor.token,
    ordinaryOne,
    [ordinaryOne, ordinaryTwo],
    "ordinary-shared",
  );
  assert.equal(compatibleOperation.response.status, 201, JSON.stringify(compatibleOperation.body));
  const compatibleCampaignId = compatibleOperation.body.id;

  for (const [otherCompany, label] of [
    [accelerated, "mode-mismatch"],
    [fiscalOffset, "fiscal-start-mismatch"],
  ]) {
    const rejected = await createCampaign(
      supervisor.token,
      ordinaryOne,
      [ordinaryOne, otherCompany],
      label,
    );
    assert.equal(rejected.response.status, 409, `${label}: ${JSON.stringify(rejected.body)}`);
  }

  const visibleCampaignIds = new Map([
    [ordinaryOne.key, [compatibleCampaignId]],
    [ordinaryTwo.key, [compatibleCampaignId]],
  ]);
  for (const company of companies) {
    const ownOperation = await createCampaign(supervisor.token, company, [company], company.key);
    assert.equal(ownOperation.response.status, 201, JSON.stringify(ownOperation.body));
    visibleCampaignIds.set(company.key, [
      ...(visibleCampaignIds.get(company.key) ?? []),
      ownOperation.body.id,
    ]);
  }

  const rejectedOperationCount = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM fp360_simulation_campaigns
      WHERE tenant_id = $1
        AND title IN ('Operación mode-mismatch', 'Operación fiscal-start-mismatch')`,
    [tenantId],
  );
  assert.equal(rejectedOperationCount.rows[0].count, 0,
    "rejected cross-network operations must not leave saved campaigns");

  for (const company of companies) {
    const overview = await request(company.token, "/redfp360/simulations/overview");
    assert.equal(overview.response.status, 200, JSON.stringify(overview.body));
    assert.deepEqual(
      overview.body.organizations.map((item) => item.id),
      [company.organizationId],
      `${company.key} should only query its own organization`,
    );
    assert.deepEqual(
      overview.body.campaigns.map((item) => item.id).sort(),
      visibleCampaignIds.get(company.key).sort(),
      `${company.key} should only query campaigns in its own scope`,
    );
  }
});

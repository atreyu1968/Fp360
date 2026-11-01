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
      // The server is still starting.
    }
    await delay(100);
  }
  throw new Error("API test server did not become ready");
}

test("rejecting an invitation creates no access and allows a new invitation", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const tenantId = `invitation-rejection-test-${randomUUID()}`;
  const adminUserId = randomUUID();
  const adminMembershipId = randomUUID();
  const adminSessionId = randomUUID();
  const adminSessionToken = randomBytes(32).toString("base64url");
  const invitationEmail = `reissue-${randomUUID()}@example.test`;
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
      [adminUserId, `${adminUserId}@example.test`, "Test administrator", "test-only-password-hash"],
    );
    await client.query(
      `INSERT INTO fp360_auth_memberships (id, user_id, tenant_id, role)
       VALUES ($1, $2, $3, 'administrator')`,
      [adminMembershipId, adminUserId, tenantId],
    );
    const adminSessionHash = createHmac("sha256", process.env.SESSION_SECRET)
      .update(adminSessionToken)
      .digest("hex");
    await client.query(
      `INSERT INTO fp360_auth_sessions
        (id, user_id, membership_id, token_hash, expires_at, mfa_verified_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour', NOW())`,
      [adminSessionId, adminUserId, adminMembershipId, adminSessionHash],
    );

    const adminHeaders = {
      "content-type": "application/json",
      cookie: `redfp360_session=${adminSessionToken}`,
      origin: baseUrl,
    };
    const firstInviteResponse = await fetch(`${baseUrl}/api/admin/invitations`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: invitationEmail, role: "student" }),
    });
    assert.equal(firstInviteResponse.status, 201);
    const firstInvite = await firstInviteResponse.json();
    assert.equal(firstInvite.invitation.email, invitationEmail.toLowerCase());
    assert.equal(firstInvite.invitation.status, "pending");

    const rejectResponse = await fetch(`${baseUrl}/api/auth/invitations/reject`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ token: firstInvite.token }),
    });
    assert.equal(rejectResponse.status, 204);
    assert.equal(rejectResponse.headers.get("set-cookie"), null);

    const [rejected] = (await client.query(
      `SELECT rejected_at FROM fp360_auth_invitations WHERE id = $1 AND tenant_id = $2`,
      [firstInvite.invitation.id, tenantId],
    )).rows;
    assert.ok(rejected?.rejected_at, "the invitation should be marked rejected");

    const [rejectionEvent] = (await client.query(
      `SELECT actor_user_id FROM fp360_auth_audit
       WHERE tenant_id = $1 AND entity_id = $2 AND action = 'invitation.rejected'`,
      [tenantId, firstInvite.invitation.id],
    )).rows;
    assert.ok(rejectionEvent, "the rejection should be audited");
    assert.equal(rejectionEvent.actor_user_id, null, "anonymous rejection has no account actor");

    const userRows = await client.query(
      `SELECT id FROM fp360_auth_users WHERE email = $1`,
      [invitationEmail.toLowerCase()],
    );
    const membershipRows = await client.query(
      `SELECT m.id FROM fp360_auth_memberships m
       JOIN fp360_auth_users u ON u.id = m.user_id WHERE u.email = $1`,
      [invitationEmail.toLowerCase()],
    );
    const sessionRows = await client.query(
      `SELECT s.id FROM fp360_auth_sessions s
       JOIN fp360_auth_users u ON u.id = s.user_id WHERE u.email = $1`,
      [invitationEmail.toLowerCase()],
    );
    assert.equal(userRows.rowCount, 0, "rejection must not create an account");
    assert.equal(membershipRows.rowCount, 0, "rejection must not create a membership");
    assert.equal(sessionRows.rowCount, 0, "rejection must not create a session");

    const reinviteResponse = await fetch(`${baseUrl}/api/admin/invitations`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: invitationEmail.toUpperCase(), role: "student" }),
    });
    assert.equal(reinviteResponse.status, 201, "administration should be able to invite the email again");
    const reinvite = await reinviteResponse.json();
    assert.equal(reinvite.invitation.email, invitationEmail.toLowerCase());
    assert.equal(reinvite.invitation.status, "pending");
    assert.notEqual(reinvite.invitation.id, firstInvite.invitation.id);
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await client.query("DELETE FROM fp360_auth_audit WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_auth_invitations WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_auth_sessions WHERE user_id = $1", [adminUserId]);
    await client.query("DELETE FROM fp360_auth_memberships WHERE user_id = $1", [adminUserId]);
    await client.query("DELETE FROM fp360_auth_users WHERE id = $1", [adminUserId]);
    client.release();
    await pool.end();
  }
});

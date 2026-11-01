import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

test("invitations, administrator permissions and tenant isolation", async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Use the development database only");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prefix = `test-access-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const userA = `${prefix}-admin-a`;
  const userB = `${prefix}-admin-b`;
  const orgA = `${prefix}-org-a`;
  const orgB = `${prefix}-org-b`;
  const testClientIp = `10.${Array.from(randomBytes(3), (octet) => octet || 1).join(".")}`;
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const hash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 134217728,
  }).toString("base64url")}`;
  const emails = [0, 1, 2, 3, 4, 5, 6].map((i) => `${prefix}-${i}@example.test`.toLowerCase());
  async function request(path, { method = "GET", data, cookie, origin } = {}) {
    const response = await fetch(`http://127.0.0.1:8080/api${path}`, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
        "X-Forwarded-For": testClientIp,
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function markTestAdminMfaVerified(userId) {
    await pool.query(
      "UPDATE fp360_auth_users SET mfa_enabled_at=NOW(), mfa_secret_encrypted='test-only-fixture' WHERE id=$1",
      [userId],
    );
    await pool.query(
      "UPDATE fp360_auth_sessions SET mfa_verified_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL",
      [userId],
    );
  }
  try {
    for (const [id, email, tenant, org] of [[userA, emails[0], tenantA, orgA], [userB, emails[1], tenantB, orgB]]) {
      await pool.query("INSERT INTO fp360_organizations (id,tenant_id,name,center,island,role) VALUES ($1,$2,'Test organization','Test center','Tenerife','buyer')", [org, tenant]);
      await pool.query("INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,'Temporary test admin',$3)", [id, email, hash]);
      await pool.query("INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,role) VALUES ($1,$2,$3,'administrator')", [randomUUID(), id, tenant]);
    }
    const signInA = await request("/auth/login", { method: "POST", data: { email: emails[0], password } });
    const signInB = await request("/auth/login", { method: "POST", data: { email: emails[1], password } });
    assert.equal(signInA.status, 200);
    assert.equal(signInB.status, 200);
    const cookieA = signInA.cookie;
    const cookieB = signInB.cookie;
    assert.ok(cookieA && cookieB);
    await markTestAdminMfaVerified(userA);
    await markTestAdminMfaVerified(userB);
    const users = await request("/admin/users", { cookie: cookieA });
    assert.equal(users.status, 200);
    assert.deepEqual(users.body.map((row) => row.id), [userA]);
    assert.equal((await request("/admin/users")).status, 401);
    assert.equal((await request(`/admin/users/${userB}`, { method: "PATCH", cookie: cookieA, data: { isActive: false } })).status, 404);
    assert.equal((await request(`/admin/users/${userA}`, { method: "PATCH", cookie: cookieA, data: { role: "student" } })).status, 409);
    assert.equal((await request("/admin/invitations", { method: "POST", cookie: cookieA, origin: "https://cross-site.invalid", data: { email: emails[2], role: "teacher" } })).status, 403);
    assert.equal((await request("/admin/invitations", { method: "POST", cookie: cookieA, data: { email: emails[2], role: "teacher", organizationId: orgB } })).status, 400);
    const existingAccountInvite = await request("/admin/invitations", {
      method: "POST", cookie: cookieA, data: { email: emails[1], role: "teacher", organizationId: orgA },
    });
    assert.equal(existingAccountInvite.status, 409, "An account in another network cannot be invited into this one by email alone");
    const existingAccountMembership = await pool.query(
      "SELECT count(*)::integer AS count FROM fp360_auth_memberships WHERE user_id=$1 AND tenant_id=$2",
      [userB, tenantA],
    );
    assert.equal(existingAccountMembership.rows[0].count, 0);
    const created = await request("/admin/invitations", { method: "POST", cookie: cookieA, data: { email: emails[2].toUpperCase(), role: "teacher", organizationId: orgA } });
    assert.equal(created.status, 201);
    const { invitation, token } = created.body;
    assert.equal(invitation.email, emails[2]);
    assert.equal((await request("/admin/invitations", { method: "POST", cookie: cookieA, data: { email: emails[2], role: "teacher" } })).status, 409);
    const pendingList = await request("/admin/invitations", { cookie: cookieA });
    assert.equal(pendingList.body[0].token, undefined);
    assert.equal(pendingList.body[0].tokenHash, undefined);
    assert.equal((await request("/admin/invitations", { cookie: cookieB })).body.length, 0);
    const inspect = await request("/auth/invitations/inspect", { method: "POST", data: { token } });
    assert.equal(inspect.status, 200);
    assert.equal(inspect.body.email, emails[2]);
    const acceptResults = await Promise.all([0, 1].map(() => request("/auth/invitations/accept", {
      method: "POST", data: { token, displayName: "Temporary teacher", password },
    })));
    assert.deepEqual(acceptResults.map((result) => result.status).sort(), [201, 410]);
    const accepted = acceptResults.find((result) => result.status === 201);
    assert.equal(accepted.status, 201);
    assert.equal(accepted.body.role, "teacher");
    assert.equal(accepted.body.tenantId, tenantA);
    assert.equal(accepted.body.organizationId, orgA);
    const teacherId = accepted.body.id;
    const teacherCookie = accepted.cookie;
    assert.equal((await request("/auth/invitations/accept", { method: "POST", data: { token, displayName: "Replayed", password } })).status, 410);
    assert.equal((await request("/admin/users", { cookie: teacherCookie })).status, 403);
    assert.equal((await request("/redfp360/organizations", { cookie: teacherCookie })).body[0].id, orgA);
    const suspended = await request(`/admin/organizations/${orgA}/action`, {
      method: "POST",
      cookie: cookieA,
      data: { operationId: randomUUID(), action: "suspend", note: "Suspensión de prueba" },
    });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.isActive, false);
    assert.equal((await request("/auth/me", { cookie: teacherCookie })).status, 401);
    const suspendedSessions = await pool.query(
      `SELECT session.revoked_at
       FROM fp360_auth_sessions AS session
       INNER JOIN fp360_auth_memberships AS membership ON membership.id=session.membership_id
       WHERE membership.tenant_id=$1 AND membership.organization_id=$2 AND session.user_id=$3`,
      [tenantA, orgA, teacherId],
    );
    assert.ok(suspendedSessions.rows.length > 0);
    assert.ok(suspendedSessions.rows.every((row) => row.revoked_at), "Suspension must revoke sessions for the affected company");
    const preservedOrganization = await pool.query(
      "SELECT is_active FROM fp360_organizations WHERE id=$1 AND tenant_id=$2",
      [orgA, tenantA],
    );
    assert.equal(preservedOrganization.rows.length, 1, "Suspension must preserve the organization and its history");
    assert.equal(preservedOrganization.rows[0].is_active, false);
    assert.equal((await request(`/admin/users/${teacherId}`, { method: "PATCH", cookie: cookieA, data: { isActive: false } })).status, 200);
    assert.equal((await request("/auth/me", { cookie: teacherCookie })).status, 401);
    assert.equal((await request("/auth/login", { method: "POST", data: { email: emails[2], password } })).status, 401);
    const reactivated = await request(`/admin/users/${teacherId}`, { method: "PATCH", cookie: cookieA, data: { isActive: true, role: "mentor", organizationId: null } });
    assert.equal(reactivated.status, 200);
    assert.equal(reactivated.body.organizationId, null);
    const mentor = await request("/auth/login", { method: "POST", data: { email: emails[2], password } });
    assert.equal(mentor.status, 200);
    assert.equal(mentor.body.role, "mentor");
    assert.equal((await request("/redfp360/orders", { method: "POST", cookie: mentor.cookie, data: {} })).status, 403);
    const staleInvitation = await request("/admin/invitations", {
      method: "POST", cookie: cookieA, data: { email: emails[6], role: "teacher" },
    });
    assert.equal(staleInvitation.status, 201);
    const lateExistingUser = `${prefix}-late-existing`;
    await pool.query(
      "INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,'Temporary existing account',$3)",
      [lateExistingUser, emails[6], hash],
    );
    await pool.query(
      "INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,role) VALUES ($1,$2,$3,'student')",
      [randomUUID(), lateExistingUser, tenantB],
    );
    const staleAcceptance = await request("/auth/invitations/accept", {
      method: "POST",
      data: { token: staleInvitation.body.token, displayName: "Must not join another network", password },
    });
    assert.equal(staleAcceptance.status, 409, "Acceptance must recheck whether the email became an account after the invitation was created");
    const lateExistingMemberships = await pool.query(
      "SELECT tenant_id FROM fp360_auth_memberships WHERE user_id=$1 ORDER BY tenant_id",
      [lateExistingUser],
    );
    assert.deepEqual(lateExistingMemberships.rows.map((row) => row.tenant_id), [tenantB]);
    const staleInvitationState = await pool.query(
      "SELECT accepted_at FROM fp360_auth_invitations WHERE id=$1",
      [staleInvitation.body.invitation.id],
    );
    assert.equal(staleInvitationState.rows[0].accepted_at, null, "Rejected acceptance must not consume the invitation");
    const revocable = await request("/admin/invitations", { method: "POST", cookie: cookieA, data: { email: emails[3], role: "student" } });
    assert.equal(revocable.status, 201);
    assert.equal((await request(`/admin/invitations/${revocable.body.invitation.id}`, { method: "DELETE", cookie: cookieB })).status, 404);
    assert.equal((await request(`/admin/invitations/${revocable.body.invitation.id}`, { method: "DELETE", cookie: cookieA })).status, 204);
    assert.equal((await request("/auth/invitations/inspect", { method: "POST", data: { token: revocable.body.token } })).status, 410);
    const expirable = await request("/admin/invitations", { method: "POST", cookie: cookieA, data: { email: emails[4], role: "student" } });
    assert.equal(expirable.status, 201);
    await pool.query("UPDATE fp360_auth_invitations SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1", [expirable.body.invitation.id]);
    assert.equal((await request("/auth/invitations/inspect", { method: "POST", data: { token: expirable.body.token } })).status, 410);
    const audit = await request("/admin/audit", { cookie: cookieA });
    assert.equal(audit.status, 200);
    const actions = new Set(audit.body.map((row) => row.action));
    for (const action of ["invitation.created", "invitation.accepted", "invitation.revoked", "user.updated"]) assert.ok(actions.has(action));
    const tenantBAudit = await request("/admin/audit", { cookie: cookieB });
    assert.equal(tenantBAudit.status, 200);
    assert.equal(tenantBAudit.body.length, 0);
    const userC = `${prefix}-admin-c`;
    await pool.query("INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,'Temporary second admin',$3)", [userC, emails[5], hash]);
    await pool.query("INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,role) VALUES ($1,$2,$3,'administrator')", [randomUUID(), userC, tenantA]);
    const signInC = await request("/auth/login", { method: "POST", data: { email: emails[5], password } });
    assert.equal(signInC.status, 200);
    await markTestAdminMfaVerified(userC);
    const simultaneousChanges = await Promise.all([
      request(`/admin/users/${userC}`, { method: "PATCH", cookie: cookieA, data: { isActive: false } }),
      request(`/admin/users/${userA}`, { method: "PATCH", cookie: signInC.cookie, data: { isActive: false } }),
    ]);
    assert.deepEqual(simultaneousChanges.map((result) => result.status).sort(), [409, 409]);
    const { rows: [remaining] } = await pool.query(
      "SELECT count(*)::integer AS count FROM fp360_auth_memberships WHERE tenant_id=$1 AND role='administrator' AND is_active=true",
      [tenantA],
    );
    assert.equal(remaining.count, 2, "Direct changes must leave both administrator accounts active");
  } finally {
    await pool.query("DELETE FROM fp360_auth_audit WHERE tenant_id=ANY($1)", [[tenantA, tenantB]]);
    await pool.query("DELETE FROM fp360_auth_invitations WHERE tenant_id=ANY($1)", [[tenantA, tenantB]]);
    await pool.query("DELETE FROM fp360_auth_users WHERE email=ANY($1)", [emails]);
    await pool.query("DELETE FROM fp360_organizations WHERE id=ANY($1)", [[orgA, orgB]]);
    await pool.end();
  }
});

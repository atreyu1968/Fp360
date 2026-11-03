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
const missingEnvironment = ["DATABASE_URL", "SESSION_SECRET"].filter((key) => !process.env[key]);

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
    if (child.exitCode !== null) throw new Error(`API test server exited with code ${child.exitCode}`);
    try {
      if ((await fetch(`${baseUrl}/api/healthz`)).ok) return;
    } catch {
      // Wait while the API initializes.
    }
    await delay(100);
  }
  throw new Error("API test server did not become ready");
}

test("supplier payments link one conformed invoice, require independent review, and create simulated movements once", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "Never run this test in production");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tenantId = `bank-supplier-payment-test-${randomUUID()}`;
  const buyerId = randomUUID();
  const otherBuyerId = randomUUID();
  const supplierId = randomUUID();
  const userIds = [randomUUID(), randomUUID(), randomUUID()];
  const membershipIds = userIds.map(() => randomUUID());
  const sessionIds = userIds.map(() => randomUUID());
  const sessionTokens = userIds.map(() => randomBytes(32).toString("base64url"));
  const organizationIds = [buyerId, otherBuyerId, supplierId];
  const requests = Array.from({ length: 4 }, () => randomUUID());
  const offers = Array.from({ length: 4 }, () => randomUUID());
  const orders = Array.from({ length: 4 }, () => randomUUID());
  const invoices = Array.from({ length: 4 }, () => randomUUID());
  const operationIds = Array.from({ length: 5 }, () => `supplier-payment-${randomUUID()}`);
  let child;

  async function request(pathname, method, data, token) {
    const response = await fetch(`${baseUrl}/api${pathname}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `redfp360_session=${token}`,
        origin: baseUrl,
      },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPath = fileURLToPath(new URL("../../dist/index.mjs", import.meta.url));
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    for (const table of [
      "fp360_bank_movements", "fp360_bank_events", "fp360_bank_transfers",
      "fp360_bank_accounts", "fp360_purchase_invoices", "fp360_purchase_orders",
      "fp360_purchase_offers", "fp360_purchase_requests",
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
    await pool.query("DELETE FROM fp360_auth_sessions WHERE user_id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_auth_memberships WHERE user_id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    await pool.end();
  });

  const migrationColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fp360_bank_transfers'
       AND column_name = 'purchase_invoice_id'`,
  );
  if (!migrationColumn.rowCount) {
    t.skip("The development database needs the supplier-payment schema from the task migration.");
    return;
  }

  for (const [id, name, role] of [
    [buyerId, "Buyer test", "buyer"],
    [otherBuyerId, "Other buyer test", "buyer"],
    [supplierId, "Supplier test", "seller"],
  ]) {
    await pool.query(
      `INSERT INTO fp360_organizations
        (id, tenant_id, name, center, island, role, is_active)
       VALUES ($1, $2, $3, 'Test center', 'Test island', $4, true)`,
      [id, tenantId, name, role],
    );
  }
  for (let index = 0; index < userIds.length; index++) {
    const userId = userIds[index];
    const membershipId = membershipIds[index];
    const sessionId = sessionIds[index];
    const sessionHash = createHmac("sha256", process.env.SESSION_SECRET)
      .update(sessionTokens[index]).digest("hex");
    await pool.query(
      `INSERT INTO fp360_auth_users (id, email, display_name, password_hash)
       VALUES ($1, $2, $3, 'test-only-password-hash')`,
      [userId, `${userId}@example.test`, `Supplier payment actor ${index}`],
    );
    await pool.query(
      `INSERT INTO fp360_auth_memberships (id, user_id, tenant_id, organization_id, role)
       VALUES ($1, $2, $3, $4, $5)`,
      [membershipId, userId, tenantId, index === 2 ? null : buyerId, index === 0 ? "team_manager" : "teacher"],
    );
    await pool.query(
      `INSERT INTO fp360_auth_sessions (id, user_id, membership_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
      [sessionId, userId, membershipId, sessionHash],
    );
  }

  for (let index = 0; index < invoices.length; index++) {
    const orderBuyerId = index === 3 ? otherBuyerId : buyerId;
    const reference = `SUP-${index + 1}`;
    await pool.query(
      `INSERT INTO fp360_purchase_requests
        (id, tenant_id, organization_id, request_number, department, urgency,
         budget_cap_cents, purpose, status, created_by_user_id, created_by_role, request_fingerprint)
       VALUES ($1, $2, $3, $4, 'Purchasing', 'medium', 20000, 'Supplier payment test',
         'approved', $5, 'team_manager', 'test-request')`,
      [requests[index], tenantId, orderBuyerId, `REQ-${reference}`, userIds[0]],
    );
    await pool.query(
      `INSERT INTO fp360_purchase_offers
        (id, tenant_id, request_id, supplier_organization_id, quote_reference,
         delivery_days, payment_days, freight_cents, quality_score_basis_points,
         created_by_user_id, created_by_role, request_fingerprint)
       VALUES ($1, $2, $3, $4, $5, 1, 0, 0, 10000, $6, 'team_manager', 'test-offer')`,
      [offers[index], tenantId, requests[index], supplierId, `QUOTE-${reference}`, userIds[0]],
    );
    await pool.query(
      `INSERT INTO fp360_purchase_orders
        (id, tenant_id, request_id, offer_id, buyer_organization_id, supplier_organization_id,
         order_number, base_cents, igic_cents, freight_cents, total_cents, status,
         awarded_reason, created_by_user_id, created_by_role, simulated_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 10000, 700, 300, 11000, 'received',
         'Test order', $8, 'team_manager', '2027-09-15')`,
      [orders[index], tenantId, requests[index], offers[index], orderBuyerId, supplierId,
        `PO-${reference}`, userIds[0]],
    );
    await pool.query(
      `INSERT INTO fp360_purchase_invoices
        (id, tenant_id, order_id, request_id, supplier_organization_id, invoice_reference,
         invoice_date, due_date, base_cents, igic_cents, freight_cents, total_cents,
         status, match_status, match_summary, created_by_user_id, created_by_role, request_fingerprint)
       VALUES ($1, $2, $3, $4, $5, $6, '2027-09-15', '2027-10-15', 10000, 700, 300, 11000,
         $7, 'match', 'Test invoice matches receipt', $8, 'team_manager', 'test-invoice')`,
      [invoices[index], tenantId, orders[index], requests[index], supplierId, reference,
        index === 1 ? "pending_review" : index === 2 ? "rectified" : "conformed", userIds[0]],
    );
  }

  child = spawn(process.execPath, [serverPath], {
    cwd: path.dirname(serverPath),
    env: { ...process.env, PORT: String(port), NODE_ENV: "test" },
    stdio: "ignore",
  });
  await waitForServer(child, baseUrl);

  const sourceAccountId = `bank-primary:${tenantId}:${buyerId}`;
  const makeInstruction = (invoiceId, operationId, organizationId = buyerId, token = sessionTokens[0]) =>
    request("/redfp360/bank/supplier-payments", "POST", {
      organizationId, sourceAccountId, invoiceId, operationId,
    }, token);
  const competing = await Promise.all([
    makeInstruction(invoices[0], operationIds[0]),
    makeInstruction(invoices[0], operationIds[1]),
  ]);
  assert.deepEqual(competing.map((result) => result.status).sort(), [201, 409]);
  const instruction = competing.find((result) => result.status === 201).body;
  assert.equal(instruction.purchaseInvoiceId, invoices[0]);
  assert.equal(instruction.organizationId, buyerId);
  assert.equal(instruction.amountCents, 11000);
  assert.equal(instruction.status, "draft");
  assert.equal((await makeInstruction(invoices[0], instruction.operationId)).status, 200);
  assert.equal((await makeInstruction(invoices[1], operationIds[2])).status, 409);
  assert.equal((await makeInstruction(invoices[2], operationIds[3])).status, 409);
  assert.equal((await makeInstruction(invoices[3], operationIds[4])).status, 404);

  const managerToken = sessionTokens[0];
  const reviewerToken = sessionTokens[1];
  const action = (name, operationId, token) => request(
    `/redfp360/bank/transfers/${instruction.id}/action`, "POST",
    { action: name, operationId }, token,
  );
  assert.equal((await action("authorize", `authorize-self-${randomUUID()}`, managerToken)).status, 403);
  assert.equal((await action("validate", `validate-${randomUUID()}`, managerToken)).body.status, "pending_review");
  assert.equal((await action("authorize", `authorize-${randomUUID()}`, reviewerToken)).body.status, "authorized");
  assert.equal((await action("execute", `execute-${randomUUID()}`, managerToken)).body.status, "executed");

  const [movements, events, balances] = await Promise.all([
    pool.query(
      "SELECT count(*)::int AS count FROM fp360_bank_movements WHERE tenant_id=$1 AND transfer_id=$2",
      [tenantId, instruction.id],
    ),
    pool.query(
      "SELECT count(*)::int AS count FROM fp360_bank_events WHERE tenant_id=$1 AND transfer_id=$2",
      [tenantId, instruction.id],
    ),
    pool.query(
      "SELECT balance_cents FROM fp360_bank_accounts WHERE tenant_id=$1 AND organization_id = ANY($2::text[]) ORDER BY organization_id",
      [tenantId, [buyerId, supplierId]],
    ),
  ]);
  assert.equal(movements.rows[0].count, 2, "one execution creates exactly two balanced simulated movements");
  assert.equal(events.rows[0].count, 4, "creation, validation, authorization, and execution are audited");
  assert.equal(balances.rows.length, 2);
});

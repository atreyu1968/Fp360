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

test("bank transfers and supplier payments roll back missing audit events and create simulated movements once", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production", "Never run this test in production");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const tenantId = `bank-supplier-payment-test-${randomUUID()}`;
  const simulationNetworkId = randomUUID();
  const centerId = randomUUID();
  const buyerId = randomUUID();
  const otherBuyerId = randomUUID();
  const supplierId = randomUUID();
  const userIds = [randomUUID(), randomUUID(), randomUUID()];
  const centerId = randomUUID();
  const simulationNetworkId = randomUUID();
  const membershipIds = userIds.map(() => randomUUID());
  const sessionIds = userIds.map(() => randomUUID());
  const sessionTokens = userIds.map(() => randomBytes(32).toString("base64url"));
  const organizationIds = [buyerId, otherBuyerId, supplierId];
  const requests = Array.from({ length: 5 }, () => randomUUID());
  const offers = Array.from({ length: 5 }, () => randomUUID());
  const orders = Array.from({ length: 5 }, () => randomUUID());
  const invoices = Array.from({ length: 5 }, () => randomUUID());
  const operationIds = Array.from({ length: 5 }, () => `supplier-payment-${randomUUID()}`);
  const failedAuditOperationId = `supplier-payment-${randomUUID()}`;
  const failedValidateOperationId = `supplier-payment-validate-${randomUUID()}`;
  const failedAuthorizeOperationId = `supplier-payment-authorize-${randomUUID()}`;
  const failedTransferAuditOperationId = `bank-transfer-${randomUUID()}`;
  const failureToken = randomUUID().replaceAll("-", "");
  const failureTriggerName = `fp360_test_fail_supplier_payment_${failureToken}`;
  const failureFunctionName = `fp360_test_fail_supplier_payment_fn_${failureToken}`;
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
    const responseText = await response.text();
    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      body = { error: responseText.slice(0, 500) };
    }
    return { status: response.status, body };
  }

  async function armAuditFailure(operationId, eventType = "") {
    await pool.query(`DROP TRIGGER IF EXISTS ${failureTriggerName} ON fp360_bank_events`);
    await pool.query(
      `CREATE OR REPLACE FUNCTION public.${failureFunctionName}() RETURNS trigger
       LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.tenant_id = TG_ARGV[0]
            AND NEW.operation_id = TG_ARGV[1]
            AND (TG_ARGV[2] = '' OR NEW.event_type = TG_ARGV[2]) THEN
           RAISE EXCEPTION 'controlled bank audit failure';
         END IF;
         RETURN NEW;
       END;
       $$`,
    );
    await pool.query(
      `CREATE TRIGGER ${failureTriggerName}
       BEFORE INSERT ON fp360_bank_events
       FOR EACH ROW EXECUTE FUNCTION public.${failureFunctionName}('${tenantId}', '${operationId}', '${eventType}')`,
    );
  }

  async function clearAuditFailure() {
    await pool.query(`DROP TRIGGER IF EXISTS ${failureTriggerName} ON fp360_bank_events`);
    await pool.query(`DROP FUNCTION IF EXISTS public.${failureFunctionName}()`);
  }

  async function transferSnapshot(transferId) {
    const [transfer, accounts, movements, events] = await Promise.all([
      pool.query(
        `SELECT status, validated_by_user_id, authorized_by_user_id, rejected_reason, executed_at
         FROM fp360_bank_transfers WHERE tenant_id = $1 AND id = $2`,
        [tenantId, transferId],
      ),
      pool.query(
        `SELECT id, balance_cents, reserved_cents FROM fp360_bank_accounts
         WHERE tenant_id = $1 ORDER BY id`,
        [tenantId],
      ),
      pool.query(
        "SELECT COUNT(*)::int AS count FROM fp360_bank_movements WHERE tenant_id = $1",
        [tenantId],
      ),
      pool.query(
        `SELECT operation_id, event_type, transfer_id FROM fp360_bank_events
         WHERE tenant_id = $1 AND transfer_id = $2 ORDER BY operation_id`,
        [tenantId, transferId],
      ),
    ]);
    return {
      transfer: transfer.rows,
      accounts: accounts.rows,
      movementCount: movements.rows[0].count,
      events: events.rows,
    };
  }

  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverPath = fileURLToPath(new URL("../../dist/index.mjs", import.meta.url));
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await pool.query(`DROP TRIGGER IF EXISTS ${failureTriggerName} ON fp360_bank_events`);
    await pool.query(`DROP FUNCTION IF EXISTS public.${failureFunctionName}()`);
    for (const table of [
      "fp360_bank_movements", "fp360_bank_events", "fp360_bank_transfers",
      "fp360_bank_accounts", "fp360_purchase_invoices", "fp360_purchase_orders",
      "fp360_purchase_offers", "fp360_purchase_requests", "fp360_organization_scopes",
      "fp360_simulation_networks", "fp360_centers",
    ]) {
      await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
    await pool.query("DELETE FROM fp360_auth_sessions WHERE user_id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_auth_memberships WHERE user_id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_organization_scopes WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_simulation_networks WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_centers WHERE tenant_id = $1", [tenantId]);
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
  const fiscalCalendarColumn = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'fp360_simulation_networks'
       AND column_name = 'fiscal_year_start_month'`,
  );
  if (!fiscalCalendarColumn.rowCount) {
    t.skip("The development database needs the fiscal-calendar schema before network-scoped integration tests can run.");
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
  await pool.query(
    `INSERT INTO fp360_centers (id, tenant_id, name, normalized_name)
     VALUES ($1, $2, 'Test center', 'test center')`,
    [centerId, tenantId],
  );
  await pool.query(
    `INSERT INTO fp360_simulation_networks
      (id, tenant_id, code, name, calendar_mode, fiscal_year_start_month)
     VALUES ($1, $2, 'ordinary-default', 'Test economic network', 'ordinary', 1)`,
    [simulationNetworkId, tenantId],
  );
  for (const organizationId of organizationIds) {
    await pool.query(
      `INSERT INTO fp360_organization_scopes
        (organization_id, tenant_id, center_id, simulation_network_id, academic_period, origin)
       VALUES ($1, $2, $3, $4, '2027-2028', 'organization_created')`,
      [organizationId, tenantId, centerId, simulationNetworkId],
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
  const beneficiaryAccountId = `bank-primary:${tenantId}:${supplierId}`;
  const makeInstruction = (
    invoiceId, operationId, organizationId = buyerId, token = sessionTokens[0],
    accountId = sourceAccountId,
  ) =>
    request("/redfp360/bank/supplier-payments", "POST", {
      organizationId, sourceAccountId: accountId, invoiceId, operationId,
    }, token);
  const makeTransfer = (operationId) => request("/redfp360/bank/transfers", "POST", {
    organizationId: buyerId,
    sourceAccountId,
    beneficiaryAccountId,
    amountCents: 1250,
    concept: "Transferencia de prueba",
    scheduledDate: null,
    operationId,
  }, sessionTokens[0]);
  const initializedAccounts = await request(
    "/redfp360/organizations", "GET", undefined, sessionTokens[0],
  );
  assert.equal(initializedAccounts.status, 200, JSON.stringify(initializedAccounts.body));
  const initializedBankAccounts = await request(
    `/redfp360/bank/overview?organizationId=${buyerId}`, "GET", undefined, sessionTokens[0],
  );
  assert.equal(initializedBankAccounts.status, 200, JSON.stringify(initializedBankAccounts.body));
  const accountsBeforeFailedAudit = await pool.query(
    `SELECT id, balance_cents, reserved_cents
     FROM fp360_bank_accounts WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
  const movementsBeforeFailedAudit = await pool.query(
    "SELECT COUNT(*)::int AS count FROM fp360_bank_movements WHERE tenant_id = $1",
    [tenantId],
  );
  await armAuditFailure(failedTransferAuditOperationId, "transfer_created");
  const failedTransfer = await makeTransfer(failedTransferAuditOperationId);
  assert.equal(failedTransfer.status, 500, JSON.stringify(failedTransfer.body));
  const rolledBackTransfer = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_bank_transfers
     WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, failedTransferAuditOperationId],
  );
  const rolledBackTransferEvent = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_bank_events
     WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, failedTransferAuditOperationId],
  );
  const accountsAfterFailedTransferAudit = await pool.query(
    `SELECT id, balance_cents, reserved_cents
     FROM fp360_bank_accounts WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
  const movementsAfterFailedTransferAudit = await pool.query(
    "SELECT COUNT(*)::int AS count FROM fp360_bank_movements WHERE tenant_id = $1",
    [tenantId],
  );
  assert.equal(rolledBackTransfer.rows[0].count, 0,
    "A failed audit insert must roll back the ordinary transfer draft");
  assert.equal(rolledBackTransferEvent.rows[0].count, 0,
    "A failed audit insert must not leave a partial ordinary-transfer event");
  assert.deepEqual(accountsAfterFailedTransferAudit.rows, accountsBeforeFailedAudit.rows,
    "A failed ordinary-transfer audit must preserve every account balance and reservation");
  assert.equal(movementsAfterFailedTransferAudit.rows[0].count, movementsBeforeFailedAudit.rows[0].count,
    "A failed ordinary-transfer audit must not add bank movements");

  await clearAuditFailure();
  await armAuditFailure(failedAuditOperationId, "supplier_payment_created");
  const failedAuditInstruction = await makeInstruction(invoices[0], failedAuditOperationId);
  assert.equal(failedAuditInstruction.status, 500, JSON.stringify(failedAuditInstruction.body));
  const rolledBackInstruction = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_bank_transfers
     WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, failedAuditOperationId],
  );
  const rolledBackEvent = await pool.query(
    `SELECT COUNT(*)::int AS count FROM fp360_bank_events
     WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, failedAuditOperationId],
  );
  const accountsAfterFailedAudit = await pool.query(
    `SELECT id, balance_cents, reserved_cents
     FROM fp360_bank_accounts WHERE tenant_id = $1 ORDER BY id`,
    [tenantId],
  );
  const movementsAfterFailedAudit = await pool.query(
    "SELECT COUNT(*)::int AS count FROM fp360_bank_movements WHERE tenant_id = $1",
    [tenantId],
  );
  assert.equal(rolledBackInstruction.rows[0].count, 0,
    "A failed audit insert must roll back the payment instruction");
  assert.equal(rolledBackEvent.rows[0].count, 0,
    "A failed audit insert must not leave a partial event");
  assert.deepEqual(accountsAfterFailedAudit.rows, accountsBeforeFailedAudit.rows,
    "A failed audit insert must preserve every account balance and reservation");
  assert.equal(movementsAfterFailedAudit.rows[0].count, movementsBeforeFailedAudit.rows[0].count,
    "A failed audit insert must not add bank movements");

  await clearAuditFailure();
  const retriedTransfer = await makeTransfer(failedTransferAuditOperationId);
  assert.equal(retriedTransfer.status, 201, JSON.stringify(retriedTransfer.body));
  assert.equal(retriedTransfer.body.status, "draft");
  const retriedTransferEvent = await pool.query(
    `SELECT transfer_id FROM fp360_bank_events
     WHERE tenant_id = $1 AND operation_id = $2 AND event_type = 'transfer_created'`,
    [tenantId, failedTransferAuditOperationId],
  );
  assert.equal(retriedTransferEvent.rows.length, 1,
    "Retrying after the failure must create one ordinary-transfer audit event");
  assert.equal(retriedTransferEvent.rows[0].transfer_id, retriedTransfer.body.id,
    "The ordinary-transfer audit event must reference its created draft");

  const retriedInstruction = await makeInstruction(invoices[0], failedAuditOperationId);
  assert.equal(retriedInstruction.status, 201, JSON.stringify(retriedInstruction.body));
  assert.equal(retriedInstruction.body.purchaseInvoiceId, invoices[0]);
  assert.equal(retriedInstruction.body.status, "draft");
  const retriedEvent = await pool.query(
    `SELECT transfer_id FROM fp360_bank_events
     WHERE tenant_id = $1 AND operation_id = $2
       AND event_type = 'supplier_payment_created'`,
    [tenantId, failedAuditOperationId],
  );
  assert.equal(retriedEvent.rows.length, 1, "Retrying after the failure must create one complete audit event");
  assert.equal(retriedEvent.rows[0].transfer_id, retriedInstruction.body.id,
    "The retry's audit event must reference its created instruction");

  const competing = await Promise.all([
    makeInstruction(invoices[4], operationIds[0]),
    makeInstruction(invoices[4], operationIds[1]),
  ]);
  assert.deepEqual(competing.map((result) => result.status).sort(), [201, 409]);
  const instruction = competing.find((result) => result.status === 201).body;
  assert.equal(instruction.purchaseInvoiceId, invoices[4]);
  assert.equal(instruction.organizationId, buyerId);
  assert.equal(instruction.amountCents, 11000);
  assert.equal(instruction.status, "draft");
  assert.equal((await makeInstruction(invoices[4], instruction.operationId)).status, 200);
  assert.equal((await makeInstruction(invoices[1], operationIds[2])).status, 409);
  assert.equal((await makeInstruction(invoices[2], operationIds[3])).status, 409);
  assert.equal((await makeInstruction(invoices[3], operationIds[4])).status, 404);

  await pool.query(
    `INSERT INTO fp360_bank_transfers
      (id, tenant_id, organization_id, source_account_id, beneficiary_account_id,
       amount_cents, concept, status, operation_id, request_fingerprint,
       created_by_user_id, created_by_name, created_at, purchase_invoice_id)
     SELECT 'recent-bank-transfer-' || seq, $1, $2, $3, $4,
       1250, 'Transferencia reciente de prueba', 'draft',
       'recent-bank-operation-' || seq, 'test-fingerprint', $5, 'Usuario de prueba',
       now() + make_interval(secs => seq), NULL
     FROM generate_series(1, 101) AS seq`,
    [tenantId, buyerId, sourceAccountId, beneficiaryAccountId, userIds[0]],
  );
  const overviewWithoutOldInstruction = await request(
    `/redfp360/bank/overview?organizationId=${buyerId}`, "GET", undefined, sessionTokens[0],
  );
  assert.equal(overviewWithoutOldInstruction.status, 200);
  assert.equal(overviewWithoutOldInstruction.body.transfers.some((row) => row.id === instruction.id), false,
    "The supplier instruction is outside the 100 most recent bank transfers");
  const oldInstructionLookup = await request(
    `/redfp360/bank/supplier-payments/instruction?instructionId=${instruction.id}&organizationId=${buyerId}`,
    "GET", undefined, sessionTokens[0],
  );
  assert.equal(oldInstructionLookup.status, 200, JSON.stringify(oldInstructionLookup.body));
  assert.equal(oldInstructionLookup.body.id, instruction.id,
    "A valid invoice link must load its instruction even when absent from the recent overview");
  const invalidInstructionLookup = await request(
    `/redfp360/bank/supplier-payments/instruction?instructionId=${randomUUID()}&organizationId=${buyerId}`,
    "GET", undefined, sessionTokens[0],
  );
  assert.equal(invalidInstructionLookup.status, 404);
  assert.equal(invalidInstructionLookup.body.id, undefined,
    "An invalid instruction link must not expose an instruction");
  const mismatchedBuyerLookup = await request(
    `/redfp360/bank/supplier-payments/instruction?instructionId=${instruction.id}&organizationId=${otherBuyerId}`,
    "GET", undefined, sessionTokens[2],
  );
  assert.equal(mismatchedBuyerLookup.status, 404,
    "A supervisor must not load an instruction through a different buyer company's link");
  const inaccessibleBuyerLookup = await request(
    `/redfp360/bank/supplier-payments/instruction?instructionId=${instruction.id}&organizationId=${otherBuyerId}`,
    "GET", undefined, sessionTokens[0],
  );
  assert.equal(inaccessibleBuyerLookup.status, 403,
    "A buyer must not use a valid instruction ID to access another company's bank");

  const supervisorInstruction = await makeInstruction(
    invoices[3], `supervisor-instruction-${randomUUID()}`, otherBuyerId, sessionTokens[2],
    `bank-primary:${tenantId}:${otherBuyerId}`,
  );
  assert.equal(supervisorInstruction.status, 201, JSON.stringify(supervisorInstruction.body));
  const buyerInvoiceList = await request(
    "/redfp360/purchases/invoices", "GET", undefined, sessionTokens[0],
  );
  assert.equal(buyerInvoiceList.status, 200, JSON.stringify(buyerInvoiceList.body));
  assert.equal(buyerInvoiceList.body.some((invoice) => invoice.id === invoices[3]), false,
    "A buyer must not receive invoices belonging to another buyer company");
  const inaccessibleCompanyOverview = await request(
    `/redfp360/bank/overview?organizationId=${otherBuyerId}`, "GET", undefined, sessionTokens[0],
  );
  assert.equal(inaccessibleCompanyOverview.status, 403,
    "Changing the company identifier must not let a buyer open another company's bank");
  const buyerInvoice = buyerInvoiceList.body.find((invoice) => invoice.id === invoices[0]);
  assert.equal(buyerInvoice.buyerOrganizationId, buyerId);
  assert.equal(buyerInvoice.supplierPaymentInstruction.id, retriedInstruction.body.id,
    "A buyer's invoice must expose only its own linked instruction");

  const supervisorInvoiceList = await request(
    "/redfp360/purchases/invoices", "GET", undefined, sessionTokens[2],
  );
  assert.equal(supervisorInvoiceList.status, 200, JSON.stringify(supervisorInvoiceList.body));
  const supervisorInvoice = supervisorInvoiceList.body.find((invoice) => invoice.id === invoices[3]);
  assert.equal(supervisorInvoice.buyerOrganizationId, otherBuyerId);
  assert.equal(supervisorInvoice.supplierPaymentInstruction.id, supervisorInstruction.body.id,
    "A network supervisor must receive the invoice's actual buyer company and linked instruction");

  const managerToken = sessionTokens[0];
  const reviewerToken = sessionTokens[1];
  const action = (name, operationId, token) => request(
    `/redfp360/bank/transfers/${instruction.id}/action`, "POST",
    { action: name, operationId }, token,
  );
  assert.equal((await action("authorize", `authorize-self-${randomUUID()}`, managerToken)).status, 403);

  const beforeFailedValidation = await transferSnapshot(instruction.id);
  await armAuditFailure(failedValidateOperationId);
  const failedValidation = await action("validate", failedValidateOperationId, managerToken);
  assert.equal(failedValidation.status, 500, JSON.stringify(failedValidation.body));
  assert.deepEqual(await transferSnapshot(instruction.id), beforeFailedValidation,
    "A failed validation audit must roll back the transfer and preserve accounts and movements");
  await clearAuditFailure();
  const retriedValidation = await action("validate", failedValidateOperationId, managerToken);
  assert.equal(retriedValidation.status, 200, JSON.stringify(retriedValidation.body));
  assert.equal(retriedValidation.body.status, "pending_review");
  assert.equal((await action("validate", failedValidateOperationId, managerToken)).body.status, "pending_review",
    "Replaying a successful validation must not create a second transition");
  const validationEvents = await pool.query(
    `SELECT event_type, transfer_id FROM fp360_bank_events
     WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, failedValidateOperationId],
  );
  assert.deepEqual(validationEvents.rows, [{
    event_type: "transfer_validate",
    transfer_id: instruction.id,
  }], "Retrying validation must create exactly one linked audit event");

  const beforeFailedAuthorization = await transferSnapshot(instruction.id);
  await armAuditFailure(failedAuthorizeOperationId);
  const failedAuthorization = await action("authorize", failedAuthorizeOperationId, reviewerToken);
  assert.equal(failedAuthorization.status, 500, JSON.stringify(failedAuthorization.body));
  assert.deepEqual(await transferSnapshot(instruction.id), beforeFailedAuthorization,
    "A failed authorization audit must not change status, reservations, balances, or movements");
  await clearAuditFailure();
  const retriedAuthorization = await action("authorize", failedAuthorizeOperationId, reviewerToken);
  assert.equal(retriedAuthorization.status, 200, JSON.stringify(retriedAuthorization.body));
  assert.equal(retriedAuthorization.body.status, "authorized");
  assert.equal((await action("authorize", failedAuthorizeOperationId, reviewerToken)).body.status, "authorized",
    "Replaying a successful authorization must not reserve the amount twice");
  const authorizedSource = await pool.query(
    `SELECT reserved_cents FROM fp360_bank_accounts
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, sourceAccountId],
  );
  assert.equal(authorizedSource.rows[0].reserved_cents, instruction.amountCents,
    "A successful authorization retry must reserve the amount exactly once");
  const authorizationEvents = await pool.query(
    `SELECT event_type, transfer_id FROM fp360_bank_events
     WHERE tenant_id = $1 AND operation_id = $2`,
    [tenantId, failedAuthorizeOperationId],
  );
  assert.deepEqual(authorizationEvents.rows, [{
    event_type: "transfer_authorize",
    transfer_id: instruction.id,
  }], "Retrying authorization must create exactly one linked audit event");

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
  assert.equal(events.rows[0].count, 4,
    "creation, failed-action retries, and execution each retain one audit event");
  assert.equal(balances.rows.length, 2);
});

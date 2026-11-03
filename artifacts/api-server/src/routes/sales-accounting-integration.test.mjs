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
      if ((await fetch(`${baseUrl}/api/healthz`)).ok) return;
    } catch {
      // The API is still starting.
    }
    await delay(100);
  }
  throw new Error("API test server did not become ready");
}

test("a simulated sale flows from invoice and collections to treasury sources and reviewed accounting drafts", {
  skip: missingEnvironment.length ? `Requires ${missingEnvironment.join(" and ")}` : false,
}, async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const tenantId = `sales-accounting-test-${randomUUID()}`;
  const sellerOrganizationId = randomUUID();
  const buyerOrganizationId = randomUUID();
  const sellerUserId = randomUUID();
  const reviewerUserId = randomUUID();
  const buyerUserId = randomUUID();
  const sessionTokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  const orderId = randomUUID();
  const orderLineId = randomUUID();
  const testRunId = randomUUID().replaceAll("-", "");
  const paymentOneOperationId = `sale-pay-one-${testRunId}`;
  const paymentTwoOperationId = `sale-pay-two-${testRunId}`;
  const invoiceDraftOperationId = `sale-invoice-draft-${testRunId}`;
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
      `INSERT INTO fp360_organizations
        (id, tenant_id, name, center, island, role, is_active)
       VALUES
        ($1, $3, 'Empresa vendedora ficticia', 'Centro de prueba', 'Isla ficticia', 'company', true),
        ($2, $3, 'Empresa compradora ficticia', 'Centro de prueba', 'Isla ficticia', 'company', true)`,
      [sellerOrganizationId, buyerOrganizationId, tenantId],
    );

    const userRows = [
      [sellerUserId, "Preparador ficticio"],
      [reviewerUserId, "Revisor ficticio"],
      [buyerUserId, "Usuario de otra empresa"],
    ];
    for (const [userId, displayName] of userRows) {
      await client.query(
        `INSERT INTO fp360_auth_users (id, email, display_name, password_hash)
         VALUES ($1, $2, $3, 'test-only-password-hash')`,
        [userId, `${userId}@example.test`, displayName],
      );
    }

    const users = [
      { userId: sellerUserId, organizationId: sellerOrganizationId, sessionId: randomUUID(), membershipId: randomUUID(), token: sessionTokens[0], role: "teacher" },
      { userId: reviewerUserId, organizationId: sellerOrganizationId, sessionId: randomUUID(), membershipId: randomUUID(), token: sessionTokens[1], role: "teacher" },
      { userId: buyerUserId, organizationId: buyerOrganizationId, sessionId: randomUUID(), membershipId: randomUUID(), token: sessionTokens[2], role: "teacher" },
    ];
    for (const user of users) {
      await client.query(
        `INSERT INTO fp360_auth_memberships (id, user_id, tenant_id, organization_id, role)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.membershipId, user.userId, tenantId, user.organizationId, user.role],
      );
      const tokenHash = createHmac("sha256", process.env.SESSION_SECRET)
        .update(user.token)
        .digest("hex");
      await client.query(
        `INSERT INTO fp360_auth_sessions
          (id, user_id, membership_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 hour')`,
        [user.sessionId, user.userId, user.membershipId, tokenHash],
      );
    }

    await client.query(
      `INSERT INTO fp360_orders (id, tenant_id, reference, buyer_organization_id, status, total_cents, simulated_date)
       VALUES ($1, $2, $3, $4, 'delivered', 10000, '2027-09-15')`,
      [orderId, tenantId, `TEST-SALE-${testRunId}`, buyerOrganizationId],
    );
    await client.query(
      `INSERT INTO fp360_order_lines
        (id, order_id, product_id, product_name, quantity, shipped_quantity,
         received_quantity, invoiced_quantity, unit_price_cents, unit_cost_cents,
         igic_basis_points, item_type, tracks_inventory)
       VALUES ($1, $2, $3, 'Producto de prueba', 1, 1, 1, 0, 10000, 5000, 0, 'product', true)`,
      [orderLineId, orderId, `TEST-PRODUCT-${testRunId}`],
    );

    const headersFor = (token) => ({
      "content-type": "application/json",
      cookie: `redfp360_session=${token}`,
      origin: baseUrl,
    });
    const request = async (token, route, method = "GET", body) => {
      const response = await fetch(`${baseUrl}/api${route}`, {
        method,
        headers: headersFor(token),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { response, body: text ? JSON.parse(text) : null };
    };
    const sellerToken = sessionTokens[0];
    const reviewerToken = sessionTokens[1];
    const buyerToken = sessionTokens[2];

    const invoiceResult = await request(sellerToken, "/redfp360/invoices", "POST", { orderId });
    assert.equal(invoiceResult.response.status, 201, JSON.stringify(invoiceResult.body));
    const invoice = invoiceResult.body;
    assert.equal(invoice.orderId, orderId);
    assert.equal(invoice.issuerOrganizationId, sellerOrganizationId);
    assert.equal(invoice.totalCents, 10_000);

    const sourceDraftResult = await request(
      sellerToken,
      `/redfp360/accounting/sources/sales_invoice/${invoice.id}/draft`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: invoiceDraftOperationId },
    );
    assert.equal(sourceDraftResult.response.status, 201, JSON.stringify(sourceDraftResult.body));
    const invoiceDraft = sourceDraftResult.body;
    assert.equal(invoiceDraft.status, "draft");
    assert.equal(invoiceDraft.sourceType, "sales_invoice");
    assert.equal(invoiceDraft.sourceId, invoice.id);
    assert.equal(invoiceDraft.sourceReference, invoice.reference);
    assert.equal(invoiceDraft.debitCents, invoice.totalCents);
    assert.equal(invoiceDraft.creditCents, invoice.totalCents);

    const invoiceDraftRetry = await request(
      sellerToken,
      `/redfp360/accounting/sources/sales_invoice/${invoice.id}/draft`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: invoiceDraftOperationId },
    );
    assert.equal(invoiceDraftRetry.response.status, 201);
    assert.equal(invoiceDraftRetry.body.id, invoiceDraft.id, "a replay must return the original invoice draft");
    const duplicateInvoiceImport = await request(
      sellerToken,
      `/redfp360/accounting/sources/sales_invoice/${invoice.id}/draft`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: `sale-invoice-other-${testRunId}` },
    );
    assert.equal(duplicateInvoiceImport.response.status, 409, "a second operation must not import the same invoice twice");

    const accountingBeforeReview = await request(
      reviewerToken,
      `/redfp360/accounting/overview?organizationId=${sellerOrganizationId}`,
    );
    assert.equal(accountingBeforeReview.response.status, 200);
    assert.equal(accountingBeforeReview.body.entries.find((entry) => entry.id === invoiceDraft.id).status, "draft");
    assert.equal(accountingBeforeReview.body.totals.postedEntryCount, 0);

    const invoicePost = await request(
      reviewerToken,
      `/redfp360/accounting/entries/${invoiceDraft.id}/post`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: `sale-invoice-post-${testRunId}` },
    );
    assert.equal(invoicePost.response.status, 200, JSON.stringify(invoicePost.body));
    assert.equal(invoicePost.body.status, "posted");

    const crossCompanyPayment = await request(
      buyerToken,
      `/redfp360/invoices/${invoice.id}/payments`,
      "POST",
      { amountCents: 1_000, operationId: `cross-company-pay-${testRunId}` },
    );
    assert.equal(crossCompanyPayment.response.status, 403);
    const crossCompanyAccounting = await request(
      buyerToken,
      `/redfp360/accounting/sources/sales_invoice/${invoice.id}/draft`,
      "POST",
      { organizationId: buyerOrganizationId, operationId: `cross-company-import-${testRunId}` },
    );
    assert.equal(crossCompanyAccounting.response.status, 404);
    const buyerOverview = await request(
      buyerToken,
      `/redfp360/accounting/overview?organizationId=${buyerOrganizationId}`,
    );
    assert.equal(buyerOverview.response.status, 200);
    assert.ok(!buyerOverview.body.sources.some((source) => source.id === invoice.id));

    const initialTreasury = await request(
      sellerToken,
      `/redfp360/bank/overview?organizationId=${sellerOrganizationId}`,
    );
    assert.equal(initialTreasury.response.status, 200, JSON.stringify(initialTreasury.body));
    const initialAccount = initialTreasury.body.accounts.find((account) => account.isPrimary);
    assert.ok(initialAccount);
    const initialMovementCount = initialTreasury.body.movements.filter((movement) => movement.accountId === initialAccount.id).length;

    const firstPaymentBody = { amountCents: 4_000, operationId: paymentOneOperationId };
    const firstPaymentResult = await request(
      sellerToken,
      `/redfp360/invoices/${invoice.id}/payments`,
      "POST",
      firstPaymentBody,
    );
    assert.equal(firstPaymentResult.response.status, 201, JSON.stringify(firstPaymentResult.body));
    assert.equal(firstPaymentResult.body.status, "partial");
    assert.equal(firstPaymentResult.body.paidCents, 4_000);
    assert.equal(firstPaymentResult.body.balanceCents, 6_000);

    const firstPaymentRetry = await request(
      sellerToken,
      `/redfp360/invoices/${invoice.id}/payments`,
      "POST",
      firstPaymentBody,
    );
    assert.equal(firstPaymentRetry.response.status, 200);
    assert.equal(firstPaymentRetry.body.paidCents, 4_000, "the same payment retry must not add another collection");
    const changedPaymentRetry = await request(
      sellerToken,
      `/redfp360/invoices/${invoice.id}/payments`,
      "POST",
      { amountCents: 4_500, operationId: paymentOneOperationId },
    );
    assert.equal(changedPaymentRetry.response.status, 409);

    const secondPaymentResult = await request(
      sellerToken,
      `/redfp360/invoices/${invoice.id}/payments`,
      "POST",
      { amountCents: 2_000, operationId: paymentTwoOperationId },
    );
    assert.equal(secondPaymentResult.response.status, 201, JSON.stringify(secondPaymentResult.body));
    assert.equal(secondPaymentResult.body.paidCents, 6_000);
    assert.equal(secondPaymentResult.body.balanceCents, 4_000);
    const overpayment = await request(
      sellerToken,
      `/redfp360/invoices/${invoice.id}/payments`,
      "POST",
      { amountCents: 4_001, operationId: `sale-overpay-${testRunId}` },
    );
    assert.equal(overpayment.response.status, 400);

    const paymentRows = await client.query(
      `SELECT id, amount_cents
       FROM fp360_payments
       WHERE tenant_id = $1 AND invoice_id = $2
       ORDER BY created_at, id`,
      [tenantId, invoice.id],
    );
    assert.deepEqual(
      paymentRows.rows.map((row) => Number(row.amount_cents)),
      [4_000, 2_000],
      "partial collection retries and rejected overpayments must leave exactly two receipts",
    );
    const firstPaymentId = paymentRows.rows[0].id;
    const secondPaymentId = paymentRows.rows[1].id;

    const crossCompanyPaymentImport = await request(
      buyerToken,
      `/redfp360/accounting/sources/payment/${firstPaymentId}/draft`,
      "POST",
      { organizationId: buyerOrganizationId, operationId: `cross-company-payment-import-${testRunId}` },
    );
    assert.equal(crossCompanyPaymentImport.response.status, 404);
    const crossCompanyTreasuryEffect = await request(buyerToken, "/redfp360/bank/effects", "POST", {
      organizationId: buyerOrganizationId,
      invoiceId: invoice.id,
      nominalCents: 1,
      maturityDate: invoice.dueDate,
      operationId: `cross-company-effect-${testRunId}`,
    });
    assert.equal(crossCompanyTreasuryEffect.response.status, 400);

    const treasuryEffectResult = await request(sellerToken, "/redfp360/bank/effects", "POST", {
      organizationId: sellerOrganizationId,
      invoiceId: invoice.id,
      nominalCents: 4_000,
      maturityDate: invoice.dueDate,
      operationId: `sale-treasury-effect-${testRunId}`,
    });
    assert.equal(treasuryEffectResult.response.status, 201, JSON.stringify(treasuryEffectResult.body));
    assert.equal(treasuryEffectResult.body.invoiceId, invoice.id);
    assert.equal(treasuryEffectResult.body.invoiceReference, invoice.reference);
    assert.equal(treasuryEffectResult.body.invoiceBalanceCents, 4_000);

    const paymentDraftResult = await request(
      sellerToken,
      `/redfp360/accounting/sources/payment/${firstPaymentId}/draft`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: `sale-payment-draft-one-${testRunId}` },
    );
    assert.equal(paymentDraftResult.response.status, 201, JSON.stringify(paymentDraftResult.body));
    const paymentDraft = paymentDraftResult.body;
    assert.equal(paymentDraft.status, "draft");
    assert.equal(paymentDraft.sourceType, "payment");
    assert.equal(paymentDraft.sourceId, firstPaymentId);
    assert.match(paymentDraft.sourceReference, new RegExp(invoice.reference));
    assert.match(paymentDraft.sourceReference, new RegExp(firstPaymentId));
    assert.equal(paymentDraft.debitCents, 4_000);
    assert.equal(paymentDraft.creditCents, 4_000);

    const paymentDraftRetry = await request(
      sellerToken,
      `/redfp360/accounting/sources/payment/${firstPaymentId}/draft`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: `sale-payment-draft-one-${testRunId}` },
    );
    assert.equal(paymentDraftRetry.response.status, 201);
    assert.equal(paymentDraftRetry.body.id, paymentDraft.id, "a payment import retry must return the same draft");
    const duplicatePaymentImport = await request(
      sellerToken,
      `/redfp360/accounting/sources/payment/${firstPaymentId}/draft`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: `sale-payment-draft-duplicate-${testRunId}` },
    );
    assert.equal(duplicatePaymentImport.response.status, 409);

    const secondPaymentDraftResult = await request(
      sellerToken,
      `/redfp360/accounting/sources/payment/${secondPaymentId}/draft`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: `sale-payment-draft-two-${testRunId}` },
    );
    assert.equal(secondPaymentDraftResult.response.status, 201, JSON.stringify(secondPaymentDraftResult.body));
    assert.equal(secondPaymentDraftResult.body.sourceId, secondPaymentId);
    assert.match(secondPaymentDraftResult.body.sourceReference, new RegExp(invoice.reference));

    const paymentPost = await request(
      reviewerToken,
      `/redfp360/accounting/entries/${paymentDraft.id}/post`,
      "POST",
      { organizationId: sellerOrganizationId, operationId: `sale-payment-post-${testRunId}` },
    );
    assert.equal(paymentPost.response.status, 200, JSON.stringify(paymentPost.body));
    assert.equal(paymentPost.body.status, "posted");
    assert.equal(paymentPost.body.sourceId, firstPaymentId);
    assert.match(paymentPost.body.sourceReference, new RegExp(invoice.reference));

    const finalAccounting = await request(
      reviewerToken,
      `/redfp360/accounting/overview?organizationId=${sellerOrganizationId}`,
    );
    assert.equal(finalAccounting.response.status, 200);
    const invoiceSource = finalAccounting.body.sources.find((source) => source.sourceType === "sales_invoice" && source.id === invoice.id);
    assert.ok(invoiceSource);
    assert.equal(invoiceSource.imported, true);
    for (const paymentId of [firstPaymentId, secondPaymentId]) {
      const source = finalAccounting.body.sources.find((item) => item.sourceType === "payment" && item.id === paymentId);
      assert.ok(source, `payment ${paymentId} should appear as an accounting source`);
      assert.equal(source.imported, true);
      assert.equal(source.status, "recorded");
    }

    const finalTreasury = await request(
      sellerToken,
      `/redfp360/bank/overview?organizationId=${sellerOrganizationId}`,
    );
    assert.equal(finalTreasury.response.status, 200);
    const effect = finalTreasury.body.effects.find((item) => item.id === treasuryEffectResult.body.id);
    assert.ok(effect, "the invoice-backed treasury effect should remain visible");
    assert.equal(effect.invoiceId, invoice.id);
    assert.equal(effect.invoiceReference, invoice.reference);
    assert.equal(effect.invoiceBalanceCents, 4_000);
    const finalAccount = finalTreasury.body.accounts.find((account) => account.id === initialAccount.id);
    assert.equal(finalAccount.balanceCents, initialAccount.balanceCents, "simulated collections must not directly change bank balances");
    assert.equal(
      finalTreasury.body.movements.filter((movement) => movement.accountId === initialAccount.id).length,
      initialMovementCount,
      "recording collections must not fabricate bank movements",
    );

    const savedEntries = await client.query(
      `SELECT source_type, source_id, source_reference, status
       FROM fp360_accounting_entries
       WHERE tenant_id = $1 AND organization_id = $2
         AND source_id IN ($3, $4, $5)`,
      [tenantId, sellerOrganizationId, invoice.id, firstPaymentId, secondPaymentId],
    );
    assert.equal(savedEntries.rowCount, 3);
    const savedPaymentDraft = savedEntries.rows.find((entry) => entry.source_id === secondPaymentId);
    assert.equal(savedPaymentDraft.status, "draft", "an accounting draft stays unposted until an explicit reviewer action");
    assert.equal(savedPaymentDraft.source_type, "payment");
  } finally {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), delay(5_000)]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
    await client.query("DELETE FROM fp360_bank_events WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_bank_movements WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_bank_effects WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_bank_installments WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_bank_financing WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_bank_transfers WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_bank_accounts WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_events WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_entry_lines WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_entries WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_periods WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_sequences WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_accounting_accounts WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_activity WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_payments WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_invoices WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_order_lines WHERE order_id = $1", [orderId]);
    await client.query("DELETE FROM fp360_orders WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM fp360_auth_sessions WHERE user_id = ANY($1::text[])", [[sellerUserId, reviewerUserId, buyerUserId]]);
    await client.query("DELETE FROM fp360_auth_memberships WHERE user_id = ANY($1::text[])", [[sellerUserId, reviewerUserId, buyerUserId]]);
    await client.query("DELETE FROM fp360_auth_users WHERE id = ANY($1::text[])", [[sellerUserId, reviewerUserId, buyerUserId]]);
    await client.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    const cleanupCheck = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM fp360_organizations WHERE tenant_id = $1) AS organizations,
         (SELECT COUNT(*)::int FROM fp360_orders WHERE tenant_id = $1) AS orders,
         (SELECT COUNT(*)::int FROM fp360_invoices WHERE tenant_id = $1) AS invoices,
         (SELECT COUNT(*)::int FROM fp360_payments WHERE tenant_id = $1) AS payments,
         (SELECT COUNT(*)::int FROM fp360_accounting_entries WHERE tenant_id = $1) AS entries,
         (SELECT COUNT(*)::int FROM fp360_bank_effects WHERE tenant_id = $1) AS effects`,
      [tenantId],
    );
    client.release();
    await pool.end();
    assert.deepEqual(
      Object.values(cleanupCheck.rows[0]),
      [0, 0, 0, 0, 0, 0],
      "all temporary companies, sales documents, drafts, and treasury effects must be removed",
    );
  }
});

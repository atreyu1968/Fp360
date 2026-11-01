import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

test("purchasing protects supplier quotes, compares offers and issues one budget-controlled order", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tenant = `purchases-test-${randomUUID()}`;
  const otherTenant = `${tenant}-other`;
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const passwordHash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 134217728,
  }).toString("base64url")}`;
  const userIds = [];
  const organizationIds = [];
  let productId;

  async function request(path, cookie, method = "GET", data) {
    const response = await fetch(`http://127.0.0.1:8080/api${path}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const body = await response.text();
    return { status: response.status, body: body ? JSON.parse(body) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }

  async function actor(role, organizationId = null, scope = tenant) {
    const id = randomUUID();
    userIds.push(id);
    const email = `${id}@example.test`;
    await pool.query(
      "INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,'Purchasing test user',$3)",
      [id, email, passwordHash],
    );
    await pool.query(
      "INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,organization_id,role) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), id, scope, organizationId, role],
    );
    const login = await request("/auth/login", null, "POST", { email, password });
    assert.equal(login.status, 200);
    return login.cookie;
  }

  async function company(name, role, scope = tenant) {
    const id = randomUUID();
    organizationIds.push(id);
    await pool.query(
      "INSERT INTO fp360_organizations (id,tenant_id,name,center,island,role,is_active) VALUES ($1,$2,$3,'Purchasing training centre','Gran Canaria',$4,true)",
      [id, scope, `${name} ${id.slice(0, 8)}`, role],
    );
    return id;
  }

  try {
    const buyerId = await company("Simulated buyer", "buyer");
    const fastSupplierId = await company("Fast supplier", "seller");
    const valueSupplierId = await company("Value supplier", "seller");
    const unrelatedBuyerId = await company("Uninvited company", "buyer");
    const foreignBuyerId = await company("Foreign tenant", "buyer", otherTenant);

    const buyer = await actor("student", buyerId);
    const fastSupplier = await actor("student", fastSupplierId);
    const valueSupplier = await actor("student", valueSupplierId);
    const unrelatedUser = await actor("student", unrelatedBuyerId);
    const teacher = await actor("teacher");
    const financeManager = await actor("team_manager", buyerId);
    const mentor = await actor("mentor", buyerId);
    const otherTenantUser = await actor("teacher", null, otherTenant);
    const unassignedStudent = await actor("student");

    const createdProduct = await request("/redfp360/products", buyer, "POST", {
      sku: `PROC-${randomUUID().slice(0, 8)}`,
      name: "Practice A4 paper", category: "Office supplies", unitPriceCents: 1000,
      costCents: 700, igicBasisPoints: 700, stock: 5, minimumStock: 2,
    });
    assert.equal(createdProduct.status, 201);
    productId = createdProduct.body.id;
    assert.equal((await request(`/redfp360/products/${productId}`, teacher, "PATCH", { isPublished: true })).status, 200);

    const operationId = randomUUID();
    const requestInput = {
      operationId, organizationId: buyerId, department: "Administración",
      urgency: "high", deadline: "2027-10-15", budgetCapCents: 11000,
      purpose: "Reponer papel para el ejercicio de facturación",
      requestedSupplierIds: [fastSupplierId, valueSupplierId],
      lines: [{ productId, quantity: 10, justification: "La reserva está por debajo del mínimo de práctica." }],
    };
    assert.equal((await request("/redfp360/purchases/requests", unassignedStudent, "POST", requestInput)).status, 403);
    const createdRequest = await request("/redfp360/purchases/requests", buyer, "POST", requestInput);
    assert.equal(createdRequest.status, 201);
    assert.equal(createdRequest.body.status, "draft");
    assert.equal(createdRequest.body.requestedSuppliers.length, 2);
    assert.equal(createdRequest.body.lines[0].productName, "Practice A4 paper");
    assert.equal((await request("/redfp360/purchases/requests", buyer, "POST", requestInput)).body.id, operationId);
    assert.equal((await request("/redfp360/purchases/requests", buyer, "POST", {
      ...requestInput, purpose: "Reuse the same key with different content",
    })).status, 409);

    assert.equal((await request(`/redfp360/purchases/requests/${operationId}`, fastSupplier)).status, 200);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}`, unrelatedUser)).status, 404);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}`, otherTenantUser)).status, 404);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}`, mentor, "POST", {})).status, 403);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/submit`, mentor, "POST", { reason: "Mentor cannot submit" })).status, 403);

    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/submit`, buyer, "POST", { reason: "Quote all requested items." })).body.status, "requested");
    const requestLineId = createdRequest.body.lines[0].id;
    const fastOffer = {
      operationId: randomUUID(), supplierOrganizationId: fastSupplierId,
      quoteReference: "SUP-FAST-001", deliveryDays: 2, paymentDays: 0, freightCents: 500,
      qualityScoreBasisPoints: 10000, validUntil: "2027-10-01",
      lines: [{ requestLineId, unitPriceCents: 1000, igicBasisPoints: 700 }],
    };
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/offers`, buyer, "POST", {
      ...fastOffer, supplierOrganizationId: valueSupplierId,
    })).status, 403);
    const firstOffer = await request(`/redfp360/purchases/requests/${operationId}/offers`, fastSupplier, "POST", fastOffer);
    assert.equal(firstOffer.status, 201);
    assert.equal(firstOffer.body.totalCents, 11200);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/offers`, valueSupplier)).body.length, 0);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/events`, valueSupplier)).body.length, 0);

    const valueOffer = {
      operationId: randomUUID(), supplierOrganizationId: valueSupplierId,
      quoteReference: "SUP-VALUE-001", deliveryDays: 5, paymentDays: 30, freightCents: 200,
      qualityScoreBasisPoints: 5000, validUntil: null,
      lines: [{ requestLineId, unitPriceCents: 900, igicBasisPoints: 700 }],
    };
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/offers`, valueSupplier, "POST", valueOffer)).status, 201);
    const comparisons = await request(`/redfp360/purchases/requests/${operationId}/offers`, buyer);
    assert.equal(comparisons.status, 200);
    assert.equal(comparisons.body.length, 2);
    assert.equal(comparisons.body.find((offer) => offer.id === firstOffer.body.id).weightedScoreBasisPoints > 0, true);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}`, fastSupplier)).body.offerCount, 1,
      "A supplier sees its own quote count, not its competitors' responses.");
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}`, buyer)).body.offerCount, 2);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/review`, buyer, "POST", {
      reason: "Compare offers before approval.",
    })).body.status, "pending_approval");
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/offers`, valueSupplier, "POST", valueOffer)).body.id,
      valueOffer.operationId, "A retried quote keeps the same operation ID without duplicating it.");
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/decision`, buyer, "POST", {
      decision: "approved", reason: "Student cannot approve",
    })).status, 403);

    const approval = { decision: "approved", reason: "Both offers are documented for review." };
    const approved = await request(`/redfp360/purchases/requests/${operationId}/decision`, teacher, "POST", approval);
    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, "approved");
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/decision`, teacher, "POST", approval)).body.status, "approved");

    const overBudgetAward = await request(`/redfp360/purchases/requests/${operationId}/award`, buyer, "POST", {
      offerId: firstOffer.body.id, reason: "Fast delivery is important to the exercise.",
    });
    assert.equal(overBudgetAward.status, 409);
    const award = { offerId: valueOffer.operationId, reason: "The lower total fits the approved practice budget." };
    const order = await request(`/redfp360/purchases/requests/${operationId}/award`, buyer, "POST", award);
    assert.equal(order.status, 201);
    assert.equal(order.body.totalCents, 9830);
    assert.equal(order.body.expectedDate, "2027-09-20");
    assert.equal(order.body.status, "ordered");
    assert.equal(order.body.lines[0].quantity, 10);
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/award`, buyer, "POST", award)).body.id, order.body.id);
    assert.equal((await request("/redfp360/purchases/orders", valueSupplier)).body.length, 1);
    assert.equal((await request("/redfp360/purchases/orders", fastSupplier)).body.length, 0);
    const productAfterAward = await pool.query(
      "SELECT stock FROM fp360_products WHERE id=$1 AND tenant_id=$2", [productId, tenant],
    );
    assert.equal(Number(productAfterAward.rows[0].stock), 5,
      "An issued purchase order does not add stock before a confirmed receipt.");
    assert.equal((await request(`/redfp360/purchases/requests/${operationId}/cancel`, buyer, "POST", {
      reason: "Cannot erase an issued order.",
    })).status, 409);
    const history = await request(`/redfp360/purchases/requests/${operationId}/events`, buyer);
    assert.equal(history.status, 200);
    assert.equal(history.body.some((event) => event.action === "Oferta recibida"), true);
    assert.equal(history.body.some((event) => event.toStatus === "ordered"), true);

    const firstReceipt = {
      operationId: randomUUID(), receiptReference: "alb-a4-01", receivedDate: "2027-09-19",
      lines: [{
        purchaseOrderLineId: order.body.lines[0].id, quantityAccepted: 4,
        quantityRejected: 1, issueReason: "Paquete abierto con resmas dañadas.",
      }],
    };
    assert.equal((await request(`/redfp360/purchases/orders/${order.body.id}/receipts`, valueSupplier, "POST", firstReceipt)).status, 403);
    assert.equal((await request(`/redfp360/purchases/orders/${order.body.id}/receipts`, mentor, "POST", firstReceipt)).status, 403);
    const partialReceipt = await request(`/redfp360/purchases/orders/${order.body.id}/receipts`, buyer, "POST", firstReceipt);
    assert.equal(partialReceipt.status, 201);
    assert.equal(partialReceipt.body.status, "partial");
    assert.equal(partialReceipt.body.acceptedUnits, 4);
    assert.equal(partialReceipt.body.rejectedUnits, 1);
    assert.equal((await request(`/redfp360/purchases/orders/${order.body.id}/receipts`, buyer, "POST", firstReceipt)).body.id,
      firstReceipt.operationId, "Retrying a receipt must not add the same stock twice.");
    assert.equal((await request("/redfp360/purchases/receipts", mentor)).body.length, 1,
      "Read-only mentors can inspect receipts scoped to their assigned buyer company.");
    const stockAfterPartial = await pool.query("SELECT stock FROM fp360_products WHERE id=$1 AND tenant_id=$2", [productId, tenant]);
    assert.equal(Number(stockAfterPartial.rows[0].stock), 9);

    const finalReceipt = {
      operationId: randomUUID(), receiptReference: "ALB-A4-02", receivedDate: "2027-09-22",
      lines: [{
        purchaseOrderLineId: order.body.lines[0].id, quantityAccepted: 5,
        quantityRejected: 0, issueReason: null,
      }],
    };
    const completedReceipt = await request(`/redfp360/purchases/orders/${order.body.id}/receipts`, buyer, "POST", finalReceipt);
    assert.equal(completedReceipt.status, 201);
    assert.equal(completedReceipt.body.status, "received");
    const stockAfterFinal = await pool.query("SELECT stock FROM fp360_products WHERE id=$1 AND tenant_id=$2", [productId, tenant]);
    assert.equal(Number(stockAfterFinal.rows[0].stock), 14, "Only the nine accepted units enter stock.");
    const completedOrder = (await request("/redfp360/purchases/orders", buyer)).body.find((item) => item.id === order.body.id);
    assert.equal(completedOrder.status, "received");
    assert.equal(completedOrder.receivedDate, "2027-09-22");
    assert.equal((await request("/redfp360/purchases/receipts", buyer)).body.length, 2);
    assert.equal((await request("/redfp360/purchases/receipts", valueSupplier)).body.length, 0,
      "Receipts are private to the purchasing organization.");
    assert.equal((await request(`/redfp360/purchases/orders/${order.body.id}/receipts`, buyer, "POST", {
      ...finalReceipt, operationId: randomUUID(),
    })).status, 409, "A completed order cannot be over-received.");

    const invoiceLine = {
      purchaseOrderLineId: order.body.lines[0].id, quantity: 9, unitPriceCents: 900, igicBasisPoints: 700,
    };
    const incorrectInvoice = {
      operationId: randomUUID(), invoiceReference: "inv-a4-01", invoiceDate: "2027-09-22",
      dueDate: "2027-10-22", supersedesInvoiceId: null,
      baseCents: 8550, igicCents: 599, freightCents: 200, totalCents: 9349,
      lines: [{ ...invoiceLine, unitPriceCents: 950 }],
    };
    const mismatch = await request(`/redfp360/purchases/orders/${order.body.id}/invoices`, buyer, "POST", incorrectInvoice);
    assert.equal(mismatch.status, 201);
    assert.equal(mismatch.body.status, "pending_review");
    assert.equal(mismatch.body.matchStatus, "difference");
    assert.equal((await request(`/redfp360/purchases/invoices/${mismatch.body.id}/decision`, financeManager, "POST", {
      decision: "conformed", reason: "Cannot conform mismatched unit price.",
    })).status, 400);
    const correctionDecision = await request(`/redfp360/purchases/invoices/${mismatch.body.id}/decision`, financeManager, "POST", {
      decision: "correction_requested", reason: "The invoice price differs from the received order.",
    });
    assert.equal(correctionDecision.status, 200);
    assert.equal(correctionDecision.body.status, "correction_requested");
    assert.equal((await request(`/redfp360/purchases/invoices/${mismatch.body.id}/decision`, mentor, "POST", {
      decision: "blocked", reason: "A read-only mentor cannot decide invoices.",
    })).status, 403);

    const correctedInvoice = {
      operationId: randomUUID(), invoiceReference: "INV-A4-02", invoiceDate: "2027-09-22",
      dueDate: "2027-10-22", supersedesInvoiceId: mismatch.body.id,
      baseCents: 8100, igicCents: 567, freightCents: 200, totalCents: 8867,
      lines: [invoiceLine],
    };
    const correction = await request(`/redfp360/purchases/orders/${order.body.id}/invoices`, buyer, "POST", correctedInvoice);
    assert.equal(correction.status, 201);
    assert.equal(correction.body.status, "pending_review");
    assert.equal(correction.body.matchStatus, "match");
    assert.equal(correction.body.lines[0].expectedReceivedQuantity, 9);
    assert.equal((await request(`/redfp360/purchases/orders/${order.body.id}/invoices`, buyer, "POST", {
      ...correctedInvoice, operationId: randomUUID(), invoiceReference: " inv-a4-02 ",
    })).status, 409, "Supplier invoice references are normalized and cannot be duplicated.");
    const conformed = await request(`/redfp360/purchases/invoices/${correction.body.id}/decision`, financeManager, "POST", {
      decision: "conformed", reason: "The corrected invoice now matches the receipt and order.",
    });
    assert.equal(conformed.status, 200);
    assert.equal(conformed.body.status, "conformed");
    assert.equal((await request("/redfp360/purchases/invoices", buyer)).body.length, 2);
    assert.equal((await request("/redfp360/purchases/invoices", mentor)).body.length, 2);
    assert.equal((await request("/redfp360/purchases/invoices", valueSupplier)).body.length, 0);
    const supplierMetrics = await request("/redfp360/purchases/supplier-analysis", financeManager);
    assert.equal(supplierMetrics.status, 200);
    assert.equal(supplierMetrics.body.length, 1);
    assert.equal(supplierMetrics.body[0].supplierOrganizationId, valueSupplierId);
    assert.equal(supplierMetrics.body[0].onTimeBasisPoints, 0);
    assert.equal(supplierMetrics.body[0].acceptedUnits, 9);
    assert.equal(supplierMetrics.body[0].rejectedUnits, 1);
    assert.equal(supplierMetrics.body[0].qualityAcceptanceBasisPoints, 9000);
    assert.equal(supplierMetrics.body[0].complaintCount, 1);
    assert.equal(supplierMetrics.body[0].orderedCents, 9830);
    assert.equal((await request("/redfp360/purchases/supplier-analysis", valueSupplier)).body.length, 0);
    assert.equal((await request("/redfp360/purchases/supplier-analysis", mentor)).body.length, 1);
    const finalHistory = await request(`/redfp360/purchases/requests/${operationId}/events`, buyer);
    assert.equal(finalHistory.body.some((entry) => entry.toStatus === "partial"), true);
    assert.equal(finalHistory.body.some((entry) => entry.toStatus === "received"), true);
    assert.equal(finalHistory.body.some((entry) => entry.toStatus === "conformed"), true);
  } finally {
    const tenants = [tenant, otherTenant];
    await pool.query("DELETE FROM fp360_purchase_invoice_lines WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_invoices WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_receipt_lines WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_receipts WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_order_lines WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_orders WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_offer_lines WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_offers WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_request_suppliers WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_events WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_request_lines WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_purchase_requests WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_activity WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_auth_sessions WHERE user_id=ANY($1)", [userIds]);
    await pool.query("DELETE FROM fp360_auth_audit WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_auth_invitations WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_auth_memberships WHERE user_id=ANY($1)", [userIds]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id=ANY($1)", [userIds]);
    await pool.query("DELETE FROM fp360_stock_adjustments WHERE tenant_id=ANY($1)", [tenants]);
    if (productId) await pool.query("DELETE FROM fp360_products WHERE id=$1", [productId]);
    await pool.query("DELETE FROM fp360_organizations WHERE id=ANY($1)", [organizationIds]);
    await pool.end();
  }
});

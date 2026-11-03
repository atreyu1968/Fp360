import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import pg from "pg";

test("catalog approval, archival, reserved stock and historical prices", async (t) => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tenant = `catalog-test-${randomUUID()}`;
  const otherTenant = `${tenant}-other`;
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const hash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 134217728,
  }).toString("base64url")}`;
  const ids = [];
  let aiServer;
  async function call(path, cookie, method = "GET", data) {
    const response = await fetch(`${process.env.API_BASE_URL ?? "http://127.0.0.1:8080/api"}${path}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  async function actor(role, scope = tenant) {
    const id = randomUUID();
    const email = `${id}@example.test`;
    ids.push(id);
    await pool.query("INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,'Catalog test user',$3)", [id, email, hash]);
    await pool.query("INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,role) VALUES ($1,$2,$3,$4)", [randomUUID(), id, scope, role]);
    const login = await call("/auth/login", null, "POST", { email, password });
    assert.equal(login.status, 200);
    return login.cookie;
  }
  try {
    const fiscalCalendarColumn = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'fp360_simulation_networks'
         AND column_name = 'fiscal_year_start_month'`,
    );
    if (!fiscalCalendarColumn.rowCount) {
      t.skip("The development database needs the fiscal-calendar schema before organization-onboarding integration tests can run.");
      return;
    }
    const student = await actor("student");
    const teacher = await actor("teacher");
    const mentor = await actor("mentor");
    const outsider = await actor("teacher", otherTenant);
    const organization = { name: "Simulated company", center: "Test center", island: "Tenerife", role: "both", activity: "commerce" };
    assert.equal((await call("/redfp360/organizations", mentor, "POST", organization)).status, 403);
    assert.equal((await call("/redfp360/organizations", student, "POST", { ...organization, name: "   " })).status, 400);
    assert.equal((await call("/redfp360/organizations", student, "POST", organization)).status, 403);
    const availableNetworks = await call("/redfp360/organization-networks", teacher);
    assert.equal(availableNetworks.status, 200);
    assert.ok(availableNetworks.body.length > 0);
    const acceleratedNetworkId = randomUUID();
    await pool.query(
      `INSERT INTO fp360_simulation_networks (id, tenant_id, code, name, calendar_mode, created_by_user_id)
       VALUES ($1, $2, $3, 'Accelerated practice network', 'accelerated', $4)`,
      [acceleratedNetworkId, tenant, `accelerated-${acceleratedNetworkId}`, ids[1]],
    );
    aiServer = createServer((request, response) => {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          name: "Empresa Simulada Atlántico Azul",
          commercialName: "Brisa didáctica",
          address: "Avenida Simulada 12",
          municipality: "Puerto Inventado",
          postalCode: "35001",
          description: "Propuesta ficticia para prácticas de comercio.",
        }) } }] }));
      });
    });
    await new Promise((resolve, reject) => {
      aiServer.once("error", reject);
      aiServer.listen(0, "127.0.0.1", resolve);
    });
    const aiAddress = aiServer.address();
    assert.ok(aiAddress && typeof aiAddress === "object");
    await pool.query(
      `INSERT INTO fp360_admin_ai_coordinator_settings
        (id, tenant_id, provider, base_url, model, enabled, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, 'local', $3, 'test-model', true, $4, $4)`,
      [randomUUID(), tenant, `http://127.0.0.1:${aiAddress.port}/v1`, ids[1]],
    );
    assert.equal((await call("/redfp360/organizations", teacher, "POST", {
      ...organization, name: "Unreviewed AI company", creationMode: "ai_reviewed",
    })).status, 400, "AI-suggested profiles must be explicitly reviewed before activation");
    assert.equal((await call("/redfp360/organizations", teacher, "POST", {
      ...organization, name: "Unsigned AI company", creationMode: "ai_reviewed", proposalReviewAcknowledged: true,
    })).status, 400, "an AI review acknowledgment must be backed by a server-issued proposal");
    const proposal = await call("/redfp360/organizations/ai-profile-proposals", teacher, "POST", {
      simulationNetworkId: acceleratedNetworkId, center: "Test center", island: "Tenerife", activity: "commerce",
    });
    assert.equal(proposal.status, 200, JSON.stringify(proposal.body));
    assert.equal(proposal.body.simulationNetworkId, acceleratedNetworkId);
    assert.equal(proposal.body.approvalRequired, true);
    assert.equal(proposal.body.simulationOnly, true);
    assert.ok(proposal.body.proposalToken);
    assert.equal((await call("/redfp360/organizations", teacher, "POST", {
      ...organization, name: "Mismatched network company", simulationNetworkId: availableNetworks.body[0].id,
      creationMode: "ai_reviewed", proposalReviewAcknowledged: true, proposalToken: proposal.body.proposalToken,
    })).status, 400, "an AI proposal token must be bound to the selected economic network");
    const aiCompany = await call("/redfp360/organizations", teacher, "POST", {
      ...organization,
      name: proposal.body.name,
      commercialName: proposal.body.commercialName,
      address: proposal.body.address,
      municipality: proposal.body.municipality,
      postalCode: proposal.body.postalCode,
      simulationNetworkId: acceleratedNetworkId,
      simulationCalendarMode: "accelerated",
      creationMode: "ai_reviewed",
      proposalReviewAcknowledged: true,
      proposalToken: proposal.body.proposalToken,
    });
    assert.equal(aiCompany.status, 201, JSON.stringify(aiCompany.body));
    assert.equal(aiCompany.body.simulationNetworkId, acceleratedNetworkId);
    assert.equal((await call("/redfp360/organizations", teacher, "POST", {
      ...organization,
      name: "AI token replay company",
      simulationNetworkId: acceleratedNetworkId,
      simulationCalendarMode: "accelerated",
      creationMode: "ai_reviewed",
      proposalReviewAcknowledged: true,
      proposalToken: proposal.body.proposalToken,
    })).status, 409, "a reviewed AI proposal can only activate one company");
    const company = await call("/redfp360/organizations", teacher, "POST", organization);
    assert.equal(company.status, 201, JSON.stringify(company.body));
    const orgId = company.body.id;
    const acceleratedCompany = await call("/redfp360/organizations", teacher, "POST", {
      ...organization, name: "Accelerated company", simulationNetworkId: acceleratedNetworkId,
      simulationCalendarMode: "accelerated", creationMode: "blank",
    });
    assert.equal(acceleratedCompany.status, 201, JSON.stringify(acceleratedCompany.body));
    assert.equal(acceleratedCompany.body.simulationNetworkId, acceleratedNetworkId);
    assert.equal(acceleratedCompany.body.simulationCalendarMode, "accelerated");
    assert.equal((await call("/redfp360/organizations", teacher, "POST", {
      ...organization, name: "Foreign network company", simulationNetworkId: randomUUID(),
    })).status, 400, "a company cannot select a network outside its tenant");
    const { rows: [noSeedOperations] } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM fp360_orders WHERE tenant_id=$1 AND buyer_organization_id=$2",
      [tenant, acceleratedCompany.body.id],
    );
    assert.equal(noSeedOperations.count, 0, "company onboarding must not create economic transactions");
    const { rows: [noAiSeedOperations] } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM fp360_orders WHERE tenant_id=$1 AND buyer_organization_id=$2",
      [tenant, aiCompany.body.id],
    );
    assert.equal(noAiSeedOperations.count, 0, "AI profile generation must not create economic transactions");
    await pool.query("UPDATE fp360_auth_memberships SET organization_id=$1 WHERE user_id=ANY($2)", [orgId, [ids[0], ids[2]]]);
    assert.equal((await call("/redfp360/organizations", teacher, "POST", { ...organization, name: "SIMULATED COMPANY" })).status, 409);
    assert.equal((await call(`/redfp360/organizations/${orgId}`, outsider, "PATCH", { name: "Hacked" })).status, 404);
    const product = { sku: "test-001", name: "Training product", category: "Test category", unitPriceCents: 1000, costCents: 700, igicBasisPoints: 700, stock: 10, minimumStock: 2 };
    const created = await call("/redfp360/products", student, "POST", product);
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal(created.body.sku, "TEST-001");
    assert.equal(created.body.isPublished, false);
    assert.equal((await call("/redfp360/products", student, "POST", { ...product, sku: "TEST-001" })).status, 409);
    assert.equal((await call(`/redfp360/products/${id}`, student, "PATCH", { isPublished: true })).status, 403);
    assert.equal((await call(`/redfp360/products/${id}`, outsider, "PATCH", { name: "Hacked" })).status, 404);
    assert.equal((await call(`/redfp360/products/${id}/stock-adjustments`, outsider)).status, 404);
    const orderInput = { buyerOrganizationId: orgId, lines: [{ productId: id, quantity: 3 }] };
    assert.equal((await call("/redfp360/orders", student, "POST", orderInput)).status, 400);
    assert.equal((await call(`/redfp360/products/${id}`, teacher, "PATCH", { isPublished: true })).status, 200);
    const order = await call("/redfp360/orders", student, "POST", orderInput);
    assert.equal(order.status, 201);
    const orderId = order.body.id;
    assert.equal((await call(`/redfp360/orders/${orderId}/confirm`, student, "POST")).status, 200);
    assert.equal((await call(`/redfp360/products/${id}`, student, "PATCH", { isActive: false })).status, 409);
    assert.equal((await call(`/redfp360/products/${id}`, student, "PATCH", { stock: 0 })).status, 400);
    assert.equal((await call(`/redfp360/products/${id}/stock-adjustments`, student, "POST", { operationId: randomUUID(), quantityDelta: -8, reason: "Inventory count" })).status, 409);
    assert.equal((await call(`/redfp360/products/${id}/stock-adjustments`, student, "POST", { operationId: randomUUID(), quantityDelta: 0, reason: "Inventory count" })).status, 400);
    const adjustment = { operationId: randomUUID(), quantityDelta: 2, reason: "Inventory correction" };
    const adjusted = await call(`/redfp360/products/${id}/stock-adjustments`, student, "POST", adjustment);
    assert.equal(adjusted.status, 200);
    assert.equal(adjusted.body.stock, 12);
    assert.equal(adjusted.body.reserved, 3);
    const replay = await call(`/redfp360/products/${id}/stock-adjustments`, student, "POST", adjustment);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.stock, 12, "Retrying an adjustment must not apply its units twice");
    assert.equal((await call(`/redfp360/products/${id}/stock-adjustments`, student, "POST", { ...adjustment, quantityDelta: 3 })).status, 409);
    const history = await call(`/redfp360/products/${id}/stock-adjustments`, mentor);
    assert.equal(history.status, 200);
    assert.equal(history.body.length, 2);
    assert.equal(history.body[0].stockBefore, 10);
    assert.equal(history.body[0].stockAfter, 12);
    const priceChange = { unitPriceCents: 1500, igicBasisPoints: 300, priceChangeReason: "Reviewed classroom tariff adjustment" };
    assert.equal((await call(`/redfp360/products/${id}`, student, "PATCH", priceChange)).status, 403);
    const changed = await call(`/redfp360/products/${id}`, teacher, "PATCH", priceChange);
    assert.equal(changed.status, 200);
    assert.equal(changed.body.isPublished, false);
    const orders = await call("/redfp360/orders", student);
    assert.equal(orders.body[0].lines[0].unitPriceCents, 1000);
    const dispatchOperationId = randomUUID();
    const dispatched = await call(`/redfp360/orders/${orderId}/dispatch`, student, "POST", {
      operationId: dispatchOperationId, lines: [{ productId: id, quantity: 3 }],
    });
    assert.equal(dispatched.status, 200, JSON.stringify(dispatched.body));
    const { rows: [shipment] } = await pool.query(
      "SELECT id FROM fp360_logistics_shipments WHERE tenant_id=$1 AND operation_id=$2",
      [tenant, dispatchOperationId],
    );
    assert.ok(shipment);
    assert.equal((await call(`/redfp360/logistics/shipments/${shipment.id}/delivery`, student, "POST", {
      operationId: randomUUID(), lines: [{ productId: id, receivedQuantity: 3 }],
    })).status, 200);
    const invoice = await call("/redfp360/invoices", student, "POST", { orderId });
    assert.equal(invoice.status, 201);
    assert.equal(invoice.body.baseCents, 3000);
    assert.equal(invoice.body.igicCents, 210);
    assert.equal(invoice.body.totalCents, 3210);
    assert.equal((await call(`/redfp360/products/${id}`, student, "PATCH", { isActive: false })).status, 200);
    assert.equal((await call(`/redfp360/products/${id}/stock-adjustments`, student, "POST", { operationId: randomUUID(), quantityDelta: 1, reason: "Another correction" })).status, 409);
    assert.equal((await call(`/redfp360/products/${id}`, teacher, "PATCH", { isPublished: true })).status, 409);
    assert.equal((await call(`/redfp360/products/${id}`, student, "PATCH", { isActive: true })).body.isPublished, false);
    await call(`/redfp360/products/${id}`, teacher, "PATCH", { isPublished: true });
    assert.equal((await call(`/redfp360/organizations/${orgId}`, student, "PATCH", { isActive: false })).status, 403);
    await pool.query("UPDATE fp360_auth_memberships SET organization_id=NULL WHERE user_id=ANY($1)", [[ids[0], ids[2]]]);
    assert.equal((await call(`/redfp360/organizations/${orgId}`, teacher, "PATCH", { isActive: false })).status, 200);
    assert.equal((await call("/redfp360/orders", teacher, "POST", orderInput)).status, 400);
    assert.equal((await call("/redfp360/invoices", teacher)).body[0].totalCents, 3210);
    await call(`/redfp360/organizations/${orgId}`, teacher, "PATCH", { isActive: true });
    await pool.query("UPDATE fp360_auth_memberships SET organization_id=$1 WHERE user_id=$2", [orgId, ids[0]]);
    assert.equal((await call(`/redfp360/organizations/${orgId}`, teacher, "PATCH", { isActive: false })).status, 409);
  } finally {
    if (aiServer) await new Promise((resolve) => aiServer.close(resolve));
    const tenants = [tenant, otherTenant];
    await pool.query("DELETE FROM fp360_admin_ai_coordinator_settings WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_stock_adjustments WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_invoices WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_logistics_shipments WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_orders WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_activity WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id=ANY($1)", [ids]);
    await pool.query("DELETE FROM fp360_product_price_versions WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_products WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_organizations WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_simulation_networks WHERE tenant_id=ANY($1)", [tenants]);
    await pool.end();
  }
});

import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

test("authenticated supplier and buyer sessions keep catalog data within company boundaries", async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Use the development database only");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tenantId = `catalog-boundary-${randomUUID()}`;
  const supplierOrganizationId = randomUUID();
  const buyerOrganizationId = randomUUID();
  const supplierUserId = randomUUID();
  const buyerUserId = randomUUID();
  const teacherUserId = randomUUID();
  const userIds = [supplierUserId, buyerUserId, teacherUserId];
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const passwordHash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 134217728,
  }).toString("base64url")}`;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:8080/api";
  let productId;
  let pendingDocumentId;
  let privateReadyDocumentId;

  async function request(path, { method = "GET", cookie, data } = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      redirect: "manual",
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }

  async function createUser(userId, email, displayName, organizationId, role = "student") {
    await pool.query(
      "INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,$3,$4)",
      [userId, email, displayName, passwordHash],
    );
    await pool.query(
      "INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,organization_id,role) VALUES ($1,$2,$3,$4,$5)",
      [randomUUID(), userId, tenantId, organizationId, role],
    );
    const login = await request("/auth/login", { method: "POST", data: { email, password } });
    assert.equal(login.status, 200, `Could not authenticate ${displayName}`);
    assert.ok(login.cookie, `Authentication did not create a session for ${displayName}`);
    return login.cookie;
  }

  try {
    await pool.query(
      "INSERT INTO fp360_organizations (id,tenant_id,name,center,island,role) VALUES ($1,$2,'Boundary Supplier','Test center','Tenerife','both'),($3,$2,'Boundary Buyer','Test center','Gran Canaria','buyer')",
      [supplierOrganizationId, tenantId, buyerOrganizationId],
    );
    const supplier = await createUser(supplierUserId, `${supplierUserId}@example.test`, "Supplier account", supplierOrganizationId);
    const buyer = await createUser(buyerUserId, `${buyerUserId}@example.test`, "Buyer account", buyerOrganizationId);
    const teacher = await createUser(teacherUserId, `${teacherUserId}@example.test`, "Network teacher", null, "teacher");

    const organizations = await request("/redfp360/organizations", { cookie: buyer });
    assert.equal(organizations.status, 200);
    assert.deepEqual(
      new Set(organizations.body.map((organization) => organization.id)),
      new Set([supplierOrganizationId, buyerOrganizationId]),
      "Organizations in a shared network are visible in the directory",
    );
    assert.equal((await request(`/redfp360/organizations/${supplierOrganizationId}`, {
      method: "PATCH",
      cookie: buyer,
      data: { name: "Changed by buyer" },
    })).status, 404, "A buyer cannot edit another company's organization");

    const created = await request("/redfp360/products", {
      method: "POST",
      cookie: supplier,
      data: {
        sku: `BOUND-${randomUUID().slice(0, 8)}`,
        name: "Company-bound product",
        description: "Published test reference",
        category: "Testing",
        unit: "unit",
        unitPriceCents: 1300,
        costCents: 700,
        igicBasisPoints: 700,
        stock: 10,
        minimumStock: 3,
        maxDiscountBasisPoints: 500,
        leadTimeDays: 4,
      },
    });
    assert.equal(created.status, 201);
    productId = created.body.id;
    assert.equal(created.body.supplierOrganizationId, supplierOrganizationId);

    assert.equal((await request(`/redfp360/products/${productId}`, {
      method: "PATCH",
      cookie: buyer,
      data: { name: "Changed by buyer" },
    })).status, 404, "A buyer cannot edit a supplier's reference");
    assert.equal((await request(`/redfp360/products/${productId}/price-versions`, { cookie: buyer })).status, 404,
      "A buyer cannot read the supplier's historical prices");
    assert.equal((await request(`/redfp360/products/${productId}/stock-adjustments`, { cookie: buyer })).status, 404,
      "A buyer cannot read the supplier's stock movements");
    assert.equal((await request(`/redfp360/products/${productId}/stock-adjustments`, {
      method: "POST",
      cookie: buyer,
      data: { operationId: randomUUID(), quantityDelta: 1, reason: "Unauthorized change" },
    })).status, 404, "A buyer cannot adjust a supplier's stock");

    assert.equal((await request(`/redfp360/products/${productId}`, {
      method: "PATCH",
      cookie: teacher,
      data: { isPublished: true },
    })).status, 200);

    const initialBuyerProduct = (await request("/redfp360/products", { cookie: buyer })).body
      .find((item) => item.id === productId);
    assert.ok(initialBuyerProduct, "The buyer can query a published reference");
    assert.equal(initialBuyerProduct.unitPriceCents, 1300);
    assert.equal(initialBuyerProduct.stock, 10);
    assert.equal(initialBuyerProduct.reserved, 0);
    assert.equal(initialBuyerProduct.costCents, null);
    assert.equal(initialBuyerProduct.minimumStock, null);
    assert.equal(initialBuyerProduct.maxDiscountBasisPoints, null);

    const supplierView = (await request("/redfp360/products", { cookie: supplier })).body
      .find((item) => item.id === productId);
    assert.equal(supplierView.costCents, 700);
    assert.equal(supplierView.minimumStock, 3);

    const order = await request("/redfp360/orders", {
      method: "POST",
      cookie: buyer,
      data: { buyerOrganizationId, lines: [{ productId, quantity: 2 }] },
    });
    assert.equal(order.status, 201);
    assert.equal(order.body.lines[0].unitPriceCents, 1300);
    assert.equal((await request(`/redfp360/orders/${order.body.id}/confirm`, {
      method: "POST",
      cookie: buyer,
    })).status, 200);

    const buyerAfterReservation = (await request("/redfp360/products", { cookie: buyer })).body
      .find((item) => item.id === productId);
    assert.equal(buyerAfterReservation.stock, 8, "The buyer sees available stock, not exact stock");
    assert.equal(buyerAfterReservation.reserved, 0, "The buyer does not see exact reservations");
    const supplierAfterReservation = (await request("/redfp360/products", { cookie: supplier })).body
      .find((item) => item.id === productId);
    assert.equal(supplierAfterReservation.stock, 10);
    assert.equal(supplierAfterReservation.reserved, 2);

    const adjustment = await request(`/redfp360/products/${productId}/stock-adjustments`, {
      method: "POST",
      cookie: supplier,
      data: { operationId: randomUUID(), quantityDelta: 1, reason: "Supplier count" },
    });
    assert.equal(adjustment.status, 200);
    const supplierStockHistory = await request(`/redfp360/products/${productId}/stock-adjustments`, { cookie: supplier });
    assert.equal(supplierStockHistory.status, 200);
    assert.ok(supplierStockHistory.body.length >= 2, "The supplier can review stock movements");

    pendingDocumentId = randomUUID();
    await pool.query(
      "INSERT INTO fp360_product_documents (id,tenant_id,product_id,object_path,original_name,content_type,size_bytes,description,status,uploader_user_id,uploader_name) VALUES ($1,$2,$3,$4,'pending.pdf','application/pdf',100,'Awaiting supplier review','pending',$5,'Supplier account')",
      [pendingDocumentId, tenantId, productId, `/objects/uploads/${randomUUID()}`, supplierUserId],
    );
    const supplierDocuments = await request(`/redfp360/products/${productId}/documents`, { cookie: supplier });
    assert.equal(supplierDocuments.status, 200);
    assert.ok(supplierDocuments.body.some((document) => document.id === pendingDocumentId));
    const buyerDocuments = await request(`/redfp360/products/${productId}/documents`, { cookie: buyer });
    assert.equal(buyerDocuments.status, 200);
    assert.ok(!buyerDocuments.body.some((document) => document.id === pendingDocumentId),
      "A buyer cannot see a pending supplier document");
    assert.equal((await request(`/redfp360/products/${productId}/documents/${pendingDocumentId}/complete`, {
      method: "POST",
      cookie: buyer,
    })).status, 404);
    assert.equal((await request(`/redfp360/products/${productId}/documents/${pendingDocumentId}`, {
      method: "DELETE",
      cookie: buyer,
    })).status, 404);
    assert.equal((await request(`/redfp360/products/${productId}/documents/${pendingDocumentId}/download`, {
      cookie: buyer,
    })).status, 404, "A pending document cannot be downloaded");
    assert.equal((await request(`/redfp360/products/${productId}/documents/upload-url`, {
      method: "POST",
      cookie: buyer,
      data: { name: "buyer.pdf", contentType: "application/pdf", size: 100 },
    })).status, 404, "A buyer cannot upload documents to a supplier's reference");

    const changedPrice = await request(`/redfp360/products/${productId}`, {
      method: "PATCH",
      cookie: supplier,
      data: {
        unitPriceCents: 1500,
        costCents: 800,
        priceChangeReason: "Supplier price update",
        effectiveFrom: "2027-09-16",
      },
    });
    assert.equal(changedPrice.status, 200);
    assert.equal(changedPrice.body.isPublished, false);
    const buyerOrderHistory = await request("/redfp360/orders", { cookie: buyer });
    const savedOrder = buyerOrderHistory.body.find((item) => item.id === order.body.id);
    assert.ok(savedOrder);
    assert.equal(savedOrder.lines[0].unitPriceCents, 1300,
      "A price change must not rewrite a buyer's historical order");

    const supplierPriceHistory = await request(`/redfp360/products/${productId}/price-versions`, { cookie: supplier });
    assert.equal(supplierPriceHistory.status, 200);
    assert.ok(supplierPriceHistory.body.some((version) => version.unitPriceCents === 1300));
    assert.ok(supplierPriceHistory.body.some((version) => version.unitPriceCents === 1500));
    assert.equal((await request(`/redfp360/products/${productId}/price-versions`, { cookie: buyer })).status, 404);
    assert.equal((await request(`/redfp360/products/${productId}/stock-adjustments`, { cookie: buyer })).status, 404);

    privateReadyDocumentId = randomUUID();
    await pool.query(
      "INSERT INTO fp360_product_documents (id,tenant_id,product_id,object_path,original_name,content_type,size_bytes,description,status,uploader_user_id,uploader_name) VALUES ($1,$2,$3,$4,'private-ready.pdf','application/pdf',100,'Private supplier document','ready',$5,'Supplier account')",
      [privateReadyDocumentId, tenantId, productId, `/objects/uploads/${randomUUID()}`, supplierUserId],
    );
    assert.equal((await request(`/redfp360/products/${productId}/documents`, { cookie: buyer })).status, 404,
      "A buyer cannot list documents for a reference that is no longer published");
    assert.equal((await request(`/redfp360/products/${productId}/documents/${privateReadyDocumentId}/download`, {
      cookie: buyer,
    })).status, 404, "A buyer cannot download a document for an unpublished supplier reference");
  } finally {
    if (productId) {
      await pool.query("DELETE FROM fp360_product_documents WHERE product_id = $1", [productId]);
      await pool.query("DELETE FROM fp360_product_price_versions WHERE product_id = $1", [productId]);
      await pool.query("DELETE FROM fp360_stock_adjustments WHERE product_id = $1", [productId]);
      await pool.query(
        "DELETE FROM fp360_order_lines WHERE order_id IN (SELECT id FROM fp360_orders WHERE tenant_id = $1)",
        [tenantId],
      );
      await pool.query("DELETE FROM fp360_orders WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM fp360_activity WHERE tenant_id = $1", [tenantId]);
      await pool.query("DELETE FROM fp360_products WHERE id = $1", [productId]);
    }
    await pool.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id = ANY($1::text[])", [userIds]);
    await pool.end();
  }
});

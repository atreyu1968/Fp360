import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

test("CRM records are simulated, tenant-scoped and preserve stage/activity history", async () => {
  assert.notEqual(process.env.NODE_ENV, "production");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tenant = `crm-test-${randomUUID()}`;
  const otherTenant = `${tenant}-other`;
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const passwordHash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, {
    N: 32768, r: 8, p: 1, maxmem: 134217728,
  }).toString("base64url")}`;
  const users = [];
  const organizations = [];
  async function request(path, cookie, method = "GET", data) {
    const response = await fetch(`${process.env.API_BASE_URL ?? "http://127.0.0.1:8080/api"}${path}`, {
      method,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data ? { "Content-Type": "application/json" } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    const body = await response.text();
    return { status: response.status, body: body ? JSON.parse(body) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  async function actor(role, scope = tenant) {
    const id = randomUUID();
    const email = `${id}@example.test`;
    users.push(id);
    await pool.query(
      "INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,'CRM test user',$3)",
      [id, email, passwordHash],
    );
    await pool.query(
      "INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,role) VALUES ($1,$2,$3,$4)",
      [randomUUID(), id, scope, role],
    );
    const login = await request("/auth/login", null, "POST", { email, password });
    assert.equal(login.status, 200);
    return login.cookie;
  }
  async function company(scope = tenant, isActive = true, role = "buyer") {
    const id = randomUUID();
    organizations.push(id);
    await pool.query(
      "INSERT INTO fp360_organizations (id,tenant_id,name,center,island,role,is_active) VALUES ($1,$2,$3,'CRM test centre','Tenerife',$4,$5)",
      [id, scope, `Fictional business ${id.slice(0, 8)}`, role, isActive],
    );
    return id;
  }

  try {
    const student = await actor("student");
    const mentor = await actor("mentor");
    const outsider = await actor("teacher", otherTenant);
    const supervisor = await actor("teacher");
    const orgId = await company();
    await pool.query("UPDATE fp360_auth_memberships SET organization_id=$1 WHERE user_id=$2", [orgId, users[0]]);
    const inactiveOrgId = await company(tenant, false);
    const outsideOrgId = await company(otherTenant);
    const supplierOrgId = await company(tenant, true, "supplier");
    const supplier = await actor("student");
    await pool.query("UPDATE fp360_auth_memberships SET organization_id=$1 WHERE user_id=$2", [supplierOrgId, users.at(-1)]);
    const contactInput = { organizationId: orgId, fullName: "Alex Sample", position: "Practice buyer", channel: "internal" };
    const contact = await request("/redfp360/crm/contacts", student, "POST", { ...contactInput, phone: "+34900000000" });
    assert.equal(contact.status, 201, JSON.stringify(contact.body));
    assert.equal(contact.body.isActive, true);
    assert.equal("phone" in contact.body, false);
    const contactId = contact.body.id;
    assert.equal((await request("/redfp360/crm/contacts", student, "POST", { ...contactInput, fullName: " ALEX SAMPLE " })).status, 409);
    assert.equal((await request("/redfp360/crm/contacts", student, "POST", { ...contactInput, organizationId: outsideOrgId })).status, 404);
    assert.equal((await request("/redfp360/crm/contacts", student, "POST", { ...contactInput, organizationId: inactiveOrgId })).status, 404);
    assert.equal((await request("/redfp360/crm/contacts", mentor, "POST", { ...contactInput, fullName: "Read Only" })).status, 403);
    assert.equal((await request(`/redfp360/crm/contacts/${contactId}`, outsider, "PATCH", { fullName: "Cross tenant" })).status, 404);
    const contactList = await request("/redfp360/crm/contacts", outsider);
    assert.equal(contactList.status, 200);
    assert.equal(contactList.body.some((row) => row.id === contactId), false);

    const opportunityInput = {
      organizationId: orgId, title: "Practice supply project",
      estimatedValueCents: 123450, expectedDate: "2027-11-01", reason: "Initial simulated prospect",
    };
    assert.equal((await request("/redfp360/crm/opportunities", student, "POST", { ...opportunityInput, organizationId: inactiveOrgId })).status, 404);
    assert.equal((await request("/redfp360/crm/opportunities", student, "POST", { ...opportunityInput, expectedDate: "2027-02-30" })).status, 400);
    const createdOpportunity = await request("/redfp360/crm/opportunities", student, "POST", opportunityInput);
    assert.equal(createdOpportunity.status, 201);
    const opportunityId = createdOpportunity.body.id;
    assert.equal(createdOpportunity.body.stage, "new");
    assert.equal(createdOpportunity.body.probabilityBasisPoints, 1000);
    assert.equal(createdOpportunity.body.estimatedValueCents, 123450);
    assert.equal((await request("/redfp360/crm/opportunities", outsider)).body.some((row) => row.id === opportunityId), false);
    assert.equal((await request(`/redfp360/crm/opportunities/${opportunityId}`, outsider, "PATCH", { title: "Cross tenant" })).status, 404);
    assert.equal((await request(`/redfp360/crm/opportunities/${opportunityId}/stage`, mentor, "POST", { stage: "proposal", reason: "Read only stage" })).status, 403);
    assert.equal((await request(`/redfp360/crm/opportunities/${opportunityId}/stage`, student, "POST", { stage: "qualified", reason: "   " })).status, 400);
    assert.equal((await request(`/redfp360/crm/opportunities/${opportunityId}/stage`, student, "POST", { stage: "new", reason: "No stage change" })).status, 400);
    const moved = await request(`/redfp360/crm/opportunities/${opportunityId}/stage`, student, "POST", { stage: "proposal", reason: "Supplier quote requested" });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.probabilityBasisPoints, 5000);
    assert.equal((await request(`/redfp360/crm/opportunities/${opportunityId}/stage`, student, "POST", { stage: "won", reason: "Fictional exercise closed" })).body.probabilityBasisPoints, 10000);
    assert.equal((await request(`/redfp360/crm/opportunities/${opportunityId}/stage`, student, "POST", { stage: "lost", reason: "Fictional exercise closed" })).body.probabilityBasisPoints, 0);
    assert.equal((await request(`/redfp360/crm/opportunities/${opportunityId}/stage`, student, "POST", { stage: "negotiation", reason: "Reopened for practice" })).body.probabilityBasisPoints, 7500);
    const history = await request("/redfp360/crm/opportunity-history", student);
    assert.equal(history.status, 200);
    assert.equal(history.body.filter((entry) => entry.opportunityId === opportunityId).length, 5);
    assert.equal(history.body.find((entry) => entry.opportunityId === opportunityId && entry.fromStage === null).toStage, "new");
    assert.equal(history.body.every((entry) => entry.actorRole === "student"), true);

    const linkedOpportunity = await request("/redfp360/crm/opportunities", student, "POST", {
      organizationId: orgId, contactId, title: "Linked practice order",
      estimatedValueCents: 65000, expectedDate: null, reason: "Create an explicit commercial link",
    });
    assert.equal(linkedOpportunity.status, 201, JSON.stringify(linkedOpportunity.body));
    assert.equal(linkedOpportunity.body.contactId, contactId);
    assert.equal(linkedOpportunity.body.contactName, "Alex Sample");
    const linkedOpportunityId = linkedOpportunity.body.id;
    const stageWon = await request(`/redfp360/crm/opportunities/${linkedOpportunityId}/stage`, student, "POST", {
      stage: "won", reason: "Practice opportunity approved",
    });
    assert.equal(stageWon.status, 200);
    const financialCounts = async () => {
      const counts = await pool.query(
        "SELECT (SELECT count(*) FROM fp360_orders WHERE tenant_id=$1)::int AS orders, (SELECT count(*) FROM fp360_invoices WHERE tenant_id=$1)::int AS invoices, (SELECT count(*) FROM fp360_payments WHERE tenant_id=$1)::int AS payments",
        [tenant],
      );
      return counts.rows[0];
    };
    assert.deepEqual(await financialCounts(), { orders: 0, invoices: 0, payments: 0 },
      "moving a CRM opportunity to won must not create financial records");

    const productId = randomUUID();
    await pool.query(
      "INSERT INTO fp360_products (id,tenant_id,sku,name,category,item_type,unit,tracks_inventory,unit_price_cents,igic_basis_points,stock,reserved,cost_cents,minimum_stock,max_discount_basis_points,lead_time_days,supplier_organization_id,is_active,is_published) VALUES ($1,$2,$3,'CRM-linked item','Office','product','unit',true,65000,700,10,0,30000,0,0,2,$4,true,true)",
      [productId, tenant, `CRM-${productId.slice(0, 8)}`, supplierOrgId],
    );
    const orderInput = {
      buyerOrganizationId: orgId, crmOpportunityId: linkedOpportunityId, operationId: randomUUID(),
      lines: [{ productId, quantity: 1 }],
    };
    const [linkedOrder, concurrentReplay] = await Promise.all([
      request("/redfp360/orders", student, "POST", orderInput),
      request("/redfp360/orders", student, "POST", orderInput),
    ]);
    assert.equal(linkedOrder.status, 201, JSON.stringify(linkedOrder.body));
    assert.equal(concurrentReplay.status, 201);
    assert.equal(concurrentReplay.body.id, linkedOrder.body.id, "simultaneous retries return one order");
    assert.equal(linkedOrder.body.crmOpportunityId, linkedOpportunityId);
    assert.equal(linkedOrder.body.crmOpportunityTitle, "Linked practice order");
    assert.equal(linkedOrder.body.crmContactId, contactId);
    assert.equal(linkedOrder.body.crmContactName, "Alex Sample");
    const supplierOrders = await request("/redfp360/orders", supplier);
    const supplierOrder = supplierOrders.body.find((row) => row.id === linkedOrder.body.id);
    assert.ok(supplierOrder, "the supplier can see the shared order");
    assert.equal(supplierOrder.crmOpportunityId, null, "the supplier cannot see another company's CRM opportunity");
    assert.equal(supplierOrder.crmContactName, null, "the supplier cannot see another company's CRM contact");
    const replayedOrder = await request("/redfp360/orders", student, "POST", orderInput);
    assert.equal(replayedOrder.status, 201);
    assert.equal(replayedOrder.body.id, linkedOrder.body.id, "retry returns the original linked order");
    assert.equal((await financialCounts()).orders, 1);
    const changedRetry = await request("/redfp360/orders", student, "POST", {
      ...orderInput, lines: [{ productId, quantity: 2 }],
    });
    assert.equal(changedRetry.status, 409, "an operation key cannot be reused with a different request");
    const opportunityWithOrder = await request("/redfp360/crm/opportunities", student);
    assert.deepEqual(
      opportunityWithOrder.body.find((row) => row.id === linkedOpportunityId).linkedOrders.map((row) => row.id),
      [linkedOrder.body.id],
    );

    await pool.query("UPDATE fp360_orders SET status='delivered' WHERE id=$1", [linkedOrder.body.id]);
    await pool.query("UPDATE fp360_order_lines SET shipped_quantity=1 WHERE order_id=$1", [linkedOrder.body.id]);
    const invoice = await request("/redfp360/invoices", student, "POST", { orderId: linkedOrder.body.id });
    assert.equal(invoice.status, 201, JSON.stringify(invoice.body));
    assert.equal(invoice.body.crmOpportunityId, linkedOpportunityId);
    assert.equal(invoice.body.crmContactId, contactId);
    assert.equal(invoice.body.crmContactName, "Alex Sample");
    assert.deepEqual(await financialCounts(), { orders: 1, invoices: 1, payments: 0 });
    await pool.query("UPDATE fp360_invoices SET issuer_organization_id=$1 WHERE id=$2", [supplierOrgId, invoice.body.id]);
    const supplierInvoices = await request("/redfp360/invoices", supplier);
    const supplierInvoice = supplierInvoices.body.find((row) => row.id === invoice.body.id);
    assert.ok(supplierInvoice, "the invoice is visible to its issuer company");
    assert.equal(supplierInvoice.crmOpportunityId, null, "the issuer cannot see another company's CRM opportunity");
    assert.equal(supplierInvoice.crmContactName, null, "the issuer cannot see another company's CRM contact");
    await pool.query("UPDATE fp360_invoices SET issuer_organization_id=$1 WHERE id=$2", [orgId, invoice.body.id]);
    const unlinkedOpportunity = await request(`/redfp360/crm/opportunities/${linkedOpportunityId}`, student, "PATCH", {
      contactId: null, reason: "Change the current opportunity contact",
    });
    assert.equal(unlinkedOpportunity.status, 200);
    const ordersAfterContactChange = await request("/redfp360/orders", student);
    assert.equal(ordersAfterContactChange.body.find((row) => row.id === linkedOrder.body.id).crmContactId, contactId,
      "changing the opportunity contact must not rewrite the order's history");
    const invoicesAfterContactChange = await request("/redfp360/invoices", student);
    assert.equal(invoicesAfterContactChange.body.find((row) => row.id === invoice.body.id).crmContactId, contactId,
      "changing the opportunity contact must not rewrite the invoice's history");

    assert.equal((await request("/redfp360/crm/activities", student, "POST", {
      opportunityId, contactId: randomUUID(), kind: "task", description: "Wrong contact", simulatedDate: "2027-09-15",
    })).status, 400);
    const activityInput = {
      opportunityId, contactId, kind: "meeting_simulation",
      description: "Simulated review of classroom needs", dueDate: "2027-10-03", simulatedDate: "2027-09-15",
    };
    const createdActivity = await request("/redfp360/crm/activities", student, "POST", activityInput);
    assert.equal(createdActivity.status, 201);
    assert.equal(createdActivity.body.status, "planned");
    assert.equal(createdActivity.body.contactName, "Alex Sample");
    const activityId = createdActivity.body.id;
    assert.equal((await request(`/redfp360/crm/activities/${activityId}`, outsider, "PATCH", { status: "completed" })).status, 404);
    assert.equal((await request(`/redfp360/crm/activities/${activityId}`, student, "PATCH", { status: "completed" })).body.status, "completed");
    assert.equal((await request(`/redfp360/crm/contacts/${contactId}`, student, "PATCH", { isActive: false })).status, 200);
    const invoicesAfterArchivingContact = await request("/redfp360/invoices", student);
    assert.equal(invoicesAfterArchivingContact.body.find((row) => row.id === invoice.body.id).crmContactName, "Alex Sample",
      "archiving the contact must preserve its name on the linked invoice");
    assert.equal((await request("/redfp360/crm/activities", student, "POST", {
      ...activityInput, kind: "task", description: "Follow up next week",
    })).status, 400, "New work must not assign archived contacts");
    const activities = await request("/redfp360/crm/activities", student);
    assert.equal(activities.body.find((row) => row.id === activityId).contactName, "Alex Sample");

    const edits = await request(`/redfp360/crm/opportunities/${opportunityId}`, student, "PATCH", {
      estimatedValueCents: 234500, expectedDate: null,
    });
    assert.equal(edits.status, 200);
    assert.equal(edits.body.estimatedValueCents, 234500);
    assert.equal(edits.body.expectedDate, null);
    await pool.query("UPDATE fp360_organizations SET is_active=false WHERE id=$1", [orgId]);
    assert.equal((await request("/redfp360/crm/contacts", student)).status, 401);
    assert.equal((await request("/redfp360/crm/contacts", supervisor)).body.find((row) => row.id === contactId).organizationName.length > 0, true);
    assert.equal((await request("/redfp360/crm/opportunities", supervisor)).body.some((row) => row.id === opportunityId), true);
    assert.equal((await request("/redfp360/crm/opportunities", supervisor, "POST", { ...opportunityInput, title: "New against archived" })).status, 404);
    await pool.query("UPDATE fp360_organizations SET is_active=true WHERE id=$1", [orgId]);
  } finally {
    const tenants = [tenant, otherTenant];
    await pool.query("DELETE FROM fp360_crm_opportunity_order_links WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_payments WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_invoice_lines WHERE invoice_id IN (SELECT id FROM fp360_invoices WHERE tenant_id=ANY($1))", [tenants]);
    await pool.query("DELETE FROM fp360_invoices WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_order_lines WHERE order_id IN (SELECT id FROM fp360_orders WHERE tenant_id=ANY($1))", [tenants]);
    await pool.query("DELETE FROM fp360_orders WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_crm_activities WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_crm_opportunity_history WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_crm_opportunities WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_crm_contacts WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_stock_adjustments WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_activity WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_auth_sessions WHERE user_id=ANY($1)", [users]);
    await pool.query("DELETE FROM fp360_auth_audit WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_auth_invitations WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_auth_memberships WHERE user_id=ANY($1)", [users]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id=ANY($1)", [users]);
    await pool.query("DELETE FROM fp360_products WHERE tenant_id=ANY($1)", [tenants]);
    await pool.query("DELETE FROM fp360_organizations WHERE id=ANY($1)", [organizations]);
    await pool.end();
  }
});

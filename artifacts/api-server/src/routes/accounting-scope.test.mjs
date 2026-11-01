import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccountingSources,
  canAccessAccountingOrganization,
} from "./accounting-scope.mjs";

const tenantId = "network-1";
const organizationA = "company-a";
const organizationB = "company-b";

test("company members see only their company, while network supervisors can select either company", () => {
  const companyActor = { organizationId: organizationA, role: "team_manager" };
  const networkTeacher = { organizationId: null, role: "teacher" };
  const networkAdministrator = { organizationId: null, role: "administrator" };

  assert.equal(canAccessAccountingOrganization(companyActor, organizationA), true);
  assert.equal(canAccessAccountingOrganization(companyActor, organizationB), false);
  assert.equal(canAccessAccountingOrganization(networkTeacher, organizationA), true);
  assert.equal(canAccessAccountingOrganization(networkTeacher, organizationB), true);
  assert.equal(canAccessAccountingOrganization(networkAdministrator, organizationA), true);
  assert.equal(canAccessAccountingOrganization(networkAdministrator, organizationB), true);
  assert.equal(canAccessAccountingOrganization({ organizationId: null, role: "team_manager" }, organizationA), false);
});

test("accounting source lists isolate sales invoices, collections, and conformed purchases by company", () => {
  const sourceRows = {
    salesInvoices: [
      { id: "sale-a", tenantId, issuerOrganizationId: organizationA, reference: "A-1", simulatedDate: "2027-09-01", buyerName: "Buyer A", totalCents: 1000 },
      { id: "sale-b", tenantId, issuerOrganizationId: organizationB, reference: "B-1", simulatedDate: "2027-09-02", buyerName: "Buyer B", totalCents: 2000 },
      { id: "sale-other-network", tenantId: "other-network", issuerOrganizationId: organizationA, reference: "X-1", simulatedDate: "2027-09-03", buyerName: "Other", totalCents: 9999 },
    ],
    payments: [
      { id: "payment-a", tenantId, organizationId: organizationA, invoiceId: "sale-a", simulatedDate: "2027-09-04", amountCents: 500 },
      { id: "payment-b", tenantId, organizationId: organizationB, invoiceId: "sale-b", simulatedDate: "2027-09-05", amountCents: 600 },
      { id: "mislinked-payment", tenantId, organizationId: organizationA, invoiceId: "sale-b", simulatedDate: "2027-09-06", amountCents: 700 },
      { id: "other-network-payment", tenantId: "other-network", organizationId: organizationA, invoiceId: "sale-a", simulatedDate: "2027-09-07", amountCents: 800 },
    ],
    purchaseOrders: [
      { id: "order-a", tenantId, buyerOrganizationId: organizationA },
      { id: "order-b", tenantId, buyerOrganizationId: organizationB },
      { id: "order-other-network", tenantId: "other-network", buyerOrganizationId: organizationA },
    ],
    purchaseInvoices: [
      { id: "purchase-a", tenantId, orderId: "order-a", status: "conformed", invoiceReference: "PA-1", invoiceDate: "2027-09-08", supplierOrganizationId: "supplier-a", totalCents: 300 },
      { id: "purchase-b", tenantId, orderId: "order-b", status: "conformed", invoiceReference: "PB-1", invoiceDate: "2027-09-09", supplierOrganizationId: "supplier-b", totalCents: 400 },
      { id: "purchase-pending", tenantId, orderId: "order-a", status: "pending_review", invoiceReference: "PA-2", invoiceDate: "2027-09-10", supplierOrganizationId: "supplier-a", totalCents: 500 },
      { id: "purchase-other-network", tenantId: "other-network", orderId: "order-other-network", status: "conformed", invoiceReference: "PX-1", invoiceDate: "2027-09-11", supplierOrganizationId: "supplier-x", totalCents: 600 },
    ],
    partners: [
      { id: "supplier-a", tenantId, name: "Supplier A" },
      { id: "supplier-b", tenantId, name: "Supplier B" },
    ],
    imported: new Set(),
    postedSalesInvoiceIds: new Set(["sale-a", "sale-b"]),
  };
  const result = buildAccountingSources({
    ...sourceRows,
    tenantId,
    organizationId: organizationA,
  });
  const supervisorAccess = canAccessAccountingOrganization(
    { organizationId: null, role: "teacher" },
    organizationB,
  );
  const supervisorResult = supervisorAccess ? buildAccountingSources({
    ...sourceRows,
    tenantId,
    organizationId: organizationB,
  }) : [];

  assert.deepEqual(
    result.map((source) => `${source.sourceType}:${source.id}`).sort(),
    ["payment:payment-a", "purchase_invoice:purchase-a", "sales_invoice:sale-a"],
  );
  assert.equal(result.find((source) => source.id === "purchase-a")?.partnerName, "Supplier A");
  assert.equal(result.reduce((sum, source) => sum + source.totalCents, 0), 1800);
  assert.deepEqual(
    supervisorResult.map((source) => `${source.sourceType}:${source.id}`).sort(),
    ["payment:payment-b", "purchase_invoice:purchase-b", "sales_invoice:sale-b"],
  );
});

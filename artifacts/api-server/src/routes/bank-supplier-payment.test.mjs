import assert from "node:assert/strict";
import test from "node:test";
import {
  supplierPaymentEligibility,
  supplierPaymentReviewerError,
} from "./bank-supplier-payment.mjs";

const invoice = { status: "conformed", supplierOrganizationId: "supplier-a" };
const order = { buyerOrganizationId: "buyer-a", supplierOrganizationId: "supplier-a" };

test("supplier payment requires a conformed invoice belonging to the selected buyer", () => {
  assert.equal(supplierPaymentEligibility({
    invoice, order, organizationId: "buyer-a",
  }), null);
  assert.equal(supplierPaymentEligibility({
    invoice, order, organizationId: "buyer-b",
  }).status, 404);
  for (const status of ["pending_review", "blocked", "correction_requested", "rectified", "annulled"]) {
    assert.equal(supplierPaymentEligibility({
      invoice: { ...invoice, status }, order, organizationId: "buyer-a",
    }).status, 409, `${status} invoice must not be payable`);
  }
  assert.equal(supplierPaymentEligibility({
    invoice: { ...invoice, supplierOrganizationId: "supplier-b" },
    order, organizationId: "buyer-a",
  }).status, 409);
});

test("supplier invoice payment instructions cannot be duplicated", () => {
  assert.equal(supplierPaymentEligibility({
    invoice, order, organizationId: "buyer-a", alreadyHasPayment: true,
  }).status, 409);
});

test("supplier payment review is reserved for a different teacher or administrator", () => {
  const transfer = { purchaseInvoiceId: "invoice-1", createdByUserId: "creator" };
  assert.match(supplierPaymentReviewerError(transfer, {
    userId: "creator", role: "teacher",
  }), /distinto/);
  assert.match(supplierPaymentReviewerError(transfer, {
    userId: "reviewer", role: "team_manager",
  }), /docente o administrador/);
  assert.equal(supplierPaymentReviewerError(transfer, {
    userId: "reviewer", role: "teacher",
  }), null);
  assert.equal(supplierPaymentReviewerError(transfer, {
    userId: "reviewer", role: "administrator",
  }), null);
  assert.equal(supplierPaymentReviewerError({
    purchaseInvoiceId: null, createdByUserId: "creator",
  }, { userId: "creator", role: "team_manager" }), null);
});

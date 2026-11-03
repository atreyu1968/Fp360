import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "../../artifacts/red-fp360/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../artifacts/red-fp360/node_modules/react-dom/server.node.js";
import { BankInvalidInstructionNotice } from "../../artifacts/red-fp360/src/components/bank-invalid-instruction-notice.ts";
import { resolveSupplierPaymentDeepLink } from "../../artifacts/red-fp360/src/lib/supplier-payment-deep-link.ts";

const instructionA = {
  id: "instruction-a",
  organizationId: "company-a",
  purchaseInvoiceId: "invoice-a",
};
const instructionB = {
  id: "instruction-b",
  organizationId: "company-b",
  purchaseInvoiceId: "invoice-b",
};
const buyer = { role: "student", organizationId: "company-a" };
const supervisor = { role: "teacher", organizationId: null };
const organizations = [{ id: "company-a" }, { id: "company-b" }];

function resolve(search, identity, instruction = instructionA, availableOrganizations = organizations) {
  return resolveSupplierPaymentDeepLink({
    search,
    identity,
    instruction,
    organizations: availableOrganizations,
  });
}

test("a buyer can open only an instruction linked to their company and invoice", () => {
  const result = resolve(
    "?supplierPaymentInstruction=instruction-a&organizationId=company-a",
    buyer,
  );
  assert.equal(result.canOpenDeepLink, true);
  assert.equal(result.linkedInvoiceId, "invoice-a");

  const changedCompany = resolve(
    "?supplierPaymentInstruction=instruction-a&organizationId=company-b",
    buyer,
  );
  assert.equal(changedCompany.canOpenDeepLink, false);
  assert.equal(changedCompany.deepLinkAccessAllowed, false);
  assert.equal(changedCompany.linkedInvoiceId, undefined);

  const omittedCompany = resolve("?supplierPaymentInstruction=instruction-a", buyer);
  assert.equal(omittedCompany.hasInstructionDeepLink, true);
  assert.equal(omittedCompany.canOpenDeepLink, false);
  assert.equal(omittedCompany.deepLinkAccessAllowed, false);
  assert.equal(omittedCompany.linkedInvoiceId, undefined);
});

test("a supervisor can open the exact instruction only when its company is accessible", () => {
  const exactLink = resolve(
    "?supplierPaymentInstruction=instruction-b&organizationId=company-b",
    supervisor,
    instructionB,
  );
  assert.equal(exactLink.canOpenDeepLink, true);
  assert.equal(exactLink.linkedInvoiceId, "invoice-b");

  const changedInstruction = resolve(
    "?supplierPaymentInstruction=instruction-a&organizationId=company-b",
    supervisor,
  );
  assert.equal(changedInstruction.canOpenDeepLink, false);
  assert.equal(changedInstruction.linkedInvoiceId, undefined);

  const inaccessibleCompany = resolve(
    "?supplierPaymentInstruction=instruction-a&organizationId=company-a",
    supervisor,
    instructionA,
    [{ id: "company-b" }],
  );
  assert.equal(inaccessibleCompany.canOpenDeepLink, false);
  assert.equal(inaccessibleCompany.deepLinkAccessAllowed, false);
});

test("an archived invoice instruction opens through the dedicated response without recent invoices", () => {
  const result = resolve(
    "?supplierPaymentInstruction=instruction-old&organizationId=company-a",
    supervisor,
    { id: "instruction-old", organizationId: "company-a", purchaseInvoiceId: "invoice-old" },
  );
  assert.equal(result.canOpenDeepLink, true);
  assert.equal(result.linkedInvoiceId, "invoice-old");
});

test("missing or mismatched instruction responses never open a bank view", () => {
  const search = "?supplierPaymentInstruction=instruction-a&organizationId=company-a";
  for (const instruction of [
    null,
    { ...instructionA, id: "instruction-other" },
    { ...instructionA, organizationId: "company-b" },
    { ...instructionA, purchaseInvoiceId: null },
  ]) {
    const result = resolve(search, supervisor, instruction);
    assert.equal(result.canOpenDeepLink, false);
    assert.equal(result.linkedInvoiceId, undefined);
  }
  const incomplete = resolve("?organizationId=company-a", buyer);
  assert.equal(incomplete.hasInstructionDeepLink, true);
  assert.equal(incomplete.deepLinkAccessAllowed, false);
  assert.equal(incomplete.canOpenDeepLink, false);
});

test("invalid links display an unavailable notice and hide the bank data views", () => {
  const source = readFileSync(new URL("../../artifacts/red-fp360/src/components/bank-page.tsx", import.meta.url), "utf8");
  const purchasesSource = readFileSync(new URL("../../artifacts/red-fp360/src/components/purchases-page.tsx", import.meta.url), "utf8");
  const noticeHtml = renderToStaticMarkup(createElement(BankInvalidInstructionNotice));
  assert.match(noticeHtml, /<section class="bank-unselected" role="alert">/);
  assert.match(noticeHtml, /No se puede abrir esta instrucción/);
  assert.match(noticeHtml, /El enlace no identifica una factura e instrucción disponibles para tu empresa o red\./);
  assert.match(source, /hasInstructionDeepLink && !canOpenDeepLink && \(!deepLinkAccessAllowed \|\| !\(instructionQuery\.isLoading \|\| instructionQuery\.isFetching\)\) && <BankInvalidInstructionNotice \/>/);
  assert.match(source, /enabled: deepLinkAccessAllowed/);
  assert.match(source, /instruction: instructionQuery\.data/);
  assert.match(source, /organizationId && \(!hasInstructionDeepLink \|\| canOpenDeepLink\)/);
  assert.match(source, /item\.id !== deepLinkedInstructionId \|\| item\.purchaseInvoiceId !== deepLinkedInvoiceId/);
  assert.match(purchasesSource, /supplierPaymentInstruction=\$\{instructionId\}&organizationId=\$\{organizationId\}/);
});

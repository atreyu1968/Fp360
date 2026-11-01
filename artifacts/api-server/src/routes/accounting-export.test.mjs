import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountingExportCsv } from "./accounting-export.mjs";
import { canAccessAccountingOrganization } from "./accounting-scope.mjs";

const tenantId = "network-1";
const companyA = { id: "company-a", name: "Empresa A", center: "Centro Norte" };
const companyB = { id: "company-b", name: "Empresa B", center: "Centro Sur" };

const accounts = [
  { id: "account-a", tenantId, organizationId: companyA.id, code: "4300", name: "Clientes", normalBalance: "debit" },
  { id: "account-b", tenantId, organizationId: companyB.id, code: "4300", name: "Clientes", normalBalance: "debit" },
  { id: "account-other-tenant", tenantId: "network-2", organizationId: companyA.id, code: "4300", name: "Clientes externos", normalBalance: "debit" },
];
const entries = [
  {
    id: "entry-a", tenantId, organizationId: companyA.id, fiscalYear: 2027, period: 9,
    entryDate: "2027-09-10", entryNumber: 1, status: "posted", sourceType: "manual",
    sourceReference: null, concept: "Asiento de A",
  },
  {
    id: "entry-b", tenantId, organizationId: companyB.id, fiscalYear: 2027, period: 9,
    entryDate: "2027-09-11", entryNumber: 2, status: "posted", sourceType: "manual",
    sourceReference: null, concept: "Asiento de B",
  },
  {
    id: "entry-other-tenant", tenantId: "network-2", organizationId: companyA.id, fiscalYear: 2027,
    period: 9, entryDate: "2027-09-12", entryNumber: 3, status: "posted", sourceType: "manual",
    sourceReference: null, concept: "Asiento externo",
  },
];
const entryLines = [
  { tenantId, entryId: "entry-a", accountId: "account-a", lineNumber: 1, description: "Detalle A", debitCents: 12500, creditCents: 0 },
  { tenantId, entryId: "entry-b", accountId: "account-b", lineNumber: 1, description: "Detalle B", debitCents: 25000, creditCents: 0 },
  { tenantId: "network-2", entryId: "entry-other-tenant", accountId: "account-other-tenant", lineNumber: 1, description: "Detalle externo", debitCents: 99900, creditCents: 0 },
];

test("an authorized company member downloads only their company's center and ledger rows", () => {
  const actor = { organizationId: companyA.id, role: "team_manager" };
  assert.equal(canAccessAccountingOrganization(actor, companyA.id), true);

  const csv = buildAccountingExportCsv({
    tenantId,
    organization: companyA,
    fiscalYear: 2027,
    book: "ledger",
    accounts,
    entries,
    entryLines,
  });
  const rows = csv.replace(/^\uFEFF/, "").trim().split("\r\n");

  assert.equal(rows.length, 2);
  assert.match(rows[0], /"empresa";"centro";"empresa_id";"ejercicio";"tipo_fila"/);
  assert.match(rows[1], /"Empresa A";"Centro Norte";"company-a";2027;"movimiento"/);
  assert.match(rows[1], /"Asiento de A";"Detalle A";125,00;0,00/);
  assert.doesNotMatch(csv, /Empresa B|Centro Sur|company-b|Asiento de B|network-2|externo/);
});

test("a company member's request for another company's CSV is rejected by the access rule", () => {
  const actor = { organizationId: companyA.id, role: "team_manager" };

  assert.equal(canAccessAccountingOrganization(actor, companyB.id), false);
});

test("CSV rows keep the selected company and center in every exported row", () => {
  const csv = buildAccountingExportCsv({
    tenantId,
    organization: companyA,
    fiscalYear: 2027,
    book: "journal",
    accounts,
    entries,
    entryLines,
  });
  const rows = csv.replace(/^\uFEFF/, "").trim().split("\r\n");
  const exportedRows = rows.slice(1);

  assert.equal(exportedRows.length, 1);
  for (const row of exportedRows) {
    assert.match(row, /^"Empresa A";"Centro Norte";"company-a";2027;/);
  }
});

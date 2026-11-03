import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPayrollAccountingLines,
  resolvePayrollSourceRetry,
  validateIndependentPayrollReviewer,
  validatePayrollImport,
} from "./payroll-accounting.mjs";

const payroll = {
  organizationId: "company-a",
  periodKey: "2027-08",
  version: 3,
  status: "closed",
  receiptLines: [{
    workerRef: "FP-EMP-001",
    receiptRef: "REC-202708-ABC123",
    grossCents: 200_000,
    employerContributionCents: 40_000,
    netCents: 150_000,
    workerContributionCents: 12_000,
    withholdingCents: 20_000,
    advancesCents: 10_000,
    otherDeductionsCents: 8_000,
  }],
};

const accounts = {
  wagesExpenseAccountId: "wages",
  employerCostAccountId: "employer-cost",
  netPayableAccountId: "net",
  workerContributionAccountId: "worker-contribution",
  employerContributionAccountId: "employer-contribution",
  withholdingAccountId: "withholding",
  advancesAccountId: "advances",
  otherDeductionsAccountId: "other",
};

test("payroll import binds the source to company, period, version, and closed status", () => {
  const request = { organizationId: "company-a", expectedPeriodKey: "2027-08", expectedVersion: 3 };
  assert.equal(validatePayrollImport(payroll, request), null);
  assert.match(validatePayrollImport(payroll, { ...request, organizationId: "company-b" }), /empresa/);
  assert.match(validatePayrollImport(payroll, { ...request, expectedPeriodKey: "2027-09" }), /periodo/);
  assert.match(validatePayrollImport(payroll, { ...request, expectedVersion: 2 }), /versión/);
  assert.match(validatePayrollImport({ ...payroll, status: "reviewed" }, request), /cerradas/);
});

test("payroll import keeps every positive cost and deduction as a mapped draft line", () => {
  const lines = buildPayrollAccountingLines(payroll, accounts);
  assert.deepEqual(lines.map((line) => [line.accountId, line.debitCents, line.creditCents]), [
    ["wages", 200_000, 0],
    ["employer-cost", 40_000, 0],
    ["net", 0, 150_000],
    ["worker-contribution", 0, 12_000],
    ["employer-contribution", 0, 40_000],
    ["withholding", 0, 20_000],
    ["advances", 0, 10_000],
    ["other", 0, 8_000],
  ]);
  assert.equal(lines.reduce((sum, line) => sum + line.debitCents, 0), 240_000);
  assert.equal(lines.reduce((sum, line) => sum + line.creditCents, 0), 240_000);
  assert.ok(lines.every((line) => line.description.includes("REC-202708-ABC123")));
});

test("repeating an import returns its original draft and rejects changed account mappings", () => {
  const priorDraft = { id: "draft-1", requestFingerprint: "mapping-a" };
  assert.deepEqual(resolvePayrollSourceRetry(priorDraft, "mapping-a"), { entryId: "draft-1" });
  assert.deepEqual(resolvePayrollSourceRetry(priorDraft, "mapping-b"), {
    error: "Esta versión de nómina ya se importó con otras cuentas educativas.",
    status: 409,
  });
  assert.equal(resolvePayrollSourceRetry(null, "mapping-a"), null);
});

test("posting the payroll draft requires someone other than the preparer and payroll reviewer", () => {
  const run = { createdByUserId: "preparer", reviewedByUserId: "payroll-reviewer" };
  assert.match(validateIndependentPayrollReviewer(run, "preparer"), /distinta/);
  assert.match(validateIndependentPayrollReviewer(run, "payroll-reviewer"), /distinta/);
  assert.equal(validateIndependentPayrollReviewer(run, "accounting-reviewer"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePayrollWithholding } from "./tax-payroll-aggregation.mjs";

const runs = [
  { periodKey: "2027-07", receiptLines: [
    { employeeId: "employee-a", workerRef: "EMP-A", grossCents: 100000, withholdingCents: 10000 },
    { employeeId: "employee-b", workerRef: "EMP-B", grossCents: 50000, withholdingCents: 5000 },
  ] },
  { periodKey: "2027-08", receiptLines: [
    { employeeId: "employee-a", workerRef: "EMP-A", grossCents: 100000, withholdingCents: 10000 },
  ] },
];

test("model 111 aggregates gross and withholding across a quarter", () => {
  assert.deepEqual(aggregatePayrollWithholding(runs, "111"), {
    recipientCount: 2,
    withholdingBaseCents: 250000,
    withholdingCents: 25000,
    formData: {
      recipientCount: "2",
      withholdingBaseEuros: "2500.00",
      withholdingEuros: "250.00",
      resultEuros: "250.00",
    },
  });
});

test("model 190 totals recipients by fictional employee reference without personal details", () => {
  const result = aggregatePayrollWithholding(runs, "190");
  assert.equal(result.recipientCount, 2);
  assert.equal(result.withholdingBaseCents, 250000);
  assert.equal(result.withholdingCents, 25000);
  assert.equal(result.formData.annualBaseEuros, "2500.00");
  assert.equal(result.formData.annualWithholdingEuros, "250.00");
  assert.equal(result.formData.payrollCoverage, "partial");
  assert.equal(result.formData.payrollIncludedMonths, "julio, agosto");
  assert.equal(result.formData.payrollMissingMonths, "enero, febrero, marzo, abril, mayo, junio, septiembre, octubre, noviembre, diciembre");
  assert.match(result.formData.recipientSummary, /EMP-A: base 2000\.00 € · retención 200\.00 €/);
  assert.match(result.formData.recipientSummary, /EMP-B: base 500\.00 € · retención 50\.00 €/);
  assert.doesNotMatch(result.formData.recipientSummary, /@|NIF|DNI/);
});

test("model 190 marks a complete year when every linked month is present", () => {
  const fullYearRuns = Array.from({ length: 12 }, (_, index) => ({
    periodKey: `2027-${String(index + 1).padStart(2, "0")}`,
    receiptLines: [],
  }));
  const result = aggregatePayrollWithholding(fullYearRuns, "190");

  assert.equal(result.formData.payrollCoverage, "complete");
  assert.equal(result.formData.payrollIncludedMonths, "enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre, noviembre, diciembre");
  assert.equal(result.formData.payrollMissingMonths, "");
});

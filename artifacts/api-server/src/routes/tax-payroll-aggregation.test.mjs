import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePayrollWithholding } from "./tax-payroll-aggregation.mjs";

const runs = [
  { receiptLines: [
    { employeeId: "employee-a", workerRef: "EMP-A", grossCents: 100000, withholdingCents: 10000 },
    { employeeId: "employee-b", workerRef: "EMP-B", grossCents: 50000, withholdingCents: 5000 },
  ] },
  { receiptLines: [
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
  assert.match(result.formData.recipientSummary, /EMP-A: base 2000\.00 € · retención 200\.00 €/);
  assert.match(result.formData.recipientSummary, /EMP-B: base 500\.00 € · retención 50\.00 €/);
  assert.doesNotMatch(result.formData.recipientSummary, /@|NIF|DNI/);
});

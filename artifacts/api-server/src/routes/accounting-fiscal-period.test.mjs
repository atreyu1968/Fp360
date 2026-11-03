import assert from "node:assert/strict";
import test from "node:test";
import {
  getAccountingFiscalPeriod,
  getAccountingFiscalYearForDate,
  getAccountingFiscalYearPeriodMonth,
} from "./accounting-fiscal-period.mjs";

test("January fiscal years preserve calendar-year period numbering", () => {
  assert.deepEqual(getAccountingFiscalPeriod("2027-01-01", 1), { fiscalYear: 2027, period: 1 });
  assert.deepEqual(getAccountingFiscalPeriod("2027-12-31", 1), { fiscalYear: 2027, period: 12 });
});

test("fiscal periods roll across calendar years using the configured start month", () => {
  assert.deepEqual(getAccountingFiscalPeriod("2027-06-30", 7), { fiscalYear: 2026, period: 12 });
  assert.deepEqual(getAccountingFiscalPeriod("2027-07-01", 7), { fiscalYear: 2027, period: 1 });
  assert.deepEqual(getAccountingFiscalPeriod("2028-01-15", 7), { fiscalYear: 2027, period: 7 });
  assert.equal(getAccountingFiscalYearForDate("2027-09-15", 10), 2026);
});

test("fiscal period labels map to their real calendar months", () => {
  assert.deepEqual(getAccountingFiscalYearPeriodMonth(2027, 1, 7), { year: 2027, month: 7 });
  assert.deepEqual(getAccountingFiscalYearPeriodMonth(2027, 12, 7), { year: 2028, month: 6 });
});

test("invalid fiscal starts and dates are rejected", () => {
  assert.throws(() => getAccountingFiscalPeriod("2027-03-01", 13), RangeError);
  assert.throws(() => getAccountingFiscalPeriod("not-a-date", 1), RangeError);
});

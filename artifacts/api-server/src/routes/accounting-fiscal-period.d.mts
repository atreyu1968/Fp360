export function getAccountingFiscalPeriod(
  entryDate: string,
  fiscalYearStartMonth: number,
): { fiscalYear: number; period: number };

export function getAccountingFiscalYearPeriodMonth(
  fiscalYear: number,
  period: number,
  fiscalYearStartMonth: number,
): { year: number; month: number };

export function getAccountingFiscalYearForDate(entryDate: string, fiscalYearStartMonth: number): number;

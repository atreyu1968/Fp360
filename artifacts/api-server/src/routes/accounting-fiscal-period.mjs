export function getAccountingFiscalPeriod(entryDate, fiscalYearStartMonth) {
  if (!Number.isInteger(fiscalYearStartMonth) || fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) {
    throw new RangeError("El inicio del ejercicio fiscal debe estar entre enero y diciembre.");
  }
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(entryDate);
  if (!match) throw new RangeError("La fecha contable no es válida.");

  const calendarYear = Number(match[1]);
  const calendarMonth = Number(match[2]);
  if (calendarMonth < 1 || calendarMonth > 12) throw new RangeError("La fecha contable no es válida.");
  return {
    fiscalYear: calendarMonth >= fiscalYearStartMonth ? calendarYear : calendarYear - 1,
    period: ((calendarMonth - fiscalYearStartMonth + 12) % 12) + 1,
  };
}

export function getAccountingFiscalYearPeriodMonth(fiscalYear, period, fiscalYearStartMonth) {
  if (!Number.isInteger(fiscalYear) || !Number.isInteger(period) || period < 1 || period > 12
    || !Number.isInteger(fiscalYearStartMonth) || fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) {
    throw new RangeError("El ejercicio, periodo o inicio fiscal no es válido.");
  }
  const monthOffset = fiscalYearStartMonth - 1 + period - 1;
  return {
    year: fiscalYear + Math.floor(monthOffset / 12),
    month: (monthOffset % 12) + 1,
  };
}

export function getAccountingFiscalYearForDate(entryDate, fiscalYearStartMonth) {
  return getAccountingFiscalPeriod(entryDate, fiscalYearStartMonth).fiscalYear;
}

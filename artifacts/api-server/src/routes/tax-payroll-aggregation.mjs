export function aggregatePayrollWithholding(runs, modelCode) {
  const lines = runs.flatMap((run) => run.receiptLines);
  const withholdingBaseCents = lines.reduce((sum, line) => sum + line.grossCents, 0);
  const withholdingCents = lines.reduce((sum, line) => sum + line.withholdingCents, 0);
  const recipients = new Map();
  for (const line of lines) {
    const current = recipients.get(line.employeeId) ?? {
      workerRef: line.workerRef,
      baseCents: 0,
      withholdingCents: 0,
    };
    current.baseCents += line.grossCents;
    current.withholdingCents += line.withholdingCents;
    recipients.set(line.employeeId, current);
  }
  const euros = (cents) => (cents / 100).toFixed(2);
  const recipientCount = recipients.size;
  const months = [...new Set(runs.map((run) => run.periodKey.slice(-2)))].sort();
  const monthNames = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio",
    "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const includedMonths = months.map((month) => monthNames[Number(month) - 1]);
  const missingMonths = monthNames.filter((_, index) => !months.includes(String(index + 1).padStart(2, "0")));
  const formData = modelCode === "111" ? {
    recipientCount: String(recipientCount),
    withholdingBaseEuros: euros(withholdingBaseCents),
    withholdingEuros: euros(withholdingCents),
    resultEuros: euros(withholdingCents),
  } : {
    recipientCount: String(recipientCount),
    annualBaseEuros: euros(withholdingBaseCents),
    annualWithholdingEuros: euros(withholdingCents),
    recipientSummary: [...recipients.values()]
      .map((recipient) => `${recipient.workerRef}: base ${euros(recipient.baseCents)} € · retención ${euros(recipient.withholdingCents)} €`)
      .join("; "),
    payrollCoverage: missingMonths.length ? "partial" : "complete",
    payrollIncludedMonths: includedMonths.join(", "),
    payrollMissingMonths: missingMonths.join(", "),
  };
  return { recipientCount, withholdingBaseCents, withholdingCents, formData };
}

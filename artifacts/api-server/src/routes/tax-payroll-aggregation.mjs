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
  };
  return { recipientCount, withholdingBaseCents, withholdingCents, formData };
}

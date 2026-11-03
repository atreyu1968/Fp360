export const closedPayrollStatuses = new Set([
  "closed",
  "issued",
  "payment_prepared",
  "paid_simulated",
]);

export function validatePayrollImport(run, request) {
  if (run.organizationId !== request.organizationId) {
    return "La nómina no pertenece a la empresa seleccionada.";
  }
  if (run.periodKey !== request.expectedPeriodKey) {
    return "El periodo de la nómina cambió. Actualiza la pantalla antes de importar.";
  }
  if (run.version !== request.expectedVersion) {
    return "La versión de la nómina cambió. Actualiza la pantalla antes de importar.";
  }
  if (!closedPayrollStatuses.has(run.status)) {
    return "Solo se pueden importar nóminas cerradas.";
  }
  return null;
}

export function resolvePayrollSourceRetry(existingEntry, requestFingerprint) {
  if (!existingEntry) return null;
  if (existingEntry.requestFingerprint !== requestFingerprint) {
    return { error: "Esta versión de nómina ya se importó con otras cuentas educativas.", status: 409 };
  }
  return { entryId: existingEntry.id };
}

export function validateIndependentPayrollReviewer(run, actorUserId) {
  if (actorUserId === run.createdByUserId || actorUserId === run.reviewedByUserId) {
    return "Una persona distinta de quien preparó o revisó la nómina debe revisar y contabilizar este borrador.";
  }
  return null;
}

export function buildPayrollAccountingLines(run, accounts) {
  const lines = [];
  const append = (accountId, description, amount, side) => {
    if (amount <= 0) return;
    lines.push({
      accountId,
      description,
      debitCents: side === "debit" ? amount : 0,
      creditCents: side === "credit" ? amount : 0,
      thirdPartyOrganizationId: null,
    });
  };

  for (const receipt of run.receiptLines) {
    const reference = `${receipt.workerRef} · ${receipt.receiptRef}`;
    append(accounts.wagesExpenseAccountId, `Salario bruto · ${reference}`, receipt.grossCents, "debit");
    append(accounts.employerCostAccountId, `Coste educativo empresa · ${reference}`, receipt.employerContributionCents, "debit");
    append(accounts.netPayableAccountId, `Líquido educativo · ${reference}`, receipt.netCents, "credit");
    append(accounts.workerContributionAccountId, `Cuota educativa trabajador · ${reference}`, receipt.workerContributionCents, "credit");
    append(accounts.employerContributionAccountId, `Cuota educativa empresa · ${reference}`, receipt.employerContributionCents, "credit");
    append(accounts.withholdingAccountId, `Retención didáctica · ${reference}`, receipt.withholdingCents, "credit");
    append(accounts.advancesAccountId, `Anticipos · ${reference}`, receipt.advancesCents, "credit");
    append(accounts.otherDeductionsAccountId, `Otras deducciones · ${reference}`, receipt.otherDeductionsCents, "credit");
  }
  return lines;
}

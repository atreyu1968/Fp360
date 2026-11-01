export function buildAccountingLedger({ accounts, entries, lines, fiscalYear }) {
  const eligibleEntries = entries.filter((entry) =>
    entry.fiscalYear <= fiscalYear && entry.status !== "draft"
  );
  const entryById = new Map(eligibleEntries.map((entry) => [entry.id, entry]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const ledgerItems = [];

  for (const line of lines) {
    const entry = entryById.get(line.entryId);
    const account = accountById.get(line.accountId);
    if (entry && account) ledgerItems.push({ entry, line, account });
  }

  ledgerItems.sort((a, b) =>
    a.account.code.localeCompare(b.account.code, "es")
    || a.entry.entryDate.localeCompare(b.entry.entryDate)
    || (a.entry.entryNumber ?? 0) - (b.entry.entryNumber ?? 0)
    || a.line.lineNumber - b.line.lineNumber
    || a.entry.id.localeCompare(b.entry.id)
  );

  const runningBalances = new Map(accounts.map((account) => [account.id, 0]));
  for (const item of ledgerItems) {
    if (item.entry.fiscalYear >= fiscalYear) continue;
    const delta = item.account.normalBalance === "debit"
      ? item.line.debitCents - item.line.creditCents
      : item.line.creditCents - item.line.debitCents;
    runningBalances.set(item.account.id, (runningBalances.get(item.account.id) ?? 0) + delta);
  }

  const openingBalances = accounts.flatMap((account) => {
    const balanceCents = runningBalances.get(account.id) ?? 0;
    return balanceCents === 0 ? [] : [{ account, balanceCents }];
  });
  const movements = [];
  for (const item of ledgerItems) {
    if (item.entry.fiscalYear !== fiscalYear) continue;
    const delta = item.account.normalBalance === "debit"
      ? item.line.debitCents - item.line.creditCents
      : item.line.creditCents - item.line.debitCents;
    const balanceCents = (runningBalances.get(item.account.id) ?? 0) + delta;
    runningBalances.set(item.account.id, balanceCents);
    movements.push({ ...item, balanceCents });
  }

  return { openingBalances, movements };
}

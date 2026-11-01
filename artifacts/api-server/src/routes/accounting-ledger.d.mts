type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  normalBalance: string;
};

type LedgerEntry = {
  id: string;
  fiscalYear: number;
  entryDate: string;
  entryNumber: number | null;
  status: string;
  sourceReference: string | null;
  concept: string;
};

type LedgerLine = {
  entryId: string;
  accountId: string;
  lineNumber: number;
  description: string;
  debitCents: number;
  creditCents: number;
};

export function buildAccountingLedger(input: {
  accounts: readonly LedgerAccount[];
  entries: readonly LedgerEntry[];
  lines: readonly LedgerLine[];
  fiscalYear: number;
}): {
  openingBalances: Array<{ account: LedgerAccount; balanceCents: number }>;
  movements: Array<{
    account: LedgerAccount;
    entry: LedgerEntry;
    line: LedgerLine;
    balanceCents: number;
  }>;
};

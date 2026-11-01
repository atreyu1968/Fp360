type AccountingExportAccount = {
  id: string;
  tenantId: string;
  organizationId: string;
  code: string;
  name: string;
  normalBalance: string;
};

type AccountingExportEntry = {
  id: string;
  tenantId: string;
  organizationId: string;
  fiscalYear: number;
  period: number;
  entryDate: string;
  entryNumber: number | null;
  status: string;
  sourceType: string;
  sourceReference: string | null;
  concept: string;
};

type AccountingExportEntryLine = {
  tenantId: string;
  entryId: string;
  accountId: string;
  lineNumber: number;
  description: string;
  debitCents: number;
  creditCents: number;
};

export function buildAccountingExportCsv(input: {
  tenantId: string;
  organization: { id: string; name: string; center: string };
  fiscalYear: number;
  book: "journal" | "ledger";
  accounts: AccountingExportAccount[];
  entries: AccountingExportEntry[];
  entryLines: AccountingExportEntryLine[];
}): string;

export type PayrollAccountMapping = {
  wagesExpenseAccountId: string;
  employerCostAccountId: string;
  netPayableAccountId: string;
  workerContributionAccountId: string;
  employerContributionAccountId: string;
  withholdingAccountId: string;
  advancesAccountId: string;
  otherDeductionsAccountId: string;
};

export type PayrollImportRequest = {
  organizationId: string;
  expectedPeriodKey: string;
  expectedVersion: number;
};

export type PayrollRunSnapshot = {
  organizationId: string;
  periodKey: string;
  version: number;
  status: string;
  receiptLines: Array<{
    workerRef: string;
    receiptRef: string;
    grossCents: number;
    employerContributionCents: number;
    netCents: number;
    workerContributionCents: number;
    withholdingCents: number;
    advancesCents: number;
    otherDeductionsCents: number;
  }>;
};

export const closedPayrollStatuses: Set<string>;
export function validatePayrollImport(run: PayrollRunSnapshot, request: PayrollImportRequest): string | null;
export function resolvePayrollSourceRetry(
  existingEntry: { id: string; requestFingerprint: string } | null | undefined,
  requestFingerprint: string,
): { entryId: string } | { error: string; status: number } | null;
export function validateIndependentPayrollReviewer(
  run: { createdByUserId: string; reviewedByUserId: string | null },
  actorUserId: string,
): string | null;
export function buildPayrollAccountingLines(run: PayrollRunSnapshot, accounts: PayrollAccountMapping): Array<{
  accountId: string;
  description: string;
  debitCents: number;
  creditCents: number;
  thirdPartyOrganizationId: null;
}>;

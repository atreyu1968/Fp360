type PayrollLine = {
  employeeId: string;
  workerRef: string;
  grossCents: number;
  withholdingCents: number;
};

type PayrollRun = { receiptLines: PayrollLine[] };

export function aggregatePayrollWithholding(
  runs: PayrollRun[],
  modelCode: "111" | "190",
): {
  recipientCount: number;
  withholdingBaseCents: number;
  withholdingCents: number;
  formData: Record<string, string>;
};

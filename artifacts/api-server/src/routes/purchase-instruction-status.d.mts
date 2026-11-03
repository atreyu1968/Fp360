export type PurchaseInstructionStatus =
  | "pending_review"
  | "authorized"
  | "executed"
  | "rejected";

export function purchaseInstructionStatus(
  status: string,
): PurchaseInstructionStatus | null;

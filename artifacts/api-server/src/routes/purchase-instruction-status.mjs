export function purchaseInstructionStatus(status) {
  switch (status) {
    case "draft":
    case "pending_review":
      return "pending_review";
    case "authorized":
    case "scheduled":
      return "authorized";
    case "executed":
    case "rejected":
      return status;
    case "cancelled":
      return null;
    default:
      throw new Error(`Unsupported supplier payment instruction status: ${status}`);
  }
}

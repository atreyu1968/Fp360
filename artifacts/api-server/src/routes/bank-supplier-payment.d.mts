interface SupplierInvoice {
  status: string;
  supplierOrganizationId: string;
}

interface PurchaseOrder {
  buyerOrganizationId: string;
  supplierOrganizationId: string;
}

export function supplierPaymentEligibility(args: {
  invoice: SupplierInvoice | undefined;
  order: PurchaseOrder | undefined;
  organizationId: string;
  alreadyHasPayment?: boolean;
}): { status: number; message: string } | null;

export function supplierPaymentReviewerError(
  transfer: { purchaseInvoiceId: string | null; createdByUserId: string },
  actor: { userId: string; role: string },
): string | null;

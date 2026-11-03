type PaymentInstruction = {
  id: string;
  organizationId: string;
  purchaseInvoiceId: string | null;
};

type DeepLinkIdentity = {
  organizationId?: string | null;
  role: string;
};

type DeepLinkOrganization = { id: string };

export function resolveSupplierPaymentDeepLink({
  search,
  identity,
  organizations,
  instruction,
}: {
  search: string;
  identity: DeepLinkIdentity;
  organizations: DeepLinkOrganization[];
  instruction?: PaymentInstruction | null;
}) {
  const params = new URLSearchParams(search);
  const organizationId = params.get('organizationId');
  const instructionId = params.get('supplierPaymentInstruction');
  const hasInstructionDeepLink = params.has('organizationId') || params.has('supplierPaymentInstruction');
  const canChooseOrganization = !identity.organizationId && ['teacher', 'administrator'].includes(identity.role);
  const deepLinkAccessAllowed = Boolean(
    organizationId
    && instructionId
    && (identity.organizationId
      ? identity.organizationId === organizationId
      : canChooseOrganization && organizations.some((organization) => organization.id === organizationId)),
  );
  // The dedicated endpoint verifies the invoice relationship, including invoices
  // outside the recent purchase list. Do not fall back to that bounded list.
  const canOpenDeepLink = Boolean(
    deepLinkAccessAllowed
    && instruction?.id === instructionId
    && instruction?.organizationId === organizationId
    && instruction?.purchaseInvoiceId,
  );

  return {
    organizationId,
    instructionId,
    hasInstructionDeepLink,
    deepLinkAccessAllowed,
    linkedInvoiceId: canOpenDeepLink ? instruction?.purchaseInvoiceId : undefined,
    canOpenDeepLink,
  };
}

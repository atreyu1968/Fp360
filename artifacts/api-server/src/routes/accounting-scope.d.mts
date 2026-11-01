export type AccountingScopeActor = {
  organizationId: string | null;
  role: string;
};

export function canAccessAccountingOrganization(
  actor: AccountingScopeActor,
  requestedOrganizationId: string,
): boolean;

type SalesInvoiceSource = {
  id: string;
  tenantId: string;
  issuerOrganizationId: string | null;
  reference: string;
  simulatedDate: string;
  buyerName: string;
  totalCents: number;
};
type PaymentSource = {
  id: string;
  tenantId: string;
  organizationId: string | null;
  invoiceId: string;
  simulatedDate: string;
  amountCents: number;
};
type PurchaseOrderSource = {
  id: string;
  tenantId: string;
  buyerOrganizationId: string;
};
type PurchaseInvoiceSource = {
  id: string;
  tenantId: string;
  orderId: string;
  status: string;
  invoiceReference: string;
  invoiceDate: string;
  supplierOrganizationId: string;
  totalCents: number;
};
type PartnerSource = { id: string; tenantId: string; name: string };

export function buildAccountingSources(input: {
  tenantId: string;
  organizationId: string;
  salesInvoices: readonly SalesInvoiceSource[];
  payments: readonly PaymentSource[];
  purchaseOrders: readonly PurchaseOrderSource[];
  purchaseInvoices: readonly PurchaseInvoiceSource[];
  partners: readonly PartnerSource[];
  imported: ReadonlySet<string>;
  postedSalesInvoiceIds: ReadonlySet<string>;
}): Array<{
  id: string;
  sourceType: "sales_invoice" | "payment" | "purchase_invoice";
  reference: string;
  sourceDate: string;
  partnerName: string;
  totalCents: number;
  status: string;
  imported: boolean;
}>;

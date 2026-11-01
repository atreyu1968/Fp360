export function canAccessAccountingOrganization(actor, requestedOrganizationId) {
  if (actor.organizationId) return actor.organizationId === requestedOrganizationId;
  return ["teacher", "administrator"].includes(actor.role);
}

export function buildAccountingSources({
  tenantId,
  organizationId,
  salesInvoices: allSalesInvoices,
  payments: allPayments,
  purchaseOrders: allPurchaseOrders,
  purchaseInvoices: allPurchaseInvoices,
  partners,
  imported,
  postedSalesInvoiceIds,
}) {
  const salesInvoices = allSalesInvoices.filter((invoice) =>
    invoice.tenantId === tenantId &&
    invoice.issuerOrganizationId === organizationId
  );
  const salesInvoiceById = new Map(salesInvoices.map((invoice) => [invoice.id, invoice]));
  const payments = allPayments.filter((payment) =>
    payment.tenantId === tenantId &&
    payment.organizationId === organizationId &&
    salesInvoiceById.has(payment.invoiceId)
  );
  const purchaseOrderIds = new Set(allPurchaseOrders
    .filter((order) => order.tenantId === tenantId && order.buyerOrganizationId === organizationId)
    .map((order) => order.id));
  const purchaseInvoices = allPurchaseInvoices.filter((invoice) =>
    invoice.tenantId === tenantId &&
    invoice.status === "conformed" &&
    purchaseOrderIds.has(invoice.orderId)
  );
  const partnerIds = new Set(purchaseInvoices.map((invoice) => invoice.supplierOrganizationId));
  const partnerNames = new Map(partners
    .filter((partner) => partner.tenantId === tenantId && partnerIds.has(partner.id))
    .map((partner) => [partner.id, partner.name]));

  return [
    ...salesInvoices.map((invoice) => ({
      id: invoice.id,
      sourceType: "sales_invoice",
      reference: invoice.reference,
      sourceDate: invoice.simulatedDate,
      partnerName: invoice.buyerName,
      totalCents: invoice.totalCents,
      status: "issued",
      imported: imported.has(`sales_invoice:${invoice.id}`),
    })),
    ...payments.map((payment) => {
      const invoice = salesInvoiceById.get(payment.invoiceId);
      return {
        id: payment.id,
        sourceType: "payment",
        reference: `Cobro ${invoice.reference}`,
        sourceDate: payment.simulatedDate,
        partnerName: invoice.buyerName,
        totalCents: payment.amountCents,
        status: postedSalesInvoiceIds.has(invoice.id) ? "recorded" : "awaiting_invoice",
        imported: imported.has(`payment:${payment.id}`),
      };
    }),
    ...purchaseInvoices.map((invoice) => ({
      id: invoice.id,
      sourceType: "purchase_invoice",
      reference: invoice.invoiceReference,
      sourceDate: invoice.invoiceDate,
      partnerName: partnerNames.get(invoice.supplierOrganizationId) ?? "Proveedor",
      totalCents: invoice.totalCents,
      status: invoice.status,
      imported: imported.has(`purchase_invoice:${invoice.id}`),
    })),
  ].sort((a, b) => b.sourceDate.localeCompare(a.sourceDate));
}

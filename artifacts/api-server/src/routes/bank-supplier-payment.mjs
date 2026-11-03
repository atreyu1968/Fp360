export function supplierPaymentEligibility({ invoice, order, organizationId, alreadyHasPayment = false }) {
  if (!invoice || !order || order.buyerOrganizationId !== organizationId) {
    return { status: 404, message: "Factura de proveedor no encontrada para esta empresa." };
  }
  if (invoice.status !== "conformed" || invoice.supplierOrganizationId !== order.supplierOrganizationId) {
    return { status: 409, message: "Solo se pueden preparar pagos de facturas conformadas y vigentes." };
  }
  if (alreadyHasPayment) {
    return { status: 409, message: "Esta factura ya tiene una instrucción de pago registrada." };
  }
  return null;
}

export function supplierPaymentReviewerError(transfer, actor) {
  if (!transfer.purchaseInvoiceId) return null;
  if (!["teacher", "administrator"].includes(actor.role) || actor.userId === transfer.createdByUserId) {
    return "La revisión del pago requiere un docente o administrador distinto de quien lo preparó.";
  }
  return null;
}

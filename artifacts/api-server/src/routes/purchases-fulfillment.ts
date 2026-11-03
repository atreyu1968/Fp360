import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter } from "express";
import {
  CreatePurchaseInvoiceBody, CreatePurchaseInvoiceParams, CreatePurchaseInvoiceResponse,
  DecidePurchaseInvoiceBody, DecidePurchaseInvoiceParams, DecidePurchaseInvoiceResponse,
  ListPurchaseInvoicesResponse, ListPurchaseReceiptsResponse,
  ListPurchaseSupplierAnalysisResponse, RecordPurchaseReceiptBody,
  RecordPurchaseReceiptParams, RecordPurchaseReceiptResponse,
} from "@workspace/api-zod";
import {
  db, fpActivity, fpOrganizations, fpProducts,
  fpPurchaseEvents, fpPurchaseInvoiceLines, fpPurchaseInvoices, fpPurchaseOrderLines,
  fpPurchaseOrders, fpPurchaseReceiptLines, fpPurchaseReceipts, fpBankTransfers,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";
import { purchaseInstructionStatus } from "./purchase-instruction-status.mjs";

const router: IRouter = Router();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const SIMULATED_DATE = "2027-09-15";
const MAX_ORDER_CENTS = 100_000_000;

class PurchaseFulfillmentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new PurchaseFulfillmentError(status, message); }
function isNetworkSupervisor(actor: AuthContext) {
  return actor.role === "administrator" || (actor.role === "teacher" && actor.organizationId === null);
}
function mayManageBuyer(actor: AuthContext, organizationId: string) {
  return actor.role === "administrator" || (actor.role === "teacher" && actor.organizationId === null) ||
    actor.organizationId === organizationId;
}
function reasonText(reason: string) {
  const normalized = reason.trim();
  if (normalized.length < 5) fail(400, "El motivo debe contener al menos cinco caracteres.");
  return normalized;
}
function iso(value: Date) { return value.toISOString(); }
function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function totalLine(quantity: number, unitPriceCents: number, igicBasisPoints: number) {
  const baseCents = quantity * unitPriceCents;
  const igicCents = Math.round(baseCents * igicBasisPoints / 10_000);
  return { baseCents, igicCents };
}
function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function audit(tx: Transaction, actor: AuthContext, action: string, description: string, reference: string) {
  await tx.insert(fpActivity).values({
    id: randomUUID(), tenantId: actor.tenantId, action,
    description: `${description} · Perfil: ${actor.role}`,
    reference, simulatedDate: SIMULATED_DATE,
  });
}
async function recordEvent(
  tx: Transaction, actor: AuthContext, requestId: string, action: string,
  fromStatus: string | null, toStatus: string, reason: string,
) {
  await tx.insert(fpPurchaseEvents).values({
    id: randomUUID(), tenantId: actor.tenantId, requestId, actorUserId: actor.userId,
    actorRole: actor.role, action, fromStatus, toStatus, reason, simulatedDate: SIMULATED_DATE,
  });
}
async function actorCanSeeBuyerOrder(actor: AuthContext, buyerOrganizationId: string) {
  return isNetworkSupervisor(actor) || actor.organizationId === buyerOrganizationId;
}

router.use("/redfp360/purchases", requireAuth);

async function readReceipt(id: string, actor: AuthContext) {
  const [receipt] = await db.select().from(fpPurchaseReceipts).where(and(
    eq(fpPurchaseReceipts.id, id), eq(fpPurchaseReceipts.tenantId, actor.tenantId),
  ));
  if (!receipt) fail(404, "Recepción no encontrada en tu empresa.");
  const [order] = await db.select().from(fpPurchaseOrders).where(and(
    eq(fpPurchaseOrders.id, receipt.orderId), eq(fpPurchaseOrders.tenantId, actor.tenantId),
  ));
  if (!order || !(await actorCanSeeBuyerOrder(actor, order.buyerOrganizationId))) {
    fail(404, "Recepción no encontrada en tu empresa.");
  }
  const [supplier] = await db.select({ name: fpOrganizations.name }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, order.supplierOrganizationId), eq(fpOrganizations.tenantId, actor.tenantId),
  ));
  const lines = await db.select({
    purchaseOrderLineId: fpPurchaseReceiptLines.purchaseOrderLineId,
    sku: fpPurchaseOrderLines.skuSnapshot,
    productName: fpPurchaseOrderLines.productNameSnapshot,
    quantityOrdered: fpPurchaseOrderLines.quantity,
    quantityAccepted: fpPurchaseReceiptLines.quantityAccepted,
    quantityRejected: fpPurchaseReceiptLines.quantityRejected,
    issueReason: fpPurchaseReceiptLines.issueReason,
  }).from(fpPurchaseReceiptLines).innerJoin(fpPurchaseOrderLines, and(
    eq(fpPurchaseOrderLines.id, fpPurchaseReceiptLines.purchaseOrderLineId),
    eq(fpPurchaseOrderLines.tenantId, fpPurchaseReceiptLines.tenantId),
  )).where(and(
    eq(fpPurchaseReceiptLines.receiptId, receipt.id),
    eq(fpPurchaseReceiptLines.tenantId, actor.tenantId),
  ));
  return RecordPurchaseReceiptResponse.parse({
    id: receipt.id, orderId: order.id, orderNumber: order.orderNumber,
    supplierName: supplier?.name ?? "Proveedor archivado",
    receiptReference: receipt.receiptReference, receivedDate: receipt.receivedDate,
    status: receipt.status,
    acceptedUnits: lines.reduce((sum, line) => sum + line.quantityAccepted, 0),
    rejectedUnits: lines.reduce((sum, line) => sum + line.quantityRejected, 0),
    lines, createdAt: iso(receipt.createdAt),
  });
}

router.post("/redfp360/purchases/orders/:id/receipts", requireSimulationWriteAccess, async (req, res): Promise<void> => {
  const params = RecordPurchaseReceiptParams.safeParse(req.params);
  const parsed = RecordPurchaseReceiptBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Revisa el albarán y sus cantidades.");
  const actor = req.auth!;
  if (!isDateOnly(parsed.data.receivedDate) || parsed.data.receivedDate < SIMULATED_DATE) {
    fail(400, "La fecha simulada de recepción debe ser posterior al inicio del caso.");
  }
  if (new Set(parsed.data.lines.map((line) => line.purchaseOrderLineId)).size !== parsed.data.lines.length) {
    fail(400, "Cada línea del pedido solo puede aparecer una vez en el albarán.");
  }
  const reference = parsed.data.receiptReference.trim().toUpperCase();
  if (!reference) fail(400, "Añade el número simulado del albarán.");
  const digest = fingerprint({ ...parsed.data, reference, userId: actor.userId });
  const receiptId = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(fpPurchaseOrders).where(and(
      eq(fpPurchaseOrders.id, params.data.id), eq(fpPurchaseOrders.tenantId, actor.tenantId),
    )).for("update");
    if (!order) fail(404, "Pedido de compra no encontrado en tu empresa.");
    if (!mayManageBuyer(actor, order.buyerOrganizationId)) {
      fail(403, "Solo la empresa compradora puede registrar una recepción.");
    }
    const [replay] = await tx.select().from(fpPurchaseReceipts).where(and(
      eq(fpPurchaseReceipts.id, parsed.data.operationId),
      eq(fpPurchaseReceipts.tenantId, actor.tenantId),
    ));
    if (replay) {
      if (replay.createdByUserId !== actor.userId || replay.requestFingerprint !== digest) {
        fail(409, "La clave de operación ya se utilizó con otros datos.");
      }
      return replay.id;
    }
    if (!["ordered", "partial"].includes(order.status)) {
      fail(409, "El pedido ya está recibido; no admite nuevas cantidades.");
    }
    const [duplicateReference] = await tx.select({ id: fpPurchaseReceipts.id }).from(fpPurchaseReceipts).where(and(
      eq(fpPurchaseReceipts.tenantId, actor.tenantId), eq(fpPurchaseReceipts.orderId, order.id),
      eq(fpPurchaseReceipts.receiptReference, reference),
    ));
    if (duplicateReference) fail(409, "El número de albarán ya está registrado para este pedido.");

    const orderLines = await tx.select().from(fpPurchaseOrderLines).where(and(
      eq(fpPurchaseOrderLines.purchaseOrderId, order.id),
      eq(fpPurchaseOrderLines.tenantId, actor.tenantId),
    ));
    const orderLinesById = new Map(orderLines.map((line) => [line.id, line]));
    const previous = await tx.select({
      purchaseOrderLineId: fpPurchaseReceiptLines.purchaseOrderLineId,
      accounted: sql<number>`sum(${fpPurchaseReceiptLines.quantityAccepted} + ${fpPurchaseReceiptLines.quantityRejected})::int`,
    }).from(fpPurchaseReceiptLines).innerJoin(fpPurchaseReceipts, and(
      eq(fpPurchaseReceipts.id, fpPurchaseReceiptLines.receiptId),
      eq(fpPurchaseReceipts.tenantId, fpPurchaseReceiptLines.tenantId),
    )).where(and(
      eq(fpPurchaseReceipts.orderId, order.id), eq(fpPurchaseReceipts.tenantId, actor.tenantId),
    )).groupBy(fpPurchaseReceiptLines.purchaseOrderLineId);
    const accounted = new Map(previous.map((line) => [line.purchaseOrderLineId, line.accounted]));

    let acceptedUnits = 0;
    let rejectedUnits = 0;
    for (const line of parsed.data.lines) {
      const orderLine = orderLinesById.get(line.purchaseOrderLineId);
      if (!orderLine) fail(404, "Una línea no corresponde a este pedido.");
      if (line.quantityAccepted + line.quantityRejected <= 0) fail(400, "Cada línea debe incluir unidades recibidas.");
      if (line.quantityRejected > 0 && (!line.issueReason || line.issueReason.trim().length < 5)) {
        fail(400, "Explica la incidencia para cada cantidad rechazada.");
      }
      if ((accounted.get(orderLine.id) ?? 0) + line.quantityAccepted + line.quantityRejected > orderLine.quantity) {
        fail(409, "La recepción supera las unidades pendientes de esta línea.");
      }
      acceptedUnits += line.quantityAccepted;
      rejectedUnits += line.quantityRejected;
    }
    if (!orderLines.length) fail(409, "El pedido no tiene líneas que recibir.");
    const incomingById = new Map(parsed.data.lines.map((line) => [
      line.purchaseOrderLineId, line.quantityAccepted + line.quantityRejected,
    ]));
    const isComplete = orderLines.every((line) =>
      (accounted.get(line.id) ?? 0) + (incomingById.get(line.id) ?? 0) === line.quantity,
    );
    const nextStatus = isComplete ? "received" : "partial";
    await tx.insert(fpPurchaseReceipts).values({
      id: parsed.data.operationId, tenantId: actor.tenantId, orderId: order.id,
      receiptReference: reference, receivedDate: parsed.data.receivedDate,
      status: nextStatus, createdByUserId: actor.userId, createdByRole: actor.role,
      requestFingerprint: digest,
    });
    await tx.insert(fpPurchaseReceiptLines).values(parsed.data.lines.map((line) => ({
      id: randomUUID(), tenantId: actor.tenantId, receiptId: parsed.data.operationId,
      purchaseOrderLineId: line.purchaseOrderLineId, quantityAccepted: line.quantityAccepted,
      quantityRejected: line.quantityRejected, issueReason: line.issueReason?.trim() || null,
    })));
    for (const line of parsed.data.lines) {
      if (!line.quantityAccepted) continue;
      const orderLine = orderLinesById.get(line.purchaseOrderLineId)!;
      const [product] = await tx.select().from(fpProducts).where(and(
        eq(fpProducts.id, orderLine.productId), eq(fpProducts.tenantId, actor.tenantId),
      )).for("update");
      if (!product) fail(409, "El producto del pedido ya no está disponible para registrar existencias.");
      if (product.stock + line.quantityAccepted > 2_147_483_647) {
        fail(409, "La recepción superaría el máximo de existencias permitido.");
      }
      await tx.update(fpProducts).set({ stock: product.stock + line.quantityAccepted })
        .where(and(eq(fpProducts.id, product.id), eq(fpProducts.tenantId, actor.tenantId)));
    }
    await tx.update(fpPurchaseOrders).set({
      status: nextStatus, receivedDate: isComplete ? parsed.data.receivedDate : null,
    }).where(and(eq(fpPurchaseOrders.id, order.id), eq(fpPurchaseOrders.tenantId, actor.tenantId)));
    const reason = `${reference}: ${acceptedUnits} aceptadas, ${rejectedUnits} rechazadas.`;
    await recordEvent(tx, actor, order.requestId, "Recepción registrada", order.status, nextStatus, reason);
    await audit(tx, actor, "Recepción de compra registrada", `${order.orderNumber} · ${reason}`, order.id);
    return parsed.data.operationId;
  });
  res.status(201).json(await readReceipt(receiptId, actor));
});

router.get("/redfp360/purchases/receipts", async (req, res) => {
  const actor = req.auth!;
  let condition;
  if (isNetworkSupervisor(actor)) {
    condition = eq(fpPurchaseReceipts.tenantId, actor.tenantId);
  } else if (actor.organizationId) {
    condition = and(
      eq(fpPurchaseReceipts.tenantId, actor.tenantId),
      eq(fpPurchaseOrders.buyerOrganizationId, actor.organizationId),
    );
  } else condition = and(eq(fpPurchaseReceipts.tenantId, actor.tenantId), sql`false`);
  const rows = await db.select({ id: fpPurchaseReceipts.id }).from(fpPurchaseReceipts)
    .innerJoin(fpPurchaseOrders, and(
      eq(fpPurchaseOrders.id, fpPurchaseReceipts.orderId),
      eq(fpPurchaseOrders.tenantId, fpPurchaseReceipts.tenantId),
    )).where(condition).orderBy(desc(fpPurchaseReceipts.createdAt)).limit(300);
  res.json(ListPurchaseReceiptsResponse.parse(await Promise.all(
    rows.map((row) => readReceipt(row.id, actor)),
  )));
});

async function readInvoice(id: string, actor: AuthContext) {
  const [invoice] = await db.select().from(fpPurchaseInvoices).where(and(
    eq(fpPurchaseInvoices.id, id), eq(fpPurchaseInvoices.tenantId, actor.tenantId),
  ));
  if (!invoice) fail(404, "Factura recibida no encontrada en tu empresa.");
  const [order] = await db.select().from(fpPurchaseOrders).where(and(
    eq(fpPurchaseOrders.id, invoice.orderId), eq(fpPurchaseOrders.tenantId, actor.tenantId),
  ));
  if (!order || !(await actorCanSeeBuyerOrder(actor, order.buyerOrganizationId))) {
    fail(404, "Factura recibida no encontrada en tu empresa.");
  }
  const [supplier] = await db.select({ name: fpOrganizations.name }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, invoice.supplierOrganizationId), eq(fpOrganizations.tenantId, actor.tenantId),
  ));
  const [paymentInstruction] = invoice.status === "conformed"
    ? await db.select({
      id: fpBankTransfers.id,
      status: fpBankTransfers.status,
    }).from(fpBankTransfers).where(and(
      eq(fpBankTransfers.tenantId, actor.tenantId),
      eq(fpBankTransfers.purchaseInvoiceId, invoice.id),
      eq(fpBankTransfers.organizationId, order.buyerOrganizationId),
    )).limit(1)
    : [];
  const instructionStatus = paymentInstruction
    ? purchaseInstructionStatus(paymentInstruction.status)
    : null;
  const receiptTotals = await db.select({
    purchaseOrderLineId: fpPurchaseReceiptLines.purchaseOrderLineId,
    accepted: sql<number>`sum(${fpPurchaseReceiptLines.quantityAccepted})::int`,
  }).from(fpPurchaseReceiptLines).innerJoin(fpPurchaseReceipts, and(
    eq(fpPurchaseReceipts.id, fpPurchaseReceiptLines.receiptId),
    eq(fpPurchaseReceipts.tenantId, fpPurchaseReceiptLines.tenantId),
  )).where(and(
    eq(fpPurchaseReceipts.orderId, order.id), eq(fpPurchaseReceipts.tenantId, actor.tenantId),
  )).groupBy(fpPurchaseReceiptLines.purchaseOrderLineId);
  const acceptedByLine = new Map(receiptTotals.map((row) => [row.purchaseOrderLineId, row.accepted]));
  const rows = await db.select({
    line: fpPurchaseInvoiceLines, orderLine: fpPurchaseOrderLines,
  }).from(fpPurchaseInvoiceLines).innerJoin(fpPurchaseOrderLines, and(
    eq(fpPurchaseOrderLines.id, fpPurchaseInvoiceLines.purchaseOrderLineId),
    eq(fpPurchaseOrderLines.tenantId, fpPurchaseInvoiceLines.tenantId),
  )).where(and(
    eq(fpPurchaseInvoiceLines.invoiceId, invoice.id),
    eq(fpPurchaseInvoiceLines.tenantId, actor.tenantId),
  ));
  const lines = rows.map(({ line, orderLine }) => ({
    id: line.id, purchaseOrderLineId: line.purchaseOrderLineId,
    sku: orderLine.skuSnapshot, productName: line.productNameSnapshot,
    quantity: line.quantity, expectedReceivedQuantity: acceptedByLine.get(line.purchaseOrderLineId) ?? 0,
    unitPriceCents: line.unitPriceCents, expectedUnitPriceCents: orderLine.unitPriceCents,
    igicBasisPoints: line.igicBasisPoints, expectedIgicBasisPoints: orderLine.igicBasisPoints,
    baseCents: line.baseCents, igicCents: line.igicCents,
    matches: line.quantity === (acceptedByLine.get(line.purchaseOrderLineId) ?? 0) &&
      line.unitPriceCents === orderLine.unitPriceCents &&
      line.igicBasisPoints === orderLine.igicBasisPoints,
  }));
  return {
    id: invoice.id, orderId: order.id, orderNumber: order.orderNumber,
    buyerOrganizationId: order.buyerOrganizationId,
    requestId: invoice.requestId, supplierOrganizationId: invoice.supplierOrganizationId,
    supplierName: supplier?.name ?? "Proveedor archivado",
    supersedesInvoiceId: invoice.supersedesInvoiceId,
    invoiceReference: invoice.invoiceReference, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate,
    status: invoice.status, matchStatus: invoice.matchStatus, matchSummary: invoice.matchSummary,
    baseCents: invoice.baseCents, igicCents: invoice.igicCents,
    freightCents: invoice.freightCents, totalCents: invoice.totalCents,
    decisionReason: invoice.decisionReason,
    supplierPaymentInstruction: instructionStatus && paymentInstruction
      ? { id: paymentInstruction.id, status: instructionStatus }
      : null,
    lines, createdByRole: invoice.createdByRole,
    createdAt: iso(invoice.createdAt),
  };
}

router.post("/redfp360/purchases/orders/:id/invoices", requireSimulationWriteAccess, async (req, res): Promise<void> => {
  const params = CreatePurchaseInvoiceParams.safeParse(req.params);
  const parsed = CreatePurchaseInvoiceBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Revisa el número, las fechas, los importes y las líneas de factura.");
  const actor = req.auth!;
  const reference = parsed.data.invoiceReference.trim().toUpperCase();
  if (!reference) fail(400, "El número de factura no puede estar vacío.");
  if (!isDateOnly(parsed.data.invoiceDate) ||
    (parsed.data.dueDate !== null && !isDateOnly(parsed.data.dueDate)) ||
    (parsed.data.dueDate && parsed.data.dueDate < parsed.data.invoiceDate)) {
    fail(400, "Revisa las fechas de factura y vencimiento.");
  }
  if (parsed.data.totalCents !== parsed.data.baseCents + parsed.data.igicCents + parsed.data.freightCents) {
    fail(400, "El total de la factura debe coincidir con base, IGIC y portes.");
  }
  if (new Set(parsed.data.lines.map((line) => line.purchaseOrderLineId)).size !== parsed.data.lines.length) {
    fail(400, "Cada línea del pedido solo puede aparecer una vez en la factura.");
  }
  const digest = fingerprint({ ...parsed.data, reference, userId: actor.userId });
  const invoiceId = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(fpPurchaseOrders).where(and(
      eq(fpPurchaseOrders.id, params.data.id), eq(fpPurchaseOrders.tenantId, actor.tenantId),
    )).for("update");
    if (!order) fail(404, "Pedido de compra no encontrado en tu empresa.");
    if (!mayManageBuyer(actor, order.buyerOrganizationId)) {
      fail(403, "Solo la empresa compradora puede registrar la factura recibida.");
    }
    const [replay] = await tx.select().from(fpPurchaseInvoices).where(and(
      eq(fpPurchaseInvoices.id, parsed.data.operationId),
      eq(fpPurchaseInvoices.tenantId, actor.tenantId),
    ));
    if (replay) {
      if (replay.createdByUserId !== actor.userId || replay.requestFingerprint !== digest) {
        fail(409, "La clave de operación ya se utilizó con otros datos.");
      }
      return replay.id;
    }
    if (order.status !== "received" || !order.receivedDate) {
      fail(409, "La factura solo se revisa cuando se hayan recibido o reclamado todas las líneas del pedido.");
    }
    if (parsed.data.invoiceDate < order.receivedDate) {
      fail(400, "La fecha de factura no puede ser anterior a la recepción completa.");
    }
    const [confirmed] = await tx.select({ id: fpPurchaseInvoices.id }).from(fpPurchaseInvoices).where(and(
      eq(fpPurchaseInvoices.orderId, order.id), eq(fpPurchaseInvoices.tenantId, actor.tenantId),
      eq(fpPurchaseInvoices.status, "conformed"),
    ));
    if (confirmed) fail(409, "El pedido ya tiene una factura conformada.");
    const [supplier] = await tx.select().from(fpOrganizations).where(and(
      eq(fpOrganizations.id, order.supplierOrganizationId),
      eq(fpOrganizations.tenantId, actor.tenantId),
    ));
    if (!supplier) fail(404, "Proveedor del pedido no encontrado.");
    const [duplicate] = await tx.select({ id: fpPurchaseInvoices.id }).from(fpPurchaseInvoices).where(and(
      eq(fpPurchaseInvoices.tenantId, actor.tenantId),
      eq(fpPurchaseInvoices.supplierOrganizationId, order.supplierOrganizationId),
      eq(fpPurchaseInvoices.invoiceReference, reference),
    ));
    if (duplicate) fail(409, "Ese número de factura ya está registrado para este proveedor.");

    const previousInvoices = await tx.select().from(fpPurchaseInvoices).where(and(
      eq(fpPurchaseInvoices.orderId, order.id), eq(fpPurchaseInvoices.tenantId, actor.tenantId),
    ));
    let superseded: typeof fpPurchaseInvoices.$inferSelect | undefined;
    if (parsed.data.supersedesInvoiceId) {
      superseded = previousInvoices.find((invoice) =>
        invoice.id === parsed.data.supersedesInvoiceId &&
        ["blocked", "correction_requested"].includes(invoice.status),
      );
      if (!superseded) fail(409, "Solo se puede rectificar una factura bloqueada o pendiente de corrección.");
    } else if (previousInvoices.length) {
      fail(409, "Vincula esta factura como rectificación de la factura anterior.");
    }

    const orderLines = await tx.select().from(fpPurchaseOrderLines).where(and(
      eq(fpPurchaseOrderLines.purchaseOrderId, order.id),
      eq(fpPurchaseOrderLines.tenantId, actor.tenantId),
    ));
    const orderLinesById = new Map(orderLines.map((line) => [line.id, line]));
    const acceptedRows = await tx.select({
      purchaseOrderLineId: fpPurchaseReceiptLines.purchaseOrderLineId,
      accepted: sql<number>`sum(${fpPurchaseReceiptLines.quantityAccepted})::int`,
    }).from(fpPurchaseReceiptLines).innerJoin(fpPurchaseReceipts, and(
      eq(fpPurchaseReceipts.id, fpPurchaseReceiptLines.receiptId),
      eq(fpPurchaseReceipts.tenantId, fpPurchaseReceiptLines.tenantId),
    )).where(and(
      eq(fpPurchaseReceipts.orderId, order.id), eq(fpPurchaseReceipts.tenantId, actor.tenantId),
    )).groupBy(fpPurchaseReceiptLines.purchaseOrderLineId);
    const acceptedByLine = new Map(acceptedRows.map((row) => [row.purchaseOrderLineId, row.accepted]));
    const receivedLines = orderLines.filter((line) => (acceptedByLine.get(line.id) ?? 0) > 0);
    const inputById = new Map(parsed.data.lines.map((line) => [line.purchaseOrderLineId, line]));
    if (parsed.data.lines.some((line) => !orderLinesById.has(line.purchaseOrderLineId))) {
      fail(404, "Una línea no corresponde a este pedido.");
    }
    let invoiceLinesBase = 0;
    let invoiceLinesIgic = 0;
    let expectedBase = 0;
    let expectedIgic = 0;
    for (const line of parsed.data.lines) {
      const row = orderLinesById.get(line.purchaseOrderLineId)!;
      const totals = totalLine(line.quantity, line.unitPriceCents, line.igicBasisPoints);
      invoiceLinesBase += totals.baseCents;
      invoiceLinesIgic += totals.igicCents;
      if (line.quantity !== (acceptedByLine.get(row.id) ?? 0) ||
        line.unitPriceCents !== row.unitPriceCents ||
        line.igicBasisPoints !== row.igicBasisPoints) {
        // Keep the transcribed invoice so the discrepancy can be reviewed and traced.
      }
    }
    for (const line of receivedLines) {
      const expected = acceptedByLine.get(line.id)!;
      const totals = totalLine(expected, line.unitPriceCents, line.igicBasisPoints);
      expectedBase += totals.baseCents;
      expectedIgic += totals.igicCents;
    }
    const lineMatches = receivedLines.length === parsed.data.lines.length &&
      receivedLines.every((line) => {
        const submitted = inputById.get(line.id);
        return submitted !== undefined &&
          submitted.quantity === (acceptedByLine.get(line.id) ?? 0) &&
          submitted.unitPriceCents === line.unitPriceCents &&
          submitted.igicBasisPoints === line.igicBasisPoints;
      });
    const headerMatches = parsed.data.baseCents === invoiceLinesBase &&
      parsed.data.igicCents === invoiceLinesIgic &&
      parsed.data.baseCents === expectedBase && parsed.data.igicCents === expectedIgic &&
      parsed.data.freightCents === order.freightCents &&
      parsed.data.totalCents === expectedBase + expectedIgic + order.freightCents;
    const matchStatus = lineMatches && headerMatches ? "match" : "difference";
    const matchSummary = matchStatus === "match"
      ? "Las cantidades recibidas, los precios, el IGIC y los portes coinciden con el pedido."
      : "Hay diferencias entre factura, pedido y recepción. No se puede conformar hasta corregirlas.";
    if (parsed.data.totalCents > MAX_ORDER_CENTS || invoiceLinesBase > MAX_ORDER_CENTS || invoiceLinesIgic > MAX_ORDER_CENTS) {
      fail(400, "El importe transcrito supera el límite didáctico de 1.000.000 €.");
    }
    if (superseded) {
      await tx.update(fpPurchaseInvoices).set({
        status: "rectified", decisionReason: `Rectificada por ${reference}.`,
      }).where(and(eq(fpPurchaseInvoices.id, superseded.id), eq(fpPurchaseInvoices.tenantId, actor.tenantId)));
      await recordEvent(tx, actor, order.requestId, "Factura anterior rectificada", superseded.status, "rectified",
        `Nueva factura ${reference} sustituye a ${superseded.invoiceReference}.`);
    }
    await tx.insert(fpPurchaseInvoices).values({
      id: parsed.data.operationId, tenantId: actor.tenantId, orderId: order.id,
      requestId: order.requestId, supplierOrganizationId: order.supplierOrganizationId,
      supersedesInvoiceId: superseded?.id ?? null, invoiceReference: reference,
      invoiceDate: parsed.data.invoiceDate, dueDate: parsed.data.dueDate,
      baseCents: parsed.data.baseCents, igicCents: parsed.data.igicCents,
      freightCents: parsed.data.freightCents, totalCents: parsed.data.totalCents,
      status: "pending_review", matchStatus, matchSummary, decisionReason: null,
      decisionByUserId: null, createdByUserId: actor.userId, createdByRole: actor.role,
      requestFingerprint: digest,
    });
    await tx.insert(fpPurchaseInvoiceLines).values(parsed.data.lines.map((line) => {
      const orderLine = orderLinesById.get(line.purchaseOrderLineId)!;
      const totals = totalLine(line.quantity, line.unitPriceCents, line.igicBasisPoints);
      return {
        id: randomUUID(), tenantId: actor.tenantId, invoiceId: parsed.data.operationId,
        purchaseOrderLineId: orderLine.id, productNameSnapshot: orderLine.productNameSnapshot,
        quantity: line.quantity, unitPriceCents: line.unitPriceCents,
        igicBasisPoints: line.igicBasisPoints, ...totals,
      };
    }));
    await recordEvent(tx, actor, order.requestId, "Factura de proveedor recibida", null, "pending_review",
      `${reference}: ${matchStatus === "match" ? "documentación coincidente" : "diferencias detectadas"}.`);
    await audit(tx, actor, "Factura de proveedor registrada",
      `${order.orderNumber} · ${reference} · ${matchStatus}. No se ha ordenado ningún pago.`, order.id);
    return parsed.data.operationId;
  });
  res.status(201).json(CreatePurchaseInvoiceResponse.parse(await readInvoice(invoiceId, actor)));
});

router.get("/redfp360/purchases/invoices", async (req, res) => {
  const actor = req.auth!;
  let condition;
  if (isNetworkSupervisor(actor)) {
    condition = eq(fpPurchaseInvoices.tenantId, actor.tenantId);
  } else if (actor.organizationId) {
    condition = and(
      eq(fpPurchaseInvoices.tenantId, actor.tenantId),
      eq(fpPurchaseOrders.buyerOrganizationId, actor.organizationId),
    );
  } else condition = and(eq(fpPurchaseInvoices.tenantId, actor.tenantId), sql`false`);
  const rows = await db.select({ id: fpPurchaseInvoices.id }).from(fpPurchaseInvoices)
    .innerJoin(fpPurchaseOrders, and(
      eq(fpPurchaseOrders.id, fpPurchaseInvoices.orderId),
      eq(fpPurchaseOrders.tenantId, fpPurchaseInvoices.tenantId),
    )).where(condition).orderBy(desc(fpPurchaseInvoices.createdAt)).limit(300);
  res.json(ListPurchaseInvoicesResponse.parse(await Promise.all(
    rows.map((row) => readInvoice(row.id, actor)),
  )));
});

router.post("/redfp360/purchases/invoices/:id/decision", requireSimulationWriteAccess, async (req, res): Promise<void> => {
  const params = DecidePurchaseInvoiceParams.safeParse(req.params);
  const parsed = DecidePurchaseInvoiceBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Indica la decisión de factura y su motivo.");
  const actor = req.auth!;
  const reason = reasonText(parsed.data.reason);
  if (!["teacher", "administrator", "team_manager"].includes(actor.role)) {
    fail(403, "Solo Tesorería, el profesorado o administración pueden conformar facturas recibidas.");
  }
  await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(fpPurchaseInvoices).where(and(
      eq(fpPurchaseInvoices.id, params.data.id), eq(fpPurchaseInvoices.tenantId, actor.tenantId),
    )).for("update");
    if (!invoice) fail(404, "Factura recibida no encontrada en tu empresa.");
    const [order] = await tx.select().from(fpPurchaseOrders).where(and(
      eq(fpPurchaseOrders.id, invoice.orderId), eq(fpPurchaseOrders.tenantId, actor.tenantId),
    )).for("update");
    if (!order || !mayManageBuyer(actor, order.buyerOrganizationId)) {
      fail(404, "Factura recibida no encontrada en tu empresa.");
    }
    const decision = parsed.data.decision;
    if (invoice.status === decision && invoice.decisionReason === reason &&
      invoice.decisionByUserId === actor.userId) return;
    if (invoice.status !== "pending_review") fail(409, "La factura ya tiene una decisión registrada.");
    if (decision === "conformed" && invoice.matchStatus !== "match") {
      fail(400, "La factura tiene diferencias con el pedido o la recepción; solicita su rectificación antes de conformarla.");
    }
    const [alreadyConformed] = decision === "conformed"
      ? await tx.select({ id: fpPurchaseInvoices.id }).from(fpPurchaseInvoices).where(and(
        eq(fpPurchaseInvoices.orderId, order.id), eq(fpPurchaseInvoices.tenantId, actor.tenantId),
        eq(fpPurchaseInvoices.status, "conformed"),
      ))
      : [];
    if (alreadyConformed) fail(409, "Este pedido ya tiene otra factura conformada.");
    await tx.update(fpPurchaseInvoices).set({
      status: decision, decisionReason: reason, decisionByUserId: actor.userId,
    }).where(and(eq(fpPurchaseInvoices.id, invoice.id), eq(fpPurchaseInvoices.tenantId, actor.tenantId)));
    await recordEvent(tx, actor, invoice.requestId, `Factura ${decision}`, invoice.status, decision, reason);
    await audit(tx, actor, `Factura de proveedor ${decision}`,
      `${invoice.invoiceReference}: ${reason}. No se inicia ningún pago.`, invoice.orderId);
  });
  res.json(DecidePurchaseInvoiceResponse.parse(await readInvoice(params.data.id, actor)));
});

router.get("/redfp360/purchases/supplier-analysis", async (req, res) => {
  const actor = req.auth!;
  let scope;
  if (isNetworkSupervisor(actor)) {
    scope = eq(fpPurchaseOrders.tenantId, actor.tenantId);
  } else if (actor.organizationId) {
    const [organization] = await db.select({ role: fpOrganizations.role }).from(fpOrganizations).where(and(
      eq(fpOrganizations.id, actor.organizationId), eq(fpOrganizations.tenantId, actor.tenantId),
    ));
    if (!organization || !["buyer", "both"].includes(organization.role)) {
      res.json(ListPurchaseSupplierAnalysisResponse.parse([]));
      return;
    }
    scope = and(
      eq(fpPurchaseOrders.tenantId, actor.tenantId),
      eq(fpPurchaseOrders.buyerOrganizationId, actor.organizationId),
    );
  } else {
    res.json(ListPurchaseSupplierAnalysisResponse.parse([]));
    return;
  }
  const orders = await db.select({
    order: fpPurchaseOrders, supplierName: fpOrganizations.name,
    supplierIsActive: fpOrganizations.isActive, supplierId: fpOrganizations.id,
  }).from(fpPurchaseOrders).innerJoin(fpOrganizations, and(
    eq(fpOrganizations.id, fpPurchaseOrders.supplierOrganizationId),
    eq(fpOrganizations.tenantId, fpPurchaseOrders.tenantId),
  )).where(scope).orderBy(fpOrganizations.name);
  if (!orders.length) {
    res.json(ListPurchaseSupplierAnalysisResponse.parse([]));
    return;
  }
  const orderIds = orders.map((row) => row.order.id);
  const receiptTotals = await db.select({
    orderId: fpPurchaseReceipts.orderId,
    accepted: sql<number>`sum(${fpPurchaseReceiptLines.quantityAccepted})::int`,
    rejected: sql<number>`sum(${fpPurchaseReceiptLines.quantityRejected})::int`,
  }).from(fpPurchaseReceiptLines).innerJoin(fpPurchaseReceipts, and(
    eq(fpPurchaseReceipts.id, fpPurchaseReceiptLines.receiptId),
    eq(fpPurchaseReceipts.tenantId, fpPurchaseReceiptLines.tenantId),
  )).where(and(
    eq(fpPurchaseReceipts.tenantId, actor.tenantId),
    inArray(fpPurchaseReceipts.orderId, orderIds),
  )).groupBy(fpPurchaseReceipts.orderId);
  const receiptByOrder = new Map(receiptTotals.map((row) => [
    row.orderId, { accepted: row.accepted, rejected: row.rejected },
  ]));
  const bySupplier = new Map<string, {
    supplierOrganizationId: string; supplierName: string; isActive: boolean;
    orderCount: number; receivedOrderCount: number; onTimeOrderCount: number;
    acceptedUnits: number; rejectedUnits: number; complaintCount: number; orderedCents: number;
  }>();
  for (const { order, supplierName, supplierIsActive, supplierId } of orders) {
    let metric = bySupplier.get(supplierId);
    if (!metric) {
      metric = {
        supplierOrganizationId: supplierId, supplierName, isActive: supplierIsActive,
        orderCount: 0, receivedOrderCount: 0, onTimeOrderCount: 0,
        acceptedUnits: 0, rejectedUnits: 0, complaintCount: 0, orderedCents: 0,
      };
      bySupplier.set(supplierId, metric);
    }
    metric.orderCount += 1;
    metric.orderedCents += order.totalCents;
    const receipt = receiptByOrder.get(order.id);
    if (receipt) {
      metric.acceptedUnits += receipt.accepted;
      metric.rejectedUnits += receipt.rejected;
      if (receipt.rejected > 0) metric.complaintCount += 1;
    }
    if (order.status === "received" && order.receivedDate) {
      metric.receivedOrderCount += 1;
      if (order.expectedDate && order.receivedDate <= order.expectedDate) metric.onTimeOrderCount += 1;
    }
  }
  const result = [...bySupplier.values()].map((metric) => {
    const receivedForQuality = metric.acceptedUnits + metric.rejectedUnits;
    return {
      supplierOrganizationId: metric.supplierOrganizationId, supplierName: metric.supplierName,
      isActive: metric.isActive, orderCount: metric.orderCount,
      receivedOrderCount: metric.receivedOrderCount,
      onTimeBasisPoints: metric.receivedOrderCount
        ? Math.round(metric.onTimeOrderCount * 10_000 / metric.receivedOrderCount) : 0,
      acceptedUnits: metric.acceptedUnits, rejectedUnits: metric.rejectedUnits,
      qualityAcceptanceBasisPoints: receivedForQuality
        ? Math.round(metric.acceptedUnits * 10_000 / receivedForQuality) : 0,
      complaintCount: metric.complaintCount, orderedCents: metric.orderedCents,
      averageOrderCents: Math.round(metric.orderedCents / metric.orderCount),
    };
  }).sort((a, b) => b.onTimeBasisPoints - a.onTimeBasisPoints ||
    b.qualityAcceptanceBasisPoints - a.qualityAcceptanceBasisPoints ||
    a.supplierName.localeCompare(b.supplierName));
  res.json(ListPurchaseSupplierAnalysisResponse.parse(result));
});

const handlePurchaseFulfillmentError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof PurchaseFulfillmentError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error?.code === "23505" || error?.cause?.code === "23505") {
    res.status(409).json({ message: "El documento o referencia ya está registrado." });
    return;
  }
  next(error);
};
router.use(handlePurchaseFulfillmentError);
export default router;

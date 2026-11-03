import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, exists, inArray, or, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter } from "express";
import {
  AwardPurchaseOrderBody, AwardPurchaseOrderParams, AwardPurchaseOrderResponse,
  CancelPurchaseRequestBody, CancelPurchaseRequestParams, CancelPurchaseRequestResponse,
  CreatePurchaseOfferBody, CreatePurchaseOfferParams, CreatePurchaseOfferResponse,
  CreatePurchaseRequestBody, CreatePurchaseRequestResponse,
  DecidePurchaseRequestBody, DecidePurchaseRequestParams, DecidePurchaseRequestResponse,
  GetPurchaseRequestParams, GetPurchaseRequestResponse,
  ListPurchaseEventsParams, ListPurchaseEventsResponse,
  ListPurchaseOffersParams, ListPurchaseOffersResponse,
  ListPurchaseOrdersResponse, ListPurchaseRequestsResponse,
  ReviewPurchaseRequestBody, ReviewPurchaseRequestParams, ReviewPurchaseRequestResponse,
  SubmitPurchaseRequestBody, SubmitPurchaseRequestParams, SubmitPurchaseRequestResponse,
} from "@workspace/api-zod";
import {
  db, fpActivity, fpOrganizations, fpProducts,
  fpPurchaseEvents, fpPurchaseOfferLines, fpPurchaseOffers, fpPurchaseOrderLines,
  fpPurchaseOrders, fpPurchaseRequestLines, fpPurchaseRequests,
  fpPurchaseRequestSuppliers,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";
import { commonSimulationNetworkId } from "../lib/organization-scopes";

const router: IRouter = Router();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const SIMULATED_DATE = "2027-09-15";
const MAX_ORDER_CENTS = 100_000_000;
const OFFER_WEIGHTS = { price: 4000, delivery: 2500, quality: 2000, terms: 1500 };

class PurchaseError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new PurchaseError(status, message); }
function actorIsNetworkSupervisor(actor: AuthContext) {
  return actor.role === "administrator" || (actor.role === "teacher" && actor.organizationId === null);
}
function actorCanBuyFor(actor: AuthContext, organizationId: string) {
  return actor.role === "administrator" || (actor.role === "teacher" && actor.organizationId === null) ||
    actor.organizationId === organizationId;
}
function parseReason(value: string, label = "El motivo") {
  const reason = value.trim();
  if (reason.length < 5) fail(400, `${label} debe contener al menos cinco caracteres.`);
  return reason;
}
function requestHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function toIso(value: Date) { return value.toISOString(); }
function addDays(day: string, count: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function totalLine(quantity: number, unitPriceCents: number, igicBasisPoints: number) {
  const baseCents = quantity * unitPriceCents;
  const igicCents = Math.round(baseCents * igicBasisPoints / 10_000);
  return { baseCents, igicCents };
}
async function audit(tx: Transaction, actor: AuthContext, action: string, description: string, reference: string) {
  await tx.insert(fpActivity).values({
    id: randomUUID(), tenantId: actor.tenantId, action,
    description: `${description} · Perfil: ${actor.role}`,
    reference, simulatedDate: SIMULATED_DATE,
  });
}
async function event(
  tx: Transaction, actor: AuthContext, requestId: string, action: string,
  fromStatus: string | null, toStatus: string, reason: string,
) {
  await tx.insert(fpPurchaseEvents).values({
    id: randomUUID(), tenantId: actor.tenantId, requestId, actorUserId: actor.userId,
    actorRole: actor.role, action, fromStatus, toStatus, reason, simulatedDate: SIMULATED_DATE,
  });
}
async function requestForActor(requestId: string, actor: AuthContext) {
  const [request] = await db.select().from(fpPurchaseRequests).where(and(
    eq(fpPurchaseRequests.id, requestId), eq(fpPurchaseRequests.tenantId, actor.tenantId),
  ));
  if (!request) fail(404, "La solicitud no existe en tu red.");
  if (actorIsNetworkSupervisor(actor) || actor.organizationId === request.organizationId) return request;
  if (actor.organizationId) {
    const [invitation] = await db.select({ id: fpPurchaseRequestSuppliers.id }).from(fpPurchaseRequestSuppliers).where(and(
      eq(fpPurchaseRequestSuppliers.requestId, request.id),
      eq(fpPurchaseRequestSuppliers.tenantId, actor.tenantId),
      eq(fpPurchaseRequestSuppliers.supplierOrganizationId, actor.organizationId),
    ));
    if (invitation) return request;
  }
  fail(404, "La solicitud no está habilitada para tu organización.");
}
async function requireBuyer(request: { organizationId: string }, actor: AuthContext) {
  if (!actorCanBuyFor(actor, request.organizationId)) {
    fail(403, "Solo la empresa compradora o su profesorado pueden modificar esta solicitud.");
  }
}
async function readRequestDetail(id: string, actor: AuthContext) {
  const request = await requestForActor(id, actor);
  const [organization] = await db.select({
    id: fpOrganizations.id, name: fpOrganizations.name,
  }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, request.organizationId), eq(fpOrganizations.tenantId, actor.tenantId),
  ));
  const suppliers = await db.select({
    id: fpPurchaseRequestSuppliers.supplierOrganizationId,
    name: fpOrganizations.name, island: fpOrganizations.island,
  }).from(fpPurchaseRequestSuppliers).innerJoin(fpOrganizations, and(
    eq(fpOrganizations.id, fpPurchaseRequestSuppliers.supplierOrganizationId),
    eq(fpOrganizations.tenantId, fpPurchaseRequestSuppliers.tenantId),
  )).where(and(
    eq(fpPurchaseRequestSuppliers.tenantId, actor.tenantId),
    eq(fpPurchaseRequestSuppliers.requestId, request.id),
  )).orderBy(fpOrganizations.name);
  const lines = await db.select({
    id: fpPurchaseRequestLines.id, productId: fpPurchaseRequestLines.productId,
    sku: fpPurchaseRequestLines.skuSnapshot, productName: fpPurchaseRequestLines.productNameSnapshot,
    quantity: fpPurchaseRequestLines.quantity, justification: fpPurchaseRequestLines.justification,
  }).from(fpPurchaseRequestLines).where(and(
    eq(fpPurchaseRequestLines.requestId, request.id), eq(fpPurchaseRequestLines.tenantId, actor.tenantId),
  )).orderBy(fpPurchaseRequestLines.id);
  const offers = await db.select({
    id: fpPurchaseOffers.id, supplierOrganizationId: fpPurchaseOffers.supplierOrganizationId,
  }).from(fpPurchaseOffers).where(and(
    eq(fpPurchaseOffers.requestId, request.id), eq(fpPurchaseOffers.tenantId, actor.tenantId),
  ));
  const buyerCanCompare = actorIsNetworkSupervisor(actor) || actor.organizationId === request.organizationId;
  return GetPurchaseRequestResponse.parse({
    id: request.id, requestNumber: request.requestNumber,
    organizationId: request.organizationId, organizationName: organization?.name ?? "Empresa archivada",
    department: request.department, urgency: request.urgency, deadline: request.deadline,
    budgetCapCents: request.budgetCapCents, purpose: request.purpose, status: request.status,
    lineCount: lines.length,
    offerCount: buyerCanCompare ? offers.length : offers.filter((offer) => offer.supplierOrganizationId === actor.organizationId).length,
    requestedSuppliers: suppliers, lines,
    createdByRole: request.createdByRole, decisionReason: request.decisionReason,
    awardedReason: request.awardedReason, createdAt: toIso(request.createdAt), updatedAt: toIso(request.updatedAt),
  });
}
async function readRequestSummaries(actor: AuthContext) {
  let condition;
  if (actorIsNetworkSupervisor(actor)) {
    condition = eq(fpPurchaseRequests.tenantId, actor.tenantId);
  } else if (actor.organizationId) {
    condition = and(
      eq(fpPurchaseRequests.tenantId, actor.tenantId),
      or(
        eq(fpPurchaseRequests.organizationId, actor.organizationId),
        exists(db.select({ one: sql`1` }).from(fpPurchaseRequestSuppliers).where(and(
          eq(fpPurchaseRequestSuppliers.requestId, fpPurchaseRequests.id),
          eq(fpPurchaseRequestSuppliers.tenantId, actor.tenantId),
          eq(fpPurchaseRequestSuppliers.supplierOrganizationId, actor.organizationId),
        ))),
      ),
    );
  } else {
    condition = and(eq(fpPurchaseRequests.tenantId, actor.tenantId), sql`false`);
  }
  const requests = await db.select({
    id: fpPurchaseRequests.id, requestNumber: fpPurchaseRequests.requestNumber,
    organizationId: fpPurchaseRequests.organizationId, organizationName: fpOrganizations.name,
    department: fpPurchaseRequests.department, urgency: fpPurchaseRequests.urgency,
    deadline: fpPurchaseRequests.deadline, budgetCapCents: fpPurchaseRequests.budgetCapCents,
    status: fpPurchaseRequests.status, updatedAt: fpPurchaseRequests.updatedAt,
  }).from(fpPurchaseRequests).innerJoin(fpOrganizations, and(
    eq(fpOrganizations.id, fpPurchaseRequests.organizationId),
    eq(fpOrganizations.tenantId, fpPurchaseRequests.tenantId),
  )).where(condition).orderBy(desc(fpPurchaseRequests.updatedAt)).limit(300);
  if (!requests.length) return ListPurchaseRequestsResponse.parse([]);
  const ids = requests.map((request) => request.id);
  const lines = await db.select({
    requestId: fpPurchaseRequestLines.requestId, count: sql<number>`count(*)::int`,
  }).from(fpPurchaseRequestLines).where(and(
    eq(fpPurchaseRequestLines.tenantId, actor.tenantId), inArray(fpPurchaseRequestLines.requestId, ids),
  )).groupBy(fpPurchaseRequestLines.requestId);
  const offerRows = await db.select({
    requestId: fpPurchaseOffers.requestId, supplierId: fpPurchaseOffers.supplierOrganizationId,
  }).from(fpPurchaseOffers).where(and(
    eq(fpPurchaseOffers.tenantId, actor.tenantId), inArray(fpPurchaseOffers.requestId, ids),
  ));
  const lineCounts = new Map(lines.map((row) => [row.requestId, row.count]));
  const offerCounts = new Map<string, number>();
  for (const offer of offerRows) {
    if (actorIsNetworkSupervisor(actor) || actor.organizationId === requests.find((r) => r.id === offer.requestId)?.organizationId ||
      actor.organizationId === offer.supplierId) {
      offerCounts.set(offer.requestId, (offerCounts.get(offer.requestId) ?? 0) + 1);
    }
  }
  return ListPurchaseRequestsResponse.parse(requests.map((request) => ({
    ...request, lineCount: lineCounts.get(request.id) ?? 0,
    offerCount: offerCounts.get(request.id) ?? 0, updatedAt: toIso(request.updatedAt),
  })));
}

router.use("/redfp360/purchases", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/purchases/requests", async (req, res) => {
  res.json(await readRequestSummaries(req.auth!));
});
router.post("/redfp360/purchases/requests", async (req, res): Promise<void> => {
  const parsed = CreatePurchaseRequestBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa la solicitud, el presupuesto y las empresas proveedoras.");
  const actor = req.auth!;
  if (!actorCanBuyFor(actor, parsed.data.organizationId)) fail(403, "Solo puedes emitir compras para tu empresa.");
  if (new Set(parsed.data.requestedSupplierIds).size !== parsed.data.requestedSupplierIds.length) {
    fail(400, "Selecciona cada proveedor una sola vez.");
  }
  if (new Set(parsed.data.lines.map((line) => line.productId)).size !== parsed.data.lines.length) {
    fail(400, "Agrupa cada producto en una sola línea de solicitud.");
  }
  const fingerprint = requestHash(parsed.data);
  const id = await db.transaction(async (tx) => {
    const [replay] = await tx.select().from(fpPurchaseRequests).where(and(
      eq(fpPurchaseRequests.id, parsed.data.operationId), eq(fpPurchaseRequests.tenantId, actor.tenantId),
    )).for("update");
    if (replay) {
      if (replay.createdByUserId !== actor.userId || replay.requestFingerprint !== fingerprint) {
        fail(409, "La clave de operación ya se utilizó con otros datos.");
      }
      return replay.id;
    }
    const [buyer] = await tx.select().from(fpOrganizations).where(and(
      eq(fpOrganizations.id, parsed.data.organizationId), eq(fpOrganizations.tenantId, actor.tenantId),
      eq(fpOrganizations.isActive, true),
      sql`${fpOrganizations.role} IN ('buyer', 'both')`,
    )).for("share");
    if (!buyer) fail(404, "Selecciona una empresa compradora activa de tu red.");
    const suppliers = await tx.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
      eq(fpOrganizations.tenantId, actor.tenantId), eq(fpOrganizations.isActive, true),
      inArray(fpOrganizations.id, parsed.data.requestedSupplierIds),
      sql`${fpOrganizations.role} IN ('seller', 'both')`,
    )).for("share");
    if (suppliers.length !== parsed.data.requestedSupplierIds.length) {
      fail(404, "Todos los proveedores deben estar activos y vender en esta red.");
    }
    const products = await tx.select().from(fpProducts).where(and(
      eq(fpProducts.tenantId, actor.tenantId), eq(fpProducts.isActive, true),
      eq(fpProducts.isPublished, true),
      inArray(fpProducts.id, parsed.data.lines.map((line) => line.productId)),
    ));
    if (products.length !== parsed.data.lines.length) fail(404, "Una referencia ya no está activa o publicada.");
    const productSupplierIds = products
      .map((product) => product.supplierOrganizationId)
      .filter((id): id is string => Boolean(id));
    const participants = [...new Set([
      buyer.id,
      ...suppliers.map((supplier) => supplier.id),
      ...productSupplierIds,
    ])];
    if (!await commonSimulationNetworkId(tx, actor.tenantId, participants)) {
      fail(409, "La solicitud y sus proveedores deben pertenecer a la misma red económica.");
    }
    const productById = new Map(products.map((product) => [product.id, product]));
    await tx.insert(fpPurchaseRequests).values({
      id: parsed.data.operationId, tenantId: actor.tenantId,
      organizationId: buyer.id, requestNumber: `SC-${parsed.data.operationId.slice(0, 8).toUpperCase()}`,
      department: parsed.data.department.trim(), urgency: parsed.data.urgency,
      deadline: parsed.data.deadline, budgetCapCents: parsed.data.budgetCapCents,
      purpose: parsed.data.purpose.trim(), status: "draft",
      createdByUserId: actor.userId, createdByRole: actor.role, requestFingerprint: fingerprint,
    });
    await tx.insert(fpPurchaseRequestLines).values(parsed.data.lines.map((line) => {
      const product = productById.get(line.productId)!;
      return {
        id: randomUUID(), tenantId: actor.tenantId, requestId: parsed.data.operationId,
        productId: product.id, skuSnapshot: product.sku,
        productNameSnapshot: product.name, quantity: line.quantity,
        justification: line.justification.trim(),
      };
    }));
    await tx.insert(fpPurchaseRequestSuppliers).values(suppliers.map((supplier) => ({
      id: randomUUID(), tenantId: actor.tenantId,
      requestId: parsed.data.operationId, supplierOrganizationId: supplier.id,
    })));
    await event(tx, actor, parsed.data.operationId, "Solicitud creada", null, "draft", "Borrador de compra iniciado.");
    await audit(tx, actor, "Solicitud de compra creada",
      `${parsed.data.operationId.slice(0, 8)} · ${parsed.data.lines.length} líneas · ${buyer.name}.`,
      parsed.data.operationId);
    return parsed.data.operationId;
  });
  res.status(201).json(await readRequestDetail(id, actor));
});
router.get("/redfp360/purchases/requests/:id", async (req, res) => {
  const params = GetPurchaseRequestParams.safeParse(req.params);
  if (!params.success) fail(400, "El número de solicitud no es válido.");
  res.json(await readRequestDetail(params.data.id, req.auth!));
});

router.post("/redfp360/purchases/requests/:id/submit", async (req, res): Promise<void> => {
  const params = SubmitPurchaseRequestParams.safeParse(req.params);
  const parsed = SubmitPurchaseRequestBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Añade un motivo para solicitar ofertas.");
  const actor = req.auth!;
  const reason = parseReason(parsed.data.reason);
  await db.transaction(async (tx) => {
    const [request] = await tx.select().from(fpPurchaseRequests).where(and(
      eq(fpPurchaseRequests.id, params.data.id), eq(fpPurchaseRequests.tenantId, actor.tenantId),
    )).for("update");
    if (!request) fail(404, "Solicitud no encontrada en tu red.");
    await requireBuyer(request, actor);
    if (request.status === "requested") {
      const [replayed] = await tx.select({ id: fpPurchaseEvents.id }).from(fpPurchaseEvents).where(and(
        eq(fpPurchaseEvents.requestId, request.id), eq(fpPurchaseEvents.tenantId, actor.tenantId),
        eq(fpPurchaseEvents.action, "Solicitud enviada a proveedores"),
        eq(fpPurchaseEvents.actorUserId, actor.userId), eq(fpPurchaseEvents.reason, reason),
      ));
      if (replayed) return;
    }
    if (request.status !== "draft") fail(409, "Solo se puede enviar un borrador a proveedores.");
    await tx.update(fpPurchaseRequests).set({ status: "requested", updatedAt: new Date() })
      .where(eq(fpPurchaseRequests.id, request.id));
    await event(tx, actor, request.id, "Solicitud enviada a proveedores", "draft", "requested", reason);
    await audit(tx, actor, "Solicitud enviada a proveedores", `${request.requestNumber}: ${reason}`, request.id);
  });
  res.json(await readRequestDetail(params.data.id, actor));
});
router.post("/redfp360/purchases/requests/:id/offers", async (req, res): Promise<void> => {
  const params = CreatePurchaseOfferParams.safeParse(req.params);
  const parsed = CreatePurchaseOfferBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Revisa la oferta y todas las líneas solicitadas.");
  const actor = req.auth!;
  const id = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(fpPurchaseRequests).where(and(
      eq(fpPurchaseRequests.id, params.data.id), eq(fpPurchaseRequests.tenantId, actor.tenantId),
    )).for("update");
    if (!request) fail(404, "Solicitud no encontrada en tu red.");
    await requestForActor(request.id, actor);
    const supplierId = parsed.data.supplierOrganizationId;
    if (!["teacher", "administrator"].includes(actor.role) && actor.organizationId !== supplierId) {
      fail(403, "Solo el proveedor invitado puede presentar su oferta.");
    }
    const [invited] = await tx.select({ id: fpPurchaseRequestSuppliers.id }).from(fpPurchaseRequestSuppliers).where(and(
      eq(fpPurchaseRequestSuppliers.requestId, request.id), eq(fpPurchaseRequestSuppliers.tenantId, actor.tenantId),
      eq(fpPurchaseRequestSuppliers.supplierOrganizationId, supplierId),
    ));
    if (!invited) fail(404, "La empresa no está invitada a esta solicitud.");
    const [supplier] = await tx.select({ id: fpOrganizations.id, role: fpOrganizations.role })
      .from(fpOrganizations).where(and(
        eq(fpOrganizations.id, supplierId), eq(fpOrganizations.tenantId, actor.tenantId),
        eq(fpOrganizations.isActive, true),
      )).for("share");
    if (!supplier || !["seller", "both"].includes(supplier.role)) fail(404, "Proveedor no disponible.");
    if (!await commonSimulationNetworkId(tx, actor.tenantId, [request.organizationId, supplier.id])) {
      fail(409, "No se pueden comparar ofertas de otra red económica.");
    }
    const fingerprint = requestHash({ ...parsed.data, supplierId, userId: actor.userId });
    const [replay] = await tx.select().from(fpPurchaseOffers).where(and(
      eq(fpPurchaseOffers.id, parsed.data.operationId), eq(fpPurchaseOffers.tenantId, actor.tenantId),
    )).for("update");
    if (replay) {
      if (replay.createdByUserId !== actor.userId || replay.requestFingerprint !== fingerprint) {
        fail(409, "La clave de operación ya se utilizó con otros datos.");
      }
      return replay.id;
    }
    if (request.status !== "requested") fail(409, "El plazo para responder a esta solicitud ya está cerrado.");
    const [duplicate] = await tx.select({ id: fpPurchaseOffers.id }).from(fpPurchaseOffers).where(and(
      eq(fpPurchaseOffers.requestId, request.id), eq(fpPurchaseOffers.tenantId, actor.tenantId),
      eq(fpPurchaseOffers.supplierOrganizationId, supplierId),
    ));
    if (duplicate) fail(409, "Este proveedor ya ha presentado una oferta para la solicitud.");
    const requestLines = await tx.select().from(fpPurchaseRequestLines).where(and(
      eq(fpPurchaseRequestLines.requestId, request.id), eq(fpPurchaseRequestLines.tenantId, actor.tenantId),
    ));
    if (parsed.data.lines.length !== requestLines.length ||
      new Set(parsed.data.lines.map((line) => line.requestLineId)).size !== requestLines.length) {
      fail(400, "La oferta debe cotizar cada línea de la solicitud una sola vez.");
    }
    const requestLineIds = new Set(requestLines.map((line) => line.id));
    if (parsed.data.lines.some((line) => !requestLineIds.has(line.requestLineId))) {
      fail(400, "La oferta incluye un producto que no se solicitó.");
    }
    const requestLineById = new Map(requestLines.map((line) => [line.id, line]));
    let baseCents = 0;
    let igicCents = 0;
    for (const line of parsed.data.lines) {
      const requestLine = requestLineById.get(line.requestLineId)!;
      const total = totalLine(requestLine.quantity, line.unitPriceCents, line.igicBasisPoints);
      baseCents += total.baseCents;
      igicCents += total.igicCents;
    }
    if (baseCents + igicCents + parsed.data.freightCents > MAX_ORDER_CENTS) {
      fail(400, "El total cotizado supera el límite didáctico de 1.000.000 €.");
    }
    await tx.insert(fpPurchaseOffers).values({
      id: parsed.data.operationId, tenantId: actor.tenantId, requestId: request.id,
      supplierOrganizationId: supplier.id, quoteReference: parsed.data.quoteReference.trim(),
      deliveryDays: parsed.data.deliveryDays, paymentDays: parsed.data.paymentDays,
      freightCents: parsed.data.freightCents, qualityScoreBasisPoints: parsed.data.qualityScoreBasisPoints,
      validUntil: parsed.data.validUntil, createdByUserId: actor.userId, createdByRole: actor.role,
      requestFingerprint: fingerprint,
    });
    await tx.insert(fpPurchaseOfferLines).values(parsed.data.lines.map((line) => {
      const requestLine = requestLineById.get(line.requestLineId)!;
      return {
        id: randomUUID(), tenantId: actor.tenantId, offerId: parsed.data.operationId,
        requestLineId: requestLine.id, productNameSnapshot: requestLine.productNameSnapshot,
        quantity: requestLine.quantity, unitPriceCents: line.unitPriceCents,
        igicBasisPoints: line.igicBasisPoints,
      };
    }));
    await event(tx, actor, request.id, "Oferta recibida", "requested", "requested",
      `Oferta simulada ${parsed.data.quoteReference.trim()} incorporada a la comparación.`);
    await audit(tx, actor, "Oferta de proveedor simulada recibida",
      `${parsed.data.quoteReference.trim()} · ${baseCents + igicCents + parsed.data.freightCents} céntimos.`,
      request.id);
    return parsed.data.operationId;
  });
  const response = (await readPurchaseOffers(params.data.id, actor)).find((offer) => offer.id === id);
  if (!response) fail(500, "No se pudo recuperar la oferta registrada.");
  res.status(201).json(CreatePurchaseOfferResponse.parse(response));
});

type OfferRaw = {
  offer: typeof fpPurchaseOffers.$inferSelect;
  supplierName: string;
  supplierRole: string;
  lines: Array<{
    requestLineId: string; sku: string; productName: string; quantity: number;
    unitPriceCents: number; igicBasisPoints: number;
  }>;
};
async function readPurchaseOffers(requestId: string, actor: AuthContext) {
  const request = await requestForActor(requestId, actor);
  const canCompare = actorIsNetworkSupervisor(actor) || actor.organizationId === request.organizationId;
  let rows = await db.select({
    offer: fpPurchaseOffers, supplierName: fpOrganizations.name,
    supplierRole: fpOrganizations.role, requestLine: fpPurchaseRequestLines,
    offerLine: fpPurchaseOfferLines,
  }).from(fpPurchaseOffers)
    .innerJoin(fpOrganizations, and(
      eq(fpOrganizations.id, fpPurchaseOffers.supplierOrganizationId),
      eq(fpOrganizations.tenantId, fpPurchaseOffers.tenantId),
    ))
    .innerJoin(fpPurchaseOfferLines, and(
      eq(fpPurchaseOfferLines.offerId, fpPurchaseOffers.id),
      eq(fpPurchaseOfferLines.tenantId, fpPurchaseOffers.tenantId),
    ))
    .innerJoin(fpPurchaseRequestLines, and(
      eq(fpPurchaseRequestLines.id, fpPurchaseOfferLines.requestLineId),
      eq(fpPurchaseRequestLines.tenantId, fpPurchaseOffers.tenantId),
    )).where(and(
      eq(fpPurchaseOffers.tenantId, actor.tenantId), eq(fpPurchaseOffers.requestId, request.id),
      ...(canCompare ? [] : actor.organizationId
        ? [eq(fpPurchaseOffers.supplierOrganizationId, actor.organizationId)]
        : [sql`false`]),
    )).orderBy(fpOrganizations.name, fpPurchaseRequestLines.id);
  const grouped = new Map<string, OfferRaw>();
  for (const row of rows) {
    let item = grouped.get(row.offer.id);
    if (!item) {
      item = { offer: row.offer, supplierName: row.supplierName, supplierRole: row.supplierRole, lines: [] };
      grouped.set(row.offer.id, item);
    }
    item.lines.push({
      requestLineId: row.requestLine.id, sku: row.requestLine.skuSnapshot,
      productName: row.offerLine.productNameSnapshot, quantity: row.offerLine.quantity,
      unitPriceCents: row.offerLine.unitPriceCents, igicBasisPoints: row.offerLine.igicBasisPoints,
    });
  }
  const rawOffers = [...grouped.values()].map((entry) => {
    let baseCents = 0;
    let igicCents = 0;
    for (const line of entry.lines) {
      const totals = totalLine(line.quantity, line.unitPriceCents, line.igicBasisPoints);
      baseCents += totals.baseCents;
      igicCents += totals.igicCents;
    }
    return {
      ...entry, baseCents, igicCents,
      totalCents: baseCents + igicCents + entry.offer.freightCents,
    };
  });
  const fastest = Math.min(...rawOffers.map((offer) => offer.offer.deliveryDays), 1);
  const longestPaymentTerm = Math.max(...rawOffers.map((offer) => offer.offer.paymentDays), 0);
  const lowestTotal = Math.min(...rawOffers.map((offer) => offer.totalCents), 1);
  return ListPurchaseOffersResponse.parse(rawOffers.map((row) => {
    const priceScore = Math.round(lowestTotal / Math.max(1, row.totalCents) * 10000);
    const deliveryScore = Math.round(fastest / row.offer.deliveryDays * 10000);
    const termsScore = longestPaymentTerm === 0 ? 10000
      : Math.round(row.offer.paymentDays / longestPaymentTerm * 10000);
    const weighted = Math.round((
      priceScore * OFFER_WEIGHTS.price + deliveryScore * OFFER_WEIGHTS.delivery +
      row.offer.qualityScoreBasisPoints * OFFER_WEIGHTS.quality + termsScore * OFFER_WEIGHTS.terms
    ) / 10000);
    return {
      id: row.offer.id, requestId: row.offer.requestId,
      supplierOrganizationId: row.offer.supplierOrganizationId, supplierName: row.supplierName,
      quoteReference: row.offer.quoteReference, deliveryDays: row.offer.deliveryDays,
      paymentDays: row.offer.paymentDays, freightCents: row.offer.freightCents,
      qualityScoreBasisPoints: row.offer.qualityScoreBasisPoints, validUntil: row.offer.validUntil,
      baseCents: row.baseCents, igicCents: row.igicCents, totalCents: row.totalCents,
      priceScoreBasisPoints: priceScore, deliveryScoreBasisPoints: deliveryScore,
      termsScoreBasisPoints: termsScore, weightedScoreBasisPoints: weighted,
      lines: row.lines.map((line) => ({
        requestLineId: line.requestLineId, sku: line.sku, productName: line.productName,
        quantity: line.quantity, unitPriceCents: line.unitPriceCents,
        igicBasisPoints: line.igicBasisPoints,
        ...totalLine(line.quantity, line.unitPriceCents, line.igicBasisPoints),
      })),
      createdByRole: row.offer.createdByRole, createdAt: toIso(row.offer.createdAt),
    };
  }));
}
router.get("/redfp360/purchases/requests/:id/offers", async (req, res) => {
  const params = ListPurchaseOffersParams.safeParse(req.params);
  if (!params.success) fail(400, "El número de solicitud no es válido.");
  res.json(await readPurchaseOffers(params.data.id, req.auth!));
});

router.post("/redfp360/purchases/requests/:id/review", async (req, res): Promise<void> => {
  const params = ReviewPurchaseRequestParams.safeParse(req.params);
  const parsed = ReviewPurchaseRequestBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Indica un motivo para solicitar la aprobación.");
  const actor = req.auth!;
  const reason = parseReason(parsed.data.reason);
  await db.transaction(async (tx) => {
    const [request] = await tx.select().from(fpPurchaseRequests).where(and(
      eq(fpPurchaseRequests.id, params.data.id), eq(fpPurchaseRequests.tenantId, actor.tenantId),
    )).for("update");
    if (!request) fail(404, "Solicitud no encontrada en tu red.");
    await requireBuyer(request, actor);
    if (request.status === "pending_approval") {
      const [replayed] = await tx.select({ id: fpPurchaseEvents.id }).from(fpPurchaseEvents).where(and(
        eq(fpPurchaseEvents.requestId, request.id), eq(fpPurchaseEvents.action, "Solicitud enviada a aprobación"),
        eq(fpPurchaseEvents.actorUserId, actor.userId), eq(fpPurchaseEvents.reason, reason),
      ));
      if (replayed) return;
    }
    if (request.status !== "requested") fail(409, "La solicitud debe estar abierta a ofertas antes de pedir aprobación.");
    const [offerCount] = await tx.select({ count: sql<number>`count(*)::int` }).from(fpPurchaseOffers).where(and(
      eq(fpPurchaseOffers.requestId, request.id), eq(fpPurchaseOffers.tenantId, actor.tenantId),
    ));
    if (offerCount.count < 2) fail(400, "Compara al menos dos ofertas completas antes de solicitar aprobación.");
    await tx.update(fpPurchaseRequests).set({ status: "pending_approval", updatedAt: new Date() })
      .where(eq(fpPurchaseRequests.id, request.id));
    await event(tx, actor, request.id, "Solicitud enviada a aprobación", "requested", "pending_approval", reason);
    await audit(tx, actor, "Solicitud de compra pendiente de aprobación", `${request.requestNumber}: ${reason}`, request.id);
  });
  res.json(await readRequestDetail(params.data.id, actor));
});
router.post("/redfp360/purchases/requests/:id/decision", async (req, res): Promise<void> => {
  const params = DecidePurchaseRequestParams.safeParse(req.params);
  const parsed = DecidePurchaseRequestBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Indica aprobar o rechazar y explica la decisión.");
  const actor = req.auth!;
  if (!["teacher", "administrator"].includes(actor.role)) fail(403, "Solo profesorado o administración pueden aprobar la compra.");
  const reason = parseReason(parsed.data.reason);
  await db.transaction(async (tx) => {
    const [request] = await tx.select().from(fpPurchaseRequests).where(and(
      eq(fpPurchaseRequests.id, params.data.id), eq(fpPurchaseRequests.tenantId, actor.tenantId),
    )).for("update");
    if (!request) fail(404, "Solicitud no encontrada en tu red.");
    await requireBuyer(request, actor);
    const decision = parsed.data.decision;
    if ((request.status === decision && request.decisionReason === reason) && request.decisionByUserId === actor.userId) return;
    if (request.status !== "pending_approval") fail(409, "Solo se puede decidir una solicitud pendiente de aprobación.");
    const [count] = await tx.select({ count: sql<number>`count(*)::int` }).from(fpPurchaseOffers).where(and(
      eq(fpPurchaseOffers.requestId, request.id), eq(fpPurchaseOffers.tenantId, actor.tenantId),
    ));
    if (count.count < 2) fail(400, "No se puede aprobar la compra sin dos ofertas comparables.");
    await tx.update(fpPurchaseRequests).set({
      status: decision, decisionReason: reason, decisionByUserId: actor.userId, updatedAt: new Date(),
    }).where(eq(fpPurchaseRequests.id, request.id));
    await event(tx, actor, request.id, decision === "approved" ? "Solicitud aprobada" : "Solicitud rechazada",
      "pending_approval", decision, reason);
    await audit(tx, actor, `Solicitud de compra ${decision === "approved" ? "aprobada" : "rechazada"}`,
      `${request.requestNumber}: ${reason}`, request.id);
  });
  res.json(await readRequestDetail(params.data.id, actor));
});
router.post("/redfp360/purchases/requests/:id/award", async (req, res): Promise<void> => {
  const params = AwardPurchaseOrderParams.safeParse(req.params);
  const parsed = AwardPurchaseOrderBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Selecciona una oferta y justifica la decisión.");
  const actor = req.auth!;
  const reason = parseReason(parsed.data.reason);
  const purchaseOrderId = await db.transaction(async (tx) => {
    const [request] = await tx.select().from(fpPurchaseRequests).where(and(
      eq(fpPurchaseRequests.id, params.data.id), eq(fpPurchaseRequests.tenantId, actor.tenantId),
    )).for("update");
    if (!request) fail(404, "Solicitud no encontrada en tu red.");
    await requireBuyer(request, actor);
    const [replay] = await tx.select().from(fpPurchaseOrders).where(and(
      eq(fpPurchaseOrders.requestId, request.id), eq(fpPurchaseOrders.tenantId, actor.tenantId),
    ));
    if (replay) {
      if (replay.offerId === parsed.data.offerId && replay.awardedReason === reason && replay.createdByUserId === actor.userId) return replay.id;
      fail(409, "Esta solicitud ya tiene un pedido adjudicado.");
    }
    if (request.status !== "approved") fail(400, "El pedido requiere aprobación docente previa.");
    const [offer] = await tx.select().from(fpPurchaseOffers).where(and(
      eq(fpPurchaseOffers.id, parsed.data.offerId), eq(fpPurchaseOffers.tenantId, actor.tenantId),
      eq(fpPurchaseOffers.requestId, request.id),
    ));
    if (!offer) fail(404, "La oferta elegida no corresponde a esta solicitud.");
    const [supplier] = await tx.select({ name: fpOrganizations.name, isActive: fpOrganizations.isActive })
      .from(fpOrganizations).where(and(
        eq(fpOrganizations.id, offer.supplierOrganizationId), eq(fpOrganizations.tenantId, actor.tenantId),
      )).for("share");
    if (!supplier?.isActive) fail(409, "El proveedor se ha archivado; revisa las ofertas antes de adjudicar.");
    if (!await commonSimulationNetworkId(tx, actor.tenantId, [request.organizationId, offer.supplierOrganizationId])) {
      fail(409, "No se puede adjudicar una oferta de otra red económica.");
    }
    const offerLines = await tx.select({
      offerLine: fpPurchaseOfferLines, requestLine: fpPurchaseRequestLines,
    }).from(fpPurchaseOfferLines).innerJoin(fpPurchaseRequestLines, and(
      eq(fpPurchaseRequestLines.id, fpPurchaseOfferLines.requestLineId),
      eq(fpPurchaseRequestLines.tenantId, fpPurchaseOfferLines.tenantId),
    )).where(and(
      eq(fpPurchaseOfferLines.offerId, offer.id), eq(fpPurchaseOfferLines.tenantId, actor.tenantId),
    ));
    let baseCents = 0;
    let igicCents = 0;
    for (const row of offerLines) {
      const totals = totalLine(row.offerLine.quantity, row.offerLine.unitPriceCents, row.offerLine.igicBasisPoints);
      baseCents += totals.baseCents;
      igicCents += totals.igicCents;
    }
    const totalCents = baseCents + igicCents + offer.freightCents;
    if (totalCents > request.budgetCapCents) {
      fail(409, "La oferta supera el presupuesto máximo de la solicitud, incluidos IGIC y portes.");
    }
    const id = randomUUID();
    await tx.insert(fpPurchaseOrders).values({
      id, tenantId: actor.tenantId, requestId: request.id, offerId: offer.id,
      buyerOrganizationId: request.organizationId, supplierOrganizationId: offer.supplierOrganizationId,
      orderNumber: `PC-${id.slice(0, 8).toUpperCase()}`,
      baseCents, igicCents, freightCents: offer.freightCents, totalCents,
      status: "ordered", expectedDate: addDays(SIMULATED_DATE, offer.deliveryDays),
      awardedReason: reason, createdByUserId: actor.userId, createdByRole: actor.role,
      simulatedDate: SIMULATED_DATE,
    });
    await tx.insert(fpPurchaseOrderLines).values(offerLines.map((row) => {
      const totals = totalLine(row.offerLine.quantity, row.offerLine.unitPriceCents, row.offerLine.igicBasisPoints);
      return {
        id: randomUUID(), tenantId: actor.tenantId, purchaseOrderId: id,
        productId: row.requestLine.productId, skuSnapshot: row.requestLine.skuSnapshot,
        productNameSnapshot: row.offerLine.productNameSnapshot,
        quantity: row.offerLine.quantity, unitPriceCents: row.offerLine.unitPriceCents,
        igicBasisPoints: row.offerLine.igicBasisPoints, ...totals,
      };
    }));
    await tx.update(fpPurchaseRequests).set({
      status: "ordered", awardedReason: reason, awardedOfferId: offer.id, updatedAt: new Date(),
    }).where(eq(fpPurchaseRequests.id, request.id));
    await event(tx, actor, request.id, "Pedido de compra emitido", "approved", "ordered", reason);
    await audit(tx, actor, "Pedido de compra simulado emitido",
      `${request.requestNumber} · ${supplier.name} · ${totalCents} céntimos. El stock cambia al registrar la recepción.`,
      id);
    return id;
  });
  const order = await readPurchaseOrder(purchaseOrderId, actor);
  res.status(201).json(AwardPurchaseOrderResponse.parse(order));
});
router.post("/redfp360/purchases/requests/:id/cancel", async (req, res): Promise<void> => {
  const params = CancelPurchaseRequestParams.safeParse(req.params);
  const parsed = CancelPurchaseRequestBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Indica el motivo de cancelación.");
  const actor = req.auth!;
  const reason = parseReason(parsed.data.reason);
  await db.transaction(async (tx) => {
    const [request] = await tx.select().from(fpPurchaseRequests).where(and(
      eq(fpPurchaseRequests.id, params.data.id), eq(fpPurchaseRequests.tenantId, actor.tenantId),
    )).for("update");
    if (!request) fail(404, "Solicitud no encontrada en tu red.");
    await requireBuyer(request, actor);
    if (request.status === "cancelled" && request.decisionReason === reason) return;
    if (!["draft", "requested", "pending_approval", "approved", "rejected"].includes(request.status)) {
      fail(409, "Un pedido emitido no se borra; conserva su historial y registra una incidencia de recepción.");
    }
    await tx.update(fpPurchaseRequests).set({
      status: "cancelled", decisionReason: reason, updatedAt: new Date(),
    }).where(eq(fpPurchaseRequests.id, request.id));
    await event(tx, actor, request.id, "Solicitud cancelada", request.status, "cancelled", reason);
    await audit(tx, actor, "Solicitud de compra cancelada", `${request.requestNumber}: ${reason}`, request.id);
  });
  res.json(await readRequestDetail(params.data.id, actor));
});
router.get("/redfp360/purchases/requests/:id/events", async (req, res) => {
  const params = ListPurchaseEventsParams.safeParse(req.params);
  if (!params.success) fail(400, "El número de solicitud no es válido.");
  const request = await requestForActor(params.data.id, req.auth!);
  const actor = req.auth!;
  const buyerCanCompare = actorIsNetworkSupervisor(actor) || actor.organizationId === request.organizationId;
  const rows = await db.select().from(fpPurchaseEvents).where(and(
    eq(fpPurchaseEvents.requestId, request.id), eq(fpPurchaseEvents.tenantId, actor.tenantId),
    ...(buyerCanCompare ? [] : [
      eq(fpPurchaseEvents.actorUserId, actor.userId),
      eq(fpPurchaseEvents.action, "Oferta recibida"),
    ]),
  )).orderBy(fpPurchaseEvents.createdAt);
  res.json(ListPurchaseEventsResponse.parse(rows.map((row) => ({
    id: row.id, requestId: row.requestId, action: row.action,
    fromStatus: row.fromStatus, toStatus: row.toStatus, reason: row.reason,
    actorRole: row.actorRole, simulatedDate: row.simulatedDate, createdAt: toIso(row.createdAt),
  }))));
});
async function readPurchaseOrder(id: string, actor: AuthContext) {
  const [row] = await db.select({
    order: fpPurchaseOrders, requestNumber: fpPurchaseRequests.requestNumber,
  }).from(fpPurchaseOrders)
    .innerJoin(fpPurchaseRequests, and(
      eq(fpPurchaseRequests.id, fpPurchaseOrders.requestId),
      eq(fpPurchaseRequests.tenantId, fpPurchaseOrders.tenantId),
    ))
    .where(and(eq(fpPurchaseOrders.id, id), eq(fpPurchaseOrders.tenantId, actor.tenantId)));
  if (!row) fail(404, "Pedido de compra no encontrado en tu red.");
  if (!actorIsNetworkSupervisor(actor) && actor.organizationId !== row.order.buyerOrganizationId &&
    actor.organizationId !== row.order.supplierOrganizationId) {
    fail(404, "Pedido de compra no habilitado para tu organización.");
  }
  const [buyer, supplier] = await Promise.all([
    db.select({ name: fpOrganizations.name }).from(fpOrganizations).where(and(
      eq(fpOrganizations.id, row.order.buyerOrganizationId), eq(fpOrganizations.tenantId, actor.tenantId),
    )),
    db.select({ name: fpOrganizations.name }).from(fpOrganizations).where(and(
      eq(fpOrganizations.id, row.order.supplierOrganizationId), eq(fpOrganizations.tenantId, actor.tenantId),
    )),
  ]);
  const lines = await db.select({
    id: fpPurchaseOrderLines.id, productId: fpPurchaseOrderLines.productId,
    sku: fpPurchaseOrderLines.skuSnapshot, productName: fpPurchaseOrderLines.productNameSnapshot,
    quantity: fpPurchaseOrderLines.quantity, unitPriceCents: fpPurchaseOrderLines.unitPriceCents,
    igicBasisPoints: fpPurchaseOrderLines.igicBasisPoints,
    baseCents: fpPurchaseOrderLines.baseCents, igicCents: fpPurchaseOrderLines.igicCents,
  }).from(fpPurchaseOrderLines).where(and(
    eq(fpPurchaseOrderLines.purchaseOrderId, id), eq(fpPurchaseOrderLines.tenantId, actor.tenantId),
  ));
  return {
    id: row.order.id, orderNumber: row.order.orderNumber, requestId: row.order.requestId,
    requestNumber: row.requestNumber, buyerOrganizationId: row.order.buyerOrganizationId,
    buyerOrganizationName: buyer[0]?.name ?? "Empresa archivada",
    supplierOrganizationId: row.order.supplierOrganizationId,
    supplierName: supplier[0]?.name ?? "Proveedor archivado", offerId: row.order.offerId,
    baseCents: row.order.baseCents, igicCents: row.order.igicCents,
    freightCents: row.order.freightCents, totalCents: row.order.totalCents,
    status: row.order.status, expectedDate: row.order.expectedDate,
    receivedDate: row.order.receivedDate,
    awardedReason: row.order.awardedReason, simulatedDate: row.order.simulatedDate,
    lines, createdAt: toIso(row.order.createdAt),
  };
}
router.get("/redfp360/purchases/orders", async (req, res) => {
  const actor = req.auth!;
  let condition;
  if (actorIsNetworkSupervisor(actor)) {
    condition = eq(fpPurchaseOrders.tenantId, actor.tenantId);
  } else if (actor.organizationId) {
    condition = and(
      eq(fpPurchaseOrders.tenantId, actor.tenantId),
      or(eq(fpPurchaseOrders.buyerOrganizationId, actor.organizationId),
        eq(fpPurchaseOrders.supplierOrganizationId, actor.organizationId)),
    );
  } else condition = and(eq(fpPurchaseOrders.tenantId, actor.tenantId), sql`false`);
  const rows = await db.select({ id: fpPurchaseOrders.id }).from(fpPurchaseOrders)
    .where(condition).orderBy(desc(fpPurchaseOrders.createdAt)).limit(200);
  res.json(ListPurchaseOrdersResponse.parse(await Promise.all(
    rows.map((row) => readPurchaseOrder(row.id, actor)),
  )));
});

const handlePurchaseError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof PurchaseError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error?.code === "23505" || error?.cause?.code === "23505") {
    res.status(409).json({ message: "La solicitud, la oferta o el pedido ya se ha registrado." });
    return;
  }
  next(error);
};
router.use(handlePurchaseError);
export default router;

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  ActOnFp360CustomerAgreementBody,
  ActOnFp360CustomerAgreementParams,
  ActOnFp360CustomerAgreementResponse,
  ActOnFp360CustomerCaseBody,
  ActOnFp360CustomerCaseParams,
  ActOnFp360CustomerCaseResponse,
  ActOnFp360CustomerReturnBody,
  ActOnFp360CustomerReturnParams,
  ActOnFp360CustomerReturnResponse,
  CreateFp360CustomerAgreementBody,
  CreateFp360CustomerAgreementResponse,
  CreateFp360CustomerCaseBody,
  CreateFp360CustomerCaseResponse,
  CreateFp360CustomerReturnBody,
  CreateFp360CustomerReturnResponse,
  GetFp360CustomerServiceOverviewQueryParams,
  GetFp360CustomerServiceOverviewResponse,
} from "@workspace/api-zod";
import {
  db,
  fpCustomerAgreements,
  fpCustomerCaseEvents,
  fpCustomerCases,
  fpCustomerReturns,
  fpInvoices,
  fpLogisticsShipmentLines,
  fpLogisticsShipments,
  fpOrders,
  fpOrganizations,
  fpProducts,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
const SIMULATED_DATE = "2027-09-15";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class CustomerServiceError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof CustomerServiceError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 customer-service operation failed");
      next(error);
    });
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isTeacher(actor: AuthContext): boolean {
  return ["teacher", "administrator"].includes(actor.role);
}

function validScenarioDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && value >= "2027-01-01"
    && value <= "2028-12-31";
}

async function resolveOrganization(actor: AuthContext, organizationId: string): Promise<string | null> {
  if (actor.organizationId && actor.organizationId !== organizationId) return null;
  if (!actor.organizationId && !isTeacher(actor)) return null;
  const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return organization?.id ?? null;
}

async function priorEvent(actor: AuthContext, operationId: string, requestFingerprint: string) {
  const [event] = await db.select().from(fpCustomerCaseEvents).where(and(
    eq(fpCustomerCaseEvents.tenantId, actor.tenantId),
    eq(fpCustomerCaseEvents.operationId, operationId),
  )).limit(1);
  if (event && event.requestFingerprint !== requestFingerprint) {
    throw new CustomerServiceError(409, "El identificador de operación ya se usó con otros datos.");
  }
  return event ?? null;
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  details: {
    organizationId: string;
    entityType: string;
    entityId: string;
    caseId?: string | null;
    operationId: string;
    requestFingerprint: string;
    eventType: string;
    description: string;
    reference?: string | null;
  },
) {
  await tx.insert(fpCustomerCaseEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId: details.organizationId,
    entityType: details.entityType,
    entityId: details.entityId,
    caseId: details.caseId ?? null,
    operationId: details.operationId,
    requestFingerprint: details.requestFingerprint,
    eventType: details.eventType,
    description: details.description,
    reference: details.reference ?? null,
    actorUserId: actor.userId,
    actorName: actor.displayName,
    simulatedDate: SIMULATED_DATE,
  });
}

async function organizationInTenant(actor: AuthContext, organizationId: string) {
  const [organization] = await db.select().from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return organization ?? null;
}

async function caseResponse(row: typeof fpCustomerCases.$inferSelect) {
  const [customer] = await db.select({ name: fpOrganizations.name }).from(fpOrganizations).where(eq(fpOrganizations.id, row.customerOrganizationId)).limit(1);
  return {
    id: row.id,
    organizationId: row.organizationId,
    customerOrganizationId: row.customerOrganizationId,
    customerOrganizationName: customer?.name ?? "Organización de la red",
    caseRef: row.caseRef,
    sourceType: row.sourceType,
    sourceReference: row.sourceReference,
    category: row.category,
    priority: row.priority,
    status: row.status,
    request: row.request,
    standaloneReason: row.standaloneReason,
    assignedToName: row.assignedToName,
    proposedSolution: row.proposedSolution,
    rootCause: row.rootCause,
    satisfactionScore: row.satisfactionScore,
    openedDate: row.openedDate,
    dueDate: row.dueDate,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdByName: row.createdByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function agreementResponse(row: typeof fpCustomerAgreements.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agreementRef: row.agreementRef,
    productRef: row.productRef,
    terms: row.terms,
    validFrom: row.validFrom,
    validTo: row.validTo,
    replacementAllowed: row.replacementAllowed,
    compensationAllowed: row.compensationAllowed,
    status: row.status,
    createdByName: row.createdByName,
    approvedByName: row.approvedByName,
    createdAt: row.createdAt.toISOString(),
    approvedAt: row.approvedAt?.toISOString() ?? null,
  };
}

async function returnResponse(row: typeof fpCustomerReturns.$inferSelect) {
  const [[caseRow], [shipment]] = await Promise.all([
    db.select({ caseRef: fpCustomerCases.caseRef }).from(fpCustomerCases).where(eq(fpCustomerCases.id, row.caseId)).limit(1),
    db.select({ reference: fpLogisticsShipments.reference }).from(fpLogisticsShipments).where(eq(fpLogisticsShipments.id, row.shipmentId)).limit(1),
  ]);
  return {
    id: row.id,
    organizationId: row.organizationId,
    caseId: row.caseId,
    caseRef: caseRow?.caseRef ?? "INCIDENCIA",
    shipmentId: row.shipmentId,
    shipmentReference: shipment?.reference ?? "EXPEDICIÓN",
    shipmentLineId: row.shipmentLineId,
    returnRef: row.returnRef,
    productId: row.productId,
    productName: row.productName,
    unitsDelivered: row.unitsDelivered,
    unitsReported: row.unitsReported,
    unitsApproved: row.unitsApproved,
    unitsReceived: row.unitsReceived,
    condition: row.condition,
    reason: row.reason,
    status: row.status,
    creditNoteRequested: row.creditNoteRequested,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertCaseSource(
  actor: AuthContext,
  organizationId: string,
  customerOrganizationId: string,
  sourceType: string,
  sourceReference: string | undefined,
) {
  if (sourceType === "standalone") {
    if (sourceReference) throw new CustomerServiceError(400, "Una incidencia autónoma no debe incluir documento de origen.");
    return;
  }
  if (!sourceReference?.trim()) throw new CustomerServiceError(400, "Indica el pedido, la factura o la expedición de referencia.");
  if (sourceType === "order") {
    const [order] = await db.select().from(fpOrders).where(and(
      eq(fpOrders.tenantId, actor.tenantId), eq(fpOrders.reference, sourceReference.trim()),
    )).limit(1);
    if (!order || order.buyerOrganizationId !== customerOrganizationId) {
      throw new CustomerServiceError(404, "No se encontró el pedido para la organización cliente seleccionada.");
    }
    const [shipment] = await db.select({ id: fpLogisticsShipments.id }).from(fpLogisticsShipments).where(and(
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
      eq(fpLogisticsShipments.orderId, order.id),
      eq(fpLogisticsShipments.originOrganizationId, organizationId),
    )).limit(1);
    if (!shipment) throw new CustomerServiceError(409, "El pedido todavía no tiene una expedición vinculada a esta empresa.");
    return;
  }
  if (sourceType === "invoice") {
    const [invoice] = await db.select().from(fpInvoices).where(and(
      eq(fpInvoices.tenantId, actor.tenantId), eq(fpInvoices.reference, sourceReference.trim()),
    )).limit(1);
    if (!invoice || invoice.issuerOrganizationId !== organizationId) {
      throw new CustomerServiceError(404, "No se encontró la factura emitida por esta empresa.");
    }
    const [order] = await db.select().from(fpOrders).where(and(
      eq(fpOrders.id, invoice.orderId), eq(fpOrders.tenantId, actor.tenantId),
    )).limit(1);
    if (!order || order.buyerOrganizationId !== customerOrganizationId) {
      throw new CustomerServiceError(409, "La factura no corresponde a la organización cliente seleccionada.");
    }
    return;
  }
  const [shipment] = await db.select().from(fpLogisticsShipments).where(and(
    eq(fpLogisticsShipments.tenantId, actor.tenantId),
    eq(fpLogisticsShipments.reference, sourceReference.trim()),
    eq(fpLogisticsShipments.originOrganizationId, organizationId),
    eq(fpLogisticsShipments.destinationOrganizationId, customerOrganizationId),
  )).limit(1);
  if (!shipment) throw new CustomerServiceError(404, "No se encontró la expedición entre estas empresas.");
}

router.use("/redfp360/customer-service", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/customer-service/overview", route(async (request, response) => {
  const query = GetFp360CustomerServiceOverviewQueryParams.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "Selecciona una organización válida." });
    return;
  }
  const actor = request.auth as AuthContext;
  const organizationId = await resolveOrganization(actor, query.data.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  const [cases, customerOrganizations, agreements, products, shipmentRows] = await Promise.all([
    db.select().from(fpCustomerCases).where(and(
      eq(fpCustomerCases.tenantId, actor.tenantId), eq(fpCustomerCases.organizationId, organizationId),
    )).orderBy(desc(fpCustomerCases.updatedAt)).limit(250),
    db.select().from(fpOrganizations).where(and(
      eq(fpOrganizations.tenantId, actor.tenantId), eq(fpOrganizations.isActive, true),
    )).orderBy(fpOrganizations.name),
    db.select().from(fpCustomerAgreements).where(and(
      eq(fpCustomerAgreements.tenantId, actor.tenantId), eq(fpCustomerAgreements.organizationId, organizationId),
    )).orderBy(desc(fpCustomerAgreements.createdAt)).limit(100),
    db.select({ sku: fpProducts.sku, name: fpProducts.name }).from(fpProducts).where(and(
      eq(fpProducts.tenantId, actor.tenantId), eq(fpProducts.isActive, true),
    )).orderBy(fpProducts.name).limit(300),
    db.select().from(fpLogisticsShipments).where(and(
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
      eq(fpLogisticsShipments.originOrganizationId, organizationId),
      eq(fpLogisticsShipments.status, "delivered"),
    )).orderBy(desc(fpLogisticsShipments.deliveredDate)).limit(100),
  ]);
  const caseIds = cases.map((item) => item.id);
  const shipmentIds = shipmentRows.map((item) => item.id);
  const [eventRows, returnRows, shipmentLines, existingReturns] = await Promise.all([
    db.select().from(fpCustomerCaseEvents).where(and(
      eq(fpCustomerCaseEvents.tenantId, actor.tenantId),
      eq(fpCustomerCaseEvents.organizationId, organizationId),
      inArray(fpCustomerCaseEvents.caseId, caseIds),
    )).orderBy(desc(fpCustomerCaseEvents.createdAt)).limit(500),
    db.select({
      row: fpCustomerReturns,
      caseRef: fpCustomerCases.caseRef,
      shipmentReference: fpLogisticsShipments.reference,
    }).from(fpCustomerReturns)
      .innerJoin(fpCustomerCases, eq(fpCustomerCases.id, fpCustomerReturns.caseId))
      .innerJoin(fpLogisticsShipments, eq(fpLogisticsShipments.id, fpCustomerReturns.shipmentId))
      .where(and(
        eq(fpCustomerReturns.tenantId, actor.tenantId),
        eq(fpCustomerReturns.organizationId, organizationId),
      )).orderBy(desc(fpCustomerReturns.createdAt)).limit(200),
    db.select().from(fpLogisticsShipmentLines).where(and(
      eq(fpLogisticsShipmentLines.tenantId, actor.tenantId),
      inArray(fpLogisticsShipmentLines.shipmentId, shipmentIds),
    )),
    db.select().from(fpCustomerReturns).where(and(
      eq(fpCustomerReturns.tenantId, actor.tenantId),
      inArray(fpCustomerReturns.shipmentId, shipmentIds),
    )),
  ]);
  const organizationsById = new Map(customerOrganizations.map((item) => [item.id, item]));
  const caseReferences = new Map(cases.map((item) => [item.id, item.caseRef]));
  const returnedByLine = new Map<string, number>();
  for (const item of existingReturns) {
    if (item.status !== "rejected") {
      returnedByLine.set(item.shipmentLineId, (returnedByLine.get(item.shipmentLineId) ?? 0) + item.unitsReported);
    }
  }
  const linesByShipment = new Map<string, typeof shipmentLines>();
  for (const line of shipmentLines) {
    linesByShipment.set(line.shipmentId, [...(linesByShipment.get(line.shipmentId) ?? []), line]);
  }
  const returnSources = shipmentRows.flatMap((shipment) => {
    const destination = organizationsById.get(shipment.destinationOrganizationId);
    if (!destination || !shipment.deliveredDate) return [];
    const lines = (linesByShipment.get(shipment.id) ?? []).map((line) => ({
      shipmentLineId: line.id,
      productId: line.productId,
      productName: line.productName,
      deliveredUnits: line.receivedQuantity,
      alreadyRequestedUnits: returnedByLine.get(line.id) ?? 0,
    })).filter((line) => line.deliveredUnits > line.alreadyRequestedUnits);
    if (!lines.length) return [];
    return [{
      shipmentId: shipment.id,
      shipmentReference: shipment.reference,
      customerOrganizationId: destination.id,
      customerOrganizationName: destination.name,
      deliveredDate: shipment.deliveredDate,
      lines,
    }];
  });
  const eventResponses = eventRows.map((event) => ({
    id: event.id,
    caseId: event.caseId ?? "",
    caseRef: event.caseId ? caseReferences.get(event.caseId) ?? "" : "",
    eventType: event.eventType,
    description: event.description,
    reference: event.reference,
    actorName: event.actorName,
    simulatedDate: event.simulatedDate,
    createdAt: event.createdAt.toISOString(),
  }));
  const openCases = cases.filter((item) => !["closed", "rejected"].includes(item.status));
  const closedWithScore = cases.filter((item) => item.status === "closed" && item.satisfactionScore !== null);
  const resolvedThisMonth = eventRows.filter((event) => event.eventType === "case_resolved" && event.simulatedDate.startsWith("2027-09")).length;
  const summary = {
    openCases: openCases.length,
    highPriorityCases: openCases.filter((item) => ["high", "critical"].includes(item.priority)).length,
    resolvedThisMonth,
    averageSatisfaction: closedWithScore.length
      ? Math.round(closedWithScore.reduce((total, item) => total + (item.satisfactionScore ?? 0), 0) / closedWithScore.length * 10) / 10
      : 0,
    pendingReturns: returnRows.filter(({ row }) => !["closed", "rejected"].includes(row.status)).length,
    activeAgreements: agreements.filter((item) => item.status === "active").length,
  };
  response.json(GetFp360CustomerServiceOverviewResponse.parse({
    organizationId,
    simulatedDate: SIMULATED_DATE,
    customerOrganizations: customerOrganizations.filter((item) => item.id !== organizationId).map((item) => ({
      id: item.id, name: item.name, center: item.center, island: item.island,
    })),
    cases: await Promise.all(cases.map(caseResponse)),
    events: eventResponses,
    returns: await Promise.all(returnRows.map(({ row }) => returnResponse(row))),
    agreements: agreements.map(agreementResponse),
    returnSources,
    products,
    summary,
  }));
}));

router.post("/redfp360/customer-service/cases", route(async (request, response) => {
  const body = CreateFp360CustomerCaseBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa los datos obligatorios de la reclamación." });
    return;
  }
  const actor = request.auth as AuthContext;
  const input = body.data;
  const organizationId = await resolveOrganization(actor, input.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  const customer = await organizationInTenant(actor, input.customerOrganizationId);
  if (!customer || customer.id === organizationId) {
    response.status(400).json({ error: "Selecciona otra empresa ficticia activa de la red como cliente." });
    return;
  }
  if (input.sourceType === "standalone" && !input.standaloneReason?.trim()) {
    response.status(400).json({ error: "Explica por qué esta incidencia no tiene documento de origen." });
    return;
  }
  await assertCaseSource(actor, organizationId, customer.id, input.sourceType, input.sourceReference);
  const requestFingerprint = fingerprint(input);
  const prior = await priorEvent(actor, input.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpCustomerCases).where(and(
      eq(fpCustomerCases.id, prior.entityId), eq(fpCustomerCases.organizationId, organizationId),
    )).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360CustomerCaseResponse.parse(await caseResponse(existing)));
      return;
    }
  }
  const now = new Date();
  const caseRef = `INC-2027-${randomUUID().slice(0, 6).toUpperCase()}`;
  const [created] = await db.transaction(async (tx) => {
    const [caseRow] = await tx.insert(fpCustomerCases).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId,
      customerOrganizationId: customer.id,
      caseRef,
      sourceType: input.sourceType,
      sourceReference: input.sourceReference?.trim() || null,
      category: input.category,
      priority: input.priority,
      status: "draft",
      request: input.request.trim(),
      standaloneReason: input.standaloneReason?.trim() || null,
      openedDate: SIMULATED_DATE,
      operationId: input.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!caseRow) throw new CustomerServiceError(500, "No se pudo guardar el borrador.");
    await appendEvent(tx, actor, {
      organizationId,
      entityType: "case",
      entityId: caseRow.id,
      caseId: caseRow.id,
      operationId: input.operationId,
      requestFingerprint,
      eventType: "case_created",
      description: `Borrador ${caseRef} creado. La solicitud todavía no se ha enviado al cliente.`,
      reference: input.sourceReference?.trim() || null,
    });
    return [caseRow];
  });
  response.status(201).json(CreateFp360CustomerCaseResponse.parse(await caseResponse(created)));
}));

router.post("/redfp360/customer-service/cases/:caseId/actions", route(async (request, response) => {
  const params = ActOnFp360CustomerCaseParams.safeParse(request.params);
  const body = ActOnFp360CustomerCaseBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción seleccionada y sus datos." });
    return;
  }
  const actor = request.auth as AuthContext;
  const [caseRow] = await db.select().from(fpCustomerCases).where(and(
    eq(fpCustomerCases.id, params.data.caseId), eq(fpCustomerCases.tenantId, actor.tenantId),
  )).limit(1);
  if (!caseRow || !await resolveOrganization(actor, caseRow.organizationId)) {
    response.status(404).json({ error: "No se encontró el expediente en esta organización." });
    return;
  }
  const input = body.data;
  const requestFingerprint = fingerprint({ caseId: caseRow.id, ...input });
  const prior = await priorEvent(actor, input.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpCustomerCases).where(eq(fpCustomerCases.id, caseRow.id)).limit(1);
    if (existing) {
      response.json(ActOnFp360CustomerCaseResponse.parse(await caseResponse(existing)));
      return;
    }
  }
  const transitions: Record<string, string[]> = {
    validate: ["draft"],
    assign_to_me: ["pending"],
    start_investigation: ["pending", "assigned"],
    propose_solution: ["investigating"],
    resolve: ["solution_proposed"],
    close: ["resolved"],
    reject: ["draft", "pending"],
    request_evidence: ["pending", "assigned", "investigating"],
    record_evidence: ["pending", "assigned", "investigating"],
    draft_response: ["pending", "assigned", "investigating", "solution_proposed"],
  };
  if (!transitions[input.action]?.includes(caseRow.status)) {
    response.status(409).json({ error: "La acción no corresponde al estado actual del expediente." });
    return;
  }
  const textActions = ["request_evidence", "record_evidence", "draft_response", "propose_solution"];
  if (textActions.includes(input.action) && !input.description?.trim()) {
    response.status(400).json({ error: "Añade una nota breve para documentar esta actuación simulada." });
    return;
  }
  if (["resolve", "close"].includes(input.action) && !isTeacher(actor)) {
    response.status(403).json({ error: "La resolución y el cierre definitivo requieren revisión docente o administrativa." });
    return;
  }
  if (input.action === "reject" && !isTeacher(actor)) {
    response.status(403).json({ error: "Solo el profesorado o administración puede rechazar un expediente." });
    return;
  }
  if (input.action === "close" && (input.satisfactionScore === undefined || !input.rootCause?.trim())) {
    response.status(400).json({ error: "Para cerrar el caso, registra la causa raíz y la satisfacción simulada." });
    return;
  }
  const statuses: Record<string, string> = {
    validate: "pending",
    assign_to_me: "assigned",
    start_investigation: "investigating",
    propose_solution: "solution_proposed",
    resolve: "resolved",
    close: "closed",
    reject: "rejected",
  };
  const descriptions: Record<string, string> = {
    validate: "Borrador validado; el expediente queda pendiente de asignación.",
    assign_to_me: `Expediente asignado a ${actor.displayName}.`,
    start_investigation: "Investigación iniciada.",
    resolve: "Solución aprobada por revisión docente; no ejecuta cambios de stock o importes.",
    reject: "Expediente observado y rechazado con trazabilidad.",
    request_evidence: "Solicitud de evidencia preparada como nota interna; no se envía.",
    record_evidence: "Evidencia documentada como referencia interna.",
    draft_response: "Borrador de respuesta guardado; no se envía al cliente.",
  };
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const updateValues: Partial<typeof fpCustomerCases.$inferInsert> = {
      updatedAt: now,
    };
    if (statuses[input.action]) updateValues.status = statuses[input.action];
    if (input.action === "assign_to_me") {
      updateValues.assignedToUserId = actor.userId;
      updateValues.assignedToName = actor.displayName;
    }
    if (input.action === "propose_solution") updateValues.proposedSolution = input.description?.trim() ?? null;
    if (input.action === "resolve") {
      updateValues.rootCause = input.rootCause?.trim() ?? null;
      updateValues.resolvedAt = now;
    }
    if (input.action === "close") {
      updateValues.rootCause = input.rootCause?.trim() ?? caseRow.rootCause;
      updateValues.satisfactionScore = input.satisfactionScore ?? null;
      updateValues.closedAt = now;
    }
    const [saved] = await tx.update(fpCustomerCases).set(updateValues).where(and(
      eq(fpCustomerCases.id, caseRow.id),
      eq(fpCustomerCases.status, caseRow.status),
    )).returning();
    if (!saved) throw new CustomerServiceError(409, "El expediente cambió mientras se guardaba la actuación.");
    await appendEvent(tx, actor, {
      organizationId: caseRow.organizationId,
      entityType: "case",
      entityId: caseRow.id,
      caseId: caseRow.id,
      operationId: input.operationId,
      requestFingerprint,
      eventType: `case_${input.action}`,
      description: input.description?.trim() || descriptions[input.action] || `Actuación ${input.action} registrada.`,
      reference: input.reference?.trim() || null,
    });
    return [saved];
  });
  response.json(ActOnFp360CustomerCaseResponse.parse(await caseResponse(updated)));
}));

router.post("/redfp360/customer-service/returns", route(async (request, response) => {
  const body = CreateFp360CustomerReturnBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa las unidades, la expedición y la incidencia vinculada." });
    return;
  }
  const actor = request.auth as AuthContext;
  const input = body.data;
  const [caseRow] = await db.select().from(fpCustomerCases).where(and(
    eq(fpCustomerCases.id, input.caseId), eq(fpCustomerCases.tenantId, actor.tenantId),
  )).limit(1);
  if (!caseRow || !await resolveOrganization(actor, caseRow.organizationId)) {
    response.status(404).json({ error: "No se encontró el expediente de cliente." });
    return;
  }
  if (["closed", "rejected"].includes(caseRow.status)) {
    response.status(409).json({ error: "No se puede iniciar una devolución desde un expediente cerrado o rechazado." });
    return;
  }
  const requestFingerprint = fingerprint(input);
  const prior = await priorEvent(actor, input.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpCustomerReturns).where(eq(fpCustomerReturns.id, prior.entityId)).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360CustomerReturnResponse.parse(await returnResponse(existing)));
      return;
    }
  }
  const [shipment] = await db.select().from(fpLogisticsShipments).where(and(
    eq(fpLogisticsShipments.id, input.shipmentId),
    eq(fpLogisticsShipments.tenantId, actor.tenantId),
    eq(fpLogisticsShipments.originOrganizationId, caseRow.organizationId),
    eq(fpLogisticsShipments.destinationOrganizationId, caseRow.customerOrganizationId),
    eq(fpLogisticsShipments.status, "delivered"),
  )).limit(1);
  if (!shipment) {
    response.status(409).json({ error: "La devolución requiere una expedición entregada entre las empresas del expediente." });
    return;
  }
  const now = new Date();
  const [created] = await db.transaction(async (tx) => {
    const [line] = await tx.select().from(fpLogisticsShipmentLines).where(and(
      eq(fpLogisticsShipmentLines.id, input.shipmentLineId),
      eq(fpLogisticsShipmentLines.shipmentId, shipment.id),
      eq(fpLogisticsShipmentLines.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!line || line.receivedQuantity <= 0) {
      throw new CustomerServiceError(409, "La línea seleccionada no tiene unidades entregadas registradas.");
    }
    const priorReturns = await tx.select().from(fpCustomerReturns).where(and(
      eq(fpCustomerReturns.tenantId, actor.tenantId),
      eq(fpCustomerReturns.shipmentLineId, line.id),
    ));
    const alreadyRequested = priorReturns
      .filter((item) => item.status !== "rejected")
      .reduce((sum, item) => sum + item.unitsReported, 0);
    if (input.unitsReported > line.receivedQuantity - alreadyRequested) {
      throw new CustomerServiceError(409, `Solo quedan ${Math.max(0, line.receivedQuantity - alreadyRequested)} unidades entregadas disponibles para solicitar.`);
    }
    const [returnRow] = await tx.insert(fpCustomerReturns).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId: caseRow.organizationId,
      caseId: caseRow.id,
      shipmentId: shipment.id,
      shipmentLineId: line.id,
      returnRef: `DEV-2027-${randomUUID().slice(0, 6).toUpperCase()}`,
      productId: line.productId,
      productName: line.productName,
      unitsDelivered: line.receivedQuantity,
      unitsReported: input.unitsReported,
      condition: input.condition,
      reason: input.reason.trim(),
      status: "requested",
      operationId: input.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!returnRow) throw new CustomerServiceError(500, "No se pudo registrar la solicitud de devolución.");
    await appendEvent(tx, actor, {
      organizationId: caseRow.organizationId,
      entityType: "return",
      entityId: returnRow.id,
      caseId: caseRow.id,
      operationId: input.operationId,
      requestFingerprint,
      eventType: "return_requested",
      description: `${returnRow.returnRef}: ${input.unitsReported} unidad(es) solicitada(s); no se modifica inventario ni factura.`,
      reference: shipment.reference,
    });
    return [returnRow];
  });
  response.status(201).json(CreateFp360CustomerReturnResponse.parse(await returnResponse(created)));
}));

router.post("/redfp360/customer-service/returns/:returnId/actions", route(async (request, response) => {
  const params = ActOnFp360CustomerReturnParams.safeParse(request.params);
  const body = ActOnFp360CustomerReturnBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción de devolución." });
    return;
  }
  const actor = request.auth as AuthContext;
  const [returnRow] = await db.select().from(fpCustomerReturns).where(and(
    eq(fpCustomerReturns.id, params.data.returnId), eq(fpCustomerReturns.tenantId, actor.tenantId),
  )).limit(1);
  if (!returnRow || !await resolveOrganization(actor, returnRow.organizationId)) {
    response.status(404).json({ error: "No se encontró la devolución en esta organización." });
    return;
  }
  const input = body.data;
  const requestFingerprint = fingerprint({ returnId: returnRow.id, ...input });
  const prior = await priorEvent(actor, input.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpCustomerReturns).where(eq(fpCustomerReturns.id, returnRow.id)).limit(1);
    if (existing) {
      response.json(ActOnFp360CustomerReturnResponse.parse(await returnResponse(existing)));
      return;
    }
  }
  const teacherActions = ["approve", "reject", "request_credit_note", "close"];
  if (teacherActions.includes(input.action) && !isTeacher(actor)) {
    response.status(403).json({ error: "Esta revisión requiere autorización docente o administrativa." });
    return;
  }
  let nextStatus = returnRow.status;
  let nextApproved = returnRow.unitsApproved;
  let nextReceived = returnRow.unitsReceived;
  let creditNoteRequested = returnRow.creditNoteRequested;
  let eventDescription = input.description?.trim() || "";
  if (input.action === "approve") {
    if (returnRow.status !== "requested") {
      response.status(409).json({ error: "Solo se pueden aprobar devoluciones pendientes." });
      return;
    }
    nextApproved = input.unitsApproved ?? returnRow.unitsReported;
    if (nextApproved < 1 || nextApproved > returnRow.unitsReported) {
      response.status(400).json({ error: "Las unidades aprobadas no pueden superar las solicitadas." });
      return;
    }
    nextStatus = "approved";
    eventDescription ||= `Devolución aprobada para ${nextApproved} unidad(es); sin movimiento automático de stock.`;
  } else if (input.action === "reject") {
    if (returnRow.status !== "requested") {
      response.status(409).json({ error: "Solo se pueden rechazar devoluciones pendientes." });
      return;
    }
    nextStatus = "rejected";
    eventDescription ||= "Solicitud de devolución rechazada con registro de auditoría.";
  } else if (input.action === "record_receipt") {
    if (returnRow.status !== "approved") {
      response.status(409).json({ error: "Aprueba la devolución antes de registrar su recepción." });
      return;
    }
    const receivingNow = input.unitsReceived ?? 0;
    if (receivingNow < 1 || returnRow.unitsReceived + receivingNow > returnRow.unitsApproved) {
      response.status(400).json({ error: "La recepción debe ser mayor que cero y no superar las unidades aprobadas." });
      return;
    }
    nextReceived += receivingNow;
    nextStatus = nextReceived === nextApproved ? "received" : "approved";
    eventDescription ||= `${receivingNow} unidad(es) recibida(s) en la simulación (${nextReceived}/${nextApproved}); el stock no cambia automáticamente.`;
  } else if (input.action === "request_credit_note") {
    if (returnRow.status !== "received") {
      response.status(409).json({ error: "Registra la recepción completa antes de solicitar una factura rectificativa." });
      return;
    }
    nextStatus = "credit_note_requested";
    creditNoteRequested = true;
    eventDescription ||= "Solicitud de rectificativa derivada; no se ha creado ni cambiado una factura.";
  } else if (input.action === "close") {
    if (!["received", "credit_note_requested"].includes(returnRow.status)) {
      response.status(409).json({ error: "Solo se pueden cerrar devoluciones recibidas o con solicitud de rectificativa registrada." });
      return;
    }
    nextStatus = "closed";
    eventDescription ||= "Expediente de devolución cerrado; sin efectos automáticos en inventario, contabilidad o cobros.";
  }
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(fpCustomerReturns).set({
      status: nextStatus,
      unitsApproved: nextApproved,
      unitsReceived: nextReceived,
      creditNoteRequested,
      reviewedByUserId: teacherActions.includes(input.action) ? actor.userId : returnRow.reviewedByUserId,
      reviewedByName: teacherActions.includes(input.action) ? actor.displayName : returnRow.reviewedByName,
      updatedAt: now,
    }).where(and(eq(fpCustomerReturns.id, returnRow.id), eq(fpCustomerReturns.status, returnRow.status))).returning();
    if (!saved) throw new CustomerServiceError(409, "La devolución cambió mientras se guardaba la acción.");
    await appendEvent(tx, actor, {
      organizationId: returnRow.organizationId,
      entityType: "return",
      entityId: returnRow.id,
      caseId: returnRow.caseId,
      operationId: input.operationId,
      requestFingerprint,
      eventType: `return_${input.action}`,
      description: eventDescription,
      reference: returnRow.returnRef,
    });
    return [saved];
  });
  response.json(ActOnFp360CustomerReturnResponse.parse(await returnResponse(updated)));
}));

router.post("/redfp360/customer-service/agreements", route(async (request, response) => {
  const body = CreateFp360CustomerAgreementBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa los términos educativos y el periodo del acuerdo." });
    return;
  }
  const actor = request.auth as AuthContext;
  const input = body.data;
  const organizationId = await resolveOrganization(actor, input.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  if (!validScenarioDate(input.validFrom) || !validScenarioDate(input.validTo) || input.validFrom > input.validTo) {
    response.status(400).json({ error: "El acuerdo debe usar fechas válidas del escenario 2027–2028." });
    return;
  }
  const [product] = await db.select({ sku: fpProducts.sku }).from(fpProducts).where(and(
    eq(fpProducts.tenantId, actor.tenantId), eq(fpProducts.sku, input.productRef), eq(fpProducts.isActive, true),
  )).limit(1);
  if (!product) {
    response.status(404).json({ error: "Selecciona una referencia de producto activa del catálogo de prácticas." });
    return;
  }
  const requestFingerprint = fingerprint(input);
  const prior = await priorEvent(actor, input.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpCustomerAgreements).where(and(
      eq(fpCustomerAgreements.id, prior.entityId), eq(fpCustomerAgreements.organizationId, organizationId),
    )).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360CustomerAgreementResponse.parse(agreementResponse(existing)));
      return;
    }
  }
  const now = new Date();
  const [created] = await db.transaction(async (tx) => {
    const [agreement] = await tx.insert(fpCustomerAgreements).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId,
      agreementRef: `GAR-2027-${randomUUID().slice(0, 6).toUpperCase()}`,
      productRef: input.productRef,
      terms: input.terms.trim(),
      validFrom: input.validFrom,
      validTo: input.validTo,
      replacementAllowed: input.replacementAllowed,
      compensationAllowed: input.compensationAllowed,
      status: "draft",
      operationId: input.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      createdAt: now,
    }).returning();
    if (!agreement) throw new CustomerServiceError(500, "No se pudo guardar el borrador de garantía.");
    await appendEvent(tx, actor, {
      organizationId,
      entityType: "agreement",
      entityId: agreement.id,
      operationId: input.operationId,
      requestFingerprint,
      eventType: "agreement_created",
      description: `Borrador educativo ${agreement.agreementRef} creado. No representa plazos ni derechos legales.`,
      reference: agreement.productRef,
    });
    return [agreement];
  });
  response.status(201).json(CreateFp360CustomerAgreementResponse.parse(agreementResponse(created)));
}));

router.post("/redfp360/customer-service/agreements/:agreementId/actions", route(async (request, response) => {
  const params = ActOnFp360CustomerAgreementParams.safeParse(request.params);
  const body = ActOnFp360CustomerAgreementBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción del acuerdo educativo." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "Solo el profesorado o administración puede revisar estos acuerdos." });
    return;
  }
  const [agreement] = await db.select().from(fpCustomerAgreements).where(and(
    eq(fpCustomerAgreements.id, params.data.agreementId), eq(fpCustomerAgreements.tenantId, actor.tenantId),
  )).limit(1);
  if (!agreement || !await resolveOrganization(actor, agreement.organizationId)) {
    response.status(404).json({ error: "No se encontró el acuerdo educativo." });
    return;
  }
  const input = body.data;
  const requestFingerprint = fingerprint({ agreementId: agreement.id, ...input });
  const prior = await priorEvent(actor, input.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpCustomerAgreements).where(eq(fpCustomerAgreements.id, agreement.id)).limit(1);
    if (existing) {
      response.json(ActOnFp360CustomerAgreementResponse.parse(agreementResponse(existing)));
      return;
    }
  }
  let nextStatus = agreement.status;
  if (input.action === "activate") {
    if (agreement.status !== "draft") {
      response.status(409).json({ error: "Solo se pueden activar acuerdos en borrador." });
      return;
    }
    nextStatus = "active";
  } else if (input.action === "archive") {
    if (agreement.status !== "active") {
      response.status(409).json({ error: "Solo se pueden archivar acuerdos activos." });
      return;
    }
    nextStatus = "archived";
  }
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    if (input.action === "activate") {
      await tx.update(fpCustomerAgreements).set({ status: "archived" }).where(and(
        eq(fpCustomerAgreements.tenantId, actor.tenantId),
        eq(fpCustomerAgreements.organizationId, agreement.organizationId),
        eq(fpCustomerAgreements.productRef, agreement.productRef),
        eq(fpCustomerAgreements.status, "active"),
      ));
    }
    const [saved] = await tx.update(fpCustomerAgreements).set({
      status: nextStatus,
      approvedByUserId: actor.userId,
      approvedByName: actor.displayName,
      approvedAt: input.action === "activate" ? now : agreement.approvedAt,
    }).where(and(eq(fpCustomerAgreements.id, agreement.id), eq(fpCustomerAgreements.status, agreement.status))).returning();
    if (!saved) throw new CustomerServiceError(409, "El acuerdo cambió mientras se guardaba la revisión.");
    await appendEvent(tx, actor, {
      organizationId: agreement.organizationId,
      entityType: "agreement",
      entityId: agreement.id,
      operationId: input.operationId,
      requestFingerprint,
      eventType: `agreement_${input.action}`,
      description: input.action === "activate"
        ? `Acuerdo educativo ${agreement.agreementRef} activado.`
        : `Acuerdo educativo ${agreement.agreementRef} archivado.`,
      reference: agreement.productRef,
    });
    return [saved];
  });
  response.json(ActOnFp360CustomerAgreementResponse.parse(agreementResponse(updated)));
}));

export default router;

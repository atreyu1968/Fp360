import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  ActOnFp360ProjectBody,
  ActOnFp360ProjectParams,
  ActOnFp360ProjectResponse,
  ActOnFp360ProjectDeliverableBody,
  ActOnFp360ProjectDeliverableParams,
  ActOnFp360ProjectDeliverableResponse,
  ActOnFp360ProjectMilestoneBody,
  ActOnFp360ProjectMilestoneParams,
  ActOnFp360ProjectMilestoneResponse,
  ActOnFp360ProjectWorkOrderBody,
  ActOnFp360ProjectWorkOrderParams,
  ActOnFp360ProjectWorkOrderResponse,
  CreateFp360ProjectBillingBody,
  CreateFp360ProjectBillingResponse,
  CreateFp360ProjectBody,
  CreateFp360ProjectDeliverableBody,
  CreateFp360ProjectDeliverableParams,
  CreateFp360ProjectDeliverableResponse,
  CreateFp360ProjectMilestoneBody,
  CreateFp360ProjectMilestoneParams,
  CreateFp360ProjectMilestoneResponse,
  CreateFp360ProjectResourceBody,
  CreateFp360ProjectResourceResponse,
  CreateFp360ProjectRevisionBody,
  CreateFp360ProjectRevisionParams,
  CreateFp360ProjectRevisionResponse,
  CreateFp360ProjectResponse,
  CreateFp360ProjectTimeEntryBody,
  CreateFp360ProjectTimeEntryResponse,
  CreateFp360ProjectWorkOrderBody,
  CreateFp360ProjectWorkOrderParams,
  CreateFp360ProjectWorkOrderResponse,
  GetFp360ProjectsOverviewQueryParams,
  GetFp360ProjectsOverviewResponse,
  ReviewFp360ProjectResourceBody,
  ReviewFp360ProjectResourceParams,
  ReviewFp360ProjectResourceResponse,
  ReviewFp360ProjectRevisionBody,
  ReviewFp360ProjectRevisionParams,
  ReviewFp360ProjectRevisionResponse,
  ReviewFp360ProjectTimeEntryBody,
  ReviewFp360ProjectTimeEntryParams,
  ReviewFp360ProjectTimeEntryResponse,
} from "@workspace/api-zod";
import {
  db,
  fpInvoices,
  fpOrderLines,
  fpOrders,
  fpOrganizations,
  fpProducts,
  fpProjectBillings,
  fpProjectDeliverables,
  fpProjectEvents,
  fpProjectMilestones,
  fpProjectResources,
  fpProjectRevisions,
  fpProjects,
  fpProjectTimeEntries,
  fpProjectWorkOrders,
  fpPurchaseOrderLines,
  fpPurchaseOrders,
  fpPurchaseReceiptLines,
  fpPurchaseReceipts,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
const SIMULATED_DATE = "2027-09-15";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class ProjectsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof ProjectsError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 projects operation failed");
      next(error);
    });
  };
}

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
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

function asIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

async function resolveOrganization(actor: AuthContext, organizationId: string): Promise<boolean> {
  if (actor.organizationId && actor.organizationId !== organizationId) return false;
  if (!actor.organizationId && !isTeacher(actor)) return false;
  const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return Boolean(organization);
}

async function priorEvent(
  queryable: typeof db | Transaction,
  actor: AuthContext,
  operationId: string,
  requestFingerprint: string,
) {
  const [event] = await queryable.select().from(fpProjectEvents).where(and(
    eq(fpProjectEvents.tenantId, actor.tenantId),
    eq(fpProjectEvents.operationId, operationId),
  )).limit(1);
  if (event && (event.actorUserId !== actor.userId || event.requestFingerprint !== requestFingerprint)) {
    throw new ProjectsError(409, "El identificador de operación ya se usó con otros datos.");
  }
  return event ?? null;
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  input: {
    organizationId: string;
    projectId: string;
    entityType: string;
    entityId: string;
    eventType: string;
    description: string;
    operationId: string;
    requestFingerprint: string;
  },
): Promise<void> {
  await tx.insert(fpProjectEvents).values({
    id: newId("project-event"),
    tenantId: actor.tenantId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    entityType: input.entityType,
    entityId: input.entityId,
    eventType: input.eventType,
    description: input.description,
    actorUserId: actor.userId,
    actorName: actor.displayName,
    operationId: input.operationId,
    requestFingerprint: input.requestFingerprint,
    simulatedDate: SIMULATED_DATE,
  });
}

function projectRef(): string {
  return `PRY-2027-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function childRef(prefix: string): string {
  return `${prefix}-2027-${randomUUID().slice(0, 6).toUpperCase()}`;
}

function projectRevisionResponse(row: typeof fpProjectRevisions.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    title: row.title,
    objective: row.objective,
    scope: row.scope,
    budgetMinutes: row.budgetMinutes,
    budgetAmountCents: row.budgetAmountCents,
    status: row.status,
    reason: row.reason,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    createdAt: asIso(row.createdAt)!,
    reviewedAt: asIso(row.reviewedAt),
  };
}

function workOrderResponse(row: typeof fpProjectWorkOrders.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    workRef: row.workRef,
    title: row.title,
    description: row.description,
    assignedToName: row.assignedToName,
    plannedMinutes: row.plannedMinutes,
    hourlyCostRateCents: row.hourlyCostRateCents,
    status: row.status,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    createdAt: asIso(row.createdAt)!,
    updatedAt: asIso(row.updatedAt)!,
  };
}

function timeEntryResponse(row: typeof fpProjectTimeEntries.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    workOrderId: row.workOrderId,
    minutes: row.minutes,
    hourlyCostRateCents: row.hourlyCostRateCents,
    costCents: row.costCents,
    simulatedDate: row.simulatedDate,
    description: row.description,
    status: row.status,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    createdAt: asIso(row.createdAt)!,
    reviewedAt: asIso(row.reviewedAt),
  };
}

function resourceResponse(row: typeof fpProjectResources.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    workOrderId: row.workOrderId,
    resourceType: row.resourceType,
    description: row.description,
    quantityUnits: row.quantityUnits,
    unitCostCents: row.unitCostCents,
    totalCostCents: row.totalCostCents,
    sourceType: row.sourceType,
    sourceReference: row.sourceReference,
    sourceLineId: row.sourceLineId,
    status: row.status,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    createdAt: asIso(row.createdAt)!,
    reviewedAt: asIso(row.reviewedAt),
  };
}

function milestoneResponse(row: typeof fpProjectMilestones.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    milestoneRef: row.milestoneRef,
    title: row.title,
    description: row.description,
    dueDate: row.dueDate,
    billingAmountCents: row.billingAmountCents,
    requiresApproval: row.requiresApproval,
    status: row.status,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    createdAt: asIso(row.createdAt)!,
    updatedAt: asIso(row.updatedAt)!,
    acceptedAt: asIso(row.acceptedAt),
  };
}

function deliverableResponse(row: typeof fpProjectDeliverables.$inferSelect) {
  return {
    id: row.id,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    deliverableRef: row.deliverableRef,
    title: row.title,
    description: row.description,
    documentReference: row.documentReference,
    version: row.version,
    status: row.status,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    createdAt: asIso(row.createdAt)!,
    updatedAt: asIso(row.updatedAt)!,
    reviewedAt: asIso(row.reviewedAt),
  };
}

async function projectSummary(project: typeof fpProjects.$inferSelect) {
  const [times, resources, milestones, billings] = await Promise.all([
    db.select().from(fpProjectTimeEntries).where(and(
      eq(fpProjectTimeEntries.tenantId, project.tenantId),
      eq(fpProjectTimeEntries.projectId, project.id),
    )),
    db.select().from(fpProjectResources).where(and(
      eq(fpProjectResources.tenantId, project.tenantId),
      eq(fpProjectResources.projectId, project.id),
    )),
    db.select().from(fpProjectMilestones).where(and(
      eq(fpProjectMilestones.tenantId, project.tenantId),
      eq(fpProjectMilestones.projectId, project.id),
    )),
    db.select().from(fpProjectBillings).where(and(
      eq(fpProjectBillings.tenantId, project.tenantId),
      eq(fpProjectBillings.projectId, project.id),
    )),
  ]);
  const [customer] = project.customerOrganizationId
    ? await db.select({ name: fpOrganizations.name }).from(fpOrganizations).where(and(
      eq(fpOrganizations.id, project.customerOrganizationId),
      eq(fpOrganizations.tenantId, project.tenantId),
    )).limit(1)
    : [];
  const billingOrderIds = billings.map((row) => row.orderId);
  const invoices = billingOrderIds.length
    ? await db.select().from(fpInvoices).where(and(
      eq(fpInvoices.tenantId, project.tenantId),
      inArray(fpInvoices.orderId, billingOrderIds),
    ))
    : [];
  const actualMinutes = times.filter((row) => row.status === "approved").reduce((sum, row) => sum + row.minutes, 0);
  const actualCostCents = times.filter((row) => row.status === "approved").reduce((sum, row) => sum + row.costCents, 0)
    + resources.filter((row) => row.status === "approved").reduce((sum, row) => sum + row.totalCostCents, 0);
  const acceptedValueCents = milestones.filter((row) => row.status === "accepted").reduce((sum, row) => sum + row.billingAmountCents, 0);
  const invoicedCents = invoices.reduce((sum, row) => sum + row.baseCents, 0);
  return {
    id: project.id,
    organizationId: project.organizationId,
    customerOrganizationId: project.customerOrganizationId,
    customerOrganizationName: customer?.name ?? null,
    projectRef: project.projectRef,
    projectType: project.projectType,
    title: project.title,
    objective: project.objective,
    scope: project.scope,
    budgetMinutes: project.budgetMinutes,
    budgetAmountCents: project.budgetAmountCents,
    startDate: project.startDate,
    endDate: project.endDate,
    status: project.status,
    version: project.version,
    createdByName: project.createdByName,
    createdAt: asIso(project.createdAt)!,
    updatedAt: asIso(project.updatedAt)!,
    actualMinutes,
    actualCostCents,
    acceptedValueCents,
    invoicedCents,
    projectedMarginCents: acceptedValueCents - actualCostCents,
  };
}

router.use(requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/projects/overview", route(async (request, response) => {
  const actor = request.auth!;
  const query = GetFp360ProjectsOverviewQueryParams.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: query.error.message });
    return;
  }
  const organizationId = query.data.organizationId;
  if (!await resolveOrganization(actor, organizationId)) {
    response.status(403).json({ error: "No tienes acceso a esta empresa del escenario." });
    return;
  }
  const condition = and(eq(fpProjects.tenantId, actor.tenantId), eq(fpProjects.organizationId, organizationId));
  const [projectRows, customers, services, receipts, receiptLines] = await Promise.all([
    db.select().from(fpProjects).where(condition).orderBy(desc(fpProjects.updatedAt)),
    db.select({
      id: fpOrganizations.id,
      name: fpOrganizations.name,
      center: fpOrganizations.center,
      island: fpOrganizations.island,
    }).from(fpOrganizations).where(and(
      eq(fpOrganizations.tenantId, actor.tenantId),
      eq(fpOrganizations.isActive, true),
    )),
    db.select({
      id: fpProducts.id,
      sku: fpProducts.sku,
      name: fpProducts.name,
      unitPriceCents: fpProducts.unitPriceCents,
      igicBasisPoints: fpProducts.igicBasisPoints,
    }).from(fpProducts).where(and(
      eq(fpProducts.tenantId, actor.tenantId),
      eq(fpProducts.itemType, "service"),
      eq(fpProducts.isActive, true),
      eq(fpProducts.isPublished, true),
      eq(fpProducts.tracksInventory, false),
    )),
    db.select({
      id: fpPurchaseReceipts.id,
      reference: fpPurchaseReceipts.receiptReference,
      receivedDate: fpPurchaseReceipts.receivedDate,
      status: fpPurchaseReceipts.status,
      buyerOrganizationId: fpPurchaseOrders.buyerOrganizationId,
    }).from(fpPurchaseReceipts).innerJoin(
      fpPurchaseOrders,
      eq(fpPurchaseOrders.id, fpPurchaseReceipts.orderId),
    ).where(and(
      eq(fpPurchaseReceipts.tenantId, actor.tenantId),
      eq(fpPurchaseOrders.tenantId, actor.tenantId),
      eq(fpPurchaseOrders.buyerOrganizationId, organizationId),
      eq(fpPurchaseReceipts.status, "received"),
    )),
    db.select({
      id: fpPurchaseReceiptLines.id,
      receiptId: fpPurchaseReceipts.id,
      receiptReference: fpPurchaseReceipts.receiptReference,
      sku: fpPurchaseOrderLines.skuSnapshot,
      productName: fpPurchaseOrderLines.productNameSnapshot,
      quantityAccepted: fpPurchaseReceiptLines.quantityAccepted,
      unitPriceCents: fpPurchaseOrderLines.unitPriceCents,
    }).from(fpPurchaseReceiptLines).innerJoin(
      fpPurchaseReceipts,
      eq(fpPurchaseReceipts.id, fpPurchaseReceiptLines.receiptId),
    ).innerJoin(
      fpPurchaseOrders,
      eq(fpPurchaseOrders.id, fpPurchaseReceipts.orderId),
    ).innerJoin(
      fpPurchaseOrderLines,
      eq(fpPurchaseOrderLines.id, fpPurchaseReceiptLines.purchaseOrderLineId),
    ).where(and(
      eq(fpPurchaseReceiptLines.tenantId, actor.tenantId),
      eq(fpPurchaseReceipts.tenantId, actor.tenantId),
      eq(fpPurchaseOrders.tenantId, actor.tenantId),
      eq(fpPurchaseOrders.buyerOrganizationId, organizationId),
      eq(fpPurchaseReceipts.status, "received"),
      gt(fpPurchaseReceiptLines.quantityAccepted, 0),
    )),
  ]);
  const projectIds = projectRows.map((row) => row.id);
  const [
    revisions,
    workOrders,
    timeEntries,
    resources,
    milestones,
    deliverables,
    billings,
    events,
  ] = projectIds.length ? await Promise.all([
    db.select().from(fpProjectRevisions).where(and(eq(fpProjectRevisions.tenantId, actor.tenantId), inArray(fpProjectRevisions.projectId, projectIds))).orderBy(desc(fpProjectRevisions.createdAt)),
    db.select().from(fpProjectWorkOrders).where(and(eq(fpProjectWorkOrders.tenantId, actor.tenantId), inArray(fpProjectWorkOrders.projectId, projectIds))).orderBy(desc(fpProjectWorkOrders.createdAt)),
    db.select().from(fpProjectTimeEntries).where(and(eq(fpProjectTimeEntries.tenantId, actor.tenantId), inArray(fpProjectTimeEntries.projectId, projectIds))).orderBy(desc(fpProjectTimeEntries.createdAt)),
    db.select().from(fpProjectResources).where(and(eq(fpProjectResources.tenantId, actor.tenantId), inArray(fpProjectResources.projectId, projectIds))).orderBy(desc(fpProjectResources.createdAt)),
    db.select().from(fpProjectMilestones).where(and(eq(fpProjectMilestones.tenantId, actor.tenantId), inArray(fpProjectMilestones.projectId, projectIds))).orderBy(desc(fpProjectMilestones.createdAt)),
    db.select().from(fpProjectDeliverables).where(and(eq(fpProjectDeliverables.tenantId, actor.tenantId), inArray(fpProjectDeliverables.projectId, projectIds))).orderBy(desc(fpProjectDeliverables.createdAt)),
    db.select().from(fpProjectBillings).where(and(eq(fpProjectBillings.tenantId, actor.tenantId), inArray(fpProjectBillings.projectId, projectIds))).orderBy(desc(fpProjectBillings.createdAt)),
    db.select().from(fpProjectEvents).where(and(eq(fpProjectEvents.tenantId, actor.tenantId), inArray(fpProjectEvents.projectId, projectIds))).orderBy(desc(fpProjectEvents.createdAt)).limit(250),
  ]) : [[], [], [], [], [], [], [], []];
  const billingOrderIds = billings.map((row) => row.orderId);
  const [billingOrders, invoices] = billingOrderIds.length ? await Promise.all([
    db.select({ id: fpOrders.id, reference: fpOrders.reference }).from(fpOrders).where(and(eq(fpOrders.tenantId, actor.tenantId), inArray(fpOrders.id, billingOrderIds))),
    db.select().from(fpInvoices).where(and(eq(fpInvoices.tenantId, actor.tenantId), inArray(fpInvoices.orderId, billingOrderIds))),
  ]) : [[], []];
  const orderRefs = new Map(billingOrders.map((row) => [row.id, row.reference]));
  const invoicesByOrder = new Map(invoices.map((row) => [row.orderId, row]));
  const projectResponseRows = await Promise.all(projectRows.map((row) => projectSummary(row)));
  const pendingReviews = revisions.filter((row) => row.status === "pending_review").length
    + timeEntries.filter((row) => row.status === "pending_review").length
    + resources.filter((row) => row.status === "pending_review").length
    + workOrders.filter((row) => row.status === "completed").length
    + milestones.filter((row) => row.status === "submitted").length
    + deliverables.filter((row) => row.status === "submitted").length;
  const mappedBillings = billings.map((row) => {
    const invoice = invoicesByOrder.get(row.orderId);
    return {
      id: row.id,
      projectId: row.projectId,
      milestoneId: row.milestoneId,
      orderId: row.orderId,
      orderReference: orderRefs.get(row.orderId) ?? "",
      serviceSku: row.serviceSku,
      amountCents: row.amountCents,
      invoiceId: invoice?.id ?? null,
      invoiceReference: invoice?.reference ?? null,
      createdByName: row.createdByName,
      createdAt: asIso(row.createdAt)!,
    };
  });
  const output = {
    organizationId,
    simulatedDate: SIMULATED_DATE,
    projects: projectResponseRows,
    customerOrganizations: customers.filter((row) => row.id !== organizationId),
    serviceProducts: services,
    purchaseReceipts: receipts.map(({ id, reference, receivedDate, status }) => ({ id, reference, receivedDate, status })),
    purchaseReceiptLines: receiptLines,
    revisions: revisions.map(projectRevisionResponse),
    workOrders: workOrders.map(workOrderResponse),
    timeEntries: timeEntries.map(timeEntryResponse),
    resources: resources.map(resourceResponse),
    milestones: milestones.map(milestoneResponse),
    deliverables: deliverables.map(deliverableResponse),
    billings: mappedBillings,
    events: events.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      entityType: row.entityType,
      entityId: row.entityId,
      eventType: row.eventType,
      description: row.description,
      actorName: row.actorName,
      simulatedDate: row.simulatedDate,
      createdAt: asIso(row.createdAt)!,
    })),
    summary: {
      activeProjects: projectRows.filter((row) => ["planned", "in_progress", "on_hold"].includes(row.status)).length,
      pendingReviews,
      plannedMinutes: projectRows.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + row.budgetMinutes, 0),
      approvedMinutes: timeEntries.filter((row) => row.status === "approved").reduce((sum, row) => sum + row.minutes, 0),
      approvedCostCents: timeEntries.filter((row) => row.status === "approved").reduce((sum, row) => sum + row.costCents, 0)
        + resources.filter((row) => row.status === "approved").reduce((sum, row) => sum + row.totalCostCents, 0),
      acceptedValueCents: milestones.filter((row) => row.status === "accepted").reduce((sum, row) => sum + row.billingAmountCents, 0),
      invoicedCents: invoices.reduce((sum, row) => sum + row.baseCents, 0),
      upcomingMilestones: milestones.filter((row) => row.status !== "accepted" && row.status !== "rejected" && row.dueDate && row.dueDate >= SIMULATED_DATE).length,
    },
  };
  response.json(GetFp360ProjectsOverviewResponse.parse(output));
}));

router.post("/redfp360/projects", route(async (request, response) => {
  const actor = request.auth!;
  const body = CreateFp360ProjectBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: body.error.message });
    return;
  }
  const input = body.data;
  if (!await resolveOrganization(actor, input.organizationId)) {
    response.status(403).json({ error: "No tienes acceso a esta empresa del escenario." });
    return;
  }
  if (input.projectType === "external" && !input.customerOrganizationId) {
    response.status(400).json({ error: "Un encargo externo requiere una empresa cliente." });
    return;
  }
  if (input.projectType === "internal" && input.customerOrganizationId) {
    response.status(400).json({ error: "Un proyecto interno no puede asignarse a una empresa cliente." });
    return;
  }
  if (!validScenarioDate(input.startDate) || !validScenarioDate(input.endDate) || input.startDate > input.endDate) {
    response.status(400).json({ error: "Las fechas deben estar entre 2027 y 2028 y el inicio no puede superar el fin." });
    return;
  }
  if (input.customerOrganizationId) {
    const [customer] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
      eq(fpOrganizations.id, input.customerOrganizationId),
      eq(fpOrganizations.tenantId, actor.tenantId),
      eq(fpOrganizations.isActive, true),
    )).limit(1);
    if (!customer || customer.id === input.organizationId) {
      response.status(400).json({ error: "Selecciona otra empresa activa de la misma red." });
      return;
    }
  }
  const requestFingerprint = fingerprint({ ...input });
  const replay = await priorEvent(db, actor, input.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjects).where(and(eq(fpProjects.id, replay.entityId), eq(fpProjects.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.status(200).json(CreateFp360ProjectResponse.parse(await projectSummary(existing)));
      return;
    }
  }
  const id = newId("project");
  const reference = projectRef();
  const project = await db.transaction(async (tx) => {
    const [saved] = await tx.insert(fpProjects).values({
      id,
      tenantId: actor.tenantId,
      organizationId: input.organizationId,
      customerOrganizationId: input.customerOrganizationId ?? null,
      projectRef: reference,
      projectType: input.projectType,
      title: input.title.trim(),
      objective: input.objective.trim(),
      scope: input.scope.trim(),
      budgetMinutes: input.budgetMinutes,
      budgetAmountCents: input.budgetAmountCents,
      startDate: input.startDate,
      endDate: input.endDate,
      status: "draft",
      version: 1,
      operationId: input.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    }).returning();
    await appendEvent(tx, actor, {
      organizationId: input.organizationId,
      projectId: id,
      entityType: "project",
      entityId: id,
      eventType: "project_created",
      description: `Proyecto ${reference} creado como borrador.`,
      operationId: input.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.status(201).json(CreateFp360ProjectResponse.parse(await projectSummary(project)));
}));

router.post("/redfp360/projects/:projectId/actions", route(async (request, response) => {
  const actor = request.auth!;
  const params = ActOnFp360ProjectParams.safeParse(request.params);
  const body = ActOnFp360ProjectBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ projectId: params.data.projectId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjects).where(and(eq(fpProjects.id, replay.projectId), eq(fpProjects.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.json(ActOnFp360ProjectResponse.parse(await projectSummary(existing)));
      return;
    }
  }
  const updated = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(fpProjects).where(and(
      eq(fpProjects.id, params.data.projectId),
      eq(fpProjects.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!project) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este proyecto.");
    let nextStatus = project.status;
    const action = body.data.action;
    if (["plan", "complete", "close", "cancel"].includes(action) && !isTeacher(actor)) {
      throw new ProjectsError(403, "Esta transición requiere revisión docente.");
    }
    if (action === "plan" && project.status === "draft") nextStatus = "planned";
    else if (action === "start" && project.status === "planned") nextStatus = "in_progress";
    else if (action === "hold" && project.status === "in_progress") nextStatus = "on_hold";
    else if (action === "resume" && project.status === "on_hold") nextStatus = "in_progress";
    else if (action === "complete" && project.status === "in_progress") {
      const [orders, pendingTimes, pendingResources, pendingMilestones, pendingDeliverables] = await Promise.all([
        tx.select().from(fpProjectWorkOrders).where(and(eq(fpProjectWorkOrders.projectId, project.id), eq(fpProjectWorkOrders.tenantId, actor.tenantId))),
        tx.select({ id: fpProjectTimeEntries.id }).from(fpProjectTimeEntries).where(and(eq(fpProjectTimeEntries.projectId, project.id), eq(fpProjectTimeEntries.tenantId, actor.tenantId), eq(fpProjectTimeEntries.status, "pending_review"))),
        tx.select({ id: fpProjectResources.id }).from(fpProjectResources).where(and(eq(fpProjectResources.projectId, project.id), eq(fpProjectResources.tenantId, actor.tenantId), eq(fpProjectResources.status, "pending_review"))),
        tx.select({ id: fpProjectMilestones.id }).from(fpProjectMilestones).where(and(
          eq(fpProjectMilestones.projectId, project.id),
          eq(fpProjectMilestones.tenantId, actor.tenantId),
          inArray(fpProjectMilestones.status, ["planned", "in_progress", "submitted"]),
        )),
        tx.select({ id: fpProjectDeliverables.id }).from(fpProjectDeliverables).where(and(
          eq(fpProjectDeliverables.projectId, project.id),
          eq(fpProjectDeliverables.tenantId, actor.tenantId),
          inArray(fpProjectDeliverables.status, ["draft", "submitted", "changes_requested"]),
        )),
      ]);
      if (orders.some((row) => row.status !== "reviewed")) throw new ProjectsError(409, "Revisa todas las órdenes de trabajo antes de cerrar la ejecución.");
      if (pendingTimes.length || pendingResources.length || pendingMilestones.length || pendingDeliverables.length) {
        throw new ProjectsError(409, "Hay partes, costes, hitos o entregables pendientes antes del cierre.");
      }
      nextStatus = "completed";
    } else if (action === "close" && project.status === "completed") {
      const acceptedBillables = await tx.select({ id: fpProjectMilestones.id }).from(fpProjectMilestones).where(and(
        eq(fpProjectMilestones.projectId, project.id),
        eq(fpProjectMilestones.tenantId, actor.tenantId),
        eq(fpProjectMilestones.status, "accepted"),
        gt(fpProjectMilestones.billingAmountCents, 0),
      ));
      if (acceptedBillables.length) {
        const billings = await tx.select().from(fpProjectBillings).where(and(
          eq(fpProjectBillings.projectId, project.id),
          eq(fpProjectBillings.tenantId, actor.tenantId),
          inArray(fpProjectBillings.milestoneId, acceptedBillables.map((row) => row.id)),
        ));
        if (billings.length !== acceptedBillables.length) throw new ProjectsError(409, "Prepara una orden de servicio para cada hito aceptado antes del cierre.");
        const invoices = await tx.select({ id: fpInvoices.id }).from(fpInvoices).where(and(
          eq(fpInvoices.tenantId, actor.tenantId),
          inArray(fpInvoices.orderId, billings.map((row) => row.orderId)),
        ));
        if (invoices.length !== billings.length) throw new ProjectsError(409, "Emite las facturas pendientes antes de cerrar el proyecto.");
      }
      nextStatus = "closed";
    }
    else if (action === "cancel" && ["draft", "planned"].includes(project.status)) nextStatus = "cancelled";
    else throw new ProjectsError(409, "La transición no está permitida desde el estado actual.");
    const now = new Date();
    const [saved] = await tx.update(fpProjects).set({
      status: nextStatus,
      updatedAt: now,
      completedAt: action === "complete" ? now : project.completedAt,
      closedAt: action === "close" ? now : project.closedAt,
    }).where(and(eq(fpProjects.id, project.id), eq(fpProjects.status, project.status))).returning();
    if (!saved) throw new ProjectsError(409, "El proyecto cambió mientras se guardaba.");
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "project",
      entityId: project.id,
      eventType: `project_${action}`,
      description: `Proyecto ${project.projectRef}: ${action}.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.json(ActOnFp360ProjectResponse.parse(await projectSummary(updated)));
}));

router.post("/redfp360/projects/:projectId/revisions", route(async (request, response) => {
  const actor = request.auth!;
  const params = CreateFp360ProjectRevisionParams.safeParse(request.params);
  const body = CreateFp360ProjectRevisionBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ projectId: params.data.projectId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectRevisions).where(and(eq(fpProjectRevisions.id, replay.entityId), eq(fpProjectRevisions.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.status(200).json(CreateFp360ProjectRevisionResponse.parse(projectRevisionResponse(existing)));
      return;
    }
  }
  const revision = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, params.data.projectId), eq(fpProjects.tenantId, actor.tenantId))).for("update").limit(1);
    if (!project) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este proyecto.");
    if (["closed", "cancelled"].includes(project.status)) throw new ProjectsError(409, "No se puede revisar un proyecto cerrado o cancelado.");
    const pending = await tx.select({ id: fpProjectRevisions.id }).from(fpProjectRevisions).where(and(eq(fpProjectRevisions.projectId, project.id), eq(fpProjectRevisions.tenantId, actor.tenantId), eq(fpProjectRevisions.status, "pending_review")));
    if (pending.length) throw new ProjectsError(409, "Revisa la propuesta pendiente antes de crear otra versión.");
    const [latestRevision] = await tx.select({ version: fpProjectRevisions.version }).from(fpProjectRevisions).where(and(
      eq(fpProjectRevisions.projectId, project.id),
      eq(fpProjectRevisions.tenantId, actor.tenantId),
    )).orderBy(desc(fpProjectRevisions.version)).limit(1);
    const [saved] = await tx.insert(fpProjectRevisions).values({
      id: newId("project-revision"),
      tenantId: actor.tenantId,
      organizationId: project.organizationId,
      projectId: project.id,
      version: Math.max(project.version, latestRevision?.version ?? 1) + 1,
      title: body.data.title.trim(),
      objective: body.data.objective.trim(),
      scope: body.data.scope.trim(),
      budgetMinutes: body.data.budgetMinutes,
      budgetAmountCents: body.data.budgetAmountCents,
      status: "pending_review",
      reason: body.data.reason.trim(),
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    }).returning();
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "revision",
      entityId: saved.id,
      eventType: "project_revision_proposed",
      description: `Propuesta de versión ${saved.version}: ${saved.reason}`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.status(201).json(CreateFp360ProjectRevisionResponse.parse(projectRevisionResponse(revision)));
}));

router.post("/redfp360/project-revisions/:revisionId/review", route(async (request, response) => {
  const actor = request.auth!;
  const params = ReviewFp360ProjectRevisionParams.safeParse(request.params);
  const body = ReviewFp360ProjectRevisionBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "Solo el docente puede validar una nueva versión de proyecto." });
    return;
  }
  const requestFingerprint = fingerprint({ revisionId: params.data.revisionId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectRevisions).where(and(eq(fpProjectRevisions.id, replay.entityId), eq(fpProjectRevisions.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.json(ReviewFp360ProjectRevisionResponse.parse(projectRevisionResponse(existing)));
      return;
    }
  }
  const reviewed = await db.transaction(async (tx) => {
    const [revision] = await tx.select().from(fpProjectRevisions).where(and(eq(fpProjectRevisions.id, params.data.revisionId), eq(fpProjectRevisions.tenantId, actor.tenantId))).for("update").limit(1);
    if (!revision) throw new ProjectsError(404, "No se encontró la propuesta de cambio.");
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, revision.projectId), eq(fpProjects.tenantId, actor.tenantId))).for("update").limit(1);
    if (!project || project.organizationId !== revision.organizationId) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a esta propuesta.");
    if (revision.status !== "pending_review") throw new ProjectsError(409, "La propuesta ya fue revisada.");
    if (body.data.action === "approve" && revision.version <= project.version) throw new ProjectsError(409, "La versión actual cambió; crea una nueva propuesta.");
    const now = new Date();
    const [saved] = await tx.update(fpProjectRevisions).set({
      status: body.data.action === "approve" ? "approved" : "rejected",
      reviewedByUserId: actor.userId,
      reviewedByName: actor.displayName,
      reviewedAt: now,
    }).where(and(eq(fpProjectRevisions.id, revision.id), eq(fpProjectRevisions.status, "pending_review"))).returning();
    if (!saved) throw new ProjectsError(409, "La propuesta cambió mientras se guardaba.");
    if (body.data.action === "approve") {
      const [updatedProject] = await tx.update(fpProjects).set({
        title: revision.title,
        objective: revision.objective,
        scope: revision.scope,
        budgetMinutes: revision.budgetMinutes,
        budgetAmountCents: revision.budgetAmountCents,
        version: revision.version,
        updatedAt: now,
      }).where(and(eq(fpProjects.id, project.id), eq(fpProjects.version, project.version))).returning();
      if (!updatedProject) throw new ProjectsError(409, "El proyecto cambió antes de aplicar la nueva versión.");
    }
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "revision",
      entityId: revision.id,
      eventType: `project_revision_${body.data.action}`,
      description: `Propuesta de versión ${revision.version} ${body.data.action === "approve" ? "aprobada" : "rechazada"}.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.json(ReviewFp360ProjectRevisionResponse.parse(projectRevisionResponse(reviewed)));
}));

router.post("/redfp360/projects/:projectId/work-orders", route(async (request, response) => {
  const actor = request.auth!;
  const params = CreateFp360ProjectWorkOrderParams.safeParse(request.params);
  const body = CreateFp360ProjectWorkOrderBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ projectId: params.data.projectId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectWorkOrders).where(and(eq(fpProjectWorkOrders.id, replay.entityId), eq(fpProjectWorkOrders.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.status(200).json(CreateFp360ProjectWorkOrderResponse.parse(workOrderResponse(existing)));
      return;
    }
  }
  const created = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, params.data.projectId), eq(fpProjects.tenantId, actor.tenantId))).for("update").limit(1);
    if (!project) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este proyecto.");
    if (!["planned", "in_progress"].includes(project.status)) throw new ProjectsError(409, "El proyecto debe estar planificado o en ejecución.");
    const id = newId("project-work");
    const [saved] = await tx.insert(fpProjectWorkOrders).values({
      id,
      tenantId: actor.tenantId,
      organizationId: project.organizationId,
      projectId: project.id,
      workRef: childRef("OT"),
      title: body.data.title.trim(),
      description: body.data.description.trim(),
      assignedToUserId: actor.userId,
      assignedToName: actor.displayName,
      plannedMinutes: body.data.plannedMinutes,
      hourlyCostRateCents: body.data.hourlyCostRateCents,
      status: "assigned",
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    }).returning();
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "work_order",
      entityId: id,
      eventType: "work_order_created",
      description: `Orden ${saved.workRef} asignada a ${actor.displayName}.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.status(201).json(CreateFp360ProjectWorkOrderResponse.parse(workOrderResponse(created)));
}));

router.post("/redfp360/project-work-orders/:workOrderId/actions", route(async (request, response) => {
  const actor = request.auth!;
  const params = ActOnFp360ProjectWorkOrderParams.safeParse(request.params);
  const body = ActOnFp360ProjectWorkOrderBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ workOrderId: params.data.workOrderId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectWorkOrders).where(and(eq(fpProjectWorkOrders.id, replay.entityId), eq(fpProjectWorkOrders.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.json(ActOnFp360ProjectWorkOrderResponse.parse(workOrderResponse(existing)));
      return;
    }
  }
  const updated = await db.transaction(async (tx) => {
    const [work] = await tx.select().from(fpProjectWorkOrders).where(and(eq(fpProjectWorkOrders.id, params.data.workOrderId), eq(fpProjectWorkOrders.tenantId, actor.tenantId))).for("update").limit(1);
    if (!work) throw new ProjectsError(404, "No se encontró la orden de trabajo.");
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, work.projectId), eq(fpProjects.tenantId, actor.tenantId))).limit(1);
    if (!project || project.organizationId !== work.organizationId) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, work.organizationId)) throw new ProjectsError(403, "No tienes acceso a esta orden.");
    const action = body.data.action;
    if (action === "review" && !isTeacher(actor)) throw new ProjectsError(403, "La revisión de la orden requiere validación docente.");
    let status = work.status;
    if (action === "start" && ["assigned", "blocked"].includes(status)) status = "in_progress";
    else if (action === "complete" && status === "in_progress") status = "completed";
    else if (action === "review" && status === "completed") status = "reviewed";
    else if (action === "block" && ["assigned", "in_progress"].includes(status)) {
      if (!body.data.description?.trim()) throw new ProjectsError(400, "Indica el motivo del bloqueo.");
      status = "blocked";
    } else throw new ProjectsError(409, "La acción no está permitida desde el estado actual.");
    const now = new Date();
    const [saved] = await tx.update(fpProjectWorkOrders).set({
      status,
      updatedAt: now,
      reviewedByUserId: action === "review" ? actor.userId : work.reviewedByUserId,
      reviewedByName: action === "review" ? actor.displayName : work.reviewedByName,
    }).where(and(eq(fpProjectWorkOrders.id, work.id), eq(fpProjectWorkOrders.status, work.status))).returning();
    if (!saved) throw new ProjectsError(409, "La orden cambió mientras se guardaba.");
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "work_order",
      entityId: work.id,
      eventType: `work_order_${action}`,
      description: body.data.description?.trim() || `Orden ${work.workRef}: ${action}.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.json(ActOnFp360ProjectWorkOrderResponse.parse(workOrderResponse(updated)));
}));

router.post("/redfp360/project-time-entries", route(async (request, response) => {
  const actor = request.auth!;
  const body = CreateFp360ProjectTimeEntryBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: body.error.message });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectTimeEntries).where(and(eq(fpProjectTimeEntries.id, replay.entityId), eq(fpProjectTimeEntries.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.status(200).json(CreateFp360ProjectTimeEntryResponse.parse(timeEntryResponse(existing)));
      return;
    }
  }
  if (!validScenarioDate(body.data.simulatedDate)) {
    response.status(400).json({ error: "La fecha simulada debe estar entre 2027 y 2028." });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [work] = await tx.select().from(fpProjectWorkOrders).where(and(eq(fpProjectWorkOrders.id, body.data.workOrderId), eq(fpProjectWorkOrders.tenantId, actor.tenantId))).for("update").limit(1);
    if (!work) throw new ProjectsError(404, "No se encontró la orden de trabajo.");
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, work.projectId), eq(fpProjects.tenantId, actor.tenantId))).limit(1);
    if (!project || project.organizationId !== work.organizationId) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a esta orden.");
    if (project.status !== "in_progress" || work.status !== "in_progress") throw new ProjectsError(409, "El proyecto y la orden deben estar en ejecución para imputar tiempo.");
    if (body.data.simulatedDate < project.startDate || body.data.simulatedDate > project.endDate) throw new ProjectsError(400, "La fecha está fuera del calendario del proyecto.");
    const existingEntries = await tx.select().from(fpProjectTimeEntries).where(and(
      eq(fpProjectTimeEntries.workOrderId, work.id),
      eq(fpProjectTimeEntries.tenantId, actor.tenantId),
    ));
    const committedMinutes = existingEntries.filter((entry) => entry.status !== "rejected").reduce((sum, entry) => sum + entry.minutes, 0);
    if (committedMinutes + body.data.minutes > work.plannedMinutes) throw new ProjectsError(409, "El parte superaría las horas planificadas; solicita una revisión de la orden.");
    const costCents = Math.round((body.data.minutes * work.hourlyCostRateCents) / 60);
    const id = newId("project-time");
    const [saved] = await tx.insert(fpProjectTimeEntries).values({
      id,
      tenantId: actor.tenantId,
      organizationId: project.organizationId,
      projectId: project.id,
      workOrderId: work.id,
      minutes: body.data.minutes,
      hourlyCostRateCents: work.hourlyCostRateCents,
      costCents,
      simulatedDate: body.data.simulatedDate,
      description: body.data.description.trim(),
      status: "pending_review",
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    }).returning();
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "time_entry",
      entityId: id,
      eventType: "time_entry_submitted",
      description: `Parte de ${body.data.minutes} minutos remitido a revisión.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.status(201).json(CreateFp360ProjectTimeEntryResponse.parse(timeEntryResponse(created)));
}));

async function reviewTimeEntryRecord(
  actor: AuthContext,
  entityId: string,
  body: { action: "approve" | "reject"; reason?: string; operationId: string },
  requestFingerprint: string,
): Promise<typeof fpProjectTimeEntries.$inferSelect> {
  if (!isTeacher(actor)) throw new ProjectsError(403, "La revisión de costes requiere validación docente.");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(fpProjectTimeEntries).where(and(
      eq(fpProjectTimeEntries.id, entityId),
      eq(fpProjectTimeEntries.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!row) throw new ProjectsError(404, "No se encontró el parte.");
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, row.projectId), eq(fpProjects.tenantId, actor.tenantId))).limit(1);
    if (!project || project.organizationId !== row.organizationId) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este parte.");
    if (row.status !== "pending_review") throw new ProjectsError(409, "El registro ya fue revisado.");
    if (body.action === "reject" && !body.reason?.trim()) throw new ProjectsError(400, "Indica el motivo del rechazo.");
    const now = new Date();
    const [saved] = await tx.update(fpProjectTimeEntries).set({
      status: body.action === "approve" ? "approved" : "rejected",
      reviewedByUserId: actor.userId,
      reviewedByName: actor.displayName,
      reviewedAt: now,
    }).where(and(eq(fpProjectTimeEntries.id, entityId), eq(fpProjectTimeEntries.status, "pending_review"))).returning();
    if (!saved) throw new ProjectsError(409, "El registro cambió mientras se guardaba.");
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "time_entry",
      entityId,
      eventType: `time_entry_${body.action}`,
      description: body.reason?.trim() || `Parte ${body.action === "approve" ? "aprobado" : "rechazado"}.`,
      operationId: body.operationId,
      requestFingerprint,
    });
    return saved;
  });
}

async function reviewResourceRecord(
  actor: AuthContext,
  entityId: string,
  body: { action: "approve" | "reject"; reason?: string; operationId: string },
  requestFingerprint: string,
): Promise<typeof fpProjectResources.$inferSelect> {
  if (!isTeacher(actor)) throw new ProjectsError(403, "La revisión de costes requiere validación docente.");
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(fpProjectResources).where(and(
      eq(fpProjectResources.id, entityId),
      eq(fpProjectResources.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!row) throw new ProjectsError(404, "No se encontró el coste.");
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, row.projectId), eq(fpProjects.tenantId, actor.tenantId))).limit(1);
    if (!project || project.organizationId !== row.organizationId) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este coste.");
    if (row.status !== "pending_review") throw new ProjectsError(409, "El registro ya fue revisado.");
    if (body.action === "reject" && !body.reason?.trim()) throw new ProjectsError(400, "Indica el motivo del rechazo.");
    const now = new Date();
    const [saved] = await tx.update(fpProjectResources).set({
      status: body.action === "approve" ? "approved" : "rejected",
      reviewedByUserId: actor.userId,
      reviewedByName: actor.displayName,
      reviewedAt: now,
    }).where(and(eq(fpProjectResources.id, entityId), eq(fpProjectResources.status, "pending_review"))).returning();
    if (!saved) throw new ProjectsError(409, "El registro cambió mientras se guardaba.");
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "resource",
      entityId,
      eventType: `resource_${body.action}`,
      description: body.reason?.trim() || `Coste ${body.action === "approve" ? "aprobado" : "rechazado"}.`,
      operationId: body.operationId,
      requestFingerprint,
    });
    return saved;
  });
}

router.post("/redfp360/project-time-entries/:entryId/review", route(async (request, response) => {
  const actor = request.auth!;
  const params = ReviewFp360ProjectTimeEntryParams.safeParse(request.params);
  const body = ReviewFp360ProjectTimeEntryBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ entryId: params.data.entryId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectTimeEntries).where(and(eq(fpProjectTimeEntries.id, replay.entityId), eq(fpProjectTimeEntries.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.json(ReviewFp360ProjectTimeEntryResponse.parse(timeEntryResponse(existing)));
      return;
    }
  }
  const saved = await reviewTimeEntryRecord(actor, params.data.entryId, body.data, requestFingerprint);
  response.json(ReviewFp360ProjectTimeEntryResponse.parse(timeEntryResponse(saved)));
}));

router.post("/redfp360/project-resources", route(async (request, response) => {
  const actor = request.auth!;
  const body = CreateFp360ProjectResourceBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: body.error.message });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectResources).where(and(eq(fpProjectResources.id, replay.entityId), eq(fpProjectResources.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.status(200).json(CreateFp360ProjectResourceResponse.parse(resourceResponse(existing)));
      return;
    }
  }
  const created = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, body.data.projectId), eq(fpProjects.tenantId, actor.tenantId))).for("update").limit(1);
    if (!project) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este proyecto.");
    if (project.status !== "in_progress") throw new ProjectsError(409, "Los costes solo se registran durante la ejecución del proyecto.");
    if (body.data.workOrderId) {
      const [work] = await tx.select().from(fpProjectWorkOrders).where(and(
        eq(fpProjectWorkOrders.id, body.data.workOrderId),
        eq(fpProjectWorkOrders.projectId, project.id),
        eq(fpProjectWorkOrders.tenantId, actor.tenantId),
      )).limit(1);
      if (!work) throw new ProjectsError(400, "La orden seleccionada no pertenece a este proyecto.");
    }
    let sourceReference = body.data.sourceReference?.trim() || null;
    const sourceLineId = body.data.sourceLineId?.trim() || null;
    let unitCostCents = body.data.unitCostCents ?? 0;
    if (body.data.sourceType === "purchase_receipt") {
      if (!sourceLineId) throw new ProjectsError(400, "Selecciona una línea del albarán recibido.");
      const [receiptLine] = await tx.select({
        id: fpPurchaseReceiptLines.id,
        receiptReference: fpPurchaseReceipts.receiptReference,
        receiptStatus: fpPurchaseReceipts.status,
        buyerOrganizationId: fpPurchaseOrders.buyerOrganizationId,
        quantityAccepted: fpPurchaseReceiptLines.quantityAccepted,
        unitPriceCents: fpPurchaseOrderLines.unitPriceCents,
      }).from(fpPurchaseReceiptLines).innerJoin(
        fpPurchaseReceipts,
        eq(fpPurchaseReceipts.id, fpPurchaseReceiptLines.receiptId),
      ).innerJoin(
        fpPurchaseOrders,
        eq(fpPurchaseOrders.id, fpPurchaseReceipts.orderId),
      ).innerJoin(
        fpPurchaseOrderLines,
        eq(fpPurchaseOrderLines.id, fpPurchaseReceiptLines.purchaseOrderLineId),
      ).where(and(
        eq(fpPurchaseReceiptLines.id, sourceLineId),
        eq(fpPurchaseReceiptLines.tenantId, actor.tenantId),
        eq(fpPurchaseReceipts.tenantId, actor.tenantId),
        eq(fpPurchaseOrders.tenantId, actor.tenantId),
        eq(fpPurchaseOrderLines.purchaseOrderId, fpPurchaseOrders.id),
      )).for("update").limit(1);
      if (!receiptLine || receiptLine.receiptStatus !== "received" || receiptLine.buyerOrganizationId !== project.organizationId) {
        throw new ProjectsError(400, "La línea debe pertenecer a un albarán recibido de esta empresa.");
      }
      const priorAllocations = await tx.select().from(fpProjectResources).where(and(
        eq(fpProjectResources.tenantId, actor.tenantId),
        eq(fpProjectResources.sourceLineId, sourceLineId),
      ));
      const alreadyAllocated = priorAllocations.filter((row) => row.status !== "rejected").reduce((sum, row) => sum + row.quantityUnits, 0);
      if (body.data.quantityUnits > receiptLine.quantityAccepted - alreadyAllocated) {
        throw new ProjectsError(409, "La cantidad supera las unidades aceptadas disponibles en el albarán.");
      }
      sourceReference = receiptLine.receiptReference;
      unitCostCents = receiptLine.unitPriceCents;
    } else if (sourceLineId) {
      throw new ProjectsError(400, "La referencia de línea solo se usa con un albarán de compra.");
    } else if (body.data.unitCostCents === undefined) {
      throw new ProjectsError(400, "Indica el coste unitario didáctico.");
    }
    const totalCostCents = body.data.quantityUnits * unitCostCents;
    if (!Number.isSafeInteger(totalCostCents) || totalCostCents > 1000000000) throw new ProjectsError(400, "El coste supera el límite permitido para esta simulación.");
    const id = newId("project-resource");
    const [saved] = await tx.insert(fpProjectResources).values({
      id,
      tenantId: actor.tenantId,
      organizationId: project.organizationId,
      projectId: project.id,
      workOrderId: body.data.workOrderId ?? null,
      resourceType: body.data.resourceType,
      description: body.data.description.trim(),
      quantityUnits: body.data.quantityUnits,
      unitCostCents,
      totalCostCents,
      sourceType: body.data.sourceType,
      sourceReference,
      sourceLineId,
      status: "pending_review",
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    }).returning();
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "resource",
      entityId: id,
      eventType: "resource_submitted",
      description: `Coste de recurso remitido: ${saved.description}.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.status(201).json(CreateFp360ProjectResourceResponse.parse(resourceResponse(created)));
}));

router.post("/redfp360/project-resources/:resourceId/review", route(async (request, response) => {
  const actor = request.auth!;
  const params = ReviewFp360ProjectResourceParams.safeParse(request.params);
  const body = ReviewFp360ProjectResourceBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ resourceId: params.data.resourceId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectResources).where(and(eq(fpProjectResources.id, replay.entityId), eq(fpProjectResources.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.json(ReviewFp360ProjectResourceResponse.parse(resourceResponse(existing)));
      return;
    }
  }
  const saved = await reviewResourceRecord(actor, params.data.resourceId, body.data, requestFingerprint);
  response.json(ReviewFp360ProjectResourceResponse.parse(resourceResponse(saved)));
}));

router.post("/redfp360/projects/:projectId/milestones", route(async (request, response) => {
  const actor = request.auth!;
  const params = CreateFp360ProjectMilestoneParams.safeParse(request.params);
  const body = CreateFp360ProjectMilestoneBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ projectId: params.data.projectId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectMilestones).where(and(eq(fpProjectMilestones.id, replay.entityId), eq(fpProjectMilestones.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.status(200).json(CreateFp360ProjectMilestoneResponse.parse(milestoneResponse(existing)));
      return;
    }
  }
  if (body.data.dueDate && !validScenarioDate(body.data.dueDate)) {
    response.status(400).json({ error: "La fecha del hito debe estar entre 2027 y 2028." });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, params.data.projectId), eq(fpProjects.tenantId, actor.tenantId))).for("update").limit(1);
    if (!project) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este proyecto.");
    if (!["planned", "in_progress"].includes(project.status)) throw new ProjectsError(409, "El proyecto debe estar planificado o en ejecución.");
    if (body.data.dueDate && (body.data.dueDate < project.startDate || body.data.dueDate > project.endDate)) {
      throw new ProjectsError(400, "La fecha objetivo del hito debe estar dentro del calendario del proyecto.");
    }
    if (project.projectType === "internal" && body.data.billingAmountCents > 0) throw new ProjectsError(400, "Un proyecto interno no puede incluir hitos facturables.");
    const id = newId("project-milestone");
    const [saved] = await tx.insert(fpProjectMilestones).values({
      id,
      tenantId: actor.tenantId,
      organizationId: project.organizationId,
      projectId: project.id,
      milestoneRef: childRef("HIT"),
      title: body.data.title.trim(),
      description: body.data.description.trim(),
      dueDate: body.data.dueDate ?? null,
      billingAmountCents: body.data.billingAmountCents,
      requiresApproval: body.data.requiresApproval,
      status: "planned",
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    }).returning();
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "milestone",
      entityId: id,
      eventType: "milestone_created",
      description: `Hito ${saved.milestoneRef} planificado.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.status(201).json(CreateFp360ProjectMilestoneResponse.parse(milestoneResponse(created)));
}));

router.post("/redfp360/project-milestones/:milestoneId/actions", route(async (request, response) => {
  const actor = request.auth!;
  const params = ActOnFp360ProjectMilestoneParams.safeParse(request.params);
  const body = ActOnFp360ProjectMilestoneBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ milestoneId: params.data.milestoneId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectMilestones).where(and(eq(fpProjectMilestones.id, replay.entityId), eq(fpProjectMilestones.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.json(ActOnFp360ProjectMilestoneResponse.parse(milestoneResponse(existing)));
      return;
    }
  }
  const updated = await db.transaction(async (tx) => {
    const [milestone] = await tx.select().from(fpProjectMilestones).where(and(eq(fpProjectMilestones.id, params.data.milestoneId), eq(fpProjectMilestones.tenantId, actor.tenantId))).for("update").limit(1);
    if (!milestone) throw new ProjectsError(404, "No se encontró el hito.");
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, milestone.projectId), eq(fpProjects.tenantId, actor.tenantId))).limit(1);
    if (!project || project.organizationId !== milestone.organizationId) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este proyecto.");
    const action = body.data.action;
    if (["accept", "reject"].includes(action) && !isTeacher(actor)) throw new ProjectsError(403, "La conformidad de un hito requiere revisión docente.");
    if (action === "reject" && !body.data.description?.trim()) throw new ProjectsError(400, "Explica el motivo del rechazo del hito.");
    let status = milestone.status;
    if (action === "start" && status === "planned") status = "in_progress";
    else if (action === "submit" && ["planned", "in_progress"].includes(status)) status = "submitted";
    else if (action === "accept" && status === "submitted") {
      if (milestone.requiresApproval) {
        const accepted = await tx.select({ id: fpProjectDeliverables.id }).from(fpProjectDeliverables).where(and(
          eq(fpProjectDeliverables.tenantId, actor.tenantId),
          eq(fpProjectDeliverables.projectId, project.id),
          eq(fpProjectDeliverables.milestoneId, milestone.id),
          eq(fpProjectDeliverables.status, "accepted"),
        ));
        if (!accepted.length) throw new ProjectsError(409, "Valida al menos un entregable antes de aceptar este hito.");
      }
      status = "accepted";
    } else if (action === "reject" && status === "submitted") status = "rejected";
    else throw new ProjectsError(409, "La acción no está permitida desde el estado actual.");
    const now = new Date();
    const [saved] = await tx.update(fpProjectMilestones).set({
      status,
      updatedAt: now,
      acceptedAt: action === "accept" ? now : milestone.acceptedAt,
      reviewedByUserId: ["accept", "reject"].includes(action) ? actor.userId : milestone.reviewedByUserId,
      reviewedByName: ["accept", "reject"].includes(action) ? actor.displayName : milestone.reviewedByName,
    }).where(and(eq(fpProjectMilestones.id, milestone.id), eq(fpProjectMilestones.status, milestone.status))).returning();
    if (!saved) throw new ProjectsError(409, "El hito cambió mientras se guardaba.");
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "milestone",
      entityId: milestone.id,
      eventType: `milestone_${action}`,
      description: body.data.description?.trim() || `Hito ${milestone.milestoneRef}: ${action}.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.json(ActOnFp360ProjectMilestoneResponse.parse(milestoneResponse(updated)));
}));

router.post("/redfp360/projects/:projectId/deliverables", route(async (request, response) => {
  const actor = request.auth!;
  const params = CreateFp360ProjectDeliverableParams.safeParse(request.params);
  const body = CreateFp360ProjectDeliverableBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ projectId: params.data.projectId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectDeliverables).where(and(eq(fpProjectDeliverables.id, replay.entityId), eq(fpProjectDeliverables.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.status(200).json(CreateFp360ProjectDeliverableResponse.parse(deliverableResponse(existing)));
      return;
    }
  }
  const created = await db.transaction(async (tx) => {
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, params.data.projectId), eq(fpProjects.tenantId, actor.tenantId))).for("update").limit(1);
    if (!project) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este proyecto.");
    if (!["planned", "in_progress"].includes(project.status)) throw new ProjectsError(409, "El proyecto debe estar planificado o en ejecución.");
    if (body.data.milestoneId) {
      const [milestone] = await tx.select({ id: fpProjectMilestones.id }).from(fpProjectMilestones).where(and(
        eq(fpProjectMilestones.id, body.data.milestoneId),
        eq(fpProjectMilestones.projectId, project.id),
        eq(fpProjectMilestones.tenantId, actor.tenantId),
      )).limit(1);
      if (!milestone) throw new ProjectsError(400, "El hito seleccionado no pertenece a este proyecto.");
    }
    const id = newId("project-deliverable");
    const [saved] = await tx.insert(fpProjectDeliverables).values({
      id,
      tenantId: actor.tenantId,
      organizationId: project.organizationId,
      projectId: project.id,
      milestoneId: body.data.milestoneId ?? null,
      deliverableRef: childRef("ENT"),
      title: body.data.title.trim(),
      description: body.data.description.trim(),
      documentReference: body.data.documentReference?.trim() || null,
      version: 1,
      status: "draft",
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    }).returning();
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "deliverable",
      entityId: id,
      eventType: "deliverable_created",
      description: `Entregable ${saved.deliverableRef} creado.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.status(201).json(CreateFp360ProjectDeliverableResponse.parse(deliverableResponse(created)));
}));

router.post("/redfp360/project-deliverables/:deliverableId/actions", route(async (request, response) => {
  const actor = request.auth!;
  const params = ActOnFp360ProjectDeliverableParams.safeParse(request.params);
  const body = ActOnFp360ProjectDeliverableBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: (params.success ? body.error?.message : params.error.message) ?? "Solicitud inválida." });
    return;
  }
  const requestFingerprint = fingerprint({ deliverableId: params.data.deliverableId, ...body.data });
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectDeliverables).where(and(eq(fpProjectDeliverables.id, replay.entityId), eq(fpProjectDeliverables.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.json(ActOnFp360ProjectDeliverableResponse.parse(deliverableResponse(existing)));
      return;
    }
  }
  const updated = await db.transaction(async (tx) => {
    const [deliverable] = await tx.select().from(fpProjectDeliverables).where(and(eq(fpProjectDeliverables.id, params.data.deliverableId), eq(fpProjectDeliverables.tenantId, actor.tenantId))).for("update").limit(1);
    if (!deliverable) throw new ProjectsError(404, "No se encontró el entregable.");
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, deliverable.projectId), eq(fpProjects.tenantId, actor.tenantId))).limit(1);
    if (!project || project.organizationId !== deliverable.organizationId) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (!await resolveOrganization(actor, project.organizationId)) throw new ProjectsError(403, "No tienes acceso a este proyecto.");
    const action = body.data.action;
    if (["accept", "request_changes", "reject"].includes(action) && !isTeacher(actor)) throw new ProjectsError(403, "La revisión de entregables requiere validación docente.");
    if (["request_changes", "reject"].includes(action) && !body.data.description?.trim()) {
      throw new ProjectsError(400, "Explica los cambios solicitados o el motivo del rechazo.");
    }
    let status = deliverable.status;
    let version = deliverable.version;
    let description = deliverable.description;
    let documentReference = deliverable.documentReference;
    if (action === "submit" && ["draft", "changes_requested"].includes(status)) {
      if (status === "changes_requested") {
        if (!body.data.description?.trim()) throw new ProjectsError(400, "Describe los cambios realizados antes de reenviar.");
        description = body.data.description.trim();
        if (body.data.documentReference !== undefined) documentReference = body.data.documentReference?.trim() || null;
        version += 1;
      }
      status = "submitted";
    } else if (action === "accept" && status === "submitted") status = "accepted";
    else if (action === "request_changes" && status === "submitted") status = "changes_requested";
    else if (action === "reject" && status === "submitted") status = "rejected";
    else throw new ProjectsError(409, "La acción no está permitida desde el estado actual.");
    const now = new Date();
    const [saved] = await tx.update(fpProjectDeliverables).set({
      status,
      version,
      description,
      documentReference,
      updatedAt: now,
      reviewedByUserId: ["accept", "request_changes", "reject"].includes(action) ? actor.userId : deliverable.reviewedByUserId,
      reviewedByName: ["accept", "request_changes", "reject"].includes(action) ? actor.displayName : deliverable.reviewedByName,
      reviewedAt: ["accept", "request_changes", "reject"].includes(action) ? now : deliverable.reviewedAt,
    }).where(and(eq(fpProjectDeliverables.id, deliverable.id), eq(fpProjectDeliverables.status, deliverable.status))).returning();
    if (!saved) throw new ProjectsError(409, "El entregable cambió mientras se guardaba.");
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "deliverable",
      entityId: deliverable.id,
      eventType: `deliverable_${action}`,
      description: body.data.description?.trim() || `Entregable ${deliverable.deliverableRef}: ${action}.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.json(ActOnFp360ProjectDeliverableResponse.parse(deliverableResponse(updated)));
}));

router.post("/redfp360/project-billing-requests", route(async (request, response) => {
  const actor = request.auth!;
  const body = CreateFp360ProjectBillingBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: body.error.message });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const replay = await priorEvent(db, actor, body.data.operationId, requestFingerprint);
  if (replay) {
    const [existing] = await db.select().from(fpProjectBillings).where(and(eq(fpProjectBillings.id, replay.entityId), eq(fpProjectBillings.tenantId, actor.tenantId))).limit(1);
    if (existing) {
      response.status(200).json(await billingResponse(existing, actor.tenantId));
      return;
    }
  }
  const billing = await db.transaction(async (tx) => {
    const [milestone] = await tx.select().from(fpProjectMilestones).where(and(
      eq(fpProjectMilestones.id, body.data.milestoneId),
      eq(fpProjectMilestones.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!milestone) throw new ProjectsError(404, "No se encontró el hito.");
    const [project] = await tx.select().from(fpProjects).where(and(eq(fpProjects.id, milestone.projectId), eq(fpProjects.tenantId, actor.tenantId))).for("update").limit(1);
    if (!project || project.organizationId !== milestone.organizationId) throw new ProjectsError(404, "No se encontró el proyecto.");
    if (actor.organizationId !== project.organizationId) throw new ProjectsError(403, "La orden de servicio debe prepararla un usuario vinculado a la empresa emisora.");
    if (project.projectType !== "external" || !project.customerOrganizationId) throw new ProjectsError(400, "Solo los encargos externos a cliente pueden generar una orden de servicio.");
    if (milestone.status !== "accepted" || milestone.billingAmountCents <= 0) throw new ProjectsError(409, "Solo se factura un hito aceptado con importe acordado.");
    const [existingBilling] = await tx.select().from(fpProjectBillings).where(and(
      eq(fpProjectBillings.tenantId, actor.tenantId),
      eq(fpProjectBillings.milestoneId, milestone.id),
    )).limit(1);
    if (existingBilling) throw new ProjectsError(409, "Este hito ya tiene una orden de servicio. Revisa Facturación para emitir o consultar la factura.");
    const [service] = await tx.select().from(fpProducts).where(and(
      eq(fpProducts.tenantId, actor.tenantId),
      eq(fpProducts.sku, body.data.serviceSku),
      eq(fpProducts.itemType, "service"),
      eq(fpProducts.isActive, true),
      eq(fpProducts.isPublished, true),
      eq(fpProducts.tracksInventory, false),
    )).limit(1);
    if (!service) throw new ProjectsError(400, "Selecciona un servicio activo y aprobado del catálogo.");
    const orderId = newId("project-service-order");
    const orderReference = `PS-SIM-2027-${randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.insert(fpOrders).values({
      id: orderId,
      tenantId: actor.tenantId,
      reference: orderReference,
      buyerOrganizationId: project.customerOrganizationId,
      status: "delivered",
      totalCents: milestone.billingAmountCents,
      simulatedDate: SIMULATED_DATE,
    });
    await tx.insert(fpOrderLines).values({
      id: newId("project-service-line"),
      orderId,
      productId: service.id,
      productName: service.name,
      quantity: 1,
      shippedQuantity: 1,
      receivedQuantity: 0,
      invoicedQuantity: 0,
      unitPriceCents: milestone.billingAmountCents,
      unitCostCents: service.costCents,
      igicBasisPoints: service.igicBasisPoints,
      itemType: "service",
      tracksInventory: false,
    });
    const [saved] = await tx.insert(fpProjectBillings).values({
      id: newId("project-billing"),
      tenantId: actor.tenantId,
      organizationId: project.organizationId,
      projectId: project.id,
      milestoneId: milestone.id,
      orderId,
      serviceSku: service.sku,
      amountCents: milestone.billingAmountCents,
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    }).returning();
    await appendEvent(tx, actor, {
      organizationId: project.organizationId,
      projectId: project.id,
      entityType: "billing",
      entityId: saved.id,
      eventType: "service_order_created",
      description: `Orden de servicio ${orderReference} preparada para el hito ${milestone.milestoneRef}; pendiente de factura.`,
      operationId: body.data.operationId,
      requestFingerprint,
    });
    return saved;
  });
  response.status(201).json(await billingResponse(billing, actor.tenantId));
}));

async function billingResponse(row: typeof fpProjectBillings.$inferSelect, tenantId: string) {
  const [order] = await db.select({ reference: fpOrders.reference }).from(fpOrders).where(and(eq(fpOrders.id, row.orderId), eq(fpOrders.tenantId, tenantId))).limit(1);
  const [invoice] = await db.select({ id: fpInvoices.id, reference: fpInvoices.reference }).from(fpInvoices).where(and(eq(fpInvoices.orderId, row.orderId), eq(fpInvoices.tenantId, tenantId))).limit(1);
  return CreateFp360ProjectBillingResponse.parse({
    id: row.id,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    orderId: row.orderId,
    orderReference: order?.reference ?? "",
    serviceSku: row.serviceSku,
    amountCents: row.amountCents,
    invoiceId: invoice?.id ?? null,
    invoiceReference: invoice?.reference ?? null,
    createdByName: row.createdByName,
    createdAt: asIso(row.createdAt)!,
  });
}

export default router;

import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  ActOnFp360TaxDeclarationBody,
  ActOnFp360TaxDeclarationParams,
  ActOnFp360TaxDeclarationResponse,
  ActOnFp360TaxRequirementBody,
  ActOnFp360TaxRequirementParams,
  ActOnFp360TaxRequirementResponse,
  CreateFp360TaxDeclarationBody,
  CreateFp360TaxDeclarationResponse,
  CreateFp360TaxRequirementBody,
  CreateFp360TaxRequirementResponse,
  GetFp360TaxOverviewQueryParams,
  GetFp360TaxOverviewResponse,
} from "@workspace/api-zod";
import {
  db,
  fpInvoices,
  fpOrganizations,
  fpPurchaseInvoices,
  fpPurchaseOrders,
  fpTaxDeclarations,
  fpTaxEvents,
  fpTaxRequirements,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/redfp360/tax", requireAuth, requireSimulationWriteAccess);
const SIMULATED_DATE = "2027-09-15";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Period = { start: string; end: string; annual: boolean };

class TaxError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof TaxError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 tax operation failed");
      next(error);
    });
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function parsePeriod(periodKey: string): Period | null {
  const yearOnly = /^(\d{4})$/.exec(periodKey);
  if (yearOnly?.[1]) return { start: `${yearOnly[1]}-01-01`, end: `${yearOnly[1]}-12-31`, annual: true };
  const quarter = /^(\d{4})-Q([1-4])$/.exec(periodKey);
  if (!quarter?.[1] || !quarter[2]) return null;
  const year = Number(quarter[1]);
  const quarterNumber = Number(quarter[2]);
  const startMonth = (quarterNumber - 1) * 3 + 1;
  const endDate = new Date(Date.UTC(year, startMonth + 2, 0));
  return {
    start: `${quarter[1]}-${String(startMonth).padStart(2, "0")}-01`,
    end: endDate.toISOString().slice(0, 10),
    annual: false,
  };
}

function modelMatches(taxType: string, modelCode: string, annual: boolean): boolean {
  if (taxType === "igic") return annual ? modelCode === "425" : modelCode === "420";
  if (taxType !== "withholding") return false;
  return annual ? modelCode === "190" : ["111", "115"].includes(modelCode);
}

async function resolveOrganization(actor: AuthContext, organizationId: string): Promise<string | null> {
  if (actor.organizationId && actor.organizationId !== organizationId) return null;
  if (!actor.organizationId && !["teacher", "administrator"].includes(actor.role)) return null;
  const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return organization?.id ?? null;
}

function canReview(actor: AuthContext): boolean {
  return ["teacher", "administrator"].includes(actor.role);
}

async function sourceDocuments(tenantId: string, organizationId: string, period: Period) {
  const [sales, purchases] = await Promise.all([
    db.select({
      id: fpInvoices.id,
      reference: fpInvoices.reference,
      date: fpInvoices.simulatedDate,
      counterparty: fpInvoices.buyerName,
      baseCents: fpInvoices.baseCents,
      taxCents: fpInvoices.igicCents,
    }).from(fpInvoices).where(and(
      eq(fpInvoices.tenantId, tenantId),
      eq(fpInvoices.issuerOrganizationId, organizationId),
      gte(fpInvoices.simulatedDate, period.start),
      lte(fpInvoices.simulatedDate, period.end),
    )).orderBy(asc(fpInvoices.simulatedDate), asc(fpInvoices.reference)),
    db.select({
      id: fpPurchaseInvoices.id,
      reference: fpPurchaseInvoices.invoiceReference,
      date: fpPurchaseInvoices.invoiceDate,
      supplierOrganizationId: fpPurchaseInvoices.supplierOrganizationId,
      baseCents: fpPurchaseInvoices.baseCents,
      taxCents: fpPurchaseInvoices.igicCents,
      status: fpPurchaseInvoices.status,
    }).from(fpPurchaseInvoices)
      .innerJoin(fpPurchaseOrders, eq(fpPurchaseOrders.id, fpPurchaseInvoices.orderId))
      .where(and(
        eq(fpPurchaseInvoices.tenantId, tenantId),
        eq(fpPurchaseOrders.tenantId, tenantId),
        eq(fpPurchaseOrders.buyerOrganizationId, organizationId),
        eq(fpPurchaseInvoices.status, "conformed"),
        gte(fpPurchaseInvoices.invoiceDate, period.start),
        lte(fpPurchaseInvoices.invoiceDate, period.end),
      )).orderBy(asc(fpPurchaseInvoices.invoiceDate), asc(fpPurchaseInvoices.invoiceReference)),
  ]);
  const supplierIds = [...new Set(purchases.map((item) => item.supplierOrganizationId))];
  const suppliers = supplierIds.length ? await db.select({
    id: fpOrganizations.id,
    name: fpOrganizations.name,
  }).from(fpOrganizations).where(and(
    eq(fpOrganizations.tenantId, tenantId),
    inArray(fpOrganizations.id, supplierIds),
  )) : [];
  const supplierNames = new Map(suppliers.map((item) => [item.id, item.name]));
  return {
    sales,
    purchases,
    documents: [
      ...sales.map((item) => ({
        id: item.id,
        sourceType: "sales_invoice" as const,
        reference: item.reference,
        date: item.date,
        counterparty: item.counterparty,
        baseCents: item.baseCents,
        taxCents: item.taxCents,
        status: "emitida",
      })),
      ...purchases.map((item) => ({
        id: item.id,
        sourceType: "purchase_invoice" as const,
        reference: item.reference,
        date: item.date,
        counterparty: supplierNames.get(item.supplierOrganizationId) ?? "Proveedor simulado",
        baseCents: item.baseCents,
        taxCents: item.taxCents,
        status: item.status,
      })),
    ],
  };
}

async function calculateDeclaration(
  tenantId: string,
  declaration: typeof fpTaxDeclarations.$inferSelect,
) {
  const period = { start: declaration.periodStart, end: declaration.periodEnd, annual: declaration.periodStart.endsWith("-01-01") && declaration.periodEnd.endsWith("-12-31") };
  if (declaration.taxType === "withholding") {
    return {
      taxableBaseCents: 0,
      outputIgicCents: 0,
      inputIgicCents: 0,
      withholdingBaseCents: declaration.withholdingBaseCents,
      withholdingCents: declaration.withholdingCents,
      resultCents: declaration.withholdingCents,
      sourceInvoiceIds: [] as string[],
      sourcePurchaseInvoiceIds: [] as string[],
    };
  }
  const docs = await sourceDocuments(tenantId, declaration.organizationId, period);
  const outputIgicCents = docs.sales.reduce((sum, item) => sum + item.taxCents, 0);
  const inputIgicCents = docs.purchases.reduce((sum, item) => sum + item.taxCents, 0);
  return {
    taxableBaseCents: docs.sales.reduce((sum, item) => sum + item.baseCents, 0),
    outputIgicCents,
    inputIgicCents,
    withholdingBaseCents: 0,
    withholdingCents: 0,
    resultCents: outputIgicCents - inputIgicCents,
    sourceInvoiceIds: docs.sales.map((item) => item.id),
    sourcePurchaseInvoiceIds: docs.purchases.map((item) => item.id),
  };
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  details: {
    organizationId: string;
    declarationId?: string | null;
    requirementId?: string | null;
    operationId: string;
    requestFingerprint: string;
    eventType: string;
    description: string;
  },
) {
  await tx.insert(fpTaxEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId: details.organizationId,
    declarationId: details.declarationId ?? null,
    requirementId: details.requirementId ?? null,
    operationId: details.operationId,
    requestFingerprint: details.requestFingerprint,
    eventType: details.eventType,
    description: details.description,
    actorUserId: actor.userId,
    actorName: actor.displayName,
    simulatedDate: SIMULATED_DATE,
  });
}

async function loadDeclaration(id: string, tenantId: string) {
  const [declaration] = await db.select().from(fpTaxDeclarations).where(and(
    eq(fpTaxDeclarations.id, id),
    eq(fpTaxDeclarations.tenantId, tenantId),
  )).limit(1);
  return declaration ?? null;
}

const scenarioObligations = [
  { taxType: "igic" as const, modelCode: "420", periodKey: "2027-Q3", simulatedDueDate: "2027-10-15" },
  { taxType: "withholding" as const, modelCode: "111", periodKey: "2027-Q3", simulatedDueDate: "2027-10-15" },
  { taxType: "withholding" as const, modelCode: "115", periodKey: "2027-Q3", simulatedDueDate: "2027-10-15" },
  { taxType: "igic" as const, modelCode: "425", periodKey: "2027", simulatedDueDate: "2028-02-15" },
  { taxType: "withholding" as const, modelCode: "190", periodKey: "2027", simulatedDueDate: "2028-02-15" },
];

router.get("/redfp360/tax/overview", route(async (request, response) => {
  const parsed = GetFp360TaxOverviewQueryParams.safeParse(request.query);
  if (!parsed.success) {
    response.status(400).json({ error: "Selecciona una empresa válida para consultar Hacienda FP360." });
    return;
  }
  const actor = request.auth as AuthContext;
  const organizationId = await resolveOrganization(actor, parsed.data.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la empresa seleccionada." });
    return;
  }
  const [declarations, requirements, events, documents] = await Promise.all([
    db.select().from(fpTaxDeclarations).where(and(
      eq(fpTaxDeclarations.tenantId, actor.tenantId),
      eq(fpTaxDeclarations.organizationId, organizationId),
    )).orderBy(desc(fpTaxDeclarations.updatedAt)).limit(100),
    db.select().from(fpTaxRequirements).where(and(
      eq(fpTaxRequirements.tenantId, actor.tenantId),
      eq(fpTaxRequirements.organizationId, organizationId),
    )).orderBy(desc(fpTaxRequirements.createdAt)).limit(100),
    db.select().from(fpTaxEvents).where(and(
      eq(fpTaxEvents.tenantId, actor.tenantId),
      eq(fpTaxEvents.organizationId, organizationId),
    )).orderBy(desc(fpTaxEvents.createdAt)).limit(100),
    sourceDocuments(actor.tenantId, organizationId, { start: "2027-01-01", end: "2027-12-31", annual: true }),
  ]);
  const active = declarations.filter((item) => item.status !== "rectified");
  const declarationFor = (taxType: string, modelCode: string, periodKey: string) =>
    active.find((item) => item.taxType === taxType && item.modelCode === modelCode && item.periodKey === periodKey);
  const obligations = scenarioObligations.map((template, index) => {
    const declaration = declarationFor(template.taxType, template.modelCode, template.periodKey);
    const status = declaration?.status ?? (template.simulatedDueDate < SIMULATED_DATE ? "overdue" : "scheduled");
    return {
      id: declaration?.id ?? `scenario-tax-obligation-${index + 1}`,
      taxType: template.taxType,
      modelCode: template.modelCode,
      periodKey: template.periodKey,
      simulatedDueDate: declaration?.simulatedDueDate ?? template.simulatedDueDate,
      status,
      declarationId: declaration?.id ?? null,
    };
  });
  const summary = {
    pendingCount: active.filter((item) => ["draft", "validated", "payment_pending", "refund_pending", "observed"].includes(item.status)).length,
    presentedCount: active.filter((item) => ["presented", "payment_pending", "refund_pending", "closed"].includes(item.status)).length,
    openRequirementCount: requirements.filter((item) => item.status !== "resolved").length,
    outputIgicCents: active.filter((item) => item.taxType === "igic").reduce((sum, item) => sum + item.outputIgicCents, 0),
    inputIgicCents: active.filter((item) => item.taxType === "igic").reduce((sum, item) => sum + item.inputIgicCents, 0),
    resultCents: active.reduce((sum, item) => sum + item.resultCents, 0),
  };
  response.json(GetFp360TaxOverviewResponse.parse({
    organizationId,
    simulatedDate: SIMULATED_DATE,
    summary,
    obligations,
    declarations,
    sourceDocuments: documents.documents,
    requirements,
    events,
  }));
}));

router.post("/redfp360/tax/declarations", route(async (request, response) => {
  const body = CreateFp360TaxDeclarationBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa los campos del borrador fiscal." });
    return;
  }
  const actor = request.auth as AuthContext;
  const input = body.data;
  const organizationId = await resolveOrganization(actor, input.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la empresa seleccionada." });
    return;
  }
  const period = parsePeriod(input.periodKey);
  if (!period || !modelMatches(input.taxType, input.modelCode, period.annual)) {
    response.status(400).json({ error: "El modelo educativo no corresponde al tipo y periodo seleccionado." });
    return;
  }
  if (input.simulatedDueDate && !validDate(input.simulatedDueDate)) {
    response.status(400).json({ error: "La fecha simulada no es válida." });
    return;
  }
  const requestFingerprint = fingerprint(input);
  const [prior] = await db.select().from(fpTaxDeclarations).where(and(
    eq(fpTaxDeclarations.tenantId, actor.tenantId),
    eq(fpTaxDeclarations.operationId, input.operationId),
  )).limit(1);
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    response.json(CreateFp360TaxDeclarationResponse.parse(prior));
    return;
  }
  if (input.taxType === "withholding"
    && ((input.withholdingBaseCents ?? 0) < 0
      || (input.withholdingCents ?? 0) < 0
      || (input.withholdingCents ?? 0) > (input.withholdingBaseCents ?? 0))) {
    response.status(400).json({ error: "La retención didáctica debe ser positiva y no superar su base." });
    return;
  }
  const [existing] = await db.select({ id: fpTaxDeclarations.id }).from(fpTaxDeclarations).where(and(
    eq(fpTaxDeclarations.tenantId, actor.tenantId),
    eq(fpTaxDeclarations.organizationId, organizationId),
    eq(fpTaxDeclarations.taxType, input.taxType),
    eq(fpTaxDeclarations.modelCode, input.modelCode),
    eq(fpTaxDeclarations.periodKey, input.periodKey),
  )).limit(1);
  if (existing) {
    response.status(409).json({ error: "Ya existe un expediente para ese modelo y periodo. Usa Rectificar para crear una versión nueva." });
    return;
  }
  const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId), eq(fpOrganizations.tenantId, actor.tenantId),
  )).limit(1);
  if (!organization) {
    response.status(404).json({ error: "La empresa no está disponible." });
    return;
  }
  const draftValues = {
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId,
    taxType: input.taxType,
    modelCode: input.modelCode,
    periodKey: input.periodKey,
    periodStart: period.start,
    periodEnd: period.end,
    simulatedDueDate: input.simulatedDueDate ?? scenarioObligations.find((item) =>
      item.taxType === input.taxType && item.modelCode === input.modelCode && item.periodKey === input.periodKey)?.simulatedDueDate ?? null,
    version: 1,
    status: "draft",
    paymentStatus: "not_due",
    sourceInvoiceIds: [] as string[],
    sourcePurchaseInvoiceIds: [] as string[],
    taxableBaseCents: 0,
    outputIgicCents: 0,
    inputIgicCents: 0,
    withholdingBaseCents: input.withholdingBaseCents ?? 0,
    withholdingCents: input.withholdingCents ?? 0,
    resultCents: input.taxType === "withholding" ? input.withholdingCents ?? 0 : 0,
    receiptReference: null,
    supersedesId: null,
    operationId: input.operationId,
    requestFingerprint,
    createdByUserId: actor.userId,
    createdByName: actor.displayName,
    lastActionByUserId: null,
    lastActionByName: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const calculated = input.taxType === "igic"
    ? await calculateDeclaration(actor.tenantId, { ...draftValues } as typeof fpTaxDeclarations.$inferSelect)
    : null;
  const values = calculated ? { ...draftValues, ...calculated } : draftValues;
  const declaration = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpTaxDeclarations).values(values).returning();
    if (!created) throw new TaxError(500, "No se pudo guardar el borrador.");
    await appendEvent(tx, actor, {
      organizationId, declarationId: created.id, operationId: input.operationId, requestFingerprint,
      eventType: "draft_created", description: `Borrador ${created.modelCode} · ${created.periodKey} creado sin validez oficial.`,
    });
    return created;
  });
  response.status(201).json(CreateFp360TaxDeclarationResponse.parse(declaration));
}));

router.post("/redfp360/tax/declarations/:id/action", route(async (request, response) => {
  const params = ActOnFp360TaxDeclarationParams.safeParse(request.params);
  const body = ActOnFp360TaxDeclarationBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción solicitada." });
    return;
  }
  const actor = request.auth as AuthContext;
  const declaration = await loadDeclaration(params.data.id, actor.tenantId);
  if (!declaration) {
    response.status(404).json({ error: "No se encontró el expediente fiscal." });
    return;
  }
  if (!await resolveOrganization(actor, declaration.organizationId)) {
    response.status(403).json({ error: "No tienes acceso a este expediente." });
    return;
  }
  const input = body.data;
  if (input.action === "observe" && !canReview(actor)) {
    response.status(403).json({ error: "Solo el profesorado puede observar un expediente." });
    return;
  }
  if (input.action === "observe" && !input.reason?.trim()) {
    response.status(400).json({ error: "Indica el motivo de la observación." });
    return;
  }
  const requestFingerprint = fingerprint({ id: declaration.id, ...input });
  const [priorEvent] = await db.select().from(fpTaxEvents).where(and(
    eq(fpTaxEvents.tenantId, actor.tenantId),
    eq(fpTaxEvents.operationId, input.operationId),
  )).limit(1);
  if (priorEvent) {
    if (priorEvent.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const result = await loadDeclaration(priorEvent.declarationId ?? declaration.id, actor.tenantId);
    if (result) {
      response.json(ActOnFp360TaxDeclarationResponse.parse(result));
      return;
    }
  }
  let result = declaration;
  await db.transaction(async (tx) => {
    const [current] = await tx.select().from(fpTaxDeclarations).where(and(
      eq(fpTaxDeclarations.id, declaration.id),
      eq(fpTaxDeclarations.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!current) throw new TaxError(404, "No se encontró el expediente fiscal.");
    let updated: typeof fpTaxDeclarations.$inferSelect;
    let eventType: string = input.action;
    let description = "";
    if (input.action === "rectify") {
      if (!["presented", "payment_pending", "refund_pending", "closed", "observed"].includes(current.status)) {
        throw new TaxError(409, "Solo se puede rectificar un expediente ya presentado o cerrado.");
      }
      const [latest] = await tx.select().from(fpTaxDeclarations).where(and(
        eq(fpTaxDeclarations.tenantId, actor.tenantId),
        eq(fpTaxDeclarations.organizationId, current.organizationId),
        eq(fpTaxDeclarations.taxType, current.taxType),
        eq(fpTaxDeclarations.modelCode, current.modelCode),
        eq(fpTaxDeclarations.periodKey, current.periodKey),
      )).orderBy(desc(fpTaxDeclarations.version)).limit(1);
      await tx.update(fpTaxDeclarations).set({
        status: "rectified", lastActionByUserId: actor.userId, lastActionByName: actor.displayName, updatedAt: new Date(),
      }).where(eq(fpTaxDeclarations.id, current.id));
      const [created] = await tx.insert(fpTaxDeclarations).values({
        ...current,
        id: randomUUID(),
        version: (latest?.version ?? current.version) + 1,
        status: "draft",
        paymentStatus: "not_due",
        receiptReference: null,
        supersedesId: current.id,
        operationId: input.operationId,
        requestFingerprint,
        createdByUserId: actor.userId,
        createdByName: actor.displayName,
        lastActionByUserId: null,
        lastActionByName: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();
      if (!created) throw new TaxError(500, "No se pudo crear la versión rectificativa.");
      updated = created;
      eventType = "rectification_created";
      description = `Nueva versión ${created.version} creada sobre ${current.receiptReference ?? current.id}.`;
    } else {
      if (input.action === "recalculate" || input.action === "validate") {
        if (!["draft", "observed"].includes(current.status)) {
          throw new TaxError(409, "Solo se pueden calcular o validar borradores y expedientes observados.");
        }
        const amounts = await calculateDeclaration(actor.tenantId, current);
        const nextStatus = input.action === "validate" ? "validated" : "draft";
        [updated] = await tx.update(fpTaxDeclarations).set({
          ...amounts,
          status: nextStatus,
          lastActionByUserId: actor.userId,
          lastActionByName: actor.displayName,
          updatedAt: new Date(),
        }).where(eq(fpTaxDeclarations.id, current.id)).returning();
        if (!updated) throw new TaxError(500, "No se pudo actualizar el borrador.");
        description = input.action === "validate"
          ? `Expediente ${current.modelCode} validado con reglas educativas deterministas.`
          : `Importes del expediente ${current.modelCode} recalculados desde los documentos disponibles.`;
      } else if (input.action === "present") {
        if (current.status !== "validated") throw new TaxError(409, "Valida el borrador antes de presentarlo en la sede simulada.");
        const [openRequirement] = await tx.select({ id: fpTaxRequirements.id }).from(fpTaxRequirements).where(and(
          eq(fpTaxRequirements.tenantId, actor.tenantId),
          eq(fpTaxRequirements.declarationId, current.id),
          eq(fpTaxRequirements.status, "open"),
        )).limit(1);
        if (openRequirement) throw new TaxError(409, "Responde el requerimiento abierto antes de presentar el expediente.");
        [updated] = await tx.update(fpTaxDeclarations).set({
          status: "presented",
          receiptReference: `SIM-TAX-${randomUUID().slice(0, 8).toUpperCase()}`,
          lastActionByUserId: actor.userId,
          lastActionByName: actor.displayName,
          updatedAt: new Date(),
        }).where(eq(fpTaxDeclarations.id, current.id)).returning();
        if (!updated) throw new TaxError(500, "No se pudo registrar la presentación simulada.");
        description = "Presentación registrada únicamente en la sede educativa simulada; no se envió a ningún organismo.";
      } else if (input.action === "request_payment") {
        if (current.status !== "presented") throw new TaxError(409, "Solo se puede generar una orden educativa desde un expediente presentado.");
        if (current.resultCents === 0) throw new TaxError(409, "El resultado es cero; no se necesita una orden de pago ni devolución.");
        const paymentStatus = current.resultCents > 0 ? "pending" : "refund_pending";
        const status = current.resultCents > 0 ? "payment_pending" : "refund_pending";
        [updated] = await tx.update(fpTaxDeclarations).set({
          paymentStatus, status, lastActionByUserId: actor.userId, lastActionByName: actor.displayName, updatedAt: new Date(),
        }).where(eq(fpTaxDeclarations.id, current.id)).returning();
        if (!updated) throw new TaxError(500, "No se pudo registrar la orden simulada.");
        description = current.resultCents > 0
          ? "Orden de pago educativa creada; el expediente permanece pendiente de confirmación bancaria simulada."
          : "Solicitud de devolución educativa creada; no se ha realizado ningún abono.";
      } else if (input.action === "close") {
        if (current.resultCents !== 0 && current.paymentStatus !== "paid" && current.paymentStatus !== "refund_requested") {
          throw new TaxError(409, "No se puede cerrar: el pago o la devolución aún no están confirmados desde Banco FP360.");
        }
        if (!["presented", "payment_pending", "refund_pending"].includes(current.status)) {
          throw new TaxError(409, "El expediente no está preparado para cerrarse.");
        }
        [updated] = await tx.update(fpTaxDeclarations).set({
          status: "closed", lastActionByUserId: actor.userId, lastActionByName: actor.displayName, updatedAt: new Date(),
        }).where(eq(fpTaxDeclarations.id, current.id)).returning();
        if (!updated) throw new TaxError(500, "No se pudo cerrar el expediente.");
        description = "Expediente cerrado en el escenario didáctico.";
      } else {
        [updated] = await tx.update(fpTaxDeclarations).set({
          status: "observed", lastActionByUserId: actor.userId, lastActionByName: actor.displayName, updatedAt: new Date(),
        }).where(eq(fpTaxDeclarations.id, current.id)).returning();
        if (!updated) throw new TaxError(500, "No se pudo registrar la observación.");
        description = input.reason!.trim();
      }
    }
    await appendEvent(tx, actor, {
      organizationId: current.organizationId,
      declarationId: updated.id,
      operationId: input.operationId,
      requestFingerprint,
      eventType,
      description,
    });
    result = updated;
  });
  response.json(ActOnFp360TaxDeclarationResponse.parse(result));
}));

router.post("/redfp360/tax/requirements", route(async (request, response) => {
  const body = CreateFp360TaxRequirementBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa los datos del requerimiento didáctico." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!canReview(actor)) {
    response.status(403).json({ error: "Solo el profesorado puede emitir requerimientos educativos." });
    return;
  }
  const declaration = await loadDeclaration(body.data.declarationId, actor.tenantId);
  if (!declaration || !await resolveOrganization(actor, declaration.organizationId)) {
    response.status(404).json({ error: "No se encontró el expediente fiscal autorizado." });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const [prior] = await db.select().from(fpTaxRequirements).where(and(
    eq(fpTaxRequirements.tenantId, actor.tenantId),
    eq(fpTaxRequirements.operationId, body.data.operationId),
  )).limit(1);
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    response.json(CreateFp360TaxRequirementResponse.parse(prior));
    return;
  }
  const requirement = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpTaxRequirements).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId: declaration.organizationId,
      declarationId: declaration.id,
      reference: `SIM-REQ-${randomUUID().slice(0, 8).toUpperCase()}`,
      title: body.data.title,
      detail: body.data.detail,
      status: "open",
      response: null,
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      respondedByUserId: null,
      respondedByName: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();
    if (!created) throw new TaxError(500, "No se pudo crear el requerimiento.");
    await appendEvent(tx, actor, {
      organizationId: declaration.organizationId, declarationId: declaration.id, requirementId: created.id,
      operationId: body.data.operationId, requestFingerprint, eventType: "requirement_created",
      description: `Requerimiento educativo ${created.reference}: ${created.title}`,
    });
    return created;
  });
  response.status(201).json(CreateFp360TaxRequirementResponse.parse(requirement));
}));

router.post("/redfp360/tax/requirements/:id/action", route(async (request, response) => {
  const params = ActOnFp360TaxRequirementParams.safeParse(request.params);
  const body = ActOnFp360TaxRequirementBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción solicitada." });
    return;
  }
  const actor = request.auth as AuthContext;
  const [requirement] = await db.select().from(fpTaxRequirements).where(and(
    eq(fpTaxRequirements.id, params.data.id),
    eq(fpTaxRequirements.tenantId, actor.tenantId),
  )).limit(1);
  if (!requirement || !await resolveOrganization(actor, requirement.organizationId)) {
    response.status(404).json({ error: "No se encontró el requerimiento autorizado." });
    return;
  }
  if (body.data.action === "resolve" && !canReview(actor)) {
    response.status(403).json({ error: "Solo el profesorado puede cerrar un requerimiento." });
    return;
  }
  if (body.data.action === "respond" && !body.data.response?.trim()) {
    response.status(400).json({ error: "Escribe una respuesta antes de enviar." });
    return;
  }
  const requestFingerprint = fingerprint({ id: requirement.id, ...body.data });
  const [priorEvent] = await db.select().from(fpTaxEvents).where(and(
    eq(fpTaxEvents.tenantId, actor.tenantId),
    eq(fpTaxEvents.operationId, body.data.operationId),
  )).limit(1);
  if (priorEvent) {
    if (priorEvent.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const [saved] = await db.select().from(fpTaxRequirements).where(and(
      eq(fpTaxRequirements.id, requirement.id), eq(fpTaxRequirements.tenantId, actor.tenantId),
    )).limit(1);
    if (saved) {
      response.json(ActOnFp360TaxRequirementResponse.parse(saved));
      return;
    }
  }
  const updated = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(fpTaxRequirements).where(and(
      eq(fpTaxRequirements.id, requirement.id), eq(fpTaxRequirements.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!current) throw new TaxError(404, "No se encontró el requerimiento.");
    if (current.status === "resolved") throw new TaxError(409, "El requerimiento ya está cerrado.");
    if (body.data.action === "respond" && current.status !== "open") {
      throw new TaxError(409, "Solo se puede responder a un requerimiento abierto.");
    }
    if (body.data.action === "resolve" && current.status !== "answered") {
      throw new TaxError(409, "El requerimiento debe tener una respuesta antes de cerrarlo.");
    }
    const [saved] = await tx.update(fpTaxRequirements).set({
      status: body.data.action === "respond" ? "answered" : "resolved",
      response: body.data.action === "respond" ? body.data.response!.trim() : current.response,
      respondedByUserId: body.data.action === "respond" ? actor.userId : current.respondedByUserId,
      respondedByName: body.data.action === "respond" ? actor.displayName : current.respondedByName,
      updatedAt: new Date(),
    }).where(eq(fpTaxRequirements.id, current.id)).returning();
    if (!saved) throw new TaxError(500, "No se pudo guardar la respuesta.");
    await appendEvent(tx, actor, {
      organizationId: current.organizationId,
      declarationId: current.declarationId,
      requirementId: current.id,
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: body.data.action === "respond" ? "requirement_answered" : "requirement_resolved",
      description: body.data.action === "respond"
        ? `Respuesta educativa registrada: ${body.data.response!.trim().slice(0, 300)}`
        : `Requerimiento ${current.reference} resuelto por el profesorado.`,
    });
    return saved;
  });
  response.json(ActOnFp360TaxRequirementResponse.parse(updated));
}));

export default router;

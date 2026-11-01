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
  UpdateFp360TaxProfileBody,
  UpdateFp360TaxProfileResponse,
} from "@workspace/api-zod";
import {
  db,
  fpInvoices,
  fpOrganizations,
  fpPurchaseInvoices,
  fpPurchaseOrders,
  fpTaxDeclarations,
  fpTaxEvents,
  fpTaxProfiles,
  fpTaxRequirements,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";
import {
  buildModelCatalog,
  getTaxModel,
  modelMatchesPeriod,
  type TaxProfile,
} from "./tax-models";

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

function eurosToCents(value?: string): number {
  if (!value?.trim()) return 0;
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) && Math.abs(amount) <= 10_000_000 ? Math.round(amount * 100) : 0;
}

function validateFormData(modelCode: string, data: Record<string, string>): string | null {
  const model = getTaxModel(modelCode);
  if (!model) return "Selecciona un modelo oficial disponible.";
  const allowed = new Set(model.formFields.map((field) => field.key));
  if (Object.keys(data).some((key) => !allowed.has(key))) return "El formulario contiene campos que no pertenecen al modelo seleccionado.";
  for (const field of model.formFields) {
    const value = data[field.key]?.trim() ?? "";
    if (field.required && !value) return `Completa el campo «${field.label}».`;
    if (field.kind === "number" && value && !/^-?\d+(?:[.,]\d{1,2})?$/.test(value)) {
      return `El campo «${field.label}» debe contener un importe o número válido.`;
    }
    if (field.kind === "checkbox" && field.required && value !== "true") {
      return `Confirma el campo «${field.label}» para continuar.`;
    }
  }
  return null;
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
      resultCents: ["111", "115"].includes(declaration.modelCode) ? declaration.withholdingCents : 0,
      sourceInvoiceIds: [] as string[],
      sourcePurchaseInvoiceIds: [] as string[],
    };
  }
  if (["420", "425"].includes(declaration.modelCode)) {
    const docs = await sourceDocuments(tenantId, declaration.organizationId, period);
    const outputIgicCents = docs.sales.reduce((sum, item) => sum + item.taxCents, 0);
    const inputIgicCents = docs.purchases.reduce((sum, item) => sum + item.taxCents, 0);
    return {
      taxableBaseCents: docs.sales.reduce((sum, item) => sum + item.baseCents, 0),
      outputIgicCents,
      inputIgicCents,
      withholdingBaseCents: 0,
      withholdingCents: 0,
      resultCents: declaration.modelCode === "420" ? outputIgicCents - inputIgicCents : 0,
      sourceInvoiceIds: docs.sales.map((item) => item.id),
      sourcePurchaseInvoiceIds: docs.purchases.map((item) => item.id),
    };
  }
  const formData = declaration.formData ?? {};
  return {
    taxableBaseCents: eurosToCents(formData.taxableBaseEuros ?? formData.annualBaseEuros ?? formData.cumulativeIncomeEuros),
    outputIgicCents: 0,
    inputIgicCents: 0,
    withholdingBaseCents: declaration.withholdingBaseCents,
    withholdingCents: declaration.withholdingCents,
    resultCents: eurosToCents(formData.resultEuros),
    sourceInvoiceIds: [] as string[],
    sourcePurchaseInvoiceIds: [] as string[],
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

function simulatedDueDate(modelCode: string): string {
  if (["420", "421", "111", "115", "130", "131"].includes(modelCode)) return "2027-10-15";
  if (modelCode === "100") return "2028-06-15";
  if (modelCode === "200") return "2028-07-15";
  if (["425", "180", "190"].includes(modelCode)) return "2028-01-31";
  if (["415", "347"].includes(modelCode)) return "2028-02-15";
  return "2027-09-15";
}

router.put("/redfp360/tax/profile", route(async (request, response) => {
  const body = UpdateFp360TaxProfileBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa la configuración fiscal de la organización." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!canReview(actor)) {
    response.status(403).json({ error: "Solo el profesorado puede configurar el perfil fiscal." });
    return;
  }
  const input = body.data;
  const organizationId = await resolveOrganization(actor, input.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la empresa seleccionada." });
    return;
  }
  if ((input.entityType === "sociedad" && input.incomeTaxMethod !== "not_applicable")
    || (input.entityType === "autonomo" && input.incomeTaxMethod === "not_applicable")) {
    response.status(400).json({ error: "El método de IRPF debe coincidir con la forma jurídica seleccionada." });
    return;
  }
  const requestFingerprint = fingerprint(input);
  const [priorEvent] = await db.select().from(fpTaxEvents).where(and(
    eq(fpTaxEvents.tenantId, actor.tenantId),
    eq(fpTaxEvents.operationId, input.operationId),
  )).limit(1);
  if (priorEvent) {
    if (priorEvent.actorUserId !== actor.userId || priorEvent.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const [savedProfile] = await db.select().from(fpTaxProfiles).where(and(
      eq(fpTaxProfiles.tenantId, actor.tenantId),
      eq(fpTaxProfiles.organizationId, organizationId),
    )).limit(1);
    if (savedProfile) {
      response.json(UpdateFp360TaxProfileResponse.parse({
        organizationId,
        entityType: savedProfile.entityType,
        igicRegime: savedProfile.igicRegime,
        incomeTaxMethod: savedProfile.incomeTaxMethod,
        hasEmployees: savedProfile.hasEmployees,
        withholdsProfessionals: savedProfile.withholdsProfessionals,
        paysBusinessRent: savedProfile.paysBusinessRent,
        updatedByName: savedProfile.updatedByName,
        updatedAt: savedProfile.updatedAt.toISOString(),
      }));
      return;
    }
  }
  const now = new Date();
  const saved = await db.transaction(async (tx) => {
    const [profile] = await tx.insert(fpTaxProfiles).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId,
      entityType: input.entityType,
      igicRegime: input.igicRegime,
      incomeTaxMethod: input.incomeTaxMethod,
      hasEmployees: input.hasEmployees,
      withholdsProfessionals: input.withholdsProfessionals,
      paysBusinessRent: input.paysBusinessRent,
      updatedByUserId: actor.userId,
      updatedByName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [fpTaxProfiles.tenantId, fpTaxProfiles.organizationId],
      set: {
        entityType: input.entityType,
        igicRegime: input.igicRegime,
        incomeTaxMethod: input.incomeTaxMethod,
        hasEmployees: input.hasEmployees,
        withholdsProfessionals: input.withholdsProfessionals,
        paysBusinessRent: input.paysBusinessRent,
        updatedByUserId: actor.userId,
        updatedByName: actor.displayName,
        updatedAt: now,
      },
    }).returning();
    if (!profile) throw new TaxError(500, "No se pudo guardar el perfil fiscal.");
    await appendEvent(tx, actor, {
      organizationId,
      operationId: input.operationId,
      requestFingerprint,
      eventType: "tax_profile_updated",
      description: `Perfil fiscal educativo actualizado: ${input.entityType}, IGIC ${input.igicRegime}.`,
    });
    return profile;
  });
  response.json(UpdateFp360TaxProfileResponse.parse({
    organizationId,
    entityType: saved.entityType,
    igicRegime: saved.igicRegime,
    incomeTaxMethod: saved.incomeTaxMethod,
    hasEmployees: saved.hasEmployees,
    withholdsProfessionals: saved.withholdsProfessionals,
    paysBusinessRent: saved.paysBusinessRent,
    updatedByName: saved.updatedByName,
    updatedAt: saved.updatedAt.toISOString(),
  }));
}));

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
  const [profileRows, declarations, requirements, events, documents] = await Promise.all([
    db.select().from(fpTaxProfiles).where(and(
      eq(fpTaxProfiles.tenantId, actor.tenantId),
      eq(fpTaxProfiles.organizationId, organizationId),
    )).limit(1),
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
  const savedProfile = profileRows[0];
  const profile: TaxProfile | null = savedProfile ? {
    organizationId,
    entityType: savedProfile.entityType as TaxProfile["entityType"],
    igicRegime: savedProfile.igicRegime as TaxProfile["igicRegime"],
    incomeTaxMethod: savedProfile.incomeTaxMethod as TaxProfile["incomeTaxMethod"],
    hasEmployees: savedProfile.hasEmployees,
    withholdsProfessionals: savedProfile.withholdsProfessionals,
    paysBusinessRent: savedProfile.paysBusinessRent,
    updatedByName: savedProfile.updatedByName,
    updatedAt: savedProfile.updatedAt,
  } : null;
  const totalsByCounterparty = new Map<string, number>();
  for (const document of documents.documents) {
    totalsByCounterparty.set(
      document.counterparty,
      (totalsByCounterparty.get(document.counterparty) ?? 0) + document.baseCents + document.taxCents,
    );
  }
  const atc415ThresholdReached = [...totalsByCounterparty.values()].some((amount) => amount > 300_506);
  const modelCatalog = buildModelCatalog(profile, atc415ThresholdReached);
  const active = declarations.filter((item) => item.status !== "rectified");
  const obligations = modelCatalog.filter((model) => model.applicable && model.periodicity !== "census").map((model, index) => {
    const periodKey = model.periodicity === "annual" ? "2027" : "2027-Q3";
    const declaration = active.find((item) => item.modelCode === model.modelCode && item.periodKey === periodKey);
    const dueDate = declaration?.simulatedDueDate ?? simulatedDueDate(model.modelCode);
    const status = declaration?.status ?? (dueDate < SIMULATED_DATE ? "overdue" : "scheduled");
    return {
      id: declaration?.id ?? `scenario-tax-obligation-${index + 1}`,
      agency: model.agency,
      taxType: model.taxType,
      modelCode: model.modelCode,
      periodKey,
      simulatedDueDate: dueDate,
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
    taxProfile: profile ? { ...profile, updatedAt: profile.updatedAt.toISOString() } : null,
    modelCatalog,
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
  const model = getTaxModel(input.modelCode);
  if (!period || !model || model.taxType !== input.taxType || !modelMatchesPeriod(input.modelCode, period.annual)) {
    response.status(400).json({ error: "El modelo educativo no corresponde al tipo y periodo seleccionado." });
    return;
  }
  const [savedProfile] = await db.select().from(fpTaxProfiles).where(and(
    eq(fpTaxProfiles.tenantId, actor.tenantId),
    eq(fpTaxProfiles.organizationId, organizationId),
  )).limit(1);
  if (!savedProfile) {
    response.status(409).json({ error: "El profesorado debe configurar primero el perfil fiscal de la organización." });
    return;
  }
  const formData = input.formData ?? {};
  const formValidation = validateFormData(input.modelCode, formData);
  if (formValidation) {
    response.status(400).json({ error: formValidation });
    return;
  }
  const profile: TaxProfile = {
    organizationId,
    entityType: savedProfile.entityType as TaxProfile["entityType"],
    igicRegime: savedProfile.igicRegime as TaxProfile["igicRegime"],
    incomeTaxMethod: savedProfile.incomeTaxMethod as TaxProfile["incomeTaxMethod"],
    hasEmployees: savedProfile.hasEmployees,
    withholdsProfessionals: savedProfile.withholdsProfessionals,
    paysBusinessRent: savedProfile.paysBusinessRent,
    updatedByName: savedProfile.updatedByName,
    updatedAt: savedProfile.updatedAt,
  };
  const annualDocuments = await sourceDocuments(actor.tenantId, organizationId, { start: "2027-01-01", end: "2027-12-31", annual: true });
  const amountsByCounterparty = new Map<string, number>();
  for (const document of annualDocuments.documents) {
    amountsByCounterparty.set(document.counterparty, (amountsByCounterparty.get(document.counterparty) ?? 0) + document.baseCents + document.taxCents);
  }
  const applicableModel = buildModelCatalog(profile, [...amountsByCounterparty.values()].some((amount) => amount > 300_506))
    .find((entry) => entry.modelCode === input.modelCode);
  if (applicableModel && applicableModel.applicabilityStatus !== "applies" && !canReview(actor)) {
    response.status(409).json({ error: `${applicableModel.applicabilityStatus === "review_required" ? "Un docente debe revisar" : "El modelo no corresponde al perfil fiscal"}: ${applicableModel.applicabilityNote}` });
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
  const withholdingBaseCents = input.withholdingBaseCents
    ?? eurosToCents(formData.withholdingBaseEuros ?? formData.annualBaseEuros);
  const withholdingCents = input.withholdingCents
    ?? eurosToCents(formData.withholdingEuros ?? formData.annualWithholdingEuros);
  if (input.taxType === "withholding"
    && (withholdingBaseCents < 0 || withholdingCents < 0 || withholdingCents > withholdingBaseCents)) {
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
    simulatedDueDate: input.simulatedDueDate ?? (model.periodicity === "census" ? null : simulatedDueDate(input.modelCode)),
    version: 1,
    status: "draft",
    paymentStatus: "not_due",
    sourceInvoiceIds: [] as string[],
    sourcePurchaseInvoiceIds: [] as string[],
    formData,
    taxableBaseCents: 0,
    outputIgicCents: 0,
    inputIgicCents: 0,
    withholdingBaseCents,
    withholdingCents,
    resultCents: input.taxType === "withholding" ? withholdingCents : eurosToCents(formData.resultEuros),
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
  const calculated = await calculateDeclaration(actor.tenantId, { ...draftValues } as typeof fpTaxDeclarations.$inferSelect);
  const values = { ...draftValues, ...calculated };
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
    if (priorEvent.actorUserId !== actor.userId || priorEvent.requestFingerprint !== requestFingerprint) {
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
        if (!["420", "421", "111", "115", "130", "131", "100", "200"].includes(current.modelCode)) {
          throw new TaxError(409, "Este modelo es censal o informativo y no crea una orden de pago.");
        }
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
    if (priorEvent.actorUserId !== actor.userId || priorEvent.requestFingerprint !== requestFingerprint) {
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

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  AbandonFp360DocumentUploadParams,
  AbandonFp360DocumentUploadResponse,
  ActOnFp360DocumentBody,
  ActOnFp360DocumentDossierBody,
  ActOnFp360DocumentDossierParams,
  ActOnFp360DocumentDossierResponse,
  ActOnFp360DocumentParams,
  ActOnFp360DocumentResponse,
  CompleteFp360DocumentUploadParams,
  CompleteFp360DocumentUploadResponse,
  CreateFp360DocumentBody,
  CreateFp360DocumentDossierBody,
  CreateFp360DocumentDossierResponse,
  CreateFp360DocumentResponse,
  GenerateFp360DocumentFromTemplateBody,
  GenerateFp360DocumentFromTemplateParams,
  GenerateFp360DocumentFromTemplateResponse,
  GetFp360DocumentsOverviewQueryParams,
  GetFp360DocumentsOverviewResponse,
  RequestFp360DocumentUploadUrlBody,
  RequestFp360DocumentUploadUrlParams,
  RequestFp360DocumentUploadUrlResponse,
  UpdateFp360DocumentBody,
  UpdateFp360DocumentParams,
  UpdateFp360DocumentResponse,
} from "@workspace/api-zod";
import {
  db,
  fpDocumentDossiers,
  fpDocumentEvents,
  fpDocuments,
  fpDocumentVersions,
  fpOrganizations,
} from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { createStoredZip } from "../lib/zipArchive";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth);
router.use(requireSimulationWriteAccess);

const SIMULATED_DATE = "2027-09-15";
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_DOSSIER_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_DOSSIER_PACKAGE_VERSIONS = 300;
const objectStorageService = new ObjectStorageService();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class DocumentsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof DocumentsError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 document operation failed");
      next(error);
    });
  };
}

function isReviewer(actor: AuthContext): boolean {
  return actor.role === "teacher" || actor.role === "administrator";
}

async function resolveOrganization(actor: AuthContext, organizationId: string): Promise<boolean> {
  if (actor.organizationId && actor.organizationId !== organizationId) return false;
  if (!actor.organizationId && !isReviewer(actor)) return false;
  const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return Boolean(organization);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function validScenarioDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && value >= "2027-01-01"
    && value <= "2028-12-31";
}

function normalizeTags(tags: string[]): string {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].join(",");
}

function cleanFilename(value: string): string {
  const basename = value.split(/[\\/]/).pop() ?? "";
  return basename
    .replace(/[^\p{L}\p{N}._ ()-]/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function safeArchiveSegment(value: string): string {
  return value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "documento";
}

function safeArchiveFilename(value: string): string {
  return cleanFilename(value)
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^\.+/g, "")
    .slice(0, 120) || "archivo";
}

const allowedExtensions: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "text/csv": [".csv"],
};

const templates = [
  { key: "purchase-request", name: "Solicitud de compra", documentType: "purchase_request", description: "Ficha didáctica para justificar una necesidad de compra.", educationalOnly: true },
  { key: "supplier-quote", name: "Comparativa de ofertas", documentType: "quote", description: "Plantilla educativa para comparar tres ofertas simuladas.", educationalOnly: true },
  { key: "commercial-letter", name: "Carta comercial", documentType: "other", description: "Comunicación comercial de ejemplo, sin envío real.", educationalOnly: true },
  { key: "accounting-note", name: "Nota contable", documentType: "accounting", description: "Documento de apoyo didáctico, no constituye un asiento.", educationalOnly: true },
  { key: "employment-form", name: "Formulario laboral didáctico", documentType: "employment_form", description: "Modelo formativo; no equivale a un formulario oficial presentado.", educationalOnly: true },
] as const;

function documentResponse(row: typeof fpDocuments.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    dossierId: row.dossierId,
    reference: row.documentRef,
    documentType: row.documentType,
    title: row.title,
    description: row.description,
    department: row.department,
    period: row.period,
    documentDate: row.documentDate,
    status: row.status,
    visibility: row.visibility,
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
    originApp: row.originApp,
    originId: row.originId,
    rectifiesDocumentId: row.rectifiesDocumentId,
    tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
    versionNumber: row.versionNumber,
    isSynthetic: row.isSynthetic,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

function versionResponse(row: typeof fpDocumentVersions.$inferSelect) {
  return {
    id: row.id,
    documentId: row.documentId,
    versionNumber: row.versionNumber,
    status: row.status,
    originalName: row.originalName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    checksumSha256: row.checksumSha256,
    description: row.description,
    sourceVersionId: row.sourceVersionId,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdAt: iso(row.createdAt)!,
  };
}

function eventResponse(row: typeof fpDocumentEvents.$inferSelect) {
  return {
    id: row.id,
    dossierId: row.dossierId,
    documentId: row.documentId,
    versionId: row.versionId,
    eventType: row.eventType,
    details: row.details,
    actorUserId: row.actorUserId,
    actorName: row.actorName,
    simulatedDate: row.simulatedDate,
    createdAt: iso(row.createdAt)!,
  };
}

function dossierResponse(row: typeof fpDocumentDossiers.$inferSelect, dossierDocuments: Array<typeof fpDocuments.$inferSelect>) {
  const requiredTypes: Array<[string, number]> = row.dossierType === "purchase"
    ? [["purchase_request", 1], ["quote", 3], ["purchase_order", 1], ["delivery_note", 1], ["invoice", 1], ["payment", 1]]
    : [];
  const requiredCount = requiredTypes.reduce((total, [, count]) => total + count, 0);
  const completeCount = requiredTypes.reduce((total, [type, count]) => (
    total + Math.min(count, dossierDocuments.filter((document) => document.documentType === type).length)
  ), 0);
  return {
    id: row.id,
    organizationId: row.organizationId,
    reference: row.dossierRef,
    title: row.title,
    dossierType: row.dossierType,
    department: row.department,
    period: row.period,
    status: row.status,
    retentionRule: row.retentionRule,
    documentCount: dossierDocuments.length,
    requiredCount,
    progressPercent: requiredCount ? Math.round((completeCount / requiredCount) * 100) : (dossierDocuments.length ? 100 : 0),
    createdByUserId: row.createdByUserId,
    createdByName: row.createdByName,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

async function logEvent(
  tx: Transaction,
  actor: AuthContext,
  data: {
    organizationId: string;
    dossierId?: string | null;
    documentId?: string | null;
    versionId?: string | null;
    eventType: string;
    details: string;
    operationId?: string;
    requestFingerprint?: string;
  },
) {
  const operationId = data.operationId ?? randomUUID();
  const eventFingerprint = data.requestFingerprint ?? fingerprint({
    organizationId: data.organizationId,
    dossierId: data.dossierId ?? null,
    documentId: data.documentId ?? null,
    versionId: data.versionId ?? null,
    eventType: data.eventType,
    details: data.details,
    actorUserId: actor.userId,
  });
  const [existing] = await tx.select().from(fpDocumentEvents).where(and(
    eq(fpDocumentEvents.tenantId, actor.tenantId),
    eq(fpDocumentEvents.operationId, operationId),
  )).limit(1);
  if (existing) {
    if (existing.requestFingerprint !== eventFingerprint) throw new DocumentsError(409, "El identificador de operación ya se usó para otro cambio.");
    return existing;
  }
  const [event] = await tx.insert(fpDocumentEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId: data.organizationId,
    dossierId: data.dossierId ?? null,
    documentId: data.documentId ?? null,
    versionId: data.versionId ?? null,
    eventType: data.eventType,
    details: data.details,
    actorUserId: actor.userId,
    actorName: actor.displayName,
    simulatedDate: SIMULATED_DATE,
    operationId,
    requestFingerprint: eventFingerprint,
  }).returning();
  return event;
}

async function findDocument(actor: AuthContext, documentId: string) {
  const [document] = await db.select().from(fpDocuments).where(and(
    eq(fpDocuments.id, documentId),
    eq(fpDocuments.tenantId, actor.tenantId),
  )).limit(1);
  if (!document || !await resolveOrganization(actor, document.organizationId)) throw new DocumentsError(404, "Documento no encontrado en esta empresa.");
  if (document.visibility === "restricted" && document.ownerUserId !== actor.userId && !isReviewer(actor)) {
    throw new DocumentsError(404, "Documento no encontrado en esta empresa.");
  }
  return document;
}

function assertCanEdit(actor: AuthContext, document: typeof fpDocuments.$inferSelect) {
  if (document.ownerUserId !== actor.userId && !isReviewer(actor)) throw new DocumentsError(403, "Solo la persona propietaria o una persona revisora puede editar este documento.");
  if (!["draft", "observed", "rejected"].includes(document.status)) {
    throw new DocumentsError(409, "No se puede modificar una versión confirmada. Crea un nuevo registro de rectificación.");
  }
}

router.get("/redfp360/documents/overview", route(async (req, res) => {
  const query = GetFp360DocumentsOverviewQueryParams.safeParse(req.query);
  if (!query.success) throw new DocumentsError(400, "Selecciona una empresa válida.");
  const actor = req.auth!;
  if (!await resolveOrganization(actor, query.data.organizationId)) throw new DocumentsError(403, "No tienes acceso a esta empresa.");
  const [dossierRows, documentRows] = await Promise.all([
    db.select().from(fpDocumentDossiers).where(and(
      eq(fpDocumentDossiers.tenantId, actor.tenantId),
      eq(fpDocumentDossiers.organizationId, query.data.organizationId),
    )).orderBy(desc(fpDocumentDossiers.updatedAt)),
    db.select().from(fpDocuments).where(and(
      eq(fpDocuments.tenantId, actor.tenantId),
      eq(fpDocuments.organizationId, query.data.organizationId),
      query.data.search ? ilike(fpDocuments.title, `%${query.data.search}%`) : undefined,
    )).orderBy(desc(fpDocuments.updatedAt)).limit(500),
  ]);
  const visibleDocuments = documentRows.filter((document) => (
    document.visibility === "organization" || document.ownerUserId === actor.userId || isReviewer(actor)
  ));
  if (query.data.documentId && !visibleDocuments.some((document) => document.id === query.data.documentId)) {
    throw new DocumentsError(404, "Documento no encontrado en esta empresa.");
  }
  const visibleDocumentIds = query.data.documentId
    ? [query.data.documentId]
    : visibleDocuments.map((document) => document.id);
  const [versionRows, eventRows] = await Promise.all([
    visibleDocumentIds.length
      ? db.select().from(fpDocumentVersions).where(and(
        eq(fpDocumentVersions.tenantId, actor.tenantId),
        inArray(fpDocumentVersions.documentId, visibleDocumentIds),
      )).orderBy(desc(fpDocumentVersions.versionNumber)).limit(1000)
      : Promise.resolve([] as Array<typeof fpDocumentVersions.$inferSelect>),
    visibleDocumentIds.length || dossierRows.length
      ? db.select().from(fpDocumentEvents).where(and(
        eq(fpDocumentEvents.tenantId, actor.tenantId),
        eq(fpDocumentEvents.organizationId, query.data.organizationId),
        or(
          visibleDocumentIds.length ? inArray(fpDocumentEvents.documentId, visibleDocumentIds) : undefined,
          dossierRows.length ? inArray(fpDocumentEvents.dossierId, dossierRows.map((row) => row.id)) : undefined,
        ),
      )).orderBy(desc(fpDocumentEvents.createdAt)).limit(150)
      : Promise.resolve([] as Array<typeof fpDocumentEvents.$inferSelect>),
  ]);
  const docsByDossier = new Map<string, Array<typeof fpDocuments.$inferSelect>>();
  for (const document of visibleDocuments) {
    const items = docsByDossier.get(document.dossierId) ?? [];
    items.push(document);
    docsByDossier.set(document.dossierId, items);
  }
  const pendingUploads = versionRows.filter((version) => version.status === "pending_upload").length;
  const classifiedCount = visibleDocuments.filter((document) => (
    document.documentType && document.dossierId && document.department && document.period && document.tags
  )).length;
  res.json(GetFp360DocumentsOverviewResponse.parse({
    organizationId: query.data.organizationId,
    metrics: {
      activeDocuments: visibleDocuments.filter((document) => !["voided"].includes(document.status)).length,
      openDossiers: dossierRows.filter((dossier) => dossier.status === "open").length,
      pendingApprovals: visibleDocuments.filter((document) => document.status === "pending_review").length + pendingUploads,
      classificationPercent: visibleDocuments.length ? Math.round((classifiedCount / visibleDocuments.length) * 100) : 0,
    },
    dossiers: dossierRows.map((dossier) => dossierResponse(dossier, docsByDossier.get(dossier.id) ?? [])),
    documents: visibleDocuments.map(documentResponse),
    versions: versionRows.map(versionResponse),
    events: eventRows.map(eventResponse),
    templates: [...templates],
  }));
}));

router.post("/redfp360/documents/dossiers", route(async (req, res) => {
  const body = CreateFp360DocumentDossierBody.safeParse(req.body);
  if (!body.success) throw new DocumentsError(400, "Revisa los campos del expediente.");
  const actor = req.auth!;
  if (!await resolveOrganization(actor, body.data.organizationId)) throw new DocumentsError(403, "No tienes acceso a esta empresa.");
  const requestFingerprint = fingerprint(body.data);
  const dossier = await db.transaction(async (tx) => {
    const [prior] = await tx.select().from(fpDocumentDossiers).where(and(
      eq(fpDocumentDossiers.tenantId, actor.tenantId),
      eq(fpDocumentDossiers.operationId, body.data.operationId),
    )).limit(1);
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) throw new DocumentsError(409, "El identificador de operación ya se usó.");
      return prior;
    }
    const id = randomUUID();
    const [created] = await tx.insert(fpDocumentDossiers).values({
      id,
      tenantId: actor.tenantId,
      organizationId: body.data.organizationId,
      dossierRef: `EXP-2027-${id.slice(0, 8).toUpperCase()}`,
      title: body.data.title.trim(),
      dossierType: body.data.dossierType,
      department: body.data.department.trim(),
      period: body.data.period,
      status: "open",
      retentionRule: "educational",
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      operationId: body.data.operationId,
      requestFingerprint,
    }).returning();
    await logEvent(tx, actor, {
      organizationId: created.organizationId,
      dossierId: created.id,
      eventType: "dossier_created",
      details: `Se creó el expediente ${created.dossierRef}.`,
    });
    return created;
  });
  res.status(201).json(CreateFp360DocumentDossierResponse.parse(dossierResponse(dossier, [])));
}));

router.post("/redfp360/documents", route(async (req, res) => {
  const body = CreateFp360DocumentBody.safeParse(req.body);
  if (!body.success) throw new DocumentsError(400, "Revisa los metadatos del documento.");
  const actor = req.auth!;
  if (!await resolveOrganization(actor, body.data.organizationId)) throw new DocumentsError(403, "No tienes acceso a esta empresa.");
  if (!validScenarioDate(body.data.documentDate)) throw new DocumentsError(400, "La fecha debe estar dentro del calendario didáctico 2027–2028.");
  const requestFingerprint = fingerprint(body.data);
  const document = await db.transaction(async (tx) => {
    const [prior] = await tx.select().from(fpDocuments).where(and(
      eq(fpDocuments.tenantId, actor.tenantId),
      eq(fpDocuments.operationId, body.data.operationId),
    )).limit(1);
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) throw new DocumentsError(409, "El identificador de operación ya se usó.");
      return prior;
    }
    const [dossier] = await tx.select().from(fpDocumentDossiers).where(and(
      eq(fpDocumentDossiers.id, body.data.dossierId),
      eq(fpDocumentDossiers.tenantId, actor.tenantId),
      eq(fpDocumentDossiers.organizationId, body.data.organizationId),
      eq(fpDocumentDossiers.status, "open"),
    )).for("update").limit(1);
    if (!dossier) throw new DocumentsError(404, "Abre o selecciona un expediente de esta empresa.");
    if (body.data.rectifiesDocumentId) {
      const [original] = await tx.select({ id: fpDocuments.id }).from(fpDocuments).where(and(
        eq(fpDocuments.id, body.data.rectifiesDocumentId),
        eq(fpDocuments.tenantId, actor.tenantId),
        eq(fpDocuments.organizationId, body.data.organizationId),
      )).limit(1);
      if (!original) throw new DocumentsError(404, "No se encontró el documento que se va a rectificar.");
    }
    const id = randomUUID();
    const [created] = await tx.insert(fpDocuments).values({
      id,
      tenantId: actor.tenantId,
      organizationId: body.data.organizationId,
      dossierId: dossier.id,
      documentRef: `DOC-2027-${id.slice(0, 8).toUpperCase()}`,
      documentType: body.data.documentType,
      title: body.data.title.trim(),
      description: (body.data.description ?? "").trim(),
      department: body.data.department.trim(),
      period: body.data.period,
      documentDate: body.data.documentDate,
      status: "draft",
      visibility: body.data.visibility,
      ownerUserId: actor.userId,
      ownerName: actor.displayName,
      originApp: body.data.originApp,
      originId: body.data.originId?.trim() || null,
      rectifiesDocumentId: body.data.rectifiesDocumentId ?? null,
      tags: normalizeTags(body.data.tags),
      versionNumber: 0,
      isSynthetic: true,
      operationId: body.data.operationId,
      requestFingerprint,
    }).returning();
    await tx.update(fpDocumentDossiers).set({ updatedAt: new Date() }).where(eq(fpDocumentDossiers.id, dossier.id));
    await logEvent(tx, actor, {
      organizationId: created.organizationId,
      dossierId: created.dossierId,
      documentId: created.id,
      eventType: "document_created",
      details: `Se creó el borrador ${created.documentRef}.`,
    });
    return created;
  });
  res.status(201).json(CreateFp360DocumentResponse.parse(documentResponse(document)));
}));

router.patch("/redfp360/documents/:documentId", route(async (req, res) => {
  const params = UpdateFp360DocumentParams.safeParse(req.params);
  const body = UpdateFp360DocumentBody.safeParse(req.body);
  if (!params.success || !body.success) throw new DocumentsError(400, "Revisa los metadatos del documento.");
  const actor = req.auth!;
  const document = await findDocument(actor, params.data.documentId);
  assertCanEdit(actor, document);
  if (!["draft", "observed", "rejected"].includes(document.status)) {
    throw new DocumentsError(409, "Solo se pueden editar metadatos mientras el documento sea editable.");
  }
  if (!validScenarioDate(body.data.documentDate)) throw new DocumentsError(400, "La fecha debe estar dentro del calendario didáctico 2027–2028.");
  const updated = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(fpDocuments).where(and(
      eq(fpDocuments.id, document.id),
      eq(fpDocuments.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!locked) throw new DocumentsError(404, "Documento no encontrado.");
    assertCanEdit(actor, locked);
    if (!["draft", "observed", "rejected"].includes(locked.status)) {
      throw new DocumentsError(409, "Solo se pueden editar metadatos mientras el documento sea editable.");
    }
    const operationFingerprint = fingerprint(body.data);
    const [priorEvent] = await tx.select().from(fpDocumentEvents).where(and(
      eq(fpDocumentEvents.tenantId, actor.tenantId),
      eq(fpDocumentEvents.operationId, body.data.operationId),
    )).limit(1);
    if (priorEvent) {
      if (priorEvent.documentId !== locked.id || priorEvent.requestFingerprint !== operationFingerprint) {
        throw new DocumentsError(409, "El identificador de operación ya se usó para otro cambio.");
      }
      return locked;
    }
    const [row] = await tx.update(fpDocuments).set({
      title: body.data.title.trim(),
      description: (body.data.description ?? "").trim(),
      department: body.data.department.trim(),
      period: body.data.period,
      documentDate: body.data.documentDate,
      visibility: body.data.visibility,
      tags: normalizeTags(body.data.tags),
      updatedAt: new Date(),
    }).where(and(
      eq(fpDocuments.id, locked.id),
      eq(fpDocuments.tenantId, actor.tenantId),
    )).returning();
    await logEvent(tx, actor, {
      organizationId: row.organizationId,
      dossierId: row.dossierId,
      documentId: row.id,
      eventType: "metadata_updated",
      details: "Se actualizaron los metadatos del borrador.",
      operationId: body.data.operationId,
      requestFingerprint: operationFingerprint,
    });
    return row;
  });
  res.json(UpdateFp360DocumentResponse.parse(documentResponse(updated)));
}));

router.post("/redfp360/documents/templates/:templateKey/generate", route(async (req, res) => {
  const params = GenerateFp360DocumentFromTemplateParams.safeParse(req.params);
  const body = GenerateFp360DocumentFromTemplateBody.safeParse(req.body);
  if (!params.success || !body.success) throw new DocumentsError(400, "Revisa la plantilla y los campos del documento.");
  const template = templates.find((item) => item.key === params.data.templateKey);
  if (!template) throw new DocumentsError(404, "Plantilla educativa no encontrada.");
  const actor = req.auth!;
  if (!await resolveOrganization(actor, body.data.organizationId)) throw new DocumentsError(403, "No tienes acceso a esta empresa.");
  if (!validScenarioDate(body.data.documentDate)) throw new DocumentsError(400, "La fecha debe estar dentro del calendario didáctico 2027–2028.");
  const dossier = await db.select().from(fpDocumentDossiers).where(and(
    eq(fpDocumentDossiers.id, body.data.dossierId),
    eq(fpDocumentDossiers.tenantId, actor.tenantId),
    eq(fpDocumentDossiers.organizationId, body.data.organizationId),
    eq(fpDocumentDossiers.status, "open"),
  )).limit(1);
  if (!dossier[0]) throw new DocumentsError(404, "Abre o selecciona un expediente de esta empresa.");
  const id = randomUUID();
  const lines = [
    "RED FP360 — SIMULACIÓN EDUCATIVA",
    "DOCUMENTO SINTÉTICO — SIN VALIDEZ LEGAL NI PRESENTACIÓN EXTERNA",
    `Plantilla: ${template.name}`,
    `Referencia: DOC-2027-${id.slice(0, 8).toUpperCase()}`,
    `Fecha simulada: ${body.data.documentDate}`,
    `Periodo: ${body.data.period}`,
    `Departamento: ${body.data.department}`,
    `Expediente: ${dossier[0].dossierRef} · ${dossier[0].title}`,
    "",
    ...Object.entries(body.data.fields).map(([key, value]) => `${key}: ${value}`),
    "",
    "Este material es exclusivamente didáctico. No sustituye formularios, documentos ni trámites oficiales.",
  ];
  const contentText = lines.join("\n");
  const versionId = randomUUID();
  const requestFingerprint = fingerprint(body.data);
  const document = await db.transaction(async (tx) => {
    const [prior] = await tx.select().from(fpDocuments).where(and(
      eq(fpDocuments.tenantId, actor.tenantId),
      eq(fpDocuments.operationId, body.data.operationId),
    )).limit(1);
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) throw new DocumentsError(409, "El identificador de operación ya se usó.");
      return prior;
    }
    const [created] = await tx.insert(fpDocuments).values({
      id,
      tenantId: actor.tenantId,
      organizationId: body.data.organizationId,
      dossierId: body.data.dossierId,
      documentRef: `DOC-2027-${id.slice(0, 8).toUpperCase()}`,
      documentType: template.documentType,
      title: body.data.title.trim(),
      description: `Generado desde la plantilla didáctica: ${template.name}.`,
      department: body.data.department.trim(),
      period: body.data.period,
      documentDate: body.data.documentDate,
      status: "draft",
      visibility: "organization",
      ownerUserId: actor.userId,
      ownerName: actor.displayName,
      originApp: "education",
      originId: template.key,
      tags: "sintético,educativo",
      versionNumber: 1,
      isSynthetic: true,
      operationId: body.data.operationId,
      requestFingerprint,
    }).returning();
    await tx.insert(fpDocumentVersions).values({
      id: versionId,
      tenantId: actor.tenantId,
      organizationId: created.organizationId,
      documentId: created.id,
      versionNumber: 1,
      status: "uploaded",
      objectPath: null,
      originalName: `${template.key}-${id.slice(0, 8)}.txt`,
      contentType: "text/plain",
      sizeBytes: Buffer.byteLength(contentText, "utf8"),
      checksumSha256: createHash("sha256").update(contentText).digest("hex"),
      contentText,
      description: `Documento educativo generado desde ${template.name}.`,
      sourceVersionId: null,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      operationId: randomUUID(),
    });
    await tx.update(fpDocumentDossiers).set({ updatedAt: new Date() }).where(eq(fpDocumentDossiers.id, body.data.dossierId));
    await logEvent(tx, actor, {
      organizationId: created.organizationId,
      dossierId: created.dossierId,
      documentId: created.id,
      versionId,
      eventType: "template_generated",
      details: `Se generó una copia educativa desde «${template.name}».`,
    });
    return created;
  });
  res.status(201).json(GenerateFp360DocumentFromTemplateResponse.parse(documentResponse(document)));
}));

router.post("/redfp360/documents/:documentId/versions/upload-url", route(async (req, res) => {
  const params = RequestFp360DocumentUploadUrlParams.safeParse(req.params);
  const body = RequestFp360DocumentUploadUrlBody.safeParse(req.body);
  if (!params.success || !body.success) throw new DocumentsError(400, "Revisa el archivo y sus datos.");
  const actor = req.auth!;
  const document = await findDocument(actor, params.data.documentId);
  assertCanEdit(actor, document);
  if (!["draft", "observed", "rejected"].includes(document.status)) {
    throw new DocumentsError(409, "Solo se pueden cargar versiones en un documento editable.");
  }
  const [existingVersion] = await db.select({ id: fpDocumentVersions.id }).from(fpDocumentVersions).where(and(
    eq(fpDocumentVersions.tenantId, actor.tenantId),
    eq(fpDocumentVersions.operationId, body.data.operationId),
  )).limit(1);
  if (existingVersion) throw new DocumentsError(409, "Ese identificador ya inició una carga. Comprueba o abandona la versión pendiente.");
  if (body.data.size > MAX_DOCUMENT_BYTES) throw new DocumentsError(400, "El archivo no puede superar los 10 MB.");
  const originalName = cleanFilename(body.data.name);
  if (!originalName) throw new DocumentsError(400, "El nombre del archivo no es válido.");
  const extension = `.${originalName.split(".").pop()?.toLowerCase() ?? ""}`;
  if (!allowedExtensions[body.data.contentType]?.includes(extension)) {
    throw new DocumentsError(400, "El tipo de archivo y la extensión no coinciden. No se permiten archivos ejecutables.");
  }
  const pending = await db.select({ id: fpDocumentVersions.id }).from(fpDocumentVersions).where(and(
    eq(fpDocumentVersions.tenantId, actor.tenantId),
    eq(fpDocumentVersions.documentId, document.id),
    eq(fpDocumentVersions.status, "pending_upload"),
  )).limit(1);
  if (pending.length) throw new DocumentsError(409, "Hay una carga incompleta. Reinténtala o abandónala antes de crear otra versión.");
  const uploadURL = await objectStorageService.getObjectEntityUploadURL();
  const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
  if (!/^\/objects\/uploads\/[a-f0-9-]{36}$/i.test(objectPath)) throw new Error("Object storage returned an unexpected private object path.");
  const requestFingerprint = fingerprint({ ...body.data, documentId: document.id });
  const version = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(fpDocuments).where(and(
      eq(fpDocuments.id, document.id),
      eq(fpDocuments.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!locked) throw new DocumentsError(404, "Documento no encontrado.");
    assertCanEdit(actor, locked);
    if (!["draft", "observed", "rejected"].includes(locked.status)) {
      throw new DocumentsError(409, "Solo se pueden cargar versiones en un documento editable.");
    }
    const [pendingVersion] = await tx.select({ id: fpDocumentVersions.id }).from(fpDocumentVersions).where(and(
      eq(fpDocumentVersions.tenantId, actor.tenantId),
      eq(fpDocumentVersions.documentId, locked.id),
      eq(fpDocumentVersions.status, "pending_upload"),
    )).limit(1);
    if (pendingVersion) throw new DocumentsError(409, "Hay otra carga incompleta. Reinténtala o abandónala antes de crear una nueva versión.");
    const [latest] = await tx.select({ versionNumber: fpDocumentVersions.versionNumber }).from(fpDocumentVersions).where(and(
      eq(fpDocumentVersions.tenantId, actor.tenantId),
      eq(fpDocumentVersions.documentId, document.id),
    )).orderBy(desc(fpDocumentVersions.versionNumber)).limit(1);
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const [created] = await tx.insert(fpDocumentVersions).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId: document.organizationId,
      documentId: document.id,
      versionNumber,
      status: "pending_upload",
      objectPath,
      originalName,
      contentType: body.data.contentType,
      sizeBytes: body.data.size,
      checksumSha256: null,
      contentText: null,
      description: (body.data.description ?? "").trim(),
      sourceVersionId: null,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      operationId: body.data.operationId,
    }).returning();
    await logEvent(tx, actor, {
      organizationId: document.organizationId,
      dossierId: document.dossierId,
      documentId: document.id,
      versionId: created.id,
      eventType: "version_upload_started",
      details: `Se inició la carga de la versión ${versionNumber} (${originalName}).`,
    });
    return created;
  });
  res.status(201).json(RequestFp360DocumentUploadUrlResponse.parse({
    versionId: version.id,
    versionNumber: version.versionNumber,
    uploadURL,
  }));
}));

router.post("/redfp360/documents/:documentId/versions/:versionId/complete", route(async (req, res) => {
  const params = CompleteFp360DocumentUploadParams.safeParse(req.params);
  if (!params.success) throw new DocumentsError(400, "Versión documental no válida.");
  const actor = req.auth!;
  const document = await findDocument(actor, params.data.documentId);
  const [version] = await db.select().from(fpDocumentVersions).where(and(
    eq(fpDocumentVersions.id, params.data.versionId),
    eq(fpDocumentVersions.documentId, document.id),
    eq(fpDocumentVersions.tenantId, actor.tenantId),
  )).limit(1);
  if (!version) throw new DocumentsError(404, "No se encontró la versión.");
  if (version.status === "uploaded") {
    res.json(CompleteFp360DocumentUploadResponse.parse(versionResponse(version)));
    return;
  }
  assertCanEdit(actor, document);
  if (!["draft", "observed", "rejected"].includes(document.status)) {
    throw new DocumentsError(409, "No se puede completar una carga cuando el documento ya está en revisión o cerrado.");
  }
  if (version.status !== "pending_upload" || !version.objectPath) throw new DocumentsError(409, "Esta carga ya no está pendiente.");
  let file;
  let metadata: Record<string, unknown>;
  let fileBytes: Buffer;
  try {
    file = await objectStorageService.getObjectEntityFile(version.objectPath);
    const [objectMetadata] = await file.getMetadata();
    metadata = objectMetadata as Record<string, unknown>;
    const [downloaded] = await file.download();
    fileBytes = downloaded;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) throw new DocumentsError(404, "No se encontró el archivo cargado. Puedes abandonar esta versión y volver a intentarlo.");
    throw error;
  }
  const actualSize = Number(metadata.size);
  const actualContentType = String(metadata.contentType ?? "");
  if (!Number.isSafeInteger(actualSize) || actualSize !== version.sizeBytes || actualSize > MAX_DOCUMENT_BYTES ||
    actualContentType !== version.contentType || fileBytes.byteLength !== version.sizeBytes) {
    try {
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      req.log.error({ err: error, versionId: version.id }, "Could not remove an invalid document upload");
    }
    await db.update(fpDocumentVersions).set({ status: "abandoned" }).where(and(
      eq(fpDocumentVersions.id, version.id),
      eq(fpDocumentVersions.tenantId, actor.tenantId),
    ));
    throw new DocumentsError(400, "El archivo cargado no coincide con el tipo o tamaño declarado.");
  }
  const checksumSha256 = createHash("sha256").update(fileBytes).digest("hex");
  const completed = await db.transaction(async (tx) => {
    const [lockedDocument] = await tx.select().from(fpDocuments).where(and(
      eq(fpDocuments.id, document.id),
      eq(fpDocuments.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!lockedDocument) throw new DocumentsError(404, "Documento no encontrado.");
    if (!["draft", "observed", "rejected"].includes(lockedDocument.status)) {
      throw new DocumentsError(409, "No se puede completar una carga cuando el documento ya está en revisión o cerrado.");
    }
    const [updated] = await tx.update(fpDocumentVersions).set({
      status: "uploaded",
      checksumSha256,
    }).where(and(
      eq(fpDocumentVersions.id, version.id),
      eq(fpDocumentVersions.tenantId, actor.tenantId),
      eq(fpDocumentVersions.status, "pending_upload"),
    )).returning();
    if (!updated) {
      const [current] = await tx.select().from(fpDocumentVersions).where(eq(fpDocumentVersions.id, version.id)).limit(1);
      if (current?.status === "uploaded") return current;
      throw new DocumentsError(409, "La versión cambió mientras se verificaba.");
    }
    await tx.update(fpDocuments).set({
      versionNumber: version.versionNumber,
      updatedAt: new Date(),
    }).where(and(eq(fpDocuments.id, document.id), eq(fpDocuments.tenantId, actor.tenantId)));
    await logEvent(tx, actor, {
      organizationId: document.organizationId,
      dossierId: document.dossierId,
      documentId: document.id,
      versionId: version.id,
      eventType: "version_uploaded",
      details: `Se verificó la versión ${version.versionNumber}; SHA-256 ${checksumSha256}.`,
    });
    return updated;
  });
  res.json(CompleteFp360DocumentUploadResponse.parse(versionResponse(completed)));
}));

router.delete("/redfp360/documents/:documentId/versions/:versionId", route(async (req, res) => {
  const params = AbandonFp360DocumentUploadParams.safeParse(req.params);
  if (!params.success) throw new DocumentsError(400, "Versión documental no válida.");
  const actor = req.auth!;
  const document = await findDocument(actor, params.data.documentId);
  assertCanEdit(actor, document);
  const [version] = await db.select().from(fpDocumentVersions).where(and(
    eq(fpDocumentVersions.id, params.data.versionId),
    eq(fpDocumentVersions.documentId, document.id),
    eq(fpDocumentVersions.tenantId, actor.tenantId),
  )).limit(1);
  if (!version) throw new DocumentsError(404, "No se encontró la versión.");
  if (version.status !== "pending_upload") throw new DocumentsError(409, "Solo se pueden abandonar cargas incompletas; el historial aprobado se conserva.");
  if (version.objectPath) {
    try {
      const file = await objectStorageService.getObjectEntityFile(version.objectPath);
      await file.delete({ ignoreNotFound: true });
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }
  }
  await db.transaction(async (tx) => {
    await tx.update(fpDocumentVersions).set({ status: "abandoned" }).where(and(
      eq(fpDocumentVersions.id, version.id),
      eq(fpDocumentVersions.tenantId, actor.tenantId),
    ));
    await logEvent(tx, actor, {
      organizationId: document.organizationId,
      dossierId: document.dossierId,
      documentId: document.id,
      versionId: version.id,
      eventType: "version_upload_abandoned",
      details: `Se abandonó la carga incompleta de la versión ${version.versionNumber}.`,
    });
  });
  res.json(AbandonFp360DocumentUploadResponse.parse({ deleted: true }));
}));

router.get("/redfp360/documents/:documentId/versions/:versionId/download", route(async (req, res) => {
  const params = AbandonFp360DocumentUploadParams.safeParse(req.params);
  if (!params.success) throw new DocumentsError(400, "Versión documental no válida.");
  const actor = req.auth!;
  const document = await findDocument(actor, params.data.documentId);
  const [version] = await db.select().from(fpDocumentVersions).where(and(
    eq(fpDocumentVersions.id, params.data.versionId),
    eq(fpDocumentVersions.documentId, document.id),
    eq(fpDocumentVersions.tenantId, actor.tenantId),
    eq(fpDocumentVersions.status, "uploaded"),
  )).limit(1);
  if (!version) throw new DocumentsError(404, "Versión disponible no encontrada.");
  await db.transaction((tx) => logEvent(tx, actor, {
    organizationId: document.organizationId,
    dossierId: document.dossierId,
    documentId: document.id,
    versionId: version.id,
    eventType: "version_downloaded",
    details: `Se descargó la versión ${version.versionNumber}.`,
  }).then(() => undefined));
  const filename = cleanFilename(version.originalName ?? `${document.documentRef}-v${version.versionNumber}.txt`).replace(/"/g, "");
  if (version.contentText !== null) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(version.contentText);
    return;
  }
  if (!version.objectPath) throw new DocumentsError(404, "Archivo no disponible.");
  let file;
  try {
    file = await objectStorageService.getObjectEntityFile(version.objectPath);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) throw new DocumentsError(404, "No se encontró el archivo almacenado.");
    throw error;
  }
  const [downloadURL] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 5 * 60 * 1000,
    responseDisposition: "attachment",
    responseType: "application/octet-stream",
  });
  res.setHeader("Cache-Control", "no-store");
  res.redirect(302, downloadURL);
}));

router.post("/redfp360/documents/:documentId/access-log", route(async (req, res) => {
  const params = ActOnFp360DocumentParams.safeParse(req.params);
  if (!params.success) throw new DocumentsError(400, "Documento no válido.");
  const actor = req.auth!;
  const document = await findDocument(actor, params.data.documentId);
  await db.transaction((tx) => logEvent(tx, actor, {
    organizationId: document.organizationId,
    dossierId: document.dossierId,
    documentId: document.id,
    eventType: "document_accessed",
    details: `Se abrió la ficha ${document.documentRef}.`,
  }).then(() => undefined));
  res.status(201).json({ recorded: true });
}));

router.post("/redfp360/documents/:documentId/actions", route(async (req, res) => {
  const params = ActOnFp360DocumentParams.safeParse(req.params);
  const body = ActOnFp360DocumentBody.safeParse(req.body);
  if (!params.success || !body.success) throw new DocumentsError(400, "Revisa la acción solicitada.");
  const actor = req.auth!;
  const document = await findDocument(actor, params.data.documentId);
  if (body.data.action === "return" || body.data.action === "reject" || body.data.action === "void") {
    if (!body.data.description?.trim()) throw new DocumentsError(400, "Explica el motivo de la devolución, el rechazo o la anulación.");
  }
  const reviewerAction = ["approve", "return", "reject"].includes(body.data.action);
  if (reviewerAction && !isReviewer(actor)) throw new DocumentsError(403, "Esta actuación requiere revisión docente o administrativa.");
  if (!reviewerAction) assertCanEdit(actor, document);
  const updated = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(fpDocuments).where(and(
      eq(fpDocuments.id, document.id),
      eq(fpDocuments.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!locked) throw new DocumentsError(404, "Documento no encontrado.");
    const operationFingerprint = fingerprint(body.data);
    const [priorEvent] = await tx.select().from(fpDocumentEvents).where(and(
      eq(fpDocumentEvents.tenantId, actor.tenantId),
      eq(fpDocumentEvents.operationId, body.data.operationId),
    )).limit(1);
    if (priorEvent) {
      if (priorEvent.documentId !== locked.id || priorEvent.requestFingerprint !== operationFingerprint) {
        throw new DocumentsError(409, "El identificador de operación ya se usó para otro cambio.");
      }
      const [current] = await tx.select().from(fpDocuments).where(eq(fpDocuments.id, locked.id)).limit(1);
      return current;
    }
    let nextStatus = locked.status;
    let eventType = "";
    let details = body.data.description?.trim() ?? "";
    if (body.data.action === "submit") {
      const [verifiedVersion] = await tx.select({ id: fpDocumentVersions.id }).from(fpDocumentVersions).where(and(
        eq(fpDocumentVersions.tenantId, actor.tenantId),
        eq(fpDocumentVersions.documentId, locked.id),
        eq(fpDocumentVersions.status, "uploaded"),
      )).limit(1);
      const [pendingVersion] = await tx.select({ id: fpDocumentVersions.id }).from(fpDocumentVersions).where(and(
        eq(fpDocumentVersions.tenantId, actor.tenantId),
        eq(fpDocumentVersions.documentId, locked.id),
        eq(fpDocumentVersions.status, "pending_upload"),
      )).limit(1);
      if (!["draft", "observed", "rejected"].includes(locked.status) || !verifiedVersion || pendingVersion) {
        throw new DocumentsError(409, "Completa o abandona las cargas pendientes y verifica una versión antes de enviar el documento a revisión.");
      }
      nextStatus = "pending_review";
      eventType = "document_submitted";
      details = "Documento enviado a revisión.";
    } else if (body.data.action === "approve") {
      if (!isReviewer(actor)) throw new DocumentsError(403, "La validación requiere revisión docente o administrativa.");
      if (locked.status !== "pending_review") throw new DocumentsError(409, "Solo se pueden validar documentos pendientes de revisión.");
      nextStatus = "validated";
      eventType = "document_approved_simulated";
      details = details || "Validación simulada; no es firma electrónica.";
    } else if (body.data.action === "return") {
      if (!isReviewer(actor)) throw new DocumentsError(403, "La devolución requiere revisión docente o administrativa.");
      if (locked.status !== "pending_review") throw new DocumentsError(409, "Solo se pueden devolver documentos pendientes de revisión.");
      nextStatus = "observed";
      eventType = "document_returned";
    } else if (body.data.action === "reject") {
      if (!isReviewer(actor)) throw new DocumentsError(403, "El rechazo requiere revisión docente o administrativa.");
      if (locked.status !== "pending_review") throw new DocumentsError(409, "Solo se pueden rechazar documentos pendientes de revisión.");
      nextStatus = "rejected";
      eventType = "document_rejected";
    } else if (body.data.action === "confirm") {
      if (locked.status !== "validated") throw new DocumentsError(409, "Solo se pueden confirmar documentos validados.");
      nextStatus = "confirmed";
      eventType = "document_confirmed_simulated";
      details = details || "Confirmación simulada; no tiene validez legal.";
    } else if (body.data.action === "execute") {
      if (locked.status !== "confirmed") throw new DocumentsError(409, "Solo se pueden marcar como ejecutados los documentos confirmados.");
      nextStatus = "executed";
      eventType = "document_executed";
    } else if (body.data.action === "finalize") {
      if (!["confirmed", "executed"].includes(locked.status)) throw new DocumentsError(409, "Confirma el documento antes de archivarlo como finalizado.");
      nextStatus = "finalized";
      eventType = "document_finalized";
    } else if (body.data.action === "void") {
      if (["finalized", "voided"].includes(locked.status)) throw new DocumentsError(409, "El documento finalizado no se borra; crea una rectificación vinculada.");
      nextStatus = "voided";
      eventType = "document_voided";
    } else if (body.data.action === "restore") {
      assertCanEdit(actor, locked);
      if (!["draft", "observed", "rejected"].includes(locked.status)) {
        throw new DocumentsError(409, "Solo se pueden restaurar versiones en un documento editable.");
      }
      if (!body.data.sourceVersionId) throw new DocumentsError(400, "Selecciona la versión que quieres recuperar.");
      const [source] = await tx.select().from(fpDocumentVersions).where(and(
        eq(fpDocumentVersions.id, body.data.sourceVersionId),
        eq(fpDocumentVersions.documentId, locked.id),
        eq(fpDocumentVersions.tenantId, actor.tenantId),
        eq(fpDocumentVersions.status, "uploaded"),
      )).limit(1);
      if (!source) throw new DocumentsError(404, "No se encontró una versión anterior disponible.");
      const [latest] = await tx.select({ versionNumber: fpDocumentVersions.versionNumber }).from(fpDocumentVersions).where(and(
        eq(fpDocumentVersions.tenantId, actor.tenantId),
        eq(fpDocumentVersions.documentId, locked.id),
      )).orderBy(desc(fpDocumentVersions.versionNumber)).limit(1);
      const restoredVersionNumber = (latest?.versionNumber ?? 0) + 1;
      const restoredVersionId = randomUUID();
      await tx.insert(fpDocumentVersions).values({
        id: restoredVersionId,
        tenantId: actor.tenantId,
        organizationId: locked.organizationId,
        documentId: locked.id,
        versionNumber: restoredVersionNumber,
        status: "uploaded",
        objectPath: source.objectPath,
        originalName: source.originalName,
        contentType: source.contentType,
        sizeBytes: source.sizeBytes,
        checksumSha256: source.checksumSha256,
        contentText: source.contentText,
        description: `Copia de restauración de la versión ${source.versionNumber}.`,
        sourceVersionId: source.id,
        createdByUserId: actor.userId,
        createdByName: actor.displayName,
        operationId: `${body.data.operationId}:version`,
      });
      nextStatus = locked.status;
      eventType = "version_restored";
      details = `Se creó la versión ${restoredVersionNumber} como copia de la versión ${source.versionNumber}.`;
      await tx.update(fpDocuments).set({ versionNumber: restoredVersionNumber, updatedAt: new Date() }).where(eq(fpDocuments.id, locked.id));
      await logEvent(tx, actor, {
        organizationId: locked.organizationId,
        dossierId: locked.dossierId,
        documentId: locked.id,
        versionId: restoredVersionId,
        eventType,
        details,
        operationId: body.data.operationId,
        requestFingerprint: operationFingerprint,
      });
      const [current] = await tx.select().from(fpDocuments).where(eq(fpDocuments.id, locked.id)).limit(1);
      return current;
    } else {
      throw new DocumentsError(400, "Acción documental no reconocida.");
    }
    const [row] = await tx.update(fpDocuments).set({ status: nextStatus, updatedAt: new Date() }).where(and(
      eq(fpDocuments.id, locked.id),
      eq(fpDocuments.tenantId, actor.tenantId),
    )).returning();
    await logEvent(tx, actor, {
      organizationId: row.organizationId,
      dossierId: row.dossierId,
      documentId: row.id,
      eventType,
      details,
      operationId: body.data.operationId,
      requestFingerprint: operationFingerprint,
    });
    return row;
  });
  res.json(ActOnFp360DocumentResponse.parse(documentResponse(updated)));
}));

router.post("/redfp360/documents/dossiers/:dossierId/actions", route(async (req, res) => {
  const params = ActOnFp360DocumentDossierParams.safeParse(req.params);
  const body = ActOnFp360DocumentDossierBody.safeParse(req.body);
  if (!params.success || !body.success) throw new DocumentsError(400, "Revisa la acción del expediente.");
  const actor = req.auth!;
  const [dossier] = await db.select().from(fpDocumentDossiers).where(and(
    eq(fpDocumentDossiers.id, params.data.dossierId),
    eq(fpDocumentDossiers.tenantId, actor.tenantId),
  )).limit(1);
  if (!dossier || !await resolveOrganization(actor, dossier.organizationId)) throw new DocumentsError(404, "Expediente no encontrado en esta empresa.");
  if (!isReviewer(actor)) throw new DocumentsError(403, "El archivo definitivo del expediente requiere revisión docente o administrativa.");
  const updated = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(fpDocumentDossiers).where(and(
      eq(fpDocumentDossiers.id, dossier.id),
      eq(fpDocumentDossiers.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!locked) throw new DocumentsError(404, "Expediente no encontrado.");
    const operationFingerprint = fingerprint(body.data);
    const [priorEvent] = await tx.select().from(fpDocumentEvents).where(and(
      eq(fpDocumentEvents.tenantId, actor.tenantId),
      eq(fpDocumentEvents.operationId, body.data.operationId),
    )).limit(1);
    if (priorEvent) {
      if (priorEvent.dossierId !== locked.id || priorEvent.requestFingerprint !== operationFingerprint) {
        throw new DocumentsError(409, "El identificador de operación ya se usó para otro cambio.");
      }
      return locked;
    }
    if (body.data.action === "archive") {
      if (locked.status !== "open") throw new DocumentsError(409, "El expediente ya está archivado.");
      const docs = await tx.select().from(fpDocuments).where(and(
        eq(fpDocuments.tenantId, actor.tenantId),
        eq(fpDocuments.dossierId, locked.id),
      ));
      if (!docs.length || docs.some((document) => !["finalized", "rejected", "voided"].includes(document.status))) {
        throw new DocumentsError(409, "Finaliza o resuelve todos los documentos antes de archivar el expediente.");
      }
      const [row] = await tx.update(fpDocumentDossiers).set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() }).where(eq(fpDocumentDossiers.id, locked.id)).returning();
      await logEvent(tx, actor, {
        organizationId: locked.organizationId,
        dossierId: locked.id,
        eventType: "dossier_archived",
        details: `Se archivó el expediente ${locked.dossierRef}.`,
        operationId: body.data.operationId,
        requestFingerprint: operationFingerprint,
      });
      return row;
    }
    if (locked.status !== "archived") throw new DocumentsError(409, "Solo se pueden reabrir expedientes archivados.");
    const [row] = await tx.update(fpDocumentDossiers).set({ status: "open", archivedAt: null, updatedAt: new Date() }).where(eq(fpDocumentDossiers.id, locked.id)).returning();
    await logEvent(tx, actor, {
      organizationId: locked.organizationId,
      dossierId: locked.id,
      eventType: "dossier_reopened",
      details: `Se reabrió el expediente ${locked.dossierRef}.`,
      operationId: body.data.operationId,
      requestFingerprint: operationFingerprint,
    });
    return row;
  });
  const docs = await db.select().from(fpDocuments).where(and(
    eq(fpDocuments.tenantId, actor.tenantId),
    eq(fpDocuments.dossierId, updated.id),
  ));
  res.json(ActOnFp360DocumentDossierResponse.parse(dossierResponse(updated, docs)));
}));

router.get("/redfp360/documents/dossiers/:dossierId/package", route(async (req, res) => {
  const dossierId = typeof req.params.dossierId === "string" ? req.params.dossierId : "";
  if (!dossierId) throw new DocumentsError(400, "Expediente no válido.");
  const actor = req.auth!;
  const [dossier] = await db.select().from(fpDocumentDossiers).where(and(
    eq(fpDocumentDossiers.id, dossierId),
    eq(fpDocumentDossiers.tenantId, actor.tenantId),
  )).limit(1);
  if (!dossier || !await resolveOrganization(actor, dossier.organizationId)) {
    throw new DocumentsError(404, "Expediente no encontrado en esta empresa.");
  }
  if (!isReviewer(actor)) throw new DocumentsError(403, "La exportación completa del expediente requiere revisión docente o administrativa.");

  const documents = await db.select().from(fpDocuments).where(and(
    eq(fpDocuments.tenantId, actor.tenantId),
    eq(fpDocuments.dossierId, dossier.id),
  ));
  if (!documents.length) throw new DocumentsError(409, "Añade documentos al expediente antes de generar el paquete.");
  const documentIds = documents.map((document) => document.id);
  const versions = await db.select().from(fpDocumentVersions).where(and(
    eq(fpDocumentVersions.tenantId, actor.tenantId),
    inArray(fpDocumentVersions.documentId, documentIds),
    eq(fpDocumentVersions.status, "uploaded"),
  )).orderBy(desc(fpDocumentVersions.createdAt)).limit(MAX_DOSSIER_PACKAGE_VERSIONS + 1);
  if (versions.length > MAX_DOSSIER_PACKAGE_VERSIONS) {
    throw new DocumentsError(413, "El expediente contiene demasiadas versiones para un único paquete.");
  }
  const sourceBytes = versions.reduce((total, version) => total + version.sizeBytes, 0);
  if (sourceBytes > MAX_DOSSIER_PACKAGE_BYTES) {
    throw new DocumentsError(413, "El paquete supera el límite de 50 MB. Genera paquetes por expedientes más pequeños.");
  }

  const documentById = new Map(documents.map((document) => [document.id, document]));
  const archivePaths = new Map<string, string>();
  const entries: Array<{ name: string; data: Buffer }> = [];
  for (const version of versions) {
    const document = documentById.get(version.documentId);
    if (!document) continue;
    let content: Buffer;
    if (version.contentText !== null) {
      content = Buffer.from(version.contentText, "utf8");
    } else if (version.objectPath) {
      try {
        const file = await objectStorageService.getObjectEntityFile(version.objectPath);
        const [downloaded] = await file.download();
        content = downloaded;
      } catch (error) {
        if (error instanceof ObjectNotFoundError) {
          throw new DocumentsError(409, `No se encuentra el archivo de la versión ${version.versionNumber} de ${document.documentRef}.`);
        }
        throw error;
      }
    } else {
      throw new DocumentsError(409, `La versión ${version.versionNumber} de ${document.documentRef} no tiene un archivo disponible.`);
    }
    if (content.byteLength !== version.sizeBytes ||
      (version.checksumSha256 && createHash("sha256").update(content).digest("hex") !== version.checksumSha256)) {
      throw new DocumentsError(409, `El archivo de la versión ${version.versionNumber} de ${document.documentRef} no supera la verificación de integridad.`);
    }

    const directory = `${safeArchiveSegment(document.documentRef)}-${document.id.slice(0, 8)}`;
    const archivePath = `${directory}/v${version.versionNumber}-${safeArchiveFilename(version.originalName ?? "documento.txt")}`;
    archivePaths.set(version.id, archivePath);
    entries.push({ name: archivePath, data: content });
  }

  const manifest = {
    packageType: "RED FP360 · paquete documental educativo",
    educational: true,
    disclaimer: "Material sintético para formación. No tiene validez legal ni constituye una firma electrónica.",
    generatedAt: new Date().toISOString(),
    dossier: {
      reference: dossier.dossierRef,
      title: dossier.title,
      type: dossier.dossierType,
      department: dossier.department,
      period: dossier.period,
      status: dossier.status,
    },
    documents: documents.map((document) => ({
      reference: document.documentRef,
      title: document.title,
      type: document.documentType,
      description: document.description,
      department: document.department,
      period: document.period,
      documentDate: document.documentDate,
      status: document.status,
      visibility: document.visibility,
      tags: document.tags,
      synthetic: document.isSynthetic,
      versions: versions.filter((version) => version.documentId === document.id).map((version) => ({
        versionNumber: version.versionNumber,
        originalName: version.originalName,
        contentType: version.contentType,
        sizeBytes: version.sizeBytes,
        checksumSha256: version.checksumSha256,
        sourceVersionId: version.sourceVersionId,
        archivePath: archivePaths.get(version.id) ?? null,
        createdAt: version.createdAt,
        createdByName: version.createdByName,
      })),
    })),
  };
  entries.unshift({ name: "MANIFEST.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });
  entries.push({
    name: "LEEME.txt",
    data: Buffer.from("RED FP360 — paquete documental educativo\n\nLos documentos y aprobaciones de este paquete son simulaciones de formación. No los presentes como documentación oficial ni como firma electrónica.\n", "utf8"),
  });
  const archive = createStoredZip(entries);
  if (archive.byteLength > MAX_DOSSIER_PACKAGE_BYTES) {
    throw new DocumentsError(413, "El paquete supera el límite de 50 MB.");
  }
  await db.transaction((tx) => logEvent(tx, actor, {
    organizationId: dossier.organizationId,
    dossierId: dossier.id,
    eventType: "dossier_package_downloaded",
    details: `Se generó el paquete documental ${dossier.dossierRef} (${versions.length} versiones).`,
  }).then(() => undefined));

  const filename = `${safeArchiveSegment(dossier.dossierRef)}-documentacion.zip`;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(archive.byteLength));
  res.send(archive);
}));

export default router;

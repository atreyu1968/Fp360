import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import * as api from "@workspace/api-zod";
import {
  db,
  fpAuthUsers,
  fpDocuments,
  fpPortfolioCriteria,
  fpPortfolioEntries,
  fpPortfolioEntryCriteria,
  fpPortfolioReviews,
  fpPortfolioRevisions,
  fpSimulationCampaigns,
  fpSimulationEvents,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: Router = Router();
const contactPattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?34[\s.-]?)?[6789]\d{8}\b)/i;

class PortfolioError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

function fail(status: number, message: string): never {
  throw new PortfolioError(status, message);
}

function isEducator(role: AuthContext["role"]): boolean {
  return role === "teacher" || role === "administrator";
}

function rejectContactDetails(...values: Array<string | null | undefined>): void {
  if (values.some((value) => value && contactPattern.test(value))) {
    fail(400, "No incluyas correos ni teléfonos reales en el portafolio simulado.");
  }
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

async function findCampaign(actor: AuthContext, campaignId: string) {
  const [campaign] = await db.select().from(fpSimulationCampaigns).where(and(
    eq(fpSimulationCampaigns.id, campaignId),
    eq(fpSimulationCampaigns.tenantId, actor.tenantId),
  )).limit(1);
  if (!campaign) fail(404, "No se encontró la campaña.");
  if (actor.role !== "administrator" && (!actor.organizationId || !campaign.participantOrganizationIds.includes(actor.organizationId))) {
    fail(403, "No tienes acceso a esta campaña.");
  }
  return campaign;
}

function canManageCampaign(actor: AuthContext, campaign: typeof fpSimulationCampaigns.$inferSelect): boolean {
  return actor.role === "administrator" || (
    actor.role === "teacher" && actor.organizationId === campaign.ownerOrganizationId
  );
}

function canReviewEntry(actor: AuthContext, entry: typeof fpPortfolioEntries.$inferSelect): boolean {
  if (actor.role === "administrator") return true;
  return actor.role === "teacher" && Boolean(actor.organizationId && actor.organizationId === entry.organizationId);
}

async function checkCriterionIds(actor: AuthContext, campaignId: string, criterionIds: string[]) {
  const uniqueIds = [...new Set(criterionIds)];
  if (uniqueIds.length !== criterionIds.length || uniqueIds.length === 0) {
    fail(400, "Asocia al menos un criterio y evita repetirlo.");
  }
  const rows = await db.select({ id: fpPortfolioCriteria.id }).from(fpPortfolioCriteria).where(and(
    eq(fpPortfolioCriteria.tenantId, actor.tenantId),
    eq(fpPortfolioCriteria.campaignId, campaignId),
    inArray(fpPortfolioCriteria.id, uniqueIds),
  ));
  if (rows.length !== uniqueIds.length) fail(400, "Uno o más criterios no pertenecen a esta campaña.");
  return uniqueIds;
}

async function readOverview(actor: AuthContext, requestedCampaignId?: string) {
  if (!["student", "team_manager", "teacher", "administrator"].includes(actor.role)) {
    fail(403, "Este perfil no tiene acceso a portafolios de aprendizaje.");
  }

  const campaignRows = await db.select().from(fpSimulationCampaigns).where(eq(fpSimulationCampaigns.tenantId, actor.tenantId))
    .orderBy(asc(fpSimulationCampaigns.startDate));
  let campaigns = campaignRows.filter((campaign) =>
    actor.role === "administrator" ||
    Boolean(actor.organizationId && campaign.participantOrganizationIds.includes(actor.organizationId))
  );
  if (requestedCampaignId) {
    campaigns = campaigns.filter((campaign) => campaign.id === requestedCampaignId);
    if (!campaigns.length) fail(404, "No se encontró la campaña en tu ámbito.");
  }
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const canReview = actor.role === "administrator" || (actor.role === "teacher" && Boolean(actor.organizationId));
  const canManageCriteria = actor.role === "administrator" || (
    actor.role === "teacher" &&
    campaigns.some((campaign) => campaign.ownerOrganizationId === actor.organizationId && campaign.status !== "closed")
  );
  if (!campaignIds.length) {
    return api.GetPortfolioOverviewResponse.parse({
      entries: [], activities: [], criteria: [],
      canReview, canManageCriteria,
    });
  }

  const [criterionRows, eventRows, entryRows] = await Promise.all([
    db.select().from(fpPortfolioCriteria).where(and(
      eq(fpPortfolioCriteria.tenantId, actor.tenantId),
      inArray(fpPortfolioCriteria.campaignId, campaignIds),
    )).orderBy(asc(fpPortfolioCriteria.title)),
    db.select().from(fpSimulationEvents).where(and(
      eq(fpSimulationEvents.tenantId, actor.tenantId),
      inArray(fpSimulationEvents.campaignId, campaignIds),
      eq(fpSimulationEvents.status, "completed"),
    )).orderBy(asc(fpSimulationEvents.simulatedDate)),
    db.select().from(fpPortfolioEntries).where(and(
      eq(fpPortfolioEntries.tenantId, actor.tenantId),
      inArray(fpPortfolioEntries.campaignId, campaignIds),
      ...(actor.role === "student" ? [eq(fpPortfolioEntries.studentUserId, actor.userId)] : []),
      ...(actor.role !== "administrator" && actor.organizationId ? [eq(fpPortfolioEntries.organizationId, actor.organizationId)] : []),
      ...(actor.role !== "administrator" && !actor.organizationId ? [eq(fpPortfolioEntries.id, "__no_access__")] : []),
    )).orderBy(asc(fpPortfolioEntries.updatedAt)),
  ]);

  const eventIds = [...new Set([
    ...eventRows.map((event) => event.id),
    ...entryRows.map((entry) => entry.eventId),
  ])];
  const documentIds = [...new Set(eventRows.flatMap((event) => event.evidenceDocumentId ? [event.evidenceDocumentId] : []))];
  const [events, entryCriteriaRows, validDocuments] = await Promise.all([
    eventIds.length ? db.select().from(fpSimulationEvents).where(and(
      eq(fpSimulationEvents.tenantId, actor.tenantId),
      inArray(fpSimulationEvents.id, eventIds),
    )) : [],
    entryRows.length ? db.select().from(fpPortfolioEntryCriteria).where(and(
      eq(fpPortfolioEntryCriteria.tenantId, actor.tenantId),
      inArray(fpPortfolioEntryCriteria.entryId, entryRows.map((entry) => entry.id)),
    )) : [],
    documentIds.length ? db.select({
      id: fpDocuments.id,
      tenantId: fpDocuments.tenantId,
      organizationId: fpDocuments.organizationId,
      reference: fpDocuments.documentRef,
    }).from(fpDocuments).where(and(
      eq(fpDocuments.tenantId, actor.tenantId),
      eq(fpDocuments.isSynthetic, true),
      eq(fpDocuments.status, "confirmed"),
      eq(fpDocuments.visibility, "organization"),
      isNull(fpDocuments.archivedAt),
      inArray(fpDocuments.id, documentIds),
    )) : [],
  ]);
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const criteriaById = new Map(criterionRows.map((criterion) => [criterion.id, criterion]));
  const documentsById = new Map(validDocuments.map((document) => [document.id, document]));
  const userIds = [...new Set(entryRows.flatMap((entry) => [
    entry.studentUserId,
    ...(entry.reviewedByUserId ? [entry.reviewedByUserId] : []),
  ]))];
  const participantIds = [...new Set(entryRows.map((entry) => entry.studentUserId))].sort();
  const participantLabels = new Map(participantIds.map((id, index) => [
    id,
    `Participante ${String(index + 1).padStart(2, "0")}`,
  ]));
  const users = userIds.length ? await db.select({
    id: fpAuthUsers.id,
    displayName: fpAuthUsers.displayName,
  }).from(fpAuthUsers).where(inArray(fpAuthUsers.id, userIds)) : [];
  const userById = new Map(users.map((user) => [user.id, user.displayName]));
  const criteriaByEntry = new Map<string, Array<typeof criterionRows[number]>>();
  for (const link of entryCriteriaRows) {
    const criterion = criteriaById.get(link.criterionId);
    if (!criterion) continue;
    const items = criteriaByEntry.get(link.entryId) ?? [];
    items.push(criterion);
    criteriaByEntry.set(link.entryId, items);
  }

  const entries = entryRows.flatMap((entry) => {
    const event = eventById.get(entry.eventId);
    const campaign = campaignById.get(entry.campaignId);
    if (!event || !campaign || !event.evidenceDocumentId) return [];
    const privateDetails = actor.role === "administrator" || actor.role === "teacher" || entry.studentUserId === actor.userId;
    const document = documentsById.get(event.evidenceDocumentId);
    return [api.CreatePortfolioEntryResponse.parse({
      id: entry.id,
      campaignId: entry.campaignId,
      campaignTitle: campaign.title,
      organizationId: entry.organizationId,
      eventId: event.id,
      activityTitle: event.title,
      eventType: event.eventType,
      simulatedDate: event.simulatedDate,
      evidenceDocumentId: event.evidenceDocumentId,
      evidenceDocumentReference: document?.organizationId === entry.organizationId ? document.reference : null,
      studentUserId: entry.studentUserId,
      studentName: actor.role === "team_manager"
        ? participantLabels.get(entry.studentUserId) ?? "Participante"
        : userById.get(entry.studentUserId) ?? "Estudiante",
      canViewPrivateDetails: privateDetails,
      status: entry.status,
      reflection: privateDetails ? entry.reflection : "",
      contribution: entry.contribution,
      selfAssessment: privateDetails ? entry.selfAssessment : "",
      version: entry.version,
      criteria: (criteriaByEntry.get(entry.id) ?? []).map((criterion) => api.CreatePortfolioCriterionResponse.parse({
        id: criterion.id,
        campaignId: criterion.campaignId,
        code: criterion.code,
        title: criterion.title,
        description: criterion.description,
        isRequired: criterion.isRequired,
        createdAt: criterion.createdAt.toISOString(),
      })),
      submittedAt: iso(entry.submittedAt),
      reviewedAt: iso(entry.reviewedAt),
      reviewerName: privateDetails && entry.reviewedByUserId ? userById.get(entry.reviewedByUserId) ?? null : null,
      feedback: privateDetails ? entry.feedback : "",
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    })];
  });

  const existingEventIds = new Set(entryRows.map((entry) => entry.eventId));
  const activities = eventRows.flatMap((event) => {
    const campaign = campaignById.get(event.campaignId);
    if (!campaign || !["active", "paused"].includes(campaign.status) || !event.evidenceDocumentId) return [];
    if (actor.role === "student" && (event.completedByUserId !== actor.userId || event.organizationId !== actor.organizationId)) return [];
    if (actor.role === "team_manager" && event.organizationId !== actor.organizationId) return [];
    if (actor.role === "teacher" && event.organizationId !== actor.organizationId) return [];
    if (existingEventIds.has(event.id)) return [];
    const document = documentsById.get(event.evidenceDocumentId);
    if (!document || document.organizationId !== event.organizationId) return [];
    return [{
      eventId: event.id,
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      organizationId: event.organizationId,
      title: event.title,
      eventType: event.eventType,
      simulatedDate: event.simulatedDate,
      evidenceDocumentId: event.evidenceDocumentId,
      evidenceDocumentReference: document.reference,
      completedAt: iso(event.completedAt),
    }];
  });

  return api.GetPortfolioOverviewResponse.parse({
    entries,
    activities,
    criteria: criterionRows.map((criterion) => api.CreatePortfolioCriterionResponse.parse({
      id: criterion.id,
      campaignId: criterion.campaignId,
      code: criterion.code,
      title: criterion.title,
      description: criterion.description,
      isRequired: criterion.isRequired,
      createdAt: criterion.createdAt.toISOString(),
    })),
    canReview,
    canManageCriteria,
  });
}

async function readEntryForActor(id: string, actor: AuthContext) {
  const overview = await readOverview(actor);
  const entry = overview.entries.find((candidate) => candidate.id === id);
  if (!entry) fail(404, "No se encontró la evidencia en tu ámbito.");
  return entry;
}

router.use("/redfp360/portfolio", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/portfolio/overview", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.GetPortfolioOverviewQueryParams.safeParse(req.query);
  if (!parsed.success) fail(400, "El filtro de campaña no es válido.");
  res.json(await readOverview(actor, parsed.data.campaignId));
}));

router.post("/redfp360/portfolio/criteria", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.CreatePortfolioCriterionBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa el criterio de aprendizaje.");
  const campaign = await findCampaign(actor, parsed.data.campaignId);
  if (!isEducator(actor.role) || !canManageCampaign(actor, campaign)) {
    fail(403, "Solo el profesorado responsable de la campaña puede configurar criterios.");
  }
  if (campaign.status === "closed") fail(409, "No se pueden añadir criterios a una campaña cerrada.");
  const code = parsed.data.code?.trim() || null;
  const title = parsed.data.title.trim();
  const description = parsed.data.description.trim();
  rejectContactDetails(code, title, description);
  if (code) {
    const [duplicate] = await db.select({ id: fpPortfolioCriteria.id }).from(fpPortfolioCriteria).where(and(
      eq(fpPortfolioCriteria.tenantId, actor.tenantId),
      eq(fpPortfolioCriteria.campaignId, campaign.id),
      eq(fpPortfolioCriteria.code, code),
    )).limit(1);
    if (duplicate) fail(409, "Ese código ya está registrado en la campaña.");
  }
  const [criterion] = await db.insert(fpPortfolioCriteria).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    campaignId: campaign.id,
    code,
    title,
    description,
    isRequired: parsed.data.isRequired,
    createdByUserId: actor.userId,
  }).returning();
  res.status(201).json(api.CreatePortfolioCriterionResponse.parse({
    id: criterion.id,
    campaignId: criterion.campaignId,
    code: criterion.code,
    title: criterion.title,
    description: criterion.description,
    isRequired: criterion.isRequired,
    createdAt: criterion.createdAt.toISOString(),
  }));
}));

router.post("/redfp360/portfolio/entries", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.CreatePortfolioEntryBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Completa la reflexión y la contribución individual.");
  if (actor.role !== "student" || !actor.organizationId) fail(403, "Solo el alumnado puede crear su portafolio individual.");
  rejectContactDetails(parsed.data.reflection, parsed.data.contribution, parsed.data.selfAssessment);

  const createdId = await db.transaction(async (tx) => {
    const [event] = await tx.select().from(fpSimulationEvents).where(and(
      eq(fpSimulationEvents.id, parsed.data.eventId),
      eq(fpSimulationEvents.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!event || event.organizationId !== actor.organizationId) fail(404, "No se encontró la actividad en tu empresa.");
    if (event.status !== "completed" || event.completedByUserId !== actor.userId || !event.evidenceDocumentId) {
      fail(409, "Solo puedes añadir una actividad completada por ti y con evidencia del ERP.");
    }
    const [campaign] = await tx.select().from(fpSimulationCampaigns).where(and(
      eq(fpSimulationCampaigns.id, event.campaignId),
      eq(fpSimulationCampaigns.tenantId, actor.tenantId),
    )).limit(1);
    if (!campaign || !campaign.participantOrganizationIds.includes(actor.organizationId)) fail(403, "La campaña no incluye tu empresa.");
    if (!["active", "paused"].includes(campaign.status)) fail(409, "La campaña debe estar activa o pausada para crear evidencias.");
    const [document] = await tx.select({ id: fpDocuments.id }).from(fpDocuments).where(and(
      eq(fpDocuments.id, event.evidenceDocumentId),
      eq(fpDocuments.tenantId, actor.tenantId),
      eq(fpDocuments.organizationId, actor.organizationId),
      eq(fpDocuments.isSynthetic, true),
      eq(fpDocuments.status, "confirmed"),
      eq(fpDocuments.visibility, "organization"),
      isNull(fpDocuments.archivedAt),
    )).limit(1);
    if (!document) fail(409, "El documento de origen ya no está disponible como evidencia confirmada.");
    const criterionIds = await checkCriterionIds(actor, campaign.id, parsed.data.criterionIds);
    const [existing] = await tx.select().from(fpPortfolioEntries).where(and(
      eq(fpPortfolioEntries.tenantId, actor.tenantId),
      eq(fpPortfolioEntries.eventId, event.id),
      eq(fpPortfolioEntries.studentUserId, actor.userId),
    )).limit(1);
    if (existing) return existing.id;

    const id = randomUUID();
    await tx.insert(fpPortfolioEntries).values({
      id,
      tenantId: actor.tenantId,
      organizationId: actor.organizationId,
      campaignId: campaign.id,
      eventId: event.id,
      studentUserId: actor.userId,
      status: "draft",
      reflection: parsed.data.reflection.trim(),
      contribution: parsed.data.contribution.trim(),
      selfAssessment: parsed.data.selfAssessment.trim(),
      version: 1,
    });
    await tx.insert(fpPortfolioEntryCriteria).values(criterionIds.map((criterionId) => ({
      id: randomUUID(),
      tenantId: actor.tenantId,
      entryId: id,
      criterionId,
    })));
    await tx.insert(fpPortfolioRevisions).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      entryId: id,
      version: 1,
      reflection: parsed.data.reflection.trim(),
      contribution: parsed.data.contribution.trim(),
      selfAssessment: parsed.data.selfAssessment.trim(),
      createdByUserId: actor.userId,
    });
    return id;
  });

  const entry = await readEntryForActor(createdId, actor);
  res.status(201).json(api.CreatePortfolioEntryResponse.parse(entry));
}));

router.put("/redfp360/portfolio/entries/:id", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const params = api.UpdatePortfolioEntryParams.safeParse(req.params);
  const parsed = api.UpdatePortfolioEntryBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Revisa la reflexión y sus criterios.");
  rejectContactDetails(parsed.data.reflection, parsed.data.contribution, parsed.data.selfAssessment);
  const entryId = await db.transaction(async (tx) => {
    const [entry] = await tx.select().from(fpPortfolioEntries).where(and(
      eq(fpPortfolioEntries.id, params.data.id),
      eq(fpPortfolioEntries.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!entry) fail(404, "No se encontró la evidencia.");
    if (actor.role !== "student" || entry.studentUserId !== actor.userId || entry.organizationId !== actor.organizationId) {
      fail(403, "Solo puedes editar tu propia evidencia.");
    }
    if (!["draft", "returned"].includes(entry.status)) fail(409, "Solo se pueden editar borradores o evidencias devueltas.");
    const campaign = await findCampaign(actor, entry.campaignId);
    if (!["active", "paused"].includes(campaign.status)) fail(409, "No se puede editar una campaña cerrada.");
    const criterionIds = await checkCriterionIds(actor, entry.campaignId, parsed.data.criterionIds);
    const version = entry.version + 1;
    await tx.update(fpPortfolioEntries).set({
      status: "draft",
      reflection: parsed.data.reflection.trim(),
      contribution: parsed.data.contribution.trim(),
      selfAssessment: parsed.data.selfAssessment.trim(),
      version,
      submittedAt: null,
      reviewedAt: null,
      reviewedByUserId: null,
      feedback: "",
      updatedAt: new Date(),
    }).where(eq(fpPortfolioEntries.id, entry.id));
    await tx.delete(fpPortfolioEntryCriteria).where(and(
      eq(fpPortfolioEntryCriteria.tenantId, actor.tenantId),
      eq(fpPortfolioEntryCriteria.entryId, entry.id),
    ));
    await tx.insert(fpPortfolioEntryCriteria).values(criterionIds.map((criterionId) => ({
      id: randomUUID(),
      tenantId: actor.tenantId,
      entryId: entry.id,
      criterionId,
    })));
    await tx.insert(fpPortfolioRevisions).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      entryId: entry.id,
      version,
      reflection: parsed.data.reflection.trim(),
      contribution: parsed.data.contribution.trim(),
      selfAssessment: parsed.data.selfAssessment.trim(),
      createdByUserId: actor.userId,
    });
    return entry.id;
  });
  res.json(api.UpdatePortfolioEntryResponse.parse(await readEntryForActor(entryId, actor)));
}));

router.post("/redfp360/portfolio/entries/:id/submit", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const params = api.SubmitPortfolioEntryParams.safeParse(req.params);
  const parsed = api.SubmitPortfolioEntryBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "No se pudo enviar la evidencia.");
  if (contactPattern.test(parsed.data.operationId)) fail(400, "El identificador no puede contener datos de contacto.");
  const [entry] = await db.select().from(fpPortfolioEntries).where(and(
    eq(fpPortfolioEntries.id, params.data.id),
    eq(fpPortfolioEntries.tenantId, actor.tenantId),
  )).limit(1);
  if (!entry) fail(404, "No se encontró la evidencia.");
  if (actor.role !== "student" || entry.studentUserId !== actor.userId || entry.organizationId !== actor.organizationId) {
    fail(403, "Solo puedes enviar tu propia evidencia.");
  }
  if (entry.status === "submitted") {
    res.json(api.SubmitPortfolioEntryResponse.parse(await readEntryForActor(entry.id, actor)));
    return;
  }
  if (entry.status !== "draft" || entry.reflection.trim().length < 20 || entry.contribution.trim().length < 10) {
    fail(409, "Completa la reflexión y la contribución antes de enviar.");
  }
  const [campaign] = await db.select().from(fpSimulationCampaigns).where(and(
    eq(fpSimulationCampaigns.id, entry.campaignId),
    eq(fpSimulationCampaigns.tenantId, actor.tenantId),
  )).limit(1);
  if (!campaign || !["active", "paused"].includes(campaign.status)) fail(409, "La campaña no admite nuevas entregas.");
  await db.update(fpPortfolioEntries).set({
    status: "submitted",
    submittedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(fpPortfolioEntries.id, entry.id),
    eq(fpPortfolioEntries.tenantId, actor.tenantId),
    eq(fpPortfolioEntries.status, "draft"),
  ));
  res.json(api.SubmitPortfolioEntryResponse.parse(await readEntryForActor(entry.id, actor)));
}));

router.post("/redfp360/portfolio/entries/:id/review", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const params = api.ReviewPortfolioEntryParams.safeParse(req.params);
  const parsed = api.ReviewPortfolioEntryBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Indica el resultado y escribe una devolución clara.");
  rejectContactDetails(parsed.data.feedback);
  const [entry] = await db.select().from(fpPortfolioEntries).where(and(
    eq(fpPortfolioEntries.id, params.data.id),
    eq(fpPortfolioEntries.tenantId, actor.tenantId),
  )).limit(1);
  if (!entry) fail(404, "No se encontró la evidencia.");
  if (!canReviewEntry(actor, entry)) fail(403, "Solo el profesorado de su centro o administración puede revisar esta evidencia.");
  const [priorReview] = await db.select({ id: fpPortfolioReviews.id }).from(fpPortfolioReviews).where(and(
    eq(fpPortfolioReviews.tenantId, actor.tenantId),
    eq(fpPortfolioReviews.entryId, entry.id),
    eq(fpPortfolioReviews.version, entry.version),
    eq(fpPortfolioReviews.reviewerUserId, actor.userId),
    eq(fpPortfolioReviews.outcome, parsed.data.outcome),
    eq(fpPortfolioReviews.feedback, parsed.data.feedback.trim()),
  )).limit(1);
  if (entry.status === parsed.data.outcome && entry.reviewedByUserId === actor.userId && priorReview) {
    res.json(api.ReviewPortfolioEntryResponse.parse(await readEntryForActor(entry.id, actor)));
    return;
  }
  if (entry.status !== "submitted") fail(409, "Solo se pueden revisar evidencias enviadas.");

  await db.transaction(async (tx) => {
    await tx.insert(fpPortfolioReviews).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      entryId: entry.id,
      version: entry.version,
      outcome: parsed.data.outcome,
      feedback: parsed.data.feedback.trim(),
      reviewerUserId: actor.userId,
    });
    await tx.update(fpPortfolioEntries).set({
      status: parsed.data.outcome,
      reviewedAt: new Date(),
      reviewedByUserId: actor.userId,
      feedback: parsed.data.feedback.trim(),
      updatedAt: new Date(),
    }).where(and(
      eq(fpPortfolioEntries.id, entry.id),
      eq(fpPortfolioEntries.tenantId, actor.tenantId),
      eq(fpPortfolioEntries.status, "submitted"),
    ));
  });
  res.json(api.ReviewPortfolioEntryResponse.parse(await readEntryForActor(entry.id, actor)));
}));

router.get("/redfp360/portfolio/entries/:id/history", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const params = api.GetPortfolioEntryHistoryParams.safeParse(req.params);
  if (!params.success) fail(400, "El identificador de evidencia no es válido.");
  const [entry] = await db.select().from(fpPortfolioEntries).where(and(
    eq(fpPortfolioEntries.id, params.data.id),
    eq(fpPortfolioEntries.tenantId, actor.tenantId),
  )).limit(1);
  if (!entry) fail(404, "No se encontró la evidencia.");
  const privateHistoryAccess = actor.role === "administrator" ||
    (actor.role === "teacher" && actor.organizationId === entry.organizationId) ||
    (actor.role === "student" && actor.userId === entry.studentUserId);
  if (!privateHistoryAccess) fail(403, "El historial privado solo está disponible para el estudiante y su profesorado.");

  const [revisions, reviews] = await Promise.all([
    db.select().from(fpPortfolioRevisions).where(and(
      eq(fpPortfolioRevisions.tenantId, actor.tenantId),
      eq(fpPortfolioRevisions.entryId, entry.id),
    )).orderBy(asc(fpPortfolioRevisions.version)),
    db.select().from(fpPortfolioReviews).where(and(
      eq(fpPortfolioReviews.tenantId, actor.tenantId),
      eq(fpPortfolioReviews.entryId, entry.id),
    )).orderBy(asc(fpPortfolioReviews.createdAt)),
  ]);
  const userIds = [...new Set([
    ...revisions.map((revision) => revision.createdByUserId),
    ...reviews.map((review) => review.reviewerUserId),
  ])];
  const users = userIds.length ? await db.select({
    id: fpAuthUsers.id,
    displayName: fpAuthUsers.displayName,
  }).from(fpAuthUsers).where(inArray(fpAuthUsers.id, userIds)) : [];
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  res.json(api.GetPortfolioEntryHistoryResponse.parse({
    revisions: revisions.map((revision) => ({
      version: revision.version,
      reflection: revision.reflection,
      contribution: revision.contribution,
      selfAssessment: revision.selfAssessment,
      createdByName: names.get(revision.createdByUserId) ?? "Usuario",
      createdAt: revision.createdAt.toISOString(),
    })),
    reviews: reviews.map((review) => ({
      version: review.version,
      outcome: review.outcome,
      feedback: review.feedback,
      reviewerName: names.get(review.reviewerUserId) ?? "Docente",
      createdAt: review.createdAt.toISOString(),
    })),
  }));
}));

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (error instanceof PortfolioError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
};
router.use(errorHandler);

export default router;

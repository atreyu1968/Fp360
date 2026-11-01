import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import * as api from "@workspace/api-zod";
import {
  db,
  fpAuthUsers,
  fpDocuments,
  fpEvaluationActivityCriteria,
  fpEvaluationAssessments,
  fpEvaluationAudit,
  fpEvaluationCriteria,
  fpEvaluationGroups,
  fpEvaluationRubrics,
  fpPortfolioEntries,
  fpSimulationCampaigns,
  fpSimulationEvents,
  type EvaluationRubricLevelValue,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: Router = Router();
const contactPattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?34[\s.-]?)?[6789]\d{8}\b)/i;

class EvaluationError extends Error {
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
  throw new EvaluationError(status, message);
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function cleanText(value: string, label: string, max: number): string {
  const text = value.trim();
  if (text.length > max || contactPattern.test(text)) fail(400, `${label} contiene datos de contacto o supera el límite permitido.`);
  return text;
}

function isEducator(role: AuthContext["role"]): boolean {
  return role === "teacher" || role === "administrator";
}

function canManageCampaign(actor: AuthContext, campaign: typeof fpSimulationCampaigns.$inferSelect): boolean {
  return actor.role === "administrator" ||
    (actor.role === "teacher" && actor.organizationId === campaign.ownerOrganizationId);
}

function canEvaluateOrganization(actor: AuthContext, organizationId: string): boolean {
  return actor.role === "administrator" ||
    (actor.role === "teacher" && actor.organizationId === organizationId);
}

async function findCampaign(actor: AuthContext, campaignId: string) {
  const [campaign] = await db.select().from(fpSimulationCampaigns).where(and(
    eq(fpSimulationCampaigns.tenantId, actor.tenantId),
    eq(fpSimulationCampaigns.id, campaignId),
  )).limit(1);
  if (!campaign) fail(404, "No se encontró la campaña de evaluación.");
  if (actor.role !== "administrator" &&
      (!actor.organizationId || !campaign.participantOrganizationIds.includes(actor.organizationId))) {
    fail(403, "La campaña está fuera del alcance de tu centro.");
  }
  return campaign;
}

async function ensureGroup(actor: AuthContext, campaignId: string) {
  let [group] = await db.select().from(fpEvaluationGroups).where(and(
    eq(fpEvaluationGroups.tenantId, actor.tenantId),
    eq(fpEvaluationGroups.campaignId, campaignId),
  )).limit(1);
  if (group) return group;
  await db.insert(fpEvaluationGroups).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    campaignId,
    scoreScale: 10,
    status: "draft",
    createdByUserId: actor.userId,
  }).onConflictDoNothing();
  [group] = await db.select().from(fpEvaluationGroups).where(and(
    eq(fpEvaluationGroups.tenantId, actor.tenantId),
    eq(fpEvaluationGroups.campaignId, campaignId),
  )).limit(1);
  if (!group) fail(500, "No se pudo preparar el expediente de evaluación.");
  return group;
}

async function getCurrentCriteria(tenantId: string, campaignId: string) {
  return db.select().from(fpEvaluationCriteria).where(and(
    eq(fpEvaluationCriteria.tenantId, tenantId),
    eq(fpEvaluationCriteria.campaignId, campaignId),
    eq(fpEvaluationCriteria.isCurrent, true),
  )).orderBy(asc(fpEvaluationCriteria.learningOutcomeCode), asc(fpEvaluationCriteria.code));
}

async function ensureOpenGroup(actor: AuthContext, campaignId: string) {
  const group = await ensureGroup(actor, campaignId);
  if (group.status === "closed") fail(409, "El expediente didáctico está cerrado y no admite cambios.");
  return group;
}

async function hasAssessmentInCampaign(tenantId: string, campaignId: string): Promise<boolean> {
  const [assessment] = await db.select({ id: fpEvaluationAssessments.id }).from(fpEvaluationAssessments).where(and(
    eq(fpEvaluationAssessments.tenantId, tenantId),
    eq(fpEvaluationAssessments.campaignId, campaignId),
  )).limit(1);
  return Boolean(assessment);
}

async function requireManager(actor: AuthContext, campaignId: string) {
  const campaign = await findCampaign(actor, campaignId);
  if (!isEducator(actor.role) || !canManageCampaign(actor, campaign)) {
    fail(403, "Solo el profesorado responsable de la campaña puede configurar la evaluación.");
  }
  return campaign;
}

async function addAudit(
  actor: AuthContext,
  campaignId: string,
  entityType: string,
  entityId: string,
  action: string,
  summary: string,
  reason = "",
  organizationId: string | null = actor.organizationId ?? null,
) {
  await db.insert(fpEvaluationAudit).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    campaignId,
    organizationId,
    entityType,
    entityId,
    action,
    summary,
    actorUserId: actor.userId,
    reason,
  });
}

function asGroup(group: typeof fpEvaluationGroups.$inferSelect) {
  return {
    campaignId: group.campaignId,
    scoreScale: group.scoreScale as 10 | 100,
    status: group.status as "draft" | "in_progress" | "closed",
    closedAt: group.closedAt?.toISOString() ?? null,
  };
}

async function readOverview(actor: AuthContext, selectedCampaignId?: string) {
  const tenantCampaigns = await db.select().from(fpSimulationCampaigns).where(
    eq(fpSimulationCampaigns.tenantId, actor.tenantId),
  ).orderBy(asc(fpSimulationCampaigns.title));
  const campaigns = tenantCampaigns.filter((campaign) =>
    (!selectedCampaignId || campaign.id === selectedCampaignId) &&
    (actor.role === "administrator" ||
      Boolean(actor.organizationId && campaign.participantOrganizationIds.includes(actor.organizationId))),
  );
  const campaignIds = campaigns.map((campaign) => campaign.id);
  if (!campaignIds.length) {
    return api.GetEvaluationOverviewResponse.parse({
      campaigns: [],
      groups: [],
      criteria: [],
      rubrics: [],
      activities: [],
      entries: [],
      audit: [],
      capabilities: { canConfigure: false, canEvaluate: false, canViewAudit: false, canClose: false },
    });
  }

  const [groupRows, criteriaRows, rubricRows, eventRows] = await Promise.all([
    db.select().from(fpEvaluationGroups).where(and(
      eq(fpEvaluationGroups.tenantId, actor.tenantId),
      inArray(fpEvaluationGroups.campaignId, campaignIds),
    )),
    db.select().from(fpEvaluationCriteria).where(and(
      eq(fpEvaluationCriteria.tenantId, actor.tenantId),
      inArray(fpEvaluationCriteria.campaignId, campaignIds),
    )).orderBy(asc(fpEvaluationCriteria.learningOutcomeCode), asc(fpEvaluationCriteria.code), asc(fpEvaluationCriteria.version)),
    db.select().from(fpEvaluationRubrics).where(and(
      eq(fpEvaluationRubrics.tenantId, actor.tenantId),
      inArray(fpEvaluationRubrics.campaignId, campaignIds),
    )).orderBy(asc(fpEvaluationRubrics.criterionId), desc(fpEvaluationRubrics.version)),
    db.select().from(fpSimulationEvents).where(and(
      eq(fpSimulationEvents.tenantId, actor.tenantId),
      inArray(fpSimulationEvents.campaignId, campaignIds),
    )).orderBy(desc(fpSimulationEvents.completedAt)),
  ]);
  const completedEvents = eventRows.filter((event) => event.status === "completed" && event.completedAt);
  const [assignmentRows, entryRows] = await Promise.all([
    db.select().from(fpEvaluationActivityCriteria).where(and(
      eq(fpEvaluationActivityCriteria.tenantId, actor.tenantId),
      inArray(fpEvaluationActivityCriteria.campaignId, campaignIds),
    )),
    (actor.role === "administrator" || actor.role === "teacher" ||
      actor.role === "student" || actor.role === "team_manager")
      ? db.select().from(fpPortfolioEntries).where(and(
        eq(fpPortfolioEntries.tenantId, actor.tenantId),
        inArray(fpPortfolioEntries.campaignId, campaignIds),
        eq(fpPortfolioEntries.status, "validated"),
        ...(actor.role === "student" ? [eq(fpPortfolioEntries.studentUserId, actor.userId)] : []),
        ...(actor.role !== "administrator" && actor.organizationId
          ? [eq(fpPortfolioEntries.organizationId, actor.organizationId)]
          : []),
        ...(actor.role !== "administrator" && !actor.organizationId
          ? [eq(fpPortfolioEntries.id, "__no_access__")]
          : []),
      ))
      : Promise.resolve([]),
  ]);
  const entryIds = entryRows.map((entry) => entry.id);
  const showAssessments = actor.role === "administrator" || actor.role === "teacher" || actor.role === "student";
  const [assessmentRows, auditRows] = await Promise.all([
    showAssessments && entryIds.length
      ? db.select().from(fpEvaluationAssessments).where(and(
        eq(fpEvaluationAssessments.tenantId, actor.tenantId),
        inArray(fpEvaluationAssessments.portfolioEntryId, entryIds),
        ...(actor.role === "student" ? [eq(fpEvaluationAssessments.studentUserId, actor.userId)] : []),
      )).orderBy(asc(fpEvaluationAssessments.attemptNumber))
      : Promise.resolve([]),
    actor.role === "administrator"
      ? db.select().from(fpEvaluationAudit).where(and(
        eq(fpEvaluationAudit.tenantId, actor.tenantId),
        inArray(fpEvaluationAudit.campaignId, campaignIds),
      )).orderBy(desc(fpEvaluationAudit.createdAt)).limit(300)
      : actor.role === "teacher" && actor.organizationId
        ? db.select().from(fpEvaluationAudit).where(and(
          eq(fpEvaluationAudit.tenantId, actor.tenantId),
          eq(fpEvaluationAudit.organizationId, actor.organizationId),
          inArray(fpEvaluationAudit.campaignId, campaignIds),
        )).orderBy(desc(fpEvaluationAudit.createdAt)).limit(300)
        : Promise.resolve([]),
  ]);
  const participantIds = [...new Set(entryRows.map((entry) => entry.studentUserId))].sort();
  const participantLabels = new Map(participantIds.map((id, index) => [
    id,
    `Participante ${String(index + 1).padStart(2, "0")}`,
  ]));
  const evidenceDocumentIds = completedEvents.flatMap((event) => event.evidenceDocumentId ? [event.evidenceDocumentId] : []);
  const userIds = [...new Set([
    ...entryRows.flatMap((entry) => [entry.studentUserId]),
    ...assessmentRows.map((assessment) => assessment.evaluatedByUserId),
    ...auditRows.map((item) => item.actorUserId),
  ])];
  const [userRows, documentRows] = await Promise.all([
    userIds.length ? db.select().from(fpAuthUsers).where(inArray(fpAuthUsers.id, userIds)) : Promise.resolve([]),
    evidenceDocumentIds.length
      ? db.select().from(fpDocuments).where(and(
        eq(fpDocuments.tenantId, actor.tenantId),
        inArray(fpDocuments.id, evidenceDocumentIds),
      ))
      : Promise.resolve([]),
  ]);
  const userById = new Map(userRows.map((user) => [user.id, user.displayName]));
  const documentById = new Map(documentRows.map((document) => [document.id, document]));
  const eventById = new Map(completedEvents.map((event) => [event.id, event]));
  const currentCriterionIds = new Set(criteriaRows.filter((criterion) => criterion.isCurrent).map((criterion) => criterion.id));
  const assignmentByEvent = new Map<string, string[]>();
  for (const assignment of assignmentRows) {
    if (!currentCriterionIds.has(assignment.criterionId)) continue;
    const existing = assignmentByEvent.get(assignment.eventId) ?? [];
    existing.push(assignment.criterionId);
    assignmentByEvent.set(assignment.eventId, existing);
  }
  const assessmentsByEntry = new Map<string, typeof assessmentRows>();
  for (const assessment of assessmentRows) {
    const existing = assessmentsByEntry.get(assessment.portfolioEntryId) ?? [];
    existing.push(assessment);
    assessmentsByEntry.set(assessment.portfolioEntryId, existing);
  }
  const entries = entryRows.flatMap((entry) => {
    const event = eventById.get(entry.eventId);
    if (!event) return [];
    const document = event.evidenceDocumentId ? documentById.get(event.evidenceDocumentId) : null;
    const alias = participantLabels.get(entry.studentUserId) ?? "Participante";
    return [{
      portfolioEntryId: entry.id,
      campaignId: entry.campaignId,
      eventId: entry.eventId,
      activityTitle: event.title,
      studentUserId: actor.role === "administrator" || actor.role === "teacher" ? alias : actor.role === "student" ? "self" : alias,
      studentName: actor.role === "team_manager"
        ? alias
        : userById.get(entry.studentUserId) ?? "Estudiante",
      evidenceDocumentReference: document?.organizationId === entry.organizationId ? document.documentRef : "",
      entryStatus: entry.status,
      assessments: actor.role === "team_manager"
        ? []
        : (assessmentsByEntry.get(entry.id) ?? []).map((assessment) => ({
          id: assessment.id,
          portfolioEntryId: assessment.portfolioEntryId,
          criterionId: assessment.criterionId,
          criterionTitle: criteriaRows.find((criterion) => criterion.id === assessment.criterionId)?.title ?? "Criterio versionado",
          rubricId: assessment.rubricId,
          rubricVersion: assessment.rubricVersion,
          rubricLevelId: assessment.rubricLevelId,
          rubricLevelLabel: assessment.rubricLevelLabel,
          score: assessment.score,
          scoreScale: assessment.scoreScale as 10 | 100,
          attemptNumber: assessment.attemptNumber,
          status: assessment.status as "achieved" | "recovery_required",
          feedback: assessment.feedback,
          reason: assessment.reason,
          evaluatorName: userById.get(assessment.evaluatedByUserId) ?? "Docente",
          createdAt: assessment.createdAt.toISOString(),
        })),
    }];
  });
  const canConfigure = actor.role === "administrator" ||
    (actor.role === "teacher" && campaigns.some((campaign) => campaign.ownerOrganizationId === actor.organizationId));
  const canEvaluate = actor.role === "administrator" || (actor.role === "teacher" && Boolean(actor.organizationId));
  const canViewAudit = actor.role === "administrator" || (actor.role === "teacher" && Boolean(actor.organizationId));
  const groupsByCampaign = new Map(groupRows.map((group) => [group.campaignId, group]));

  return api.GetEvaluationOverviewResponse.parse({
    campaigns: campaigns.map((campaign) => ({ id: campaign.id, title: campaign.title, status: campaign.status })),
    groups: campaigns.map((campaign) => {
      const group = groupsByCampaign.get(campaign.id);
      return group
        ? asGroup(group)
        : { campaignId: campaign.id, scoreScale: 10, status: "draft", closedAt: null };
    }),
    criteria: criteriaRows.map((criterion) => ({
      id: criterion.id,
      campaignId: criterion.campaignId,
      learningOutcomeCode: criterion.learningOutcomeCode,
      learningOutcomeTitle: criterion.learningOutcomeTitle,
      code: criterion.code,
      title: criterion.title,
      weight: criterion.weight,
      minimumScore: criterion.minimumScore,
      minimumEvidenceCount: criterion.minimumEvidenceCount,
      version: criterion.version,
      isCurrent: criterion.isCurrent,
    })),
    rubrics: rubricRows.map((rubric) => ({
      id: rubric.id,
      campaignId: rubric.campaignId,
      criterionId: rubric.criterionId,
      title: rubric.title,
      version: rubric.version,
      levels: rubric.levels,
      isPublished: rubric.isPublished,
      publishedAt: rubric.publishedAt?.toISOString() ?? null,
    })),
    activities: completedEvents.map((event) => ({
      eventId: event.id,
      campaignId: event.campaignId,
      title: event.title,
      eventType: event.eventType,
      completedAt: event.completedAt?.toISOString() ?? null,
      criterionIds: assignmentByEvent.get(event.id) ?? [],
    })),
    entries,
    audit: auditRows.map((item) => ({
      id: item.id,
      campaignId: item.campaignId,
      entityType: item.entityType,
      entityId: item.entityId,
      action: item.action,
      summary: item.summary,
      actorName: userById.get(item.actorUserId) ?? "Usuario autorizado",
      reason: item.reason,
      createdAt: item.createdAt.toISOString(),
    })),
    capabilities: {
      canConfigure,
      canEvaluate,
      canViewAudit,
      canClose: canConfigure,
    },
  });
}

async function validateWeights(actor: AuthContext, campaignId: string) {
  const campaign = await findCampaign(actor, campaignId);
  if (!isEducator(actor.role)) fail(403, "Solo el equipo docente puede validar la programación.");
  const criteria = await getCurrentCriteria(actor.tenantId, campaign.id);
  const totalWeight = Math.round(criteria.reduce((sum, criterion) => sum + criterion.weight, 0) * 100) / 100;
  return api.ValidateEvaluationWeightsResponse.parse({
    campaignId: campaign.id,
    criterionCount: criteria.length,
    totalWeight,
    valid: criteria.length > 0 && Math.abs(totalWeight - 100) < 0.01,
  });
}

router.use("/redfp360/evaluations", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/evaluations/overview", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.GetEvaluationOverviewQueryParams.safeParse(req.query);
  if (!parsed.success) fail(400, "El filtro de campaña no es válido.");
  res.json(await readOverview(actor, parsed.data.campaignId));
}));

router.post("/redfp360/evaluations/criteria", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.CreateEvaluationCriterionBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los campos del criterio curricular.");
  const campaign = await requireManager(actor, parsed.data.campaignId);
  const group = await ensureOpenGroup(actor, campaign.id);
  if (await hasAssessmentInCampaign(actor.tenantId, campaign.id)) {
    fail(409, "Los criterios quedan fijados cuando comienza la evaluación.");
  }
  const input = parsed.data;
  const learningOutcomeCode = cleanText(input.learningOutcomeCode, "El código del resultado de aprendizaje", 40);
  const learningOutcomeTitle = cleanText(input.learningOutcomeTitle, "El resultado de aprendizaje", 160);
  const code = cleanText(input.code, "El código del criterio", 40);
  const title = cleanText(input.title, "El título del criterio", 160);
  if (input.minimumScore > group.scoreScale) fail(400, "El umbral debe respetar la escala de calificación configurada.");
  const criteria = await getCurrentCriteria(actor.tenantId, campaign.id);
  if (criteria.some((criterion) => criterion.code.toLowerCase() === code.toLowerCase())) {
    fail(409, "Ese código ya está registrado entre los criterios vigentes.");
  }
  if (criteria.reduce((sum, criterion) => sum + criterion.weight, 0) + input.weight > 100.01) {
    fail(400, "La suma de las ponderaciones no puede superar el 100 %.");
  }
  const [criterion] = await db.insert(fpEvaluationCriteria).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    campaignId: campaign.id,
    learningOutcomeCode,
    learningOutcomeTitle,
    code,
    title,
    weight: input.weight,
    minimumScore: input.minimumScore,
    minimumEvidenceCount: input.minimumEvidenceCount,
    createdByUserId: actor.userId,
  }).returning();
  await addAudit(actor, campaign.id, "criterion", criterion.id, "created", `Criterio ${code} creado, versión 1.`);
  res.status(201).json(api.CreateEvaluationCriterionResponse.parse({
    id: criterion.id,
    campaignId: criterion.campaignId,
    learningOutcomeCode: criterion.learningOutcomeCode,
    learningOutcomeTitle: criterion.learningOutcomeTitle,
    code: criterion.code,
    title: criterion.title,
    weight: criterion.weight,
    minimumScore: criterion.minimumScore,
    minimumEvidenceCount: criterion.minimumEvidenceCount,
    version: criterion.version,
    isCurrent: criterion.isCurrent,
  }));
}));

router.put("/redfp360/evaluations/criteria/:id", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.ReviseEvaluationCriterionBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los campos del criterio curricular.");
  const [previous] = await db.select().from(fpEvaluationCriteria).where(and(
    eq(fpEvaluationCriteria.tenantId, actor.tenantId),
    eq(fpEvaluationCriteria.id, routeParam(req.params.id)),
    eq(fpEvaluationCriteria.isCurrent, true),
  )).limit(1);
  if (!previous) fail(404, "No se encontró el criterio vigente.");
  const campaign = await requireManager(actor, previous.campaignId);
  if (parsed.data.campaignId !== campaign.id) fail(400, "No se puede mover un criterio a otra campaña.");
  const group = await ensureOpenGroup(actor, campaign.id);
  if (await hasAssessmentInCampaign(actor.tenantId, campaign.id)) {
    fail(409, "Los criterios quedan fijados cuando comienza la evaluación.");
  }
  if (parsed.data.minimumScore > group.scoreScale) fail(400, "El umbral debe respetar la escala configurada.");
  const input = parsed.data;
  const code = cleanText(input.code, "El código del criterio", 40);
  const title = cleanText(input.title, "El título del criterio", 160);
  const learningOutcomeCode = cleanText(input.learningOutcomeCode, "El código del resultado de aprendizaje", 40);
  const learningOutcomeTitle = cleanText(input.learningOutcomeTitle, "El resultado de aprendizaje", 160);
  const criteria = await getCurrentCriteria(actor.tenantId, campaign.id);
  if (criteria.some((criterion) => criterion.id !== previous.id && criterion.code.toLowerCase() === code.toLowerCase())) {
    fail(409, "Ese código ya está registrado entre los criterios vigentes.");
  }
  if (criteria.filter((criterion) => criterion.id !== previous.id).reduce((sum, criterion) => sum + criterion.weight, 0) + input.weight > 100.01) {
    fail(400, "La suma de las ponderaciones no puede superar el 100 %.");
  }
  const [newCriterion] = await db.transaction(async (tx) => {
    const oldAssignments = await tx.select().from(fpEvaluationActivityCriteria).where(and(
      eq(fpEvaluationActivityCriteria.tenantId, actor.tenantId),
      eq(fpEvaluationActivityCriteria.criterionId, previous.id),
    ));
    await tx.update(fpEvaluationCriteria).set({ isCurrent: false }).where(eq(fpEvaluationCriteria.id, previous.id));
    const [created] = await tx.insert(fpEvaluationCriteria).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      campaignId: campaign.id,
      learningOutcomeCode,
      learningOutcomeTitle,
      code,
      title,
      weight: input.weight,
      minimumScore: input.minimumScore,
      minimumEvidenceCount: input.minimumEvidenceCount,
      version: previous.version + 1,
      isCurrent: true,
      createdByUserId: actor.userId,
    }).returning();
    await tx.delete(fpEvaluationActivityCriteria).where(and(
      eq(fpEvaluationActivityCriteria.tenantId, actor.tenantId),
      eq(fpEvaluationActivityCriteria.criterionId, previous.id),
    ));
    if (oldAssignments.length) {
      await tx.insert(fpEvaluationActivityCriteria).values(oldAssignments.map((assignment) => ({
        id: randomUUID(),
        tenantId: actor.tenantId,
        campaignId: campaign.id,
        eventId: assignment.eventId,
        criterionId: created.id,
        assignedByUserId: actor.userId,
      })));
    }
    return [created];
  });
  await addAudit(actor, campaign.id, "criterion", newCriterion.id, "revised", `Criterio ${code} creado como versión ${newCriterion.version}.`);
  res.json(api.ReviseEvaluationCriterionResponse.parse({
    id: newCriterion.id,
    campaignId: newCriterion.campaignId,
    learningOutcomeCode: newCriterion.learningOutcomeCode,
    learningOutcomeTitle: newCriterion.learningOutcomeTitle,
    code: newCriterion.code,
    title: newCriterion.title,
    weight: newCriterion.weight,
    minimumScore: newCriterion.minimumScore,
    minimumEvidenceCount: newCriterion.minimumEvidenceCount,
    version: newCriterion.version,
    isCurrent: newCriterion.isCurrent,
  }));
}));

router.post("/redfp360/evaluations/criteria/validate", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.ValidateEvaluationWeightsBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Selecciona una campaña válida.");
  res.json(await validateWeights(actor, parsed.data.campaignId));
}));

router.put("/redfp360/evaluations/groups/:campaignId/settings", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.UpdateEvaluationGroupSettingsBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Selecciona una escala de calificación válida.");
  const campaign = await requireManager(actor, routeParam(req.params.campaignId));
  const group = await ensureOpenGroup(actor, campaign.id);
  const [existingAssessment] = await db.select({ id: fpEvaluationAssessments.id }).from(fpEvaluationAssessments).where(and(
    eq(fpEvaluationAssessments.tenantId, actor.tenantId),
    eq(fpEvaluationAssessments.campaignId, campaign.id),
  )).limit(1);
  if (existingAssessment) fail(409, "La escala queda fijada cuando empieza la evaluación.");
  const criteria = await getCurrentCriteria(actor.tenantId, campaign.id);
  if (criteria.some((criterion) => criterion.minimumScore > parsed.data.scoreScale)) {
    fail(400, "La escala nueva es inferior a un umbral configurado en los criterios.");
  }
  const rubrics = await db.select().from(fpEvaluationRubrics).where(and(
    eq(fpEvaluationRubrics.tenantId, actor.tenantId),
    eq(fpEvaluationRubrics.campaignId, campaign.id),
  ));
  if (rubrics.some((rubric) => rubric.levels.some((level) => level.score > parsed.data.scoreScale))) {
    fail(400, "La escala nueva es inferior a una puntuación definida en una rúbrica.");
  }
  const [updated] = group.id
    ? await db.update(fpEvaluationGroups).set({ scoreScale: parsed.data.scoreScale }).where(eq(fpEvaluationGroups.id, group.id)).returning()
    : [];
  const saved = updated ?? await ensureGroup(actor, campaign.id);
  await addAudit(actor, campaign.id, "group", saved.id, "settings_updated", `Escala didáctica configurada de 0 a ${saved.scoreScale}.`);
  res.json(api.UpdateEvaluationGroupSettingsResponse.parse(asGroup(saved)));
}));

router.post("/redfp360/evaluations/rubrics", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.CreateEvaluationRubricBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los niveles y descriptores de la rúbrica.");
  const [criterion] = await db.select().from(fpEvaluationCriteria).where(and(
    eq(fpEvaluationCriteria.tenantId, actor.tenantId),
    eq(fpEvaluationCriteria.id, parsed.data.criterionId),
    eq(fpEvaluationCriteria.isCurrent, true),
  )).limit(1);
  if (!criterion) fail(404, "No se encontró el criterio vigente.");
  const campaign = await requireManager(actor, criterion.campaignId);
  const group = await ensureOpenGroup(actor, campaign.id);
  if (await hasAssessmentInCampaign(actor.tenantId, campaign.id)) {
    fail(409, "Las rúbricas quedan fijadas cuando comienza la evaluación.");
  }
  const title = cleanText(parsed.data.title, "El título de la rúbrica", 120);
  const levels = parsed.data.levels.map((level) => ({
    ...level,
    label: cleanText(level.label, "El nombre del nivel", 80),
    descriptor: cleanText(level.descriptor, "El descriptor del nivel", 500),
  })) as EvaluationRubricLevelValue[];
  const levelIds = new Set(levels.map((level) => level.id));
  const scores = levels.map((level) => level.score);
  if (levelIds.size !== levels.length || new Set(scores).size !== levels.length ||
      scores.some((score) => score < 0 || score > group.scoreScale) ||
      Math.min(...scores) !== 0 || Math.max(...scores) !== group.scoreScale) {
    fail(400, `La rúbrica debe cubrir una sola vez toda la escala 0–${group.scoreScale}.`);
  }
  const previousRubrics = await db.select().from(fpEvaluationRubrics).where(and(
    eq(fpEvaluationRubrics.tenantId, actor.tenantId),
    eq(fpEvaluationRubrics.criterionId, criterion.id),
  ));
  const [rubric] = await db.insert(fpEvaluationRubrics).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    campaignId: campaign.id,
    criterionId: criterion.id,
    title,
    version: Math.max(0, ...previousRubrics.map((item) => item.version)) + 1,
    levels,
    createdByUserId: actor.userId,
  }).returning();
  await addAudit(actor, campaign.id, "rubric", rubric.id, "draft_created", `${title}, versión ${rubric.version}, creada como borrador.`);
  res.status(201).json(api.CreateEvaluationRubricResponse.parse({
    id: rubric.id,
    campaignId: rubric.campaignId,
    criterionId: rubric.criterionId,
    title: rubric.title,
    version: rubric.version,
    levels: rubric.levels,
    isPublished: rubric.isPublished,
    publishedAt: null,
  }));
}));

router.post("/redfp360/evaluations/rubrics/:id/publish", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const [rubric] = await db.select().from(fpEvaluationRubrics).where(and(
    eq(fpEvaluationRubrics.tenantId, actor.tenantId),
    eq(fpEvaluationRubrics.id, routeParam(req.params.id)),
  )).limit(1);
  if (!rubric) fail(404, "No se encontró la versión de rúbrica.");
  const campaign = await requireManager(actor, rubric.campaignId);
  await ensureOpenGroup(actor, campaign.id);
  const [criterion] = await db.select().from(fpEvaluationCriteria).where(and(
    eq(fpEvaluationCriteria.tenantId, actor.tenantId),
    eq(fpEvaluationCriteria.id, rubric.criterionId),
    eq(fpEvaluationCriteria.isCurrent, true),
  )).limit(1);
  if (!criterion) fail(409, "La rúbrica ya no corresponde a un criterio vigente.");
  if (rubric.isPublished) {
    res.json(api.PublishEvaluationRubricResponse.parse({
      id: rubric.id,
      campaignId: rubric.campaignId,
      criterionId: rubric.criterionId,
      title: rubric.title,
      version: rubric.version,
      levels: rubric.levels,
      isPublished: true,
      publishedAt: rubric.publishedAt?.toISOString() ?? null,
    }));
    return;
  }
  if (await hasAssessmentInCampaign(actor.tenantId, campaign.id)) {
    fail(409, "No se puede publicar otra rúbrica después de iniciar la evaluación.");
  }
  const group = await ensureGroup(actor, campaign.id);
  const rubricVersions = await db.select({ version: fpEvaluationRubrics.version }).from(fpEvaluationRubrics).where(and(
    eq(fpEvaluationRubrics.tenantId, actor.tenantId),
    eq(fpEvaluationRubrics.criterionId, rubric.criterionId),
  ));
  if (rubric.version !== Math.max(0, ...rubricVersions.map((item) => item.version))) {
    fail(409, "Publica la versión más reciente de la rúbrica para mantener una referencia única.");
  }
  if (rubric.levels.some((level) => level.score > group.scoreScale) ||
      new Set(rubric.levels.map((level) => level.id)).size !== rubric.levels.length) {
    fail(400, "La rúbrica no cubre correctamente la escala vigente.");
  }
  const [published] = await db.update(fpEvaluationRubrics).set({
    isPublished: true,
    publishedAt: new Date(),
  }).where(eq(fpEvaluationRubrics.id, rubric.id)).returning();
  await addAudit(actor, campaign.id, "rubric", rubric.id, "published", `${rubric.title}, versión ${rubric.version}, fijada para evaluación.`);
  res.json(api.PublishEvaluationRubricResponse.parse({
    id: published.id,
    campaignId: published.campaignId,
    criterionId: published.criterionId,
    title: published.title,
    version: published.version,
    levels: published.levels,
    isPublished: published.isPublished,
    publishedAt: published.publishedAt?.toISOString() ?? null,
  }));
}));

router.put("/redfp360/evaluations/activities/:eventId/criteria", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.AssignEvaluationActivityCriteriaBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Selecciona al menos un criterio vigente.");
  const [event] = await db.select().from(fpSimulationEvents).where(and(
    eq(fpSimulationEvents.tenantId, actor.tenantId),
    eq(fpSimulationEvents.id, routeParam(req.params.eventId)),
  )).limit(1);
  if (!event) fail(404, "No se encontró la actividad de simulación.");
  const campaign = await requireManager(actor, event.campaignId);
  await ensureOpenGroup(actor, campaign.id);
  if (event.status !== "completed") fail(409, "Solo se pueden vincular actividades completadas.");
  const criteria = await getCurrentCriteria(actor.tenantId, campaign.id);
  const selectedIds = [...new Set(parsed.data.criterionIds)];
  if (selectedIds.length !== parsed.data.criterionIds.length ||
      selectedIds.some((id) => !criteria.some((criterion) => criterion.id === id))) {
    fail(400, "La selección contiene criterios duplicados o de otra campaña.");
  }
  const currentAssignments = await db.select().from(fpEvaluationActivityCriteria).where(and(
    eq(fpEvaluationActivityCriteria.tenantId, actor.tenantId),
    eq(fpEvaluationActivityCriteria.eventId, event.id),
  ));
  const currentIds = currentAssignments.map((assignment) => assignment.criterionId).sort();
  const selectedSorted = [...selectedIds].sort();
  const unchanged = currentIds.length === selectedSorted.length &&
    currentIds.every((id, index) => id === selectedSorted[index]);
  if (await hasAssessmentInCampaign(actor.tenantId, campaign.id) && !unchanged) {
    fail(409, "Las actividades quedan vinculadas a sus criterios cuando comienza la evaluación.");
  }
  if (unchanged) {
    res.json(api.AssignEvaluationActivityCriteriaResponse.parse({
      eventId: event.id,
      campaignId: event.campaignId,
      title: event.title,
      eventType: event.eventType,
      completedAt: event.completedAt?.toISOString() ?? null,
      criterionIds: currentIds,
    }));
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(fpEvaluationActivityCriteria).where(and(
      eq(fpEvaluationActivityCriteria.tenantId, actor.tenantId),
      eq(fpEvaluationActivityCriteria.eventId, event.id),
    ));
    await tx.insert(fpEvaluationActivityCriteria).values(selectedIds.map((criterionId) => ({
      id: randomUUID(),
      tenantId: actor.tenantId,
      campaignId: campaign.id,
      eventId: event.id,
      criterionId,
      assignedByUserId: actor.userId,
    })));
  });
  await addAudit(actor, campaign.id, "activity", event.id, "criteria_assigned", `${selectedIds.length} criterios vinculados a la actividad.`);
  res.json(api.AssignEvaluationActivityCriteriaResponse.parse({
    eventId: event.id,
    campaignId: event.campaignId,
    title: event.title,
    eventType: event.eventType,
    completedAt: event.completedAt?.toISOString() ?? null,
    criterionIds: selectedIds,
  }));
}));

router.post("/redfp360/evaluations/assessments", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.CreateEvaluationAssessmentBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Completa la valoración y su justificación.");
  const input = parsed.data;
  const [entry] = await db.select().from(fpPortfolioEntries).where(and(
    eq(fpPortfolioEntries.tenantId, actor.tenantId),
    eq(fpPortfolioEntries.id, input.portfolioEntryId),
  )).limit(1);
  if (!entry) fail(404, "No se encontró la evidencia del portafolio.");
  if (!canEvaluateOrganization(actor, entry.organizationId)) {
    fail(403, "Solo el profesorado autorizado de este centro puede evaluar la evidencia.");
  }
  if (entry.status !== "validated") fail(409, "La evidencia debe estar validada en el portafolio antes de calificarla.");
  const campaign = await findCampaign(actor, entry.campaignId);
  const group = await ensureOpenGroup(actor, campaign.id);
  const [criterion] = await db.select().from(fpEvaluationCriteria).where(and(
    eq(fpEvaluationCriteria.tenantId, actor.tenantId),
    eq(fpEvaluationCriteria.id, input.criterionId),
    eq(fpEvaluationCriteria.campaignId, campaign.id),
    eq(fpEvaluationCriteria.isCurrent, true),
  )).limit(1);
  if (!criterion) fail(404, "No se encontró el criterio vigente para esta campaña.");
  const [assignment] = await db.select({ id: fpEvaluationActivityCriteria.id }).from(fpEvaluationActivityCriteria).where(and(
    eq(fpEvaluationActivityCriteria.tenantId, actor.tenantId),
    eq(fpEvaluationActivityCriteria.eventId, entry.eventId),
    eq(fpEvaluationActivityCriteria.criterionId, criterion.id),
  )).limit(1);
  if (!assignment) fail(400, "La actividad no está vinculada a ese criterio.");
  const [rubric] = await db.select().from(fpEvaluationRubrics).where(and(
    eq(fpEvaluationRubrics.tenantId, actor.tenantId),
    eq(fpEvaluationRubrics.id, input.rubricId),
    eq(fpEvaluationRubrics.criterionId, criterion.id),
    eq(fpEvaluationRubrics.isPublished, true),
  )).limit(1);
  if (!rubric) fail(400, "Selecciona una rúbrica publicada para el criterio.");
  const level = rubric.levels.find((item) => item.id === input.rubricLevelId);
  if (!level || level.score > group.scoreScale) fail(400, "El nivel seleccionado no pertenece a la rúbrica vigente.");
  const eligibleEntries = await db.select({ id: fpPortfolioEntries.id }).from(fpPortfolioEntries)
    .innerJoin(fpEvaluationActivityCriteria, eq(fpPortfolioEntries.eventId, fpEvaluationActivityCriteria.eventId))
    .where(and(
      eq(fpPortfolioEntries.tenantId, actor.tenantId),
      eq(fpPortfolioEntries.campaignId, campaign.id),
      eq(fpPortfolioEntries.studentUserId, entry.studentUserId),
      eq(fpPortfolioEntries.status, "validated"),
      eq(fpEvaluationActivityCriteria.criterionId, criterion.id),
    ));
  if (new Set(eligibleEntries.map((item) => item.id)).size < criterion.minimumEvidenceCount) {
    fail(409, `Se requieren al menos ${criterion.minimumEvidenceCount} evidencias validadas para este criterio.`);
  }
  const priorAttempts = await db.select().from(fpEvaluationAssessments).where(and(
    eq(fpEvaluationAssessments.tenantId, actor.tenantId),
    eq(fpEvaluationAssessments.portfolioEntryId, entry.id),
    eq(fpEvaluationAssessments.criterionId, criterion.id),
  )).orderBy(desc(fpEvaluationAssessments.attemptNumber));
  const latest = priorAttempts[0];
  if (latest && (!input.isRecovery || latest.status !== "recovery_required")) {
    fail(409, "Solo se permite otro intento cuando la evaluación anterior requiere recuperación.");
  }
  if (!latest && input.isRecovery) fail(409, "La primera valoración no puede marcarse como recuperación.");
  const feedback = cleanText(input.feedback, "La retroalimentación", 1000);
  const reason = cleanText(input.reason, "La justificación", 500);
  const [assessment] = await db.insert(fpEvaluationAssessments).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId: entry.organizationId,
    campaignId: campaign.id,
    portfolioEntryId: entry.id,
    studentUserId: entry.studentUserId,
    criterionId: criterion.id,
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    rubricLevelId: level.id,
    rubricLevelLabel: level.label,
    score: level.score,
    scoreScale: group.scoreScale,
    attemptNumber: (latest?.attemptNumber ?? 0) + 1,
    isRecovery: input.isRecovery,
    status: level.score >= criterion.minimumScore ? "achieved" : "recovery_required",
    feedback,
    reason,
    evaluatedByUserId: actor.userId,
  }).returning();
  await db.update(fpEvaluationGroups).set({ status: "in_progress" }).where(and(
    eq(fpEvaluationGroups.tenantId, actor.tenantId),
    eq(fpEvaluationGroups.campaignId, campaign.id),
  ));
  await addAudit(
    actor,
    campaign.id,
    "assessment",
    assessment.id,
    input.isRecovery ? "recovery_recorded" : "assessment_recorded",
    `Intento ${assessment.attemptNumber} del criterio ${criterion.code}: ${assessment.status === "achieved" ? "alcanzado" : "requiere recuperación"}.`,
    reason,
    entry.organizationId,
  );
  res.status(201).json(api.CreateEvaluationAssessmentResponse.parse({
    id: assessment.id,
    portfolioEntryId: assessment.portfolioEntryId,
    criterionId: assessment.criterionId,
    criterionTitle: criterion.title,
    rubricId: assessment.rubricId,
    rubricVersion: assessment.rubricVersion,
    rubricLevelId: assessment.rubricLevelId,
    rubricLevelLabel: assessment.rubricLevelLabel,
    score: assessment.score,
    scoreScale: assessment.scoreScale,
    attemptNumber: assessment.attemptNumber,
    status: assessment.status,
    feedback: assessment.feedback,
    reason: assessment.reason,
    evaluatorName: actor.displayName,
    createdAt: assessment.createdAt.toISOString(),
  }));
}));

router.post("/redfp360/evaluations/groups/:campaignId/close", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.CloseEvaluationGroupBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Confirma el cierre didáctico e incluye su motivo.");
  const campaign = await requireManager(actor, routeParam(req.params.campaignId));
  const group = await ensureOpenGroup(actor, campaign.id);
  const criteria = await getCurrentCriteria(actor.tenantId, campaign.id);
  const totalWeight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (!criteria.length || Math.abs(totalWeight - 100) >= 0.01) {
    fail(409, "No se puede cerrar: la programación debe tener criterios vigentes con ponderaciones que sumen 100 %.");
  }
  const entries = await db.select().from(fpPortfolioEntries).where(and(
    eq(fpPortfolioEntries.tenantId, actor.tenantId),
    eq(fpPortfolioEntries.campaignId, campaign.id),
    eq(fpPortfolioEntries.status, "validated"),
  ));
  const participants = [...new Set(entries.map((entry) => entry.studentUserId))];
  if (!participants.length) fail(409, "No se puede cerrar sin evidencias validadas.");
  const [assignments, assessments] = await Promise.all([
    db.select().from(fpEvaluationActivityCriteria).where(and(
      eq(fpEvaluationActivityCriteria.tenantId, actor.tenantId),
      eq(fpEvaluationActivityCriteria.campaignId, campaign.id),
    )),
    db.select().from(fpEvaluationAssessments).where(and(
      eq(fpEvaluationAssessments.tenantId, actor.tenantId),
      eq(fpEvaluationAssessments.campaignId, campaign.id),
    )).orderBy(asc(fpEvaluationAssessments.attemptNumber)),
  ]);
  const currentIds = new Set(criteria.map((criterion) => criterion.id));
  const assignmentByEvent = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!currentIds.has(assignment.criterionId)) continue;
    const ids = assignmentByEvent.get(assignment.eventId) ?? new Set<string>();
    ids.add(assignment.criterionId);
    assignmentByEvent.set(assignment.eventId, ids);
  }
  const assessmentByEntryCriterion = new Map<string, typeof assessments>();
  for (const assessment of assessments) {
    const key = `${assessment.portfolioEntryId}:${assessment.criterionId}`;
    const records = assessmentByEntryCriterion.get(key) ?? [];
    records.push(assessment);
    assessmentByEntryCriterion.set(key, records);
  }
  for (const studentId of participants) {
    const studentEntries = entries.filter((entry) => entry.studentUserId === studentId);
    for (const criterion of criteria) {
      const evidence = studentEntries.filter((entry) => assignmentByEvent.get(entry.eventId)?.has(criterion.id));
      if (evidence.length < criterion.minimumEvidenceCount) {
        fail(409, `No se puede cerrar: falta evidencia para el criterio ${criterion.code}.`);
      }
      const completedEvidence = evidence.filter((entry) => {
        const attempts = assessmentByEntryCriterion.get(`${entry.id}:${criterion.id}`) ?? [];
        const latest = attempts.reduce((current, attempt) => !current || attempt.attemptNumber > current.attemptNumber ? attempt : current, null as typeof attempts[number] | null);
        return latest?.status === "achieved";
      });
      if (completedEvidence.length < criterion.minimumEvidenceCount) {
        fail(409, `No se puede cerrar: quedan evaluaciones o recuperaciones pendientes en ${criterion.code}.`);
      }
    }
  }
  const reason = cleanText(parsed.data.reason, "El motivo de cierre", 500);
  const [closed] = await db.update(fpEvaluationGroups).set({
    status: "closed",
    closedAt: new Date(),
    closedByUserId: actor.userId,
    closeReason: reason,
  }).where(and(
    eq(fpEvaluationGroups.id, group.id),
    eq(fpEvaluationGroups.status, group.status),
  )).returning();
  if (!closed) fail(409, "El expediente cambió durante el cierre. Recarga la evaluación.");
  await addAudit(actor, campaign.id, "group", closed.id, "closed", "Expediente didáctico cerrado.", reason);
  res.json(api.CloseEvaluationGroupResponse.parse(asGroup(closed)));
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof EvaluationError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
};

router.use(errorHandler);
export default router;

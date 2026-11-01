import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import * as api from "@workspace/api-zod";
import {
  db,
  fpDocuments,
  fpMentorAudit,
  fpMentorChallenges,
  fpMentorEntities,
  fpMentorEvidence,
  fpMentorRecommendations,
  fpMentorReviews,
  fpMentorSessions,
  fpOrganizations,
  fpSimulationCampaigns,
  fpSimulationEvents,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: Router = Router();
const contactPattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?34[\s.-]?)?[6789]\d{8}\b)/i;
const sensitiveBusinessPattern = /\b(?:ES\d{2}(?:[\s-]?\d{4}){5}[\s-]?\d{2}|\d{8}[A-Z])\b/i;

class MentorshipError extends Error {
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
  throw new MentorshipError(status, message);
}

function param(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) fail(400, "Falta un identificador válido.");
  return first;
}

function isEducator(role: AuthContext["role"]): boolean {
  return role === "teacher" || role === "administrator";
}

function isExternalMentor(role: AuthContext["role"]): boolean {
  return role === "mentor" || role === "promoter";
}

function rejectPersonalChannels(...values: Array<string | null | undefined>): void {
  if (values.some((value) => value && contactPattern.test(value))) {
    fail(400, "No añadas correos ni teléfonos personales a la simulación.");
  }
}

function rejectSensitiveBusinessData(value: string): void {
  if (contactPattern.test(value) || sensitiveBusinessPattern.test(value)) {
    fail(400, "El reto parece contener datos de contacto o identificadores empresariales. Anonimízalo antes de guardarlo.");
  }
}

function publicEntityName(actor: AuthContext, entity: typeof fpMentorEntities.$inferSelect): string {
  if (actor.role === "administrator" ||
      (actor.role === "teacher" && entity.ownerOrganizationId === actor.organizationId) ||
      (entity.agreementStatus === "approved" && entity.publishNameAuthorized) ||
      (isExternalMentor(actor.role) && entity.linkedOrganizationId === actor.organizationId)) {
    return entity.name;
  }
  return "Entidad colaboradora";
}

function entityResponse(actor: AuthContext, entity: typeof fpMentorEntities.$inferSelect) {
  const privateDetails = actor.role === "administrator" ||
    (actor.role === "teacher" && entity.ownerOrganizationId === actor.organizationId);
  return api.CreateMentorEntityResponse.parse({
    id: entity.id,
    name: publicEntityName(actor, entity),
    kind: entity.kind,
    linkedOrganizationId: entity.linkedOrganizationId,
    areas: entity.areas,
    agreementStatus: entity.agreementStatus,
    agreementReference: entity.agreementReference,
    contactName: privateDetails ? entity.contactName : "Referencia simulada",
    contactRole: privateDetails ? entity.contactRole : "Contacto educativo",
    publishNameAuthorized: entity.publishNameAuthorized,
    validFrom: entity.validFrom,
    validUntil: entity.validUntil,
    createdAt: entity.createdAt.toISOString(),
  });
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

async function priorOperation(actor: AuthContext, operationId: string, body: unknown, resourceType: string) {
  const [prior] = await db.select().from(fpMentorAudit).where(and(
    eq(fpMentorAudit.tenantId, actor.tenantId),
    eq(fpMentorAudit.operationId, operationId),
  )).limit(1);
  if (!prior) return null;
  if (prior.actorUserId !== actor.userId ||
      prior.resourceType !== resourceType ||
      prior.fingerprint !== fingerprint(body)) {
    fail(409, "Este identificador de operación ya se usó con otros datos.");
  }
  return prior;
}

async function appendAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actor: AuthContext,
  input: {
    operationId: string;
    body: unknown;
    campaignId?: string | null;
    organizationId?: string | null;
    resourceType: string;
    resourceId: string;
    action: string;
    summary: string;
    reason?: string;
  },
) {
  await tx.insert(fpMentorAudit).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    campaignId: input.campaignId ?? null,
    organizationId: input.organizationId ?? actor.organizationId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action: input.action,
    summary: input.summary,
    actorUserId: actor.userId,
    actorLabel: isExternalMentor(actor.role) ? "Mentor asignado" : actor.displayName,
    operationId: input.operationId,
    fingerprint: fingerprint(input.body),
    reason: input.reason ?? "",
  });
}

async function requireCampaign(actor: AuthContext, campaignId: string) {
  const [campaign] = await db.select().from(fpSimulationCampaigns).where(and(
    eq(fpSimulationCampaigns.id, campaignId),
    eq(fpSimulationCampaigns.tenantId, actor.tenantId),
  )).limit(1);
  if (!campaign) fail(404, "No se encontró la campaña didáctica.");
  if (isExternalMentor(actor.role)) {
    const linkedEntities = await db.select({ id: fpMentorEntities.id }).from(fpMentorEntities).where(and(
      eq(fpMentorEntities.tenantId, actor.tenantId),
      eq(fpMentorEntities.linkedOrganizationId, actor.organizationId ?? "__no_org__"),
      eq(fpMentorEntities.agreementStatus, "approved"),
    ));
    const linkedEntityIds = linkedEntities.map((entity) => entity.id);
    const [session, challenge] = linkedEntityIds.length ? await Promise.all([
      db.select({ id: fpMentorSessions.id }).from(fpMentorSessions).where(and(
        eq(fpMentorSessions.tenantId, actor.tenantId),
        eq(fpMentorSessions.campaignId, campaign.id),
        inArray(fpMentorSessions.entityId, linkedEntityIds),
      )).limit(1).then((rows) => rows[0]),
      db.select({ id: fpMentorChallenges.id }).from(fpMentorChallenges).where(and(
        eq(fpMentorChallenges.tenantId, actor.tenantId),
        eq(fpMentorChallenges.campaignId, campaign.id),
        inArray(fpMentorChallenges.entityId, linkedEntityIds),
      )).limit(1).then((rows) => rows[0]),
    ]) : [undefined, undefined];
    if (!session && !challenge) fail(403, "La campaña no tiene una colaboración asignada a tu perfil.");
  } else if (actor.role !== "administrator" &&
      (!actor.organizationId || !campaign.participantOrganizationIds.includes(actor.organizationId))) {
    fail(403, "La campaña no está disponible para tu centro.");
  }
  return campaign;
}

function canManageCampaign(actor: AuthContext, campaign: typeof fpSimulationCampaigns.$inferSelect): boolean {
  return actor.role === "administrator" ||
    (actor.role === "teacher" && actor.organizationId === campaign.ownerOrganizationId);
}

async function requireEntity(
  actor: AuthContext,
  entityId: string,
  campaign?: typeof fpSimulationCampaigns.$inferSelect,
) {
  const [entity] = await db.select().from(fpMentorEntities).where(and(
    eq(fpMentorEntities.id, entityId),
    eq(fpMentorEntities.tenantId, actor.tenantId),
  )).limit(1);
  if (!entity) fail(404, "No se encontró la entidad colaboradora.");
  if (actor.role === "teacher" && entity.ownerOrganizationId !== actor.organizationId &&
      !(campaign && canManageCampaign(actor, campaign) && entity.agreementStatus === "approved")) {
    fail(403, "La entidad colaboradora pertenece a otro centro.");
  }
  if (isExternalMentor(actor.role) && entity.linkedOrganizationId !== actor.organizationId) {
    fail(403, "La entidad no pertenece a tu ámbito asignado.");
  }
  return entity;
}

async function readOverview(actor: AuthContext, requestedCampaignId?: string) {
  if (!["student", "team_manager", "teacher", "promoter", "mentor", "administrator"].includes(actor.role)) {
    fail(403, "Este perfil no tiene acceso al espacio de mentoría.");
  }
  const [campaignRows, entityRows] = await Promise.all([
    db.select().from(fpSimulationCampaigns).where(eq(fpSimulationCampaigns.tenantId, actor.tenantId)),
    db.select().from(fpMentorEntities).where(eq(fpMentorEntities.tenantId, actor.tenantId)),
  ]);
  const externalEntityIds = isExternalMentor(actor.role)
    ? entityRows.filter((entity) => entity.linkedOrganizationId === actor.organizationId && entity.agreementStatus === "approved").map((entity) => entity.id)
    : [];
  const externalRecords = externalEntityIds.length
    ? await Promise.all([
      db.select({ campaignId: fpMentorSessions.campaignId }).from(fpMentorSessions).where(and(
        eq(fpMentorSessions.tenantId, actor.tenantId),
        inArray(fpMentorSessions.entityId, externalEntityIds),
      )),
      db.select({ campaignId: fpMentorChallenges.campaignId }).from(fpMentorChallenges).where(and(
        eq(fpMentorChallenges.tenantId, actor.tenantId),
        inArray(fpMentorChallenges.entityId, externalEntityIds),
      )),
    ])
    : [[], []];
  const externalCampaignIds = new Set(externalRecords.flatMap((rows) => rows.map((row) => row.campaignId)));
  let campaigns = campaignRows.filter((campaign) => actor.role === "administrator" ||
    (isExternalMentor(actor.role)
      ? externalCampaignIds.has(campaign.id)
      : Boolean(actor.organizationId && campaign.participantOrganizationIds.includes(actor.organizationId))));
  if (requestedCampaignId) {
    campaigns = campaigns.filter((campaign) => campaign.id === requestedCampaignId);
    if (!campaigns.length) fail(404, "No se encontró la campaña en tu ámbito.");
  }
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const ownedCampaignIds = actor.role === "teacher"
    ? campaigns.filter((campaign) => campaign.ownerOrganizationId === actor.organizationId).map((campaign) => campaign.id)
    : [];

  const inScopeEntityIds = new Set(
    entityRows.filter((entity) =>
      actor.role === "administrator" ||
      (actor.role === "teacher" && entity.ownerOrganizationId === actor.organizationId) ||
      (isExternalMentor(actor.role) && entity.linkedOrganizationId === actor.organizationId && entity.agreementStatus === "approved"),
    ).map((entity) => entity.id),
  );
  if (actor.role === "teacher" && ownedCampaignIds.length) {
    const [ownedSessionEntities, ownedChallengeEntities] = await Promise.all([
      db.select({ entityId: fpMentorSessions.entityId }).from(fpMentorSessions).where(and(
        eq(fpMentorSessions.tenantId, actor.tenantId),
        inArray(fpMentorSessions.campaignId, ownedCampaignIds),
      )),
      db.select({ entityId: fpMentorChallenges.entityId }).from(fpMentorChallenges).where(and(
        eq(fpMentorChallenges.tenantId, actor.tenantId),
        inArray(fpMentorChallenges.campaignId, ownedCampaignIds),
      )),
    ]);
    [...ownedSessionEntities, ...ownedChallengeEntities].forEach((row) => inScopeEntityIds.add(row.entityId));
  }
  if (actor.role === "student" || actor.role === "team_manager") {
    const [sessionEntityRows, challengeEntityRows] = await Promise.all([
      db.select({ entityId: fpMentorSessions.entityId }).from(fpMentorSessions).where(and(
        eq(fpMentorSessions.tenantId, actor.tenantId),
        eq(fpMentorSessions.organizationId, actor.organizationId ?? "__no_org__"),
        ...(campaignIds.length ? [inArray(fpMentorSessions.campaignId, campaignIds)] : []),
      )),
      db.select({ entityId: fpMentorChallenges.entityId }).from(fpMentorChallenges).where(and(
        eq(fpMentorChallenges.tenantId, actor.tenantId),
        eq(fpMentorChallenges.organizationId, actor.organizationId ?? "__no_org__"),
        ...(campaignIds.length ? [inArray(fpMentorChallenges.campaignId, campaignIds)] : []),
      )),
    ]);
    [...sessionEntityRows, ...challengeEntityRows].forEach((row) => inScopeEntityIds.add(row.entityId));
  }
  const visibleEntities = entityRows.filter((entity) => inScopeEntityIds.has(entity.id));
  const entityIds = visibleEntities.map((entity) => entity.id);
  const campaignFilter = campaignIds.length ? inArray(fpMentorSessions.campaignId, campaignIds) : eq(fpMentorSessions.id, "__none__");
  const challengeCampaignFilter = campaignIds.length ? inArray(fpMentorChallenges.campaignId, campaignIds) : eq(fpMentorChallenges.id, "__none__");
  const [sessionRows, challengeRows] = await Promise.all([
    db.select().from(fpMentorSessions).where(and(
      eq(fpMentorSessions.tenantId, actor.tenantId),
      campaignFilter,
      ...(isExternalMentor(actor.role)
        ? entityIds.length ? [inArray(fpMentorSessions.entityId, entityIds)] : [eq(fpMentorSessions.id, "__none__")]
        : actor.role === "administrator" ? [] : actor.role === "teacher" && ownedCampaignIds.length
          ? [or(eq(fpMentorSessions.organizationId, actor.organizationId ?? "__no_org__"), inArray(fpMentorSessions.campaignId, ownedCampaignIds))]
          : [eq(fpMentorSessions.organizationId, actor.organizationId ?? "__no_org__")]),
    )).orderBy(asc(fpMentorSessions.scheduledDate), asc(fpMentorSessions.scheduledTime)),
    db.select().from(fpMentorChallenges).where(and(
      eq(fpMentorChallenges.tenantId, actor.tenantId),
      challengeCampaignFilter,
      ...(isExternalMentor(actor.role)
        ? entityIds.length ? [inArray(fpMentorChallenges.entityId, entityIds)] : [eq(fpMentorChallenges.id, "__none__")]
        : actor.role === "administrator" ? [] : actor.role === "teacher" && ownedCampaignIds.length
          ? [or(eq(fpMentorChallenges.organizationId, actor.organizationId ?? "__no_org__"), inArray(fpMentorChallenges.campaignId, ownedCampaignIds))]
          : [eq(fpMentorChallenges.organizationId, actor.organizationId ?? "__no_org__")]),
    )).orderBy(asc(fpMentorChallenges.createdAt)),
  ]);
  const sessionIds = sessionRows.map((session) => session.id);
  const challengeIds = challengeRows.map((challenge) => challenge.id);
  const scopedOrganizationIds = [...new Set(campaigns.flatMap((campaign) => campaign.participantOrganizationIds))];
  const [reviewRows, organizationRows, documentRows, auditRows] = await Promise.all([
    challengeIds.length ? db.select().from(fpMentorReviews).where(and(
      eq(fpMentorReviews.tenantId, actor.tenantId),
      inArray(fpMentorReviews.challengeId, challengeIds),
    )).orderBy(asc(fpMentorReviews.createdAt)) : [],
    campaignIds.length ? db.select().from(fpOrganizations).where(and(
      eq(fpOrganizations.tenantId, actor.tenantId),
      ...(actor.role === "administrator" ? [] : [inArray(fpOrganizations.id, scopedOrganizationIds)]),
    )) : [],
    isEducator(actor.role) || actor.role === "team_manager" || actor.role === "student"
      ? db.select({
        id: fpDocuments.id,
        reference: fpDocuments.documentRef,
        organizationId: fpDocuments.organizationId,
      }).from(fpDocuments).where(and(
        eq(fpDocuments.tenantId, actor.tenantId),
        eq(fpDocuments.isSynthetic, true),
        eq(fpDocuments.status, "confirmed"),
        eq(fpDocuments.visibility, "organization"),
        isNull(fpDocuments.archivedAt),
        ...(actor.role === "administrator" ? [] : [eq(fpDocuments.organizationId, actor.organizationId ?? "__no_org__")]),
      )) : [],
    isEducator(actor.role) && campaignIds.length ? db.select().from(fpMentorAudit).where(and(
      eq(fpMentorAudit.tenantId, actor.tenantId),
      inArray(fpMentorAudit.campaignId, campaignIds),
      ...(actor.role === "administrator" ? [] : [eq(fpMentorAudit.organizationId, actor.organizationId ?? "__no_org__")]),
    )).orderBy(asc(fpMentorAudit.createdAt)) : [],
  ]);
  const evidenceRows = campaignIds.length ? await db.select().from(fpMentorEvidence).where(and(
    eq(fpMentorEvidence.tenantId, actor.tenantId),
    inArray(fpMentorEvidence.campaignId, campaignIds),
  )).orderBy(asc(fpMentorEvidence.createdAt)) : [];
  const reviewIds = reviewRows.map((review) => review.id);
  const recommendationRows = reviewIds.length ? await db.select().from(fpMentorRecommendations).where(and(
    eq(fpMentorRecommendations.tenantId, actor.tenantId),
    inArray(fpMentorRecommendations.reviewId, reviewIds),
  )) : [];
  const entityById = new Map(visibleEntities.map((entity) => [entity.id, entity]));
  const documentById = new Map(documentRows.map((document) => [document.id, document]));
  const allVisibleChallenges = new Set(challengeIds);
  const visibleEvidence = evidenceRows.filter((evidence) =>
    (evidence.sessionId && sessionIds.includes(evidence.sessionId)) ||
    (evidence.challengeId && allVisibleChallenges.has(evidence.challengeId)),
  );
  const sessionDtos = sessionRows.map((session) => ({
    id: session.id,
    campaignId: session.campaignId,
    organizationId: session.organizationId,
    entityId: session.entityId,
    entityName: publicEntityName(actor, entityById.get(session.entityId)!),
    objective: session.objective,
    modality: session.modality,
    scheduledDate: session.scheduledDate,
    scheduledTime: session.scheduledTime,
    status: session.status,
    groupLabel: session.groupLabel,
    participantCount: session.participantCount,
    materialSummary: session.materialSummary,
    createdAt: session.createdAt.toISOString(),
  }));
  const challengeDtos = challengeRows.map((challenge) => ({
    id: challenge.id,
    campaignId: challenge.campaignId,
    entityId: challenge.entityId,
    entityName: publicEntityName(actor, entityById.get(challenge.entityId)!),
    organizationId: challenge.organizationId,
    simulationEventId: challenge.simulationEventId,
    title: challenge.title,
    sector: challenge.sector,
    level: challenge.level,
    anonymizedSummary: challenge.anonymizedSummary,
    status: challenge.status,
    createdAt: challenge.createdAt.toISOString(),
  }));
  const scopedEntityResponse = visibleEntities.map((entity) => entityResponse(actor, entity));
  const response = api.GetMentorshipOverviewResponse.parse({
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      ownerOrganizationId: campaign.ownerOrganizationId,
      participantOrganizationIds: campaign.participantOrganizationIds,
    })),
    organizations: organizationRows.map((organization) => ({
      id: organization.id,
      name: organization.name,
      center: organization.center,
      island: organization.island,
      role: organization.role,
    })),
    eligibleDocuments: documentRows.map((document) => ({
      id: document.id,
      reference: document.reference,
      title: document.reference,
      organizationId: document.organizationId,
    })),
    entities: scopedEntityResponse,
    sessions: sessionDtos,
    challenges: challengeDtos,
    reviews: reviewRows.map((review) => ({
      id: review.id,
      challengeId: review.challengeId,
      entityId: review.entityId,
      reviewerLabel: review.reviewerLabel,
      decision: review.decision,
      observation: review.observation,
      createdAt: review.createdAt.toISOString(),
    })),
    evidence: visibleEvidence.map((evidence) => ({
      id: evidence.id,
      campaignId: evidence.campaignId,
      sessionId: evidence.sessionId,
      challengeId: evidence.challengeId,
      kind: evidence.kind,
      summary: evidence.summary,
      participantCount: evidence.participantCount,
      documentReference: evidence.documentId ? documentById.get(evidence.documentId)?.reference ?? null : null,
      simulatedDate: evidence.simulatedDate,
      createdAt: evidence.createdAt.toISOString(),
    })),
    recommendations: recommendationRows.map((recommendation) => ({
      id: recommendation.id,
      reviewId: recommendation.reviewId,
      text: recommendation.text,
      status: recommendation.status,
      createdAt: recommendation.createdAt.toISOString(),
    })),
    audit: auditRows.map((event) => ({
      id: event.id,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      action: event.action,
      summary: event.summary,
      actorLabel: event.actorLabel,
      createdAt: event.createdAt.toISOString(),
    })),
    impact: {
      sessionsPlanned: sessionRows.length,
      sessionsCompleted: sessionRows.filter((session) => session.status === "completed").length,
      challengesValidated: challengeRows.filter((challenge) => ["validated", "assigned", "closed"].includes(challenge.status)).length,
      recommendationsImplemented: recommendationRows.filter((recommendation) => recommendation.status === "implemented").length,
      transferRate: recommendationRows.length
        ? Math.round((recommendationRows.filter((recommendation) => recommendation.status === "implemented").length / recommendationRows.length) * 100)
        : 0,
    },
    capabilities: {
      canManageEntities: isEducator(actor.role),
      canSchedule: isEducator(actor.role),
      canProposeChallenges: isEducator(actor.role) || actor.role === "team_manager" || isExternalMentor(actor.role),
      canReview: isEducator(actor.role) || isExternalMentor(actor.role),
      canRecordEvidence: ["student", "team_manager", "teacher", "administrator", "mentor", "promoter"].includes(actor.role),
      canManageTransfer: isEducator(actor.role),
      canViewAudit: isEducator(actor.role),
    },
  });
  return response;
}

router.use("/redfp360/mentorship", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/mentorship/overview", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const parsed = api.GetMentorshipOverviewQueryParams.safeParse(req.query);
  if (!parsed.success) fail(400, "Revisa la campaña seleccionada.");
  res.json(await readOverview(actor, parsed.data.campaignId));
}));

router.post("/redfp360/mentorship/entities", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isEducator(actor.role)) fail(403, "Solo el profesorado o administración puede registrar entidades colaboradoras.");
  if (actor.role === "teacher" && !actor.organizationId) {
    fail(403, "Asocia tu perfil docente a un centro antes de registrar colaboradores.");
  }
  const parsed = api.CreateMentorEntityBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los datos de la entidad colaboradora.");
  const input = parsed.data;
  rejectPersonalChannels(input.name, input.contactName, input.contactRole, input.agreementReference);
  if (input.linkedOrganizationId) {
    const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
      eq(fpOrganizations.id, input.linkedOrganizationId),
      eq(fpOrganizations.tenantId, actor.tenantId),
      eq(fpOrganizations.isActive, true),
    )).limit(1);
    if (!organization) fail(400, "Selecciona una organización activa de este entorno.");
  }
  if (input.validFrom && input.validUntil && input.validUntil < input.validFrom) {
    fail(400, "La fecha final del acuerdo no puede preceder a la inicial.");
  }
  const prior = await priorOperation(actor, input.operationId, input, "entity");
  if (prior) {
    const [entity] = await db.select().from(fpMentorEntities).where(and(
      eq(fpMentorEntities.id, prior.resourceId),
      eq(fpMentorEntities.tenantId, actor.tenantId),
    )).limit(1);
    if (!entity) fail(409, "La operación anterior no tiene una entidad recuperable.");
    await requireEntity(actor, entity.id);
    res.status(200).json(entityResponse(actor, entity));
    return;
  }
  const entity = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpMentorEntities).values({
      id: input.operationId,
      tenantId: actor.tenantId,
      name: input.name.trim(),
      kind: input.kind,
      ownerOrganizationId: actor.organizationId,
      linkedOrganizationId: input.linkedOrganizationId,
      areas: input.areas.map((area) => area.trim()),
      agreementStatus: "draft",
      agreementReference: input.agreementReference.trim(),
      contactName: input.contactName.trim(),
      contactRole: input.contactRole.trim(),
      publishNameAuthorized: input.publishNameAuthorized,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      createdByUserId: actor.userId,
    }).returning();
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      resourceType: "entity",
      resourceId: created.id,
      action: "created",
      summary: `Entidad colaboradora registrada: ${created.name}.`,
    });
    return created;
  });
  res.status(201).json(entityResponse(actor, entity));
}));

router.put("/redfp360/mentorship/entities/:id/agreement", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isEducator(actor.role)) fail(403, "Solo el profesorado o administración puede revisar acuerdos.");
  const entityId = param(req.params.id);
  const parsed = api.UpdateMentorAgreementBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa el estado y el motivo del acuerdo.");
  const input = parsed.data;
  const entity = await requireEntity(actor, entityId);
  const prior = await priorOperation(actor, input.operationId, input, "entity");
  if (prior) {
    const [current] = await db.select().from(fpMentorEntities).where(eq(fpMentorEntities.id, entityId)).limit(1);
    if (!current) fail(404, "No se encontró el acuerdo.");
    res.json(entityResponse(actor, current));
    return;
  }
  if (entity.agreementStatus === input.agreementStatus) {
    res.json(entityResponse(actor, entity));
    return;
  }
  if (input.agreementStatus === "approved" &&
      (entity.agreementStatus !== "pending_review" || !entity.validFrom || !entity.validUntil || entity.validUntil < entity.validFrom)) {
    fail(409, "El acuerdo debe estar pendiente de revisión y tener un periodo válido antes de aprobarse.");
  }
  if (entity.agreementStatus === "revoked" && input.agreementStatus !== "revoked") {
    fail(409, "Un acuerdo revocado debe registrarse como uno nuevo.");
  }
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(fpMentorEntities).set({
      agreementStatus: input.agreementStatus,
      updatedAt: new Date(),
    }).where(and(
      eq(fpMentorEntities.id, entityId),
      eq(fpMentorEntities.tenantId, actor.tenantId),
    )).returning();
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      resourceType: "entity",
      resourceId: entityId,
      action: `agreement_${input.agreementStatus}`,
      summary: `Estado del acuerdo actualizado a ${input.agreementStatus}.`,
      reason: input.reason,
    });
    return rows;
  });
  if (!updated) fail(404, "No se encontró el acuerdo.");
  res.json(entityResponse(actor, updated));
}));

router.post("/redfp360/mentorship/sessions", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isEducator(actor.role)) fail(403, "Solo el profesorado o administración puede convocar una mentoría.");
  const parsed = api.CreateMentorSessionBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los datos de la sesión.");
  const input = parsed.data;
  const campaign = await requireCampaign(actor, input.campaignId);
  if (!canManageCampaign(actor, campaign)) fail(403, "Solo el centro responsable puede programar esta campaña.");
  if (!campaign.participantOrganizationIds.includes(input.organizationId)) {
    fail(400, "El centro seleccionado no participa en esta campaña.");
  }
  const entity = await requireEntity(actor, input.entityId, campaign);
  if (entity.agreementStatus !== "approved" || !entity.validFrom || !entity.validUntil) {
    fail(409, "La mentoría requiere un acuerdo aprobado y vigente.");
  }
  if (input.scheduledDate < campaign.startDate || input.scheduledDate > campaign.endDate ||
      input.scheduledDate < entity.validFrom || input.scheduledDate > entity.validUntil) {
    fail(400, "La fecha debe estar dentro de la campaña y del periodo del acuerdo.");
  }
  rejectPersonalChannels(input.objective, input.groupLabel, input.materialSummary);
  rejectSensitiveBusinessData(input.materialSummary);
  const prior = await priorOperation(actor, input.operationId, input, "session");
  if (prior) {
    const [existing] = await db.select().from(fpMentorSessions).where(and(
      eq(fpMentorSessions.id, prior.resourceId),
      eq(fpMentorSessions.tenantId, actor.tenantId),
    )).limit(1);
    if (!existing) fail(409, "La operación anterior no tiene una sesión recuperable.");
    res.status(200).json(api.CreateMentorSessionResponse.parse({
      id: existing.id,
      campaignId: existing.campaignId,
      organizationId: existing.organizationId,
      entityId: existing.entityId,
      entityName: publicEntityName(actor, entity),
      objective: existing.objective,
      modality: existing.modality,
      scheduledDate: existing.scheduledDate,
      scheduledTime: existing.scheduledTime,
      status: existing.status,
      groupLabel: existing.groupLabel,
      participantCount: existing.participantCount,
      materialSummary: existing.materialSummary,
      createdAt: existing.createdAt.toISOString(),
    }));
    return;
  }
  const [conflict] = await db.select({ id: fpMentorSessions.id }).from(fpMentorSessions).where(and(
    eq(fpMentorSessions.tenantId, actor.tenantId),
    eq(fpMentorSessions.scheduledDate, input.scheduledDate),
    eq(fpMentorSessions.scheduledTime, input.scheduledTime),
    inArray(fpMentorSessions.status, ["proposed", "confirmed", "rescheduled"]),
    or(
      eq(fpMentorSessions.entityId, entity.id),
      eq(fpMentorSessions.organizationId, input.organizationId),
    ),
  )).limit(1);
  if (conflict) fail(409, "Ya existe una mentoría en esa franja horaria.");
  const session = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpMentorSessions).values({
      id: input.operationId,
      tenantId: actor.tenantId,
      campaignId: campaign.id,
      organizationId: input.organizationId,
      entityId: entity.id,
      objective: input.objective.trim(),
      modality: input.modality,
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledTime,
      status: "proposed",
      groupLabel: input.groupLabel.trim(),
      participantCount: input.participantCount,
      materialSummary: input.materialSummary.trim(),
      createdByUserId: actor.userId,
    }).returning();
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: campaign.id,
      organizationId: input.organizationId,
      resourceType: "session",
      resourceId: created.id,
      action: "proposed",
      summary: `Sesión de mentoría convocada para ${input.scheduledDate}.`,
    });
    return created;
  });
  res.status(201).json(api.CreateMentorSessionResponse.parse({
    id: session.id,
    campaignId: session.campaignId,
    organizationId: session.organizationId,
    entityId: session.entityId,
    entityName: publicEntityName(actor, entity),
    objective: session.objective,
    modality: session.modality,
    scheduledDate: session.scheduledDate,
    scheduledTime: session.scheduledTime,
    status: session.status,
    groupLabel: session.groupLabel,
    participantCount: session.participantCount,
    materialSummary: session.materialSummary,
    createdAt: session.createdAt.toISOString(),
  }));
}));

router.post("/redfp360/mentorship/sessions/:id/action", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const sessionId = param(req.params.id);
  const parsed = api.ActOnMentorSessionBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa la acción y su motivo.");
  const input = parsed.data;
  const [session] = await db.select().from(fpMentorSessions).where(and(
    eq(fpMentorSessions.id, sessionId),
    eq(fpMentorSessions.tenantId, actor.tenantId),
  )).limit(1);
  if (!session) fail(404, "No se encontró la sesión.");
  const campaign = await requireCampaign(actor, session.campaignId);
  const entity = await requireEntity(actor, session.entityId, campaign);
  const externalAction = isExternalMentor(actor.role) &&
    entity.linkedOrganizationId === actor.organizationId &&
    ["confirm", "reschedule", "cancel"].includes(input.action);
  if (!canManageCampaign(actor, campaign) && !externalAction) {
    fail(403, "No tienes permiso para cambiar el estado de esta sesión.");
  }
  if (isExternalMentor(actor.role) && entity.agreementStatus !== "approved") {
    fail(409, "El acuerdo asociado ya no está aprobado.");
  }
  const prior = await priorOperation(actor, input.operationId, input, "session");
  if (prior) {
    const [current] = await db.select().from(fpMentorSessions).where(eq(fpMentorSessions.id, sessionId)).limit(1);
    if (!current) fail(404, "No se encontró la sesión.");
    res.json(api.ActOnMentorSessionResponse.parse({
      id: current.id,
      campaignId: current.campaignId,
      organizationId: current.organizationId,
      entityId: current.entityId,
      entityName: publicEntityName(actor, entity),
      objective: current.objective,
      modality: current.modality,
      scheduledDate: current.scheduledDate,
      scheduledTime: current.scheduledTime,
      status: current.status,
      groupLabel: current.groupLabel,
      participantCount: current.participantCount,
      materialSummary: current.materialSummary,
      createdAt: current.createdAt.toISOString(),
    }));
    return;
  }
  const reschedule = input.action === "reschedule";
  if (reschedule && (!input.scheduledDate || !input.scheduledTime)) {
    fail(400, "Indica una fecha y hora nuevas para reprogramar.");
  }
  const scheduledDate = reschedule ? input.scheduledDate! : session.scheduledDate;
  const scheduledTime = reschedule ? input.scheduledTime! : session.scheduledTime;
  if (reschedule && (
    scheduledDate < campaign.startDate || scheduledDate > campaign.endDate ||
    scheduledDate < (entity.validFrom ?? "") || scheduledDate > (entity.validUntil ?? "")
  )) fail(400, "La nueva fecha debe estar dentro de la campaña y del acuerdo.");
  const targetStatus = input.action === "confirm" ? "confirmed"
    : input.action === "reschedule" ? "rescheduled"
      : input.action === "complete" ? "completed" : "cancelled";
  const allowed = input.action === "confirm"
    ? ["proposed", "rescheduled"].includes(session.status)
    : input.action === "reschedule"
      ? ["proposed", "confirmed", "rescheduled"].includes(session.status)
      : input.action === "complete"
        ? ["confirmed", "rescheduled"].includes(session.status)
        : ["proposed", "confirmed", "rescheduled"].includes(session.status);
  if (session.status === targetStatus &&
      session.scheduledDate === scheduledDate && session.scheduledTime === scheduledTime) {
    res.json(api.ActOnMentorSessionResponse.parse({
      id: session.id, campaignId: session.campaignId, organizationId: session.organizationId,
      entityId: session.entityId, entityName: publicEntityName(actor, entity), objective: session.objective,
      modality: session.modality, scheduledDate: session.scheduledDate, scheduledTime: session.scheduledTime,
      status: session.status, groupLabel: session.groupLabel, participantCount: session.participantCount,
      materialSummary: session.materialSummary, createdAt: session.createdAt.toISOString(),
    }));
    return;
  }
  if (!allowed) fail(409, "La sesión ya no admite esa transición.");
  rejectPersonalChannels(input.reason);
  if (reschedule) {
    const [conflict] = await db.select({ id: fpMentorSessions.id }).from(fpMentorSessions).where(and(
      eq(fpMentorSessions.tenantId, actor.tenantId),
      eq(fpMentorSessions.scheduledDate, scheduledDate),
      eq(fpMentorSessions.scheduledTime, scheduledTime),
      inArray(fpMentorSessions.status, ["proposed", "confirmed", "rescheduled"]),
      or(
        eq(fpMentorSessions.entityId, session.entityId),
        eq(fpMentorSessions.organizationId, session.organizationId),
      ),
    )).limit(1);
    if (conflict && conflict.id !== session.id) fail(409, "Ya existe una mentoría en esa franja horaria.");
  }
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(fpMentorSessions).set({
      status: targetStatus,
      scheduledDate,
      scheduledTime,
      updatedAt: new Date(),
    }).where(and(
      eq(fpMentorSessions.id, session.id),
      eq(fpMentorSessions.tenantId, actor.tenantId),
      eq(fpMentorSessions.status, session.status),
    )).returning();
    if (!rows.length) fail(409, "Otra persona actualizó la sesión; vuelve a cargarla.");
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: session.campaignId,
      organizationId: session.organizationId,
      resourceType: "session",
      resourceId: session.id,
      action: input.action,
      summary: `Sesión ${targetStatus} para ${scheduledDate} a las ${scheduledTime}.`,
      reason: input.reason,
    });
    return rows;
  });
  res.json(api.ActOnMentorSessionResponse.parse({
    id: updated.id, campaignId: updated.campaignId, organizationId: updated.organizationId,
    entityId: updated.entityId, entityName: publicEntityName(actor, entity), objective: updated.objective,
    modality: updated.modality, scheduledDate: updated.scheduledDate, scheduledTime: updated.scheduledTime,
    status: updated.status, groupLabel: updated.groupLabel, participantCount: updated.participantCount,
    materialSummary: updated.materialSummary, createdAt: updated.createdAt.toISOString(),
  }));
}));

router.post("/redfp360/mentorship/challenges", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isEducator(actor.role) && !["team_manager", "mentor", "promoter"].includes(actor.role)) {
    fail(403, "Este perfil no puede proponer retos profesionales.");
  }
  const parsed = api.CreateMentorChallengeBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los datos anonimizados del reto.");
  const input = parsed.data;
  const campaign = await requireCampaign(actor, input.campaignId);
  const entity = await requireEntity(actor, input.entityId, campaign);
  if (entity.agreementStatus !== "approved") fail(409, "No se pueden compartir retos sin un acuerdo aprobado.");
  if (input.organizationId && !campaign.participantOrganizationIds.includes(input.organizationId)) {
    fail(400, "El centro asignado no participa en esta campaña.");
  }
  if (actor.role === "team_manager" && input.organizationId !== actor.organizationId) {
    fail(403, "Solo puedes proponer retos para tu propia empresa.");
  }
  if (input.simulationEventId) {
    const [event] = await db.select().from(fpSimulationEvents).where(and(
      eq(fpSimulationEvents.id, input.simulationEventId),
      eq(fpSimulationEvents.tenantId, actor.tenantId),
      eq(fpSimulationEvents.campaignId, campaign.id),
    )).limit(1);
    if (!event) fail(400, "La actividad de simulación no pertenece a la campaña seleccionada.");
  }
  rejectPersonalChannels(input.title, input.sector);
  rejectSensitiveBusinessData(input.anonymizedSummary);
  const prior = await priorOperation(actor, input.operationId, input, "challenge");
  if (prior) {
    const [existing] = await db.select().from(fpMentorChallenges).where(eq(fpMentorChallenges.id, prior.resourceId)).limit(1);
    if (!existing) fail(409, "La operación anterior no tiene un reto recuperable.");
    res.status(200).json(api.CreateMentorChallengeResponse.parse({
      id: existing.id, campaignId: existing.campaignId, entityId: existing.entityId,
      entityName: publicEntityName(actor, entity), organizationId: existing.organizationId,
      simulationEventId: existing.simulationEventId, title: existing.title, sector: existing.sector,
      level: existing.level, anonymizedSummary: existing.anonymizedSummary,
      status: existing.status, createdAt: existing.createdAt.toISOString(),
    }));
    return;
  }
  const challenge = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpMentorChallenges).values({
      id: input.operationId,
      tenantId: actor.tenantId,
      campaignId: campaign.id,
      entityId: entity.id,
      organizationId: input.organizationId,
      simulationEventId: input.simulationEventId,
      title: input.title.trim(),
      sector: input.sector.trim(),
      level: input.level,
      anonymizedSummary: input.anonymizedSummary.trim(),
      status: "proposed",
      createdByUserId: actor.userId,
    }).returning();
    await appendAudit(tx, actor, {
      operationId: input.operationId, body: input, campaignId: campaign.id,
      organizationId: input.organizationId, resourceType: "challenge", resourceId: created.id,
      action: "proposed", summary: `Reto anonimizado propuesto: ${created.title}.`,
    });
    return created;
  });
  res.status(201).json(api.CreateMentorChallengeResponse.parse({
    id: challenge.id, campaignId: challenge.campaignId, entityId: challenge.entityId,
    entityName: publicEntityName(actor, entity), organizationId: challenge.organizationId,
    simulationEventId: challenge.simulationEventId, title: challenge.title, sector: challenge.sector,
    level: challenge.level, anonymizedSummary: challenge.anonymizedSummary,
    status: challenge.status, createdAt: challenge.createdAt.toISOString(),
  }));
}));

router.post("/redfp360/mentorship/challenges/:id/action", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isEducator(actor.role)) fail(403, "Solo el profesorado o administración puede validar y asignar retos.");
  const challengeId = param(req.params.id);
  const parsed = api.ActOnMentorChallengeBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa la acción y su motivo.");
  const input = parsed.data;
  const [challenge] = await db.select().from(fpMentorChallenges).where(and(
    eq(fpMentorChallenges.id, challengeId),
    eq(fpMentorChallenges.tenantId, actor.tenantId),
  )).limit(1);
  if (!challenge) fail(404, "No se encontró el reto.");
  const campaign = await requireCampaign(actor, challenge.campaignId);
  if (!canManageCampaign(actor, campaign)) fail(403, "Solo el centro responsable puede validar este reto.");
  const entity = await requireEntity(actor, challenge.entityId, campaign);
  const prior = await priorOperation(actor, input.operationId, input, "challenge");
  if (prior) {
    const [current] = await db.select().from(fpMentorChallenges).where(eq(fpMentorChallenges.id, challengeId)).limit(1);
    if (!current) fail(404, "No se encontró el reto.");
    res.json(api.ActOnMentorChallengeResponse.parse({
      id: current.id, campaignId: current.campaignId, entityId: current.entityId,
      entityName: publicEntityName(actor, entity), organizationId: current.organizationId,
      simulationEventId: current.simulationEventId, title: current.title, sector: current.sector,
      level: current.level, anonymizedSummary: current.anonymizedSummary,
      status: current.status, createdAt: current.createdAt.toISOString(),
    }));
    return;
  }
  let targetStatus: string;
  let targetOrganizationId = challenge.organizationId;
  if (input.action === "validate") {
    if (challenge.status !== "proposed" && challenge.status !== "returned") fail(409, "Solo se revisan retos propuestos o devueltos.");
    if (entity.agreementStatus !== "approved") fail(409, "El acuerdo de colaboración ya no está aprobado.");
    targetStatus = "validated";
  } else if (input.action === "return") {
    if (!["proposed", "validated"].includes(challenge.status)) fail(409, "Este reto no admite devolución.");
    targetStatus = "returned";
  } else if (input.action === "assign") {
    if (challenge.status !== "validated") fail(409, "Valida el reto antes de asignarlo.");
    if (!input.targetOrganizationId || !campaign.participantOrganizationIds.includes(input.targetOrganizationId)) {
      fail(400, "Asigna el reto a un centro participante.");
    }
    targetOrganizationId = input.targetOrganizationId;
    targetStatus = "assigned";
  } else {
    if (challenge.status !== "assigned") fail(409, "Solo se pueden cerrar retos asignados.");
    targetStatus = "closed";
  }
  rejectPersonalChannels(input.reason);
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(fpMentorChallenges).set({
      status: targetStatus,
      organizationId: targetOrganizationId,
      reviewedByUserId: actor.userId,
      updatedAt: new Date(),
    }).where(and(
      eq(fpMentorChallenges.id, challenge.id),
      eq(fpMentorChallenges.tenantId, actor.tenantId),
      eq(fpMentorChallenges.status, challenge.status),
    )).returning();
    if (!rows.length) fail(409, "Otra persona actualizó el reto; vuelve a cargarlo.");
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: challenge.campaignId,
      organizationId: targetOrganizationId,
      resourceType: "challenge",
      resourceId: challenge.id,
      action: input.action,
      summary: `Reto ${targetStatus}: ${challenge.title}.`,
      reason: input.reason,
    });
    return rows;
  });
  res.json(api.ActOnMentorChallengeResponse.parse({
    id: updated.id, campaignId: updated.campaignId, entityId: updated.entityId,
    entityName: publicEntityName(actor, entity), organizationId: updated.organizationId,
    simulationEventId: updated.simulationEventId, title: updated.title, sector: updated.sector,
    level: updated.level, anonymizedSummary: updated.anonymizedSummary,
    status: updated.status, createdAt: updated.createdAt.toISOString(),
  }));
}));

router.post("/redfp360/mentorship/reviews", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isExternalMentor(actor.role)) fail(403, "Solo el mentor asignado puede emitir la revisión profesional.");
  const parsed = api.CreateMentorReviewBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa la observación profesional.");
  const input = parsed.data;
  const [challenge] = await db.select().from(fpMentorChallenges).where(and(
    eq(fpMentorChallenges.id, input.challengeId),
    eq(fpMentorChallenges.tenantId, actor.tenantId),
  )).limit(1);
  if (!challenge || challenge.status !== "assigned") fail(404, "No se encontró un reto asignado para revisar.");
  const campaign = await requireCampaign(actor, challenge.campaignId);
  const entity = await requireEntity(actor, challenge.entityId, campaign);
  if (entity.linkedOrganizationId !== actor.organizationId || entity.agreementStatus !== "approved") {
    fail(403, "El reto no pertenece a una colaboración profesional activa de tu organización.");
  }
  rejectPersonalChannels(input.observation);
  rejectSensitiveBusinessData(input.observation);
  const prior = await priorOperation(actor, input.operationId, input, "review");
  if (prior) {
    const [existing] = await db.select().from(fpMentorReviews).where(eq(fpMentorReviews.id, prior.resourceId)).limit(1);
    if (!existing) fail(409, "La operación anterior no tiene una revisión recuperable.");
    res.status(200).json(api.CreateMentorReviewResponse.parse({
      id: existing.id, challengeId: existing.challengeId, entityId: existing.entityId,
      reviewerLabel: existing.reviewerLabel, decision: existing.decision,
      observation: existing.observation, createdAt: existing.createdAt.toISOString(),
    }));
    return;
  }
  const review = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpMentorReviews).values({
      id: input.operationId,
      tenantId: actor.tenantId,
      challengeId: challenge.id,
      entityId: entity.id,
      reviewerUserId: actor.userId,
      reviewerLabel: "Mentor asignado",
      decision: input.decision,
      observation: input.observation.trim(),
    }).returning();
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: campaign.id,
      organizationId: challenge.organizationId,
      resourceType: "review",
      resourceId: created.id,
      action: input.decision,
      summary: `Revisión profesional ${input.decision} del reto ${challenge.title}.`,
      reason: input.observation,
    });
    return created;
  });
  res.status(201).json(api.CreateMentorReviewResponse.parse({
    id: review.id, challengeId: review.challengeId, entityId: review.entityId,
    reviewerLabel: review.reviewerLabel, decision: review.decision,
    observation: review.observation, createdAt: review.createdAt.toISOString(),
  }));
}));

router.post("/redfp360/mentorship/evidence", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!["student", "team_manager", "teacher", "administrator", "mentor", "promoter"].includes(actor.role)) {
    fail(403, "Este perfil no puede registrar evidencias de participación.");
  }
  const parsed = api.CreateMentorEvidenceBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa la evidencia de participación.");
  const input = parsed.data;
  if (Boolean(input.sessionId) === Boolean(input.challengeId)) {
    fail(400, "Vincula la evidencia a una sesión o a un reto, no a ambos.");
  }
  const campaign = await requireCampaign(actor, input.campaignId);
  let organizationId: string | null = null;
  let entityId: string | null = null;
  if (input.sessionId) {
    const [session] = await db.select().from(fpMentorSessions).where(and(
      eq(fpMentorSessions.id, input.sessionId),
      eq(fpMentorSessions.tenantId, actor.tenantId),
      eq(fpMentorSessions.campaignId, campaign.id),
    )).limit(1);
    if (!session || session.status !== "completed") fail(409, "La evidencia de sesión requiere una mentoría completada.");
    organizationId = session.organizationId;
    entityId = session.entityId;
  } else if (input.challengeId) {
    const [challenge] = await db.select().from(fpMentorChallenges).where(and(
      eq(fpMentorChallenges.id, input.challengeId),
      eq(fpMentorChallenges.tenantId, actor.tenantId),
      eq(fpMentorChallenges.campaignId, campaign.id),
    )).limit(1);
    if (!challenge || !["assigned", "closed"].includes(challenge.status)) fail(409, "La evidencia de reto requiere un caso asignado.");
    organizationId = challenge.organizationId;
    entityId = challenge.entityId;
  }
  if (!organizationId || !entityId) fail(400, "No se pudo determinar el centro de la evidencia.");
  if (actor.role !== "administrator") {
    if (isExternalMentor(actor.role)) {
      const entity = await requireEntity(actor, entityId, campaign);
      if (entity.agreementStatus !== "approved") fail(403, "El acuerdo ya no está activo.");
    } else if (actor.organizationId !== organizationId &&
      !(actor.role === "teacher" && canManageCampaign(actor, campaign))) {
      fail(403, "La evidencia pertenece a otro centro.");
    }
  }
  if (input.simulatedDate < campaign.startDate || input.simulatedDate > campaign.endDate) {
    fail(400, "La fecha de evidencia debe estar dentro de la campaña.");
  }
  if (input.kind === "attendance_aggregate" && input.participantCount < 1) {
    fail(400, "Registra el número agregado de participantes.");
  }
  rejectPersonalChannels(input.summary);
  rejectSensitiveBusinessData(input.summary);
  if (isExternalMentor(actor.role) && input.documentId) {
    fail(403, "El mentor no puede consultar ni vincular documentos internos del alumnado.");
  }
  let documentReference: string | null = null;
  if (input.documentId) {
    const [document] = await db.select().from(fpDocuments).where(and(
      eq(fpDocuments.id, input.documentId),
      eq(fpDocuments.tenantId, actor.tenantId),
      eq(fpDocuments.organizationId, organizationId),
      eq(fpDocuments.isSynthetic, true),
      eq(fpDocuments.status, "confirmed"),
      eq(fpDocuments.visibility, "organization"),
      isNull(fpDocuments.archivedAt),
    )).limit(1);
    if (!document) fail(400, "El documento debe ser sintético, confirmado y visible para el mismo centro.");
    documentReference = document.documentRef;
  }
  const prior = await priorOperation(actor, input.operationId, input, "evidence");
  if (prior) {
    const [existing] = await db.select().from(fpMentorEvidence).where(eq(fpMentorEvidence.id, prior.resourceId)).limit(1);
    if (!existing) fail(409, "La operación anterior no tiene una evidencia recuperable.");
    res.status(200).json(api.CreateMentorEvidenceResponse.parse({
      id: existing.id, campaignId: existing.campaignId, sessionId: existing.sessionId,
      challengeId: existing.challengeId, kind: existing.kind, summary: existing.summary,
      participantCount: existing.participantCount,
      documentReference: existing.documentId ? documentReference : null,
      simulatedDate: existing.simulatedDate, createdAt: existing.createdAt.toISOString(),
    }));
    return;
  }
  const evidence = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpMentorEvidence).values({
      id: input.operationId,
      tenantId: actor.tenantId,
      campaignId: campaign.id,
      sessionId: input.sessionId,
      challengeId: input.challengeId,
      kind: input.kind,
      summary: input.summary.trim(),
      participantCount: input.participantCount,
      documentId: input.documentId,
      simulatedDate: input.simulatedDate,
      createdByUserId: actor.userId,
    }).returning();
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: campaign.id,
      organizationId,
      resourceType: "evidence",
      resourceId: created.id,
      action: "recorded",
      summary: `Evidencia de participación registrada: ${input.kind}.`,
    });
    return created;
  });
  res.status(201).json(api.CreateMentorEvidenceResponse.parse({
    id: evidence.id, campaignId: evidence.campaignId, sessionId: evidence.sessionId,
    challengeId: evidence.challengeId, kind: evidence.kind, summary: evidence.summary,
    participantCount: evidence.participantCount, documentReference,
    simulatedDate: evidence.simulatedDate, createdAt: evidence.createdAt.toISOString(),
  }));
}));

router.post("/redfp360/mentorship/recommendations", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isEducator(actor.role) && !isExternalMentor(actor.role)) {
    fail(403, "Este perfil no puede registrar recomendaciones profesionales.");
  }
  const parsed = api.CreateMentorRecommendationBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa el texto de la recomendación.");
  const input = parsed.data;
  const [review] = await db.select().from(fpMentorReviews).where(and(
    eq(fpMentorReviews.id, input.reviewId),
    eq(fpMentorReviews.tenantId, actor.tenantId),
  )).limit(1);
  if (!review) fail(404, "No se encontró la revisión profesional.");
  const [challenge] = await db.select().from(fpMentorChallenges).where(and(
    eq(fpMentorChallenges.id, review.challengeId),
    eq(fpMentorChallenges.tenantId, actor.tenantId),
  )).limit(1);
  if (!challenge) fail(404, "No se encontró el reto asociado.");
  const campaign = await requireCampaign(actor, challenge.campaignId);
  const entity = await requireEntity(actor, challenge.entityId, campaign);
  if (isExternalMentor(actor.role) && entity.linkedOrganizationId !== actor.organizationId) {
    fail(403, "La revisión no pertenece a tu colaboración asignada.");
  }
  if (isEducator(actor.role) && !canManageCampaign(actor, campaign)) {
    fail(403, "Solo el centro responsable puede gestionar esta transferencia.");
  }
  rejectPersonalChannels(input.text);
  rejectSensitiveBusinessData(input.text);
  const prior = await priorOperation(actor, input.operationId, input, "recommendation");
  if (prior) {
    const [existing] = await db.select().from(fpMentorRecommendations).where(eq(fpMentorRecommendations.id, prior.resourceId)).limit(1);
    if (!existing) fail(409, "La operación anterior no tiene una recomendación recuperable.");
    res.status(200).json(api.CreateMentorRecommendationResponse.parse({
      id: existing.id, reviewId: existing.reviewId, text: existing.text,
      status: existing.status, createdAt: existing.createdAt.toISOString(),
    }));
    return;
  }
  const recommendation = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpMentorRecommendations).values({
      id: input.operationId,
      tenantId: actor.tenantId,
      reviewId: review.id,
      text: input.text.trim(),
      status: "proposed",
      createdByUserId: actor.userId,
    }).returning();
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: campaign.id,
      organizationId: challenge.organizationId,
      resourceType: "recommendation",
      resourceId: created.id,
      action: "proposed",
      summary: "Recomendación profesional propuesta para transferencia.",
    });
    return created;
  });
  res.status(201).json(api.CreateMentorRecommendationResponse.parse({
    id: recommendation.id, reviewId: recommendation.reviewId, text: recommendation.text,
    status: recommendation.status, createdAt: recommendation.createdAt.toISOString(),
  }));
}));

router.put("/redfp360/mentorship/recommendations/:id", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isEducator(actor.role)) fail(403, "Solo el profesorado o administración puede registrar la implantación.");
  const recommendationId = param(req.params.id);
  const parsed = api.UpdateMentorRecommendationBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa el estado y el motivo de transferencia.");
  const input = parsed.data;
  const [recommendation] = await db.select().from(fpMentorRecommendations).where(and(
    eq(fpMentorRecommendations.id, recommendationId),
    eq(fpMentorRecommendations.tenantId, actor.tenantId),
  )).limit(1);
  if (!recommendation) fail(404, "No se encontró la recomendación.");
  const [review] = await db.select().from(fpMentorReviews).where(eq(fpMentorReviews.id, recommendation.reviewId)).limit(1);
  if (!review) fail(404, "No se encontró la revisión asociada.");
  const [challenge] = await db.select().from(fpMentorChallenges).where(eq(fpMentorChallenges.id, review.challengeId)).limit(1);
  if (!challenge) fail(404, "No se encontró el reto asociado.");
  const campaign = await requireCampaign(actor, challenge.campaignId);
  if (!canManageCampaign(actor, campaign)) fail(403, "Solo el centro responsable puede actualizar esta recomendación.");
  const prior = await priorOperation(actor, input.operationId, input, "recommendation");
  if (prior) {
    const [current] = await db.select().from(fpMentorRecommendations).where(eq(fpMentorRecommendations.id, recommendationId)).limit(1);
    if (!current) fail(404, "No se encontró la recomendación.");
    res.json(api.UpdateMentorRecommendationResponse.parse({
      id: current.id, reviewId: current.reviewId, text: current.text,
      status: current.status, createdAt: current.createdAt.toISOString(),
    }));
    return;
  }
  const allowed = recommendation.status === "proposed"
    ? ["accepted", "rejected"].includes(input.status)
    : recommendation.status === "accepted" && input.status === "implemented";
  if (!allowed && recommendation.status !== input.status) {
    fail(409, "La recomendación solo puede avanzar de propuesta a decisión y, si se acepta, a implantación.");
  }
  rejectPersonalChannels(input.reason);
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(fpMentorRecommendations).set({
      status: input.status,
      updatedAt: new Date(),
    }).where(and(
      eq(fpMentorRecommendations.id, recommendation.id),
      eq(fpMentorRecommendations.tenantId, actor.tenantId),
      eq(fpMentorRecommendations.status, recommendation.status),
    )).returning();
    if (!rows.length) fail(409, "Otra persona actualizó la recomendación; vuelve a cargarla.");
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: campaign.id,
      organizationId: challenge.organizationId,
      resourceType: "recommendation",
      resourceId: recommendation.id,
      action: input.status,
      summary: `Recomendación marcada como ${input.status}.`,
      reason: input.reason,
    });
    return rows;
  });
  res.json(api.UpdateMentorRecommendationResponse.parse({
    id: updated.id, reviewId: updated.reviewId, text: updated.text,
    status: updated.status, createdAt: updated.createdAt.toISOString(),
  }));
}));

const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (error instanceof MentorshipError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
};
router.use(errorHandler);

export default router;

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import * as api from "@workspace/api-zod";
import {
  db,
  fpCoordinationAudit,
  fpCoordinationCampaigns,
  fpCoordinationEvents,
  fpCoordinationIncidents,
  fpCoordinationParticipants,
  fpCoordinationTasks,
  fpCoordinationTransfers,
  fpDocuments,
  fpMentorSessions,
  fpOrganizations,
  fpSimulationCampaigns,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: Router = Router();
const contactPattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?34[\s.-]?)?[6789]\d{8}\b)/i;
const sensitiveIdPattern = /\b(?:ES\d{2}(?:[\s-]?\d{4}){5}[\s-]?\d{2}|\d{8}[A-Z])\b/i;
const activeEventStatuses = ["proposed", "confirmed", "rescheduled"];

type CenterRecord = {
  id: string;
  name: string;
  island: string;
  companyCount: number;
  organizationIds: string[];
};

type CampaignContext = {
  campaign: typeof fpCoordinationCampaigns.$inferSelect;
  participants: (typeof fpCoordinationParticipants.$inferSelect)[];
  ownCenterId: string | null;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

class CoordinationError extends Error {
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
  throw new CoordinationError(status, message);
}

function param(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) fail(400, "Falta un identificador válido.");
  return first;
}

function isCoordinator(actor: AuthContext): boolean {
  return actor.role === "administrator" || actor.role === "promoter";
}

function isEducator(actor: AuthContext): boolean {
  return actor.role === "teacher";
}

function actorLabel(actor: AuthContext): string {
  if (isCoordinator(actor)) return "Coordinación RED FP360";
  if (actor.role === "teacher") return "Equipo docente del centro";
  if (actor.role === "team_manager") return "Responsable de empresa simulada";
  return "Alumnado participante";
}

function rejectSensitiveText(...values: Array<string | null | undefined>): void {
  if (values.some((value) => value && (contactPattern.test(value) || sensitiveIdPattern.test(value)))) {
    fail(400, "No incluyas datos personales ni identificadores empresariales. Usa información didáctica y agregada.");
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateWithin(value: string, campaign: typeof fpCoordinationCampaigns.$inferSelect): boolean {
  return validDate(value) && value >= campaign.startDate && value <= campaign.endDate;
}

function centerKey(name: string, island: string): string {
  return `center_${Buffer.from(`${name.trim()}\u001f${island.trim()}`, "utf8").toString("base64url")}`;
}

async function getCenterDirectory(tenantId: string): Promise<CenterRecord[]> {
  const organizations = await db.select({
    id: fpOrganizations.id,
    center: fpOrganizations.center,
    island: fpOrganizations.island,
  }).from(fpOrganizations).where(and(
    eq(fpOrganizations.tenantId, tenantId),
    eq(fpOrganizations.isActive, true),
  )).orderBy(asc(fpOrganizations.center), asc(fpOrganizations.island), asc(fpOrganizations.id));
  const byKey = new Map<string, CenterRecord>();
  for (const organization of organizations) {
    const name = organization.center.trim();
    const island = organization.island.trim();
    if (!name || !island) continue;
    const id = centerKey(name, island);
    const existing = byKey.get(id);
    if (existing) {
      existing.companyCount += 1;
      existing.organizationIds.push(organization.id);
    } else {
      byKey.set(id, { id, name, island, companyCount: 1, organizationIds: [organization.id] });
    }
  }
  return [...byKey.values()];
}

function findCenter(centers: CenterRecord[], id: string | null | undefined): CenterRecord | undefined {
  return id ? centers.find((center) => center.id === id) : undefined;
}

function actorCenter(centers: CenterRecord[], actor: AuthContext): CenterRecord | null {
  if (!actor.organizationId) return null;
  return centers.find((center) => center.organizationIds.includes(actor.organizationId!)) ?? null;
}

function campaignCanBeManaged(actor: AuthContext, campaign: typeof fpCoordinationCampaigns.$inferSelect, ownCenterId: string | null): boolean {
  return isCoordinator(actor) || (actor.role === "teacher" && ownCenterId === campaign.ownerCenterId);
}

function participantActive(
  participant: typeof fpCoordinationParticipants.$inferSelect | undefined,
): boolean {
  return Boolean(participant && ["lead", "participant"].includes(participant.role) && participant.status === "approved");
}

async function requireCampaign(
  actor: AuthContext,
  campaignId: string,
  centers: CenterRecord[],
  options: { allowPendingForTeacher?: boolean; allowRecipientForTeacher?: boolean } = {},
): Promise<CampaignContext> {
  const [campaign] = await db.select().from(fpCoordinationCampaigns).where(and(
    eq(fpCoordinationCampaigns.id, campaignId),
    eq(fpCoordinationCampaigns.tenantId, actor.tenantId),
  )).limit(1);
  if (!campaign) fail(404, "No se encontró la campaña intercentros.");
  const participants = await db.select().from(fpCoordinationParticipants).where(and(
    eq(fpCoordinationParticipants.tenantId, actor.tenantId),
    eq(fpCoordinationParticipants.campaignId, campaign.id),
  ));
  const ownCenterId = actorCenter(centers, actor)?.id ?? null;
  const ownParticipant = participants.find((participant) => participant.centerId === ownCenterId);
  const pendingTeacher = actor.role === "teacher" && options.allowPendingForTeacher !== false &&
    ownParticipant?.status === "pending_approval";
  const recipientTeacher = actor.role === "teacher" && options.allowRecipientForTeacher === true &&
    ownParticipant?.role === "recipient" && ownParticipant.status === "invited";
  const visible = isCoordinator(actor) ||
    campaign.ownerCenterId === ownCenterId ||
    participantActive(ownParticipant) ||
    pendingTeacher ||
    recipientTeacher;
  if (!visible) fail(404, "No se encontró la campaña en el ámbito de tu centro.");
  return { campaign, participants, ownCenterId };
}

function requireActiveParticipant(
  campaign: CampaignContext,
  centerId: string,
): typeof fpCoordinationParticipants.$inferSelect {
  const participant = campaign.participants.find((row) => row.centerId === centerId);
  if (!participantActive(participant)) {
    fail(403, "El centro debe aprobar su participación antes de recibir tareas o convocatorias.");
  }
  return participant!;
}

function requireLocalCenter(
  actor: AuthContext,
  campaign: CampaignContext,
  targetCenterId: string,
  roles: AuthContext["role"][] = ["teacher"],
): void {
  if (isCoordinator(actor)) return;
  if (!roles.includes(actor.role)) fail(403, "Este perfil no puede realizar esta acción.");
  if (actor.role === "teacher" && campaign.campaign.ownerCenterId === campaign.ownCenterId) return;
  if (campaign.ownCenterId !== targetCenterId) fail(403, "La acción está fuera del ámbito de tu centro.");
}

function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}

async function priorOperation(
  actor: AuthContext,
  operationId: string,
  body: unknown,
  resourceType: string,
  resourceId?: string,
  scopeOptions: { allowPendingForTeacher?: boolean; allowRecipientForTeacher?: boolean } = {},
) {
  const [prior] = await db.select().from(fpCoordinationAudit).where(and(
    eq(fpCoordinationAudit.tenantId, actor.tenantId),
    eq(fpCoordinationAudit.operationId, operationId),
  )).limit(1);
  if (!prior) return null;
  if (prior.actorUserId !== actor.userId ||
      prior.actorRole !== actor.role ||
      prior.actorOrganizationId !== actor.organizationId ||
      prior.resourceType !== resourceType ||
      prior.fingerprint !== fingerprint(body) ||
      (resourceId !== undefined && prior.resourceId !== resourceId)) {
    fail(409, "Este identificador de operación ya se utilizó con otros datos.");
  }
  const centers = await getCenterDirectory(actor.tenantId);
  await requireCampaign(actor, prior.campaignId, centers, scopeOptions);
  return prior;
}

async function appendAudit(
  tx: Tx,
  actor: AuthContext,
  input: {
    operationId: string;
    body: unknown;
    campaignId: string;
    centerId?: string | null;
    resourceType: string;
    resourceId: string;
    action: string;
    summary: string;
  },
): Promise<void> {
  await tx.insert(fpCoordinationAudit).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    campaignId: input.campaignId,
    centerId: input.centerId === undefined ? null : input.centerId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action: input.action,
    actorUserId: actor.userId,
    actorOrganizationId: actor.organizationId,
    actorRole: actor.role,
    actorLabel: actorLabel(actor),
    operationId: input.operationId,
    fingerprint: fingerprint(input.body),
    summary: input.summary,
  });
}

function participantDto(row: typeof fpCoordinationParticipants.$inferSelect) {
  return {
    centerId: row.centerId,
    centerName: row.centerName,
    island: row.island,
    role: row.role,
    status: row.status,
    decisionNote: row.decisionNote,
  };
}

function campaignDto(
  row: typeof fpCoordinationCampaigns.$inferSelect,
  participants: (typeof fpCoordinationParticipants.$inferSelect)[],
) {
  return api.CreateCoordinationCampaignResponse.parse({
    id: row.id,
    title: row.title,
    objective: row.objective,
    ownerCenterId: row.ownerCenterId,
    ownerCenterName: row.ownerCenterName,
    ownerIsland: row.ownerIsland,
    simulationCampaignId: row.simulationCampaignId,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    resourcePlan: row.resourcePlan,
    participants: participants.filter((participant) => participant.campaignId === row.id).map(participantDto),
    createdAt: row.createdAt.toISOString(),
  });
}

async function getCampaignDto(actor: AuthContext, campaignId: string) {
  const [campaign] = await db.select().from(fpCoordinationCampaigns).where(and(
    eq(fpCoordinationCampaigns.id, campaignId),
    eq(fpCoordinationCampaigns.tenantId, actor.tenantId),
  )).limit(1);
  if (!campaign) fail(404, "No se encontró la campaña intercentros.");
  const participants = await db.select().from(fpCoordinationParticipants).where(and(
    eq(fpCoordinationParticipants.tenantId, actor.tenantId),
    eq(fpCoordinationParticipants.campaignId, campaignId),
  ));
  return campaignDto(campaign, participants);
}

function eventDto(row: typeof fpCoordinationEvents.$inferSelect) {
  return api.CreateCoordinationEventResponse.parse({
    id: row.id,
    campaignId: row.campaignId,
    centerIds: row.centerIds,
    title: row.title,
    eventType: row.eventType,
    startDate: row.startDate,
    startTime: row.startTime,
    endTime: row.endTime,
    modality: row.modality,
    summary: row.summary,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  });
}

async function taskDto(row: typeof fpCoordinationTasks.$inferSelect, actor: AuthContext, centers: CenterRecord[]) {
  let documentReference: string | null = null;
  if (row.documentId) {
    const [document] = await db.select({
      reference: fpDocuments.documentRef,
      organizationId: fpDocuments.organizationId,
      visibility: fpDocuments.visibility,
    }).from(fpDocuments).where(and(
      eq(fpDocuments.id, row.documentId),
      eq(fpDocuments.tenantId, actor.tenantId),
      eq(fpDocuments.isSynthetic, true),
      eq(fpDocuments.status, "confirmed"),
    )).limit(1);
    const documentCenter = document
      ? centers.find((center) => center.organizationIds.includes(document.organizationId))
      : undefined;
    const ownCenter = actorCenter(centers, actor);
    const canSeeDocument = Boolean(document && (
      isCoordinator(actor) ||
      document.organizationId === actor.organizationId ||
      (actor.role === "teacher" && documentCenter?.id === ownCenter?.id) ||
      document.visibility === "shared"
    ));
    documentReference = canSeeDocument ? document?.reference ?? null : null;
  }
  return api.CreateCoordinationTaskResponse.parse({
    id: row.id,
    campaignId: row.campaignId,
    centerId: row.centerId,
    centerName: row.centerName,
    title: row.title,
    description: row.description,
    department: row.department,
    responsibleRole: row.responsibleRole,
    dueDate: row.dueDate,
    status: row.status,
    evidenceSummary: row.evidenceSummary,
    documentId: row.documentId,
    documentReference,
    createdAt: row.createdAt.toISOString(),
  });
}

function incidentDto(row: typeof fpCoordinationIncidents.$inferSelect) {
  return api.CreateCoordinationIncidentResponse.parse({
    id: row.id,
    campaignId: row.campaignId,
    centerId: row.centerId,
    centerName: row.centerName,
    incidentType: row.incidentType,
    severity: row.severity,
    summary: row.summary,
    status: row.status,
    assignedCenterId: row.assignedCenterId,
    assignedCenterName: row.assignedCenterName,
    resolution: row.resolution,
    createdAt: row.createdAt.toISOString(),
  });
}

function transferDto(row: typeof fpCoordinationTransfers.$inferSelect) {
  return api.CreateCoordinationTransferResponse.parse({
    id: row.id,
    campaignId: row.campaignId,
    centerId: row.centerId,
    centerName: row.centerName,
    status: row.status,
    adoptionSummary: row.adoptionSummary,
    createdAt: row.createdAt.toISOString(),
  });
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

async function assertNoEventConflict(
  tenantId: string,
  centerIds: string[],
  date: string,
  startTime: string,
  endTime: string,
  excludedEventId?: string,
): Promise<void> {
  const rows = await db.select().from(fpCoordinationEvents).where(and(
    eq(fpCoordinationEvents.tenantId, tenantId),
    eq(fpCoordinationEvents.startDate, date),
    inArray(fpCoordinationEvents.status, activeEventStatuses),
  ));
  const conflict = rows.find((row) => row.id !== excludedEventId &&
    row.centerIds.some((centerId) => centerIds.includes(centerId)) &&
    overlaps(startTime, endTime, row.startTime, row.endTime));
  if (conflict) fail(409, "Hay una actividad confirmada o propuesta que se solapa en uno de los centros.");
}

async function validateDocument(
  actor: AuthContext,
  centerId: string,
  documentId: string | null,
  centers: CenterRecord[],
  allowShared: boolean,
) {
  if (!documentId) return null;
  const [document] = await db.select().from(fpDocuments).where(and(
    eq(fpDocuments.id, documentId),
    eq(fpDocuments.tenantId, actor.tenantId),
    eq(fpDocuments.isSynthetic, true),
    eq(fpDocuments.status, "confirmed"),
  )).limit(1);
  if (!document) fail(400, "Selecciona un documento de simulación confirmado.");
  const documentCenter = centers.find((center) => center.organizationIds.includes(document.organizationId));
  const sameOrganization = document.organizationId === actor.organizationId;
  const teacherOwnCenter = actor.role === "teacher" && documentCenter?.id === centerId;
  const sharedAcrossCenters = allowShared && document.visibility === "shared";
  const sharedWithinCenter = documentCenter?.id === centerId && document.visibility === "shared";
  if (!documentCenter || !(isCoordinator(actor) || sameOrganization || teacherOwnCenter || sharedAcrossCenters || sharedWithinCenter)) {
    fail(403, "El documento no está compartido con el centro asignado.");
  }
  return document;
}

async function readOverview(actor: AuthContext, requestedCampaignId?: string) {
  if (!["student", "team_manager", "teacher", "promoter", "administrator"].includes(actor.role)) {
    fail(403, "Este perfil no tiene acceso a Coordinación intercentros.");
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const ownCenter = actorCenter(centers, actor);
  if (!isCoordinator(actor) && !ownCenter) fail(403, "Asocia tu perfil a un centro activo para continuar.");
  const [campaignRows, participantRows] = await Promise.all([
    db.select().from(fpCoordinationCampaigns).where(eq(fpCoordinationCampaigns.tenantId, actor.tenantId)),
    db.select().from(fpCoordinationParticipants).where(eq(fpCoordinationParticipants.tenantId, actor.tenantId)),
  ]);
  let visibleCampaigns = campaignRows.filter((campaign) => {
    if (isCoordinator(actor) || campaign.ownerCenterId === ownCenter?.id) return true;
    const participant = participantRows.find((row) => row.campaignId === campaign.id && row.centerId === ownCenter?.id);
    return participantActive(participant) ||
      (actor.role === "teacher" && participant?.status === "pending_approval") ||
      (actor.role === "teacher" && participant?.role === "recipient" && participant.status === "invited");
  });
  if (requestedCampaignId) {
    visibleCampaigns = visibleCampaigns.filter((campaign) => campaign.id === requestedCampaignId);
    if (!visibleCampaigns.length) fail(404, "No se encontró la campaña en el ámbito de tu centro.");
  }
  const visibleCampaignIds = visibleCampaigns.map((campaign) => campaign.id);
  const campaignIdSet = new Set(visibleCampaignIds);
  const visibleParticipants = participantRows.filter((participant) => campaignIdSet.has(participant.campaignId));
  const ownCampaignIds = new Set(visibleCampaigns
    .filter((campaign) => actor.role === "teacher" && campaign.ownerCenterId === ownCenter?.id)
    .map((campaign) => campaign.id));
  const campaignById = new Map(visibleCampaigns.map((campaign) => [campaign.id, campaign]));
  const eventRows = visibleCampaignIds.length
    ? await db.select().from(fpCoordinationEvents).where(and(
      eq(fpCoordinationEvents.tenantId, actor.tenantId),
      inArray(fpCoordinationEvents.campaignId, visibleCampaignIds),
    )).orderBy(asc(fpCoordinationEvents.startDate), asc(fpCoordinationEvents.startTime))
    : [];
  const visibleEvents = eventRows.filter((event) =>
    isCoordinator(actor) ||
    ownCampaignIds.has(event.campaignId) ||
    Boolean(ownCenter && event.centerIds.includes(ownCenter.id)),
  );
  const taskRows = visibleCampaignIds.length
    ? await db.select().from(fpCoordinationTasks).where(and(
      eq(fpCoordinationTasks.tenantId, actor.tenantId),
      inArray(fpCoordinationTasks.campaignId, visibleCampaignIds),
    )).orderBy(asc(fpCoordinationTasks.dueDate), asc(fpCoordinationTasks.createdAt))
    : [];
  const visibleTasks = taskRows.filter((task) =>
    isCoordinator(actor) ||
    (actor.role === "teacher" && (ownCampaignIds.has(task.campaignId) || task.centerId === ownCenter?.id)) ||
    (actor.role === "team_manager" && task.centerId === ownCenter?.id) ||
    (actor.role === "student" && task.centerId === ownCenter?.id && task.responsibleRole === "student"),
  );
  const incidentRows = visibleCampaignIds.length
    ? await db.select().from(fpCoordinationIncidents).where(and(
      eq(fpCoordinationIncidents.tenantId, actor.tenantId),
      inArray(fpCoordinationIncidents.campaignId, visibleCampaignIds),
    )).orderBy(asc(fpCoordinationIncidents.createdAt))
    : [];
  const visibleIncidents = incidentRows.filter((incident) =>
    isCoordinator(actor) ||
    (actor.role === "teacher" && (ownCampaignIds.has(incident.campaignId) ||
      incident.centerId === ownCenter?.id || incident.assignedCenterId === ownCenter?.id)) ||
    (actor.role === "team_manager" && incident.centerId === ownCenter?.id),
  );
  const transferRows = visibleCampaignIds.length
    ? await db.select().from(fpCoordinationTransfers).where(and(
      eq(fpCoordinationTransfers.tenantId, actor.tenantId),
      inArray(fpCoordinationTransfers.campaignId, visibleCampaignIds),
    )).orderBy(asc(fpCoordinationTransfers.createdAt))
    : [];
  const visibleTransfers = transferRows.filter((transfer) =>
    isCoordinator(actor) ||
    (actor.role === "teacher" && (ownCampaignIds.has(transfer.campaignId) || transfer.centerId === ownCenter?.id)) ||
    (["student", "team_manager"].includes(actor.role) && transfer.centerId === ownCenter?.id),
  );
  const auditRows = visibleCampaignIds.length
    ? await db.select().from(fpCoordinationAudit).where(and(
      eq(fpCoordinationAudit.tenantId, actor.tenantId),
      inArray(fpCoordinationAudit.campaignId, visibleCampaignIds),
    )).orderBy(asc(fpCoordinationAudit.createdAt))
    : [];
  const visibleAudit = auditRows.filter((audit) =>
    isCoordinator(actor) ||
    (actor.role === "teacher" && (ownCampaignIds.has(audit.campaignId) || audit.centerId === ownCenter?.id)) ||
    (actor.role === "team_manager" && audit.centerId === ownCenter?.id) ||
    (actor.role === "student" && audit.centerId === ownCenter?.id && audit.actorUserId === actor.userId),
  );
  const visibleCenterIds = new Set<string>([
    ...(ownCenter ? [ownCenter.id] : []),
    ...visibleParticipants.map((participant) => participant.centerId),
  ]);
  const visibleCenters = isCoordinator(actor)
    ? centers
    : centers.filter((center) => visibleCenterIds.has(center.id));
  const centerNames = new Map<string, string>();
  centers.forEach((center) => centerNames.set(center.id, center.name));
  visibleParticipants.forEach((participant) => centerNames.set(participant.centerId, participant.centerName));

  const documentRows = await db.select().from(fpDocuments).where(and(
    eq(fpDocuments.tenantId, actor.tenantId),
    eq(fpDocuments.isSynthetic, true),
    eq(fpDocuments.status, "confirmed"),
  ));
  const allowedOrganizationIds = new Set(visibleCenters.flatMap((center) => center.organizationIds));
  const eligibleDocuments = documentRows.filter((document) => {
    const documentCenter = centers.find((center) => center.organizationIds.includes(document.organizationId));
    if (!documentCenter) return false;
    if (isCoordinator(actor)) return true;
    if (actor.role === "teacher" && documentCenter.id === ownCenter?.id) return true;
    if (document.organizationId === actor.organizationId) return true;
    const sharedInOwnCenter = document.visibility === "shared" && documentCenter.id === ownCenter?.id;
    const sharedForLedCampaign = actor.role === "teacher" && ownCampaignIds.size > 0 &&
      document.visibility === "shared" && visibleCenterIds.has(documentCenter.id);
    return (sharedInOwnCenter || sharedForLedCampaign) &&
      allowedOrganizationIds.has(document.organizationId);
  });
  const documentById = new Map(eligibleDocuments.map((document) => [document.id, document]));
  const simulationCampaignIds = visibleCampaigns
    .map((campaign) => campaign.simulationCampaignId)
    .filter((id): id is string => Boolean(id));
  const mentorshipSessions = simulationCampaignIds.length
    ? await db.select({ id: fpMentorSessions.id }).from(fpMentorSessions).where(and(
      eq(fpMentorSessions.tenantId, actor.tenantId),
      inArray(fpMentorSessions.campaignId, simulationCampaignIds),
    ))
    : [];
  const activeCenters = new Set(visibleParticipants
    .filter((participant) => ["lead", "participant"].includes(participant.role) && participant.status === "approved")
    .map((participant) => participant.centerId));
  const recipientCenters = new Set(visibleParticipants
    .filter((participant) => participant.role === "recipient")
    .map((participant) => participant.centerId));
  const ownedCenterNames = new Map(centers.map((center) => [center.id, center.name]));
  const response = {
    currentCenterId: ownCenter?.id ?? null,
    centers: visibleCenters.map(({ id, name, island, companyCount }) => ({ id, name, island, companyCount })),
    availableCenters: (isCoordinator(actor) || actor.role === "teacher"
      ? centers
      : centers.filter((center) => center.id === ownCenter?.id))
      .map(({ id, name, island, companyCount }) => ({ id, name, island, companyCount })),
    campaigns: visibleCampaigns.map((campaign) => campaignDto(
      campaign,
      visibleParticipants.filter((participant) => participant.campaignId === campaign.id),
    )),
    events: visibleEvents.map(eventDto),
    tasks: visibleTasks.map((task) => ({
      id: task.id,
      campaignId: task.campaignId,
      centerId: task.centerId,
      centerName: task.centerName,
      title: task.title,
      description: task.description,
      department: task.department,
      responsibleRole: task.responsibleRole,
      dueDate: task.dueDate,
      status: task.status,
      evidenceSummary: task.evidenceSummary,
      documentId: task.documentId,
      documentReference: task.documentId ? documentById.get(task.documentId)?.documentRef ?? null : null,
      createdAt: task.createdAt.toISOString(),
    })),
    incidents: visibleIncidents.map(incidentDto),
    transfers: visibleTransfers.map(transferDto),
    documents: eligibleDocuments.map((document) => ({
      id: document.id,
      reference: document.documentRef,
      title: document.title,
      organizationId: document.organizationId,
    })),
    audit: visibleAudit.map((audit) => ({
      id: audit.id,
      campaignId: audit.campaignId,
      centerName: audit.centerId ? centerNames.get(audit.centerId) ?? null : null,
      resourceType: audit.resourceType,
      resourceId: audit.resourceId,
      action: audit.action,
      actorLabel: audit.actorLabel,
      summary: audit.summary,
      createdAt: audit.createdAt.toISOString(),
    })),
    impact: {
      centersActive: activeCenters.size,
      recipients: recipientCenters.size,
      eventsPlanned: visibleEvents.filter((event) => activeEventStatuses.includes(event.status)).length,
      tasksOpen: visibleTasks.filter((task) => ["open", "in_progress", "blocked"].includes(task.status)).length,
      tasksCompleted: visibleTasks.filter((task) => task.status === "completed").length,
      incidentsOpen: visibleIncidents.filter((incident) => incident.status !== "resolved").length,
      incidentsResolved: visibleIncidents.filter((incident) => incident.status === "resolved").length,
      adoptions: visibleTransfers.filter((transfer) => transfer.status === "adopted").length,
      mentorshipSessions: mentorshipSessions.length,
    },
    capabilities: {
      isGlobalCoordinator: isCoordinator(actor),
      canCreateCampaign: isCoordinator(actor) || (actor.role === "teacher" && Boolean(ownCenter)),
      canApproveCenter: isCoordinator(actor) || (actor.role === "teacher" && Boolean(ownCenter)),
      canSchedule: isCoordinator(actor) || actor.role === "teacher" || actor.role === "team_manager",
      canManageTasks: isCoordinator(actor) || actor.role === "teacher" || actor.role === "team_manager",
      canUpdateTasks: isCoordinator(actor) || ["teacher", "team_manager", "student"].includes(actor.role),
      canReportIncident: isCoordinator(actor) || ["teacher", "team_manager"].includes(actor.role),
      canMediate: isCoordinator(actor) || actor.role === "teacher",
      canManageTransfer: isCoordinator(actor) || actor.role === "teacher",
      canViewAudit: isCoordinator(actor) || actor.role === "teacher",
    },
  };
  return api.GetCoordinationOverviewResponse.parse(response);
}

router.use("/redfp360/intercenter", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/intercenter/overview", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const query = api.GetCoordinationOverviewQueryParams.parse({
    campaignId: typeof req.query.campaignId === "string" ? req.query.campaignId : undefined,
  });
  res.json(await readOverview(actor, query.campaignId));
}));

router.post("/redfp360/intercenter/campaigns", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const input = api.CreateCoordinationCampaignBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "campaign");
  if (prior) {
    res.status(200).json(await getCampaignDto(actor, prior.resourceId));
    return;
  }
  if (!isCoordinator(actor) && actor.role !== "teacher") {
    fail(403, "Solo coordinación o profesorado puede proponer campañas intercentros.");
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const ownCenter = actorCenter(centers, actor);
  const ownerCenter = findCenter(centers, input.ownerCenterId);
  if (!ownerCenter) fail(400, "Selecciona un centro activo de la red.");
  if (actor.role === "teacher" && (!ownCenter || ownerCenter.id !== ownCenter.id)) {
    fail(403, "El profesorado solo puede proponer campañas para su centro.");
  }
  if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate > input.endDate) {
    fail(400, "Revisa el intervalo de fechas simuladas de la campaña.");
  }
  rejectSensitiveText(input.title, input.objective, input.resourcePlan);
  const seen = new Set<string>([ownerCenter.id]);
  const invited = input.centers.map((item) => {
    if (seen.has(item.centerId)) fail(400, "Cada centro debe aparecer una sola vez en la campaña.");
    seen.add(item.centerId);
    const center = findCenter(centers, item.centerId);
    if (!center) fail(400, "Uno de los centros seleccionados ya no está activo.");
    return { center, role: item.role };
  });
  if (input.simulationCampaignId) {
    const [simulationCampaign] = await db.select().from(fpSimulationCampaigns).where(and(
      eq(fpSimulationCampaigns.id, input.simulationCampaignId),
      eq(fpSimulationCampaigns.tenantId, actor.tenantId),
    )).limit(1);
    if (!simulationCampaign) fail(400, "La campaña de FP360 SIM vinculada no existe en este espacio.");
    const allowedCenters = new Set([ownerCenter.id, ...invited.map(({ center }) => center.id)]);
    const involvedOrganizationIds = new Set([simulationCampaign.ownerOrganizationId, ...simulationCampaign.participantOrganizationIds]);
    for (const organizationId of involvedOrganizationIds) {
      const organizationCenter = centers.find((center) => center.organizationIds.includes(organizationId));
      if (!organizationCenter || !allowedCenters.has(organizationCenter.id)) {
        fail(400, "Los centros de la campaña vinculada deben coincidir con los centros intercentros seleccionados.");
      }
    }
  }
  const campaignId = input.operationId;
  await db.transaction(async (tx) => {
    await tx.insert(fpCoordinationCampaigns).values({
      id: campaignId,
      tenantId: actor.tenantId,
      ownerCenterId: ownerCenter.id,
      ownerCenterName: ownerCenter.name,
      ownerIsland: ownerCenter.island,
      title: input.title.trim(),
      objective: input.objective.trim(),
      resourcePlan: input.resourcePlan.trim(),
      simulationCampaignId: input.simulationCampaignId,
      startDate: input.startDate,
      endDate: input.endDate,
      status: "pending_approval",
      operationId: input.operationId,
      createdByUserId: actor.userId,
    });
    await tx.insert(fpCoordinationParticipants).values([
      {
        id: randomUUID(),
        tenantId: actor.tenantId,
        campaignId,
        centerId: ownerCenter.id,
        centerName: ownerCenter.name,
        island: ownerCenter.island,
        role: "lead",
        status: "approved",
        approvedByUserId: actor.userId,
        approvedAt: new Date(),
      },
      ...invited.map(({ center, role }) => ({
        id: randomUUID(),
        tenantId: actor.tenantId,
        campaignId,
        centerId: center.id,
        centerName: center.name,
        island: center.island,
        role,
        status: role === "recipient" ? "invited" : "pending_approval",
      })),
    ]);
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId,
      centerId: ownerCenter.id,
      resourceType: "campaign",
      resourceId: campaignId,
      action: "proposed",
      summary: `Campaña propuesta para ${invited.length + 1} centros; los destinatarios de difusión quedan separados de los participantes.`,
    });
  });
  res.status(201).json(await getCampaignDto(actor, campaignId));
}));

router.post("/redfp360/intercenter/campaigns/:id/action", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const id = param(req.params.id);
  const input = api.ActOnCoordinationCampaignBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "campaign", id);
  if (prior) {
    res.json(await getCampaignDto(actor, id));
    return;
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const context = await requireCampaign(actor, id, centers);
  if (!campaignCanBeManaged(actor, context.campaign, context.ownCenterId)) {
    fail(403, "Solo el centro líder o coordinación puede cambiar el estado de campaña.");
  }
  const current = context.campaign.status;
  let next: string;
  if (input.action === "activate") {
    const pending = context.participants.some((participant) =>
      ["lead", "participant"].includes(participant.role) && participant.status !== "approved");
    if (pending || !["pending_approval", "paused"].includes(current)) {
      fail(409, "Aprueba todos los centros participantes antes de activar la campaña.");
    }
    next = "active";
  } else if (input.action === "pause") {
    if (current !== "active") fail(409, "Solo una campaña activa puede pausarse.");
    next = "paused";
  } else {
    if (current === "closed") fail(409, "La campaña ya está cerrada.");
    next = "closed";
  }
  await db.transaction(async (tx) => {
    await tx.update(fpCoordinationCampaigns).set({ status: next }).where(and(
      eq(fpCoordinationCampaigns.id, id),
      eq(fpCoordinationCampaigns.tenantId, actor.tenantId),
    ));
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: id,
      centerId: context.campaign.ownerCenterId,
      resourceType: "campaign",
      resourceId: id,
      action: input.action,
      summary: input.reason.trim(),
    });
  });
  res.json(await getCampaignDto(actor, id));
}));

router.post("/redfp360/intercenter/campaigns/:id/centers/:centerId/action", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const id = param(req.params.id);
  const centerId = param(req.params.centerId);
  const input = api.ActOnCoordinationParticipationBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "participation", `${id}:${centerId}`, {
    allowRecipientForTeacher: true,
  });
  if (prior) {
    const [row] = await db.select().from(fpCoordinationParticipants).where(and(
      eq(fpCoordinationParticipants.tenantId, actor.tenantId),
      eq(fpCoordinationParticipants.campaignId, id),
      eq(fpCoordinationParticipants.centerId, centerId),
    )).limit(1);
    if (!row) fail(404, "No se encontró la participación.");
    res.json(api.ActOnCoordinationParticipationResponse.parse(participantDto(row)));
    return;
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const context = await requireCampaign(actor, id, centers, { allowPendingForTeacher: true, allowRecipientForTeacher: true });
  const participant = context.participants.find((row) => row.centerId === centerId);
  if (!participant) fail(404, "No se encontró la participación del centro.");
  const localDecision = actor.role === "teacher" && context.ownCenterId === centerId;
  const ownerWithdrawal = actor.role === "teacher" && context.ownCenterId === context.campaign.ownerCenterId;
  if (input.action === "withdraw") {
    if (!isCoordinator(actor) && !localDecision && !ownerWithdrawal) fail(403, "Solo el centro o coordinación puede retirar esta participación.");
  } else if (!isCoordinator(actor) && !localDecision) {
    fail(403, "Solo la persona docente responsable del centro puede responder a la invitación.");
  }
  if (centerId === context.campaign.ownerCenterId || context.campaign.status === "closed") {
    fail(409, "El centro líder no puede retirarse desde esta acción y la campaña debe seguir abierta.");
  }
  let status: string;
  if (input.action === "approve" || input.action === "reject") {
    if (participant.role !== "participant" || participant.status !== "pending_approval") {
      fail(409, "Solo se pueden aprobar invitaciones de participación pendientes.");
    }
    status = input.action === "approve" ? "approved" : "rejected";
  } else {
    if (["withdrawn"].includes(participant.status)) fail(409, "La participación ya se retiró.");
    status = "withdrawn";
  }
  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.update(fpCoordinationParticipants).set({
      status,
      decisionNote: input.note.trim(),
      approvedByUserId: status === "approved" ? actor.userId : participant.approvedByUserId,
      approvedAt: status === "approved" ? updatedAt : participant.approvedAt,
    }).where(and(
      eq(fpCoordinationParticipants.tenantId, actor.tenantId),
      eq(fpCoordinationParticipants.campaignId, id),
      eq(fpCoordinationParticipants.centerId, centerId),
    ));
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: id,
      centerId,
      resourceType: "participation",
      resourceId: `${id}:${centerId}`,
      action: input.action,
      summary: input.note.trim(),
    });
  });
  const [row] = await db.select().from(fpCoordinationParticipants).where(and(
    eq(fpCoordinationParticipants.tenantId, actor.tenantId),
    eq(fpCoordinationParticipants.campaignId, id),
    eq(fpCoordinationParticipants.centerId, centerId),
  )).limit(1);
  res.json(api.ActOnCoordinationParticipationResponse.parse(participantDto(row)));
}));

router.post("/redfp360/intercenter/events", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const input = api.CreateCoordinationEventBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "event");
  if (prior) {
    const [row] = await db.select().from(fpCoordinationEvents).where(and(
      eq(fpCoordinationEvents.id, prior.resourceId),
      eq(fpCoordinationEvents.tenantId, actor.tenantId),
    )).limit(1);
    if (!row) fail(404, "No se encontró el evento.");
    res.json(eventDto(row));
    return;
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const context = await requireCampaign(actor, input.campaignId, centers);
  if (context.campaign.status !== "active") fail(409, "La campaña debe estar activa para programar actividades.");
  if (!["teacher", "team_manager"].includes(actor.role) && !isCoordinator(actor)) {
    fail(403, "Este perfil no puede programar actividades.");
  }
  const selectedCenters = [...new Set(input.centerIds)];
  if (selectedCenters.length !== input.centerIds.length) fail(400, "No repitas centros en una misma actividad.");
  for (const centerId of selectedCenters) requireActiveParticipant(context, centerId);
  if (!isCoordinator(actor) && !(actor.role === "teacher" && context.campaign.ownerCenterId === context.ownCenterId) &&
      (selectedCenters.length !== 1 || selectedCenters[0] !== context.ownCenterId)) {
    fail(403, "Solo el centro líder puede convocar a varios centros.");
  }
  if (actor.role === "team_manager" && (selectedCenters.length !== 1 || selectedCenters[0] !== context.ownCenterId)) {
    fail(403, "La organización solo puede programar actividades de su propio centro.");
  }
  if (!dateWithin(input.startDate, context.campaign) || input.endTime <= input.startTime) {
    fail(400, "La fecha debe estar dentro de la campaña y la hora final debe ser posterior.");
  }
  rejectSensitiveText(input.title, input.summary);
  await assertNoEventConflict(actor.tenantId, selectedCenters, input.startDate, input.startTime, input.endTime);
  const rowId = input.operationId;
  await db.transaction(async (tx) => {
    await tx.insert(fpCoordinationEvents).values({
      id: rowId,
      tenantId: actor.tenantId,
      campaignId: context.campaign.id,
      centerIds: selectedCenters,
      title: input.title.trim(),
      eventType: input.eventType,
      startDate: input.startDate,
      startTime: input.startTime,
      endTime: input.endTime,
      modality: input.modality,
      summary: input.summary.trim(),
      status: "proposed",
      createdByUserId: actor.userId,
      operationId: input.operationId,
    });
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: context.campaign.id,
      centerId: context.ownCenterId,
      resourceType: "event",
      resourceId: rowId,
      action: "proposed",
      summary: input.title.trim(),
    });
  });
  const [row] = await db.select().from(fpCoordinationEvents).where(eq(fpCoordinationEvents.id, rowId)).limit(1);
  res.status(201).json(eventDto(row));
}));

router.post("/redfp360/intercenter/events/:id/action", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const id = param(req.params.id);
  const input = api.ActOnCoordinationEventBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "event", id);
  if (prior) {
    const [row] = await db.select().from(fpCoordinationEvents).where(and(
      eq(fpCoordinationEvents.id, id),
      eq(fpCoordinationEvents.tenantId, actor.tenantId),
    )).limit(1);
    if (!row) fail(404, "No se encontró el evento.");
    res.json(eventDto(row));
    return;
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const [event] = await db.select().from(fpCoordinationEvents).where(and(
    eq(fpCoordinationEvents.id, id),
    eq(fpCoordinationEvents.tenantId, actor.tenantId),
  )).limit(1);
  if (!event) fail(404, "No se encontró la actividad compartida.");
  const context = await requireCampaign(actor, event.campaignId, centers);
  if (!["teacher", "team_manager"].includes(actor.role) && !isCoordinator(actor)) {
    fail(403, "Este perfil no puede modificar actividades.");
  }
  const local = event.centerIds.includes(context.ownCenterId ?? "");
  if (!isCoordinator(actor) && !(actor.role === "teacher" && context.campaign.ownerCenterId === context.ownCenterId) && !local) {
    fail(403, "La actividad está fuera del ámbito de tu centro.");
  }
  if (actor.role === "team_manager" && !local) fail(403, "La actividad no pertenece a tu centro.");
  let status = event.status;
  let startDate = event.startDate;
  let startTime = event.startTime;
  let endTime = event.endTime;
  if (input.action === "confirm") {
    if (!["proposed", "rescheduled"].includes(status)) fail(409, "Solo se pueden confirmar propuestas pendientes.");
    status = "confirmed";
  } else if (input.action === "reschedule") {
    if (!["proposed", "confirmed", "rescheduled"].includes(status)) fail(409, "La actividad ya no se puede reprogramar.");
    if (!["teacher", "administrator", "promoter"].includes(actor.role)) fail(403, "Solo el profesorado o coordinación puede reprogramar.");
    if (!input.startDate || !input.startTime || !input.endTime ||
        !dateWithin(input.startDate, context.campaign) || input.endTime <= input.startTime) {
      fail(400, "Indica una fecha simulada y un intervalo horario válidos.");
    }
    await assertNoEventConflict(actor.tenantId, event.centerIds, input.startDate, input.startTime, input.endTime, event.id);
    startDate = input.startDate;
    startTime = input.startTime;
    endTime = input.endTime;
    status = "rescheduled";
  } else if (input.action === "complete") {
    if (status !== "confirmed") fail(409, "Confirma la actividad antes de cerrarla.");
    status = "completed";
  } else {
    if (["completed", "cancelled"].includes(status)) fail(409, "La actividad ya está cerrada.");
    if (!["teacher", "administrator", "promoter"].includes(actor.role)) fail(403, "Solo el profesorado o coordinación puede cancelar.");
    status = "cancelled";
  }
  await db.transaction(async (tx) => {
    await tx.update(fpCoordinationEvents).set({ status, startDate, startTime, endTime }).where(and(
      eq(fpCoordinationEvents.id, id),
      eq(fpCoordinationEvents.tenantId, actor.tenantId),
    ));
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: event.campaignId,
      centerId: context.ownCenterId,
      resourceType: "event",
      resourceId: id,
      action: input.action,
      summary: input.reason.trim(),
    });
  });
  const [row] = await db.select().from(fpCoordinationEvents).where(eq(fpCoordinationEvents.id, id)).limit(1);
  res.json(eventDto(row));
}));

router.post("/redfp360/intercenter/tasks", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const input = api.CreateCoordinationTaskBody.parse(req.body);
  const centers = await getCenterDirectory(actor.tenantId);
  const prior = await priorOperation(actor, input.operationId, input, "task");
  if (prior) {
    const [row] = await db.select().from(fpCoordinationTasks).where(and(
      eq(fpCoordinationTasks.id, prior.resourceId),
      eq(fpCoordinationTasks.tenantId, actor.tenantId),
    )).limit(1);
    if (!row) fail(404, "No se encontró la tarea.");
    res.json(await taskDto(row, actor, centers));
    return;
  }
  const context = await requireCampaign(actor, input.campaignId, centers);
  if (context.campaign.status !== "active") fail(409, "La campaña debe estar activa para crear tareas.");
  if (!["teacher", "team_manager"].includes(actor.role) && !isCoordinator(actor)) {
    fail(403, "Este perfil no puede crear tareas.");
  }
  const participant = requireActiveParticipant(context, input.centerId);
  if (actor.role === "team_manager" && input.centerId !== context.ownCenterId) {
    fail(403, "Solo puedes crear tareas de tu centro.");
  }
  if (actor.role === "teacher" && input.centerId !== context.ownCenterId &&
      context.campaign.ownerCenterId !== context.ownCenterId) {
    fail(403, "Solo el centro líder puede asignar tareas a otro centro.");
  }
  if (!dateWithin(input.dueDate, context.campaign)) fail(400, "La fecha límite debe estar dentro del periodo simulado.");
  rejectSensitiveText(input.title, input.description, input.department);
  const rowId = input.operationId;
  await db.transaction(async (tx) => {
    await tx.insert(fpCoordinationTasks).values({
      id: rowId,
      tenantId: actor.tenantId,
      campaignId: context.campaign.id,
      centerId: participant.centerId,
      centerName: participant.centerName,
      title: input.title.trim(),
      description: input.description.trim(),
      department: input.department.trim(),
      responsibleRole: input.responsibleRole,
      dueDate: input.dueDate,
      status: "open",
      evidenceSummary: "",
      documentId: null,
      createdByUserId: actor.userId,
      operationId: input.operationId,
    });
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: context.campaign.id,
      centerId: participant.centerId,
      resourceType: "task",
      resourceId: rowId,
      action: "created",
      summary: input.title.trim(),
    });
  });
  const [row] = await db.select().from(fpCoordinationTasks).where(eq(fpCoordinationTasks.id, rowId)).limit(1);
  res.status(201).json(await taskDto(row, actor, centers));
}));

router.post("/redfp360/intercenter/tasks/:id/action", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const id = param(req.params.id);
  const input = api.ActOnCoordinationTaskBody.parse(req.body);
  const centers = await getCenterDirectory(actor.tenantId);
  const prior = await priorOperation(actor, input.operationId, input, "task", id);
  if (prior) {
    const [row] = await db.select().from(fpCoordinationTasks).where(and(
      eq(fpCoordinationTasks.id, id),
      eq(fpCoordinationTasks.tenantId, actor.tenantId),
    )).limit(1);
    if (!row) fail(404, "No se encontró la tarea.");
    res.json(await taskDto(row, actor, centers));
    return;
  }
  const [task] = await db.select().from(fpCoordinationTasks).where(and(
    eq(fpCoordinationTasks.id, id),
    eq(fpCoordinationTasks.tenantId, actor.tenantId),
  )).limit(1);
  if (!task) fail(404, "No se encontró la tarea.");
  const context = await requireCampaign(actor, task.campaignId, centers);
  const canAccess = isCoordinator(actor) ||
    (actor.role === "teacher" && (task.centerId === context.ownCenterId || context.campaign.ownerCenterId === context.ownCenterId)) ||
    (actor.role === "team_manager" && task.centerId === context.ownCenterId) ||
    (actor.role === "student" && task.centerId === context.ownCenterId && task.responsibleRole === "student");
  if (!canAccess) fail(403, "La tarea está fuera del ámbito de tu centro o responsabilidad.");
  if (context.campaign.status === "closed" && input.action !== "comment") fail(409, "La campaña cerrada conserva el historial y no admite cambios.");
  const privileged = isCoordinator(actor) || actor.role === "teacher";
  if (["cancel", "reassign"].includes(input.action) && !privileged) fail(403, "Solo profesorado o coordinación puede retirar o reasignar tareas.");
  if (input.action === "reassign" && !campaignCanBeManaged(actor, context.campaign, context.ownCenterId)) {
    fail(403, "Solo el centro líder o coordinación puede reasignar tareas entre centros.");
  }
  if (actor.role === "student" && !["start", "complete", "comment"].includes(input.action)) {
    fail(403, "El alumnado solo puede avanzar tareas asignadas a su perfil.");
  }
  if (actor.role === "team_manager" && !["start", "block", "complete", "comment"].includes(input.action)) {
    fail(403, "La responsabilidad de la empresa simulada no permite esta transición.");
  }
  rejectSensitiveText(input.note, input.evidenceSummary);
  let status = task.status;
  let centerId = task.centerId;
  let centerName = task.centerName;
  let evidenceSummary = task.evidenceSummary;
  let documentId = task.documentId;
  if (input.action === "start") {
    if (status !== "open") fail(409, "Solo se pueden iniciar tareas abiertas.");
    status = "in_progress";
  } else if (input.action === "block") {
    if (!["open", "in_progress"].includes(status)) fail(409, "Solo se pueden bloquear tareas abiertas o en curso.");
    status = "blocked";
  } else if (input.action === "complete") {
    if (!["open", "in_progress", "blocked"].includes(status)) fail(409, "La tarea ya está cerrada.");
    if (!input.evidenceSummary?.trim()) fail(400, "Añade un resumen de evidencia para cerrar la tarea.");
    evidenceSummary = input.evidenceSummary.trim();
    if (input.documentId) {
      const document = await validateDocument(
        actor,
        task.centerId,
        input.documentId,
        centers,
        isCoordinator(actor) || (actor.role === "teacher" && context.campaign.ownerCenterId === context.ownCenterId),
      );
      documentId = document?.id ?? null;
    } else {
      documentId = null;
    }
    status = "completed";
  } else if (input.action === "cancel") {
    if (["completed", "cancelled"].includes(status)) fail(409, "No se puede cancelar una tarea cerrada.");
    status = "cancelled";
  } else if (input.action === "reassign") {
    if (["completed", "cancelled"].includes(status)) fail(409, "No se puede reasignar una tarea cerrada.");
    if (!input.targetCenterId) fail(400, "Selecciona el centro responsable.");
    const target = requireActiveParticipant(context, input.targetCenterId);
    if (target.centerId === centerId) fail(400, "La tarea ya está asignada a ese centro.");
    centerId = target.centerId;
    centerName = target.centerName;
  }
  const oldCenterName = task.centerName;
  await db.transaction(async (tx) => {
    if (input.action !== "comment") {
      await tx.update(fpCoordinationTasks).set({
        status,
        centerId,
        centerName,
        evidenceSummary,
        documentId,
      }).where(and(
        eq(fpCoordinationTasks.id, id),
        eq(fpCoordinationTasks.tenantId, actor.tenantId),
      ));
    }
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: task.campaignId,
      centerId: input.action === "reassign" ? input.targetCenterId : task.centerId,
      resourceType: "task",
      resourceId: id,
      action: input.action,
      summary: input.action === "reassign"
        ? `Responsable transferido de ${oldCenterName} a ${centerName}. ${input.note.trim()}`
        : input.action === "complete"
          ? `Evidencia: ${evidenceSummary}. ${input.note.trim()}`
          : input.note.trim(),
    });
  });
  const [row] = await db.select().from(fpCoordinationTasks).where(eq(fpCoordinationTasks.id, id)).limit(1);
  res.json(api.ActOnCoordinationTaskResponse.parse({
    ...(await taskDto(row, actor, centers)),
  }));
}));

router.post("/redfp360/intercenter/incidents", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const input = api.CreateCoordinationIncidentBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "incident");
  if (prior) {
    const [row] = await db.select().from(fpCoordinationIncidents).where(and(
      eq(fpCoordinationIncidents.id, prior.resourceId),
      eq(fpCoordinationIncidents.tenantId, actor.tenantId),
    )).limit(1);
    if (!row) fail(404, "No se encontró la incidencia.");
    res.json(incidentDto(row));
    return;
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const context = await requireCampaign(actor, input.campaignId, centers);
  if (context.campaign.status !== "active") fail(409, "La campaña debe estar activa para registrar incidencias.");
  if (!["teacher", "team_manager"].includes(actor.role) && !isCoordinator(actor)) {
    fail(403, "Este perfil no puede registrar incidencias.");
  }
  const participant = requireActiveParticipant(context, input.centerId);
  if (actor.role === "team_manager" && input.centerId !== context.ownCenterId) {
    fail(403, "Solo puedes informar de incidencias de tu centro.");
  }
  if (actor.role === "teacher" && input.centerId !== context.ownCenterId &&
      context.campaign.ownerCenterId !== context.ownCenterId) {
    fail(403, "Solo el centro líder puede registrar incidencias de otro centro.");
  }
  rejectSensitiveText(input.summary);
  const rowId = input.operationId;
  await db.transaction(async (tx) => {
    await tx.insert(fpCoordinationIncidents).values({
      id: rowId,
      tenantId: actor.tenantId,
      campaignId: context.campaign.id,
      centerId: participant.centerId,
      centerName: participant.centerName,
      incidentType: input.incidentType,
      severity: input.severity,
      summary: input.summary.trim(),
      status: "open",
      assignedCenterId: participant.centerId,
      assignedCenterName: participant.centerName,
      resolution: "",
      createdByUserId: actor.userId,
      operationId: input.operationId,
    });
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: context.campaign.id,
      centerId: participant.centerId,
      resourceType: "incident",
      resourceId: rowId,
      action: "reported",
      summary: input.summary.trim(),
    });
  });
  const [row] = await db.select().from(fpCoordinationIncidents).where(eq(fpCoordinationIncidents.id, rowId)).limit(1);
  res.status(201).json(incidentDto(row));
}));

router.post("/redfp360/intercenter/incidents/:id/action", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const id = param(req.params.id);
  const input = api.ActOnCoordinationIncidentBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "incident", id);
  if (prior) {
    const [row] = await db.select().from(fpCoordinationIncidents).where(and(
      eq(fpCoordinationIncidents.id, id),
      eq(fpCoordinationIncidents.tenantId, actor.tenantId),
    )).limit(1);
    if (!row) fail(404, "No se encontró la incidencia.");
    res.json(incidentDto(row));
    return;
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const [incident] = await db.select().from(fpCoordinationIncidents).where(and(
    eq(fpCoordinationIncidents.id, id),
    eq(fpCoordinationIncidents.tenantId, actor.tenantId),
  )).limit(1);
  if (!incident) fail(404, "No se encontró la incidencia.");
  const context = await requireCampaign(actor, incident.campaignId, centers);
  const local = incident.centerId === context.ownCenterId || incident.assignedCenterId === context.ownCenterId;
  if (!isCoordinator(actor) && !(actor.role === "teacher" &&
      (context.campaign.ownerCenterId === context.ownCenterId || local)) &&
      !(actor.role === "team_manager" && incident.centerId === context.ownCenterId)) {
    fail(403, "La incidencia está fuera del ámbito de tu centro.");
  }
  let status = incident.status;
  let assignedCenterId = incident.assignedCenterId;
  let assignedCenterName = incident.assignedCenterName;
  let resolution = incident.resolution;
  if (input.action === "escalate") {
    if (!["open", "mediation"].includes(status)) fail(409, "La incidencia ya no se puede escalar.");
    status = "escalated";
  } else if (input.action === "mediate") {
    if (!["open", "escalated"].includes(status)) fail(409, "La incidencia no está disponible para mediación.");
    if (!isCoordinator(actor) && actor.role !== "teacher") fail(403, "Solo profesorado o coordinación puede mediar.");
    status = "mediation";
  } else if (input.action === "resolve") {
    if (status === "resolved") fail(409, "La incidencia ya está resuelta.");
    resolution = input.note.trim();
    status = "resolved";
  } else {
    if (status === "resolved") fail(409, "No se puede reasignar una incidencia resuelta.");
    if (!campaignCanBeManaged(actor, context.campaign, context.ownCenterId)) {
      fail(403, "Solo el centro líder o coordinación puede reasignar incidencias entre centros.");
    }
    if (!input.targetCenterId) fail(400, "Selecciona el nuevo centro responsable.");
    const target = requireActiveParticipant(context, input.targetCenterId);
    if (target.centerId === assignedCenterId) fail(400, "La incidencia ya está asignada a ese centro.");
    assignedCenterId = target.centerId;
    assignedCenterName = target.centerName;
  }
  rejectSensitiveText(input.note);
  await db.transaction(async (tx) => {
    await tx.update(fpCoordinationIncidents).set({
      status,
      assignedCenterId,
      assignedCenterName,
      resolution,
    }).where(and(
      eq(fpCoordinationIncidents.id, id),
      eq(fpCoordinationIncidents.tenantId, actor.tenantId),
    ));
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: incident.campaignId,
      centerId: assignedCenterId,
      resourceType: "incident",
      resourceId: id,
      action: input.action,
      summary: input.note.trim(),
    });
  });
  const [row] = await db.select().from(fpCoordinationIncidents).where(eq(fpCoordinationIncidents.id, id)).limit(1);
  res.json(api.ActOnCoordinationIncidentResponse.parse(incidentDto(row)));
}));

router.post("/redfp360/intercenter/transfers", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const input = api.CreateCoordinationTransferBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "transfer", undefined, {
    allowRecipientForTeacher: true,
  });
  if (prior) {
    const [row] = await db.select().from(fpCoordinationTransfers).where(and(
      eq(fpCoordinationTransfers.id, prior.resourceId),
      eq(fpCoordinationTransfers.tenantId, actor.tenantId),
    )).limit(1);
    if (!row) fail(404, "No se encontró la transferencia.");
    res.json(transferDto(row));
    return;
  }
  const centers = await getCenterDirectory(actor.tenantId);
  const context = await requireCampaign(actor, input.campaignId, centers, { allowRecipientForTeacher: true });
  if (!isCoordinator(actor) && !(actor.role === "teacher" && context.campaign.ownerCenterId === context.ownCenterId)) {
    fail(403, "Solo el centro líder o coordinación puede preparar una transferencia.");
  }
  const recipient = context.participants.find((participant) =>
    participant.centerId === input.centerId && participant.role === "recipient" && participant.status === "invited");
  if (!recipient) fail(400, "La transferencia debe dirigirse a un centro destinatario registrado.");
  rejectSensitiveText(input.adoptionSummary);
  const rowId = input.operationId;
  await db.transaction(async (tx) => {
    await tx.insert(fpCoordinationTransfers).values({
      id: rowId,
      tenantId: actor.tenantId,
      campaignId: context.campaign.id,
      centerId: recipient.centerId,
      centerName: recipient.centerName,
      status: "proposed",
      adoptionSummary: input.adoptionSummary.trim(),
      createdByUserId: actor.userId,
      operationId: input.operationId,
    });
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: context.campaign.id,
      centerId: recipient.centerId,
      resourceType: "transfer",
      resourceId: rowId,
      action: "proposed",
      summary: `Se preparó transferencia para ${recipient.centerName}. ${input.adoptionSummary.trim()}`,
    });
  });
  const [row] = await db.select().from(fpCoordinationTransfers).where(eq(fpCoordinationTransfers.id, rowId)).limit(1);
  res.status(201).json(transferDto(row));
}));

router.put("/redfp360/intercenter/transfers/:id", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const id = param(req.params.id);
  const input = api.UpdateCoordinationTransferBody.parse(req.body);
  const prior = await priorOperation(actor, input.operationId, input, "transfer", id, {
    allowRecipientForTeacher: true,
  });
  if (prior) {
    const [row] = await db.select().from(fpCoordinationTransfers).where(and(
      eq(fpCoordinationTransfers.id, id),
      eq(fpCoordinationTransfers.tenantId, actor.tenantId),
    )).limit(1);
    if (!row) fail(404, "No se encontró la transferencia.");
    res.json(api.UpdateCoordinationTransferResponse.parse(transferDto(row)));
    return;
  }
  const [transfer] = await db.select().from(fpCoordinationTransfers).where(and(
    eq(fpCoordinationTransfers.id, id),
    eq(fpCoordinationTransfers.tenantId, actor.tenantId),
  )).limit(1);
  if (!transfer) fail(404, "No se encontró la transferencia.");
  const centers = await getCenterDirectory(actor.tenantId);
  const context = await requireCampaign(actor, transfer.campaignId, centers, { allowRecipientForTeacher: true });
  const isRecipientTeacher = actor.role === "teacher" && context.ownCenterId === transfer.centerId;
  if (!isCoordinator(actor) && !isRecipientTeacher) {
    fail(403, "Solo el centro destinatario o coordinación puede registrar la adopción.");
  }
  if (!context.participants.some((participant) =>
    participant.centerId === transfer.centerId && participant.role === "recipient" && participant.status === "invited")) {
    fail(409, "El centro debe mantener su condición de destinatario de difusión.");
  }
  rejectSensitiveText(input.adoptionSummary);
  const allowedNext: Record<string, string[]> = {
    proposed: ["interested", "declined"],
    interested: ["prepared", "declined"],
    prepared: ["training", "declined"],
    training: ["adopted", "declined"],
  };
  if (!(allowedNext[transfer.status] ?? []).includes(input.status)) {
    fail(409, "La transferencia debe avanzar por sus estados o cerrarse como no adoptada.");
  }
  await db.transaction(async (tx) => {
    await tx.update(fpCoordinationTransfers).set({
      status: input.status,
      adoptionSummary: input.adoptionSummary.trim(),
    }).where(and(
      eq(fpCoordinationTransfers.id, id),
      eq(fpCoordinationTransfers.tenantId, actor.tenantId),
    ));
    await appendAudit(tx, actor, {
      operationId: input.operationId,
      body: input,
      campaignId: transfer.campaignId,
      centerId: transfer.centerId,
      resourceType: "transfer",
      resourceId: id,
      action: input.status,
      summary: input.adoptionSummary.trim(),
    });
  });
  const [row] = await db.select().from(fpCoordinationTransfers).where(eq(fpCoordinationTransfers.id, id)).limit(1);
  res.json(api.UpdateCoordinationTransferResponse.parse(transferDto(row)));
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof CoordinationError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error instanceof Error && error.name === "ZodError") {
    const issues = "issues" in error ? error.issues : undefined;
    res.status(400).json({ message: "Revisa los datos del formulario.", issues });
    return;
  }
  next(error);
};

router.use(errorHandler);

export default router;

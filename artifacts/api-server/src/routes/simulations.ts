import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import * as api from "@workspace/api-zod";
import {
  db,
  fpDocuments,
  fpOrganizations,
  fpSimulationAuditEvents,
  fpSimulationCampaigns,
  fpSimulationEvents,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: Router = Router();
const SIMULATION_START = "2027-01-01";
const SIMULATION_END = "2028-12-31";
const SIMULATION_TODAY = "2027-09-15";
const personalChannel = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\b(?:\+?34[\s.-]?)?[6789]\d{8}\b)/i;

class SimulationError extends Error {
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
  throw new SimulationError(status, message);
}

function isManager(role: AuthContext["role"]): boolean {
  return ["team_manager", "teacher", "administrator"].includes(role);
}

function canReview(role: AuthContext["role"]): boolean {
  return role === "teacher" || role === "administrator";
}

function canViewAcrossOrganizations(role: AuthContext["role"]): boolean {
  return role === "teacher" || role === "administrator";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function safeScenarioText(...values: Array<string | null | undefined>): void {
  if (values.some((value) => value && personalChannel.test(value))) {
    fail(400, "No incluyas correos ni teléfonos reales en el contenido didáctico.");
  }
}

async function organizationRows(actor: AuthContext, ids?: string[]) {
  return db.select({
    id: fpOrganizations.id,
    name: fpOrganizations.name,
    center: fpOrganizations.center,
    island: fpOrganizations.island,
  }).from(fpOrganizations).where(and(
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
    ...(ids?.length ? [inArray(fpOrganizations.id, ids)] : []),
  )).orderBy(asc(fpOrganizations.name));
}

async function getCampaign(actor: AuthContext, id: string) {
  const [campaign] = await db.select().from(fpSimulationCampaigns).where(and(
    eq(fpSimulationCampaigns.id, id),
    eq(fpSimulationCampaigns.tenantId, actor.tenantId),
  )).limit(1);
  if (!campaign) fail(404, "No se encontró la campaña.");
  if (!canViewAcrossOrganizations(actor.role) && (!actor.organizationId || !campaign.participantOrganizationIds.includes(actor.organizationId))) {
    fail(403, "No tienes acceso a esta campaña.");
  }
  return campaign;
}

async function eventOutput(event: typeof fpSimulationEvents.$inferSelect) {
  const [evidence] = event.evidenceDocumentId ? await db.select({
    reference: fpDocuments.documentRef,
  }).from(fpDocuments).where(and(
    eq(fpDocuments.id, event.evidenceDocumentId),
    eq(fpDocuments.tenantId, event.tenantId),
    eq(fpDocuments.organizationId, event.organizationId),
  )).limit(1) : [];
  return api.CreateFp360SimulationEventResponse.parse({
    id: event.id,
    campaignId: event.campaignId,
    organizationId: event.organizationId,
    title: event.title,
    eventType: event.eventType,
    status: event.status,
    description: event.description,
    preconditions: event.preconditions,
    requiredDocumentType: event.requiredDocumentType,
    simulatedDate: event.simulatedDate,
    evidenceDocumentId: event.evidenceDocumentId,
    evidenceDocumentReference: evidence?.reference ?? null,
    completedAt: event.completedAt?.toISOString() ?? null,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  });
}

async function campaignOutput(campaign: typeof fpSimulationCampaigns.$inferSelect) {
  const [organizations, events] = await Promise.all([
    db.select({ id: fpOrganizations.id, name: fpOrganizations.name }).from(fpOrganizations).where(and(
      eq(fpOrganizations.tenantId, campaign.tenantId),
      inArray(fpOrganizations.id, [campaign.ownerOrganizationId, ...campaign.participantOrganizationIds]),
    )),
    db.select({ id: fpSimulationEvents.id }).from(fpSimulationEvents).where(and(
      eq(fpSimulationEvents.tenantId, campaign.tenantId),
      eq(fpSimulationEvents.campaignId, campaign.id),
    )),
  ]);
  const names = new Map(organizations.map((organization) => [organization.id, organization.name]));
  return api.CreateFp360SimulationCampaignResponse.parse({
    id: campaign.id,
    ownerOrganizationId: campaign.ownerOrganizationId,
    ownerOrganizationName: names.get(campaign.ownerOrganizationId) ?? "Empresa simulada",
    title: campaign.title,
    description: campaign.description,
    mode: campaign.mode,
    durationWeeks: campaign.durationWeeks,
    difficulty: campaign.difficulty,
    status: campaign.status,
    startDate: campaign.startDate,
    endDate: campaign.endDate,
    participantOrganizationIds: campaign.participantOrganizationIds,
    participantNames: campaign.participantOrganizationIds.map((id) => names.get(id) ?? "Empresa simulada"),
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
    eventCount: events.length,
  });
}

async function assertOrganizations(actor: AuthContext, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length !== ids.length || !uniqueIds.length) fail(400, "Selecciona empresas simuladas distintas.");
  const organizations = await organizationRows(actor, uniqueIds);
  if (organizations.length !== uniqueIds.length) fail(400, "Una o más empresas ya no están activas en esta red.");
}

async function priorOperation(actor: AuthContext, operationId: string, campaignId: string, eventId: string | null, action: string) {
  if (personalChannel.test(operationId)) fail(400, "El identificador de operación no puede contener datos de contacto.");
  const [prior] = await db.select().from(fpSimulationAuditEvents).where(and(
    eq(fpSimulationAuditEvents.tenantId, actor.tenantId),
    eq(fpSimulationAuditEvents.operationId, operationId),
  )).limit(1);
  if (!prior) return false;
  if (prior.campaignId !== campaignId || prior.eventId !== eventId || prior.action !== action) {
    fail(409, "El identificador ya se utilizó para otra operación.");
  }
  return true;
}

async function appendAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actor: AuthContext,
  campaignId: string,
  organizationId: string,
  eventId: string | null,
  action: string,
  operationId: string,
  detail: string,
) {
  await tx.insert(fpSimulationAuditEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    campaignId,
    eventId,
    organizationId,
    action,
    actorUserId: actor.userId,
    operationId,
    detail,
  });
}

router.use("/redfp360/simulations", requireAuth);

router.get("/redfp360/simulations/overview", route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const organizations = isManager(actor.role)
    ? await organizationRows(actor)
    : actor.organizationId ? await organizationRows(actor, [actor.organizationId]) : [];
  const organizationIds = organizations.map((organization) => organization.id);
  const allCampaigns = await db.select().from(fpSimulationCampaigns).where(eq(fpSimulationCampaigns.tenantId, actor.tenantId))
    .orderBy(asc(fpSimulationCampaigns.startDate));
  const campaigns = allCampaigns.filter((campaign) => canViewAcrossOrganizations(actor.role) || (actor.organizationId && campaign.participantOrganizationIds.includes(actor.organizationId)));
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const events = campaignIds.length && (canViewAcrossOrganizations(actor.role) || actor.organizationId) ? await db.select().from(fpSimulationEvents).where(and(
    eq(fpSimulationEvents.tenantId, actor.tenantId),
    inArray(fpSimulationEvents.campaignId, campaignIds),
    ...(!canViewAcrossOrganizations(actor.role) && actor.organizationId ? [eq(fpSimulationEvents.organizationId, actor.organizationId)] : []),
    ...(actor.role === "student" ? [inArray(fpSimulationEvents.status, ["published", "completed"])] : []),
  )).orderBy(asc(fpSimulationEvents.simulatedDate)) : [];
  res.json(api.GetFp360SimulationsOverviewResponse.parse({
    campaigns: await Promise.all(campaigns.map(campaignOutput)),
    events: await Promise.all(events.map(eventOutput)),
    organizations: organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      center: organization.center,
      island: organization.island,
    })),
  }));
}));

router.post("/redfp360/simulations/campaigns", requireSimulationWriteAccess, route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isManager(actor.role)) fail(403, "Solo los perfiles responsables pueden crear campañas.");
  const body = api.CreateFp360SimulationCampaignBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa los datos de la campaña.");
  const data = body.data;
  safeScenarioText(data.title, data.description);
  if (data.startDate < SIMULATION_START || data.endDate > SIMULATION_END || data.startDate > data.endDate) {
    fail(400, "Las fechas deben estar ordenadas dentro del escenario 2027–2028.");
  }
  if (!data.participantOrganizationIds.includes(data.ownerOrganizationId)) {
    fail(400, "La empresa responsable debe formar parte de la campaña.");
  }
  if (!canReview(actor.role) && actor.organizationId !== data.ownerOrganizationId) {
    fail(403, "Solo puedes crear campañas para tu propia empresa.");
  }
  await assertOrganizations(actor, [data.ownerOrganizationId, ...data.participantOrganizationIds]);
  if (personalChannel.test(data.operationId)) fail(400, "El identificador no puede contener datos de contacto.");
  const [prior] = await db.select().from(fpSimulationCampaigns).where(and(
    eq(fpSimulationCampaigns.tenantId, actor.tenantId),
    eq(fpSimulationCampaigns.operationId, data.operationId),
  )).limit(1);
  if (prior) {
    if (
      prior.title !== data.title || prior.ownerOrganizationId !== data.ownerOrganizationId ||
      prior.description !== data.description || prior.mode !== data.mode ||
      prior.durationWeeks !== data.durationWeeks || prior.difficulty !== data.difficulty ||
      prior.startDate !== data.startDate || prior.endDate !== data.endDate ||
      JSON.stringify(prior.participantOrganizationIds) !== JSON.stringify(data.participantOrganizationIds)
    ) fail(409, "El identificador ya se utilizó para otra campaña.");
    res.status(201).json(await campaignOutput(prior));
    return;
  }
  const id = randomUUID();
  const campaign = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpSimulationCampaigns).values({
      id,
      tenantId: actor.tenantId,
      ownerOrganizationId: data.ownerOrganizationId,
      title: data.title.trim(),
      description: data.description.trim(),
      mode: data.mode,
      durationWeeks: data.durationWeeks,
      difficulty: data.difficulty,
      startDate: data.startDate,
      endDate: data.endDate,
      participantOrganizationIds: data.participantOrganizationIds,
      operationId: data.operationId,
      createdByUserId: actor.userId,
    }).returning();
    await appendAudit(tx, actor, id, data.ownerOrganizationId, null, "created", data.operationId, "Borrador de campaña creado.");
    return created;
  });
  res.status(201).json(await campaignOutput(campaign));
}));

router.post("/redfp360/simulations/campaigns/:id/action", requireSimulationWriteAccess, route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const params = api.ActOnFp360SimulationCampaignParams.safeParse(req.params);
  const body = api.ActOnFp360SimulationCampaignBody.safeParse(req.body);
  if (!params.success || !body.success) fail(400, "Revisa la acción de la campaña.");
  const { action, organizationId, operationId } = body.data;
  const current = await getCampaign(actor, params.data.id);
  if (!current.participantOrganizationIds.includes(organizationId)) fail(403, "La empresa indicada no participa en esta campaña.");
  if (!canViewAcrossOrganizations(actor.role) && actor.organizationId !== organizationId) fail(403, "Solo puedes actuar en nombre de tu empresa.");
  if (!canReview(actor.role) && ["submit", "pause"].includes(action) && current.ownerOrganizationId !== actor.organizationId) {
    fail(403, "Solo la empresa responsable puede enviar o pausar esta campaña.");
  }
  safeScenarioText(body.data.note);
  if (await priorOperation(actor, operationId, current.id, null, `campaign:${action}`)) {
    res.json(await campaignOutput(current));
    return;
  }
  if (action === "submit" && (!isManager(actor.role) || current.status !== "draft")) fail(409, "Solo se puede enviar a revisión un borrador.");
  if (["approve", "reject", "start", "close"].includes(action) && !canReview(actor.role)) fail(403, "Esta acción requiere revisión docente.");
  if (action === "pause" && !isManager(actor.role)) fail(403, "Solo un perfil responsable puede pausar la campaña.");
  if (action === "approve" && current.status !== "review") fail(409, "Solo se pueden aprobar campañas pendientes de revisión.");
  if (action === "reject" && current.status !== "review") fail(409, "Solo se pueden devolver campañas pendientes de revisión.");
  if (action === "start" && (current.status !== "approved" || current.startDate > SIMULATION_TODAY || current.endDate < SIMULATION_TODAY)) fail(409, "La campaña debe estar aprobada y dentro de su periodo simulado.");
  if (action === "pause" && (current.status !== "active" || !isManager(actor.role))) fail(409, "Solo se puede pausar una campaña activa.");
  if (action === "close" && !["active", "paused"].includes(current.status)) fail(409, "Solo se puede cerrar una campaña activa o pausada.");
  if (action === "close") {
    const unfinished = await db.select({ id: fpSimulationEvents.id }).from(fpSimulationEvents).where(and(
      eq(fpSimulationEvents.tenantId, actor.tenantId),
      eq(fpSimulationEvents.campaignId, current.id),
      inArray(fpSimulationEvents.status, ["draft", "proposed", "approved", "published"]),
    ));
    if (unfinished.length) fail(409, "Completa o cancela todas las actividades pendientes antes de cerrar la campaña.");
  }
  {
    const nextStatus = {
      submit: "review",
      approve: "approved",
      reject: "rejected",
      start: "active",
      pause: "paused",
      close: "closed",
    }[action];
    await db.transaction(async (tx) => {
      const [updated] = await tx.update(fpSimulationCampaigns).set({
        status: nextStatus,
        reviewedByUserId: ["approve", "reject"].includes(action) ? actor.userId : current.reviewedByUserId,
      }).where(and(
        eq(fpSimulationCampaigns.id, current.id),
        eq(fpSimulationCampaigns.tenantId, actor.tenantId),
        eq(fpSimulationCampaigns.status, current.status),
      )).returning({ id: fpSimulationCampaigns.id });
      if (!updated) fail(409, "La campaña cambió en otra sesión. Actualiza la vista y vuelve a intentarlo.");
      await appendAudit(tx, actor, current.id, organizationId, null, `campaign:${action}`, operationId, body.data.note ?? "");
    });
  }
  const updated = await getCampaign(actor, current.id);
  res.json(await campaignOutput(updated));
}));

router.post("/redfp360/simulations/campaigns/:id/events", requireSimulationWriteAccess, route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isManager(actor.role)) fail(403, "Solo los perfiles responsables pueden proponer eventos.");
  const params = api.CreateFp360SimulationEventParams.safeParse(req.params);
  const body = api.CreateFp360SimulationEventBody.safeParse(req.body);
  if (!params.success || !body.success) fail(400, "Revisa los datos del evento.");
  const campaign = await getCampaign(actor, params.data.id);
  if (!["approved", "active", "paused"].includes(campaign.status)) fail(409, "La campaña debe estar aprobada antes de proponer eventos.");
  const data = body.data;
  if (!campaign.participantOrganizationIds.includes(data.organizationId)) fail(403, "La empresa indicada no participa en esta campaña.");
  if (!canViewAcrossOrganizations(actor.role) && actor.organizationId !== data.organizationId) fail(403, "Solo puedes proponer eventos para tu empresa.");
  if (data.simulatedDate < campaign.startDate || data.simulatedDate > campaign.endDate) fail(400, "La fecha del evento debe estar dentro del periodo de campaña.");
  safeScenarioText(data.title, data.description, ...data.preconditions);
  if (data.requiredDocumentType && personalChannel.test(data.requiredDocumentType)) fail(400, "El tipo documental no puede contener datos de contacto.");
  if (personalChannel.test(data.operationId)) fail(400, "El identificador no puede contener datos de contacto.");
  const [prior] = await db.select().from(fpSimulationEvents).where(and(
    eq(fpSimulationEvents.tenantId, actor.tenantId),
    eq(fpSimulationEvents.operationId, data.operationId),
  )).limit(1);
  if (prior) {
    if (
      prior.campaignId !== campaign.id || prior.title !== data.title ||
      prior.organizationId !== data.organizationId || prior.eventType !== data.eventType ||
      prior.description !== data.description || prior.simulatedDate !== data.simulatedDate ||
      JSON.stringify(prior.preconditions) !== JSON.stringify(data.preconditions) ||
      prior.requiredDocumentType !== (data.requiredDocumentType ?? null)
    ) fail(409, "El identificador ya se utilizó para otro evento.");
    res.status(201).json(await eventOutput(prior));
    return;
  }
  const id = randomUUID();
  const event = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpSimulationEvents).values({
      id,
      tenantId: actor.tenantId,
      campaignId: campaign.id,
      organizationId: data.organizationId,
      title: data.title.trim(),
      eventType: data.eventType,
      status: "proposed",
      description: data.description.trim(),
      preconditions: data.preconditions,
      requiredDocumentType: data.requiredDocumentType ?? null,
      simulatedDate: data.simulatedDate,
      operationId: data.operationId,
      createdByUserId: actor.userId,
    }).returning();
    await appendAudit(tx, actor, campaign.id, data.organizationId, id, "event:proposed", data.operationId, "Evento propuesto; no modifica datos operativos.");
    return created;
  });
  res.status(201).json(await eventOutput(event));
}));

router.put("/redfp360/simulations/events/:id", requireSimulationWriteAccess, route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!isManager(actor.role)) fail(403, "Solo perfiles responsables pueden corregir propuestas.");
  const params = api.UpdateFp360SimulationEventParams.safeParse(req.params);
  const body = api.UpdateFp360SimulationEventBody.safeParse(req.body);
  if (!params.success || !body.success) fail(400, "Revisa los datos del evento.");
  const [event] = await db.select().from(fpSimulationEvents).where(and(
    eq(fpSimulationEvents.id, params.data.id),
    eq(fpSimulationEvents.tenantId, actor.tenantId),
  )).limit(1);
  if (!event) fail(404, "No se encontró el evento.");
  const campaign = await getCampaign(actor, event.campaignId);
  const data = body.data;
  if (data.organizationId !== event.organizationId || !campaign.participantOrganizationIds.includes(data.organizationId)) {
    fail(403, "La empresa no corresponde a este evento.");
  }
  if (!canViewAcrossOrganizations(actor.role) && actor.organizationId !== event.organizationId) {
    fail(403, "Solo puedes corregir eventos de tu organización.");
  }
  if (data.simulatedDate < campaign.startDate || data.simulatedDate > campaign.endDate) {
    fail(400, "La fecha del evento debe quedar dentro del periodo de campaña.");
  }
  safeScenarioText(data.title, data.description, ...data.preconditions);
  if (data.requiredDocumentType && personalChannel.test(data.requiredDocumentType)) fail(400, "El tipo documental no puede contener datos de contacto.");
  const detail = JSON.stringify({
    organizationId: data.organizationId,
    title: data.title.trim(),
    eventType: data.eventType,
    description: data.description.trim(),
    preconditions: data.preconditions,
    requiredDocumentType: data.requiredDocumentType ?? null,
    simulatedDate: data.simulatedDate,
  });
  if (personalChannel.test(data.operationId)) fail(400, "El identificador no puede contener datos de contacto.");
  const [prior] = await db.select().from(fpSimulationAuditEvents).where(and(
    eq(fpSimulationAuditEvents.tenantId, actor.tenantId),
    eq(fpSimulationAuditEvents.operationId, data.operationId),
  )).limit(1);
  if (prior) {
    if (prior.campaignId !== campaign.id || prior.eventId !== event.id || prior.action !== "event:edited" || prior.detail !== detail) {
      fail(409, "El identificador ya se utilizó para otra operación.");
    }
    res.json(await eventOutput(event));
    return;
  }
  if (event.status !== "draft" || !["approved", "active", "paused"].includes(campaign.status)) {
    fail(409, "Solo se pueden corregir borradores devueltos de una campaña abierta.");
  }
  const updated = await db.transaction(async (tx) => {
    const [result] = await tx.update(fpSimulationEvents).set({
      title: data.title.trim(),
      eventType: data.eventType,
      description: data.description.trim(),
      preconditions: data.preconditions,
      requiredDocumentType: data.requiredDocumentType ?? null,
      simulatedDate: data.simulatedDate,
    }).where(and(
      eq(fpSimulationEvents.id, event.id),
      eq(fpSimulationEvents.tenantId, actor.tenantId),
      eq(fpSimulationEvents.status, "draft"),
    )).returning();
    if (!result) fail(409, "El evento cambió en otra sesión. Actualiza la vista y vuelve a intentarlo.");
    await appendAudit(tx, actor, campaign.id, event.organizationId, event.id, "event:edited", data.operationId, detail);
    return result;
  });
  res.json(await eventOutput(updated));
}));

router.post("/redfp360/simulations/events/:id/action", requireSimulationWriteAccess, route(async (req, res) => {
  const actor = req.auth as AuthContext;
  const params = api.ActOnFp360SimulationEventParams.safeParse(req.params);
  const body = api.ActOnFp360SimulationEventBody.safeParse(req.body);
  if (!params.success || !body.success) fail(400, "Revisa la acción del evento.");
  const [event] = await db.select().from(fpSimulationEvents).where(and(
    eq(fpSimulationEvents.id, params.data.id),
    eq(fpSimulationEvents.tenantId, actor.tenantId),
  )).limit(1);
  if (!event) fail(404, "No se encontró el evento.");
  const campaign = await getCampaign(actor, event.campaignId);
  const { action, organizationId, operationId } = body.data;
  if (!campaign.participantOrganizationIds.includes(organizationId) || event.organizationId !== organizationId) fail(403, "La empresa indicada no corresponde al evento.");
  if (!canViewAcrossOrganizations(actor.role) && actor.organizationId !== organizationId) fail(403, "Solo puedes actuar sobre eventos de tu empresa.");
  safeScenarioText(body.data.note);
  if (await priorOperation(actor, operationId, campaign.id, event.id, `event:${action}`)) {
    res.json(await eventOutput(event));
    return;
  }
  if (event.status === "completed") fail(409, "La actividad ya se completó con evidencia documental.");
  if (action === "submit" && actor.role !== "team_manager") fail(403, "Solo la empresa responsable puede volver a proponer el evento.");
  if (["approve", "publish"].includes(action) && !canReview(actor.role)) fail(403, "Esta acción requiere revisión docente.");
  if (["cancel", "return", "submit"].includes(action) && !isManager(actor.role)) fail(403, "Solo un perfil responsable puede cambiar esta propuesta.");
  if (action === "submit" && event.status !== "draft") fail(409, "Solo se pueden volver a proponer borradores devueltos.");
  if (action === "submit" && !["approved", "active", "paused"].includes(campaign.status)) fail(409, "La campaña debe seguir abierta para reenviar el evento.");
  if (action === "approve" && event.status !== "proposed") fail(409, "El evento debe estar propuesto para aprobarlo.");
  if (action === "approve" && !["approved", "active", "paused"].includes(campaign.status)) fail(409, "No se puede revisar un evento de una campaña cerrada.");
  if (action === "publish" && (event.status !== "approved" || campaign.status !== "active")) fail(409, "Solo se publica un evento aprobado dentro de una campaña activa.");
  if (action === "cancel" && event.status === "published" && !canReview(actor.role)) fail(403, "Solo docentes o administradores pueden cancelar una actividad publicada.");
  if (action === "cancel" && event.status === "published" && !body.data.note?.trim()) fail(400, "Indica el motivo para cancelar una actividad publicada.");
  if (action === "return" && !["proposed", "approved"].includes(event.status)) fail(409, "Solo se pueden devolver eventos propuestos o aprobados.");
  {
    const nextStatus = { submit: "proposed", approve: "approved", publish: "published", cancel: "cancelled", return: "draft" }[action];
    await db.transaction(async (tx) => {
      const [updatedEvent] = await tx.update(fpSimulationEvents).set({
        status: nextStatus,
        reviewedByUserId: ["approve", "publish"].includes(action) ? actor.userId : event.reviewedByUserId,
      }).where(and(
        eq(fpSimulationEvents.id, event.id),
        eq(fpSimulationEvents.tenantId, actor.tenantId),
        eq(fpSimulationEvents.status, event.status),
      )).returning({ id: fpSimulationEvents.id });
      if (!updatedEvent) fail(409, "El evento cambió en otra sesión. Actualiza la vista y vuelve a intentarlo.");
      await appendAudit(tx, actor, campaign.id, organizationId, event.id, `event:${action}`, operationId, body.data.note ?? "");
    });
  }
  const [updated] = await db.select().from(fpSimulationEvents).where(and(
    eq(fpSimulationEvents.id, event.id),
    eq(fpSimulationEvents.tenantId, actor.tenantId),
  )).limit(1);
  if (!updated) fail(404, "El evento ya no está disponible.");
  res.json(await eventOutput(updated));
}));

router.post("/redfp360/simulations/events/:id/evidence", requireSimulationWriteAccess, route(async (req, res) => {
  const actor = req.auth as AuthContext;
  if (!["student", "team_manager"].includes(actor.role)) fail(403, "Solo el alumnado o la empresa responsable pueden registrar la evidencia.");
  const params = api.LinkFp360SimulationEventEvidenceParams.safeParse(req.params);
  const body = api.LinkFp360SimulationEventEvidenceBody.safeParse(req.body);
  if (!params.success || !body.success) fail(400, "Revisa la empresa, el documento y el identificador de operación.");
  const [event] = await db.select().from(fpSimulationEvents).where(and(
    eq(fpSimulationEvents.id, params.data.id),
    eq(fpSimulationEvents.tenantId, actor.tenantId),
  )).limit(1);
  if (!event) fail(404, "No se encontró la actividad.");
  const campaign = await getCampaign(actor, event.campaignId);
  const { organizationId, documentId, operationId } = body.data;
  if (!actor.organizationId || actor.organizationId !== organizationId || event.organizationId !== organizationId) {
    fail(403, "Solo puedes registrar evidencia para tu propia organización.");
  }
  if (await priorOperation(actor, operationId, campaign.id, event.id, "event:evidence_linked")) {
    if (event.evidenceDocumentId !== documentId) fail(409, "El identificador ya se utilizó con otra evidencia.");
    res.json(await eventOutput(event));
    return;
  }
  if (event.status !== "published" || campaign.status !== "active") {
    fail(409, "La actividad debe estar publicada dentro de una campaña activa.");
  }
  if (body.data.note) safeScenarioText(body.data.note);
  if (event.evidenceDocumentId) fail(409, "La actividad ya tiene una evidencia vinculada.");
  const [document] = await db.select().from(fpDocuments).where(and(
    eq(fpDocuments.id, documentId),
    eq(fpDocuments.tenantId, actor.tenantId),
    eq(fpDocuments.organizationId, organizationId),
    eq(fpDocuments.status, "confirmed"),
    eq(fpDocuments.visibility, "organization"),
    eq(fpDocuments.isSynthetic, true),
    isNull(fpDocuments.archivedAt),
  )).limit(1);
  if (!document) fail(404, "Solo se pueden vincular documentos ficticios, confirmados y visibles para la organización.");
  if (event.requiredDocumentType && document.documentType !== event.requiredDocumentType) {
    fail(400, "El documento confirmado no coincide con el tipo requerido por la actividad.");
  }
  const updatedEvent = await db.transaction(async (tx) => {
    const [updated] = await tx.update(fpSimulationEvents).set({
      status: "completed",
      evidenceDocumentId: document.id,
      completedByUserId: actor.userId,
      completedAt: new Date(),
    }).where(and(
      eq(fpSimulationEvents.id, event.id),
      eq(fpSimulationEvents.tenantId, actor.tenantId),
      eq(fpSimulationEvents.status, "published"),
      isNull(fpSimulationEvents.evidenceDocumentId),
    )).returning();
    if (!updated) fail(409, "La actividad cambió en otra sesión. Actualiza la vista y vuelve a intentarlo.");
    const detail = `Evidencia ficticia confirmada: ${document.documentRef}.${body.data.note ? ` ${body.data.note.trim()}` : ""}`;
    await appendAudit(tx, actor, campaign.id, organizationId, event.id, "event:evidence_linked", operationId, detail);
    return updated;
  });
  res.json(await eventOutput(updatedEvent));
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof SimulationError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
};

router.use(errorHandler);
export default router;

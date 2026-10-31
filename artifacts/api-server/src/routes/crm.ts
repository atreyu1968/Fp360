import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter } from "express";
import {
  CreateCrmActivityBody, CreateCrmActivityResponse,
  CreateCrmContactBody, CreateCrmContactResponse,
  CreateCrmOpportunityBody, CreateCrmOpportunityResponse,
  ListCrmActivitiesResponse, ListCrmContactsResponse,
  ListCrmOpportunitiesResponse, ListCrmOpportunityHistoryResponse,
  MoveCrmOpportunityBody, MoveCrmOpportunityParams, MoveCrmOpportunityResponse,
  UpdateCrmActivityBody, UpdateCrmActivityParams, UpdateCrmActivityResponse,
  UpdateCrmContactBody, UpdateCrmContactParams, UpdateCrmContactResponse,
  UpdateCrmOpportunityBody, UpdateCrmOpportunityParams, UpdateCrmOpportunityResponse,
} from "@workspace/api-zod";
import {
  db, fpActivity, fpCrmActivities, fpCrmContacts, fpCrmOpportunities,
  fpCrmOpportunityHistory, fpOrganizations,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const SIMULATED_DATE = "2027-09-15";
const STAGE_PROBABILITY: Record<string, number> = {
  new: 1000, qualified: 2500, proposal: 5000, negotiation: 7500, won: 10000, lost: 0,
};

class CrmError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new CrmError(status, message); }
function trimNonBlank(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) fail(400, `${label} no puede estar vacío.`);
  return normalized;
}
async function audit(tx: Transaction, actor: AuthContext, action: string, description: string, reference: string) {
  await tx.insert(fpActivity).values({
    id: randomUUID(), tenantId: actor.tenantId, action,
    description: `${description} · Perfil: ${actor.role}`,
    reference, simulatedDate: SIMULATED_DATE,
  });
}
async function activeOrganization(tx: Transaction, tenantId: string, organizationId: string) {
  const [organization] = await tx.select({ id: fpOrganizations.id, name: fpOrganizations.name })
    .from(fpOrganizations).where(and(
      eq(fpOrganizations.id, organizationId), eq(fpOrganizations.tenantId, tenantId),
      eq(fpOrganizations.isActive, true),
    )).for("share");
  if (!organization) fail(404, "Selecciona una empresa activa de tu red.");
  return organization;
}
async function contactDuplicate(tx: Transaction, tenantId: string, organizationId: string, fullName: string, excludingId = "") {
  const [duplicate] = await tx.select({ id: fpCrmContacts.id }).from(fpCrmContacts).where(and(
    eq(fpCrmContacts.tenantId, tenantId), eq(fpCrmContacts.organizationId, organizationId),
    sql`lower(trim(${fpCrmContacts.fullName})) = lower(trim(${fullName}))`,
    sql`${fpCrmContacts.id} <> ${excludingId}`,
  ));
  if (duplicate) fail(409, "Ya hay un contacto con ese nombre asociado a esta empresa.");
}
function iso(date: Date) { return date.toISOString(); }

router.use("/redfp360/crm", requireAuth, requireSimulationWriteAccess);

async function readContacts(tenantId: string) {
  const rows = await db.select({
    id: fpCrmContacts.id, organizationId: fpCrmContacts.organizationId,
    organizationName: fpOrganizations.name, fullName: fpCrmContacts.fullName,
    position: fpCrmContacts.position, channel: fpCrmContacts.channel,
    isActive: fpCrmContacts.isActive, createdAt: fpCrmContacts.createdAt,
  }).from(fpCrmContacts).innerJoin(fpOrganizations, and(
    eq(fpOrganizations.id, fpCrmContacts.organizationId),
    eq(fpOrganizations.tenantId, fpCrmContacts.tenantId),
  )).where(eq(fpCrmContacts.tenantId, tenantId))
    .orderBy(fpOrganizations.name, fpCrmContacts.fullName).limit(500);
  return ListCrmContactsResponse.parse(rows.map((row) => ({ ...row, createdAt: iso(row.createdAt) })));
}
router.get("/redfp360/crm/contacts", async (req, res) => {
  res.json(await readContacts(req.auth!.tenantId));
});
router.post("/redfp360/crm/contacts", async (req, res): Promise<void> => {
  const parsed = CreateCrmContactBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa los datos del contacto simulado.");
  const fullName = trimNonBlank(parsed.data.fullName, "El nombre");
  const position = trimNonBlank(parsed.data.position, "El cargo");
  const actor = req.auth!;
  const id = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fp360-crm-contact:${actor.tenantId}`}))`);
    const org = await activeOrganization(tx, actor.tenantId, parsed.data.organizationId);
    await contactDuplicate(tx, actor.tenantId, org.id, fullName);
    const contactId = randomUUID();
    await tx.insert(fpCrmContacts).values({
      id: contactId, tenantId: actor.tenantId, organizationId: org.id,
      fullName, position, channel: parsed.data.channel, createdByUserId: actor.userId,
    });
    await audit(tx, actor, "Contacto de práctica creado", `Alta de ${fullName} en ${org.name}.`, contactId);
    return contactId;
  });
  const result = (await readContacts(actor.tenantId)).find((contact) => contact.id === id);
  if (!result) fail(500, "No se pudo recuperar el contacto recién creado.");
  res.status(201).json(CreateCrmContactResponse.parse(result));
});
router.patch("/redfp360/crm/contacts/:id", async (req, res): Promise<void> => {
  const params = UpdateCrmContactParams.safeParse(req.params);
  const parsed = UpdateCrmContactBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) fail(400, "Indica los cambios del contacto.");
  const actor = req.auth!;
  const contact = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fp360-crm-contact:${actor.tenantId}`}))`);
    const [previous] = await tx.select().from(fpCrmContacts).where(and(
      eq(fpCrmContacts.id, params.data.id), eq(fpCrmContacts.tenantId, actor.tenantId),
    )).for("update");
    if (!previous) fail(404, "Contacto no encontrado en tu red.");
    const fullName = parsed.data.fullName === undefined
      ? previous.fullName : trimNonBlank(parsed.data.fullName, "El nombre");
    const position = parsed.data.position === undefined
      ? previous.position : trimNonBlank(parsed.data.position, "El cargo");
    await contactDuplicate(tx, actor.tenantId, previous.organizationId, fullName, previous.id);
    const [updated] = await tx.update(fpCrmContacts).set({
      ...parsed.data, fullName, position, updatedAt: new Date(),
    }).where(and(eq(fpCrmContacts.id, previous.id), eq(fpCrmContacts.tenantId, actor.tenantId))).returning();
    await audit(tx, actor, "Contacto de práctica actualizado",
      `${updated.isActive ? "Actualización" : "Archivo"} de ${updated.fullName}; se conservan sus seguimientos.`, updated.id);
    return updated;
  });
  const result = (await readContacts(actor.tenantId)).find((item) => item.id === contact.id);
  if (!result) fail(500, "No se pudo recuperar el contacto actualizado.");
  res.json(UpdateCrmContactResponse.parse(result));
});

async function readOpportunities(tenantId: string) {
  const rows = await db.select({
    id: fpCrmOpportunities.id, organizationId: fpCrmOpportunities.organizationId,
    organizationName: fpOrganizations.name, title: fpCrmOpportunities.title,
    stage: fpCrmOpportunities.stage, estimatedValueCents: fpCrmOpportunities.estimatedValueCents,
    probabilityBasisPoints: fpCrmOpportunities.probabilityBasisPoints,
    expectedDate: fpCrmOpportunities.expectedDate, createdAt: fpCrmOpportunities.createdAt,
    updatedAt: fpCrmOpportunities.updatedAt,
  }).from(fpCrmOpportunities).innerJoin(fpOrganizations, and(
    eq(fpOrganizations.id, fpCrmOpportunities.organizationId),
    eq(fpOrganizations.tenantId, fpCrmOpportunities.tenantId),
  )).where(eq(fpCrmOpportunities.tenantId, tenantId))
    .orderBy(desc(fpCrmOpportunities.updatedAt)).limit(500);
  return ListCrmOpportunitiesResponse.parse(rows.map((row) => ({
    ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  })));
}
router.get("/redfp360/crm/opportunities", async (req, res) => {
  res.json(await readOpportunities(req.auth!.tenantId));
});
router.post("/redfp360/crm/opportunities", async (req, res): Promise<void> => {
  const parsed = CreateCrmOpportunityBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa la oportunidad, el importe y el motivo de alta.");
  const actor = req.auth!;
  const opportunityId = await db.transaction(async (tx) => {
    const org = await activeOrganization(tx, actor.tenantId, parsed.data.organizationId);
    const id = randomUUID();
    await tx.insert(fpCrmOpportunities).values({
      id, tenantId: actor.tenantId, organizationId: org.id,
      title: trimNonBlank(parsed.data.title, "El título"),
      stage: "new", estimatedValueCents: parsed.data.estimatedValueCents,
      probabilityBasisPoints: STAGE_PROBABILITY.new,
      expectedDate: parsed.data.expectedDate, createdByUserId: actor.userId,
    });
    await tx.insert(fpCrmOpportunityHistory).values({
      id: randomUUID(), tenantId: actor.tenantId, opportunityId: id, fromStage: null, toStage: "new",
      reason: trimNonBlank(parsed.data.reason, "El motivo"),
      actorUserId: actor.userId, actorRole: actor.role, simulatedDate: SIMULATED_DATE,
    });
    await audit(tx, actor, "Oportunidad creada", `${parsed.data.title.trim()} · ${org.name}.`, id);
    return id;
  });
  const result = (await readOpportunities(actor.tenantId)).find((item) => item.id === opportunityId);
  if (!result) fail(500, "No se pudo recuperar la oportunidad recién creada.");
  res.status(201).json(CreateCrmOpportunityResponse.parse(result));
});
router.patch("/redfp360/crm/opportunities/:id", async (req, res): Promise<void> => {
  const params = UpdateCrmOpportunityParams.safeParse(req.params);
  const parsed = UpdateCrmOpportunityBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) fail(400, "Indica los cambios de la oportunidad.");
  if (parsed.data.title !== undefined) trimNonBlank(parsed.data.title, "El título");
  const actor = req.auth!;
  const opportunityId = await db.transaction(async (tx) => {
    const [previous] = await tx.select({ id: fpCrmOpportunities.id, title: fpCrmOpportunities.title })
      .from(fpCrmOpportunities).where(and(
        eq(fpCrmOpportunities.id, params.data.id), eq(fpCrmOpportunities.tenantId, actor.tenantId),
      )).for("update");
    if (!previous) fail(404, "Oportunidad no encontrada en tu red.");
    const [updated] = await tx.update(fpCrmOpportunities).set({
      ...parsed.data,
      ...(parsed.data.title !== undefined ? { title: parsed.data.title.trim() } : {}),
      updatedAt: new Date(),
    }).where(eq(fpCrmOpportunities.id, previous.id)).returning({ id: fpCrmOpportunities.id });
    await audit(tx, actor, "Oportunidad actualizada",
      `Ficha de ${parsed.data.title?.trim() ?? previous.title} modificada.`, updated.id);
    return updated.id;
  });
  const result = (await readOpportunities(actor.tenantId)).find((item) => item.id === opportunityId);
  if (!result) fail(500, "No se pudo recuperar la oportunidad actualizada.");
  res.json(UpdateCrmOpportunityResponse.parse(result));
});
router.post("/redfp360/crm/opportunities/:id/stage", async (req, res): Promise<void> => {
  const params = MoveCrmOpportunityParams.safeParse(req.params);
  const parsed = MoveCrmOpportunityBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Indica una fase válida y un motivo.");
  const reason = trimNonBlank(parsed.data.reason, "El motivo");
  const actor = req.auth!;
  await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(fpCrmOpportunities).where(and(
      eq(fpCrmOpportunities.id, params.data.id), eq(fpCrmOpportunities.tenantId, actor.tenantId),
    )).for("update");
    if (!previous) fail(404, "Oportunidad no encontrada en tu red.");
    if (previous.stage === parsed.data.stage) fail(400, "Selecciona una fase distinta para registrar el cambio.");
    await tx.update(fpCrmOpportunities).set({
      stage: parsed.data.stage, probabilityBasisPoints: STAGE_PROBABILITY[parsed.data.stage],
      updatedAt: new Date(),
    }).where(eq(fpCrmOpportunities.id, previous.id));
    await tx.insert(fpCrmOpportunityHistory).values({
      id: randomUUID(), tenantId: actor.tenantId, opportunityId: previous.id,
      fromStage: previous.stage, toStage: parsed.data.stage, reason,
      actorUserId: actor.userId, actorRole: actor.role, simulatedDate: SIMULATED_DATE,
    });
    await audit(tx, actor, "Fase de oportunidad cambiada",
      `${previous.title}: ${previous.stage} → ${parsed.data.stage}. Motivo: ${reason}`, previous.id);
  });
  const result = (await readOpportunities(actor.tenantId)).find((item) => item.id === params.data.id);
  if (!result) fail(500, "No se pudo recuperar la oportunidad actualizada.");
  res.json(MoveCrmOpportunityResponse.parse(result));
});
router.get("/redfp360/crm/opportunity-history", async (req, res) => {
  const rows = await db.select({
    id: fpCrmOpportunityHistory.id, opportunityId: fpCrmOpportunityHistory.opportunityId,
    opportunityTitle: fpCrmOpportunities.title, organizationId: fpCrmOpportunities.organizationId,
    organizationName: fpOrganizations.name, fromStage: fpCrmOpportunityHistory.fromStage,
    toStage: fpCrmOpportunityHistory.toStage, reason: fpCrmOpportunityHistory.reason,
    actorRole: fpCrmOpportunityHistory.actorRole,
    simulatedDate: fpCrmOpportunityHistory.simulatedDate, createdAt: fpCrmOpportunityHistory.createdAt,
  }).from(fpCrmOpportunityHistory)
    .innerJoin(fpCrmOpportunities, and(
      eq(fpCrmOpportunities.id, fpCrmOpportunityHistory.opportunityId),
      eq(fpCrmOpportunities.tenantId, fpCrmOpportunityHistory.tenantId),
    ))
    .innerJoin(fpOrganizations, and(
      eq(fpOrganizations.id, fpCrmOpportunities.organizationId),
      eq(fpOrganizations.tenantId, fpCrmOpportunityHistory.tenantId),
    )).where(eq(fpCrmOpportunityHistory.tenantId, req.auth!.tenantId))
    .orderBy(desc(fpCrmOpportunityHistory.createdAt)).limit(1000);
  res.json(ListCrmOpportunityHistoryResponse.parse(rows.map((row) => ({
    ...row, createdAt: iso(row.createdAt),
  }))));
});

async function readActivities(tenantId: string) {
  const rows = await db.select({
    id: fpCrmActivities.id, opportunityId: fpCrmActivities.opportunityId,
    opportunityTitle: fpCrmOpportunities.title, organizationId: fpCrmOpportunities.organizationId,
    organizationName: fpOrganizations.name, contactId: fpCrmActivities.contactId,
    contactName: fpCrmContacts.fullName, kind: fpCrmActivities.kind,
    description: fpCrmActivities.description, status: fpCrmActivities.status,
    dueDate: fpCrmActivities.dueDate, simulatedDate: fpCrmActivities.simulatedDate,
    actorRole: fpCrmActivities.actorRole, createdAt: fpCrmActivities.createdAt,
    updatedAt: fpCrmActivities.updatedAt,
  }).from(fpCrmActivities)
    .innerJoin(fpCrmOpportunities, and(
      eq(fpCrmOpportunities.id, fpCrmActivities.opportunityId),
      eq(fpCrmOpportunities.tenantId, fpCrmActivities.tenantId),
    ))
    .innerJoin(fpOrganizations, and(
      eq(fpOrganizations.id, fpCrmOpportunities.organizationId),
      eq(fpOrganizations.tenantId, fpCrmActivities.tenantId),
    ))
    .leftJoin(fpCrmContacts, and(
      eq(fpCrmContacts.id, fpCrmActivities.contactId),
      eq(fpCrmContacts.tenantId, fpCrmActivities.tenantId),
    )).where(eq(fpCrmActivities.tenantId, tenantId))
    .orderBy(desc(fpCrmActivities.createdAt)).limit(1000);
  return ListCrmActivitiesResponse.parse(rows.map((row) => ({
    ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt),
  })));
}
router.get("/redfp360/crm/activities", async (req, res) => {
  res.json(await readActivities(req.auth!.tenantId));
});
router.post("/redfp360/crm/activities", async (req, res): Promise<void> => {
  const parsed = CreateCrmActivityBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa la actividad simulada.");
  const actor = req.auth!;
  const id = await db.transaction(async (tx) => {
    const [opportunity] = await tx.select().from(fpCrmOpportunities).where(and(
      eq(fpCrmOpportunities.id, parsed.data.opportunityId), eq(fpCrmOpportunities.tenantId, actor.tenantId),
    ));
    if (!opportunity) fail(404, "La oportunidad no pertenece a tu red.");
    if (parsed.data.contactId) {
      const [contact] = await tx.select({ id: fpCrmContacts.id }).from(fpCrmContacts).where(and(
        eq(fpCrmContacts.id, parsed.data.contactId), eq(fpCrmContacts.tenantId, actor.tenantId),
        eq(fpCrmContacts.organizationId, opportunity.organizationId), eq(fpCrmContacts.isActive, true),
      ));
      if (!contact) fail(400, "Elige un contacto activo de la misma empresa que la oportunidad.");
    }
    const activityId = randomUUID();
    await tx.insert(fpCrmActivities).values({
      id: activityId, tenantId: actor.tenantId, opportunityId: opportunity.id,
      contactId: parsed.data.contactId ?? null, kind: parsed.data.kind,
      description: trimNonBlank(parsed.data.description, "La descripción"),
      dueDate: parsed.data.dueDate ?? null, simulatedDate: parsed.data.simulatedDate,
      actorUserId: actor.userId, actorRole: actor.role,
    });
    await audit(tx, actor, "Seguimiento de oportunidad registrado",
      `${parsed.data.kind}: ${parsed.data.description.trim()}`, activityId);
    return activityId;
  });
  const result = (await readActivities(actor.tenantId)).find((item) => item.id === id);
  if (!result) fail(500, "No se pudo recuperar el seguimiento recién creado.");
  res.status(201).json(CreateCrmActivityResponse.parse(result));
});
router.patch("/redfp360/crm/activities/:id", async (req, res): Promise<void> => {
  const params = UpdateCrmActivityParams.safeParse(req.params);
  const parsed = UpdateCrmActivityBody.safeParse(req.body);
  if (!params.success || !parsed.success || !Object.keys(parsed.data).length) fail(400, "Indica los cambios del seguimiento.");
  if (parsed.data.description !== undefined) trimNonBlank(parsed.data.description, "La descripción");
  const actor = req.auth!;
  const activityId = await db.transaction(async (tx) => {
    const [previous] = await tx.select({ id: fpCrmActivities.id, description: fpCrmActivities.description })
      .from(fpCrmActivities).where(and(
        eq(fpCrmActivities.id, params.data.id), eq(fpCrmActivities.tenantId, actor.tenantId),
      )).for("update");
    if (!previous) fail(404, "Seguimiento no encontrado en tu red.");
    const [updated] = await tx.update(fpCrmActivities).set({
      ...parsed.data,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description.trim() } : {}),
      updatedAt: new Date(),
    }).where(eq(fpCrmActivities.id, previous.id)).returning({ id: fpCrmActivities.id });
    await audit(tx, actor, "Seguimiento CRM actualizado",
      parsed.data.status ? `Estado del seguimiento: ${parsed.data.status}.` : "Ficha del seguimiento actualizada.",
      updated.id);
    return updated.id;
  });
  const result = (await readActivities(actor.tenantId)).find((item) => item.id === activityId);
  if (!result) fail(500, "No se pudo recuperar el seguimiento actualizado.");
  res.json(UpdateCrmActivityResponse.parse(result));
});

const handleCrmError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof CrmError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
};
router.use(handleCrmError);
export default router;

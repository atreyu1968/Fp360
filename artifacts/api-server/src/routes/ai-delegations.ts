import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler } from "express";
import * as api from "@workspace/api-zod";
import {
  db, fpAiDelegations, fpAiDelegationRuns, fpAuthAudit, fpAuthMemberships, fpAuthUsers,
  fpOrganizations, fpAdminAiCoordinatorSettings,
} from "@workspace/db";
import {
  DelegationError, delegationFail as fail, delegationView, lockCompany, runDelegatedCompany, runView,
} from "../lib/ai-delegation";
import { tenantSimulationNetworkMap } from "../lib/organization-simulation-networks";

// Mounted AFTER the administrator, authenticated MFA and same-origin guards.
const router = Router();
router.get("/", async (req, res) => {
  const tenantId = req.auth!.tenantId;
  const [delegations, runs] = await Promise.all([
    db.select().from(fpAiDelegations).where(eq(fpAiDelegations.tenantId, tenantId)),
    db.select().from(fpAiDelegationRuns).where(eq(fpAiDelegationRuns.tenantId, tenantId))
      .orderBy(desc(fpAiDelegationRuns.createdAt)).limit(50),
  ]);
  res.json(api.ListAdminAiDelegationsResponse.parse({ delegations: delegations.map(delegationView), runs: runs.map(runView) }));
});
router.put("/:organizationId", async (req, res) => {
  const actor = req.auth!;
  const organizationId = String(req.params.organizationId);
  const simulationNetworks = await tenantSimulationNetworkMap(actor.tenantId);
  if (!simulationNetworks.has(organizationId)) fail(404, "Empresa no encontrada en tu red.");
  const body = api.UpdateAdminAiDelegationBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa los permisos y la revisión de la delegación.");
  const data = body.data;
  if (data.enabled && !data.allowedOperations.length) fail(400, "Autoriza al menos una operación simulada.");
  const allowedOperations = data.enabled ? [...new Set(data.allowedOperations)].sort() : [];
  const fingerprint = createHash("sha256").update(JSON.stringify({ organizationId, ...data, allowedOperations })).digest("hex");
  const saved = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fp360-admin:${actor.tenantId}`}))`);
    const [admin] = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
      .innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId)).where(and(
        eq(fpAuthMemberships.id, actor.membershipId), eq(fpAuthMemberships.tenantId, actor.tenantId),
        eq(fpAuthMemberships.userId, actor.userId), eq(fpAuthMemberships.role, "administrator"),
        eq(fpAuthMemberships.isActive, true), eq(fpAuthUsers.isActive, true),
      ));
    if (!admin) fail(403, "Tu permiso de administración ha cambiado.");
    await lockCompany(tx, actor.tenantId, organizationId);
    const [company] = await tx.select().from(fpOrganizations).where(and(
      eq(fpOrganizations.id, organizationId), eq(fpOrganizations.tenantId, actor.tenantId),
    )).for("share");
    if (!company) fail(404, "Empresa no encontrada en tu red.");
    const [current] = await tx.select().from(fpAiDelegations).where(and(
      eq(fpAiDelegations.tenantId, actor.tenantId), eq(fpAiDelegations.organizationId, organizationId),
    )).for("update");
    const [prior] = await tx.select().from(fpAuthAudit).where(and(
      eq(fpAuthAudit.tenantId, actor.tenantId), eq(fpAuthAudit.operationId, data.operationId),
    ));
    if (prior) {
      if (prior.actorUserId !== actor.userId || prior.action !== "ai.delegation.updated" || prior.operationFingerprint !== fingerprint) {
        fail(409, "El identificador ya pertenece a otra operación.");
      }
      if (!current) fail(409, "La delegación ya no existe.");
      return current;
    }
    if ((current?.revision ?? 0) !== data.expectedRevision) fail(409, "La delegación cambió en otra sesión. Actualiza la vista.");
    if (data.enabled) {
      if (!company.isActive) fail(409, "No se puede delegar una empresa suspendida.");
      const [settings] = await tx.select().from(fpAdminAiCoordinatorSettings)
        .where(eq(fpAdminAiCoordinatorSettings.tenantId, actor.tenantId)).for("share");
      if (!settings?.enabled) fail(409, "Configura y activa antes el coordinador local.");
      if (settings.provider !== "local") fail(409, "La delegación autónoma requiere el proveedor local; GroqCloud solo genera propuestas supervisadas.");
    }
    const values = {
      enabled: data.enabled, allowedOperations, revision: (current?.revision ?? 0) + 1,
      updatedByUserId: actor.userId, updatedAt: new Date(), nextRunAt: new Date(Date.now() + 300_000),
    };
    const [result] = current
      ? await tx.update(fpAiDelegations).set(values).where(eq(fpAiDelegations.id, current.id)).returning()
      : await tx.insert(fpAiDelegations).values({
        ...values, id: randomUUID(), tenantId: actor.tenantId, organizationId,
        serviceActorId: `ai-service:${randomUUID()}`,
      }).returning();
    // Both revocation and changing permissions invalidate every pending response.
    await tx.update(fpAiDelegationRuns).set({
      status: "cancelled", finishedAt: new Date(), detail: "Administración cambió o revocó la delegación; no se aplicaron cambios.",
    }).where(and(eq(fpAiDelegationRuns.tenantId, actor.tenantId),
      eq(fpAiDelegationRuns.organizationId, organizationId), eq(fpAiDelegationRuns.status, "running")));
    await tx.insert(fpAuthAudit).values({
      id: randomUUID(), tenantId: actor.tenantId, actorUserId: actor.userId,
      action: "ai.delegation.updated", entityId: organizationId, operationId: data.operationId,
      operationFingerprint: fingerprint,
    });
    // An immutable audit entry preserves the exact permission grant, not just its hash.
    await tx.insert(fpAiDelegationRuns).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId, serviceActorId: result.serviceActorId,
      revision: result.revision, operationId: `grant:${data.operationId}`, requestedBy: actor.userId,
      status: "applied", finishedAt: new Date(),
      detail: JSON.stringify({ action: data.enabled ? "delegation_enabled" : "delegation_revoked",
        allowedOperations, previousRevision: current?.revision ?? 0, simulationOnly: true }),
    });
    return result;
  });
  res.json(api.UpdateAdminAiDelegationResponse.parse(delegationView(saved)));
});
router.post("/:organizationId/run", async (req, res) => {
  const body = api.RunAdminAiDelegationBody.safeParse(req.body);
  if (!body.success) fail(400, "El identificador del ciclo no es válido.");
  const actor = req.auth!;
  const organizationId = String(req.params.organizationId);
  const simulationNetworks = await tenantSimulationNetworkMap(actor.tenantId);
  if (!simulationNetworks.has(organizationId)) fail(404, "Empresa no encontrada en tu red.");
  const run = await runDelegatedCompany(actor.tenantId, organizationId, body.data.operationId, actor.userId);
  res.json(api.RunAdminAiDelegationResponse.parse(runView(run)));
});
const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof DelegationError) { res.status(error.status).json({ message: error.message }); return; }
  next(error);
};
router.use(errorHandler);
export default router;

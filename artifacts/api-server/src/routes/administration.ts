import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import * as api from "@workspace/api-zod";
import {
  AcceptExistingAccountInvitationBody, AcceptExistingAccountInvitationResponse,
  RejectExistingAccountInvitationBody, RejectExistingAccountInvitationResponse,
  AcceptInvitationBody, AcceptInvitationResponse, CreateAdminInvitationBody,
  CreateAdminInvitationResponse, InspectInvitationBody, InspectInvitationResponse,
  GetAdminSystemOverviewResponse, CreateAdminOrganizationBody, CreateAdminOrganizationResponse,
  ActOnAdminOrganizationBody, ActOnAdminOrganizationResponse, EvaluateAdminPolicyBody,
  EvaluateAdminPolicyResponse, CreateAdminScenarioVersionBody, CreateAdminScenarioVersionResponse,
  CreateAdminBackupExerciseBody, CreateAdminBackupExerciseResponse, CheckAdminIntegrationBody,
  CheckAdminIntegrationResponse, ListAdminPrivilegeRequestsResponse,
  CreateAdminPrivilegeRequestBody, CreateAdminPrivilegeRequestResponse,
  ActOnAdminPrivilegeRequestBody, ActOnAdminPrivilegeRequestResponse,
  ListAdminAuditResponse, ListAdminInvitationsResponse, ListAdminUsersResponse,
  RevokeAdminInvitationParams, UpdateAdminUserBody, UpdateAdminUserParams,
  UpdateAdminUserResponse,
} from "@workspace/api-zod";
import {
  db, fpAdminBackupExercises, fpAdminConfigVersions, fpAdminPrivilegeRequests,
  fpAdminAiCoordinatorSettings, fpAuthAudit, fpAuthInvitations, fpAuthMemberships, fpAuthSessions,
  fpAuthUsers, fpDocuments, fpOrganizations, fpSimulationCampaigns,
} from "@workspace/db";
import { hashPassword } from "../lib/passwords";
import { checkLocalAiEndpoint, normalizeLocalAiBaseUrl } from "../lib/local-ai";
import { hashSessionToken, issueAuthSession, requireAuth, requireSameOrigin, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Invitation = typeof fpAuthInvitations.$inferSelect;
class AccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new AccessError(status, message); }
const administratorOnly: RequestHandler = (req, res, next) => {
  if (req.auth?.role !== "administrator") {
    res.status(403).json({ message: "Se requiere un perfil de administración." });
    return;
  }
  next();
};

function invitationView(row: Invitation) {
  return {
    id: row.id, email: row.email, role: row.role, organizationId: row.organizationId,
    status: row.acceptedAt ? "accepted" : row.rejectedAt ? "rejected" : row.revokedAt ? "revoked" : row.expiresAt <= new Date() ? "expired" : "pending",
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(),
  };
}
function pendingInvitation(token: string) {
  return and(
    eq(fpAuthInvitations.tokenHash, hashSessionToken(`invite:${token}`)),
    isNull(fpAuthInvitations.acceptedAt), isNull(fpAuthInvitations.rejectedAt), isNull(fpAuthInvitations.revokedAt),
    gt(fpAuthInvitations.expiresAt, new Date()),
  );
}
async function lockAdministration(tx: Transaction, actor: AuthContext) {
  // Serialize membership changes so concurrent demotions cannot remove all administrators.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fp360-admin:${actor.tenantId}`}))`);
  const [current] = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
    .innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
    .where(and(
      eq(fpAuthMemberships.id, actor.membershipId),
      eq(fpAuthMemberships.tenantId, actor.tenantId),
      eq(fpAuthMemberships.role, "administrator"),
      eq(fpAuthMemberships.isActive, true), eq(fpAuthUsers.isActive, true),
    ));
  if (!current) fail(403, "Tu permiso de administración ha cambiado. Vuelve a iniciar sesión.");
}
async function checkOrganization(tx: Transaction, tenantId: string, organizationId?: string | null) {
  if (!organizationId) return;
  const [organization] = await tx.select({ id: fpOrganizations.id }).from(fpOrganizations)
    .where(and(eq(fpOrganizations.id, organizationId), eq(fpOrganizations.tenantId, tenantId), eq(fpOrganizations.isActive, true)))
    .for("share");
  if (!organization) fail(400, "Selecciona una organización activa de tu red.");
}
function requestFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function priorAdminOperation(
  tx: Transaction,
  actor: AuthContext,
  operationId: string,
  action: string,
  fingerprint: string,
) {
  const [prior] = await tx.select().from(fpAuthAudit).where(and(
    eq(fpAuthAudit.tenantId, actor.tenantId),
    eq(fpAuthAudit.operationId, operationId),
  )).for("update");
  if (!prior) return null;
  if (prior.actorUserId !== actor.userId || prior.action !== action || prior.operationFingerprint !== fingerprint) {
    fail(409, "El identificador de operación ya se usó para otra acción.");
  }
  return prior;
}
async function audit(
  tx: Transaction,
  tenantId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  operationId?: string,
  operationFingerprint?: string,
) {
  await tx.insert(fpAuthAudit).values({
    id: randomUUID(), tenantId, actorUserId, action, entityId,
    operationId: operationId ?? null,
    operationFingerprint: operationFingerprint ?? null,
  });
}
async function managedUser(tenantId: string, userId: string) {
  const [row] = await db.select({
    id: fpAuthUsers.id, email: fpAuthUsers.email, displayName: fpAuthUsers.displayName,
    role: fpAuthMemberships.role, organizationId: fpAuthMemberships.organizationId,
    isActive: fpAuthMemberships.isActive, createdAt: fpAuthMemberships.createdAt,
    mfaEnabledAt: fpAuthUsers.mfaEnabledAt,
  }).from(fpAuthMemberships).innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
    .where(and(eq(fpAuthMemberships.tenantId, tenantId), eq(fpAuthUsers.id, userId)));
  if (!row) fail(404, "Usuario no encontrado en tu red.");
  return { ...row, mfaEnabled: Boolean(row.mfaEnabledAt), createdAt: row.createdAt.toISOString() };
}

function organizationView(row: typeof fpOrganizations.$inferSelect) {
  return { id: row.id, name: row.name, center: row.center, island: row.island, role: row.role, isActive: row.isActive };
}

const integrationCatalog = [
  { id: "moodle-lti", name: "Moodle / LTI", description: "Conexión educativa. No configurada en esta simulación." },
  { id: "smtp", name: "SMTP autorizado", description: "Correo de prueba. No se envían mensajes desde este panel." },
  { id: "public-api", name: "API de servicios", description: "Estado interno del servicio; no se muestran claves." },
  { id: "replit-export", name: "Exportación Replit", description: "Preparación de despliegue. No publica cambios." },
] as const;

const policyMatrix = [
  { role: "administrator", label: "Administración", permissions: ["system_admin", "network_admin", "manage_center_accounts", "manage_scenario_settings", "run_backup_exercise", "manage_intercenter_campaigns", "manage_company_operations", "work_assigned_cases"] },
  { role: "promoter", label: "Promotor/a", permissions: ["manage_intercenter_campaigns"] },
  { role: "teacher", label: "Profesorado", permissions: ["manage_intercenter_campaigns", "manage_company_operations", "work_assigned_cases"] },
  { role: "team_manager", label: "Responsable de equipo", permissions: ["manage_company_operations", "work_assigned_cases"] },
  { role: "student", label: "Alumnado", permissions: ["work_assigned_cases"] },
  { role: "mentor", label: "Mentor/a", permissions: ["work_assigned_cases"] },
] as const;

router.use("/auth/invitations", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}, rateLimit({
  windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false,
  handler: (_req, res) => { res.status(429).json({ message: "Demasiados intentos. Espera unos minutos." }); },
}), requireSameOrigin);

router.post("/auth/invitations/inspect", async (req, res): Promise<void> => {
  const body = InspectInvitationBody.safeParse(req.body);
  if (!body.success) fail(400, "El enlace de invitación no es válido.");
  const [invitation] = await db.select().from(fpAuthInvitations).where(pendingInvitation(body.data.token));
  if (!invitation) fail(410, "La invitación ha caducado, se ha revocado o ya se ha utilizado.");
  const [[user], [organization]] = await Promise.all([
    db.select({ id: fpAuthUsers.id }).from(fpAuthUsers).where(eq(fpAuthUsers.email, invitation.email)).limit(1),
    invitation.organizationId
      ? db.select({ name: fpOrganizations.name }).from(fpOrganizations).where(and(
        eq(fpOrganizations.id, invitation.organizationId),
        eq(fpOrganizations.tenantId, invitation.tenantId),
      )).limit(1)
      : Promise.resolve([]),
  ]);
  res.json(InspectInvitationResponse.parse({
    email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString(),
    tenantId: invitation.tenantId, organizationName: organization?.name ?? null,
    existingAccount: Boolean(user),
  }));
});

router.post("/auth/invitations/accept-existing", requireAuth, requireSameOrigin, async (req, res): Promise<void> => {
  const body = AcceptExistingAccountInvitationBody.safeParse(req.body);
  if (!body.success) fail(400, "El enlace de invitación no es válido.");
  const actor = req.auth!;
  const identity = await db.transaction(async (tx) => {
    const [invitation] = await tx.select().from(fpAuthInvitations)
      .where(pendingInvitation(body.data.token)).for("update");
    if (!invitation) fail(410, "La invitación ha caducado, se ha revocado o ya se ha utilizado.");
    if (!actor.sessionId) fail(401, "Inicia sesión de nuevo para aceptar la invitación.");
    const [signedIn] = await tx.select({
      email: fpAuthUsers.email, displayName: fpAuthUsers.displayName,
      mfaEnabledAt: fpAuthUsers.mfaEnabledAt,
    }).from(fpAuthSessions)
      .innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthSessions.userId))
      .innerJoin(fpAuthMemberships, eq(fpAuthMemberships.id, fpAuthSessions.membershipId))
      .where(and(
        eq(fpAuthSessions.id, actor.sessionId),
        eq(fpAuthSessions.userId, actor.userId),
        eq(fpAuthSessions.membershipId, actor.membershipId),
        gt(fpAuthSessions.expiresAt, new Date()),
        isNull(fpAuthSessions.revokedAt),
        eq(fpAuthUsers.isActive, true),
        eq(fpAuthMemberships.isActive, true),
      )).for("update");
    if (!signedIn) fail(401, "La sesión ya no está activa. Inicia sesión de nuevo.");
    if (signedIn.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
      fail(403, "Inicia sesión con la cuenta indicada en la invitación.");
    }
    await checkOrganization(tx, invitation.tenantId, invitation.organizationId);
    const [existing] = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
      .where(and(
        eq(fpAuthMemberships.userId, actor.userId),
        eq(fpAuthMemberships.tenantId, invitation.tenantId),
      )).for("update");
    if (existing) fail(409, "Esta cuenta ya tiene una pertenencia a la red. No se ha cambiado.");
    const membershipId = randomUUID();
    const [membership] = await tx.insert(fpAuthMemberships).values({
      id: membershipId, userId: actor.userId, tenantId: invitation.tenantId,
      organizationId: invitation.organizationId, role: invitation.role,
    }).onConflictDoNothing().returning({ id: fpAuthMemberships.id });
    if (!membership) fail(409, "Esta cuenta ya tiene una pertenencia a la red. No se ha cambiado.");
    await tx.update(fpAuthInvitations).set({ acceptedAt: new Date() })
      .where(eq(fpAuthInvitations.id, invitation.id));
    await audit(tx, invitation.tenantId, actor.userId, "invitation.accepted_existing", invitation.id);
    await audit(tx, invitation.tenantId, actor.userId, "membership.created_by_invitation", membership.id);
    return {
      id: actor.userId, email: signedIn.email, displayName: signedIn.displayName,
      tenantId: invitation.tenantId,
      ...(invitation.organizationId ? { organizationId: invitation.organizationId } : {}),
      role: invitation.role, membershipId,
      mfaSetupRequired: invitation.role === "administrator" && !signedIn.mfaEnabledAt,
      mfaVerificationRequired: invitation.role === "administrator" && Boolean(signedIn.mfaEnabledAt),
    };
  });
  await issueAuthSession(identity.id, identity.membershipId, res);
  const { membershipId: _membershipId, ...output } = identity;
  res.json(AcceptExistingAccountInvitationResponse.parse(output));
});

router.post("/auth/invitations/reject-existing", requireAuth, requireSameOrigin, async (req, res): Promise<void> => {
  const body = RejectExistingAccountInvitationBody.safeParse(req.body);
  if (!body.success) fail(400, "El enlace de invitación no es válido.");
  const actor = req.auth!;
  await db.transaction(async (tx) => {
    const [invitation] = await tx.select().from(fpAuthInvitations)
      .where(pendingInvitation(body.data.token)).for("update");
    if (!invitation) fail(410, "La invitación ha caducado, se ha revocado o ya se ha utilizado.");
    if (actor.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
      fail(403, "Inicia sesión con la cuenta indicada en la invitación.");
    }
    await tx.update(fpAuthInvitations).set({ rejectedAt: new Date() })
      .where(eq(fpAuthInvitations.id, invitation.id));
    await audit(tx, invitation.tenantId, actor.userId, "invitation.rejected", invitation.id);
  });
  res.status(204).end();
});

router.post("/auth/invitations/accept", async (req, res): Promise<void> => {
  const body = AcceptInvitationBody.safeParse(req.body);
  if (!body.success || !body.data.displayName.trim()) fail(400, "Revisa el nombre y la contraseña (mínimo 12 caracteres).");
  const [pending] = await db.select({ id: fpAuthInvitations.id }).from(fpAuthInvitations).where(pendingInvitation(body.data.token));
  if (!pending) fail(410, "La invitación ha caducado, se ha revocado o ya se ha utilizado.");
  const passwordHash = await hashPassword(body.data.password);
  const identity = await db.transaction(async (tx) => {
    const [invitation] = await tx.select().from(fpAuthInvitations).where(pendingInvitation(body.data.token)).for("update");
    if (!invitation) fail(410, "La invitación ha caducado, se ha revocado o ya se ha utilizado.");
    await checkOrganization(tx, invitation.tenantId, invitation.organizationId);
    const userId = randomUUID();
    const [user] = await tx.insert(fpAuthUsers).values({
      id: userId, email: invitation.email, displayName: body.data.displayName.trim(), passwordHash,
    }).onConflictDoNothing().returning();
    if (!user) fail(409, "Este correo ya dispone de una cuenta. Inicia sesión con ella.");
    const membershipId = randomUUID();
    await tx.insert(fpAuthMemberships).values({
      id: membershipId, userId, tenantId: invitation.tenantId,
      organizationId: invitation.organizationId, role: invitation.role,
    });
    await tx.update(fpAuthInvitations).set({ acceptedAt: new Date() }).where(eq(fpAuthInvitations.id, invitation.id));
    await audit(tx, invitation.tenantId, userId, "invitation.accepted", invitation.id);
    return {
      id: userId, email: user.email, displayName: user.displayName, tenantId: invitation.tenantId,
      ...(invitation.organizationId ? { organizationId: invitation.organizationId } : {}),
      role: invitation.role, membershipId,
      mfaSetupRequired: invitation.role === "administrator",
      mfaVerificationRequired: false,
    };
  });
  await issueAuthSession(identity.id, identity.membershipId, res);
  const { membershipId: _membershipId, ...output } = identity;
  res.status(201).json(AcceptInvitationResponse.parse(output));
});

router.use("/admin", requireAuth, administratorOnly, requireSameOrigin);

router.get("/admin/users", async (req, res): Promise<void> => {
  const users = await db.select({
    id: fpAuthUsers.id, email: fpAuthUsers.email, displayName: fpAuthUsers.displayName,
    role: fpAuthMemberships.role, organizationId: fpAuthMemberships.organizationId,
    isActive: fpAuthMemberships.isActive, createdAt: fpAuthMemberships.createdAt,
    mfaEnabledAt: fpAuthUsers.mfaEnabledAt,
  }).from(fpAuthMemberships).innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
    .where(eq(fpAuthMemberships.tenantId, req.auth!.tenantId)).orderBy(fpAuthUsers.displayName);
  res.json(ListAdminUsersResponse.parse(users.map((row) => ({
    ...row, mfaEnabled: Boolean(row.mfaEnabledAt), createdAt: row.createdAt.toISOString(),
  }))));
});

router.patch("/admin/users/:id", async (req, res): Promise<void> => {
  const params = UpdateAdminUserParams.safeParse(req.params);
  const body = UpdateAdminUserBody.safeParse(req.body);
  if (!params.success || !body.success || !Object.keys(body.data).length) fail(400, "No hay cambios válidos.");
  const actor = req.auth!;
  await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const [target] = await tx.select().from(fpAuthMemberships)
      .where(and(eq(fpAuthMemberships.userId, params.data.id), eq(fpAuthMemberships.tenantId, actor.tenantId)))
      .for("update");
    if (!target) fail(404, "Usuario no encontrado en tu red.");
    const proposedRole = body.data.role ?? target.role;
    if (
      (proposedRole !== target.role && (proposedRole === "administrator" || target.role === "administrator")) ||
      (target.role === "administrator" && body.data.isActive === false)
    ) {
      fail(409, "Los permisos globales requieren una aprobación de otra persona administradora.");
    }
    if (target.userId === actor.userId && (body.data.role !== undefined || body.data.isActive !== undefined)) {
      fail(400, "No puedes cambiar tu propio perfil ni desactivar tu acceso.");
    }
    await checkOrganization(tx, actor.tenantId, body.data.organizationId);
    const role = body.data.role ?? target.role;
    const isActive = body.data.isActive ?? target.isActive;
    if (target.role === "administrator" && target.isActive && (role !== "administrator" || !isActive)) {
      const admins = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
        .innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
        .where(and(eq(fpAuthMemberships.tenantId, actor.tenantId), eq(fpAuthMemberships.role, "administrator"),
          eq(fpAuthMemberships.isActive, true), eq(fpAuthUsers.isActive, true)));
      if (admins.length <= 1) fail(409, "La red debe conservar al menos una cuenta administradora activa.");
    }
    await tx.update(fpAuthMemberships).set(body.data).where(eq(fpAuthMemberships.id, target.id));
    if (target.userId !== actor.userId) {
      await tx.update(fpAuthSessions).set({ revokedAt: new Date() }).where(and(
        eq(fpAuthSessions.membershipId, target.id), isNull(fpAuthSessions.revokedAt),
      ));
    }
    await audit(tx, actor.tenantId, actor.userId, "user.updated", target.userId);
  });
  res.json(UpdateAdminUserResponse.parse(await managedUser(actor.tenantId, params.data.id)));
});

router.get("/admin/invitations", async (req, res): Promise<void> => {
  const rows = await db.select().from(fpAuthInvitations)
    .where(eq(fpAuthInvitations.tenantId, req.auth!.tenantId)).orderBy(desc(fpAuthInvitations.createdAt));
  res.json(ListAdminInvitationsResponse.parse(rows.map(invitationView)));
});

router.post("/admin/invitations", async (req, res): Promise<void> => {
  const body = CreateAdminInvitationBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa el correo, el perfil y la organización.");
  if (body.data.role === "administrator") {
    fail(409, "Las invitaciones de administración deben solicitarse para revisión por otra persona administradora.");
  }
  const actor = req.auth!;
  const token = randomBytes(32).toString("base64url");
  const email = body.data.email.trim().toLowerCase();
  const invitation = await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    await checkOrganization(tx, actor.tenantId, body.data.organizationId);
    const [existing] = await tx.select({ id: fpAuthUsers.id }).from(fpAuthUsers).where(eq(fpAuthUsers.email, email));
    if (existing) {
      const [membership] = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
        .where(and(
          eq(fpAuthMemberships.userId, existing.id),
          eq(fpAuthMemberships.tenantId, actor.tenantId),
        ));
      if (membership) fail(409, "Esta cuenta ya pertenece a la red.");
    }
    const [pending] = await tx.select({ id: fpAuthInvitations.id }).from(fpAuthInvitations).where(and(
      eq(fpAuthInvitations.tenantId, actor.tenantId), eq(fpAuthInvitations.email, email),
      isNull(fpAuthInvitations.acceptedAt), isNull(fpAuthInvitations.rejectedAt),
      isNull(fpAuthInvitations.revokedAt), gt(fpAuthInvitations.expiresAt, new Date()),
    ));
    if (pending) fail(409, "Ya hay una invitación pendiente para este correo. Revócala antes de crear otra.");
    const [created] = await tx.insert(fpAuthInvitations).values({
      id: randomUUID(), tenantId: actor.tenantId, email, role: body.data.role,
      organizationId: body.data.organizationId ?? null, createdBy: actor.userId,
      tokenHash: hashSessionToken(`invite:${token}`),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    }).returning();
    await audit(tx, actor.tenantId, actor.userId, "invitation.created", created.id);
    return created;
  });
  res.status(201).json(CreateAdminInvitationResponse.parse({ invitation: invitationView(invitation), token }));
});

router.delete("/admin/invitations/:id", async (req, res): Promise<void> => {
  const params = RevokeAdminInvitationParams.safeParse(req.params);
  if (!params.success) fail(400, "Invitación no válida.");
  const actor = req.auth!;
  await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const [invitation] = await tx.select().from(fpAuthInvitations)
      .where(and(eq(fpAuthInvitations.id, params.data.id), eq(fpAuthInvitations.tenantId, actor.tenantId))).for("update");
    if (!invitation) fail(404, "Invitación no encontrada.");
    if (invitation.acceptedAt || invitation.rejectedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) fail(409, "La invitación ya no está pendiente.");
    await tx.update(fpAuthInvitations).set({ revokedAt: new Date() }).where(eq(fpAuthInvitations.id, invitation.id));
    await audit(tx, actor.tenantId, actor.userId, "invitation.revoked", invitation.id);
  });
  res.status(204).end();
});

router.get("/admin/audit", async (req, res): Promise<void> => {
  const rows = await db.select({
    id: fpAuthAudit.id, actorUserId: fpAuthAudit.actorUserId, action: fpAuthAudit.action,
    entityId: fpAuthAudit.entityId, createdAt: fpAuthAudit.createdAt,
  }).from(fpAuthAudit).where(eq(fpAuthAudit.tenantId, req.auth!.tenantId))
    .orderBy(desc(fpAuthAudit.createdAt)).limit(100);
  res.json(ListAdminAuditResponse.parse(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))));
});

function scenarioVersionView(row: typeof fpAdminConfigVersions.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
function backupExerciseView(row: typeof fpAdminBackupExercises.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
function privilegeRequestView(row: typeof fpAdminPrivilegeRequests.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}
function adminDatabaseStatus() {
  return db.execute(sql`SELECT 1`).then(() => "ok" as const).catch(() => "unavailable" as const);
}

router.get("/admin/system/overview", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
  const [
    organizations,
    memberships,
    auditRows,
    scenarioRows,
    backupRows,
    requestRows,
    aiSettings,
    databaseStatus,
    integrationChecks,
  ] = await Promise.all([
    db.select().from(fpOrganizations).where(eq(fpOrganizations.tenantId, tenantId)).orderBy(fpOrganizations.name),
    db.select({
      userId: fpAuthUsers.id,
      isActive: fpAuthMemberships.isActive,
      userActive: fpAuthUsers.isActive,
    }).from(fpAuthMemberships).innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
      .where(eq(fpAuthMemberships.tenantId, tenantId)),
    db.select({ id: fpAuthAudit.id }).from(fpAuthAudit).where(eq(fpAuthAudit.tenantId, tenantId)),
    db.select().from(fpAdminConfigVersions).where(eq(fpAdminConfigVersions.tenantId, tenantId))
      .orderBy(desc(fpAdminConfigVersions.version)).limit(20),
    db.select().from(fpAdminBackupExercises).where(eq(fpAdminBackupExercises.tenantId, tenantId))
      .orderBy(desc(fpAdminBackupExercises.createdAt)).limit(20),
    db.select().from(fpAdminPrivilegeRequests).where(eq(fpAdminPrivilegeRequests.tenantId, tenantId))
      .orderBy(desc(fpAdminPrivilegeRequests.createdAt)).limit(50),
    db.select().from(fpAdminAiCoordinatorSettings).where(eq(fpAdminAiCoordinatorSettings.tenantId, tenantId)).limit(1),
    adminDatabaseStatus(),
    Promise.all(integrationCatalog.map(async (integration) => {
      const [latest] = await db.select({ createdAt: fpAuthAudit.createdAt }).from(fpAuthAudit).where(and(
        eq(fpAuthAudit.tenantId, tenantId),
        eq(fpAuthAudit.action, `integration.check.${integration.id}`),
      )).orderBy(desc(fpAuthAudit.createdAt)).limit(1);
      return { id: integration.id, checkedAt: latest?.createdAt.toISOString() ?? null };
    })),
  ]);
  const memory = process.memoryUsage();
  const integrations = integrationCatalog.map((integration) => ({
    ...integration,
    status: integrationChecks.find((check) => check.id === integration.id)?.checkedAt
      ? "simulation_only" as const
      : "not_configured" as const,
    checkedAt: integrationChecks.find((check) => check.id === integration.id)?.checkedAt ?? null,
    simulationOnly: true,
  }));
  res.json(GetAdminSystemOverviewResponse.parse({
    health: {
      apiStatus: "ok",
      databaseStatus,
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      memoryRssBytes: Math.max(0, Math.floor(memory.rss)),
      heapUsedBytes: Math.max(0, Math.floor(memory.heapUsed)),
      heapTotalBytes: Math.max(0, Math.floor(memory.heapTotal)),
    },
    counts: {
      organizations: organizations.length,
      activeOrganizations: organizations.filter((row) => row.isActive).length,
      users: memberships.length,
      activeUsers: memberships.filter((row) => row.isActive && row.userActive).length,
      auditEvents: auditRows.length,
      scenarioVersions: scenarioRows.length,
      backupExercises: backupRows.length,
    },
    organizations: organizations.map(organizationView),
    scenarioVersions: scenarioRows.map(scenarioVersionView),
    backupExercises: backupRows.map(backupExerciseView),
    privilegeRequests: requestRows.map(privilegeRequestView),
    integrations,
    aiCoordinator: {
      configured: Boolean(aiSettings[0]?.baseUrl && aiSettings[0]?.model),
      enabled: aiSettings[0]?.enabled ?? false,
      baseUrl: aiSettings[0]?.baseUrl ?? "",
      model: aiSettings[0]?.model ?? "",
      updatedAt: aiSettings[0]?.updatedAt.toISOString() ?? null,
    },
    policyMatrix,
    simulationOnly: true,
  }));

router.put("/admin/ai-coordinator/settings", async (req, res): Promise<void> => {
  const body = api.UpdateAdminAiCoordinatorSettingsBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa la URL, el modelo y el estado del coordinador.");
  const actor = req.auth!;
  let baseUrl = body.data.baseUrl.trim();
  const model = body.data.model.trim();
  if (body.data.enabled && (!baseUrl || !model)) fail(400, "Indica una URL local y un modelo antes de activar el coordinador.");
  if (baseUrl) {
    try {
      baseUrl = normalizeLocalAiBaseUrl(baseUrl);
    } catch (error) {
      fail(400, error instanceof Error ? error.message : "La URL local no es válida.");
    }
  }
  if (body.data.enabled && model.length < 1) fail(400, "Indica el nombre del modelo local.");
  const action = "ai.coordinator.settings.updated";
  const fingerprint = requestFingerprint({ enabled: body.data.enabled, baseUrl, model });
  await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    if (await priorAdminOperation(tx, actor, body.data.operationId, action, fingerprint)) return;
    await tx.insert(fpAdminAiCoordinatorSettings).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      baseUrl,
      model,
      enabled: body.data.enabled,
      createdByUserId: actor.userId,
      updatedByUserId: actor.userId,
    }).onConflictDoUpdate({
      target: fpAdminAiCoordinatorSettings.tenantId,
      set: {
        baseUrl,
        model,
        enabled: body.data.enabled,
        updatedByUserId: actor.userId,
        updatedAt: new Date(),
      },
    });
    await audit(tx, actor.tenantId, actor.userId, action, "ai-coordinator", body.data.operationId, fingerprint);
  });
  const [saved] = await db.select().from(fpAdminAiCoordinatorSettings)
    .where(eq(fpAdminAiCoordinatorSettings.tenantId, actor.tenantId)).limit(1);
  res.json(api.UpdateAdminAiCoordinatorSettingsResponse.parse({
    configured: Boolean(saved?.baseUrl && saved?.model),
    enabled: saved?.enabled ?? false,
    baseUrl: saved?.baseUrl ?? "",
    model: saved?.model ?? "",
    updatedAt: saved?.updatedAt.toISOString() ?? null,
  }));
});

router.post("/admin/ai-coordinator/test", async (req, res): Promise<void> => {
  const body = api.TestAdminAiCoordinatorConnectionBody.safeParse(req.body);
  if (!body.success) fail(400, "La solicitud de prueba no es válida.");
  const actor = req.auth!;
  const [settings] = await db.select().from(fpAdminAiCoordinatorSettings)
    .where(eq(fpAdminAiCoordinatorSettings.tenantId, actor.tenantId)).limit(1);
  if (!settings?.enabled || !settings.baseUrl || !settings.model) {
    fail(409, "Configura y activa primero un endpoint local de IA.");
  }
  const action = "ai.coordinator.connection.tested";
  const fingerprint = requestFingerprint({ model: settings.model });
  const [priorTest] = await db.select().from(fpAuthAudit).where(and(
    eq(fpAuthAudit.tenantId, actor.tenantId),
    eq(fpAuthAudit.operationId, body.data.operationId),
  )).limit(1);
  if (priorTest) {
    if (priorTest.action !== action || priorTest.operationFingerprint !== fingerprint) {
      fail(409, "El identificador ya se utilizó para otra operación.");
    }
    res.json(api.TestAdminAiCoordinatorConnectionResponse.parse({
      connected: true,
      model: settings.model,
      checkedAt: priorTest.createdAt.toISOString(),
      message: "La prueba ya se completó correctamente.",
    }));
    return;
  }
  try {
    await checkLocalAiEndpoint({ baseUrl: settings.baseUrl, model: settings.model });
  } catch {
    req.log.warn({ tenantId: actor.tenantId }, "Local AI endpoint check failed");
    fail(502, "No se pudo conectar con el endpoint local. Comprueba su disponibilidad y la ruta /models.");
  }
  const checkedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    if (await priorAdminOperation(tx, actor, body.data.operationId, action, fingerprint)) return;
    await audit(
      tx, actor.tenantId, actor.userId, action,
      "ai-coordinator", body.data.operationId, fingerprint,
    );
  });
  res.json(api.TestAdminAiCoordinatorConnectionResponse.parse({
    connected: true,
    model: settings.model,
    checkedAt,
    message: "La API local respondió correctamente.",
  }));
});
});

router.post("/admin/organizations", async (req, res): Promise<void> => {
  const body = CreateAdminOrganizationBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa el nombre, centro, isla y actividad de la empresa.");
  const actor = req.auth!;
  const operationFingerprint = requestFingerprint(body.data);
  const organization = await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const prior = await priorAdminOperation(
      tx, actor, body.data.operationId, "organization.created", operationFingerprint,
    );
    if (prior) {
      const [existing] = await tx.select().from(fpOrganizations).where(and(
        eq(fpOrganizations.id, prior.entityId), eq(fpOrganizations.tenantId, actor.tenantId),
      )).limit(1);
      if (!existing) fail(409, "La organización de esta operación ya no está disponible.");
      return existing;
    }
    const [duplicate] = await tx.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
      eq(fpOrganizations.tenantId, actor.tenantId),
      eq(fpOrganizations.name, body.data.name.trim()),
      eq(fpOrganizations.center, body.data.center.trim()),
      eq(fpOrganizations.island, body.data.island.trim()),
    )).limit(1);
    if (duplicate) fail(409, "Ya existe una empresa con ese nombre en el centro indicado.");
    const [created] = await tx.insert(fpOrganizations).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      name: body.data.name.trim(),
      center: body.data.center.trim(),
      island: body.data.island.trim(),
      role: body.data.role,
      isActive: true,
    }).returning();
    await audit(
      tx, actor.tenantId, actor.userId, "organization.created", created.id,
      body.data.operationId, operationFingerprint,
    );
    return created;
  });
  res.status(201).json(CreateAdminOrganizationResponse.parse(organizationView(organization)));
});

router.post("/admin/organizations/:id/action", async (req, res): Promise<void> => {
  const params = UpdateAdminUserParams.safeParse({ id: req.params.id });
  const body = ActOnAdminOrganizationBody.safeParse(req.body);
  if (!params.success || !body.success) fail(400, "La acción sobre el centro no es válida.");
  const actor = req.auth!;
  const operationFingerprint = requestFingerprint({ id: params.data.id, ...body.data });
  const organization = await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const actionName = `organization.${body.data.action}`;
    const prior = await priorAdminOperation(
      tx, actor, body.data.operationId, actionName, operationFingerprint,
    );
    if (prior) {
      if (prior.entityId !== params.data.id) fail(409, "El identificador de operación pertenece a otra empresa.");
      const [existing] = await tx.select().from(fpOrganizations).where(and(
        eq(fpOrganizations.id, params.data.id), eq(fpOrganizations.tenantId, actor.tenantId),
      )).limit(1);
      if (!existing) fail(404, "Empresa no encontrada.");
      return existing;
    }
    const [target] = await tx.select().from(fpOrganizations).where(and(
      eq(fpOrganizations.id, params.data.id), eq(fpOrganizations.tenantId, actor.tenantId),
    )).for("update");
    if (!target) fail(404, "Empresa no encontrada en esta red.");
    const activating = body.data.action === "activate";
    if (!activating && target.isActive) {
      const [adminMembership] = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
        .innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
        .where(and(
          eq(fpAuthMemberships.tenantId, actor.tenantId),
          eq(fpAuthMemberships.organizationId, target.id),
          eq(fpAuthMemberships.role, "administrator"),
          eq(fpAuthMemberships.isActive, true),
          eq(fpAuthUsers.isActive, true),
        )).limit(1);
      if (adminMembership) fail(409, "Traslada la cuenta administradora antes de suspender o archivar esta empresa.");
      const memberships = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
        .where(and(
          eq(fpAuthMemberships.tenantId, actor.tenantId),
          eq(fpAuthMemberships.organizationId, target.id),
        ));
      if (memberships.length) {
        await tx.update(fpAuthSessions).set({ revokedAt: new Date() }).where(and(
          inArray(fpAuthSessions.membershipId, memberships.map((membership) => membership.id)),
          isNull(fpAuthSessions.revokedAt),
        ));
      }
    }
    const [updated] = await tx.update(fpOrganizations).set({ isActive: activating }).where(and(
      eq(fpOrganizations.id, target.id), eq(fpOrganizations.tenantId, actor.tenantId),
    )).returning();
    await audit(
      tx, actor.tenantId, actor.userId, actionName, target.id,
      body.data.operationId, operationFingerprint,
    );
    return updated;
  });
  res.json(ActOnAdminOrganizationResponse.parse(organizationView(organization)));
});

router.post("/admin/policies/evaluate", async (req, res): Promise<void> => {
  const body = EvaluateAdminPolicyBody.safeParse(req.body);
  if (!body.success) fail(400, "Selecciona un perfil y un permiso.");
  const policy = policyMatrix.find((entry) => entry.role === body.data.role);
  const allowed = Boolean(policy?.permissions.some((permission: string) => permission === body.data.permission));
  const scope = body.data.role === "administrator"
    ? "Red actual; siempre sujeto a sesión y tenant."
    : body.data.role === "mentor"
      ? "Solo casos anonimizados asignados."
      : body.data.role === "student"
        ? "Empresa propia y tareas asignadas."
        : "Centro o campaña autorizados.";
  res.json(EvaluateAdminPolicyResponse.parse({
    role: body.data.role,
    permission: body.data.permission,
    allowed,
    scope,
    explanation: allowed
      ? "El perfil incluye este permiso dentro del ámbito indicado."
      : "El perfil no incluye este permiso; la comprobación es didáctica y no modifica accesos.",
    simulationOnly: true,
  }));
});

router.post("/admin/scenario-versions", async (req, res): Promise<void> => {
  const body = CreateAdminScenarioVersionBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa el periodo, la fecha y los parámetros de escenario.");
  const actor = req.auth!;
  const operationFingerprint = requestFingerprint(body.data);
  const version = await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const prior = await priorAdminOperation(
      tx, actor, body.data.operationId, "scenario.version.created", operationFingerprint,
    );
    if (prior) {
      const [existing] = await tx.select().from(fpAdminConfigVersions).where(and(
        eq(fpAdminConfigVersions.id, prior.entityId),
        eq(fpAdminConfigVersions.tenantId, actor.tenantId),
      )).limit(1);
      if (!existing) fail(409, "La versión de esta operación ya no está disponible.");
      return existing;
    }
    const [latest] = await tx.select({ version: fpAdminConfigVersions.version }).from(fpAdminConfigVersions)
      .where(eq(fpAdminConfigVersions.tenantId, actor.tenantId))
      .orderBy(desc(fpAdminConfigVersions.version)).limit(1);
    const [created] = await tx.insert(fpAdminConfigVersions).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      version: (latest?.version ?? 0) + 1,
      validFrom: body.data.validFrom,
      settings: body.data.settings,
      createdByUserId: actor.userId,
    }).returning();
    await audit(
      tx, actor.tenantId, actor.userId, "scenario.version.created", created.id,
      body.data.operationId, operationFingerprint,
    );
    return created;
  });
  res.status(201).json(CreateAdminScenarioVersionResponse.parse(scenarioVersionView(version)));
});

router.post("/admin/backup-exercises", async (req, res): Promise<void> => {
  const body = CreateAdminBackupExerciseBody.safeParse(req.body);
  if (!body.success) fail(400, "Escribe una etiqueta válida para el ensayo de preparación.");
  const actor = req.auth!;
  const operationFingerprint = requestFingerprint(body.data);
  const exercise = await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const prior = await priorAdminOperation(
      tx, actor, body.data.operationId, "backup.exercise.created", operationFingerprint,
    );
    if (prior) {
      const [existing] = await tx.select().from(fpAdminBackupExercises).where(and(
        eq(fpAdminBackupExercises.id, prior.entityId),
        eq(fpAdminBackupExercises.tenantId, actor.tenantId),
      )).limit(1);
      if (!existing) fail(409, "El ensayo de esta operación ya no está disponible.");
      return existing;
    }
    const [organizations, users, documents, campaigns] = await Promise.all([
      tx.select({ id: fpOrganizations.id }).from(fpOrganizations).where(eq(fpOrganizations.tenantId, actor.tenantId)),
      tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships).where(eq(fpAuthMemberships.tenantId, actor.tenantId)),
      tx.select({ id: fpDocuments.id }).from(fpDocuments).where(eq(fpDocuments.tenantId, actor.tenantId)),
      tx.select({ id: fpSimulationCampaigns.id }).from(fpSimulationCampaigns).where(eq(fpSimulationCampaigns.tenantId, actor.tenantId)),
    ]);
    const datasetCounts = {
      organizations: organizations.length,
      users: users.length,
      documents: documents.length,
      simulationCampaigns: campaigns.length,
    };
    const id = randomUUID();
    const [created] = await tx.insert(fpAdminBackupExercises).values({
      id,
      tenantId: actor.tenantId,
      operationId: body.data.operationId,
      label: body.data.label.trim(),
      status: datasetCounts.organizations > 0 && datasetCounts.users > 0 ? "verified" : "attention",
      datasetCounts,
      actorUserId: actor.userId,
    }).returning();
    await audit(
      tx, actor.tenantId, actor.userId, "backup.exercise.created", id,
      body.data.operationId, operationFingerprint,
    );
    return created;
  });
  res.status(201).json(CreateAdminBackupExerciseResponse.parse(backupExerciseView(exercise)));
});

router.post("/admin/integrations/:integrationId/check", async (req, res): Promise<void> => {
  const body = CheckAdminIntegrationBody.safeParse(req.body);
  if (!body.success) fail(400, "La solicitud de comprobación no es válida.");
  const integration = integrationCatalog.find((item) => item.id === req.params.integrationId);
  if (!integration) fail(404, "Integración no reconocida.");
  const actor = req.auth!;
  const action = `integration.check.${integration.id}`;
  const operationFingerprint = requestFingerprint({ integrationId: integration.id, body: body.data });
  let checkedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const prior = await priorAdminOperation(
      tx, actor, body.data.operationId, action, operationFingerprint,
    );
    if (prior) {
      if (prior.entityId !== integration.id) fail(409, "El identificador de operación pertenece a otra integración.");
      checkedAt = prior.createdAt.toISOString();
      return;
    }
    await audit(
      tx, actor.tenantId, actor.userId, action, integration.id,
      body.data.operationId, operationFingerprint,
    );
  });
  res.json(CheckAdminIntegrationResponse.parse({
    ...integration, status: "simulation_only", checkedAt, simulationOnly: true,
  }));
});

router.get("/admin/privilege-requests", async (req, res): Promise<void> => {
  const rows = await db.select().from(fpAdminPrivilegeRequests)
    .where(eq(fpAdminPrivilegeRequests.tenantId, req.auth!.tenantId))
    .orderBy(desc(fpAdminPrivilegeRequests.createdAt)).limit(100);
  res.json(ListAdminPrivilegeRequestsResponse.parse(rows.map(privilegeRequestView)));
});

router.post("/admin/privilege-requests", async (req, res): Promise<void> => {
  const body = CreateAdminPrivilegeRequestBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa el tipo y los datos de la solicitud.");
  const actor = req.auth!;
  const requestType = body.data.requestType;
  const email = body.data.email?.trim().toLowerCase() ?? null;
  if (requestType === "invite_administrator") {
    if (!email || body.data.targetUserId) fail(400, "Para proponer una invitación, indica un correo de cuenta nueva.");
  } else if (!body.data.targetUserId || email || body.data.organizationId) {
    fail(400, "Para cambiar el acceso de una cuenta, selecciona una persona de esta red.");
  }
  const operationFingerprint = requestFingerprint({
    ...body.data,
    email,
  });
  const request = await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const prior = await priorAdminOperation(
      tx, actor, body.data.operationId, "privilege.requested", operationFingerprint,
    );
    if (prior) {
      const [existing] = await tx.select().from(fpAdminPrivilegeRequests).where(and(
        eq(fpAdminPrivilegeRequests.id, prior.entityId),
        eq(fpAdminPrivilegeRequests.tenantId, actor.tenantId),
      )).limit(1);
      if (!existing) fail(409, "La solicitud de esta operación ya no está disponible.");
      return existing;
    }
    let targetUserId: string | null = null;
    if (requestType === "promote_user" || requestType === "deactivate_administrator") {
      const [target] = await tx.select({
        userId: fpAuthUsers.id,
        role: fpAuthMemberships.role,
        userActive: fpAuthUsers.isActive,
        membershipActive: fpAuthMemberships.isActive,
      }).from(fpAuthMemberships).innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
        .where(and(
          eq(fpAuthMemberships.tenantId, actor.tenantId),
          eq(fpAuthUsers.id, body.data.targetUserId!),
        )).limit(1);
      if (!target || !target.userActive || !target.membershipActive ||
          (requestType === "promote_user" && target.role === "administrator") ||
          (requestType === "deactivate_administrator" && target.role !== "administrator")) {
        fail(409, "La cuenta seleccionada no admite esta solicitud de administración.");
      }
      if (target.userId === actor.userId) fail(400, "No puedes solicitar una promoción para tu propia cuenta.");
      targetUserId = target.userId;
      const [pending] = await tx.select({ id: fpAdminPrivilegeRequests.id }).from(fpAdminPrivilegeRequests).where(and(
        eq(fpAdminPrivilegeRequests.tenantId, actor.tenantId),
        eq(fpAdminPrivilegeRequests.targetUserId, targetUserId),
        eq(fpAdminPrivilegeRequests.status, "pending"),
      )).limit(1);
      if (pending) fail(409, "Ya existe una solicitud pendiente para esa cuenta.");
    } else {
      await checkOrganization(tx, actor.tenantId, body.data.organizationId);
      const [existingUser] = await tx.select({ id: fpAuthUsers.id }).from(fpAuthUsers).where(eq(fpAuthUsers.email, email!)).limit(1);
      if (existingUser) {
        const [membership] = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
          .where(and(
            eq(fpAuthMemberships.userId, existingUser.id),
            eq(fpAuthMemberships.tenantId, actor.tenantId),
          ));
        if (membership) fail(409, "Esa cuenta ya pertenece a esta red.");
      }
      const [pendingRequest] = await tx.select({ id: fpAdminPrivilegeRequests.id }).from(fpAdminPrivilegeRequests).where(and(
        eq(fpAdminPrivilegeRequests.tenantId, actor.tenantId),
        eq(fpAdminPrivilegeRequests.email, email!),
        eq(fpAdminPrivilegeRequests.status, "pending"),
      )).limit(1);
      if (pendingRequest) fail(409, "Ya existe una solicitud de invitación administrativa pendiente para ese correo.");
    }
    const [created] = await tx.insert(fpAdminPrivilegeRequests).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      operationId: body.data.operationId,
      requestType,
      targetUserId,
      email: requestType === "invite_administrator" ? email : null,
      organizationId: body.data.organizationId ?? null,
      status: "pending",
      requestedByUserId: actor.userId,
      decisionNote: "",
    }).returning();
    await audit(
      tx, actor.tenantId, actor.userId, "privilege.requested", created.id,
      body.data.operationId, operationFingerprint,
    );
    return created;
  });
  res.status(201).json(CreateAdminPrivilegeRequestResponse.parse(privilegeRequestView(request)));
});

router.post("/admin/privilege-requests/:id/action", async (req, res): Promise<void> => {
  const params = UpdateAdminUserParams.safeParse({ id: req.params.id });
  const body = ActOnAdminPrivilegeRequestBody.safeParse(req.body);
  if (!params.success || !body.success) fail(400, "La decisión de la solicitud no es válida.");
  const actor = req.auth!;
  const operationFingerprint = requestFingerprint({ id: params.data.id, ...body.data });
  let invitationToken: string | null = null;
  const request = await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    const action = `privilege.${body.data.action}`;
    const prior = await priorAdminOperation(tx, actor, body.data.operationId, action, operationFingerprint);
    if (prior) {
      if (prior.entityId !== params.data.id) fail(409, "El identificador de operación pertenece a otra solicitud.");
      const [existing] = await tx.select().from(fpAdminPrivilegeRequests).where(and(
        eq(fpAdminPrivilegeRequests.id, params.data.id),
        eq(fpAdminPrivilegeRequests.tenantId, actor.tenantId),
      )).limit(1);
      if (!existing) fail(404, "Solicitud no encontrada.");
      return existing;
    }
    const [current] = await tx.select().from(fpAdminPrivilegeRequests).where(and(
      eq(fpAdminPrivilegeRequests.id, params.data.id),
      eq(fpAdminPrivilegeRequests.tenantId, actor.tenantId),
    )).for("update");
    if (!current) fail(404, "Solicitud no encontrada en esta red.");
    if (current.status !== "pending") fail(409, "La solicitud ya ha sido resuelta.");
    if (current.requestedByUserId === actor.userId) {
      fail(409, "Una persona administradora distinta debe revisar esta solicitud.");
    }
    if (body.data.action === "approve") {
      if (current.requestType === "promote_user" || current.requestType === "deactivate_administrator") {
        if (!current.targetUserId) fail(409, "La cuenta objetivo ya no está disponible.");
        const [target] = await tx.select({
          membershipId: fpAuthMemberships.id,
          role: fpAuthMemberships.role,
          isActive: fpAuthMemberships.isActive,
          userActive: fpAuthUsers.isActive,
          membershipActive: fpAuthMemberships.isActive,
        }).from(fpAuthMemberships).innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
          .where(and(
            eq(fpAuthMemberships.tenantId, actor.tenantId),
            eq(fpAuthUsers.id, current.targetUserId),
          )).for("update");
        if (!target || !target.userActive || !target.membershipActive ||
            (current.requestType === "promote_user" && target.role === "administrator") ||
            (current.requestType === "deactivate_administrator" && (target.role !== "administrator" || !target.isActive))) {
          fail(409, "La cuenta ha cambiado y ya no puede recibir esta aprobación.");
        }
        if (current.requestType === "promote_user") {
          await tx.update(fpAuthMemberships).set({ role: "administrator" }).where(eq(fpAuthMemberships.id, target.membershipId));
        } else {
          const administrators = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
            .innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
            .where(and(
              eq(fpAuthMemberships.tenantId, actor.tenantId),
              eq(fpAuthMemberships.role, "administrator"),
              eq(fpAuthMemberships.isActive, true),
              eq(fpAuthUsers.isActive, true),
            ));
          if (administrators.length <= 1) fail(409, "La red debe conservar al menos una cuenta administradora activa.");
          await tx.update(fpAuthMemberships).set({ isActive: false }).where(eq(fpAuthMemberships.id, target.membershipId));
        }
        await tx.update(fpAuthSessions).set({ revokedAt: new Date() }).where(and(
          eq(fpAuthSessions.membershipId, target.membershipId),
          isNull(fpAuthSessions.revokedAt),
        ));
      } else {
        if (!current.email) fail(409, "La solicitud ya no contiene un correo válido.");
        await checkOrganization(tx, actor.tenantId, current.organizationId);
        const [existingUser] = await tx.select({ id: fpAuthUsers.id }).from(fpAuthUsers)
          .where(eq(fpAuthUsers.email, current.email)).limit(1);
        if (existingUser) {
          const [membership] = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships)
            .where(and(
              eq(fpAuthMemberships.userId, existingUser.id),
              eq(fpAuthMemberships.tenantId, actor.tenantId),
            ));
          if (membership) fail(409, "Esa cuenta ya pertenece a esta red.");
        }
        const [pending] = await tx.select({ id: fpAuthInvitations.id }).from(fpAuthInvitations).where(and(
          eq(fpAuthInvitations.tenantId, actor.tenantId),
          eq(fpAuthInvitations.email, current.email),
          isNull(fpAuthInvitations.acceptedAt),
          isNull(fpAuthInvitations.rejectedAt),
          isNull(fpAuthInvitations.revokedAt),
          gt(fpAuthInvitations.expiresAt, new Date()),
        )).limit(1);
        if (pending) fail(409, "Ya existe una invitación pendiente para ese correo.");
        invitationToken = randomBytes(32).toString("base64url");
        await tx.insert(fpAuthInvitations).values({
          id: randomUUID(),
          tenantId: actor.tenantId,
          email: current.email,
          role: "administrator",
          organizationId: current.organizationId,
          createdBy: actor.userId,
          tokenHash: hashSessionToken(`invite:${invitationToken}`),
          expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        });
      }
    }
    const [updated] = await tx.update(fpAdminPrivilegeRequests).set({
      status: body.data.action === "approve" ? "approved" : "rejected",
      approvedByUserId: actor.userId,
      decisionNote: body.data.note.trim(),
      decidedAt: new Date(),
    }).where(eq(fpAdminPrivilegeRequests.id, current.id)).returning();
    await audit(
      tx, actor.tenantId, actor.userId, action, current.id,
      body.data.operationId, operationFingerprint,
    );
    return updated;
  });
  res.setHeader("Cache-Control", "no-store");
  res.json(ActOnAdminPrivilegeRequestResponse.parse({
    request: privilegeRequestView(request),
    invitationToken,
  }));
});

const handleAccessError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof AccessError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
};
router.use(handleAccessError);
export default router;

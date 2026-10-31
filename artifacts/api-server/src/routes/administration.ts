import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  AcceptInvitationBody, AcceptInvitationResponse, CreateAdminInvitationBody,
  CreateAdminInvitationResponse, InspectInvitationBody, InspectInvitationResponse,
  ListAdminAuditResponse, ListAdminInvitationsResponse, ListAdminUsersResponse,
  RevokeAdminInvitationParams, UpdateAdminUserBody, UpdateAdminUserParams,
  UpdateAdminUserResponse,
} from "@workspace/api-zod";
import {
  db, fpAuthAudit, fpAuthInvitations, fpAuthMemberships, fpAuthSessions,
  fpAuthUsers, fpOrganizations,
} from "@workspace/db";
import { hashPassword } from "../lib/passwords";
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
    status: row.acceptedAt ? "accepted" : row.revokedAt ? "revoked" : row.expiresAt <= new Date() ? "expired" : "pending",
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(),
  };
}
function pendingInvitation(token: string) {
  return and(
    eq(fpAuthInvitations.tokenHash, hashSessionToken(`invite:${token}`)),
    isNull(fpAuthInvitations.acceptedAt), isNull(fpAuthInvitations.revokedAt),
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
async function audit(tx: Transaction, tenantId: string, actorUserId: string, action: string, entityId: string) {
  await tx.insert(fpAuthAudit).values({ id: randomUUID(), tenantId, actorUserId, action, entityId });
}
async function managedUser(tenantId: string, userId: string) {
  const [row] = await db.select({
    id: fpAuthUsers.id, email: fpAuthUsers.email, displayName: fpAuthUsers.displayName,
    role: fpAuthMemberships.role, organizationId: fpAuthMemberships.organizationId,
    isActive: fpAuthMemberships.isActive, createdAt: fpAuthMemberships.createdAt,
  }).from(fpAuthMemberships).innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
    .where(and(eq(fpAuthMemberships.tenantId, tenantId), eq(fpAuthUsers.id, userId)));
  if (!row) fail(404, "Usuario no encontrado en tu red.");
  return { ...row, createdAt: row.createdAt.toISOString() };
}

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
  res.json(InspectInvitationResponse.parse({
    email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString(),
  }));
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
  }).from(fpAuthMemberships).innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
    .where(eq(fpAuthMemberships.tenantId, req.auth!.tenantId)).orderBy(fpAuthUsers.displayName);
  res.json(ListAdminUsersResponse.parse(users.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))));
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
  const actor = req.auth!;
  const token = randomBytes(32).toString("base64url");
  const email = body.data.email.trim().toLowerCase();
  const invitation = await db.transaction(async (tx) => {
    await lockAdministration(tx, actor);
    await checkOrganization(tx, actor.tenantId, body.data.organizationId);
    const [existing] = await tx.select({ id: fpAuthUsers.id }).from(fpAuthUsers).where(eq(fpAuthUsers.email, email));
    if (existing) fail(409, "Este correo ya dispone de una cuenta.");
    const [pending] = await tx.select({ id: fpAuthInvitations.id }).from(fpAuthInvitations).where(and(
      eq(fpAuthInvitations.tenantId, actor.tenantId), eq(fpAuthInvitations.email, email),
      isNull(fpAuthInvitations.acceptedAt), isNull(fpAuthInvitations.revokedAt), gt(fpAuthInvitations.expiresAt, new Date()),
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
    if (invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) fail(409, "La invitación ya no está pendiente.");
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

const handleAccessError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof AccessError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
};
router.use(handleAccessError);
export default router;

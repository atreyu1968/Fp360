import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import {
  BeginAdminMfaSetupResponse,
  ConfirmAdminMfaBody,
  ConfirmAdminMfaResponse,
  LoginBody,
  SetupInitialAdministratorBody,
  VerifyAdminMfaBody,
  VerifyAdminMfaResponse,
} from "@workspace/api-zod";
import {
  db,
  fpAuthAudit,
  fpAuthMemberships,
  fpAuthSessions,
  fpAuthSetupState,
  fpAuthUsers,
  fpOrganizations,
} from "@workspace/db";
import {
  clearAuthCookie,
  AUTH_ROLES,
  issueAuthSession,
  hashSessionToken,
  requireAuth,
  requireSameOrigin,
  SESSION_COOKIE_NAME,
  type AuthContext,
  type AuthRole,
} from "../middlewares/auth";
import { hashPassword, verifyPassword } from "../lib/passwords";
import {
  createRecoveryCodes,
  createTotpSecret,
  decryptTotpSecret,
  encryptTotpSecret,
  totpProvisioningUri,
  verifyRecoveryCode,
  verifyTotp,
} from "../lib/totp";

const router: IRouter = Router();
const setupTenantId = "red-fp360-demo";
const setupLockId = "global";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ message: "Too many sign-in attempts" });
  },
});

const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ message: "Too many setup attempts" });
  },
});
const mfaLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({ message: "Too many MFA attempts" });
  },
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeTokenMatch(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}

function identityResponse(
  identity: AuthContext,
): {
  id: string;
  email: string;
  displayName: string;
  tenantId: string;
  organizationId?: string;
  role: AuthRole;
  mfaSetupRequired: boolean;
  mfaVerificationRequired: boolean;
} {
  return {
    id: identity.userId,
    email: identity.email,
    displayName: identity.displayName,
    tenantId: identity.tenantId,
    ...(identity.organizationId
      ? { organizationId: identity.organizationId }
      : {}),
    role: identity.role,
    mfaSetupRequired: identity.mfaSetupRequired ?? identity.role === "administrator",
    mfaVerificationRequired: identity.mfaVerificationRequired ?? false,
  };
}

function setNoStore(response: Parameters<RequestHandler>[1]): void {
  response.setHeader("Cache-Control", "no-store");
}

router.get("/auth/status", async (_request, response, next) => {
  setNoStore(response);
  try {
    const [setupState] = await db
      .select({ completedAt: fpAuthSetupState.completedAt })
      .from(fpAuthSetupState)
      .where(eq(fpAuthSetupState.id, setupLockId))
      .limit(1);
    response.json({ setupRequired: !setupState?.completedAt });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/auth/setup",
  setupLimiter,
  requireSameOrigin,
  async (request, response, next) => {
    setNoStore(response);
    const parsed = SetupInitialAdministratorBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: "Check the setup details" });
      return;
    }

    const expectedToken = process.env.RED_FP360_SETUP_TOKEN;
    if (!expectedToken) {
      response.status(503).json({ message: "Initial setup is not configured" });
      return;
    }
    if (!safeTokenMatch(parsed.data.setupToken, expectedToken)) {
      response.status(403).json({ message: "Invalid setup token" });
      return;
    }

    try {
      const passwordHash = await hashPassword(parsed.data.password);
      await db
        .insert(fpAuthSetupState)
        .values({ id: setupLockId, completedAt: null })
        .onConflictDoNothing();

      const user = await db.transaction(async (transaction) => {
        const [state] = await transaction
          .select()
          .from(fpAuthSetupState)
          .where(eq(fpAuthSetupState.id, setupLockId))
          .for("update")
          .limit(1);

        if (state?.completedAt) {
          return null;
        }

        const userId = randomUUID();
        const membershipId = randomUUID();
        const email = normalizeEmail(parsed.data.email);
        const displayName = parsed.data.displayName.trim();

        const [createdUser] = await transaction
          .insert(fpAuthUsers)
          .values({
            id: userId,
            email,
            displayName,
            passwordHash,
          })
          .returning();

        await transaction.insert(fpAuthMemberships).values({
          id: membershipId,
          userId,
          tenantId: setupTenantId,
          role: "administrator",
        });
        await transaction
          .update(fpAuthSetupState)
          .set({ completedAt: new Date() })
          .where(eq(fpAuthSetupState.id, setupLockId));

        return {
          id: createdUser.id,
          membershipId,
          email: createdUser.email,
          displayName: createdUser.displayName,
          tenantId: setupTenantId,
          organizationId: null,
          role: "administrator" as const,
        };
      });

      if (!user) {
        response
          .status(409)
          .json({ message: "Administrator setup has already been completed" });
        return;
      }

      await issueAuthSession(user.id, user.membershipId, response);
      response.status(201).json(
        identityResponse({
          userId: user.id,
          membershipId: user.membershipId,
          email: user.email,
          displayName: user.displayName,
          tenantId: user.tenantId,
          organizationId: user.organizationId,
          role: user.role,
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/auth/login",
  loginLimiter,
  requireSameOrigin,
  async (request, response, next) => {
    setNoStore(response);
    const parsed = LoginBody.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json({ message: "Check your email and password" });
      return;
    }

    try {
      const email = normalizeEmail(parsed.data.email);
      const [user] = await db
        .select()
        .from(fpAuthUsers)
        .where(and(eq(fpAuthUsers.email, email), eq(fpAuthUsers.isActive, true)))
        .limit(1);
      if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
        response.status(401).json({ message: "Email or password is incorrect" });
        return;
      }

      const memberships = await db
        .select()
        .from(fpAuthMemberships)
        .where(
          and(
            eq(fpAuthMemberships.userId, user.id),
            eq(fpAuthMemberships.isActive, true),
          ),
        );
      const membership = parsed.data.tenantId
        ? memberships.find((item) => item.tenantId === parsed.data.tenantId)
        : memberships.length === 1
          ? memberships[0]
          : undefined;
      if (!membership) {
        response.status(401).json({ message: "Email or password is incorrect" });
        return;
      }
      if (!AUTH_ROLES.includes(membership.role as AuthRole)) {
        response.status(403).json({ message: "Account role is not configured" });
        return;
      }

      if (membership.organizationId) {
        const [organization] = await db
          .select({ isActive: fpOrganizations.isActive })
          .from(fpOrganizations)
          .where(
            and(
              eq(fpOrganizations.id, membership.organizationId),
              eq(fpOrganizations.tenantId, membership.tenantId),
            ),
          )
          .limit(1);
        if (!organization?.isActive) {
          response.status(401).json({ message: "La organización de esta cuenta está suspendida." });
          return;
        }
      }

      await issueAuthSession(user.id, membership.id, response);
      response.json(
        identityResponse({
          userId: user.id,
          membershipId: membership.id,
          email: user.email,
          displayName: user.displayName,
          tenantId: membership.tenantId,
          organizationId: membership.organizationId,
          role: membership.role as AuthRole,
          mfaSetupRequired: membership.role === "administrator" && !user.mfaEnabledAt,
          mfaVerificationRequired: membership.role === "administrator" && Boolean(user.mfaEnabledAt),
        }),
      );
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/auth/mfa/setup",
  requireAuth,
  mfaLimiter,
  requireSameOrigin,
  async (request, response, next) => {
    setNoStore(response);
    const actor = request.auth;
    if (!actor || actor.role !== "administrator") {
      response.status(403).json({ message: "Solo las cuentas administradoras pueden configurar MFA." });
      return;
    }
    try {
      const [user] = await db.select({
        mfaSecretEncrypted: fpAuthUsers.mfaSecretEncrypted,
        mfaPendingSecretEncrypted: fpAuthUsers.mfaPendingSecretEncrypted,
        mfaPendingExpiresAt: fpAuthUsers.mfaPendingExpiresAt,
        mfaEnabledAt: fpAuthUsers.mfaEnabledAt,
      }).from(fpAuthUsers).where(eq(fpAuthUsers.id, actor.userId)).limit(1);
      if (!user || user.mfaEnabledAt || user.mfaSecretEncrypted) {
        response.status(409).json({ message: "MFA ya está activado para esta cuenta." });
        return;
      }
      const now = new Date();
      const pendingIsCurrent = Boolean(
        user.mfaPendingSecretEncrypted &&
        user.mfaPendingExpiresAt &&
        user.mfaPendingExpiresAt > now,
      );
      const secret = pendingIsCurrent
        ? decryptTotpSecret(user.mfaPendingSecretEncrypted!)
        : createTotpSecret();
      const expiresAt = pendingIsCurrent ? user.mfaPendingExpiresAt! : new Date(now.getTime() + 10 * 60 * 1000);
      if (!pendingIsCurrent) {
        await db.update(fpAuthUsers).set({
          mfaPendingSecretEncrypted: encryptTotpSecret(secret),
          mfaPendingExpiresAt: expiresAt,
        }).where(eq(fpAuthUsers.id, actor.userId));
      }
      response.json(BeginAdminMfaSetupResponse.parse({
        secret,
        otpauthUrl: totpProvisioningUri(actor.email, secret),
        expiresAt: expiresAt.toISOString(),
      }));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/auth/mfa/confirm",
  requireAuth,
  mfaLimiter,
  requireSameOrigin,
  async (request, response, next) => {
    setNoStore(response);
    const actor = request.auth;
    const parsed = ConfirmAdminMfaBody.safeParse(request.body);
    const sessionId = actor?.sessionId;
    if (!actor || actor.role !== "administrator" || !sessionId) {
      response.status(403).json({ message: "No se puede confirmar MFA para esta cuenta." });
      return;
    }
    if (!parsed.success) {
      response.status(400).json({ message: "Introduce el código de seis cifras de la aplicación." });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(fpAuthUsers)
          .where(eq(fpAuthUsers.id, actor.userId)).for("update");
        if (!user || user.mfaEnabledAt || !user.mfaPendingSecretEncrypted ||
            !user.mfaPendingExpiresAt || user.mfaPendingExpiresAt <= new Date()) {
          return { ok: false as const, message: "La configuración caducó. Inicia de nuevo el alta de MFA." };
        }
        const secret = decryptTotpSecret(user.mfaPendingSecretEncrypted);
        if (!verifyTotp(secret, parsed.data.code)) {
          return { ok: false as const, message: "El código no coincide o ha caducado." };
        }
        const recovery = createRecoveryCodes();
        const verifiedAt = new Date();
        await tx.update(fpAuthUsers).set({
          mfaSecretEncrypted: user.mfaPendingSecretEncrypted,
          mfaPendingSecretEncrypted: null,
          mfaPendingExpiresAt: null,
          mfaEnabledAt: verifiedAt,
          mfaRecoveryCodeHashes: recovery.hashes,
        }).where(eq(fpAuthUsers.id, actor.userId));
        await tx.update(fpAuthSessions).set({ mfaVerifiedAt: verifiedAt }).where(and(
          eq(fpAuthSessions.id, sessionId),
          eq(fpAuthSessions.userId, actor.userId),
          isNull(fpAuthSessions.revokedAt),
        ));
        await tx.insert(fpAuthAudit).values({
          id: randomUUID(),
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: "mfa.enabled",
          entityId: actor.userId,
        });
        return { ok: true as const, recoveryCodes: recovery.codes };
      });
      if (!result.ok) {
        response.status(400).json({ message: result.message });
        return;
      }
      response.json(ConfirmAdminMfaResponse.parse({
        identity: identityResponse({
          ...actor,
          mfaSetupRequired: false,
          mfaVerificationRequired: false,
        }),
        recoveryCodes: result.recoveryCodes,
      }));
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/auth/mfa/verify",
  requireAuth,
  mfaLimiter,
  requireSameOrigin,
  async (request, response, next) => {
    setNoStore(response);
    const actor = request.auth;
    const parsed = VerifyAdminMfaBody.safeParse(request.body);
    const sessionId = actor?.sessionId;
    if (!actor || actor.role !== "administrator" || !sessionId) {
      response.status(403).json({ message: "No se puede verificar MFA para esta cuenta." });
      return;
    }
    if (!parsed.success) {
      response.status(400).json({ message: "Introduce un código de seis cifras o un código de recuperación." });
      return;
    }
    try {
      const result = await db.transaction(async (tx) => {
        const [user] = await tx.select().from(fpAuthUsers)
          .where(eq(fpAuthUsers.id, actor.userId)).for("update");
        if (!user?.mfaEnabledAt || !user.mfaSecretEncrypted) {
          return { ok: false as const, message: "La cuenta todavía no tiene MFA activado." };
        }
        const secret = decryptTotpSecret(user.mfaSecretEncrypted);
        const validTotp = verifyTotp(secret, parsed.data.code);
        const recoveryIndex = validTotp ? -1 : verifyRecoveryCode(parsed.data.code, user.mfaRecoveryCodeHashes);
        if (!validTotp && recoveryIndex < 0) {
          return { ok: false as const, message: "El código no es válido o ya se ha utilizado." };
        }
        const verifiedAt = new Date();
        if (recoveryIndex >= 0) {
          const remainingCodes = [...user.mfaRecoveryCodeHashes];
          remainingCodes.splice(recoveryIndex, 1);
          await tx.update(fpAuthUsers).set({ mfaRecoveryCodeHashes: remainingCodes })
            .where(eq(fpAuthUsers.id, actor.userId));
        }
        await tx.update(fpAuthSessions).set({ mfaVerifiedAt: verifiedAt }).where(and(
          eq(fpAuthSessions.id, sessionId),
          eq(fpAuthSessions.userId, actor.userId),
          isNull(fpAuthSessions.revokedAt),
        ));
        await tx.insert(fpAuthAudit).values({
          id: randomUUID(),
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: recoveryIndex >= 0 ? "mfa.recovery_code.used" : "mfa.verified",
          entityId: actor.userId,
        });
        return { ok: true as const };
      });
      if (!result.ok) {
        response.status(400).json({ message: result.message });
        return;
      }
      response.json(VerifyAdminMfaResponse.parse(identityResponse({
        ...actor,
        mfaSetupRequired: false,
        mfaVerificationRequired: false,
      })));
    } catch (error) {
      next(error);
    }
  },
);

router.get("/auth/me", requireAuth, (request, response) => {
  setNoStore(response);
  if (!request.auth) {
    response.status(401).json({ message: "Authentication required" });
    return;
  }
  response.json(identityResponse(request.auth));
});

router.post(
  "/auth/logout",
  requireAuth,
  requireSameOrigin,
  async (request, response, next) => {
    setNoStore(response);
    try {
      const token = request.cookies?.[SESSION_COOKIE_NAME];
      if (typeof token === "string" && token.length > 0) {
        await db
          .update(fpAuthSessions)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(fpAuthSessions.tokenHash, hashSessionToken(token)),
              isNull(fpAuthSessions.revokedAt),
            ),
          );
      }
      clearAuthCookie(response);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

export default router;

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { RequestHandler, Response } from "express";
import {
  db,
  fpAuthMemberships,
  fpAuthSessions,
  fpAuthUsers,
} from "@workspace/db";

export const SESSION_COOKIE_NAME = "redfp360_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const AUTH_ROLES = [
  "student",
  "team_manager",
  "teacher",
  "promoter",
  "mentor",
  "administrator",
] as const;

export type AuthRole = (typeof AUTH_ROLES)[number];

export interface AuthContext {
  userId: string;
  membershipId: string;
  email: string;
  displayName: string;
  tenantId: string;
  organizationId: string | null;
  role: AuthRole;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured for authentication");
  }
  return secret;
}

export function hashSessionToken(token: string): string {
  return createHmac("sha256", getSessionSecret()).update(token).digest("hex");
}

export async function issueAuthSession(
  userId: string,
  membershipId: string,
  response: Response,
): Promise<Date> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(fpAuthSessions).values({
    id: randomUUID(),
    userId,
    membershipId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });

  response.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return expiresAt;
}

export function clearAuthCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

export const requireSameOrigin: RequestHandler = (request, response, next) => {
  if (request.get("sec-fetch-site") === "cross-site") {
    response.status(403).json({ message: "Cross-origin request rejected" });
    return;
  }
  const origin = request.get("origin");
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== request.get("host")?.toLowerCase()) {
        response.status(403).json({ message: "Cross-origin request rejected" });
        return;
      }
    } catch {
      response.status(403).json({ message: "Cross-origin request rejected" });
      return;
    }
  }
  next();
};

export const requireSimulationWriteAccess: RequestHandler = (request, response, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }
  if (!request.auth || !["student", "team_manager", "teacher", "administrator"].includes(request.auth.role)) {
    response.status(403).json({ message: "Tu perfil solo permite consultar esta simulación." });
    return;
  }
  requireSameOrigin(request, response, next);
};

export const requireAuth: RequestHandler = async (request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  try {
    const token = request.cookies?.[SESSION_COOKIE_NAME];
    if (!token || typeof token !== "string") {
      response.status(401).json({ message: "Authentication required" });
      return;
    }

    const now = new Date();
    const [identity] = await db
      .select({
        userId: fpAuthUsers.id,
        membershipId: fpAuthMemberships.id,
        email: fpAuthUsers.email,
        displayName: fpAuthUsers.displayName,
        tenantId: fpAuthMemberships.tenantId,
        organizationId: fpAuthMemberships.organizationId,
        role: fpAuthMemberships.role,
      })
      .from(fpAuthSessions)
      .innerJoin(fpAuthUsers, eq(fpAuthSessions.userId, fpAuthUsers.id))
      .innerJoin(
        fpAuthMemberships,
        eq(fpAuthSessions.membershipId, fpAuthMemberships.id),
      )
      .where(
        and(
          eq(fpAuthSessions.tokenHash, hashSessionToken(token)),
          gt(fpAuthSessions.expiresAt, now),
          isNull(fpAuthSessions.revokedAt),
          eq(fpAuthUsers.isActive, true),
          eq(fpAuthMemberships.isActive, true),
        ),
      )
      .limit(1);

    if (
      !identity ||
      !AUTH_ROLES.includes(identity.role as AuthRole)
    ) {
      clearAuthCookie(response);
      response.status(401).json({ message: "Authentication required" });
      return;
    }

    request.auth = {
      ...identity,
      role: identity.role as AuthRole,
    };
    next();
  } catch (error) {
    next(error);
  }
};

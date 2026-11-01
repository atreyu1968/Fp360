import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { fpOrganizations } from "./redfp360";

export const fpAuthUsers = pgTable(
  "fp360_auth_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    mfaSecretEncrypted: text("mfa_secret_encrypted"),
    mfaPendingSecretEncrypted: text("mfa_pending_secret_encrypted"),
    mfaPendingExpiresAt: timestamp("mfa_pending_expires_at", { withTimezone: true }),
    mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
    mfaRecoveryCodeHashes: jsonb("mfa_recovery_code_hashes").$type<string[]>().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("fp360_auth_users_email_idx").on(table.email)],
);

export const fpAuthMemberships = pgTable(
  "fp360_auth_memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => fpAuthUsers.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").references(() => fpOrganizations.id, {
      onDelete: "set null",
    }),
    role: text("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_auth_membership_scope_idx").on(
      table.userId,
      table.tenantId,
    ),
    index("fp360_auth_membership_tenant_idx").on(table.tenantId),
  ],
);

export const fpAuthSessions = pgTable(
  "fp360_auth_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => fpAuthUsers.id, { onDelete: "cascade" }),
    membershipId: text("membership_id")
      .notNull()
      .references(() => fpAuthMemberships.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_auth_sessions_token_hash_idx").on(table.tokenHash),
    index("fp360_auth_sessions_user_idx").on(table.userId),
    index("fp360_auth_sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const fpAuthSetupState = pgTable("fp360_auth_setup_state", {
  id: text("id").primaryKey(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const fpAuthInvitations = pgTable(
  "fp360_auth_invitations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull(),
    organizationId: text("organization_id").references(() => fpOrganizations.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull(),
    createdBy: text("created_by").references(() => fpAuthUsers.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_auth_invitation_token_idx").on(table.tokenHash),
    index("fp360_auth_invitation_tenant_idx").on(table.tenantId),
  ],
);

export const fpAuthAudit = pgTable(
  "fp360_auth_audit",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    actorUserId: text("actor_user_id").references(() => fpAuthUsers.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityId: text("entity_id").notNull(),
    operationId: text("operation_id"),
    operationFingerprint: text("operation_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_auth_audit_tenant_idx").on(table.tenantId),
    uniqueIndex("fp360_auth_audit_operation_unique").on(table.tenantId, table.operationId),
  ],
);

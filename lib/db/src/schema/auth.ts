import {
  boolean,
  index,
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

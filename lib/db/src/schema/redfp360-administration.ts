import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { fpAuthUsers } from "./auth";

export type AdminScenarioSettings = {
  academicPeriod: string;
  simulatedDate: string;
  catalogVersion: string;
  documentRetentionDays: number;
};

export type AdminBackupDatasetCounts = {
  organizations: number;
  users: number;
  documents: number;
  simulationCampaigns: number;
};

export const fpAdminConfigVersions = pgTable(
  "fp360_admin_config_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    version: integer("version").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    settings: jsonb("settings").$type<AdminScenarioSettings>().notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_admin_config_version_unique").on(table.tenantId, table.version),
    index("fp360_admin_config_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);

export const fpAdminBackupExercises = pgTable(
  "fp360_admin_backup_exercises",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    operationId: text("operation_id").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull(),
    datasetCounts: jsonb("dataset_counts").$type<AdminBackupDatasetCounts>().notNull(),
    actorUserId: text("actor_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_admin_backup_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_admin_backup_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);

export const fpAdminPrivilegeRequests = pgTable(
  "fp360_admin_privilege_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    operationId: text("operation_id").notNull(),
    requestType: text("request_type").notNull(),
    targetUserId: text("target_user_id").references(() => fpAuthUsers.id, { onDelete: "set null" }),
    email: text("email"),
    organizationId: text("organization_id"),
    status: text("status").notNull().default("pending"),
    requestedByUserId: text("requested_by_user_id").notNull(),
    approvedByUserId: text("approved_by_user_id"),
    decisionNote: text("decision_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_admin_privilege_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_admin_privilege_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

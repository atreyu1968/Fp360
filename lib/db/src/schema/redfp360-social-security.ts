import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
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
import { fpOrganizations } from "./redfp360";

export const fpSocialSecurityWorkers = pgTable(
  "fp360_social_security_workers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    hrEmployeeId: text("hr_employee_id"),
    workerRef: text("worker_ref").notNull(),
    contributionGroup: integer("contribution_group").notNull(),
    contractType: text("contract_type").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    monthlyContributionBaseCents: integer("monthly_contribution_base_cents").notNull(),
    employerContributionCents: integer("employer_contribution_cents").notNull(),
    workerContributionCents: integer("worker_contribution_cents").notNull(),
    status: text("status").notNull().default("pending"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_social_security_worker_ref_unique").on(table.tenantId, table.organizationId, table.workerRef),
    index("fp360_social_security_workers_org_status_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpSocialSecurityMovements = pgTable(
  "fp360_social_security_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    workerId: text("worker_id").notNull().references(() => fpSocialSecurityWorkers.id),
    operationType: text("operation_type").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    contributionGroup: integer("contribution_group"),
    contractType: text("contract_type"),
    monthlyContributionBaseCents: integer("monthly_contribution_base_cents"),
    employerContributionCents: integer("employer_contribution_cents"),
    workerContributionCents: integer("worker_contribution_cents"),
    status: text("status").notNull().default("pending_review"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedByName: text("reviewed_by_name"),
    reviewAction: text("review_action"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_social_security_movement_op_unique").on(table.tenantId, table.operationId),
    index("fp360_social_security_movements_org_date_idx").on(table.tenantId, table.organizationId, table.effectiveDate),
    index("fp360_social_security_movements_worker_idx").on(table.workerId, table.createdAt),
  ],
);

export const fpSocialSecuritySettlements = pgTable(
  "fp360_social_security_settlements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    sourcePayrollRunId: text("source_payroll_run_id"),
    periodKey: text("period_key").notNull(),
    workerIds: jsonb("worker_ids").$type<string[]>().notNull(),
    workerCount: integer("worker_count").notNull(),
    contributionBaseCents: integer("contribution_base_cents").notNull(),
    employerContributionCents: integer("employer_contribution_cents").notNull(),
    workerContributionCents: integer("worker_contribution_cents").notNull(),
    totalContributionCents: integer("total_contribution_cents").notNull(),
    status: text("status").notNull().default("draft"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedByName: text("reviewed_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_social_security_settlement_period_unique").on(table.tenantId, table.organizationId, table.periodKey),
    uniqueIndex("fp360_social_security_settlement_op_unique").on(table.tenantId, table.operationId),
    index("fp360_social_security_settlements_org_idx").on(table.tenantId, table.organizationId, table.createdAt),
  ],
);

export const fpSocialSecurityEvents = pgTable(
  "fp360_social_security_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    eventType: text("event_type").notNull(),
    description: text("description").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_social_security_event_op_unique").on(table.tenantId, table.operationId),
    index("fp360_social_security_events_org_idx").on(table.tenantId, table.organizationId, table.createdAt),
  ],
);

export const insertFpSocialSecurityWorkerSchema = createInsertSchema(fpSocialSecurityWorkers).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertFpSocialSecurityMovementSchema = createInsertSchema(fpSocialSecurityMovements).omit({
  id: true, createdAt: true, reviewedAt: true,
});
export const insertFpSocialSecuritySettlementSchema = createInsertSchema(fpSocialSecuritySettlements).omit({
  id: true, createdAt: true, updatedAt: true,
});
export const insertFpSocialSecurityEventSchema = createInsertSchema(fpSocialSecurityEvents).omit({
  id: true, createdAt: true,
});
export type InsertFpSocialSecurityWorker = z.infer<typeof insertFpSocialSecurityWorkerSchema>;
export type FpSocialSecurityWorker = typeof fpSocialSecurityWorkers.$inferSelect;
export type InsertFpSocialSecurityMovement = z.infer<typeof insertFpSocialSecurityMovementSchema>;
export type FpSocialSecurityMovement = typeof fpSocialSecurityMovements.$inferSelect;
export type InsertFpSocialSecuritySettlement = z.infer<typeof insertFpSocialSecuritySettlementSchema>;
export type FpSocialSecuritySettlement = typeof fpSocialSecuritySettlements.$inferSelect;
export type InsertFpSocialSecurityEvent = z.infer<typeof insertFpSocialSecurityEventSchema>;
export type FpSocialSecurityEvent = typeof fpSocialSecurityEvents.$inferSelect;

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { fpOrganizations } from "./redfp360";

export type FpPayrollReceiptLine = {
  employeeId: string;
  workerRef: string;
  absenceDays: number;
  monthlyBaseCents: number;
  complementCents: number;
  absenceAdjustmentCents: number;
  grossCents: number;
  contributionBaseCents: number;
  workerContributionCents: number;
  employerContributionCents: number;
  withholdingCents: number;
  advancesCents: number;
  otherDeductionsCents: number;
  netCents: number;
  employerCostCents: number;
  receiptRef: string;
};

export const fpPayrollPolicies = pgTable(
  "fp360_payroll_policies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    version: integer("version").notNull(),
    workerSocialSecurityBps: integer("worker_social_security_bps").notNull(),
    employerSocialSecurityBps: integer("employer_social_security_bps").notNull(),
    incomeWithholdingBps: integer("income_withholding_bps").notNull(),
    status: text("status").notNull().default("draft"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    activatedByUserId: text("activated_by_user_id"),
    activatedByName: text("activated_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_payroll_policy_version_unique").on(table.tenantId, table.organizationId, table.version),
    uniqueIndex("fp360_payroll_policy_op_unique").on(table.tenantId, table.operationId),
    index("fp360_payroll_policy_status_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpPayrollRuns = pgTable(
  "fp360_payroll_runs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    periodKey: text("period_key").notNull(),
    version: integer("version").notNull(),
    policyId: text("policy_id").notNull().references(() => fpPayrollPolicies.id),
    receiptLines: jsonb("receipt_lines").$type<FpPayrollReceiptLine[]>().notNull(),
    employeeCount: integer("employee_count").notNull(),
    grossTotalCents: integer("gross_total_cents").notNull(),
    netTotalCents: integer("net_total_cents").notNull(),
    employerCostTotalCents: integer("employer_cost_total_cents").notNull(),
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
    uniqueIndex("fp360_payroll_run_op_unique").on(table.tenantId, table.operationId),
    uniqueIndex("fp360_payroll_run_version_unique").on(table.tenantId, table.organizationId, table.periodKey, table.version),
    index("fp360_payroll_runs_org_period_idx").on(table.tenantId, table.organizationId, table.periodKey),
  ],
);

export const fpPayrollEvents = pgTable(
  "fp360_payroll_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    entityId: text("entity_id").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    eventType: text("event_type").notNull(),
    description: text("description").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_payroll_event_op_unique").on(table.tenantId, table.operationId),
    index("fp360_payroll_events_org_idx").on(table.tenantId, table.organizationId, table.createdAt),
  ],
);

export const insertFpPayrollPolicySchema = createInsertSchema(fpPayrollPolicies).omit({ id: true, createdAt: true, activatedAt: true });
export const insertFpPayrollRunSchema = createInsertSchema(fpPayrollRuns).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFpPayrollEventSchema = createInsertSchema(fpPayrollEvents).omit({ id: true, createdAt: true });
export type InsertFpPayrollPolicy = z.infer<typeof insertFpPayrollPolicySchema>;
export type FpPayrollPolicy = typeof fpPayrollPolicies.$inferSelect;
export type InsertFpPayrollRun = z.infer<typeof insertFpPayrollRunSchema>;
export type FpPayrollRun = typeof fpPayrollRuns.$inferSelect;
export type InsertFpPayrollEvent = z.infer<typeof insertFpPayrollEventSchema>;
export type FpPayrollEvent = typeof fpPayrollEvents.$inferSelect;

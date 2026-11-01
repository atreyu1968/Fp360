import { createInsertSchema } from "drizzle-zod";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { fpOrganizations } from "./redfp360";

export const fpAiDelegations = pgTable("fp360_ai_delegations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
  serviceActorId: text("service_actor_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  allowedOperations: jsonb("allowed_operations").$type<string[]>().notNull().default([]),
  revision: integer("revision").notNull().default(1),
  updatedByUserId: text("updated_by_user_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("fp360_ai_delegation_company_unique").on(t.tenantId, t.organizationId),
  uniqueIndex("fp360_ai_delegation_service_unique").on(t.serviceActorId),
]);
export const insertFpAiDelegationSchema = createInsertSchema(fpAiDelegations);
export type InsertFpAiDelegation = z.infer<typeof insertFpAiDelegationSchema>;
export type FpAiDelegation = typeof fpAiDelegations.$inferSelect;

export const fpAiDelegationRuns = pgTable("fp360_ai_delegation_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
  serviceActorId: text("service_actor_id").notNull(),
  revision: integer("revision").notNull(),
  operationId: text("operation_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  status: text("status").notNull(),
  detail: text("detail").notNull().default(""),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }),
  contextHash: text("context_hash"),
  companyCount: integer("company_count"),
  operationCount: integer("operation_count"),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("fp360_ai_run_operation_unique").on(t.tenantId, t.operationId),
  index("fp360_ai_run_company_idx").on(t.tenantId, t.organizationId, t.createdAt),
]);
export const insertFpAiDelegationRunSchema = createInsertSchema(fpAiDelegationRuns);
export type InsertFpAiDelegationRun = z.infer<typeof insertFpAiDelegationRunSchema>;
export type FpAiDelegationRun = typeof fpAiDelegationRuns.$inferSelect;

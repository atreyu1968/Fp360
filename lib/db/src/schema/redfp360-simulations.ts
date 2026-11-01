import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { fpOrganizations } from "./redfp360";

export const fpSimulationCampaigns = pgTable(
  "fp360_simulation_campaigns",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    ownerOrganizationId: text("owner_organization_id").notNull().references(() => fpOrganizations.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    mode: text("mode").notNull(),
    durationWeeks: integer("duration_weeks").notNull(),
    difficulty: text("difficulty").notNull(),
    status: text("status").notNull().default("draft"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    participantOrganizationIds: jsonb("participant_organization_ids").$type<string[]>().notNull().default([]),
    operationId: text("operation_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_simulation_campaign_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_simulation_campaign_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
    index("fp360_simulation_campaign_owner_idx").on(table.tenantId, table.ownerOrganizationId),
  ],
);

export const insertFpSimulationCampaignSchema = createInsertSchema(fpSimulationCampaigns).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpSimulationCampaign = z.infer<typeof insertFpSimulationCampaignSchema>;
export type FpSimulationCampaign = typeof fpSimulationCampaigns.$inferSelect;

export const fpSimulationEvents = pgTable(
  "fp360_simulation_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    title: text("title").notNull(),
    eventType: text("event_type").notNull(),
    status: text("status").notNull().default("draft"),
    description: text("description").notNull(),
    preconditions: jsonb("preconditions").$type<string[]>().notNull().default([]),
    requiredDocumentType: text("required_document_type"),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    operationId: text("operation_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_simulation_event_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_simulation_event_campaign_idx").on(table.tenantId, table.campaignId, table.status),
    index("fp360_simulation_event_org_idx").on(table.tenantId, table.organizationId, table.simulatedDate),
  ],
);

export const insertFpSimulationEventSchema = createInsertSchema(fpSimulationEvents).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpSimulationEvent = z.infer<typeof insertFpSimulationEventSchema>;
export type FpSimulationEvent = typeof fpSimulationEvents.$inferSelect;

export const fpSimulationAuditEvents = pgTable(
  "fp360_simulation_audit_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    eventId: text("event_id").references(() => fpSimulationEvents.id),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    action: text("action").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    operationId: text("operation_id").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_simulation_audit_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_simulation_audit_campaign_idx").on(table.tenantId, table.campaignId, table.createdAt),
  ],
);

export const insertFpSimulationAuditEventSchema = createInsertSchema(fpSimulationAuditEvents).omit({ createdAt: true });
export type InsertFpSimulationAuditEvent = z.infer<typeof insertFpSimulationAuditEventSchema>;
export type FpSimulationAuditEvent = typeof fpSimulationAuditEvents.$inferSelect;

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { fpSimulationCampaigns } from "./redfp360-simulations";
import { fpDocuments } from "./redfp360-documents";

export const fpCoordinationCampaigns = pgTable(
  "fp360_coordination_campaigns",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    ownerCenterId: text("owner_center_id").notNull(),
    ownerCenterName: text("owner_center_name").notNull(),
    ownerIsland: text("owner_island").notNull(),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    resourcePlan: text("resource_plan").notNull().default(""),
    simulationCampaignId: text("simulation_campaign_id").references(() => fpSimulationCampaigns.id),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("pending_approval"),
    operationId: text("operation_id").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_coord_campaign_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_coord_campaign_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
    index("fp360_coord_campaign_owner_idx").on(table.tenantId, table.ownerCenterId),
  ],
);

export const insertFpCoordinationCampaignSchema = createInsertSchema(fpCoordinationCampaigns).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpCoordinationCampaign = z.infer<typeof insertFpCoordinationCampaignSchema>;
export type FpCoordinationCampaign = typeof fpCoordinationCampaigns.$inferSelect;

export const fpCoordinationParticipants = pgTable(
  "fp360_coordination_participants",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpCoordinationCampaigns.id),
    centerId: text("center_id").notNull(),
    centerName: text("center_name").notNull(),
    island: text("island").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending_approval"),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    decisionNote: text("decision_note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_coord_participant_center_unique").on(table.tenantId, table.campaignId, table.centerId),
    index("fp360_coord_participant_center_idx").on(table.tenantId, table.centerId, table.status),
  ],
);

export const insertFpCoordinationParticipantSchema = createInsertSchema(fpCoordinationParticipants).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpCoordinationParticipant = z.infer<typeof insertFpCoordinationParticipantSchema>;
export type FpCoordinationParticipant = typeof fpCoordinationParticipants.$inferSelect;

export const fpCoordinationEvents = pgTable(
  "fp360_coordination_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpCoordinationCampaigns.id),
    centerIds: jsonb("center_ids").$type<string[]>().notNull().default([]),
    title: text("title").notNull(),
    eventType: text("event_type").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    modality: text("modality").notNull(),
    summary: text("summary").notNull().default(""),
    status: text("status").notNull().default("proposed"),
    createdByUserId: text("created_by_user_id").notNull(),
    operationId: text("operation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_coord_event_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_coord_event_campaign_date_idx").on(table.tenantId, table.campaignId, table.startDate),
  ],
);

export const insertFpCoordinationEventSchema = createInsertSchema(fpCoordinationEvents).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpCoordinationEvent = z.infer<typeof insertFpCoordinationEventSchema>;
export type FpCoordinationEvent = typeof fpCoordinationEvents.$inferSelect;

export const fpCoordinationTasks = pgTable(
  "fp360_coordination_tasks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpCoordinationCampaigns.id),
    centerId: text("center_id").notNull(),
    centerName: text("center_name").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    department: text("department").notNull(),
    responsibleRole: text("responsible_role").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("open"),
    evidenceSummary: text("evidence_summary").notNull().default(""),
    documentId: text("document_id").references(() => fpDocuments.id),
    createdByUserId: text("created_by_user_id").notNull(),
    operationId: text("operation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_coord_task_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_coord_task_campaign_center_idx").on(table.tenantId, table.campaignId, table.centerId, table.status),
  ],
);

export const insertFpCoordinationTaskSchema = createInsertSchema(fpCoordinationTasks).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpCoordinationTask = z.infer<typeof insertFpCoordinationTaskSchema>;
export type FpCoordinationTask = typeof fpCoordinationTasks.$inferSelect;

export const fpCoordinationIncidents = pgTable(
  "fp360_coordination_incidents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpCoordinationCampaigns.id),
    centerId: text("center_id").notNull(),
    centerName: text("center_name").notNull(),
    incidentType: text("incident_type").notNull(),
    severity: text("severity").notNull(),
    summary: text("summary").notNull(),
    status: text("status").notNull().default("open"),
    assignedCenterId: text("assigned_center_id"),
    assignedCenterName: text("assigned_center_name"),
    resolution: text("resolution").notNull().default(""),
    createdByUserId: text("created_by_user_id").notNull(),
    operationId: text("operation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_coord_incident_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_coord_incident_campaign_status_idx").on(table.tenantId, table.campaignId, table.status),
    index("fp360_coord_incident_center_idx").on(table.tenantId, table.centerId, table.createdAt),
  ],
);

export const insertFpCoordinationIncidentSchema = createInsertSchema(fpCoordinationIncidents).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpCoordinationIncident = z.infer<typeof insertFpCoordinationIncidentSchema>;
export type FpCoordinationIncident = typeof fpCoordinationIncidents.$inferSelect;

export const fpCoordinationTransfers = pgTable(
  "fp360_coordination_transfers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpCoordinationCampaigns.id),
    centerId: text("center_id").notNull(),
    centerName: text("center_name").notNull(),
    status: text("status").notNull().default("interested"),
    adoptionSummary: text("adoption_summary").notNull().default(""),
    createdByUserId: text("created_by_user_id").notNull(),
    operationId: text("operation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_coord_transfer_operation_unique").on(table.tenantId, table.operationId),
    uniqueIndex("fp360_coord_transfer_center_unique").on(table.tenantId, table.campaignId, table.centerId),
  ],
);

export const insertFpCoordinationTransferSchema = createInsertSchema(fpCoordinationTransfers).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpCoordinationTransfer = z.infer<typeof insertFpCoordinationTransferSchema>;
export type FpCoordinationTransfer = typeof fpCoordinationTransfers.$inferSelect;

export const fpCoordinationAudit = pgTable(
  "fp360_coordination_audit",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpCoordinationCampaigns.id),
    centerId: text("center_id"),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    action: text("action").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorOrganizationId: text("actor_organization_id"),
    actorRole: text("actor_role").notNull(),
    actorLabel: text("actor_label").notNull(),
    operationId: text("operation_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_coord_audit_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_coord_audit_campaign_idx").on(table.tenantId, table.campaignId, table.createdAt),
    index("fp360_coord_audit_center_idx").on(table.tenantId, table.centerId, table.createdAt),
  ],
);

export const insertFpCoordinationAuditSchema = createInsertSchema(fpCoordinationAudit).omit({ createdAt: true });
export type InsertFpCoordinationAudit = z.infer<typeof insertFpCoordinationAuditSchema>;
export type FpCoordinationAudit = typeof fpCoordinationAudit.$inferSelect;

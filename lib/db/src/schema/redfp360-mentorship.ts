import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { boolean, date, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { fpOrganizations } from "./redfp360";
import { fpDocuments } from "./redfp360-documents";
import { fpSimulationCampaigns, fpSimulationEvents } from "./redfp360-simulations";

export const fpMentorEntities = pgTable(
  "fp360_mentor_entities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    ownerOrganizationId: text("owner_organization_id").references(() => fpOrganizations.id),
    linkedOrganizationId: text("linked_organization_id").references(() => fpOrganizations.id),
    areas: text("areas").array().notNull().default([]),
    agreementStatus: text("agreement_status").notNull().default("draft"),
    agreementReference: text("agreement_reference").notNull(),
    contactName: text("contact_name").notNull(),
    contactRole: text("contact_role").notNull(),
    publishNameAuthorized: boolean("publish_name_authorized").notNull().default(false),
    validFrom: date("valid_from", { mode: "string" }),
    validUntil: date("valid_until", { mode: "string" }),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_mentor_entities_tenant_agreement_idx").on(table.tenantId, table.agreementReference),
    index("fp360_mentor_entities_tenant_status_idx").on(table.tenantId, table.agreementStatus),
    index("fp360_mentor_entities_owner_org_idx").on(table.tenantId, table.ownerOrganizationId),
    index("fp360_mentor_entities_linked_org_idx").on(table.tenantId, table.linkedOrganizationId),
  ],
);

export const insertFpMentorEntitySchema = createInsertSchema(fpMentorEntities).omit({ createdAt: true, updatedAt: true });
export type InsertFpMentorEntity = z.infer<typeof insertFpMentorEntitySchema>;
export type FpMentorEntity = typeof fpMentorEntities.$inferSelect;

export const fpMentorSessions = pgTable(
  "fp360_mentor_sessions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    entityId: text("entity_id").notNull().references(() => fpMentorEntities.id),
    objective: text("objective").notNull(),
    modality: text("modality").notNull(),
    scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
    scheduledTime: text("scheduled_time").notNull(),
    status: text("status").notNull().default("proposed"),
    groupLabel: text("group_label").notNull(),
    participantCount: integer("participant_count").notNull().default(0),
    materialSummary: text("material_summary").notNull().default(""),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("fp360_mentor_sessions_tenant_date_idx").on(table.tenantId, table.scheduledDate, table.status),
    index("fp360_mentor_sessions_entity_date_idx").on(table.tenantId, table.entityId, table.scheduledDate),
    index("fp360_mentor_sessions_campaign_org_idx").on(table.tenantId, table.campaignId, table.organizationId),
  ],
);

export const insertFpMentorSessionSchema = createInsertSchema(fpMentorSessions).omit({ createdAt: true, updatedAt: true });
export type InsertFpMentorSession = z.infer<typeof insertFpMentorSessionSchema>;
export type FpMentorSession = typeof fpMentorSessions.$inferSelect;

export const fpMentorChallenges = pgTable(
  "fp360_mentor_challenges",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    entityId: text("entity_id").notNull().references(() => fpMentorEntities.id),
    organizationId: text("organization_id").references(() => fpOrganizations.id),
    simulationEventId: text("simulation_event_id").references(() => fpSimulationEvents.id),
    title: text("title").notNull(),
    sector: text("sector").notNull(),
    level: text("level").notNull(),
    anonymizedSummary: text("anonymized_summary").notNull(),
    status: text("status").notNull().default("proposed"),
    createdByUserId: text("created_by_user_id").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("fp360_mentor_challenges_tenant_campaign_idx").on(table.tenantId, table.campaignId, table.status),
    index("fp360_mentor_challenges_entity_idx").on(table.tenantId, table.entityId, table.status),
    index("fp360_mentor_challenges_org_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const insertFpMentorChallengeSchema = createInsertSchema(fpMentorChallenges).omit({ createdAt: true, updatedAt: true });
export type InsertFpMentorChallenge = z.infer<typeof insertFpMentorChallengeSchema>;
export type FpMentorChallenge = typeof fpMentorChallenges.$inferSelect;

export const fpMentorReviews = pgTable(
  "fp360_mentor_reviews",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    challengeId: text("challenge_id").notNull().references(() => fpMentorChallenges.id),
    entityId: text("entity_id").notNull().references(() => fpMentorEntities.id),
    reviewerUserId: text("reviewer_user_id").notNull(),
    reviewerLabel: text("reviewer_label").notNull(),
    decision: text("decision").notNull(),
    observation: text("observation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_mentor_reviews_tenant_challenge_idx").on(table.tenantId, table.challengeId, table.createdAt),
    index("fp360_mentor_reviews_entity_idx").on(table.tenantId, table.entityId),
  ],
);

export const insertFpMentorReviewSchema = createInsertSchema(fpMentorReviews).omit({ createdAt: true });
export type InsertFpMentorReview = z.infer<typeof insertFpMentorReviewSchema>;
export type FpMentorReview = typeof fpMentorReviews.$inferSelect;

export const fpMentorEvidence = pgTable(
  "fp360_mentor_evidence",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    sessionId: text("session_id").references(() => fpMentorSessions.id),
    challengeId: text("challenge_id").references(() => fpMentorChallenges.id),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    participantCount: integer("participant_count").notNull().default(0),
    documentId: text("document_id").references(() => fpDocuments.id),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_mentor_evidence_tenant_campaign_idx").on(table.tenantId, table.campaignId, table.createdAt),
    index("fp360_mentor_evidence_session_idx").on(table.tenantId, table.sessionId),
    index("fp360_mentor_evidence_challenge_idx").on(table.tenantId, table.challengeId),
  ],
);

export const insertFpMentorEvidenceSchema = createInsertSchema(fpMentorEvidence).omit({ createdAt: true });
export type InsertFpMentorEvidence = z.infer<typeof insertFpMentorEvidenceSchema>;
export type FpMentorEvidenceRecord = typeof fpMentorEvidence.$inferSelect;

export const fpMentorRecommendations = pgTable(
  "fp360_mentor_recommendations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reviewId: text("review_id").notNull().references(() => fpMentorReviews.id),
    text: text("text").notNull(),
    status: text("status").notNull().default("proposed"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    index("fp360_mentor_recommendations_tenant_review_idx").on(table.tenantId, table.reviewId),
    index("fp360_mentor_recommendations_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const insertFpMentorRecommendationSchema = createInsertSchema(fpMentorRecommendations).omit({ createdAt: true, updatedAt: true });
export type InsertFpMentorRecommendation = z.infer<typeof insertFpMentorRecommendationSchema>;
export type FpMentorRecommendation = typeof fpMentorRecommendations.$inferSelect;

export const fpMentorAudit = pgTable(
  "fp360_mentor_audit",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").references(() => fpSimulationCampaigns.id),
    organizationId: text("organization_id").references(() => fpOrganizations.id),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorLabel: text("actor_label").notNull(),
    operationId: text("operation_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_mentor_audit_tenant_operation_idx").on(table.tenantId, table.operationId),
    index("fp360_mentor_audit_tenant_resource_idx").on(table.tenantId, table.resourceType, table.resourceId),
    index("fp360_mentor_audit_tenant_campaign_idx").on(table.tenantId, table.campaignId, table.createdAt),
  ],
);

export const insertFpMentorAuditSchema = createInsertSchema(fpMentorAudit).omit({ createdAt: true });
export type InsertFpMentorAudit = z.infer<typeof insertFpMentorAuditSchema>;
export type FpMentorAuditRecord = typeof fpMentorAudit.$inferSelect;

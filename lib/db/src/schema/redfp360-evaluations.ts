import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { fpAuthUsers } from "./auth";
import { fpSimulationCampaigns, fpSimulationEvents } from "./redfp360-simulations";
import { fpPortfolioEntries } from "./redfp360-portfolios";

export type EvaluationRubricLevelValue = {
  id: string;
  label: string;
  score: number;
  descriptor: string;
};

export const fpEvaluationGroups = pgTable(
  "fp360_evaluation_groups",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    scoreScale: integer("score_scale").notNull().default(10),
    status: text("status").notNull().default("draft"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: text("closed_by_user_id").references(() => fpAuthUsers.id),
    closeReason: text("close_reason").notNull().default(""),
    createdByUserId: text("created_by_user_id").notNull().references(() => fpAuthUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_evaluation_group_campaign_idx").on(table.tenantId, table.campaignId),
    index("fp360_evaluation_group_status_idx").on(table.tenantId, table.status),
  ],
);

export const fpEvaluationCriteria = pgTable(
  "fp360_evaluation_criteria",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    learningOutcomeCode: text("learning_outcome_code").notNull(),
    learningOutcomeTitle: text("learning_outcome_title").notNull(),
    code: text("code").notNull(),
    title: text("title").notNull(),
    weight: real("weight").notNull(),
    minimumScore: real("minimum_score").notNull().default(5),
    minimumEvidenceCount: integer("minimum_evidence_count").notNull().default(1),
    version: integer("version").notNull().default(1),
    isCurrent: boolean("is_current").notNull().default(true),
    createdByUserId: text("created_by_user_id").notNull().references(() => fpAuthUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_evaluation_criterion_version_idx").on(table.tenantId, table.campaignId, table.code, table.version),
    index("fp360_evaluation_criterion_current_idx").on(table.tenantId, table.campaignId, table.isCurrent),
  ],
);

export const fpEvaluationRubrics = pgTable(
  "fp360_evaluation_rubrics",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    criterionId: text("criterion_id").notNull().references(() => fpEvaluationCriteria.id),
    title: text("title").notNull(),
    version: integer("version").notNull().default(1),
    levels: jsonb("levels").$type<EvaluationRubricLevelValue[]>().notNull(),
    isPublished: boolean("is_published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").notNull().references(() => fpAuthUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_evaluation_rubric_version_idx").on(table.tenantId, table.criterionId, table.version),
    index("fp360_evaluation_rubric_campaign_idx").on(table.tenantId, table.campaignId, table.criterionId),
  ],
);

export const fpEvaluationActivityCriteria = pgTable(
  "fp360_evaluation_activity_criteria",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    eventId: text("event_id").notNull().references(() => fpSimulationEvents.id),
    criterionId: text("criterion_id").notNull().references(() => fpEvaluationCriteria.id),
    assignedByUserId: text("assigned_by_user_id").notNull().references(() => fpAuthUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_evaluation_activity_criterion_idx").on(table.tenantId, table.eventId, table.criterionId),
    index("fp360_evaluation_activity_campaign_idx").on(table.tenantId, table.campaignId, table.eventId),
  ],
);

export const fpEvaluationAssessments = pgTable(
  "fp360_evaluation_assessments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    portfolioEntryId: text("portfolio_entry_id").notNull().references(() => fpPortfolioEntries.id),
    studentUserId: text("student_user_id").notNull().references(() => fpAuthUsers.id),
    criterionId: text("criterion_id").notNull().references(() => fpEvaluationCriteria.id),
    rubricId: text("rubric_id").notNull().references(() => fpEvaluationRubrics.id),
    rubricVersion: integer("rubric_version").notNull(),
    rubricLevelId: text("rubric_level_id").notNull(),
    rubricLevelLabel: text("rubric_level_label").notNull(),
    score: real("score").notNull(),
    scoreScale: integer("score_scale").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    isRecovery: boolean("is_recovery").notNull().default(false),
    status: text("status").notNull(),
    feedback: text("feedback").notNull(),
    reason: text("reason").notNull(),
    evaluatedByUserId: text("evaluated_by_user_id").notNull().references(() => fpAuthUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_evaluation_attempt_number_idx").on(table.tenantId, table.portfolioEntryId, table.criterionId, table.attemptNumber),
    index("fp360_evaluation_assessment_student_idx").on(table.tenantId, table.studentUserId, table.campaignId),
    index("fp360_evaluation_assessment_org_idx").on(table.tenantId, table.organizationId, table.campaignId),
  ],
);

export const fpEvaluationAudit = pgTable(
  "fp360_evaluation_audit",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    organizationId: text("organization_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    actorUserId: text("actor_user_id").notNull().references(() => fpAuthUsers.id),
    reason: text("reason").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_evaluation_audit_campaign_idx").on(table.tenantId, table.campaignId, table.createdAt),
    index("fp360_evaluation_audit_org_idx").on(table.tenantId, table.organizationId, table.campaignId, table.createdAt),
    index("fp360_evaluation_audit_entity_idx").on(table.tenantId, table.entityType, table.entityId, table.createdAt),
  ],
);

export const insertFpEvaluationGroupSchema = createInsertSchema(fpEvaluationGroups).omit({ createdAt: true });
export type InsertFpEvaluationGroup = z.infer<typeof insertFpEvaluationGroupSchema>;
export type FpEvaluationGroup = typeof fpEvaluationGroups.$inferSelect;
export type FpEvaluationCriterion = typeof fpEvaluationCriteria.$inferSelect;
export type FpEvaluationRubric = typeof fpEvaluationRubrics.$inferSelect;
export type FpEvaluationAssessment = typeof fpEvaluationAssessments.$inferSelect;
export type FpEvaluationAudit = typeof fpEvaluationAudit.$inferSelect;

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { fpAuthUsers } from "./auth";
import { fpOrganizations } from "./redfp360";
import { fpSimulationCampaigns, fpSimulationEvents } from "./redfp360-simulations";

export const fpPortfolioCriteria = pgTable(
  "fp360_portfolio_criteria",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    code: text("code"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    isRequired: boolean("is_required").notNull().default(true),
    createdByUserId: text("created_by_user_id").notNull().references(() => fpAuthUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_portfolio_criteria_campaign_code_idx").on(table.tenantId, table.campaignId, table.code),
    index("fp360_portfolio_criteria_campaign_idx").on(table.tenantId, table.campaignId),
  ],
);

export const insertFpPortfolioCriterionSchema = createInsertSchema(fpPortfolioCriteria).omit({ createdAt: true });
export type InsertFpPortfolioCriterion = z.infer<typeof insertFpPortfolioCriterionSchema>;
export type FpPortfolioCriterion = typeof fpPortfolioCriteria.$inferSelect;

export const fpPortfolioEntries = pgTable(
  "fp360_portfolio_entries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    campaignId: text("campaign_id").notNull().references(() => fpSimulationCampaigns.id),
    eventId: text("event_id").notNull().references(() => fpSimulationEvents.id),
    studentUserId: text("student_user_id").notNull().references(() => fpAuthUsers.id),
    status: text("status").notNull().default("draft"),
    reflection: text("reflection").notNull().default(""),
    contribution: text("contribution").notNull().default(""),
    selfAssessment: text("self_assessment").notNull().default(""),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedByUserId: text("reviewed_by_user_id").references(() => fpAuthUsers.id),
    feedback: text("feedback").notNull().default(""),
  },
  (table) => [
    uniqueIndex("fp360_portfolio_entry_event_student_idx").on(table.tenantId, table.eventId, table.studentUserId),
    index("fp360_portfolio_entry_campaign_idx").on(table.tenantId, table.campaignId, table.status),
    index("fp360_portfolio_entry_student_idx").on(table.tenantId, table.studentUserId, table.updatedAt),
    index("fp360_portfolio_entry_org_idx").on(table.tenantId, table.organizationId, table.campaignId),
  ],
);

export const insertFpPortfolioEntrySchema = createInsertSchema(fpPortfolioEntries).omit({ createdAt: true, updatedAt: true });
export type InsertFpPortfolioEntry = z.infer<typeof insertFpPortfolioEntrySchema>;
export type FpPortfolioEntry = typeof fpPortfolioEntries.$inferSelect;

export const fpPortfolioEntryCriteria = pgTable(
  "fp360_portfolio_entry_criteria",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entryId: text("entry_id").notNull().references(() => fpPortfolioEntries.id),
    criterionId: text("criterion_id").notNull().references(() => fpPortfolioCriteria.id),
  },
  (table) => [
    uniqueIndex("fp360_portfolio_entry_criterion_unique_idx").on(table.tenantId, table.entryId, table.criterionId),
    index("fp360_portfolio_entry_criteria_entry_idx").on(table.tenantId, table.entryId),
  ],
);

export const fpPortfolioRevisions = pgTable(
  "fp360_portfolio_revisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entryId: text("entry_id").notNull().references(() => fpPortfolioEntries.id),
    version: integer("version").notNull(),
    reflection: text("reflection").notNull(),
    contribution: text("contribution").notNull(),
    selfAssessment: text("self_assessment").notNull(),
    createdByUserId: text("created_by_user_id").notNull().references(() => fpAuthUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_portfolio_revision_version_idx").on(table.tenantId, table.entryId, table.version),
    index("fp360_portfolio_revision_entry_idx").on(table.tenantId, table.entryId, table.createdAt),
  ],
);

export const insertFpPortfolioRevisionSchema = createInsertSchema(fpPortfolioRevisions).omit({ createdAt: true });
export type InsertFpPortfolioRevision = z.infer<typeof insertFpPortfolioRevisionSchema>;
export type FpPortfolioRevision = typeof fpPortfolioRevisions.$inferSelect;

export const fpPortfolioReviews = pgTable(
  "fp360_portfolio_reviews",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entryId: text("entry_id").notNull().references(() => fpPortfolioEntries.id),
    version: integer("version").notNull(),
    outcome: text("outcome").notNull(),
    feedback: text("feedback").notNull(),
    reviewerUserId: text("reviewer_user_id").notNull().references(() => fpAuthUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_portfolio_review_entry_idx").on(table.tenantId, table.entryId, table.createdAt),
  ],
);

export const insertFpPortfolioReviewSchema = createInsertSchema(fpPortfolioReviews).omit({ createdAt: true });
export type InsertFpPortfolioReview = z.infer<typeof insertFpPortfolioReviewSchema>;
export type FpPortfolioReview = typeof fpPortfolioReviews.$inferSelect;

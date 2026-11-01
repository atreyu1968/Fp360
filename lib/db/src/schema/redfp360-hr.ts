import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { fpOrganizations } from "./redfp360";

export const fpHrVacancies = pgTable(
  "fp360_hr_vacancies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    jobTitle: text("job_title").notNull(),
    department: text("department").notNull(),
    contractType: text("contract_type").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("open"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_hr_vacancies_org_status_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpHrCandidates = pgTable(
  "fp360_hr_candidates",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    vacancyId: text("vacancy_id").notNull().references(() => fpHrVacancies.id),
    candidateRef: text("candidate_ref").notNull(),
    trainingScore: integer("training_score").notNull(),
    skillsScore: integer("skills_score").notNull(),
    availabilityScore: integer("availability_score").notNull(),
    status: text("status").notNull().default("received"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedByName: text("reviewed_by_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_hr_candidate_ref_unique").on(table.tenantId, table.organizationId, table.candidateRef),
    uniqueIndex("fp360_hr_candidate_vacancy_ref_unique").on(table.tenantId, table.vacancyId, table.candidateRef),
    index("fp360_hr_candidates_org_status_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpHrEmployees = pgTable(
  "fp360_hr_employees",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    candidateId: text("candidate_id").notNull().references(() => fpHrCandidates.id),
    workerRef: text("worker_ref").notNull(),
    jobTitle: text("job_title").notNull(),
    department: text("department").notNull(),
    contractType: text("contract_type").notNull(),
    weeklyHours: integer("weekly_hours").notNull(),
    contributionGroup: integer("contribution_group").notNull(),
    annualSalaryCents: integer("annual_salary_cents").notNull(),
    conventionName: text("convention_name").notNull(),
    virtualBankRef: text("virtual_bank_ref").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    status: text("status").notNull().default("pending"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_hr_employee_ref_unique").on(table.tenantId, table.organizationId, table.workerRef),
    uniqueIndex("fp360_hr_employee_candidate_unique").on(table.tenantId, table.candidateId),
    index("fp360_hr_employees_org_status_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpHrContracts = pgTable(
  "fp360_hr_contracts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    employeeId: text("employee_id").notNull().references(() => fpHrEmployees.id),
    version: integer("version").notNull(),
    documentType: text("document_type").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    contractType: text("contract_type").notNull(),
    weeklyHours: integer("weekly_hours").notNull(),
    annualSalaryCents: integer("annual_salary_cents").notNull(),
    contributionGroup: integer("contribution_group").notNull(),
    conventionName: text("convention_name").notNull(),
    status: text("status").notNull().default("pending_review"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedByName: text("reviewed_by_name"),
    reviewAction: text("review_action"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_hr_contract_op_unique").on(table.tenantId, table.operationId),
    uniqueIndex("fp360_hr_contract_version_unique").on(table.tenantId, table.employeeId, table.version),
    index("fp360_hr_contracts_org_status_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpHrAbsences = pgTable(
  "fp360_hr_absences",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    employeeId: text("employee_id").notNull().references(() => fpHrEmployees.id),
    absenceType: text("absence_type").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
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
    uniqueIndex("fp360_hr_absence_op_unique").on(table.tenantId, table.operationId),
    index("fp360_hr_absences_org_date_idx").on(table.tenantId, table.organizationId, table.startDate),
  ],
);

export const fpHrLifecycleChanges = pgTable(
  "fp360_hr_lifecycle_changes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    employeeId: text("employee_id").notNull().references(() => fpHrEmployees.id),
    changeType: text("change_type").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
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
    uniqueIndex("fp360_hr_lifecycle_op_unique").on(table.tenantId, table.operationId),
    index("fp360_hr_lifecycle_org_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpHrEvents = pgTable(
  "fp360_hr_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    entityId: text("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    description: text("description").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_hr_event_op_unique").on(table.tenantId, table.operationId),
    index("fp360_hr_events_org_idx").on(table.tenantId, table.organizationId, table.createdAt),
  ],
);

export const insertFpHrVacancySchema = createInsertSchema(fpHrVacancies).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFpHrCandidateSchema = createInsertSchema(fpHrCandidates).omit({ id: true, createdAt: true, reviewedAt: true });
export const insertFpHrEmployeeSchema = createInsertSchema(fpHrEmployees).omit({ id: true, createdAt: true, updatedAt: true });
export const insertFpHrContractSchema = createInsertSchema(fpHrContracts).omit({ id: true, createdAt: true, updatedAt: true, reviewedAt: true });
export const insertFpHrAbsenceSchema = createInsertSchema(fpHrAbsences).omit({ id: true, createdAt: true, reviewedAt: true });
export const insertFpHrLifecycleChangeSchema = createInsertSchema(fpHrLifecycleChanges).omit({ id: true, createdAt: true, reviewedAt: true });
export const insertFpHrEventSchema = createInsertSchema(fpHrEvents).omit({ id: true, createdAt: true });

export type InsertFpHrVacancy = z.infer<typeof insertFpHrVacancySchema>;
export type FpHrVacancy = typeof fpHrVacancies.$inferSelect;
export type InsertFpHrCandidate = z.infer<typeof insertFpHrCandidateSchema>;
export type FpHrCandidate = typeof fpHrCandidates.$inferSelect;
export type InsertFpHrEmployee = z.infer<typeof insertFpHrEmployeeSchema>;
export type FpHrEmployee = typeof fpHrEmployees.$inferSelect;
export type InsertFpHrContract = z.infer<typeof insertFpHrContractSchema>;
export type FpHrContract = typeof fpHrContracts.$inferSelect;
export type InsertFpHrAbsence = z.infer<typeof insertFpHrAbsenceSchema>;
export type FpHrAbsence = typeof fpHrAbsences.$inferSelect;
export type InsertFpHrLifecycleChange = z.infer<typeof insertFpHrLifecycleChangeSchema>;
export type FpHrLifecycleChange = typeof fpHrLifecycleChanges.$inferSelect;
export type InsertFpHrEvent = z.infer<typeof insertFpHrEventSchema>;
export type FpHrEvent = typeof fpHrEvents.$inferSelect;

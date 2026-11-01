import { createInsertSchema } from "drizzle-zod";
import { date, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { fpHrContracts, fpHrLifecycleChanges } from "./redfp360-hr";
import { fpOrganizations } from "./redfp360";

export const fpEmploymentCommunications = pgTable(
  "fp360_employment_communications",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    communicationRef: text("communication_ref").notNull(),
    communicationType: text("communication_type").notNull(),
    contractId: text("contract_id").references(() => fpHrContracts.id),
    lifecycleChangeId: text("lifecycle_change_id").references(() => fpHrLifecycleChanges.id),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    acknowledgmentRef: text("acknowledgment_ref"),
    responseMessage: text("response_message"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    resubmittedAt: timestamp("resubmitted_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_employment_communication_ref_unique").on(table.tenantId, table.communicationRef),
    uniqueIndex("fp360_employment_communication_op_unique").on(table.tenantId, table.operationId),
    uniqueIndex("fp360_employment_contract_communication_unique").on(table.tenantId, table.contractId),
    uniqueIndex("fp360_employment_lifecycle_communication_unique").on(table.tenantId, table.lifecycleChangeId),
    index("fp360_employment_communications_org_status_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const insertFpEmploymentCommunicationSchema = createInsertSchema(fpEmploymentCommunications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resubmittedAt: true,
});
export type InsertFpEmploymentCommunication = z.infer<typeof insertFpEmploymentCommunicationSchema>;
export type FpEmploymentCommunication = typeof fpEmploymentCommunications.$inferSelect;

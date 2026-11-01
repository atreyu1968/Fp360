import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { fpOrganizations } from "./redfp360";

export const fpCommunicationsThreads = pgTable(
  "fp360_communications_threads",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reference: text("reference").notNull(),
    originOrganizationId: text("origin_organization_id").notNull().references(() => fpOrganizations.id),
    recipientOrganizationId: text("recipient_organization_id").notNull().references(() => fpOrganizations.id),
    originDepartment: text("origin_department").notNull(),
    recipientDepartment: text("recipient_department").notNull(),
    subject: text("subject").notNull(),
    priority: text("priority").notNull().default("normal"),
    status: text("status").notNull().default("open"),
    relatedReference: text("related_reference"),
    assignedOrganizationId: text("assigned_organization_id").references(() => fpOrganizations.id),
    assignedDepartment: text("assigned_department"),
    createdByUserId: text("created_by_user_id").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_communications_thread_ref_unique").on(table.tenantId, table.reference),
    uniqueIndex("fp360_communications_thread_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_communications_origin_idx").on(table.tenantId, table.originOrganizationId, table.updatedAt),
    index("fp360_communications_recipient_idx").on(table.tenantId, table.recipientOrganizationId, table.updatedAt),
  ],
);

export const fpCommunicationsMessages = pgTable(
  "fp360_communications_messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    threadId: text("thread_id").notNull().references(() => fpCommunicationsThreads.id),
    senderOrganizationId: text("sender_organization_id").notNull().references(() => fpOrganizations.id),
    senderDepartment: text("sender_department").notNull(),
    body: text("body").notNull(),
    attachmentDocumentIds: jsonb("attachment_document_ids").$type<string[]>().notNull().default([]),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("sent"),
    createdByUserId: text("created_by_user_id").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_communications_message_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_communications_message_thread_idx").on(table.tenantId, table.threadId, table.createdAt),
  ],
);

export const fpCommunicationsThreadStates = pgTable(
  "fp360_communications_thread_states",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    threadId: text("thread_id").notNull().references(() => fpCommunicationsThreads.id),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    userId: text("user_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_communications_thread_state_unique").on(table.tenantId, table.threadId, table.userId),
    index("fp360_communications_thread_state_user_idx").on(table.tenantId, table.userId, table.archivedAt),
  ],
);

export const fpCommunicationsTasks = pgTable(
  "fp360_communications_tasks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    threadId: text("thread_id").notNull().references(() => fpCommunicationsThreads.id),
    assignedOrganizationId: text("assigned_organization_id").notNull().references(() => fpOrganizations.id),
    assignedDepartment: text("assigned_department").notNull(),
    title: text("title").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("open"),
    createdByUserId: text("created_by_user_id").notNull(),
    completedByUserId: text("completed_by_user_id"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fp360_communications_task_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_communications_task_scope_idx").on(table.tenantId, table.assignedOrganizationId, table.status, table.dueDate),
  ],
);

export const fpCommunicationsEvents = pgTable(
  "fp360_communications_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    threadId: text("thread_id").notNull().references(() => fpCommunicationsThreads.id),
    entityId: text("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorRef: text("actor_ref").notNull(),
    description: text("description").notNull(),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_communications_event_operation_unique").on(table.tenantId, table.operationId),
    index("fp360_communications_event_thread_idx").on(table.tenantId, table.threadId, table.createdAt),
  ],
);

export type FpCommunicationsThread = typeof fpCommunicationsThreads.$inferSelect;
export type FpCommunicationsMessage = typeof fpCommunicationsMessages.$inferSelect;
export type FpCommunicationsTask = typeof fpCommunicationsTasks.$inferSelect;
export type FpCommunicationsEvent = typeof fpCommunicationsEvents.$inferSelect;

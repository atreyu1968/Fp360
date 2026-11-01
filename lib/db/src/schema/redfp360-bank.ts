import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { fpInvoices, fpOrganizations } from "./redfp360";

export const fpBankAccounts = pgTable(
  "fp360_bank_accounts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").references(() => fpOrganizations.id),
    accountType: text("account_type").notNull().default("company"),
    name: text("name").notNull(),
    syntheticReference: text("synthetic_reference").notNull(),
    balanceCents: integer("balance_cents").notNull().default(0),
    reservedCents: integer("reserved_cents").notNull().default(0),
    status: text("status").notNull().default("active"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_bank_accounts_reference_idx").on(table.tenantId, table.syntheticReference),
    uniqueIndex("fp360_bank_accounts_primary_idx")
      .on(table.tenantId, table.organizationId)
      .where(sql`${table.isPrimary} = true`),
    index("fp360_bank_accounts_org_idx").on(table.tenantId, table.organizationId),
  ],
);

export const fpBankTransfers = pgTable(
  "fp360_bank_transfers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    sourceAccountId: text("source_account_id").notNull().references(() => fpBankAccounts.id),
    beneficiaryAccountId: text("beneficiary_account_id").notNull().references(() => fpBankAccounts.id),
    amountCents: integer("amount_cents").notNull(),
    concept: text("concept").notNull(),
    scheduledDate: date("scheduled_date", { mode: "string" }),
    status: text("status").notNull().default("draft"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    validatedByUserId: text("validated_by_user_id"),
    authorizedByUserId: text("authorized_by_user_id"),
    rejectedReason: text("rejected_reason"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_bank_transfers_operation_idx").on(table.tenantId, table.operationId),
    index("fp360_bank_transfers_org_idx").on(table.tenantId, table.organizationId, table.createdAt),
    index("fp360_bank_transfers_status_idx").on(table.tenantId, table.status),
  ],
);

export const fpBankEffects = pgTable(
  "fp360_bank_effects",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    invoiceId: text("invoice_id").notNull().references(() => fpInvoices.id),
    reference: text("reference").notNull(),
    nominalCents: integer("nominal_cents").notNull(),
    maturityDate: date("maturity_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("presented"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_bank_effects_reference_idx").on(table.tenantId, table.reference),
    uniqueIndex("fp360_bank_effects_operation_idx").on(table.tenantId, table.operationId),
    index("fp360_bank_effects_org_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpBankFinancing = pgTable(
  "fp360_bank_financing",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    accountId: text("account_id").notNull().references(() => fpBankAccounts.id),
    productType: text("product_type").notNull(),
    effectId: text("effect_id").references(() => fpBankEffects.id),
    requestedAmountCents: integer("requested_amount_cents").notNull(),
    offeredAmountCents: integer("offered_amount_cents"),
    termMonths: integer("term_months").notNull().default(0),
    annualRateBps: integer("annual_rate_bps").notNull(),
    commissionBps: integer("commission_bps").notNull().default(0),
    installmentCents: integer("installment_cents"),
    totalInterestCents: integer("total_interest_cents"),
    totalCostCents: integer("total_cost_cents"),
    netDisbursementCents: integer("net_disbursement_cents"),
    creditLimitCents: integer("credit_limit_cents"),
    drawnCents: integer("drawn_cents").notNull().default(0),
    maturityDate: date("maturity_date", { mode: "string" }),
    status: text("status").notNull().default("pending_review"),
    decisionReason: text("decision_reason"),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByName: text("created_by_name").notNull(),
    offeredByUserId: text("offered_by_user_id"),
    offeredByName: text("offered_by_name"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_bank_financing_operation_idx").on(table.tenantId, table.operationId),
    index("fp360_bank_financing_org_idx").on(table.tenantId, table.organizationId, table.status),
  ],
);

export const fpBankInstallments = pgTable(
  "fp360_bank_installments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    financingId: text("financing_id").notNull().references(() => fpBankFinancing.id, { onDelete: "cascade" }),
    installmentNumber: integer("installment_number").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    principalCents: integer("principal_cents").notNull(),
    interestCents: integer("interest_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: text("status").notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    paymentOperationId: text("payment_operation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_bank_installments_number_idx").on(table.tenantId, table.financingId, table.installmentNumber),
    uniqueIndex("fp360_bank_installments_payment_idx").on(table.tenantId, table.paymentOperationId),
    index("fp360_bank_installments_due_idx").on(table.tenantId, table.dueDate, table.status),
  ],
);

export const fpBankMovements = pgTable(
  "fp360_bank_movements",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    accountId: text("account_id").notNull().references(() => fpBankAccounts.id),
    counterpartyAccountId: text("counterparty_account_id").references(() => fpBankAccounts.id),
    transferId: text("transfer_id").references(() => fpBankTransfers.id),
    financingId: text("financing_id").references(() => fpBankFinancing.id),
    direction: text("direction").notNull(),
    amountCents: integer("amount_cents").notNull(),
    deltaCents: integer("delta_cents").notNull(),
    balanceAfterCents: integer("balance_after_cents").notNull(),
    reference: text("reference").notNull(),
    description: text("description").notNull(),
    operationId: text("operation_id").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_bank_movements_operation_account_idx").on(table.tenantId, table.operationId, table.accountId),
    index("fp360_bank_movements_account_idx").on(table.tenantId, table.accountId, table.createdAt),
    index("fp360_bank_movements_transfer_idx").on(table.tenantId, table.transferId),
  ],
);

export const fpBankEvents = pgTable(
  "fp360_bank_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").references(() => fpOrganizations.id),
    accountId: text("account_id").references(() => fpBankAccounts.id),
    transferId: text("transfer_id").references(() => fpBankTransfers.id),
    financingId: text("financing_id").references(() => fpBankFinancing.id),
    operationId: text("operation_id").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    eventType: text("event_type").notNull(),
    description: text("description").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_bank_events_operation_idx").on(table.tenantId, table.operationId),
    index("fp360_bank_events_transfer_idx").on(table.tenantId, table.transferId),
    index("fp360_bank_events_financing_idx").on(table.tenantId, table.financingId),
  ],
);

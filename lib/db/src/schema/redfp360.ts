import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const fpOrganizations = pgTable(
  "fp360_organizations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    center: text("center").notNull(),
    island: text("island").notNull(),
    role: text("role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [index("fp360_organizations_tenant_idx").on(table.tenantId)],
);

export const fpProducts = pgTable(
  "fp360_products",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    itemType: text("item_type").notNull().default("product"),
    unit: text("unit").notNull().default("unidad"),
    tracksInventory: boolean("tracks_inventory").notNull().default(true),
    unitPriceCents: integer("unit_price_cents").notNull(),
    igicBasisPoints: integer("igic_basis_points").notNull(),
    stock: integer("stock").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    minimumStock: integer("minimum_stock").notNull().default(0),
    maxDiscountBasisPoints: integer("max_discount_basis_points").notNull().default(0),
    leadTimeDays: integer("lead_time_days").notNull().default(0),
    supplierOrganizationId: text("supplier_organization_id").references(() => fpOrganizations.id),
    isActive: boolean("is_active").notNull().default(true),
    // Preserve the existing demo catalog. New API-created products explicitly start unpublished.
    isPublished: boolean("is_published").notNull().default(true),
  },
  (table) => [
    index("fp360_products_tenant_idx").on(table.tenantId),
    uniqueIndex("fp360_products_tenant_sku_idx").on(table.tenantId, table.sku),
  ],
);

export const fpProductPriceVersions = pgTable(
  "fp360_product_price_versions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull().references(() => fpProducts.id),
    unitPriceCents: integer("unit_price_cents").notNull(),
    costCents: integer("cost_cents").notNull(),
    igicBasisPoints: integer("igic_basis_points").notNull(),
    maxDiscountBasisPoints: integer("max_discount_basis_points").notNull().default(0),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    reason: text("reason").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_product_price_versions_tenant_product_idx").on(table.tenantId, table.productId),
  ],
);

export const fpProductDocuments = pgTable(
  "fp360_product_documents",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull().references(() => fpProducts.id),
    objectPath: text("object_path").notNull(),
    originalName: text("original_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("pending"),
    uploaderUserId: text("uploader_user_id").notNull(),
    uploaderName: text("uploader_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_product_documents_tenant_product_idx").on(table.tenantId, table.productId),
    uniqueIndex("fp360_product_documents_object_path_idx").on(table.objectPath),
  ],
);

export const fpStockAdjustments = pgTable(
  "fp360_stock_adjustments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull().references(() => fpProducts.id),
    quantityDelta: integer("quantity_delta").notNull(),
    stockBefore: integer("stock_before").notNull(),
    stockAfter: integer("stock_after").notNull(),
    reason: text("reason").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorName: text("actor_name").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("fp360_stock_adjustment_product_idx").on(table.tenantId, table.productId)],
);

export const fpOrders = pgTable(
  "fp360_orders",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reference: text("reference").notNull(),
    buyerOrganizationId: text("buyer_organization_id")
      .notNull()
      .references(() => fpOrganizations.id),
    status: text("status").notNull(),
    totalCents: integer("total_cents").notNull().default(0),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("fp360_orders_tenant_idx").on(table.tenantId),
    index("fp360_orders_buyer_idx").on(table.buyerOrganizationId),
  ],
);

export const fpOrderLines = pgTable(
  "fp360_order_lines",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => fpOrders.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    shippedQuantity: integer("shipped_quantity").notNull().default(0),
    invoicedQuantity: integer("invoiced_quantity").notNull().default(0),
    unitPriceCents: integer("unit_price_cents").notNull(),
    unitCostCents: integer("unit_cost_cents"),
    igicBasisPoints: integer("igic_basis_points").notNull(),
    itemType: text("item_type").notNull().default("product"),
    tracksInventory: boolean("tracks_inventory").notNull().default(true),
  },
  (table) => [index("fp360_order_lines_order_idx").on(table.orderId)],
);

export const fpInvoices = pgTable(
  "fp360_invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    reference: text("reference").notNull(),
    orderId: text("order_id")
      .notNull()
      .references(() => fpOrders.id),
    buyerName: text("buyer_name").notNull(),
    baseCents: integer("base_cents").notNull(),
    igicCents: integer("igic_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("fp360_invoices_tenant_idx").on(table.tenantId),
    index("fp360_invoices_order_idx").on(table.orderId),
    uniqueIndex("fp360_invoices_reference_idx").on(table.tenantId, table.reference),
  ],
);

export const fpInvoiceLines = pgTable(
  "fp360_invoice_lines",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => fpInvoices.id, { onDelete: "cascade" }),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    baseCents: integer("base_cents").notNull(),
    igicBasisPoints: integer("igic_basis_points").notNull(),
    igicCents: integer("igic_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
  },
  (table) => [index("fp360_invoice_lines_invoice_idx").on(table.invoiceId)],
);

export const fpPayments = pgTable(
  "fp360_payments",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => fpInvoices.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("fp360_payments_invoice_idx").on(table.invoiceId)],
);

export const fpActivity = pgTable(
  "fp360_activity",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    action: text("action").notNull(),
    description: text("description").notNull(),
    reference: text("reference").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("fp360_activity_tenant_idx").on(table.tenantId)],
);

export const fpCrmContacts = pgTable(
  "fp360_crm_contacts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    fullName: text("full_name").notNull(),
    position: text("position").notNull(),
    channel: text("channel").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_crm_contacts_tenant_idx").on(table.tenantId),
    index("fp360_crm_contacts_org_idx").on(table.tenantId, table.organizationId),
  ],
);

export const fpCrmOpportunities = pgTable(
  "fp360_crm_opportunities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    title: text("title").notNull(),
    stage: text("stage").notNull().default("new"),
    estimatedValueCents: integer("estimated_value_cents").notNull(),
    probabilityBasisPoints: integer("probability_basis_points").notNull().default(1000),
    expectedDate: date("expected_date", { mode: "string" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_crm_opportunities_tenant_idx").on(table.tenantId),
    index("fp360_crm_opportunities_org_idx").on(table.tenantId, table.organizationId),
  ],
);

export const fpCrmOpportunityHistory = pgTable(
  "fp360_crm_opportunity_history",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    opportunityId: text("opportunity_id").notNull().references(() => fpCrmOpportunities.id),
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    reason: text("reason").notNull(),
    actorUserId: text("actor_user_id"),
    actorRole: text("actor_role").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_crm_stage_history_tenant_idx").on(table.tenantId, table.opportunityId),
  ],
);

export const fpCrmActivities = pgTable(
  "fp360_crm_activities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    opportunityId: text("opportunity_id").notNull().references(() => fpCrmOpportunities.id),
    contactId: text("contact_id").references(() => fpCrmContacts.id),
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    status: text("status").notNull().default("planned"),
    dueDate: date("due_date", { mode: "string" }),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    actorUserId: text("actor_user_id"),
    actorRole: text("actor_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_crm_activities_tenant_idx").on(table.tenantId),
    index("fp360_crm_activities_opportunity_idx").on(table.tenantId, table.opportunityId),
  ],
);

export const fpPurchaseRequests = pgTable(
  "fp360_purchase_requests",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    organizationId: text("organization_id").notNull().references(() => fpOrganizations.id),
    requestNumber: text("request_number").notNull(),
    department: text("department").notNull(),
    urgency: text("urgency").notNull(),
    deadline: date("deadline", { mode: "string" }),
    budgetCapCents: integer("budget_cap_cents").notNull(),
    purpose: text("purpose").notNull(),
    status: text("status").notNull().default("draft"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    decisionReason: text("decision_reason"),
    decisionByUserId: text("decision_by_user_id"),
    awardedReason: text("awarded_reason"),
    awardedOfferId: text("awarded_offer_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_purchase_requests_tenant_idx").on(table.tenantId, table.organizationId),
    uniqueIndex("fp360_purchase_requests_number_idx").on(table.tenantId, table.requestNumber),
  ],
);

export const fpPurchaseRequestLines = pgTable(
  "fp360_purchase_request_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull().references(() => fpPurchaseRequests.id),
    productId: text("product_id").notNull().references(() => fpProducts.id),
    skuSnapshot: text("sku_snapshot").notNull(),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    justification: text("justification").notNull(),
  },
  (table) => [index("fp360_purchase_request_lines_idx").on(table.tenantId, table.requestId)],
);

export const fpPurchaseRequestSuppliers = pgTable(
  "fp360_purchase_request_suppliers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull().references(() => fpPurchaseRequests.id),
    supplierOrganizationId: text("supplier_organization_id").notNull().references(() => fpOrganizations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_purchase_request_suppliers_tenant_idx").on(table.tenantId, table.requestId),
    uniqueIndex("fp360_purchase_request_supplier_unique_idx").on(table.tenantId, table.requestId, table.supplierOrganizationId),
  ],
);

export const fpPurchaseOffers = pgTable(
  "fp360_purchase_offers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull().references(() => fpPurchaseRequests.id),
    supplierOrganizationId: text("supplier_organization_id").notNull().references(() => fpOrganizations.id),
    quoteReference: text("quote_reference").notNull(),
    deliveryDays: integer("delivery_days").notNull(),
    paymentDays: integer("payment_days").notNull(),
    freightCents: integer("freight_cents").notNull(),
    qualityScoreBasisPoints: integer("quality_score_basis_points").notNull(),
    validUntil: date("valid_until", { mode: "string" }),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_purchase_offers_tenant_idx").on(table.tenantId, table.requestId),
    uniqueIndex("fp360_purchase_offer_supplier_unique_idx").on(table.tenantId, table.requestId, table.supplierOrganizationId),
  ],
);

export const fpPurchaseOfferLines = pgTable(
  "fp360_purchase_offer_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    offerId: text("offer_id").notNull().references(() => fpPurchaseOffers.id),
    requestLineId: text("request_line_id").notNull().references(() => fpPurchaseRequestLines.id),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    igicBasisPoints: integer("igic_basis_points").notNull(),
  },
  (table) => [
    index("fp360_purchase_offer_lines_idx").on(table.tenantId, table.offerId),
    uniqueIndex("fp360_purchase_offer_line_unique_idx").on(table.tenantId, table.offerId, table.requestLineId),
  ],
);

export const fpPurchaseOrders = pgTable(
  "fp360_purchase_orders",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull().references(() => fpPurchaseRequests.id),
    offerId: text("offer_id").notNull().references(() => fpPurchaseOffers.id),
    buyerOrganizationId: text("buyer_organization_id").notNull().references(() => fpOrganizations.id),
    supplierOrganizationId: text("supplier_organization_id").notNull().references(() => fpOrganizations.id),
    orderNumber: text("order_number").notNull(),
    baseCents: integer("base_cents").notNull(),
    igicCents: integer("igic_cents").notNull(),
    freightCents: integer("freight_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: text("status").notNull().default("ordered"),
    expectedDate: date("expected_date", { mode: "string" }),
    receivedDate: date("received_date", { mode: "string" }),
    awardedReason: text("awarded_reason").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_purchase_orders_tenant_idx").on(table.tenantId, table.buyerOrganizationId),
    uniqueIndex("fp360_purchase_orders_request_unique_idx").on(table.tenantId, table.requestId),
    uniqueIndex("fp360_purchase_orders_number_unique_idx").on(table.tenantId, table.orderNumber),
  ],
);

export const fpPurchaseOrderLines = pgTable(
  "fp360_purchase_order_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    purchaseOrderId: text("purchase_order_id").notNull().references(() => fpPurchaseOrders.id),
    productId: text("product_id").notNull().references(() => fpProducts.id),
    skuSnapshot: text("sku_snapshot").notNull(),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    igicBasisPoints: integer("igic_basis_points").notNull(),
    baseCents: integer("base_cents").notNull(),
    igicCents: integer("igic_cents").notNull(),
  },
  (table) => [index("fp360_purchase_order_lines_idx").on(table.tenantId, table.purchaseOrderId)],
);

export const fpPurchaseEvents = pgTable(
  "fp360_purchase_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull().references(() => fpPurchaseRequests.id),
    actorUserId: text("actor_user_id").notNull(),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_purchase_events_tenant_idx").on(table.tenantId, table.requestId),
  ],
);

export const fpPurchaseReceipts = pgTable(
  "fp360_purchase_receipts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    orderId: text("order_id").notNull().references(() => fpPurchaseOrders.id),
    receiptReference: text("receipt_reference").notNull(),
    receivedDate: date("received_date", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_purchase_receipts_tenant_idx").on(table.tenantId, table.orderId),
    uniqueIndex("fp360_purchase_receipt_reference_idx").on(table.tenantId, table.orderId, table.receiptReference),
  ],
);

export const fpPurchaseReceiptLines = pgTable(
  "fp360_purchase_receipt_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    receiptId: text("receipt_id").notNull().references(() => fpPurchaseReceipts.id),
    purchaseOrderLineId: text("purchase_order_line_id").notNull().references(() => fpPurchaseOrderLines.id),
    quantityAccepted: integer("quantity_accepted").notNull(),
    quantityRejected: integer("quantity_rejected").notNull(),
    issueReason: text("issue_reason"),
  },
  (table) => [
    index("fp360_purchase_receipt_lines_tenant_idx").on(table.tenantId, table.receiptId),
    uniqueIndex("fp360_purchase_receipt_line_unique_idx").on(table.tenantId, table.receiptId, table.purchaseOrderLineId),
  ],
);

export const fpPurchaseInvoices = pgTable(
  "fp360_purchase_invoices",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    orderId: text("order_id").notNull().references(() => fpPurchaseOrders.id),
    requestId: text("request_id").notNull().references(() => fpPurchaseRequests.id),
    supplierOrganizationId: text("supplier_organization_id").notNull().references(() => fpOrganizations.id),
    supersedesInvoiceId: text("supersedes_invoice_id"),
    invoiceReference: text("invoice_reference").notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    dueDate: date("due_date", { mode: "string" }),
    baseCents: integer("base_cents").notNull(),
    igicCents: integer("igic_cents").notNull(),
    freightCents: integer("freight_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    status: text("status").notNull().default("pending_review"),
    matchStatus: text("match_status").notNull(),
    matchSummary: text("match_summary").notNull(),
    decisionReason: text("decision_reason"),
    decisionByUserId: text("decision_by_user_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_purchase_invoices_tenant_idx").on(table.tenantId, table.orderId),
    uniqueIndex("fp360_purchase_invoice_number_idx").on(table.tenantId, table.supplierOrganizationId, table.invoiceReference),
  ],
);

export const fpPurchaseInvoiceLines = pgTable(
  "fp360_purchase_invoice_lines",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    invoiceId: text("invoice_id").notNull().references(() => fpPurchaseInvoices.id),
    purchaseOrderLineId: text("purchase_order_line_id").notNull().references(() => fpPurchaseOrderLines.id),
    productNameSnapshot: text("product_name_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    igicBasisPoints: integer("igic_basis_points").notNull(),
    baseCents: integer("base_cents").notNull(),
    igicCents: integer("igic_cents").notNull(),
  },
  (table) => [
    index("fp360_purchase_invoice_lines_tenant_idx").on(table.tenantId, table.invoiceId),
    uniqueIndex("fp360_purchase_invoice_line_unique_idx").on(table.tenantId, table.invoiceId, table.purchaseOrderLineId),
  ],
);

export const fpDirectionTasks = pgTable(
  "fp360_direction_tasks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    priority: text("priority").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    dueSimulatedDate: date("due_simulated_date", { mode: "string" }),
    assignedToUserId: text("assigned_to_user_id"),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_direction_tasks_tenant_status_idx").on(table.tenantId, table.status),
    index("fp360_direction_tasks_tenant_due_idx").on(table.tenantId, table.dueSimulatedDate),
    index("fp360_direction_tasks_tenant_assignee_idx").on(table.tenantId, table.assignedToUserId),
  ],
);

export const fpDirectionAlertActions = pgTable(
  "fp360_direction_alert_actions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    alertKey: text("alert_key").notNull(),
    status: text("status").notNull().default("open"),
    assignedToUserId: text("assigned_to_user_id"),
    justification: text("justification").notNull().default(""),
    evidenceReference: text("evidence_reference").notNull().default(""),
    updatedByUserId: text("updated_by_user_id").notNull(),
    updatedByRole: text("updated_by_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_direction_alert_action_key_idx").on(table.tenantId, table.alertKey),
    index("fp360_direction_alert_actions_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const fpDirectionThresholds = pgTable(
  "fp360_direction_thresholds",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    key: text("key").notNull(),
    value: integer("value"),
    enabled: boolean("enabled").notNull().default(false),
    updatedByUserId: text("updated_by_user_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("fp360_direction_threshold_key_idx").on(table.tenantId, table.key),
    index("fp360_direction_thresholds_tenant_idx").on(table.tenantId),
  ],
);

export const fpDirectionDecisions = pgTable(
  "fp360_direction_decisions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    title: text("title").notNull(),
    reason: text("reason").notNull(),
    proposedAction: text("proposed_action").notNull(),
    impactCents: integer("impact_cents"),
    impactNote: text("impact_note").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    status: text("status").notNull().default("pending"),
    submittedByUserId: text("submitted_by_user_id").notNull(),
    submittedByRole: text("submitted_by_role").notNull(),
    reviewedByUserId: text("reviewed_by_user_id"),
    reviewedByRole: text("reviewed_by_role"),
    reviewReason: text("review_reason"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_direction_decisions_tenant_status_idx").on(table.tenantId, table.status),
    index("fp360_direction_decisions_tenant_date_idx").on(table.tenantId, table.simulatedDate),
  ],
);

export const fpDirectionObjectives = pgTable(
  "fp360_direction_objectives",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    label: text("label").notNull(),
    metric: text("metric").notNull(),
    targetValue: integer("target_value").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    notes: text("notes").notNull().default(""),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_direction_objectives_tenant_period_idx").on(table.tenantId, table.periodStart, table.periodEnd),
  ],
);

export const fpDirectionReports = pgTable(
  "fp360_direction_reports",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    title: text("title").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdByRole: text("created_by_role").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_direction_reports_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("fp360_direction_reports_tenant_role_idx").on(table.tenantId, table.createdByRole),
  ],
);

export const fpDirectionEvents = pgTable(
  "fp360_direction_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    actorRole: text("actor_role").notNull(),
    reason: text("reason").notNull(),
    simulatedDate: date("simulated_date", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_direction_events_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("fp360_direction_events_tenant_entity_idx").on(table.tenantId, table.entityType, table.entityId),
  ],
);

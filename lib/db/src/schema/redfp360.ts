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
    category: text("category").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    igicBasisPoints: integer("igic_basis_points").notNull(),
    stock: integer("stock").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    minimumStock: integer("minimum_stock").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    // Preserve the existing demo catalog. New API-created products explicitly start unpublished.
    isPublished: boolean("is_published").notNull().default(true),
  },
  (table) => [
    index("fp360_products_tenant_idx").on(table.tenantId),
    uniqueIndex("fp360_products_tenant_sku_idx").on(table.tenantId, table.sku),
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
    igicBasisPoints: integer("igic_basis_points").notNull(),
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

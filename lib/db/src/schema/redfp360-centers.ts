import { boolean, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export const fpCenters = pgTable(
  "fp360_centers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("fp360_centers_tenant_name_key").on(table.tenantId, table.normalizedName),
    index("fp360_centers_tenant_idx").on(table.tenantId),
  ],
);

export type FpCenter = typeof fpCenters.$inferSelect;

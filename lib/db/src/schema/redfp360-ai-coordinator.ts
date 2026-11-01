import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const fpAdminAiCoordinatorSettings = pgTable(
  "fp360_admin_ai_coordinator_settings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    baseUrl: text("base_url").notNull(),
    model: text("model").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    createdByUserId: text("created_by_user_id").notNull(),
    updatedByUserId: text("updated_by_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("fp360_admin_ai_coordinator_tenant_unique").on(table.tenantId),
    index("fp360_admin_ai_coordinator_updated_idx").on(table.tenantId, table.updatedAt),
  ],
);

export const insertFpAdminAiCoordinatorSettingsSchema = createInsertSchema(fpAdminAiCoordinatorSettings).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFpAdminAiCoordinatorSettings = z.infer<typeof insertFpAdminAiCoordinatorSettingsSchema>;
export type FpAdminAiCoordinatorSettings = typeof fpAdminAiCoordinatorSettings.$inferSelect;

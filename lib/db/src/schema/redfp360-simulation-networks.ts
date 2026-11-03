import { boolean, index, integer, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";

export type Fp360CalendarMode = "ordinary" | "accelerated";

export const fpSimulationNetworks = pgTable(
  "fp360_simulation_networks",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    calendarMode: text("calendar_mode").$type<Fp360CalendarMode>().notNull(),
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("fp360_simulation_networks_tenant_code_key").on(table.tenantId, table.code),
    index("fp360_simulation_networks_tenant_mode_idx").on(table.tenantId, table.calendarMode),
    index("fp360_simulation_networks_tenant_fiscal_start_idx").on(table.tenantId, table.calendarMode, table.fiscalYearStartMonth),
  ],
);

export type FpSimulationNetwork = typeof fpSimulationNetworks.$inferSelect;

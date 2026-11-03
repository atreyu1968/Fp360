import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { fpCenters } from "./redfp360-centers";
import { fpSimulationNetworks } from "./redfp360-simulation-networks";

export type Fp360OrganizationScopeOrigin =
  | "legacy_backfill"
  | "organization_created"
  | "center_changed";

export const fpOrganizationScopes = pgTable(
  "fp360_organization_scopes",
  {
    organizationId: text("organization_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    centerId: text("center_id").notNull(),
    simulationNetworkId: text("simulation_network_id").notNull(),
    origin: text("origin").$type<Fp360OrganizationScopeOrigin>().notNull(),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fp360_organization_scopes_tenant_idx").on(table.tenantId),
    index("fp360_organization_scopes_center_idx").on(table.tenantId, table.centerId),
    index("fp360_organization_scopes_network_idx").on(table.tenantId, table.simulationNetworkId),
  ],
);

export type FpOrganizationScope = typeof fpOrganizationScopes.$inferSelect;

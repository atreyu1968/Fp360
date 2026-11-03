import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  fpCenters,
  fpOrganizationScopes,
  fpOrganizations,
  fpSimulationNetworks,
  type Fp360OrganizationScopeOrigin,
} from "@workspace/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OrganizationScopeDto = {
  centerId: string;
  simulationNetworkId: string;
  simulationCalendarMode: "ordinary" | "accelerated";
  fiscalYearStartMonth: number;
  academicPeriod: string;
  simulationNetworkName: string;
};

export function scopesShareSimulationNetwork(
  scopes: Array<{ organizationId: string; simulationNetworkId: string }>,
  organizationIds: string[],
): boolean {
  const uniqueIds = [...new Set(organizationIds)];
  if (!uniqueIds.length || uniqueIds.length !== organizationIds.length) return false;
  if (scopes.length !== uniqueIds.length) return false;
  const scopedIds = new Set(scopes.map((scope) => scope.organizationId));
  if (uniqueIds.some((id) => !scopedIds.has(id))) return false;
  return new Set(scopes.map((scope) => scope.simulationNetworkId)).size === 1;
}

export async function commonSimulationNetworkId(
  tx: Transaction,
  tenantId: string,
  organizationIds: string[],
): Promise<string | null> {
  const uniqueIds = [...new Set(organizationIds)];
  if (!uniqueIds.length || uniqueIds.length !== organizationIds.length) return null;
  const scopes = await tx.select({
    organizationId: fpOrganizationScopes.organizationId,
    simulationNetworkId: fpOrganizationScopes.simulationNetworkId,
  }).from(fpOrganizationScopes).where(and(
    eq(fpOrganizationScopes.tenantId, tenantId),
    inArray(fpOrganizationScopes.organizationId, uniqueIds),
  ));
  return scopesShareSimulationNetwork(scopes, uniqueIds)
    ? scopes[0].simulationNetworkId
    : null;
}

const DEFAULT_NETWORK_CODE = "ordinary-default";
const DEFAULT_NETWORK_NAME = "Red económica ordinaria";

export function normalizeCenterName(name: string): string {
  return name.trim().replace(/\s+/gu, " ").toLowerCase();
}

async function getOrCreateCenter(
  tx: Transaction,
  tenantId: string,
  centerName: string,
  createdByUserId: string | null,
) {
  const normalizedName = normalizeCenterName(centerName);
  if (!normalizedName) throw new Error("No se puede asignar una empresa a un centro vacío.");

  await tx.insert(fpCenters).values({
    id: randomUUID(),
    tenantId,
    name: centerName.trim().replace(/\s+/gu, " "),
    normalizedName,
    createdByUserId,
  }).onConflictDoNothing();

  const [center] = await tx.select().from(fpCenters).where(and(
    eq(fpCenters.tenantId, tenantId),
    eq(fpCenters.normalizedName, normalizedName),
  )).limit(1);
  if (!center) throw new Error("No se pudo resolver el centro de la empresa.");
  return center;
}

async function getOrCreateNetwork(
  tx: Transaction,
  tenantId: string,
  calendarMode: "ordinary" | "accelerated",
  fiscalYearStartMonth: number,
  createdByUserId: string | null,
) {
  const code = calendarMode === "ordinary" && fiscalYearStartMonth === 1
    ? DEFAULT_NETWORK_CODE
    : `${calendarMode}-fiscal-${fiscalYearStartMonth}`;
  await tx.insert(fpSimulationNetworks).values({
    id: randomUUID(),
    tenantId,
    code,
    name: calendarMode === "ordinary"
      ? `Red económica ordinaria · ejercicio desde ${fiscalYearStartMonth}`
      : `Red económica acelerada · ejercicio desde ${fiscalYearStartMonth}`,
    calendarMode,
    fiscalYearStartMonth,
    createdByUserId,
  }).onConflictDoNothing();

  const [network] = await tx.select().from(fpSimulationNetworks).where(and(
    eq(fpSimulationNetworks.tenantId, tenantId),
    eq(fpSimulationNetworks.code, code),
  )).limit(1);
  if (!network) throw new Error("No se pudo resolver la red económica del calendario seleccionado.");
  return network;
}

export async function ensureOrganizationScope(
  tx: Transaction,
  input: {
    organizationId: string;
    tenantId: string;
    centerName: string;
    actorUserId: string | null;
    origin: Fp360OrganizationScopeOrigin;
    calendarMode?: "ordinary" | "accelerated";
    fiscalYearStartMonth?: number;
    academicPeriod?: string;
  },
): Promise<{ scope: typeof fpOrganizationScopes.$inferSelect; network: typeof fpSimulationNetworks.$inferSelect }> {
  const center = await getOrCreateCenter(tx, input.tenantId, input.centerName, input.actorUserId);
  const [existing] = await tx.select().from(fpOrganizationScopes).where(and(
    eq(fpOrganizationScopes.organizationId, input.organizationId),
    eq(fpOrganizationScopes.tenantId, input.tenantId),
  )).limit(1);

  if (existing) {
    const [currentNetwork] = await tx.select().from(fpSimulationNetworks).where(and(
      eq(fpSimulationNetworks.id, existing.simulationNetworkId),
      eq(fpSimulationNetworks.tenantId, input.tenantId),
    )).limit(1);
    if (!currentNetwork) throw new Error("La empresa tiene una red económica no válida.");
    const calendarMode = input.calendarMode ?? currentNetwork.calendarMode;
    const fiscalYearStartMonth = input.fiscalYearStartMonth ?? currentNetwork.fiscalYearStartMonth;
    const calendarChanged = calendarMode !== currentNetwork.calendarMode ||
      fiscalYearStartMonth !== currentNetwork.fiscalYearStartMonth;
    const network = calendarChanged
      ? await getOrCreateNetwork(tx, input.tenantId, calendarMode, fiscalYearStartMonth, input.actorUserId)
      : currentNetwork;
    const scopeChanges: Partial<typeof fpOrganizationScopes.$inferInsert> = {};
    if (network.id !== existing.simulationNetworkId) scopeChanges.simulationNetworkId = network.id;
    if (input.academicPeriod !== undefined && input.academicPeriod !== existing.academicPeriod) {
      scopeChanges.academicPeriod = input.academicPeriod;
    }
    if (existing.centerId !== center.id) {
      const [updated] = await tx.update(fpOrganizationScopes).set({
        ...scopeChanges,
        centerId: center.id,
        origin: "center_changed",
        createdByUserId: input.actorUserId,
        updatedAt: new Date(),
      }).where(and(
        eq(fpOrganizationScopes.organizationId, input.organizationId),
        eq(fpOrganizationScopes.tenantId, input.tenantId),
      )).returning();
      return { scope: updated, network };
    }

    if (Object.keys(scopeChanges).length) {
      const [updated] = await tx.update(fpOrganizationScopes).set({
        ...scopeChanges,
        updatedAt: new Date(),
      }).where(and(
        eq(fpOrganizationScopes.organizationId, input.organizationId),
        eq(fpOrganizationScopes.tenantId, input.tenantId),
      )).returning();
      return { scope: updated, network };
    }
    return { scope: existing, network };
  }

  const network = await getOrCreateNetwork(
    tx,
    input.tenantId,
    input.calendarMode ?? "ordinary",
    input.fiscalYearStartMonth ?? 1,
    input.actorUserId,
  );
  await tx.insert(fpOrganizationScopes).values({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    centerId: center.id,
    simulationNetworkId: network.id,
    academicPeriod: input.academicPeriod ?? "2027-2028",
    origin: input.origin,
    createdByUserId: input.actorUserId,
  }).onConflictDoNothing();

  const [scope] = await tx.select().from(fpOrganizationScopes).where(and(
    eq(fpOrganizationScopes.organizationId, input.organizationId),
    eq(fpOrganizationScopes.tenantId, input.tenantId),
  )).limit(1);
  if (!scope) throw new Error("No se pudo asignar la empresa a su red económica.");
  return { scope, network };
}

export async function backfillTenantOrganizationScopes(tenantId: string): Promise<Map<string, OrganizationScopeDto>> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fp360-organization-scopes:${tenantId}`}))`);

    const organizations = await tx.select({
      id: fpOrganizations.id,
      center: fpOrganizations.center,
    }).from(fpOrganizations).where(eq(fpOrganizations.tenantId, tenantId));
    if (!organizations.length) return new Map();

    const uniqueCenters = new Map<string, { name: string; normalizedName: string }>();
    for (const organization of organizations) {
      const normalizedName = normalizeCenterName(organization.center);
      if (!normalizedName) throw new Error("Hay una empresa histórica sin centro asignado.");
      if (!uniqueCenters.has(normalizedName)) {
        uniqueCenters.set(normalizedName, {
          name: organization.center.trim().replace(/\s+/gu, " "),
          normalizedName,
        });
      }
    }

    await tx.insert(fpCenters).values([...uniqueCenters.values()].map((center) => ({
      id: randomUUID(),
      tenantId,
      ...center,
      createdByUserId: null,
    }))).onConflictDoNothing();
    const centers = await tx.select().from(fpCenters).where(eq(fpCenters.tenantId, tenantId));
    const centerByName = new Map(centers.map((center) => [center.normalizedName, center]));

    const [network] = await tx.insert(fpSimulationNetworks).values({
      id: randomUUID(),
      tenantId,
      code: DEFAULT_NETWORK_CODE,
      name: DEFAULT_NETWORK_NAME,
      calendarMode: "ordinary",
      fiscalYearStartMonth: 1,
      createdByUserId: null,
    }).onConflictDoNothing().returning();
    const [defaultNetwork] = network
      ? [network]
      : await tx.select().from(fpSimulationNetworks).where(and(
        eq(fpSimulationNetworks.tenantId, tenantId),
        eq(fpSimulationNetworks.code, DEFAULT_NETWORK_CODE),
      )).limit(1);
    if (!defaultNetwork) throw new Error("No se pudo crear la red económica ordinaria.");

    const existingScopes = await tx.select().from(fpOrganizationScopes).where(eq(fpOrganizationScopes.tenantId, tenantId));
    const scopeByOrganization = new Map(existingScopes.map((scope) => [scope.organizationId, scope]));
    const missingScopes = organizations.flatMap((organization) => {
      if (scopeByOrganization.has(organization.id)) return [];
      const center = centerByName.get(normalizeCenterName(organization.center));
      if (!center) throw new Error("No se pudo asignar un centro a una empresa histórica.");
      return [{
        organizationId: organization.id,
        tenantId,
        centerId: center.id,
        simulationNetworkId: defaultNetwork.id,
        origin: "legacy_backfill" as const,
        createdByUserId: null,
      }];
    });
    if (missingScopes.length) {
      await tx.insert(fpOrganizationScopes).values(missingScopes).onConflictDoNothing();
    }

    const scopes = missingScopes.length
      ? await tx.select().from(fpOrganizationScopes).where(and(
        eq(fpOrganizationScopes.tenantId, tenantId),
        inArray(fpOrganizationScopes.organizationId, organizations.map((organization) => organization.id)),
      ))
      : existingScopes;
    const networkIds = [...new Set(scopes.map((scope) => scope.simulationNetworkId))];
    const networks = networkIds.length
      ? await tx.select().from(fpSimulationNetworks).where(and(
        eq(fpSimulationNetworks.tenantId, tenantId),
        inArray(fpSimulationNetworks.id, networkIds),
      ))
      : [];
    const networkById = new Map(networks.map((item) => [item.id, item]));
    const centerIdsInTenant = new Set(centers.map((center) => center.id));
    const result = new Map<string, OrganizationScopeDto>();
    for (const scope of scopes) {
      if (!centerIdsInTenant.has(scope.centerId)) {
        throw new Error("Se encontró una empresa asociada a un centro de otra organización.");
      }
      const networkItem = networkById.get(scope.simulationNetworkId);
      if (!networkItem) throw new Error("Se encontró una empresa asociada a otra red o a una red inexistente.");
      result.set(scope.organizationId, {
        centerId: scope.centerId,
        simulationNetworkId: scope.simulationNetworkId,
        simulationCalendarMode: networkItem.calendarMode,
        fiscalYearStartMonth: networkItem.fiscalYearStartMonth,
        academicPeriod: scope.academicPeriod,
        simulationNetworkName: networkItem.name,
      });
    }
    return result;
  });
}

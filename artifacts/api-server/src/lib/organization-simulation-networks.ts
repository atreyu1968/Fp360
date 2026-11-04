import { backfillTenantOrganizationScopes } from "./organization-scopes";

export {
  organizationsShareSimulationNetwork,
  SIMULATION_NETWORK_MISMATCH,
} from "./simulation-network-guard.mjs";

export async function tenantSimulationNetworkMap(tenantId: string): Promise<Map<string, string>> {
  const scopes = await backfillTenantOrganizationScopes(tenantId);
  return new Map([...scopes].map(([organizationId, scope]) => [
    organizationId,
    scope.simulationNetworkId,
  ]));
}

export function organizationsShareSimulationNetwork(networks, organizationIds) {
  const ids = [...new Set(organizationIds.filter((id) => Boolean(id)))];
  if (!ids.length) return false;
  const networkId = networks.get(ids[0]);
  return Boolean(networkId) && ids.every((id) => networks.get(id) === networkId);
}

export const SIMULATION_NETWORK_MISMATCH =
  "Las empresas implicadas deben pertenecer a la misma red económica.";

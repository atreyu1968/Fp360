import { createHash } from "node:crypto";
import type { fpOrganizations } from "@workspace/db";
import type { OrganizationScopeDto } from "./organization-scopes";

type Fp360OrganizationRow = typeof fpOrganizations.$inferSelect;

export function socialSecurityRegimeForActivity(activity: string | null | undefined): string {
  if (activity === "agriculture") return "Sistema Especial Agrario (simulado)";
  if (activity === "fishing") return "Régimen Especial del Mar (simulado)";
  return "Régimen General (simulado)";
}

export function toFp360OrganizationDto(organization: Fp360OrganizationRow, scope: OrganizationScopeDto) {
  const simulatedCode = createHash("sha256")
    .update(organization.id)
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  const activity = organization.activity ?? "commerce";
  return {
    id: organization.id,
    centerId: scope.centerId,
    simulationNetworkId: scope.simulationNetworkId,
    simulationCalendarMode: scope.simulationCalendarMode,
    fiscalYearStartMonth: scope.fiscalYearStartMonth,
    academicPeriod: scope.academicPeriod,
    simulationNetworkName: scope.simulationNetworkName,
    name: organization.name,
    center: organization.center,
    island: organization.island,
    role: organization.role,
    isActive: organization.isActive,
    activity,
    commercialName: organization.commercialName ?? "",
    address: organization.address ?? "",
    municipality: organization.municipality ?? "",
    postalCode: organization.postalCode ?? "",
    businessEmail: organization.businessEmail ?? "",
    businessPhone: organization.businessPhone ?? "",
    cif: `SIM-CIF-${simulatedCode}`,
    socialSecurityNumber: `SIM-SS-${simulatedCode}`,
    socialSecurityRegime: socialSecurityRegimeForActivity(activity),
    logoUrl: organization.logoObjectPath
      ? `/api/redfp360/organizations/${encodeURIComponent(organization.id)}/logo?v=${encodeURIComponent(organization.logoObjectPath)}`
      : null,
  };
}

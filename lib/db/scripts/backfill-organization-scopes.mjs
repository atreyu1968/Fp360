import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

function normalizeCenterName(name) {
  return name.trim().replace(/\s+/gu, " ").toLowerCase();
}

export async function backfillOrganizationScopes(client) {
  await client.query("BEGIN");
  try {
  const { rows: organizations } = await client.query(`
    SELECT organization.id, organization.tenant_id, organization.center
    FROM fp360_organizations AS organization
    LEFT JOIN fp360_organization_scopes AS scope
      ON scope.organization_id = organization.id
    WHERE scope.organization_id IS NULL
    ORDER BY organization.tenant_id, organization.center, organization.id
  `);

  const organizationsByTenant = new Map();
  for (const organization of organizations) {
    const tenantOrganizations = organizationsByTenant.get(organization.tenant_id) ?? [];
    tenantOrganizations.push(organization);
    organizationsByTenant.set(organization.tenant_id, tenantOrganizations);
  }

  let centerRowsCreated = 0;
  let scopeRowsCreated = 0;
  for (const [tenantId, tenantOrganizations] of organizationsByTenant) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `fp360-organization-scopes:${tenantId}`,
    ]);

    const centersByName = new Map();
    for (const organization of tenantOrganizations) {
      const normalizedName = normalizeCenterName(organization.center);
      if (!normalizedName) {
        throw new Error(`Organization ${organization.id} has no center; no data was changed.`);
      }
      if (!centersByName.has(normalizedName)) {
        centersByName.set(normalizedName, {
          name: organization.center.trim().replace(/\s+/gu, " "),
          normalizedName,
        });
      }
    }

    for (const center of centersByName.values()) {
      const result = await client.query(`
        INSERT INTO fp360_centers (id, tenant_id, name, normalized_name, created_by_user_id)
        VALUES ($1, $2, $3, $4, NULL)
        ON CONFLICT (tenant_id, normalized_name) DO NOTHING
      `, [randomUUID(), tenantId, center.name, center.normalizedName]);
      centerRowsCreated += result.rowCount ?? 0;
    }

    await client.query(`
      INSERT INTO fp360_simulation_networks
        (id, tenant_id, code, name, calendar_mode, created_by_user_id)
      VALUES ($1, $2, 'ordinary-default', 'Red económica ordinaria', 'ordinary', NULL)
      ON CONFLICT (tenant_id, code) DO NOTHING
    `, [randomUUID(), tenantId]);

    const { rows: centerRows } = await client.query(`
      SELECT id, normalized_name
      FROM fp360_centers
      WHERE tenant_id = $1 AND normalized_name = ANY($2::text[])
    `, [tenantId, [...centersByName.keys()]]);
    const centerIdByName = new Map(centerRows.map((center) => [center.normalized_name, center.id]));
    const { rows: [network] } = await client.query(`
      SELECT id FROM fp360_simulation_networks
      WHERE tenant_id = $1 AND code = 'ordinary-default'
    `, [tenantId]);
    if (!network) throw new Error(`Tenant ${tenantId} has no ordinary simulation network.`);

    for (const organization of tenantOrganizations) {
      const normalizedName = normalizeCenterName(organization.center);
      const centerId = centerIdByName.get(normalizedName);
      if (!centerId) throw new Error(`Center for organization ${organization.id} could not be resolved.`);
      const result = await client.query(`
        INSERT INTO fp360_organization_scopes
          (organization_id, tenant_id, center_id, simulation_network_id, origin, created_by_user_id)
        VALUES ($1, $2, $3, $4, 'legacy_backfill', NULL)
        ON CONFLICT (organization_id) DO NOTHING
      `, [organization.id, tenantId, centerId, network.id]);
      scopeRowsCreated += result.rowCount ?? 0;
    }
  }

  await client.query("COMMIT");
  return { centerRowsCreated, scopeRowsCreated };
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.RED_FP360_MIGRATION_TARGET !== "ubuntu-local") {
    throw new Error("Organization-scope backfill is restricted to the Ubuntu installer/updater.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required; it is read from the protected Ubuntu API environment.");
  }
  const url = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.pathname !== "/redfp360" || (url.port && url.port !== "5432")
    || url.search || url.hash) {
    throw new Error("Organization-scope backfill is restricted to the local Ubuntu RED FP360 database.");
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  try {
    const result = await backfillOrganizationScopes(client);
    console.log(`Organization scope backfill complete: ${result.centerRowsCreated} centers, ${result.scopeRowsCreated} company scopes created.`);
  } finally {
    await client.end();
  }
}

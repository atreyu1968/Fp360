import assert from "node:assert/strict";
import test from "node:test";
import { socialSecurityRegimeForActivity, toFp360OrganizationDto } from "./fp360-organization-profile.ts";

test("organization identifiers are stable and explicitly simulated", () => {
  const organization = {
    id: "organization-42",
    name: "Empresa de prácticas",
    center: "Centro ficticio",
    island: "Tenerife",
    role: "both",
    isActive: true,
    activity: "agriculture",
    commercialName: null,
    address: null,
    municipality: null,
    postalCode: null,
    businessEmail: null,
    businessPhone: null,
    logoObjectPath: null,
    logoContentType: null,
  };

  const profile = toFp360OrganizationDto(organization);
  assert.equal(profile.cif, toFp360OrganizationDto(organization).cif);
  assert.match(profile.cif, /^SIM-CIF-[A-F0-9]{10}$/);
  assert.match(profile.socialSecurityNumber, /^SIM-SS-[A-F0-9]{10}$/);
  assert.equal(profile.socialSecurityRegime, "Sistema Especial Agrario (simulado)");
  assert.equal(profile.logoUrl, null);
});

test("organization logo URLs are tenant-routed and regimes follow simulated activity", () => {
  const profile = toFp360OrganizationDto({
    id: "org/a",
    name: "Empresa de ejemplo",
    center: "Centro ficticio",
    island: "Gran Canaria",
    role: "seller",
    isActive: true,
    activity: "fishing",
    commercialName: "Ejemplo",
    address: "Dirección de práctica",
    municipality: "Municipio ficticio",
    postalCode: "35000",
    businessEmail: "empresa@example.invalid",
    businessPhone: "000000000",
    logoObjectPath: "/objects/uploads/logo-1",
    logoContentType: "image/png",
  });

  assert.equal(profile.socialSecurityRegime, "Régimen Especial del Mar (simulado)");
  assert.equal(profile.logoUrl, "/api/redfp360/organizations/org%2Fa/logo?v=%2Fobjects%2Fuploads%2Flogo-1");
  assert.equal(socialSecurityRegimeForActivity("services"), "Régimen General (simulado)");
});

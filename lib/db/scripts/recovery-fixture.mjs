import { createHash, createHmac } from "node:crypto";

export const documentBytes = Buffer.from("Documento ficticio de recuperacion RED FP360.\n");
export const checksum = createHash("sha256").update(documentBytes).digest("hex");
export const sessionSecret = "disposable-recovery-fixture-not-a-real-secret";
export const objectPath = "/objects/uploads/00000000-0000-4000-8000-000000000001";

// Inserts are deliberately explicit: schema changes must fail rather than silently
// inventing values for new mandatory fields.
export async function seed(client) {
  const insert = async (table, values) => {
    const columns = Object.keys(values);
    await client.query(
      `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(",")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(values),
    );
  };
  for (const [id, tenant] of [["company-a", "network-a"], ["company-b", "network-a"], ["company-c", "network-b"]]) {
    await insert("fp360_organizations", {
      id, tenant_id: tenant, name: `Ficticia ${id}`, center: "Centro ficticio",
      island: "Simulada", role: "company",
    });
  }
  for (const [user, company, tenant, active] of [
    ["owner", "company-a", "network-a", true],
    ["colleague", "company-a", "network-a", true],
    ["other-company", "company-b", "network-a", true],
    ["other-network", "company-c", "network-b", true],
    ["inactive", "company-a", "network-a", false],
  ]) {
    await insert("fp360_auth_users", {
      id: user, email: `${user}@recovery.invalid`, display_name: "Persona ficticia",
      password_hash: "not-a-valid-password-hash",
    });
    await insert("fp360_auth_memberships", {
      id: `membership-${user}`, user_id: user, tenant_id: tenant,
      organization_id: company, role: "student", is_active: active,
    });
    await insert("fp360_auth_sessions", {
      id: `session-${user}`, user_id: user, membership_id: `membership-${user}`,
      token_hash: createHmac("sha256", sessionSecret).update(`fixture-${user}`).digest("hex"),
      expires_at: "2099-01-01T00:00:00Z",
    });
  }
  await insert("fp360_orders", {
    id: "order-1", tenant_id: "network-a", reference: "ORDER-RECOVERY-1",
    buyer_organization_id: "company-b", status: "invoiced",
    total_cents: 10700, simulated_date: "2026-11-01",
  });
  await insert("fp360_order_lines", {
    id: "order-line-1", order_id: "order-1", product_id: "synthetic-product",
    product_name: "Servicio ficticio", quantity: 1, unit_price_cents: 10000,
    igic_basis_points: 700,
  });
  await insert("fp360_invoices", {
    id: "invoice-1", tenant_id: "network-a", issuer_organization_id: "company-a",
    reference: "INV-RECOVERY-1", order_id: "order-1", buyer_name: "Ficticia B",
    base_cents: 10000, igic_cents: 700, total_cents: 10700, simulated_date: "2026-11-01",
  });
  await insert("fp360_invoice_lines", {
    id: "invoice-line-1", invoice_id: "invoice-1", product_name: "Servicio ficticio",
    quantity: 1, unit_price_cents: 10000, base_cents: 10000, igic_basis_points: 700,
    igic_cents: 700, total_cents: 10700,
  });
  await insert("fp360_payments", {
    id: "payment-1", tenant_id: "network-a", organization_id: "company-a",
    invoice_id: "invoice-1", amount_cents: 4000, simulated_date: "2026-11-01",
    operation_id: "payment-operation-1",
  });
  for (const [id, code, nature, balance] of [
    ["account-debit", "430", "asset", "debit"], ["account-credit", "700", "income", "credit"],
  ]) {
    await insert("fp360_accounting_accounts", {
      id, tenant_id: "network-a", organization_id: "company-a", code,
      name: "Cuenta ficticia", nature, normal_balance: balance, created_by_user_id: "owner",
    });
  }
  await insert("fp360_accounting_entries", {
    id: "entry-1", tenant_id: "network-a", organization_id: "company-a",
    entry_number: 1, fiscal_year: 2026, period: 11, entry_date: "2026-11-01",
    concept: "Asiento ficticio", status: "posted", source_type: "invoice", source_id: "invoice-1",
    debit_cents: 10700, credit_cents: 10700, operation_id: "entry-operation-1",
    request_fingerprint: "synthetic", created_by_user_id: "owner", created_by_name: "Persona ficticia",
  });
  for (const [id, account, number, debit, credit] of [
    ["line-debit", "account-debit", 1, 10700, 0], ["line-credit", "account-credit", 2, 0, 10700],
  ]) {
    await insert("fp360_accounting_entry_lines", {
      id, tenant_id: "network-a", entry_id: "entry-1", account_id: account, line_number: number,
      description: "Linea ficticia", debit_cents: debit, credit_cents: credit,
      third_party_organization_id: "company-b",
    });
  }
  await insert("fp360_accounting_events", {
    id: "accounting-event-1", tenant_id: "network-a", organization_id: "company-a",
    entry_id: "entry-1", operation_id: "event-operation-1", request_fingerprint: "synthetic",
    event_type: "posted", description: "Registro ficticio", actor_user_id: "owner", actor_name: "Persona ficticia",
  });
  const common = { tenant_id: "network-a", organization_id: "company-a" };
  await insert("fp360_document_dossiers", {
    ...common, id: "dossier-1", dossier_ref: "RECOVERY-1", title: "Expediente ficticio",
    dossier_type: "commercial", department: "accounting", period: "2026",
    created_by_user_id: "owner", created_by_name: "Persona ficticia",
    operation_id: "dossier-operation-1", request_fingerprint: "synthetic",
  });
  await insert("fp360_documents", {
    ...common, id: "document-1", dossier_id: "dossier-1", document_ref: "DOC-RECOVERY-1",
    document_type: "invoice", title: "Documento privado ficticio", department: "accounting",
    period: "2026", document_date: "2026-11-01", visibility: "restricted",
    owner_user_id: "owner", owner_name: "Persona ficticia", version_number: 2,
    operation_id: "document-operation-1", request_fingerprint: "synthetic",
  });
  for (const number of [1, 2]) {
    await insert("fp360_document_versions", {
      ...common, id: `version-${number}`, document_id: "document-1", version_number: number,
      status: "uploaded", object_path: objectPath, original_name: "ficticio.txt", content_type: "text/plain",
      size_bytes: documentBytes.length, checksum_sha256: checksum, created_by_user_id: "owner",
      created_by_name: "Persona ficticia", operation_id: `version-operation-${number}`,
    });
  }
  await insert("fp360_document_events", {
    ...common, id: "document-event-1", dossier_id: "dossier-1", document_id: "document-1",
    version_id: "version-2", event_type: "uploaded", details: "Carga ficticia",
    actor_user_id: "owner", actor_name: "Persona ficticia", simulated_date: "2026-11-01",
    operation_id: "document-event-operation-1", request_fingerprint: "synthetic",
  });
}

import { buildAccountingLedger } from "./accounting-ledger.mjs";

function csvCell(value) {
  if (typeof value === "number") return String(value);
  const text = value ?? "";
  if (/^-?\d+,\d{2}$/.test(text)) return text;
  const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

function csvRow(values) {
  return values.map(csvCell).join(";");
}

function csvEuro(cents) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function buildAccountingExportCsv({
  tenantId,
  organization,
  fiscalYear,
  book,
  accounts: allAccounts,
  entries: allEntries,
  entryLines: allEntryLines,
}) {
  const organizationId = organization.id;
  const accounts = allAccounts.filter((account) =>
    account.tenantId === tenantId && account.organizationId === organizationId
  );
  const entries = allEntries.filter((entry) =>
    entry.tenantId === tenantId &&
    entry.organizationId === organizationId &&
    (book === "journal" ? entry.fiscalYear === fiscalYear : entry.fiscalYear <= fiscalYear)
  );
  const exportEntries = book === "ledger"
    ? entries.filter((entry) => entry.status !== "draft")
    : entries;
  const entryIds = new Set(exportEntries.map((entry) => entry.id));
  const entryLines = allEntryLines.filter((line) =>
    line.tenantId === tenantId && entryIds.has(line.entryId)
  );
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const linesByEntry = new Map();
  for (const line of entryLines) {
    linesByEntry.set(line.entryId, [...(linesByEntry.get(line.entryId) ?? []), line]);
  }
  const scopedValues = [organization.name, organization.center, organizationId, fiscalYear];
  const rows = [];

  if (book === "journal") {
    rows.push(csvRow([
      "empresa", "centro", "empresa_id", "ejercicio", "periodo", "fecha", "asiento",
      "estado", "tipo_origen", "referencia_origen", "concepto", "linea",
      "cuenta_codigo", "cuenta_nombre", "descripcion", "debe_eur", "haber_eur",
    ]));
    for (const entry of entries) {
      const lines = (linesByEntry.get(entry.id) ?? []).filter((line) => accountsById.has(line.accountId));
      if (!lines.length) {
        rows.push(csvRow([
          ...scopedValues, entry.period, entry.entryDate, entry.entryNumber, entry.status,
          entry.sourceType, entry.sourceReference, entry.concept, "", "", "", "", "", "",
        ]));
        continue;
      }
      for (const line of lines) {
        const account = accountsById.get(line.accountId);
        rows.push(csvRow([
          ...scopedValues, entry.period, entry.entryDate, entry.entryNumber, entry.status,
          entry.sourceType, entry.sourceReference, entry.concept, line.lineNumber,
          account.code, account.name, line.description, csvEuro(line.debitCents), csvEuro(line.creditCents),
        ]));
      }
    }
  } else {
    rows.push(csvRow([
      "empresa", "centro", "empresa_id", "ejercicio", "tipo_fila", "cuenta_codigo",
      "cuenta_nombre", "fecha", "asiento", "estado", "referencia_origen", "concepto",
      "descripcion", "debe_eur", "haber_eur", "saldo_acumulado_eur",
    ]));
    const ledger = buildAccountingLedger({
      accounts,
      entries: exportEntries,
      lines: entryLines,
      fiscalYear,
    });
    for (const { account, balanceCents } of ledger.openingBalances) {
      rows.push(csvRow([
        ...scopedValues, "saldo_inicial", account.code, account.name, `${fiscalYear}-01-01`, "",
        "saldo_inicial", "", "Saldo acumulado de ejercicios anteriores", "Saldo de apertura",
        "0,00", "0,00", csvEuro(balanceCents),
      ]));
    }
    for (const { entry, line, account, balanceCents } of ledger.movements) {
      rows.push(csvRow([
        ...scopedValues, "movimiento", account.code, account.name,
        entry.entryDate, entry.entryNumber, entry.status, entry.sourceReference,
        entry.concept, line.description, csvEuro(line.debitCents),
        csvEuro(line.creditCents), csvEuro(balanceCents),
      ]));
    }
  }

  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { test } from "node:test";
import pg from "pg";

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ";") {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseCsv(text) {
  return text.replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseCsvLine);
}

test("accounting CSV exports enforce company scope and compute ledger openings", async () => {
  assert.notEqual(process.env.NODE_ENV, "production", "Use the development database only");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be configured");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const tenantId = `accounting-export-${randomUUID()}`;
  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const managerUserId = randomUUID();
  const userIds = [managerUserId];
  const password = randomBytes(24).toString("base64url");
  const salt = randomBytes(16);
  const passwordHash = `scrypt$32768$8$1$${salt.toString("base64url")}$${scryptSync(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 134217728,
  }).toString("base64url")}`;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:8080/api";
  const accounts = {
    cash: randomUUID(),
    revenue: randomUUID(),
    expense: randomUUID(),
    payable: randomUUID(),
    otherCompany: randomUUID(),
  };
  let sessionCookie;

  async function request(path, { method = "GET", cookie, data } = {}) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { "Content-Type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
      redirect: "manual",
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      text: bytes.toString("utf8"),
      hasUtf8Bom: bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }

  async function insertEntry({
    id = randomUUID(),
    organizationId = organizationA,
    entryNumber,
    fiscalYear,
    period,
    entryDate,
    concept,
    status = "posted",
    debitCents,
    creditCents,
    reversalOfEntryId = null,
    reversedByEntryId = null,
  }) {
    await pool.query(
      `INSERT INTO fp360_accounting_entries
        (id, tenant_id, organization_id, entry_number, fiscal_year, period, entry_date, concept, status,
         source_type, source_reference, debit_cents, credit_cents, operation_id, request_fingerprint,
         created_by_user_id, created_by_name, posted_at, reversal_of_entry_id, reversed_by_entry_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10,$11,$12,$13,$14,$15,'Test account',$16,$17,$18)`,
      [
        id,
        tenantId,
        organizationId,
        entryNumber,
        fiscalYear,
        period,
        entryDate,
        concept,
        status,
        concept,
        debitCents,
        creditCents,
        randomUUID(),
        randomUUID(),
        managerUserId,
        status === "draft" ? null : new Date(`${entryDate}T12:00:00.000Z`),
        reversalOfEntryId,
        reversedByEntryId,
      ],
    );
    return id;
  }

  async function insertLines(entryId, lines) {
    for (const [index, line] of lines.entries()) {
      await pool.query(
        `INSERT INTO fp360_accounting_entry_lines
          (id, tenant_id, entry_id, account_id, line_number, description, debit_cents, credit_cents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          randomUUID(),
          tenantId,
          entryId,
          line.accountId,
          index + 1,
          line.description,
          line.debitCents,
          line.creditCents,
        ],
      );
    }
  }

  async function insertBalancedEntry(options, lines) {
    const id = await insertEntry({
      ...options,
      debitCents: lines.reduce((sum, line) => sum + line.debitCents, 0),
      creditCents: lines.reduce((sum, line) => sum + line.creditCents, 0),
    });
    await insertLines(id, lines);
    return id;
  }

  try {
    await pool.query(
      `INSERT INTO fp360_organizations (id,tenant_id,name,center,island,role)
       VALUES ($1,$2,'Export Company A','Accounting Center A','Tenerife','both'),
              ($3,$2,'Export Company B','Accounting Center B','Gran Canaria','both')`,
      [organizationA, tenantId, organizationB],
    );
    await pool.query(
      "INSERT INTO fp360_auth_users (id,email,display_name,password_hash) VALUES ($1,$2,'Accounting export manager',$3)",
      [managerUserId, `${managerUserId}@example.test`, passwordHash],
    );
    await pool.query(
      "INSERT INTO fp360_auth_memberships (id,user_id,tenant_id,organization_id,role) VALUES ($1,$2,$3,$4,'team_manager')",
      [randomUUID(), managerUserId, tenantId, organizationA],
    );
    const login = await request("/auth/login", {
      method: "POST",
      data: { email: `${managerUserId}@example.test`, password },
    });
    assert.equal(login.status, 200, "The company manager should be able to sign in");
    sessionCookie = login.cookie;
    assert.ok(sessionCookie, "Login should create the app-owned session cookie");

    await pool.query(
      `INSERT INTO fp360_accounting_accounts
        (id,tenant_id,organization_id,code,name,nature,normal_balance,created_by_user_id)
       VALUES ($1,$2,$3,'1000','Caja A','asset','debit',$4),
              ($5,$2,$3,'4000','Ingresos A','revenue','credit',$4),
              ($6,$2,$3,'6000','Gastos A','expense','debit',$4),
              ($7,$2,$3,'4100','Acreedores A','liability','credit',$4),
              ($8,$2,$9,'9999','DO_NOT_LEAK_COMPANY_B','asset','debit',$4)`,
      [accounts.cash, tenantId, organizationA, managerUserId, accounts.revenue, accounts.expense, accounts.payable, accounts.otherCompany, organizationB],
    );

    await insertBalancedEntry({
      entryNumber: 1,
      fiscalYear: 2026,
      period: 1,
      entryDate: "2026-01-10",
      concept: "Opening balance seed",
    }, [
      { accountId: accounts.cash, description: "Prior-year cash", debitCents: 10000, creditCents: 0 },
      { accountId: accounts.revenue, description: "Prior-year income", debitCents: 0, creditCents: 10000 },
    ]);

    const originalReversalId = randomUUID();
    const reversalId = randomUUID();
    await insertBalancedEntry({
      id: originalReversalId,
      entryNumber: 2,
      fiscalYear: 2026,
      period: 6,
      entryDate: "2026-06-01",
      concept: "Reversed prior-year entry",
      status: "reversed",
      reversedByEntryId: reversalId,
    }, [
      { accountId: accounts.cash, description: "Original debit", debitCents: 2000, creditCents: 0 },
      { accountId: accounts.revenue, description: "Original credit", debitCents: 0, creditCents: 2000 },
    ]);
    await insertBalancedEntry({
      id: reversalId,
      entryNumber: 3,
      fiscalYear: 2026,
      period: 6,
      entryDate: "2026-06-02",
      concept: "Posted reversal",
      reversalOfEntryId: originalReversalId,
    }, [
      { accountId: accounts.cash, description: "Reversal credit", debitCents: 0, creditCents: 2000 },
      { accountId: accounts.revenue, description: "Reversal debit", debitCents: 2000, creditCents: 0 },
    ]);

    await insertBalancedEntry({
      entryNumber: null,
      fiscalYear: 2027,
      period: 2,
      entryDate: "2027-02-01",
      concept: "DRAFT-MUST-NOT-AFFECT-LEDGER",
      status: "draft",
    }, [
      { accountId: accounts.cash, description: "Draft debit", debitCents: 99000, creditCents: 0 },
      { accountId: accounts.revenue, description: "Draft credit", debitCents: 0, creditCents: 99000 },
    ]);
    await insertBalancedEntry({
      entryNumber: 1,
      fiscalYear: 2027,
      period: 3,
      entryDate: "2027-03-15",
      concept: "POSTED-CURRENT-YEAR",
    }, [
      { accountId: accounts.cash, description: "Current-year debit", debitCents: 2500, creditCents: 0 },
      { accountId: accounts.revenue, description: "Current-year credit", debitCents: 0, creditCents: 2500 },
    ]);
    await insertBalancedEntry({
      entryNumber: 2,
      fiscalYear: 2027,
      period: 3,
      entryDate: "2027-03-20",
      concept: "POSTED-CURRENT-YEAR-EXPENSE",
    }, [
      { accountId: accounts.expense, description: "Current-year expense", debitCents: 1000, creditCents: 0 },
      { accountId: accounts.payable, description: "Expense payable", debitCents: 0, creditCents: 1000 },
    ]);
    for (let period = 1; period <= 12; period += 1) {
      await pool.query(
        `INSERT INTO fp360_accounting_periods (id,tenant_id,organization_id,fiscal_year,period,status)
         VALUES ($1,$2,$3,2027,$4,$5)`,
        [randomUUID(), tenantId, organizationA, period, period === 2 || period === 3 ? "open" : "closed"],
      );
    }
    await insertBalancedEntry({
      organizationId: organizationB,
      entryNumber: 1,
      fiscalYear: 2027,
      period: 3,
      entryDate: "2027-03-16",
      concept: "COMPANY-B-PRIVATE-ENTRY",
    }, [
      { accountId: accounts.otherCompany, description: "Private company amount", debitCents: 500000, creditCents: 0 },
      { accountId: accounts.otherCompany, description: "Private company balancing line", debitCents: 0, creditCents: 500000 },
    ]);

    const journalQuery = new URLSearchParams({
      organizationId: organizationA,
      fiscalYear: "2027",
      book: "journal",
    });
    const journal = await request(`/redfp360/accounting/export?${journalQuery}`, { cookie: sessionCookie });
    assert.equal(journal.status, 200);
    assert.match(journal.contentType ?? "", /text\/csv/i);
    assert.ok(journal.hasUtf8Bom, "CSV should include the UTF-8 BOM");
    assert.match(journal.text, /"Export Company A";"Accounting Center A"/);
    assert.ok(journal.text.includes("DRAFT-MUST-NOT-AFFECT-LEDGER"), "The journal should preserve draft status and visibility");
    assert.ok(!journal.text.includes("COMPANY-B-PRIVATE-ENTRY"));
    assert.ok(!journal.text.includes("DO_NOT_LEAK_COMPANY_B"));

    const deniedQuery = new URLSearchParams({
      organizationId: organizationB,
      fiscalYear: "2027",
      book: "journal",
    });
    const denied = await request(`/redfp360/accounting/export?${deniedQuery}`, { cookie: sessionCookie });
    assert.equal(denied.status, 403, "A company manager cannot export another company's journal");
    assert.ok(!denied.text.includes("COMPANY-B-PRIVATE-ENTRY"));

    const ledgerQuery = new URLSearchParams({
      organizationId: organizationA,
      fiscalYear: "2027",
      book: "ledger",
    });
    const ledger = await request(`/redfp360/accounting/export?${ledgerQuery}`, { cookie: sessionCookie });
    assert.equal(ledger.status, 200);
    const [headers, ...rows] = parseCsv(ledger.text);
    const ledgerRows = rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
    const openingCash = ledgerRows.find((row) => row.tipo_fila === "saldo_inicial" && row.cuenta_codigo === "1000");
    const openingRevenue = ledgerRows.find((row) => row.tipo_fila === "saldo_inicial" && row.cuenta_codigo === "4000");
    const cashMovement = ledgerRows.find((row) => row.tipo_fila === "movimiento" && row.cuenta_codigo === "1000");
    const revenueMovement = ledgerRows.find((row) => row.tipo_fila === "movimiento" && row.cuenta_codigo === "4000");

    assert.equal(openingCash?.saldo_acumulado_eur, "100,00", "Prior-year reversals should net to the correct debit opening balance");
    assert.equal(openingRevenue?.saldo_acumulado_eur, "100,00", "Credit-nature accounts should use their natural balance");
    assert.equal(cashMovement?.debe_eur, "25,00");
    assert.equal(cashMovement?.saldo_acumulado_eur, "125,00");
    assert.equal(revenueMovement?.haber_eur, "25,00");
    assert.equal(revenueMovement?.saldo_acumulado_eur, "125,00");
    assert.ok(ledgerRows.every((row) => row.empresa === "Export Company A" && row.centro === "Accounting Center A"));
    assert.ok(!ledger.text.includes("DRAFT-MUST-NOT-AFFECT-LEDGER"), "Draft entries must not affect or appear in the ledger");
    assert.ok(!ledger.text.includes("COMPANY-B-PRIVATE-ENTRY"));

    const yearEndQuery = new URLSearchParams({ organizationId: organizationA, fiscalYear: "2027" });
    const yearEnd = await request(`/redfp360/accounting/year-end-summary?${yearEndQuery}`, { cookie: sessionCookie });
    assert.equal(yearEnd.status, 200);
    const yearEndSummary = JSON.parse(yearEnd.text);
    assert.equal(yearEndSummary.periodsClosed, 10);
    assert.equal(yearEndSummary.periodsExpected, 12);
    assert.equal(yearEndSummary.draftEntries, 1);
    assert.equal(yearEndSummary.postedEntries, 2);
    assert.equal(yearEndSummary.journalBalanced, true);
    assert.equal(yearEndSummary.revenueCents, 2500);
    assert.equal(yearEndSummary.expenseCents, 1000);
    assert.equal(yearEndSummary.resultCents, 1500);
    assert.equal(yearEndSummary.unsettledProfitAndLossAccounts, 2);
    assert.equal(yearEndSummary.profitAndLossAccountsSettled, false);
    assert.equal(yearEndSummary.readyForAnnualClose, false);

    const deniedYearEnd = await request(
      `/redfp360/accounting/year-end-summary?${new URLSearchParams({ organizationId: organizationB, fiscalYear: "2027" })}`,
      { cookie: sessionCookie },
    );
    assert.equal(deniedYearEnd.status, 403, "A company manager cannot inspect another company's year-end balances");
  } finally {
    await pool.query("DELETE FROM fp360_accounting_entry_lines WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_accounting_events WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_accounting_entries WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_accounting_periods WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_accounting_accounts WHERE tenant_id = $1", [tenantId]);
    await pool.query("DELETE FROM fp360_auth_sessions WHERE user_id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_auth_memberships WHERE user_id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_auth_users WHERE id = ANY($1::text[])", [userIds]);
    await pool.query("DELETE FROM fp360_organizations WHERE tenant_id = $1", [tenantId]);
    await pool.end();
  }
});

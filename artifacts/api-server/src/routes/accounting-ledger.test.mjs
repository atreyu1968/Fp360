import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountingLedger } from "./accounting-ledger.mjs";

const fiscalYear = 2027;
const accounts = [
  { id: "asset", code: "4300", name: "Clientes", nature: "asset", normalBalance: "debit" },
  { id: "liability", code: "4000", name: "Proveedores", nature: "liability", normalBalance: "credit" },
  { id: "equity", code: "1000", name: "Capital", nature: "equity", normalBalance: "credit" },
  { id: "revenue", code: "7000", name: "Ventas", nature: "revenue", normalBalance: "credit" },
  { id: "expense", code: "6000", name: "Compras", nature: "expense", normalBalance: "debit" },
];

function entry(id, entryDate, entryNumber, status, year = Number(entryDate.slice(0, 4))) {
  return {
    id,
    fiscalYear: year,
    entryDate,
    entryNumber,
    status,
    sourceReference: null,
    concept: id,
  };
}

function line(entryId, accountId, debitCents, creditCents, description = entryId) {
  return {
    entryId,
    accountId,
    lineNumber: 1,
    debitCents,
    creditCents,
    description,
  };
}

test("ledger export uses posted prior-year balances and chronological movement balances by normal side", () => {
  const entries = [
    entry("asset-feb", "2027-02-03", 2, "posted"),
    entry("reversal", "2026-07-10", 5, "posted"),
    entry("liability-jan", "2027-01-05", 3, "posted"),
    entry("asset-old", "2025-03-01", 1, "posted"),
    entry("revenue-current", "2027-01-08", 4, "posted"),
    entry("draft-prior", "2026-04-10", 6, "draft"),
    entry("expense-prior", "2026-02-01", 7, "posted"),
    entry("asset-jan", "2027-01-05", 1, "posted"),
    entry("liability-old", "2025-04-01", 2, "posted"),
    entry("reversed-original", "2026-07-10", 4, "reversed"),
    entry("future", "2028-01-01", 1, "posted"),
    entry("asset-credit-prior", "2026-01-10", 2, "posted"),
    entry("liability-feb", "2027-02-05", 5, "posted"),
    entry("expense-current", "2027-01-09", 6, "posted"),
    entry("revenue-prior", "2026-03-01", 3, "posted"),
    entry("equity-prior", "2026-06-01", 8, "posted"),
    entry("draft-current", "2027-01-02", 9, "draft"),
    entry("liability-debit-prior", "2026-05-01", 10, "posted"),
  ];
  const lines = [
    line("asset-feb", "asset", 0, 1000),
    line("reversal", "asset", 0, 8000),
    line("liability-jan", "liability", 500, 0),
    line("asset-old", "asset", 10000, 0),
    line("revenue-current", "revenue", 0, 250),
    line("draft-prior", "asset", 99000, 0),
    line("expense-prior", "expense", 2700, 600),
    line("asset-jan", "asset", 4000, 0),
    line("liability-old", "liability", 0, 5000),
    line("reversed-original", "asset", 8000, 0),
    line("future", "asset", 50000, 0),
    line("asset-credit-prior", "asset", 0, 2500),
    line("liability-feb", "liability", 0, 900),
    line("expense-current", "expense", 300, 0),
    line("revenue-prior", "revenue", 500, 5000),
    line("equity-prior", "equity", 0, 10000),
    line("draft-current", "liability", 0, 20000),
    line("liability-debit-prior", "liability", 1200, 0),
  ];

  const result = buildAccountingLedger({ accounts, entries, lines, fiscalYear });

  assert.deepEqual(
    result.openingBalances.map(({ account, balanceCents }) => [account.id, balanceCents]),
    [
      ["asset", 7500],
      ["liability", 3800],
      ["equity", 10000],
      ["revenue", 4500],
      ["expense", 2100],
    ],
  );

  const assetMovements = result.movements.filter(({ account }) => account.id === "asset");
  assert.deepEqual(
    assetMovements.map(({ entry, balanceCents }) => [entry.id, balanceCents]),
    [
      ["asset-jan", 11500],
      ["asset-feb", 10500],
    ],
  );
  assert.deepEqual(
    result.movements
      .filter(({ account }) => account.id === "liability")
      .map(({ entry, balanceCents }) => [entry.id, balanceCents]),
    [
      ["liability-jan", 3300],
      ["liability-feb", 4200],
    ],
  );
  assert.deepEqual(
    result.movements
      .filter(({ account }) => account.id === "expense")
      .map(({ balanceCents }) => balanceCents),
    [2400],
  );
  assert.deepEqual(
    result.movements
      .filter(({ account }) => account.id === "revenue")
      .map(({ balanceCents }) => balanceCents),
    [4750],
  );
  assert.equal(result.movements.some(({ entry: item }) => item.id.startsWith("draft-")), false);
  assert.equal(result.movements.some(({ entry: item }) => item.id === "future"), false);
});

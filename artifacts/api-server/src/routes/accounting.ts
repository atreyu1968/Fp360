import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CloseFp360AccountingPeriodBody,
  CloseFp360AccountingPeriodParams,
  CloseFp360AccountingPeriodResponse,
  CreateFp360AccountingAccountBody,
  CreateFp360AccountingAccountResponse,
  CreateFp360AccountingEntryBody,
  CreateFp360AccountingEntryResponse,
  CreateFp360AccountingSourceDraftBody,
  CreateFp360AccountingSourceDraftParams,
  CreateFp360AccountingSourceDraftResponse,
  ExportFp360AccountingCsvQueryParams,
  GetFp360AccountingOverviewQueryParams,
  GetFp360AccountingOverviewResponse,
  GetFp360AccountingYearEndSummaryQueryParams,
  GetFp360AccountingYearEndSummaryResponse,
  PostFp360AccountingEntryBody,
  PostFp360AccountingEntryParams,
  PostFp360AccountingEntryResponse,
  ReopenFp360AccountingPeriodBody,
  ReopenFp360AccountingPeriodParams,
  ReopenFp360AccountingPeriodResponse,
  ReverseFp360AccountingEntryBody,
  ReverseFp360AccountingEntryParams,
  ReverseFp360AccountingEntryResponse,
} from "@workspace/api-zod";
import {
  db,
  fpAccountingAccounts,
  fpAccountingEntries,
  fpAccountingEntryLines,
  fpAccountingEvents,
  fpAccountingPeriods,
  fpAccountingSequences,
  fpInvoices,
  fpOrganizations,
  fpOrders,
  fpPayments,
  fpPurchaseInvoices,
  fpPurchaseOrders,
  fpPayrollRuns,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";
import {
  buildAccountingSources,
  canAccessAccountingOrganization,
} from "./accounting-scope.mjs";
import { buildAccountingExportCsv } from "./accounting-export.mjs";
import {
  buildPayrollAccountingLines,
  closedPayrollStatuses,
  resolvePayrollSourceRetry,
  validateIndependentPayrollReviewer,
  validatePayrollImport,
} from "./payroll-accounting.mjs";

const router: IRouter = Router();
router.use("/redfp360/accounting", requireAuth, requireSimulationWriteAccess);
const SIMULATED_DATE = "2027-09-15";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Nature = "asset" | "liability" | "equity" | "revenue" | "expense";
type BalanceSide = "debit" | "credit";
type JournalLineInput = {
  accountId: string;
  description: string;
  debitCents: number;
  creditCents: number;
  thirdPartyOrganizationId: string | null;
};

const defaultAccounts: Array<{ code: string; name: string; nature: Nature; normalBalance: BalanceSide }> = [
  { code: "1000", name: "Capital social", nature: "equity", normalBalance: "credit" },
  { code: "4000", name: "Proveedores", nature: "liability", normalBalance: "credit" },
  { code: "4100", name: "Acreedores por prestaciones", nature: "liability", normalBalance: "credit" },
  { code: "4300", name: "Clientes", nature: "asset", normalBalance: "debit" },
  { code: "4600", name: "Anticipos de personal · educativo", nature: "asset", normalBalance: "debit" },
  { code: "4720", name: "IGIC soportado", nature: "asset", normalBalance: "debit" },
  { code: "4751", name: "Retenciones didácticas por pagar", nature: "liability", normalBalance: "credit" },
  { code: "4770", name: "IGIC repercutido", nature: "liability", normalBalance: "credit" },
  { code: "4650", name: "Líquidos educativos pendientes", nature: "liability", normalBalance: "credit" },
  { code: "4651", name: "Otras deducciones educativas", nature: "liability", normalBalance: "credit" },
  { code: "4760", name: "Cuotas educativas pendientes", nature: "liability", normalBalance: "credit" },
  { code: "5720", name: "Bancos", nature: "asset", normalBalance: "debit" },
  { code: "6000", name: "Compras de mercaderías", nature: "expense", normalBalance: "debit" },
  { code: "6240", name: "Transportes", nature: "expense", normalBalance: "debit" },
  { code: "6400", name: "Salarios educativos", nature: "expense", normalBalance: "debit" },
  { code: "6420", name: "Coste educativo de cuotas empresa", nature: "expense", normalBalance: "debit" },
  { code: "7000", name: "Ventas de mercaderías", nature: "revenue", normalBalance: "credit" },
];

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isoDateTime(value: Date | null) {
  return value?.toISOString() ?? null;
}

function isValidDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function resolveOrganization(actor: AuthContext, requestedId: string) {
  if (!canAccessAccountingOrganization(actor, requestedId)) return null;
  const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, requestedId),
    eq(fpOrganizations.tenantId, actor.tenantId),
  )).limit(1);
  return organization?.id ?? null;
}

async function ensureChart(tenantId: string, organizationId: string, actor: AuthContext) {
  await db.insert(fpAccountingAccounts).values(defaultAccounts.map((account) => ({
    id: randomUUID(),
    tenantId,
    organizationId,
    ...account,
    parentCode: null,
    active: true,
    isSystem: true,
    createdByUserId: actor.userId,
  }))).onConflictDoNothing();
}

async function ensurePeriod(tx: Transaction, tenantId: string, organizationId: string, fiscalYear: number, period: number) {
  await tx.insert(fpAccountingPeriods).values({
    id: randomUUID(),
    tenantId,
    organizationId,
    fiscalYear,
    period,
    status: "open",
  }).onConflictDoNothing();
  const [row] = await tx.select().from(fpAccountingPeriods).where(and(
    eq(fpAccountingPeriods.tenantId, tenantId),
    eq(fpAccountingPeriods.organizationId, organizationId),
    eq(fpAccountingPeriods.fiscalYear, fiscalYear),
    eq(fpAccountingPeriods.period, period),
  )).for("update").limit(1);
  return row ?? null;
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  organizationId: string,
  operationId: string,
  requestFingerprint: string,
  eventType: string,
  description: string,
  entryId: string | null = null,
) {
  await tx.insert(fpAccountingEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId,
    entryId,
    operationId,
    requestFingerprint,
    eventType,
    description,
    actorUserId: actor.userId,
    actorName: actor.displayName,
  });
}

async function loadEntry(entryId: string, tenantId: string, organizationId: string) {
  const [entry] = await db.select().from(fpAccountingEntries).where(and(
    eq(fpAccountingEntries.id, entryId),
    eq(fpAccountingEntries.tenantId, tenantId),
    eq(fpAccountingEntries.organizationId, organizationId),
  )).limit(1);
  if (!entry) return null;
  const [lines, accounts, events] = await Promise.all([
    db.select().from(fpAccountingEntryLines).where(and(
      eq(fpAccountingEntryLines.entryId, entry.id),
      eq(fpAccountingEntryLines.tenantId, tenantId),
    )).orderBy(asc(fpAccountingEntryLines.lineNumber)),
    db.select().from(fpAccountingAccounts).where(and(
      eq(fpAccountingAccounts.tenantId, tenantId),
      eq(fpAccountingAccounts.organizationId, organizationId),
    )),
    db.select().from(fpAccountingEvents).where(and(
      eq(fpAccountingEvents.tenantId, tenantId),
      eq(fpAccountingEvents.entryId, entry.id),
    )).orderBy(asc(fpAccountingEvents.createdAt)),
  ]);
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  return {
    id: entry.id,
    organizationId: entry.organizationId,
    entryNumber: entry.entryNumber,
    fiscalYear: entry.fiscalYear,
    period: entry.period,
    entryDate: entry.entryDate,
    concept: entry.concept,
    status: entry.status,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    sourceReference: entry.sourceReference,
    debitCents: entry.debitCents,
    creditCents: entry.creditCents,
    createdByName: entry.createdByName,
    postedAt: isoDateTime(entry.postedAt),
    reversalOfEntryId: entry.reversalOfEntryId,
    reversedByEntryId: entry.reversedByEntryId,
    lines: lines.map((line) => {
      const account = accountById.get(line.accountId);
      return {
        lineNumber: line.lineNumber,
        accountId: line.accountId,
        accountCode: account?.code ?? "—",
        accountName: account?.name ?? "Cuenta no disponible",
        description: line.description,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        thirdPartyOrganizationId: line.thirdPartyOrganizationId,
      };
    }),
    events: events.map((event) => ({
      eventType: event.eventType,
      description: event.description,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
    createdAt: entry.createdAt.toISOString(),
  };
}

async function loadOverview(tenantId: string, organizationId: string, actor: AuthContext) {
  await ensureChart(tenantId, organizationId, actor);
  const currentYear = Number(SIMULATED_DATE.slice(0, 4));
  await db.insert(fpAccountingPeriods).values(Array.from({ length: 12 }, (_, index) => ({
    id: randomUUID(),
    tenantId,
    organizationId,
    fiscalYear: currentYear,
    period: index + 1,
    status: "open",
  }))).onConflictDoNothing();
  const [accounts, entries, periods] = await Promise.all([
    db.select().from(fpAccountingAccounts).where(and(
      eq(fpAccountingAccounts.tenantId, tenantId),
      eq(fpAccountingAccounts.organizationId, organizationId),
    )).orderBy(asc(fpAccountingAccounts.code)),
    db.select().from(fpAccountingEntries).where(and(
      eq(fpAccountingEntries.tenantId, tenantId),
      eq(fpAccountingEntries.organizationId, organizationId),
    )).orderBy(desc(fpAccountingEntries.entryDate), desc(fpAccountingEntries.createdAt)),
    db.select().from(fpAccountingPeriods).where(and(
      eq(fpAccountingPeriods.tenantId, tenantId),
      eq(fpAccountingPeriods.organizationId, organizationId),
    )).orderBy(desc(fpAccountingPeriods.fiscalYear), desc(fpAccountingPeriods.period)),
  ]);
  const lines = entries.length ? await db.select().from(fpAccountingEntryLines).where(and(
    eq(fpAccountingEntryLines.tenantId, tenantId),
    inArray(fpAccountingEntryLines.entryId, entries.map((entry) => entry.id)),
  )) : [];
  const entryEvents = entries.length ? await db.select().from(fpAccountingEvents).where(and(
    eq(fpAccountingEvents.tenantId, tenantId),
    inArray(fpAccountingEvents.entryId, entries.map((entry) => entry.id)),
  )).orderBy(asc(fpAccountingEvents.createdAt)) : [];
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const entryLinesById = new Map<string, typeof lines>();
  for (const line of lines) entryLinesById.set(line.entryId, [...(entryLinesById.get(line.entryId) ?? []), line]);
  const entryEventsById = new Map<string, typeof entryEvents>();
  for (const event of entryEvents) if (event.entryId) entryEventsById.set(event.entryId, [...(entryEventsById.get(event.entryId) ?? []), event]);
  const overviewEntries = entries.slice(0, 200).map((entry) => ({
    id: entry.id,
    organizationId: entry.organizationId,
    entryNumber: entry.entryNumber,
    fiscalYear: entry.fiscalYear,
    period: entry.period,
    entryDate: entry.entryDate,
    concept: entry.concept,
    status: entry.status,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    sourceReference: entry.sourceReference,
    debitCents: entry.debitCents,
    creditCents: entry.creditCents,
    createdByName: entry.createdByName,
    postedAt: isoDateTime(entry.postedAt),
    reversalOfEntryId: entry.reversalOfEntryId,
    reversedByEntryId: entry.reversedByEntryId,
    lines: (entryLinesById.get(entry.id) ?? []).sort((a, b) => a.lineNumber - b.lineNumber).map((line) => {
      const account = accountsById.get(line.accountId);
      return {
        lineNumber: line.lineNumber,
        accountId: line.accountId,
        accountCode: account?.code ?? "—",
        accountName: account?.name ?? "Cuenta no disponible",
        description: line.description,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
        thirdPartyOrganizationId: line.thirdPartyOrganizationId,
      };
    }),
    events: (entryEventsById.get(entry.id) ?? []).map((event) => ({
      eventType: event.eventType,
      description: event.description,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
    createdAt: entry.createdAt.toISOString(),
  }));

  const imported = new Set(entries.filter((entry) => entry.sourceId).map((entry) => `${entry.sourceType}:${entry.sourceId}`));
  const postedSalesInvoiceIds = new Set(entries.filter((entry) =>
    entry.sourceType === "sales_invoice" && entry.status === "posted" && entry.sourceId,
  ).map((entry) => entry.sourceId!));
  const salesInvoices = await db.select().from(fpInvoices).where(and(
    eq(fpInvoices.tenantId, tenantId),
    eq(fpInvoices.issuerOrganizationId, organizationId),
  ));
  const payments = salesInvoices.length ? await db.select().from(fpPayments).where(and(
    eq(fpPayments.tenantId, tenantId),
    eq(fpPayments.organizationId, organizationId),
    inArray(fpPayments.invoiceId, salesInvoices.map((invoice) => invoice.id)),
  )) : [];
  const purchaseOrders = await db.select().from(fpPurchaseOrders).where(and(
    eq(fpPurchaseOrders.tenantId, tenantId),
    eq(fpPurchaseOrders.buyerOrganizationId, organizationId),
  ));
  const purchaseInvoices = purchaseOrders.length ? await db.select().from(fpPurchaseInvoices).where(and(
    eq(fpPurchaseInvoices.tenantId, tenantId),
    eq(fpPurchaseInvoices.status, "conformed"),
    inArray(fpPurchaseInvoices.orderId, purchaseOrders.map((order) => order.id)),
  )) : [];
  const partnerIds = [...new Set(purchaseInvoices.map((invoice) => invoice.supplierOrganizationId))];
  const partners = partnerIds.length ? await db.select().from(fpOrganizations).where(and(
    eq(fpOrganizations.tenantId, tenantId),
    inArray(fpOrganizations.id, partnerIds),
  )) : [];
  const payrollRuns = await db.select().from(fpPayrollRuns).where(and(
    eq(fpPayrollRuns.tenantId, tenantId),
    eq(fpPayrollRuns.organizationId, organizationId),
  ));
  const sources = [
    ...buildAccountingSources({
    tenantId,
    organizationId,
    salesInvoices,
    payments,
    purchaseOrders,
    purchaseInvoices,
    partners,
    imported,
    postedSalesInvoiceIds,
    }),
    ...payrollRuns
      .filter((run) => closedPayrollStatuses.has(run.status))
      .map((run) => ({
        id: run.id,
        sourceType: "payroll_run" as const,
        reference: `Nómina ${run.periodKey} · v${run.version}`,
        sourceDate: `${run.periodKey}-01`,
        partnerName: "Plantilla ficticia",
        totalCents: run.employerCostTotalCents,
        status: run.status,
        imported: imported.has(`payroll_run:${run.id}`),
        periodKey: run.periodKey,
        version: run.version,
      })),
  ].sort((a, b) => b.sourceDate.localeCompare(a.sourceDate));

  const totalsByAccount = new Map<string, { debitCents: number; creditCents: number }>();
  for (const line of lines) {
    const entry = entries.find((candidate) => candidate.id === line.entryId);
    if (!entry || entry.status === "draft") continue;
    const totals = totalsByAccount.get(line.accountId) ?? { debitCents: 0, creditCents: 0 };
    totals.debitCents += line.debitCents;
    totals.creditCents += line.creditCents;
    totalsByAccount.set(line.accountId, totals);
  }
  const balances = accounts.map((account) => {
    const totals = totalsByAccount.get(account.id) ?? { debitCents: 0, creditCents: 0 };
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      nature: account.nature,
      normalBalance: account.normalBalance,
      debitCents: totals.debitCents,
      creditCents: totals.creditCents,
      balanceCents: account.normalBalance === "debit"
        ? totals.debitCents - totals.creditCents
        : totals.creditCents - totals.debitCents,
    };
  });
  const postedEntries = entries.filter((entry) => entry.status !== "draft");
  return GetFp360AccountingOverviewResponse.parse({
    organizationId,
    accounts: accounts.map((account) => ({
      id: account.id,
      organizationId: account.organizationId,
      code: account.code,
      name: account.name,
      nature: account.nature,
      normalBalance: account.normalBalance,
      parentCode: account.parentCode,
      active: account.active,
      isSystem: account.isSystem,
      createdAt: account.createdAt.toISOString(),
    })),
    entries: overviewEntries,
    periods: periods.map((period) => ({
      id: period.id,
      organizationId: period.organizationId,
      fiscalYear: period.fiscalYear,
      period: period.period,
      status: period.status,
      closedAt: isoDateTime(period.closedAt),
      reopenedAt: isoDateTime(period.reopenedAt),
      closeReason: period.closeReason,
    })),
    sources,
    balances,
    totals: {
      postedEntryCount: postedEntries.length,
      draftEntryCount: entries.length - postedEntries.length,
      debitCents: postedEntries.reduce((sum, entry) => sum + entry.debitCents, 0),
      creditCents: postedEntries.reduce((sum, entry) => sum + entry.creditCents, 0),
      balanced: postedEntries.reduce((sum, entry) => sum + entry.debitCents, 0) ===
        postedEntries.reduce((sum, entry) => sum + entry.creditCents, 0),
    },
  });
}

async function createDraft(
  tx: Transaction,
  actor: AuthContext,
  organizationId: string,
  operationId: string,
  requestFingerprint: string,
  entryDate: string,
  concept: string,
  sourceType: "manual" | "sales_invoice" | "purchase_invoice" | "payment" | "payroll_run" | "reversal",
  sourceId: string | null,
  sourceReference: string | null,
  lines: JournalLineInput[],
) {
  const [priorOperation] = await tx.select().from(fpAccountingEntries).where(and(
    eq(fpAccountingEntries.tenantId, actor.tenantId),
    eq(fpAccountingEntries.operationId, operationId),
  )).limit(1);
  if (priorOperation) {
    if (priorOperation.createdByUserId !== actor.userId || priorOperation.requestFingerprint !== requestFingerprint) {
      return { error: "La clave de operación ya se utilizó con otros datos.", status: 409 as const };
    }
    return { entryId: priorOperation.id };
  }
  if (sourceId) {
    const [priorSource] = await tx.select().from(fpAccountingEntries).where(and(
      eq(fpAccountingEntries.tenantId, actor.tenantId),
      eq(fpAccountingEntries.organizationId, organizationId),
      eq(fpAccountingEntries.sourceType, sourceType),
      eq(fpAccountingEntries.sourceId, sourceId),
    )).limit(1);
    if (priorSource) return { error: "Este documento ya se ha importado al diario.", status: 409 as const };
  }
  const fiscalYear = Number(entryDate.slice(0, 4));
  const periodNumber = Number(entryDate.slice(5, 7));
  const period = await ensurePeriod(tx, actor.tenantId, organizationId, fiscalYear, periodNumber);
  if (!period || period.status !== "open") return { error: "El periodo contable está cerrado.", status: 409 as const };
  const accountIds = [...new Set(lines.map((line) => line.accountId))];
  const accounts = await tx.select().from(fpAccountingAccounts).where(and(
    eq(fpAccountingAccounts.tenantId, actor.tenantId),
    eq(fpAccountingAccounts.organizationId, organizationId),
    inArray(fpAccountingAccounts.id, accountIds),
  ));
  if (accounts.length !== accountIds.length || accounts.some((account) => !account.active)) {
    return { error: "Todas las líneas deben usar cuentas activas de esta empresa.", status: 400 as const };
  }
  const thirdPartyIds = [...new Set(lines.map((line) => line.thirdPartyOrganizationId).filter((id): id is string => Boolean(id)))];
  if (thirdPartyIds.length) {
    const thirdParties = await tx.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
      eq(fpOrganizations.tenantId, actor.tenantId),
      inArray(fpOrganizations.id, thirdPartyIds),
    ));
    if (thirdParties.length !== thirdPartyIds.length) return { error: "La empresa vinculada a una línea no pertenece a esta red.", status: 400 as const };
  }
  const debitCents = lines.reduce((sum, line) => sum + line.debitCents, 0);
  const creditCents = lines.reduce((sum, line) => sum + line.creditCents, 0);
  if (!Number.isSafeInteger(debitCents) || !Number.isSafeInteger(creditCents)) {
    return { error: "El asiento supera el límite de cálculo permitido.", status: 400 as const };
  }
  const id = randomUUID();
  await tx.insert(fpAccountingEntries).values({
    id,
    tenantId: actor.tenantId,
    organizationId,
    entryNumber: null,
    fiscalYear,
    period: periodNumber,
    entryDate,
    concept,
    status: "draft",
    sourceType,
    sourceId,
    sourceReference,
    debitCents,
    creditCents,
    operationId,
    requestFingerprint,
    createdByUserId: actor.userId,
    createdByName: actor.displayName,
  });
  await tx.insert(fpAccountingEntryLines).values(lines.map((line, index) => ({
    id: randomUUID(),
    tenantId: actor.tenantId,
    entryId: id,
    accountId: line.accountId,
    lineNumber: index + 1,
    description: line.description,
    debitCents: line.debitCents,
    creditCents: line.creditCents,
    thirdPartyOrganizationId: line.thirdPartyOrganizationId,
  })));
  await appendEvent(tx, actor, organizationId, operationId, requestFingerprint, "draft_created", `Borrador creado: ${concept}.`, id);
  return { entryId: id };
}

async function nextEntryNumber(tx: Transaction, tenantId: string, organizationId: string, fiscalYear: number) {
  await tx.insert(fpAccountingSequences).values({
    id: randomUUID(),
    tenantId,
    organizationId,
    fiscalYear,
    nextEntryNumber: 1,
  }).onConflictDoNothing();
  const [sequence] = await tx.select().from(fpAccountingSequences).where(and(
    eq(fpAccountingSequences.tenantId, tenantId),
    eq(fpAccountingSequences.organizationId, organizationId),
    eq(fpAccountingSequences.fiscalYear, fiscalYear),
  )).for("update").limit(1);
  if (!sequence) throw new Error("No se pudo reservar un número de asiento.");
  await tx.update(fpAccountingSequences).set({ nextEntryNumber: sequence.nextEntryNumber + 1 }).where(eq(fpAccountingSequences.id, sequence.id));
  return sequence.nextEntryNumber;
}

router.get("/redfp360/accounting/overview", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const query = GetFp360AccountingOverviewQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, query.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a la contabilidad de esa empresa." });
    return;
  }
  res.json(await loadOverview(actor.tenantId, organizationId, actor));
});

router.get("/redfp360/accounting/year-end-summary", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const query = GetFp360AccountingYearEndSummaryQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, query.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a la contabilidad de esa empresa." });
    return;
  }

  const { fiscalYear } = query.data;
  const [accounts, entries, periods] = await Promise.all([
    db.select().from(fpAccountingAccounts).where(and(
      eq(fpAccountingAccounts.tenantId, actor.tenantId),
      eq(fpAccountingAccounts.organizationId, organizationId),
    )),
    db.select().from(fpAccountingEntries).where(and(
      eq(fpAccountingEntries.tenantId, actor.tenantId),
      eq(fpAccountingEntries.organizationId, organizationId),
      eq(fpAccountingEntries.fiscalYear, fiscalYear),
    )),
    db.select().from(fpAccountingPeriods).where(and(
      eq(fpAccountingPeriods.tenantId, actor.tenantId),
      eq(fpAccountingPeriods.organizationId, organizationId),
      eq(fpAccountingPeriods.fiscalYear, fiscalYear),
    )),
  ]);
  const postedEntries = entries.filter((entry) => entry.status !== "draft");
  const postedEntryIds = postedEntries.map((entry) => entry.id);
  const lines = postedEntryIds.length ? await db.select().from(fpAccountingEntryLines).where(and(
    eq(fpAccountingEntryLines.tenantId, actor.tenantId),
    inArray(fpAccountingEntryLines.entryId, postedEntryIds),
  )) : [];
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const profitAndLossTotals = new Map<string, { debitCents: number; creditCents: number }>();
  for (const account of accounts) {
    if (account.nature === "revenue" || account.nature === "expense") {
      profitAndLossTotals.set(account.id, { debitCents: 0, creditCents: 0 });
    }
  }
  for (const line of lines) {
    const account = accountById.get(line.accountId);
    const totals = profitAndLossTotals.get(line.accountId);
    if (!account || !totals) continue;
    totals.debitCents += line.debitCents;
    totals.creditCents += line.creditCents;
  }
  const profitAndLossAccounts = accounts
    .filter((account) => account.nature === "revenue" || account.nature === "expense")
    .map((account) => {
      const totals = profitAndLossTotals.get(account.id) ?? { debitCents: 0, creditCents: 0 };
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        nature: account.nature,
        normalBalance: account.normalBalance,
        debitCents: totals.debitCents,
        creditCents: totals.creditCents,
        balanceCents: account.normalBalance === "debit"
          ? totals.debitCents - totals.creditCents
          : totals.creditCents - totals.debitCents,
      };
    });
  const revenueCents = profitAndLossAccounts
    .filter((account) => account.nature === "revenue")
    .reduce((sum, account) => sum + account.balanceCents, 0);
  const expenseCents = profitAndLossAccounts
    .filter((account) => account.nature === "expense")
    .reduce((sum, account) => sum + account.balanceCents, 0);
  const periodsClosed = periods.filter((period) => period.status === "closed").length;
  const draftEntries = entries.length - postedEntries.length;
  const debitCents = postedEntries.reduce((sum, entry) => sum + entry.debitCents, 0);
  const creditCents = postedEntries.reduce((sum, entry) => sum + entry.creditCents, 0);
  const journalBalanced = postedEntries.every((entry) => entry.debitCents === entry.creditCents);
  const unsettledProfitAndLossAccounts = profitAndLossAccounts.filter((account) => account.balanceCents !== 0).length;
  const profitAndLossAccountsSettled = unsettledProfitAndLossAccounts === 0;

  res.json(GetFp360AccountingYearEndSummaryResponse.parse({
    organizationId,
    fiscalYear,
    periodsClosed,
    periodsExpected: 12,
    draftEntries,
    postedEntries: postedEntries.length,
    debitCents,
    creditCents,
    journalBalanced,
    revenueCents,
    expenseCents,
    resultCents: revenueCents - expenseCents,
    unsettledProfitAndLossAccounts,
    profitAndLossAccountsSettled,
    readyForAnnualClose: periodsClosed === 12
      && draftEntries === 0
      && journalBalanced
      && profitAndLossAccountsSettled,
    profitAndLossAccounts,
  }));
});

router.get("/redfp360/accounting/export", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const query = ExportFp360AccountingCsvQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, query.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a los libros de esa empresa." });
    return;
  }
  const fiscalYear = query.data.fiscalYear;
  const book = query.data.book;
  const [organization] = await db.select({
    name: fpOrganizations.name,
    center: fpOrganizations.center,
  }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
  )).limit(1);
  if (!organization) {
    res.status(404).json({ error: "No se encontró la empresa seleccionada." });
    return;
  }
  const accounts = await db.select().from(fpAccountingAccounts).where(and(
    eq(fpAccountingAccounts.tenantId, actor.tenantId),
    eq(fpAccountingAccounts.organizationId, organizationId),
  )).orderBy(asc(fpAccountingAccounts.code));
  const entries = await db.select().from(fpAccountingEntries).where(and(
    eq(fpAccountingEntries.tenantId, actor.tenantId),
    eq(fpAccountingEntries.organizationId, organizationId),
    book === "journal"
      ? eq(fpAccountingEntries.fiscalYear, fiscalYear)
      : lte(fpAccountingEntries.fiscalYear, fiscalYear),
  )).orderBy(asc(fpAccountingEntries.entryDate), asc(fpAccountingEntries.entryNumber), asc(fpAccountingEntries.createdAt));
  const entryLines = entries.length ? await db.select().from(fpAccountingEntryLines).where(and(
    eq(fpAccountingEntryLines.tenantId, actor.tenantId),
    inArray(fpAccountingEntryLines.entryId, entries.map((entry) => entry.id)),
  )).orderBy(asc(fpAccountingEntryLines.lineNumber)) : [];
  const csv = buildAccountingExportCsv({
    tenantId: actor.tenantId,
    organization: { id: organizationId, ...organization },
    fiscalYear,
    book,
    accounts,
    entries,
    entryLines,
  });

  const safeOrganizationName = organization.name.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || organizationId.slice(0, 12);
  const filename = `red-fp360-${book}-${safeOrganizationName}-${fiscalYear}.csv`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).type("text/csv; charset=utf-8").send(csv);
});

router.post("/redfp360/accounting/accounts", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const body = CreateFp360AccountingAccountBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a esa empresa." });
    return;
  }
  const code = body.data.code.trim();
  const name = body.data.name.trim();
  const parentCode = body.data.parentCode?.trim() || null;
  if (parentCode) {
    const [parent] = await db.select().from(fpAccountingAccounts).where(and(
      eq(fpAccountingAccounts.tenantId, actor.tenantId),
      eq(fpAccountingAccounts.organizationId, organizationId),
      eq(fpAccountingAccounts.code, parentCode),
    )).limit(1);
    if (!parent || parent.nature !== body.data.nature || parent.normalBalance !== body.data.normalBalance || code.length <= parent.code.length || !code.startsWith(parent.code)) {
      res.status(400).json({ error: "La subcuenta debe conservar el prefijo y la naturaleza de su cuenta principal." });
      return;
    }
  }
  const [account] = await db.insert(fpAccountingAccounts).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId,
    code,
    name,
    nature: body.data.nature,
    normalBalance: body.data.normalBalance,
    parentCode,
    active: true,
    isSystem: false,
    createdByUserId: actor.userId,
  }).onConflictDoNothing().returning();
  if (!account) {
    res.status(409).json({ error: "Ya existe una cuenta con ese código en esta empresa." });
    return;
  }
  res.status(201).json(CreateFp360AccountingAccountResponse.parse({
    id: account.id,
    organizationId: account.organizationId,
    code: account.code,
    name: account.name,
    nature: account.nature,
    normalBalance: account.normalBalance,
    parentCode: account.parentCode,
    active: account.active,
    isSystem: account.isSystem,
    createdAt: account.createdAt.toISOString(),
  }));
});

router.post("/redfp360/accounting/entries", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const body = CreateFp360AccountingEntryBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a esa empresa." });
    return;
  }
  const entryDate = body.data.entryDate;
  if (!isValidDate(entryDate) || entryDate > SIMULATED_DATE) {
    res.status(400).json({ error: "La fecha debe ser válida y no posterior a la fecha del escenario." });
    return;
  }
  const lines = body.data.lines.map((line) => ({
    ...line,
    description: line.description.trim(),
  }));
  if (lines.some((line) => (line.debitCents === 0 && line.creditCents === 0) || (line.debitCents > 0 && line.creditCents > 0))) {
    res.status(400).json({ error: "Cada línea debe tener un importe en Debe o en Haber, nunca en ambos." });
    return;
  }
  const concept = body.data.concept.trim();
  const normalized = { organizationId, operationId: body.data.operationId, entryDate, concept, lines };
  const requestFingerprint = fingerprint(normalized);
  const result = await db.transaction(async (tx) => createDraft(
    tx, actor, organizationId, normalized.operationId, requestFingerprint, entryDate, concept,
    "manual", null, null, lines,
  ));
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  const entry = await loadEntry(result.entryId, actor.tenantId, organizationId);
  res.status(201).json(CreateFp360AccountingEntryResponse.parse(entry));
});

router.post("/redfp360/accounting/entries/:id/post", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = PostFp360AccountingEntryParams.safeParse(req.params);
  const body = PostFp360AccountingEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Indica el asiento y la clave de operación." });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a esa empresa." });
    return;
  }
  const requestFingerprint = fingerprint({ entryId: params.data.id, organizationId, operationId: body.data.operationId, action: "post" });
  const result = await db.transaction(async (tx) => {
    const [priorEvent] = await tx.select().from(fpAccountingEvents).where(and(
      eq(fpAccountingEvents.tenantId, actor.tenantId),
      eq(fpAccountingEvents.operationId, body.data.operationId),
    )).limit(1);
    if (priorEvent) {
      if (priorEvent.actorUserId !== actor.userId || priorEvent.requestFingerprint !== requestFingerprint) {
        return { error: "La clave de operación ya se utilizó con otros datos.", status: 409 as const };
      }
      return { entryId: priorEvent.entryId! };
    }
    const [entry] = await tx.select().from(fpAccountingEntries).where(and(
      eq(fpAccountingEntries.id, params.data.id),
      eq(fpAccountingEntries.tenantId, actor.tenantId),
      eq(fpAccountingEntries.organizationId, organizationId),
    )).for("update").limit(1);
    if (!entry) return { error: "Asiento no encontrado.", status: 404 as const };
    if (entry.status !== "draft") return { error: "Solo se puede contabilizar un borrador.", status: 409 as const };
    if (entry.sourceType === "payroll_run") {
      const [run] = await tx.select().from(fpPayrollRuns).where(and(
        eq(fpPayrollRuns.id, entry.sourceId ?? ""),
        eq(fpPayrollRuns.tenantId, actor.tenantId),
        eq(fpPayrollRuns.organizationId, organizationId),
      )).for("update").limit(1);
      if (!run || !closedPayrollStatuses.has(run.status)
        || entry.fiscalYear !== Number(run.periodKey.slice(0, 4))
        || entry.period !== Number(run.periodKey.slice(5, 7))
        || entry.sourceReference !== `${run.periodKey} · v${run.version}`) {
        return { error: "El origen de nómina ya no coincide con la empresa, periodo o versión del borrador.", status: 409 as const };
      }
      const reviewerError = validateIndependentPayrollReviewer(run, actor.userId);
      if (reviewerError) return { error: reviewerError, status: 409 as const };
    }
    const lines = await tx.select().from(fpAccountingEntryLines).where(and(
      eq(fpAccountingEntryLines.tenantId, actor.tenantId),
      eq(fpAccountingEntryLines.entryId, entry.id),
    ));
    const debitCents = lines.reduce((sum, line) => sum + line.debitCents, 0);
    const creditCents = lines.reduce((sum, line) => sum + line.creditCents, 0);
    if (lines.length < 2 || debitCents <= 0 || debitCents !== creditCents) {
      return { error: "El asiento debe tener al menos dos líneas y cuadrar Debe y Haber al céntimo.", status: 409 as const };
    }
    const period = await ensurePeriod(tx, actor.tenantId, organizationId, entry.fiscalYear, entry.period);
    if (!period || period.status !== "open") return { error: "Reabre el periodo con autorización antes de contabilizar.", status: 409 as const };
    const entryNumber = await nextEntryNumber(tx, actor.tenantId, organizationId, entry.fiscalYear);
    await tx.update(fpAccountingEntries).set({
      status: "posted",
      entryNumber,
      debitCents,
      creditCents,
      postedAt: new Date(),
    }).where(eq(fpAccountingEntries.id, entry.id));
    await appendEvent(tx, actor, organizationId, body.data.operationId, requestFingerprint, "entry_posted", `Asiento ${entryNumber} contabilizado.`, entry.id);
    return { entryId: entry.id };
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  const entry = await loadEntry(result.entryId, actor.tenantId, organizationId);
  res.json(PostFp360AccountingEntryResponse.parse(entry));
});

router.post("/redfp360/accounting/entries/:id/reverse", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = ReverseFp360AccountingEntryParams.safeParse(req.params);
  const body = ReverseFp360AccountingEntryBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Indica el asiento, un motivo y la clave de operación." });
    return;
  }
  if (!["teacher", "administrator", "team_manager"].includes(actor.role)) {
    res.status(403).json({ error: "Solo un responsable puede autorizar un contrasiento." });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a esa empresa." });
    return;
  }
  const reason = body.data.reason?.trim() ?? "";
  if (reason.length < 5) {
    res.status(400).json({ error: "Explica el motivo del contrasiento con al menos cinco caracteres." });
    return;
  }
  const requestFingerprint = fingerprint({ entryId: params.data.id, organizationId, operationId: body.data.operationId, reason, action: "reverse" });
  const result = await db.transaction(async (tx) => {
    const [priorEvent] = await tx.select().from(fpAccountingEvents).where(and(
      eq(fpAccountingEvents.tenantId, actor.tenantId),
      eq(fpAccountingEvents.operationId, body.data.operationId),
    )).limit(1);
    if (priorEvent) {
      if (priorEvent.actorUserId !== actor.userId || priorEvent.requestFingerprint !== requestFingerprint) {
        return { error: "La clave de operación ya se utilizó con otros datos.", status: 409 as const };
      }
      return { entryId: priorEvent.entryId! };
    }
    const [original] = await tx.select().from(fpAccountingEntries).where(and(
      eq(fpAccountingEntries.id, params.data.id),
      eq(fpAccountingEntries.tenantId, actor.tenantId),
      eq(fpAccountingEntries.organizationId, organizationId),
    )).for("update").limit(1);
    if (!original) return { error: "Asiento no encontrado.", status: 404 as const };
    if (original.status !== "posted") return { error: "Solo se pueden rectificar asientos contabilizados que no estén ya rectificados.", status: 409 as const };
    const period = await ensurePeriod(tx, actor.tenantId, organizationId, original.fiscalYear, original.period);
    if (!period || period.status !== "open") return { error: "Abre el periodo con autorización antes de crear el contrasiento.", status: 409 as const };
    const originalLines = await tx.select().from(fpAccountingEntryLines).where(and(
      eq(fpAccountingEntryLines.tenantId, actor.tenantId),
      eq(fpAccountingEntryLines.entryId, original.id),
    )).orderBy(asc(fpAccountingEntryLines.lineNumber));
    const entryNumber = await nextEntryNumber(tx, actor.tenantId, organizationId, original.fiscalYear);
    const reversalId = randomUUID();
    const concept = `Contrasiento ${original.entryNumber ?? original.id.slice(0, 8)}: ${reason}`;
    const reversalOperation = `reverse-${body.data.operationId}`;
    const reversalFingerprint = fingerprint({ originalId: original.id, reason, type: "reversal" });
    await tx.insert(fpAccountingEntries).values({
      id: reversalId,
      tenantId: actor.tenantId,
      organizationId,
      entryNumber,
      fiscalYear: original.fiscalYear,
      period: original.period,
      entryDate: original.entryDate,
      concept,
      status: "posted",
      sourceType: "reversal",
      sourceId: original.id,
      sourceReference: original.sourceReference ?? `Asiento ${original.entryNumber ?? ""}`,
      debitCents: original.creditCents,
      creditCents: original.debitCents,
      operationId: reversalOperation,
      requestFingerprint: reversalFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      postedAt: new Date(),
      reversalOfEntryId: original.id,
    });
    await tx.insert(fpAccountingEntryLines).values(originalLines.map((line, index) => ({
      id: randomUUID(),
      tenantId: actor.tenantId,
      entryId: reversalId,
      accountId: line.accountId,
      lineNumber: index + 1,
      description: `Contrasiento: ${line.description}`,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
      thirdPartyOrganizationId: line.thirdPartyOrganizationId,
    })));
    await tx.update(fpAccountingEntries).set({ status: "reversed", reversedByEntryId: reversalId }).where(eq(fpAccountingEntries.id, original.id));
    await appendEvent(tx, actor, organizationId, body.data.operationId, requestFingerprint, "entry_reversed", `Contrasiento contabilizado: ${reason}`, reversalId);
    return { entryId: reversalId };
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  const entry = await loadEntry(result.entryId, actor.tenantId, organizationId);
  res.status(201).json(ReverseFp360AccountingEntryResponse.parse(entry));
});

router.post("/redfp360/accounting/sources/:sourceType/:sourceId/draft", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = CreateFp360AccountingSourceDraftParams.safeParse(req.params);
  const body = CreateFp360AccountingSourceDraftBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Indica el documento y la empresa contable." });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a esa empresa." });
    return;
  }
  if (params.data.sourceType === "payroll_run" && (
    !body.data.expectedPeriodKey
    || !body.data.expectedVersion
    || !body.data.payrollAccounts
  )) {
    res.status(400).json({ error: "Indica el periodo, versión y cuentas educativas de la nómina." });
    return;
  }
  await ensureChart(actor.tenantId, organizationId, actor);
  const payrollAccounts = body.data.payrollAccounts;
  const requestFingerprint = params.data.sourceType === "payroll_run"
    ? fingerprint({
      organizationId,
      sourceId: params.data.sourceId,
      expectedPeriodKey: body.data.expectedPeriodKey,
      expectedVersion: body.data.expectedVersion,
      payrollAccounts,
    })
    : fingerprint({ organizationId, sourceType: params.data.sourceType, sourceId: params.data.sourceId, operationId: body.data.operationId });
  const result = await db.transaction(async (tx) => {
    if (params.data.sourceType === "payroll_run") {
      const [run] = await tx.select().from(fpPayrollRuns).where(and(
        eq(fpPayrollRuns.id, params.data.sourceId),
        eq(fpPayrollRuns.tenantId, actor.tenantId),
      )).for("update").limit(1);
      if (!run) return { error: "No se encontró la nómina para la empresa seleccionada.", status: 404 as const };
      const validationError = validatePayrollImport(run, {
        organizationId,
        expectedPeriodKey: body.data.expectedPeriodKey!,
        expectedVersion: body.data.expectedVersion!,
      });
      if (validationError) return { error: validationError, status: 409 as const };

      const [priorOperation] = await tx.select().from(fpAccountingEntries).where(and(
        eq(fpAccountingEntries.tenantId, actor.tenantId),
        eq(fpAccountingEntries.operationId, body.data.operationId),
      )).limit(1);
      if (priorOperation) {
        if (priorOperation.createdByUserId !== actor.userId || priorOperation.requestFingerprint !== requestFingerprint) {
          return { error: "La clave de operación ya se utilizó con otros datos.", status: 409 as const };
        }
        return { entryId: priorOperation.id };
      }

      const [priorSource] = await tx.select().from(fpAccountingEntries).where(and(
        eq(fpAccountingEntries.tenantId, actor.tenantId),
        eq(fpAccountingEntries.organizationId, organizationId),
        eq(fpAccountingEntries.sourceType, "payroll_run"),
        eq(fpAccountingEntries.sourceId, run.id),
      )).limit(1);
      if (priorSource) {
        return resolvePayrollSourceRetry(priorSource, requestFingerprint)!;
      }

      const accounts = await tx.select().from(fpAccountingAccounts).where(and(
        eq(fpAccountingAccounts.tenantId, actor.tenantId),
        eq(fpAccountingAccounts.organizationId, organizationId),
      ));
      const selectedAccounts = new Map(accounts.map((account) => [account.id, account]));
      const mapping = payrollAccounts!;
      const natureRequirements: Array<[string, Nature[]]> = [
        [mapping.wagesExpenseAccountId, ["expense"]],
        [mapping.employerCostAccountId, ["expense"]],
        [mapping.netPayableAccountId, ["liability"]],
        [mapping.workerContributionAccountId, ["liability"]],
        [mapping.employerContributionAccountId, ["liability"]],
        [mapping.withholdingAccountId, ["liability"]],
        [mapping.advancesAccountId, ["asset"]],
        [mapping.otherDeductionsAccountId, ["asset", "liability"]],
      ];
      if (natureRequirements.some(([id, allowed]) => {
        const account = selectedAccounts.get(id);
        return !account || !account.active || !allowed.includes(account.nature as Nature);
      })) {
        return { error: "Selecciona cuentas activas de gasto, pasivo o activo según cada concepto de nómina.", status: 400 as const };
      }

      const lines = buildPayrollAccountingLines(run, mapping);
      if (lines.length < 2) return { error: "La nómina no contiene importes que puedan generar un borrador contable.", status: 409 as const };
      const entryDate = `${run.periodKey}-01`;
      const concept = `Nómina educativa ${run.periodKey} · v${run.version}`;
      const sourceReference = `${run.periodKey} · v${run.version}`;
      return createDraft(
        tx, actor, organizationId, body.data.operationId, requestFingerprint, entryDate, concept,
        "payroll_run", run.id, sourceReference, lines,
      );
    }
    const existing = await tx.select().from(fpAccountingEntries).where(and(
      eq(fpAccountingEntries.tenantId, actor.tenantId),
      eq(fpAccountingEntries.organizationId, organizationId),
      eq(fpAccountingEntries.sourceType, params.data.sourceType),
      eq(fpAccountingEntries.sourceId, params.data.sourceId),
    )).limit(1);
    if (existing.length) return { error: "Este documento ya tiene un asiento vinculado.", status: 409 as const };
    const accounts = await tx.select().from(fpAccountingAccounts).where(and(
      eq(fpAccountingAccounts.tenantId, actor.tenantId),
      eq(fpAccountingAccounts.organizationId, organizationId),
    ));
    const accountId = new Map(accounts.map((account) => [account.code, account.id]));
    const requiredCodes = params.data.sourceType === "sales_invoice"
      ? ["4300", "7000", "4770"]
      : params.data.sourceType === "payment"
        ? ["4300", "5720"]
        : ["6000", "6240", "4720", "4000"];
    if (requiredCodes.some((code) => !accountId.has(code))) return { error: "Falta una cuenta necesaria del plan contable.", status: 409 as const };
    let entryDate: string;
    let concept: string;
    let sourceReference: string;
    let lines: JournalLineInput[];
    if (params.data.sourceType === "sales_invoice") {
      const [invoice] = await tx.select().from(fpInvoices).where(and(
        eq(fpInvoices.id, params.data.sourceId),
        eq(fpInvoices.tenantId, actor.tenantId),
        eq(fpInvoices.issuerOrganizationId, organizationId),
      )).for("update").limit(1);
      if (!invoice) return { error: "Factura de venta no encontrada para esta empresa.", status: 404 as const };
      const [order] = await tx.select().from(fpOrders).where(and(
        eq(fpOrders.id, invoice.orderId),
        eq(fpOrders.tenantId, actor.tenantId),
      )).limit(1);
      if (!order) return { error: "Pedido de origen de la factura no encontrado.", status: 404 as const };
      entryDate = invoice.simulatedDate;
      concept = `Factura de venta ${invoice.reference}`;
      sourceReference = invoice.reference;
      lines = [
        { accountId: accountId.get("4300")!, description: `Cliente · ${invoice.buyerName}`, debitCents: invoice.totalCents, creditCents: 0, thirdPartyOrganizationId: order.buyerOrganizationId },
        ...(invoice.baseCents ? [{ accountId: accountId.get("7000")!, description: `Base factura ${invoice.reference}`, debitCents: 0, creditCents: invoice.baseCents, thirdPartyOrganizationId: null }] : []),
        ...(invoice.igicCents ? [{ accountId: accountId.get("4770")!, description: `IGIC repercutido · ${invoice.reference}`, debitCents: 0, creditCents: invoice.igicCents, thirdPartyOrganizationId: null }] : []),
      ];
    } else if (params.data.sourceType === "payment") {
      const [payment] = await tx.select().from(fpPayments).where(and(
        eq(fpPayments.id, params.data.sourceId),
        eq(fpPayments.tenantId, actor.tenantId),
        eq(fpPayments.organizationId, organizationId),
      )).for("update").limit(1);
      if (!payment) return { error: "Cobro simulado no encontrado para esta empresa.", status: 404 as const };
      const [invoice] = await tx.select().from(fpInvoices).where(and(
        eq(fpInvoices.id, payment.invoiceId),
        eq(fpInvoices.tenantId, actor.tenantId),
        eq(fpInvoices.issuerOrganizationId, organizationId),
      )).limit(1);
      if (!invoice) return { error: "La factura de venta no pertenece a esta empresa.", status: 403 as const };
      const [salesEntry] = await tx.select({ id: fpAccountingEntries.id }).from(fpAccountingEntries).where(and(
        eq(fpAccountingEntries.tenantId, actor.tenantId),
        eq(fpAccountingEntries.organizationId, organizationId),
        eq(fpAccountingEntries.sourceType, "sales_invoice"),
        eq(fpAccountingEntries.sourceId, invoice.id),
        eq(fpAccountingEntries.status, "posted"),
      )).limit(1);
      if (!salesEntry) return { error: "Contabiliza primero la factura de venta antes de importar su cobro.", status: 409 as const };
      const [order] = await tx.select().from(fpOrders).where(and(
        eq(fpOrders.id, invoice.orderId),
        eq(fpOrders.tenantId, actor.tenantId),
      )).limit(1);
      if (!order) return { error: "Pedido de origen de la factura no encontrado.", status: 404 as const };
      entryDate = payment.simulatedDate;
      concept = `Cobro de factura ${invoice.reference}`;
      sourceReference = `${invoice.reference} · ${payment.id}`;
      lines = [
        { accountId: accountId.get("5720")!, description: `Banco · ${invoice.reference}`, debitCents: payment.amountCents, creditCents: 0, thirdPartyOrganizationId: null },
        { accountId: accountId.get("4300")!, description: `Cobro cliente · ${invoice.reference}`, debitCents: 0, creditCents: payment.amountCents, thirdPartyOrganizationId: order.buyerOrganizationId },
      ];
    } else {
      const [invoice] = await tx.select().from(fpPurchaseInvoices).where(and(
        eq(fpPurchaseInvoices.id, params.data.sourceId),
        eq(fpPurchaseInvoices.tenantId, actor.tenantId),
        eq(fpPurchaseInvoices.status, "conformed"),
      )).for("update").limit(1);
      if (!invoice) return { error: "Solo se importan facturas de proveedor conformadas.", status: 404 as const };
      const [order] = await tx.select().from(fpPurchaseOrders).where(and(
        eq(fpPurchaseOrders.id, invoice.orderId),
        eq(fpPurchaseOrders.tenantId, actor.tenantId),
        eq(fpPurchaseOrders.buyerOrganizationId, organizationId),
      )).limit(1);
      if (!order) return { error: "La factura de proveedor no pertenece a esta empresa.", status: 403 as const };
      entryDate = invoice.invoiceDate;
      concept = `Factura de compra ${invoice.invoiceReference}`;
      sourceReference = invoice.invoiceReference;
      lines = [
        ...(invoice.baseCents ? [{ accountId: accountId.get("6000")!, description: `Compras · ${invoice.invoiceReference}`, debitCents: invoice.baseCents, creditCents: 0, thirdPartyOrganizationId: null }] : []),
        ...(invoice.freightCents ? [{ accountId: accountId.get("6240")!, description: `Transporte · ${invoice.invoiceReference}`, debitCents: invoice.freightCents, creditCents: 0, thirdPartyOrganizationId: null }] : []),
        ...(invoice.igicCents ? [{ accountId: accountId.get("4720")!, description: `IGIC soportado · ${invoice.invoiceReference}`, debitCents: invoice.igicCents, creditCents: 0, thirdPartyOrganizationId: invoice.supplierOrganizationId }] : []),
        { accountId: accountId.get("4000")!, description: `Proveedor · ${invoice.invoiceReference}`, debitCents: 0, creditCents: invoice.totalCents, thirdPartyOrganizationId: invoice.supplierOrganizationId },
      ];
    }
    return createDraft(
      tx, actor, organizationId, body.data.operationId, requestFingerprint, entryDate, concept,
      params.data.sourceType, params.data.sourceId, sourceReference, lines,
    );
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  const entry = await loadEntry(result.entryId, actor.tenantId, organizationId);
  res.status(201).json(CreateFp360AccountingSourceDraftResponse.parse(entry));
});

router.post("/redfp360/accounting/periods/:fiscalYear/:period/close", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = CloseFp360AccountingPeriodParams.safeParse({
    fiscalYear: Number(req.params.fiscalYear),
    period: Number(req.params.period),
  });
  const body = CloseFp360AccountingPeriodBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Indica un ejercicio, periodo y motivo de cierre válidos." });
    return;
  }
  if (!["teacher", "administrator", "team_manager"].includes(actor.role)) {
    res.status(403).json({ error: "Solo un responsable puede cerrar un periodo contable." });
    return;
  }
  const closeReason = body.data.reason?.trim() ?? "";
  if (closeReason.length < 5) {
    res.status(400).json({ error: "Describe el motivo del cierre con al menos cinco caracteres." });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a esa empresa." });
    return;
  }
  const requestFingerprint = fingerprint({ organizationId, fiscalYear: params.data.fiscalYear, period: params.data.period, reason: closeReason, action: "close" });
  const result = await db.transaction(async (tx) => {
    const [priorEvent] = await tx.select().from(fpAccountingEvents).where(and(
      eq(fpAccountingEvents.tenantId, actor.tenantId), eq(fpAccountingEvents.operationId, body.data.operationId),
    )).limit(1);
    if (priorEvent) {
      if (priorEvent.actorUserId !== actor.userId || priorEvent.requestFingerprint !== requestFingerprint) {
        return { error: "La clave de operación ya se utilizó con otros datos.", status: 409 as const };
      }
      return { period: await ensurePeriod(tx, actor.tenantId, organizationId, params.data.fiscalYear, params.data.period) };
    }
    const period = await ensurePeriod(tx, actor.tenantId, organizationId, params.data.fiscalYear, params.data.period);
    if (!period) return { error: "No se pudo abrir el periodo.", status: 500 as const };
    if (period.status === "closed") return { error: "El periodo ya está cerrado.", status: 409 as const };
    const drafts = await tx.select({ id: fpAccountingEntries.id }).from(fpAccountingEntries).where(and(
      eq(fpAccountingEntries.tenantId, actor.tenantId),
      eq(fpAccountingEntries.organizationId, organizationId),
      eq(fpAccountingEntries.fiscalYear, params.data.fiscalYear),
      eq(fpAccountingEntries.period, params.data.period),
      eq(fpAccountingEntries.status, "draft"),
    ));
    if (drafts.length) return { error: "Contabiliza o resuelve los borradores antes de cerrar.", status: 409 as const };
    const periodEntries = await tx.select().from(fpAccountingEntries).where(and(
      eq(fpAccountingEntries.tenantId, actor.tenantId),
      eq(fpAccountingEntries.organizationId, organizationId),
      eq(fpAccountingEntries.fiscalYear, params.data.fiscalYear),
      eq(fpAccountingEntries.period, params.data.period),
    ));
    const posted = periodEntries.filter((entry) => entry.status !== "draft");
    if (posted.reduce((sum, entry) => sum + entry.debitCents, 0) !== posted.reduce((sum, entry) => sum + entry.creditCents, 0)) {
      return { error: "El periodo contiene un descuadre; revisa los asientos antes de cerrar.", status: 409 as const };
    }
    await tx.update(fpAccountingPeriods).set({
      status: "closed",
      closedAt: new Date(),
      closedByUserId: actor.userId,
      closeReason,
    }).where(eq(fpAccountingPeriods.id, period.id));
    await appendEvent(tx, actor, organizationId, body.data.operationId, requestFingerprint, "period_closed", `Periodo cerrado: ${closeReason}.`);
    return { period: { ...period, status: "closed", closedAt: new Date(), closedByUserId: actor.userId, closeReason } };
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.json(CloseFp360AccountingPeriodResponse.parse({
    id: result.period!.id,
    organizationId: result.period!.organizationId,
    fiscalYear: result.period!.fiscalYear,
    period: result.period!.period,
    status: result.period!.status,
    closedAt: isoDateTime(result.period!.closedAt),
    reopenedAt: isoDateTime(result.period!.reopenedAt),
    closeReason: result.period!.closeReason,
  }));
});

router.post("/redfp360/accounting/periods/:fiscalYear/:period/reopen", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = ReopenFp360AccountingPeriodParams.safeParse({
    fiscalYear: Number(req.params.fiscalYear),
    period: Number(req.params.period),
  });
  const body = ReopenFp360AccountingPeriodBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Indica un ejercicio, periodo y motivo de reapertura válidos." });
    return;
  }
  if (!["teacher", "administrator"].includes(actor.role)) {
    res.status(403).json({ error: "Solo un docente o administrador puede reabrir un periodo." });
    return;
  }
  const reopenReason = body.data.reason?.trim() ?? "";
  if (reopenReason.length < 5) {
    res.status(400).json({ error: "Describe el motivo de reapertura con al menos cinco caracteres." });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "No tienes acceso a esa empresa." });
    return;
  }
  const requestFingerprint = fingerprint({ organizationId, fiscalYear: params.data.fiscalYear, period: params.data.period, reason: reopenReason, action: "reopen" });
  const result = await db.transaction(async (tx) => {
    const [priorEvent] = await tx.select().from(fpAccountingEvents).where(and(
      eq(fpAccountingEvents.tenantId, actor.tenantId), eq(fpAccountingEvents.operationId, body.data.operationId),
    )).limit(1);
    if (priorEvent) {
      if (priorEvent.actorUserId !== actor.userId || priorEvent.requestFingerprint !== requestFingerprint) {
        return { error: "La clave de operación ya se utilizó con otros datos.", status: 409 as const };
      }
      return { period: await ensurePeriod(tx, actor.tenantId, organizationId, params.data.fiscalYear, params.data.period) };
    }
    const period = await ensurePeriod(tx, actor.tenantId, organizationId, params.data.fiscalYear, params.data.period);
    if (!period || period.status !== "closed") return { error: "El periodo no está cerrado.", status: 409 as const };
    await tx.update(fpAccountingPeriods).set({
      status: "open",
      reopenedAt: new Date(),
      reopenedByUserId: actor.userId,
      closeReason: `${period.closeReason ?? ""} | Reapertura: ${reopenReason}`.trim(),
    }).where(eq(fpAccountingPeriods.id, period.id));
    await appendEvent(tx, actor, organizationId, body.data.operationId, requestFingerprint, "period_reopened", `Periodo reabierto: ${reopenReason}.`);
    return { period: { ...period, status: "open", reopenedAt: new Date(), closeReason: `${period.closeReason ?? ""} | Reapertura: ${reopenReason}`.trim() } };
  });
  if ("error" in result) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.json(ReopenFp360AccountingPeriodResponse.parse({
    id: result.period!.id,
    organizationId: result.period!.organizationId,
    fiscalYear: result.period!.fiscalYear,
    period: result.period!.period,
    status: result.period!.status,
    closedAt: isoDateTime(result.period!.closedAt),
    reopenedAt: isoDateTime(result.period!.reopenedAt),
    closeReason: result.period!.closeReason,
  }));
});

export default router;

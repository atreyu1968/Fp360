import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  ActOnFp360BankFinancingBody,
  ActOnFp360BankFinancingParams,
  ActOnFp360BankFinancingResponse,
  ActOnFp360BankTransferBody,
  ActOnFp360BankTransferParams,
  ActOnFp360BankTransferResponse,
  CreateFp360BankAccountBody,
  CreateFp360BankAccountResponse,
  CreateFp360BankEffectBody,
  CreateFp360BankEffectResponse,
  CreateFp360BankFinancingBody,
  CreateFp360BankFinancingResponse,
  CreateFp360BankSupplierPaymentBody,
  CreateFp360BankTransferBody,
  CreateFp360BankTransferResponse,
  GetFp360BankReconciliationQueryParams,
  GetFp360BankReconciliationResponse,
  GetFp360BankOverviewQueryParams,
  GetFp360BankOverviewResponse,
} from "@workspace/api-zod";
import {
  db,
  fpAccountingAccounts,
  fpAccountingEntries,
  fpAccountingEntryLines,
  fpBankAccounts,
  fpBankEffects,
  fpBankEvents,
  fpBankFinancing,
  fpBankInstallments,
  fpBankMovements,
  fpBankTransfers,
  fpInvoices,
  fpOrganizations,
  fpPayments,
  fpPurchaseInvoices,
  fpPurchaseOrders,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";
import { supplierPaymentEligibility, supplierPaymentReviewerError } from "./bank-supplier-payment.mjs";

const router: IRouter = Router();
router.use("/redfp360/bank", requireAuth, requireSimulationWriteAccess);
const SIMULATED_DATE = "2027-09-15";
const SCENARIO_OPENING_BALANCE_CENTS = 4_122_000;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class BankError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof BankError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 bank operation failed");
      next(error);
    });
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addMonths(value: string, months: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

async function resolveOrganization(actor: AuthContext, organizationId: string): Promise<string | null> {
  if (actor.organizationId && actor.organizationId !== organizationId) return null;
  if (!actor.organizationId && !["teacher", "administrator"].includes(actor.role)) return null;
  const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return organization?.id ?? null;
}

function canOperate(actor: AuthContext): boolean {
  return ["team_manager", "teacher", "administrator"].includes(actor.role);
}

function canApprove(actor: AuthContext): boolean {
  return ["teacher", "administrator"].includes(actor.role);
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  details: {
    organizationId: string | null;
    accountId?: string | null;
    transferId?: string | null;
    financingId?: string | null;
    operationId: string;
    requestFingerprint: string;
    eventType: string;
    description: string;
  },
) {
  await tx.insert(fpBankEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId: details.organizationId,
    accountId: details.accountId ?? null,
    transferId: details.transferId ?? null,
    financingId: details.financingId ?? null,
    operationId: details.operationId,
    requestFingerprint: details.requestFingerprint,
    eventType: details.eventType,
    description: details.description,
    actorUserId: actor.userId,
    actorName: actor.displayName,
  });
}

async function ensureClearingAccount(tx: Transaction, actor: AuthContext) {
  const id = `bank-clearing:${actor.tenantId}`;
  await tx.insert(fpBankAccounts).values({
    id,
    tenantId: actor.tenantId,
    organizationId: null,
    accountType: "clearing",
    name: "Cámara bancaria simulada",
    syntheticReference: `SIM-CLEAR-${createHash("sha256").update(actor.tenantId).digest("hex").slice(0, 10).toUpperCase()}`,
    balanceCents: 0,
    reservedCents: 0,
    status: "active",
    isPrimary: false,
    createdByUserId: actor.userId,
  }).onConflictDoNothing();
  const [account] = await tx.select().from(fpBankAccounts).where(and(
    eq(fpBankAccounts.id, id),
    eq(fpBankAccounts.tenantId, actor.tenantId),
  )).for("update").limit(1);
  if (!account) throw new BankError(500, "No se pudo preparar la cuenta interna de simulación.");
  return account;
}

async function ensureScenarioAccounts(actor: AuthContext) {
  await db.transaction(async (tx) => {
    const organizations = await tx.select({ id: fpOrganizations.id, name: fpOrganizations.name })
      .from(fpOrganizations)
      .where(and(eq(fpOrganizations.tenantId, actor.tenantId), eq(fpOrganizations.isActive, true)));
    const clearing = await ensureClearingAccount(tx, actor);
    let clearingBalance = clearing.balanceCents;

    for (const organization of organizations) {
      const accountId = `bank-primary:${actor.tenantId}:${organization.id}`;
      const accountReference = `SIM-${createHash("sha256").update(organization.id).digest("hex").slice(0, 12).toUpperCase()}`;
      const [created] = await tx.insert(fpBankAccounts).values({
        id: accountId,
        tenantId: actor.tenantId,
        organizationId: organization.id,
        accountType: "company",
        name: "Cuenta principal",
        syntheticReference: accountReference,
        balanceCents: SCENARIO_OPENING_BALANCE_CENTS,
        reservedCents: 0,
        status: "active",
        isPrimary: true,
        createdByUserId: actor.userId,
      }).onConflictDoNothing().returning();

      if (!created) continue;
      clearingBalance -= SCENARIO_OPENING_BALANCE_CENTS;
      await tx.insert(fpBankMovements).values([
        {
          id: randomUUID(), tenantId: actor.tenantId, accountId,
          counterpartyAccountId: clearing.id, direction: "credit",
          amountCents: SCENARIO_OPENING_BALANCE_CENTS, deltaCents: SCENARIO_OPENING_BALANCE_CENTS,
          balanceAfterCents: SCENARIO_OPENING_BALANCE_CENTS, reference: `AP-${organization.id.slice(0, 8).toUpperCase()}`,
          description: "Saldo inicial ficticio del escenario", operationId: `opening:${organization.id}`,
          simulatedDate: SIMULATED_DATE,
        },
        {
          id: randomUUID(), tenantId: actor.tenantId, accountId: clearing.id,
          counterpartyAccountId: accountId, direction: "debit",
          amountCents: SCENARIO_OPENING_BALANCE_CENTS, deltaCents: -SCENARIO_OPENING_BALANCE_CENTS,
          balanceAfterCents: clearingBalance, reference: `AP-${organization.id.slice(0, 8).toUpperCase()}`,
          description: `Saldo inicial ficticio de ${organization.name}`, operationId: `opening:${organization.id}`,
          simulatedDate: SIMULATED_DATE,
        },
      ]).onConflictDoNothing();
      await appendEvent(tx, actor, {
        organizationId: organization.id,
        accountId,
        operationId: `opening:${organization.id}`,
        requestFingerprint: fingerprint({ type: "scenario_opening", organizationId: organization.id }),
        eventType: "scenario_opening",
        description: "Cuenta principal creada con saldo inicial ficticio de 41.220,00 €.",
      });
    }

    await tx.update(fpBankAccounts).set({ balanceCents: clearingBalance }).where(and(
      eq(fpBankAccounts.id, clearing.id),
      eq(fpBankAccounts.tenantId, actor.tenantId),
    ));
  });
}

async function loadBankAccount(accountId: string, tenantId: string) {
  const [account] = await db.select().from(fpBankAccounts).where(and(
    eq(fpBankAccounts.id, accountId),
    eq(fpBankAccounts.tenantId, tenantId),
  )).limit(1);
  if (!account) return null;
  return {
    id: account.id,
    organizationId: account.organizationId,
    accountType: account.accountType,
    name: account.name,
    syntheticReference: account.syntheticReference,
    balanceCents: account.balanceCents,
    reservedCents: account.reservedCents,
    availableCents: account.balanceCents - account.reservedCents,
    status: account.status,
    isPrimary: account.isPrimary,
    createdAt: account.createdAt.toISOString(),
  };
}

async function loadTransfer(transferId: string, tenantId: string) {
  const [transfer] = await db.select().from(fpBankTransfers).where(and(
    eq(fpBankTransfers.id, transferId),
    eq(fpBankTransfers.tenantId, tenantId),
  )).limit(1);
  if (!transfer) return null;
  const accountIds = [transfer.sourceAccountId, transfer.beneficiaryAccountId];
  const accounts = await db.select().from(fpBankAccounts).where(and(
    eq(fpBankAccounts.tenantId, tenantId),
    inArray(fpBankAccounts.id, accountIds),
  ));
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const source = byId.get(transfer.sourceAccountId);
  const beneficiary = byId.get(transfer.beneficiaryAccountId);
  const [beneficiaryOrganization] = beneficiary?.organizationId
    ? await db.select({ name: fpOrganizations.name }).from(fpOrganizations).where(eq(fpOrganizations.id, beneficiary.organizationId)).limit(1)
    : [];
  return {
    id: transfer.id,
    organizationId: transfer.organizationId,
    purchaseInvoiceId: transfer.purchaseInvoiceId,
    sourceAccountId: transfer.sourceAccountId,
    beneficiaryAccountId: transfer.beneficiaryAccountId,
    sourceReference: source?.syntheticReference ?? "Cuenta no disponible",
    beneficiaryReference: beneficiary?.syntheticReference ?? "Cuenta no disponible",
    beneficiaryName: beneficiaryOrganization?.name ?? "Beneficiario",
    amountCents: transfer.amountCents,
    concept: transfer.concept,
    scheduledDate: transfer.scheduledDate,
    status: transfer.status,
    operationId: transfer.operationId,
    createdByName: transfer.createdByName,
    executedAt: transfer.executedAt?.toISOString() ?? null,
    createdAt: transfer.createdAt.toISOString(),
  };
}

async function loadEffect(effectId: string, tenantId: string) {
  const [effect] = await db.select().from(fpBankEffects).where(and(
    eq(fpBankEffects.id, effectId),
    eq(fpBankEffects.tenantId, tenantId),
  )).limit(1);
  if (!effect) return null;
  const [invoice] = await db.select().from(fpInvoices).where(and(
    eq(fpInvoices.id, effect.invoiceId),
    eq(fpInvoices.tenantId, tenantId),
  )).limit(1);
  const payments = await db.select({ amountCents: fpPayments.amountCents }).from(fpPayments).where(and(
    eq(fpPayments.tenantId, tenantId),
    eq(fpPayments.invoiceId, effect.invoiceId),
  ));
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return {
    id: effect.id,
    organizationId: effect.organizationId,
    invoiceId: effect.invoiceId,
    invoiceReference: invoice?.reference ?? "Factura no disponible",
    invoiceBalanceCents: Math.max(0, (invoice?.totalCents ?? 0) - paidCents),
    reference: effect.reference,
    nominalCents: effect.nominalCents,
    maturityDate: effect.maturityDate,
    status: effect.status,
    createdByName: effect.createdByName,
    createdAt: effect.createdAt.toISOString(),
  };
}

function loanQuote(principalCents: number, annualRateBps: number, termMonths: number) {
  const monthlyRate = annualRateBps / 10_000 / 12;
  const installmentCents = monthlyRate === 0
    ? Math.round(principalCents / termMonths)
    : Math.round(principalCents * monthlyRate / (1 - (1 + monthlyRate) ** -termMonths));
  let remaining = principalCents;
  let totalInterestCents = 0;
  const schedule = Array.from({ length: termMonths }, (_, index) => {
    const interestCents = Math.round(remaining * monthlyRate);
    const principal = index === termMonths - 1
      ? remaining
      : Math.min(remaining, installmentCents - interestCents);
    const totalCents = principal + interestCents;
    remaining -= principal;
    totalInterestCents += interestCents;
    return {
      installmentNumber: index + 1,
      dueDate: addMonths(SIMULATED_DATE, index + 1),
      principalCents: principal,
      interestCents,
      totalCents,
    };
  });
  return { installmentCents, totalInterestCents, schedule };
}

function financingQuote(
  productType: string,
  amountCents: number,
  annualRateBps: number,
  commissionBps: number,
  termMonths: number,
  maturityDate: string | null,
) {
  const commissionCents = Math.round(amountCents * commissionBps / 10_000);
  if (productType === "loan") {
    const loan = loanQuote(amountCents, annualRateBps, termMonths);
    return {
      installmentCents: loan.installmentCents,
      totalInterestCents: loan.totalInterestCents,
      totalCostCents: loan.totalInterestCents + commissionCents,
      netDisbursementCents: amountCents - commissionCents,
      creditLimitCents: null,
      schedule: loan.schedule,
    };
  }
  if (productType === "credit_line") {
    const estimatedInterestCents = Math.round(amountCents * 0.5 * annualRateBps / 10_000);
    return {
      installmentCents: null,
      totalInterestCents: estimatedInterestCents,
      totalCostCents: estimatedInterestCents + commissionCents,
      netDisbursementCents: 0,
      creditLimitCents: amountCents,
      schedule: [],
    };
  }
  const start = new Date(`${SIMULATED_DATE}T00:00:00.000Z`);
  const maturity = new Date(`${maturityDate ?? SIMULATED_DATE}T00:00:00.000Z`);
  const days = Math.max(1, Math.ceil((maturity.getTime() - start.getTime()) / 86_400_000));
  const interestCents = Math.round(amountCents * annualRateBps / 10_000 * days / 365);
  const totalCostCents = interestCents + commissionCents;
  return {
    installmentCents: null,
    totalInterestCents: interestCents,
    totalCostCents,
    netDisbursementCents: Math.max(0, amountCents - totalCostCents),
    creditLimitCents: null,
    schedule: [],
  };
}

async function loadFinancing(financingId: string, tenantId: string) {
  const [financing] = await db.select().from(fpBankFinancing).where(and(
    eq(fpBankFinancing.id, financingId),
    eq(fpBankFinancing.tenantId, tenantId),
  )).limit(1);
  if (!financing) return null;
  const [effect] = financing.effectId
    ? await db.select({ reference: fpBankEffects.reference }).from(fpBankEffects).where(and(
        eq(fpBankEffects.id, financing.effectId),
        eq(fpBankEffects.tenantId, tenantId),
      )).limit(1)
    : [];
  return {
    id: financing.id,
    organizationId: financing.organizationId,
    accountId: financing.accountId,
    productType: financing.productType,
    effectId: financing.effectId,
    effectReference: effect?.reference ?? null,
    requestedAmountCents: financing.requestedAmountCents,
    offeredAmountCents: financing.offeredAmountCents,
    termMonths: financing.termMonths,
    annualRateBps: financing.annualRateBps,
    commissionBps: financing.commissionBps,
    installmentCents: financing.installmentCents,
    totalInterestCents: financing.totalInterestCents,
    totalCostCents: financing.totalCostCents,
    netDisbursementCents: financing.netDisbursementCents,
    creditLimitCents: financing.creditLimitCents,
    drawnCents: financing.drawnCents,
    maturityDate: financing.maturityDate,
    status: financing.status,
    decisionReason: financing.decisionReason,
    createdByName: financing.createdByName,
    offeredByName: financing.offeredByName,
    acceptedAt: financing.acceptedAt?.toISOString() ?? null,
    closedAt: financing.closedAt?.toISOString() ?? null,
    createdAt: financing.createdAt.toISOString(),
  };
}

async function loadOverview(tenantId: string, organizationId: string) {
  const accounts = await db.select().from(fpBankAccounts).where(and(
    eq(fpBankAccounts.tenantId, tenantId),
    eq(fpBankAccounts.organizationId, organizationId),
    eq(fpBankAccounts.accountType, "company"),
  )).orderBy(desc(fpBankAccounts.isPrimary), asc(fpBankAccounts.createdAt));
  const accountIds = accounts.map((account) => account.id);
  const allCompanyAccounts = await db.select({
    id: fpBankAccounts.id,
    organizationId: fpBankAccounts.organizationId,
    name: fpBankAccounts.name,
    syntheticReference: fpBankAccounts.syntheticReference,
  }).from(fpBankAccounts).where(and(
    eq(fpBankAccounts.tenantId, tenantId),
    eq(fpBankAccounts.accountType, "company"),
    eq(fpBankAccounts.status, "active"),
  ));
  const orgs = await db.select({ id: fpOrganizations.id, name: fpOrganizations.name, center: fpOrganizations.center })
    .from(fpOrganizations).where(eq(fpOrganizations.tenantId, tenantId));
  const orgById = new Map(orgs.map((organization) => [organization.id, organization]));
  const companyAccountById = new Map(allCompanyAccounts.map((account) => [account.id, account]));
  const beneficiaries = allCompanyAccounts.flatMap((account) => {
    const organization = account.organizationId ? orgById.get(account.organizationId) : null;
    if (!organization) return [];
    return [{
      organizationId: organization.id,
      organizationName: organization.name,
      center: organization.center,
      accountId: account.id,
      accountName: account.name,
      syntheticReference: account.syntheticReference,
    }];
  });
  const [transferRows, effectRows, financingRows, eventRows] = await Promise.all([
    accountIds.length ? db.select().from(fpBankTransfers).where(and(
      eq(fpBankTransfers.tenantId, tenantId),
      or(
        eq(fpBankTransfers.organizationId, organizationId),
        inArray(fpBankTransfers.beneficiaryAccountId, accountIds),
      ),
    )).orderBy(desc(fpBankTransfers.createdAt)).limit(100) : db.select().from(fpBankTransfers).where(and(
      eq(fpBankTransfers.tenantId, tenantId), eq(fpBankTransfers.organizationId, organizationId),
    )).orderBy(desc(fpBankTransfers.createdAt)).limit(100),
    db.select().from(fpBankEffects).where(and(
      eq(fpBankEffects.tenantId, tenantId), eq(fpBankEffects.organizationId, organizationId),
    )).orderBy(desc(fpBankEffects.createdAt)).limit(100),
    db.select().from(fpBankFinancing).where(and(
      eq(fpBankFinancing.tenantId, tenantId), eq(fpBankFinancing.organizationId, organizationId),
    )).orderBy(desc(fpBankFinancing.createdAt)).limit(100),
    db.select().from(fpBankEvents).where(and(
      eq(fpBankEvents.tenantId, tenantId), eq(fpBankEvents.organizationId, organizationId),
    )).orderBy(desc(fpBankEvents.createdAt)).limit(100),
  ]);
  const movementRows = accountIds.length ? await db.select().from(fpBankMovements).where(and(
    eq(fpBankMovements.tenantId, tenantId),
    inArray(fpBankMovements.accountId, accountIds),
  )).orderBy(desc(fpBankMovements.createdAt)).limit(150) : [];
  const transfers = await Promise.all(transferRows.map(async (transfer) => {
    const source = companyAccountById.get(transfer.sourceAccountId);
    const beneficiary = companyAccountById.get(transfer.beneficiaryAccountId);
    const beneficiaryOrganization = beneficiary?.organizationId ? orgById.get(beneficiary.organizationId) : null;
    return {
      id: transfer.id,
      organizationId: transfer.organizationId,
      purchaseInvoiceId: transfer.purchaseInvoiceId,
      sourceAccountId: transfer.sourceAccountId,
      beneficiaryAccountId: transfer.beneficiaryAccountId,
      sourceReference: source?.syntheticReference ?? "Cuenta no disponible",
      beneficiaryReference: beneficiary?.syntheticReference ?? "Cuenta no disponible",
      beneficiaryName: beneficiaryOrganization?.name ?? "Beneficiario",
      amountCents: transfer.amountCents,
      concept: transfer.concept,
      scheduledDate: transfer.scheduledDate,
      status: transfer.status,
      operationId: transfer.operationId,
      createdByName: transfer.createdByName,
      executedAt: transfer.executedAt?.toISOString() ?? null,
      createdAt: transfer.createdAt.toISOString(),
    };
  }));
  const movementAccountIds = [...new Set(movementRows.flatMap((movement) => [
    movement.accountId,
    ...(movement.counterpartyAccountId ? [movement.counterpartyAccountId] : []),
  ]))];
  const movementAccounts = movementAccountIds.length ? await db.select({
    id: fpBankAccounts.id, name: fpBankAccounts.name, syntheticReference: fpBankAccounts.syntheticReference,
    organizationId: fpBankAccounts.organizationId,
  }).from(fpBankAccounts).where(and(eq(fpBankAccounts.tenantId, tenantId), inArray(fpBankAccounts.id, movementAccountIds))) : [];
  const movementAccountById = new Map(movementAccounts.map((account) => [account.id, account]));
  const movements = movementRows.map((movement) => ({
    id: movement.id,
    accountId: movement.accountId,
    counterpartyAccountId: movement.counterpartyAccountId,
    transferId: movement.transferId,
    financingId: movement.financingId,
    accountName: movementAccountById.get(movement.accountId)?.name ?? "Cuenta",
    counterpartyName: movement.counterpartyAccountId
      ? movementAccountById.get(movement.counterpartyAccountId)?.name ?? "Contraparte"
      : "Contraparte externa simulada",
    direction: movement.direction,
    amountCents: movement.amountCents,
    deltaCents: movement.deltaCents,
    balanceAfterCents: movement.balanceAfterCents,
    reference: movement.reference,
    description: movement.description,
    simulatedDate: movement.simulatedDate,
    createdAt: movement.createdAt.toISOString(),
  }));
  const effects = await Promise.all(effectRows.map((effect) => loadEffect(effect.id, tenantId)));
  const financing = await Promise.all(financingRows.map((item) => loadFinancing(item.id, tenantId)));
  const financingIds = financingRows.map((item) => item.id);
  const installments = financingIds.length ? await db.select().from(fpBankInstallments).where(and(
    eq(fpBankInstallments.tenantId, tenantId), inArray(fpBankInstallments.financingId, financingIds),
  )).orderBy(asc(fpBankInstallments.dueDate), asc(fpBankInstallments.installmentNumber)) : [];
  const summaryAccounts = accounts.reduce((sum, account) => ({
    balance: sum.balance + account.balanceCents,
    reserved: sum.reserved + account.reservedCents,
  }), { balance: 0, reserved: 0 });
  const currentMonth = SIMULATED_DATE.slice(0, 7);
  const thisMonthMovements = movementRows.filter((movement) => movement.simulatedDate.startsWith(currentMonth));
  const pendingTransferCount = transferRows.filter((transfer) => ["draft", "pending_review", "authorized", "scheduled"].includes(transfer.status)).length;
  const pendingFinancingCount = financingRows.filter((item) => ["pending_review", "offered"].includes(item.status)).length;
  const overdueInstallmentCount = installments.filter((item) => item.status === "pending" && item.dueDate < SIMULATED_DATE).length;
  const riskLevel = overdueInstallmentCount > 0 ? "elevated" : pendingTransferCount + pendingFinancingCount > 0 ? "review" : "low";

  return {
    organizationId,
    accounts: await Promise.all(accounts.map((account) => loadBankAccount(account.id, tenantId))),
    beneficiaries,
    transfers,
    movements,
    effects: effects.filter((item): item is NonNullable<typeof item> => Boolean(item)),
    financing: financing.filter((item): item is NonNullable<typeof item> => Boolean(item)),
    installments: installments.map((item) => ({
      id: item.id,
      financingId: item.financingId,
      installmentNumber: item.installmentNumber,
      dueDate: item.dueDate,
      principalCents: item.principalCents,
      interestCents: item.interestCents,
      totalCents: item.totalCents,
      status: item.status,
      paidAt: item.paidAt?.toISOString() ?? null,
    })),
    events: eventRows.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      description: event.description,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
    summary: {
      accountBalanceCents: summaryAccounts.balance,
      reservedCents: summaryAccounts.reserved,
      availableCents: summaryAccounts.balance - summaryAccounts.reserved,
      monthlyInflowCents: thisMonthMovements.reduce((sum, movement) => sum + Math.max(0, movement.deltaCents), 0),
      monthlyOutflowCents: thisMonthMovements.reduce((sum, movement) => sum + Math.max(0, -movement.deltaCents), 0),
      pendingTransferCount,
      pendingFinancingCount,
      overdueInstallmentCount,
      riskLevel,
    },
  };
}

async function recordPair(
  tx: Transaction,
  args: {
    actor: AuthContext;
    firstAccountId: string;
    secondAccountId: string;
    firstDeltaCents: number;
    firstDirection: "debit" | "credit";
    amountCents: number;
    transferId?: string | null;
    financingId?: string | null;
    reference: string;
    description: string;
    operationId: string;
  },
) {
  const rows = await tx.select().from(fpBankAccounts).where(and(
    eq(fpBankAccounts.tenantId, args.actor.tenantId),
    inArray(fpBankAccounts.id, [args.firstAccountId, args.secondAccountId]),
  )).orderBy(asc(fpBankAccounts.id)).for("update");
  const byId = new Map(rows.map((account) => [account.id, account]));
  const first = byId.get(args.firstAccountId);
  const second = byId.get(args.secondAccountId);
  if (!first || !second || first.id === second.id) throw new BankError(404, "No se encontraron las cuentas de la operación.");
  const firstBalance = first.balanceCents + args.firstDeltaCents;
  const secondDeltaCents = -args.firstDeltaCents;
  const secondBalance = second.balanceCents + secondDeltaCents;
  if (first.accountType === "company" && firstBalance < 0) throw new BankError(409, "La cuenta no dispone de saldo suficiente.");
  if (second.accountType === "company" && secondBalance < 0) throw new BankError(409, "La cuenta beneficiaria quedaría con saldo negativo.");
  await tx.update(fpBankAccounts).set({ balanceCents: firstBalance }).where(eq(fpBankAccounts.id, first.id));
  await tx.update(fpBankAccounts).set({ balanceCents: secondBalance }).where(eq(fpBankAccounts.id, second.id));
  const date = SIMULATED_DATE;
  const reference = args.reference;
  await tx.insert(fpBankMovements).values([
    {
      id: randomUUID(), tenantId: args.actor.tenantId, accountId: first.id,
      counterpartyAccountId: second.id, transferId: args.transferId ?? null,
      financingId: args.financingId ?? null, direction: args.firstDirection,
      amountCents: args.amountCents, deltaCents: args.firstDeltaCents,
      balanceAfterCents: firstBalance, reference, description: args.description,
      operationId: args.operationId, simulatedDate: date,
    },
    {
      id: randomUUID(), tenantId: args.actor.tenantId, accountId: second.id,
      counterpartyAccountId: first.id, transferId: args.transferId ?? null,
      financingId: args.financingId ?? null,
      direction: args.firstDirection === "debit" ? "credit" : "debit",
      amountCents: args.amountCents, deltaCents: secondDeltaCents,
      balanceAfterCents: secondBalance, reference, description: args.description,
      operationId: args.operationId, simulatedDate: date,
    },
  ]);
}

router.get("/redfp360/bank/overview", route(async (req, res) => {
  const actor = req.auth!;
  const query = GetFp360BankOverviewQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, query.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "La empresa solicitada no está disponible para este perfil." });
    return;
  }
  await ensureScenarioAccounts(actor);
  res.json(GetFp360BankOverviewResponse.parse(await loadOverview(actor.tenantId, organizationId)));
}));

router.get("/redfp360/bank/reconciliation", route(async (req, res) => {
  const actor = req.auth!;
  const query = GetFp360BankReconciliationQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const { fromDate, toDate } = query.data;
  const rangeDays = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000;
  if (fromDate > toDate || rangeDays > 366) {
    res.status(400).json({ error: "El intervalo debe estar ordenado y no superar 366 días." });
    return;
  }
  const organizationId = await resolveOrganization(actor, query.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "La empresa solicitada no está disponible para este perfil." });
    return;
  }
  const companyAccounts = await db.select({
    id: fpBankAccounts.id,
    name: fpBankAccounts.name,
  }).from(fpBankAccounts).where(and(
    eq(fpBankAccounts.tenantId, actor.tenantId),
    eq(fpBankAccounts.organizationId, organizationId),
    eq(fpBankAccounts.accountType, "company"),
  ));
  const accountIds = companyAccounts.map((account) => account.id);
  const [movements, ledgerLines] = await Promise.all([
    accountIds.length ? db.select().from(fpBankMovements).where(and(
      eq(fpBankMovements.tenantId, actor.tenantId),
      inArray(fpBankMovements.accountId, accountIds),
      gte(fpBankMovements.simulatedDate, fromDate),
      lte(fpBankMovements.simulatedDate, toDate),
    )).orderBy(asc(fpBankMovements.simulatedDate), asc(fpBankMovements.createdAt)) : [],
    db.select({
      entryId: fpAccountingEntries.id,
      entryNumber: fpAccountingEntries.entryNumber,
      entryDate: fpAccountingEntries.entryDate,
      concept: fpAccountingEntries.concept,
      status: fpAccountingEntries.status,
      sourceReference: fpAccountingEntries.sourceReference,
      lineNumber: fpAccountingEntryLines.lineNumber,
      accountCode: fpAccountingAccounts.code,
      accountName: fpAccountingAccounts.name,
      description: fpAccountingEntryLines.description,
      debitCents: fpAccountingEntryLines.debitCents,
      creditCents: fpAccountingEntryLines.creditCents,
    }).from(fpAccountingEntryLines)
      .innerJoin(fpAccountingEntries, eq(fpAccountingEntryLines.entryId, fpAccountingEntries.id))
      .innerJoin(fpAccountingAccounts, eq(fpAccountingEntryLines.accountId, fpAccountingAccounts.id))
      .where(and(
        eq(fpAccountingEntryLines.tenantId, actor.tenantId),
        eq(fpAccountingEntries.tenantId, actor.tenantId),
        eq(fpAccountingEntries.organizationId, organizationId),
        eq(fpAccountingAccounts.tenantId, actor.tenantId),
        eq(fpAccountingAccounts.organizationId, organizationId),
        like(fpAccountingAccounts.code, "572%"),
        or(eq(fpAccountingEntries.status, "posted"), eq(fpAccountingEntries.status, "reversed")),
        gte(fpAccountingEntries.entryDate, fromDate),
        lte(fpAccountingEntries.entryDate, toDate),
      )).orderBy(asc(fpAccountingEntries.entryDate), asc(fpAccountingEntries.entryNumber), asc(fpAccountingEntryLines.lineNumber)),
  ]);
  const accountNames = new Map(companyAccounts.map((account) => [account.id, account.name]));
  res.json(GetFp360BankReconciliationResponse.parse({
    organizationId,
    fromDate,
    toDate,
    statementLines: movements.map((movement) => ({
      id: movement.id,
      date: movement.simulatedDate,
      accountName: accountNames.get(movement.accountId) ?? "Cuenta",
      direction: movement.direction,
      amountCents: movement.amountCents,
      signedAmountCents: movement.deltaCents,
      reference: movement.reference,
      description: movement.description,
    })),
    ledgerLines: ledgerLines.map((line) => ({
      ...line,
      status: line.status as "posted" | "reversed",
      signedAmountCents: line.debitCents - line.creditCents,
    })),
  }));
}));

router.post("/redfp360/bank/accounts", route(async (req, res) => {
  const actor = req.auth!;
  const body = CreateFp360BankAccountBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "La empresa solicitada no está disponible para este perfil." });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const existing = await db.select().from(fpBankEvents).where(and(
    eq(fpBankEvents.tenantId, actor.tenantId),
    eq(fpBankEvents.operationId, body.data.operationId),
  )).limit(1);
  if (existing[0]) {
    if (existing[0].actorUserId !== actor.userId ||
        existing[0].requestFingerprint !== requestFingerprint ||
        !existing[0].accountId) {
      res.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const account = await loadBankAccount(existing[0].accountId, actor.tenantId);
    if (!account) {
      res.status(409).json({ error: "La operación anterior no tiene una cuenta disponible." });
      return;
    }
    res.json(CreateFp360BankAccountResponse.parse(account));
    return;
  }
  const accountId = randomUUID();
  const reference = `SIM-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
  await db.transaction(async (tx) => {
    const clearing = await ensureClearingAccount(tx, actor);
    await tx.insert(fpBankAccounts).values({
      id: accountId,
      tenantId: actor.tenantId,
      organizationId,
      accountType: "company",
      name: body.data.name.trim(),
      syntheticReference: reference,
      balanceCents: body.data.initialBalanceCents,
      reservedCents: 0,
      status: "active",
      isPrimary: false,
      createdByUserId: actor.userId,
    });
    if (body.data.initialBalanceCents > 0) {
      const clearingBalance = clearing.balanceCents - body.data.initialBalanceCents;
      await tx.update(fpBankAccounts).set({ balanceCents: clearingBalance }).where(eq(fpBankAccounts.id, clearing.id));
      await tx.insert(fpBankMovements).values([
        {
          id: randomUUID(), tenantId: actor.tenantId, accountId,
          counterpartyAccountId: clearing.id, direction: "credit",
          amountCents: body.data.initialBalanceCents, deltaCents: body.data.initialBalanceCents,
          balanceAfterCents: body.data.initialBalanceCents, reference: "SALDO-SIMULADO",
          description: "Saldo inicial de cuenta simulada", operationId: body.data.operationId,
          simulatedDate: SIMULATED_DATE,
        },
        {
          id: randomUUID(), tenantId: actor.tenantId, accountId: clearing.id,
          counterpartyAccountId: accountId, direction: "debit",
          amountCents: body.data.initialBalanceCents, deltaCents: -body.data.initialBalanceCents,
          balanceAfterCents: clearingBalance, reference: "SALDO-SIMULADO",
          description: `Saldo inicial ficticio de ${body.data.name.trim()}`, operationId: body.data.operationId,
          simulatedDate: SIMULATED_DATE,
        },
      ]);
    }
    await appendEvent(tx, actor, {
      organizationId,
      accountId,
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: "account_opened",
      description: `Cuenta sintética ${reference} creada con saldo inicial simulado.`,
    });
  });
  const account = await loadBankAccount(accountId, actor.tenantId);
  if (!account) {
    res.status(500).json({ error: "No se pudo cargar la cuenta creada." });
    return;
  }
  res.status(201).json(CreateFp360BankAccountResponse.parse(account));
}));

router.post("/redfp360/bank/transfers", route(async (req, res) => {
  const actor = req.auth!;
  const body = CreateFp360BankTransferBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "La empresa solicitada no está disponible para este perfil." });
    return;
  }
  if (body.data.scheduledDate && (!validDate(body.data.scheduledDate) || body.data.scheduledDate < SIMULATED_DATE)) {
    res.status(400).json({ error: `La fecha debe ser válida y no anterior a la fecha simulada ${SIMULATED_DATE}.` });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const [existing] = await db.select().from(fpBankTransfers).where(and(
    eq(fpBankTransfers.tenantId, actor.tenantId),
    eq(fpBankTransfers.operationId, body.data.operationId),
  )).limit(1);
  if (existing) {
    if (existing.createdByUserId !== actor.userId || existing.requestFingerprint !== requestFingerprint) {
      res.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const transfer = await loadTransfer(existing.id, actor.tenantId);
    if (!transfer) {
      res.status(409).json({ error: "La transferencia anterior ya no está disponible." });
      return;
    }
    res.json(CreateFp360BankTransferResponse.parse(transfer));
    return;
  }
  const accounts = await db.select().from(fpBankAccounts).where(and(
    eq(fpBankAccounts.tenantId, actor.tenantId),
    inArray(fpBankAccounts.id, [body.data.sourceAccountId, body.data.beneficiaryAccountId]),
  ));
  const source = accounts.find((account) => account.id === body.data.sourceAccountId);
  const beneficiary = accounts.find((account) => account.id === body.data.beneficiaryAccountId);
  if (!source || !beneficiary || source.accountType !== "company" || beneficiary.accountType !== "company"
    || source.organizationId !== organizationId || source.status !== "active" || beneficiary.status !== "active"
    || source.id === beneficiary.id) {
    res.status(400).json({ error: "Selecciona una cuenta propia y un beneficiario activo de la red." });
    return;
  }
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(fpBankTransfers).values({
      id,
      tenantId: actor.tenantId,
      organizationId,
      sourceAccountId: source.id,
      beneficiaryAccountId: beneficiary.id,
      amountCents: body.data.amountCents,
      concept: body.data.concept.trim(),
      scheduledDate: body.data.scheduledDate,
      status: "draft",
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    });
    await appendEvent(tx, actor, {
      organizationId,
      transferId: id,
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: "transfer_created",
      description: "Borrador de transferencia simulada creado.",
    });
  });
  const transfer = await loadTransfer(id, actor.tenantId);
  if (!transfer) {
    res.status(500).json({ error: "No se pudo cargar la transferencia creada." });
    return;
  }
  res.status(201).json(CreateFp360BankTransferResponse.parse(transfer));
}));

router.post("/redfp360/bank/supplier-payments", route(async (req, res) => {
  const actor = req.auth!;
  const body = CreateFp360BankSupplierPaymentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  if (!["team_manager", "teacher", "administrator"].includes(actor.role)) {
    res.status(403).json({ error: "Tu perfil no puede preparar pagos simulados a proveedores." });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "La empresa solicitada no está disponible para este perfil." });
    return;
  }

  const requestFingerprint = fingerprint(body.data);
  await ensureScenarioAccounts(actor);
  const result = await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(fpPurchaseInvoices).where(and(
      eq(fpPurchaseInvoices.id, body.data.invoiceId),
      eq(fpPurchaseInvoices.tenantId, actor.tenantId),
    )).for("update").limit(1);
    const [order] = invoice ? await tx.select().from(fpPurchaseOrders).where(and(
      eq(fpPurchaseOrders.id, invoice.orderId),
      eq(fpPurchaseOrders.tenantId, actor.tenantId),
    )).limit(1) : [];
    const resourceError = supplierPaymentEligibility({ invoice, order, organizationId });
    if (resourceError?.status === 404) throw new BankError(resourceError.status, resourceError.message);

    const [existingOperation] = await tx.select().from(fpBankTransfers).where(and(
      eq(fpBankTransfers.tenantId, actor.tenantId),
      eq(fpBankTransfers.operationId, body.data.operationId),
    )).limit(1);
    if (existingOperation) {
      if (existingOperation.createdByUserId !== actor.userId
        || existingOperation.requestFingerprint !== requestFingerprint
        || existingOperation.purchaseInvoiceId !== invoice.id) {
        throw new BankError(409, "El identificador de operación ya se utilizó con otros datos.");
      }
      return { id: existingOperation.id, replayed: true };
    }

    const [existingPayment] = await tx.select({ id: fpBankTransfers.id }).from(fpBankTransfers).where(and(
      eq(fpBankTransfers.tenantId, actor.tenantId),
      eq(fpBankTransfers.purchaseInvoiceId, invoice.id),
    )).limit(1);
    const eligibilityError = supplierPaymentEligibility({
      invoice, order, organizationId, alreadyHasPayment: Boolean(existingPayment),
    });
    if (eligibilityError) throw new BankError(eligibilityError.status, eligibilityError.message);

    const [source] = await tx.select().from(fpBankAccounts).where(and(
      eq(fpBankAccounts.id, body.data.sourceAccountId),
      eq(fpBankAccounts.tenantId, actor.tenantId),
      eq(fpBankAccounts.organizationId, organizationId),
      eq(fpBankAccounts.accountType, "company"),
      eq(fpBankAccounts.status, "active"),
    )).for("update").limit(1);
    const [beneficiary] = await tx.select().from(fpBankAccounts).where(and(
      eq(fpBankAccounts.tenantId, actor.tenantId),
      eq(fpBankAccounts.organizationId, invoice.supplierOrganizationId),
      eq(fpBankAccounts.accountType, "company"),
      eq(fpBankAccounts.status, "active"),
    )).orderBy(desc(fpBankAccounts.isPrimary), asc(fpBankAccounts.createdAt)).limit(1);
    if (!source || !beneficiary || source.id === beneficiary.id) {
      throw new BankError(409, "No hay cuentas sintéticas activas para la empresa compradora y su proveedor.");
    }

    const id = randomUUID();
    await tx.insert(fpBankTransfers).values({
      id,
      tenantId: actor.tenantId,
      organizationId,
      purchaseInvoiceId: invoice.id,
      sourceAccountId: source.id,
      beneficiaryAccountId: beneficiary.id,
      amountCents: invoice.totalCents,
      concept: `Pago simulado · Factura ${invoice.invoiceReference}`,
      scheduledDate: null,
      status: "draft",
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    });
    await appendEvent(tx, actor, {
      organizationId,
      transferId: id,
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: "supplier_payment_created",
      description: `Instrucción didáctica para la factura ${invoice.invoiceReference}; pendiente de revisión. No se inicia ningún pago bancario real.`,
    });
    return { id, replayed: false };
  });

  const transfer = await loadTransfer(result.id, actor.tenantId);
  if (!transfer) {
    res.status(500).json({ error: "No se pudo cargar la instrucción de pago creada." });
    return;
  }
  res.status(result.replayed ? 200 : 201).json(CreateFp360BankTransferResponse.parse(transfer));
}));

router.post("/redfp360/bank/transfers/:id/action", route(async (req, res) => {
  const actor = req.auth!;
  const params = ActOnFp360BankTransferParams.safeParse(req.params);
  const body = ActOnFp360BankTransferBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message ?? "Solicitud no válida." });
    return;
  }
  const requestFingerprint = fingerprint({ transferId: params.data.id, ...body.data });
  const [transfer] = await db.select().from(fpBankTransfers).where(and(
    eq(fpBankTransfers.id, params.data.id),
    eq(fpBankTransfers.tenantId, actor.tenantId),
  )).limit(1);
  if (!transfer || (actor.organizationId && actor.organizationId !== transfer.organizationId)
    || (!actor.organizationId && !["teacher", "administrator"].includes(actor.role))) {
    res.status(404).json({ error: "Transferencia no encontrada para esta empresa." });
    return;
  }
  const [existingEvent] = await db.select().from(fpBankEvents).where(and(
    eq(fpBankEvents.tenantId, actor.tenantId),
    eq(fpBankEvents.operationId, body.data.operationId),
  )).limit(1);
  if (existingEvent) {
    if (existingEvent.actorUserId !== actor.userId ||
        existingEvent.requestFingerprint !== requestFingerprint ||
        existingEvent.transferId !== params.data.id) {
      res.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const transfer = await loadTransfer(params.data.id, actor.tenantId);
    if (transfer) {
      res.json(ActOnFp360BankTransferResponse.parse(transfer));
      return;
    }
  }
  if (["authorize", "execute", "reject"].includes(body.data.action) && !canOperate(actor)) {
    res.status(403).json({ error: "Tu perfil no puede autorizar ni ejecutar transferencias." });
    return;
  }
  const reviewerError = body.data.action === "authorize"
    ? supplierPaymentReviewerError(transfer, actor)
    : null;
  if (reviewerError) {
    res.status(403).json({ error: reviewerError });
    return;
  }
  await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(fpBankTransfers).where(and(
      eq(fpBankTransfers.id, transfer.id), eq(fpBankTransfers.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!locked) throw new BankError(404, "Transferencia no encontrada.");
    if (locked.purchaseInvoiceId && ["validate", "authorize", "execute"].includes(body.data.action)) {
      const [invoice] = await tx.select().from(fpPurchaseInvoices).where(and(
        eq(fpPurchaseInvoices.id, locked.purchaseInvoiceId),
        eq(fpPurchaseInvoices.tenantId, actor.tenantId),
      )).for("update").limit(1);
      const [order] = invoice ? await tx.select().from(fpPurchaseOrders).where(and(
        eq(fpPurchaseOrders.id, invoice.orderId),
        eq(fpPurchaseOrders.tenantId, actor.tenantId),
      )).limit(1) : [];
      if (!invoice || !order || order.buyerOrganizationId !== locked.organizationId
        || order.supplierOrganizationId !== invoice.supplierOrganizationId
        || invoice.status !== "conformed") {
        throw new BankError(409, "La factura vinculada ya no está conformada y vigente.");
      }
    }
    const eventFingerprint = requestFingerprint;
    let nextStatus = locked.status;

    if (body.data.action === "validate") {
      if (locked.status !== "draft") throw new BankError(409, "Solo se pueden validar transferencias en borrador.");
      const [source] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, locked.sourceAccountId), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).for("update").limit(1);
      const [beneficiary] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, locked.beneficiaryAccountId), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).limit(1);
      if (!source || !beneficiary || source.status !== "active" || beneficiary.status !== "active") {
        throw new BankError(409, "Las cuentas deben estar activas para continuar.");
      }
      if (source.balanceCents - source.reservedCents < locked.amountCents) {
        throw new BankError(409, "La cuenta no dispone de saldo libre suficiente.");
      }
      nextStatus = "pending_review";
      await tx.update(fpBankTransfers).set({ status: nextStatus, validatedByUserId: actor.userId }).where(eq(fpBankTransfers.id, locked.id));
    } else if (body.data.action === "authorize") {
      if (locked.status !== "pending_review") throw new BankError(409, "La transferencia debe estar validada antes de autorizarse.");
      const [source] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, locked.sourceAccountId), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).for("update").limit(1);
      if (!source || source.status !== "active" || source.balanceCents - source.reservedCents < locked.amountCents) {
        throw new BankError(409, "No hay saldo libre suficiente para reservar la transferencia.");
      }
      await tx.update(fpBankAccounts).set({ reservedCents: source.reservedCents + locked.amountCents }).where(eq(fpBankAccounts.id, source.id));
      nextStatus = locked.scheduledDate && locked.scheduledDate > SIMULATED_DATE ? "scheduled" : "authorized";
      await tx.update(fpBankTransfers).set({ status: nextStatus, authorizedByUserId: actor.userId }).where(eq(fpBankTransfers.id, locked.id));
    } else if (body.data.action === "execute") {
      if (!["authorized", "scheduled"].includes(locked.status)) throw new BankError(409, "Solo se pueden ejecutar transferencias autorizadas.");
      if (locked.scheduledDate && locked.scheduledDate > SIMULATED_DATE) throw new BankError(409, `La fecha simulada aún no alcanza ${locked.scheduledDate}.`);
      const [source] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, locked.sourceAccountId), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).for("update").limit(1);
      if (!source || source.balanceCents < locked.amountCents || source.reservedCents < locked.amountCents) {
        throw new BankError(409, "No se puede ejecutar: el saldo reservado ya no está disponible.");
      }
      await tx.update(fpBankAccounts).set({ reservedCents: source.reservedCents - locked.amountCents }).where(eq(fpBankAccounts.id, source.id));
      await recordPair(tx, {
        actor,
        firstAccountId: locked.sourceAccountId,
        secondAccountId: locked.beneficiaryAccountId,
        firstDeltaCents: -locked.amountCents,
        firstDirection: "debit",
        amountCents: locked.amountCents,
        transferId: locked.id,
        reference: `TR-${locked.id.slice(0, 8).toUpperCase()}`,
        description: locked.concept,
        operationId: body.data.operationId,
      });
      nextStatus = "executed";
      await tx.update(fpBankTransfers).set({ status: nextStatus, executedAt: new Date() }).where(eq(fpBankTransfers.id, locked.id));
    } else if (body.data.action === "reject") {
      if (!["pending_review", "authorized", "scheduled"].includes(locked.status)) throw new BankError(409, "La transferencia no puede rechazarse en su estado actual.");
      if (!body.data.reason || body.data.reason.trim().length < 5) throw new BankError(400, "Indica el motivo del rechazo.");
      if (["authorized", "scheduled"].includes(locked.status)) {
        const [source] = await tx.select().from(fpBankAccounts).where(eq(fpBankAccounts.id, locked.sourceAccountId)).for("update").limit(1);
        if (source) await tx.update(fpBankAccounts).set({ reservedCents: Math.max(0, source.reservedCents - locked.amountCents) }).where(eq(fpBankAccounts.id, source.id));
      }
      nextStatus = "rejected";
      await tx.update(fpBankTransfers).set({ status: nextStatus, rejectedReason: body.data.reason.trim() }).where(eq(fpBankTransfers.id, locked.id));
    } else {
      if (!["draft", "pending_review", "authorized", "scheduled"].includes(locked.status)) throw new BankError(409, "La transferencia no puede cancelarse en su estado actual.");
      if (locked.createdByUserId !== actor.userId && !canOperate(actor)) throw new BankError(403, "Solo quien la creó o un responsable puede cancelarla.");
      if (["authorized", "scheduled"].includes(locked.status)) {
        const [source] = await tx.select().from(fpBankAccounts).where(eq(fpBankAccounts.id, locked.sourceAccountId)).for("update").limit(1);
        if (source) await tx.update(fpBankAccounts).set({ reservedCents: Math.max(0, source.reservedCents - locked.amountCents) }).where(eq(fpBankAccounts.id, source.id));
      }
      nextStatus = "cancelled";
      await tx.update(fpBankTransfers).set({ status: nextStatus }).where(eq(fpBankTransfers.id, locked.id));
    }

    await appendEvent(tx, actor, {
      organizationId: locked.organizationId,
      transferId: locked.id,
      operationId: body.data.operationId,
      requestFingerprint: eventFingerprint,
      eventType: `transfer_${body.data.action}`,
      description: `Transferencia ${body.data.action === "execute" ? "ejecutada" : body.data.action === "validate" ? "validada" : body.data.action === "authorize" ? "autorizada" : body.data.action === "reject" ? "rechazada" : "cancelada"}${body.data.reason ? `: ${body.data.reason.trim()}` : ""}.`,
    });
  });
  const updated = await loadTransfer(transfer.id, actor.tenantId);
  if (!updated) {
    res.status(500).json({ error: "No se pudo cargar la transferencia actualizada." });
    return;
  }
  res.json(ActOnFp360BankTransferResponse.parse(updated));
}));

router.post("/redfp360/bank/effects", route(async (req, res) => {
  const actor = req.auth!;
  const body = CreateFp360BankEffectBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "La empresa solicitada no está disponible para este perfil." });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const [existingEffect] = await db.select().from(fpBankEffects).where(and(
    eq(fpBankEffects.tenantId, actor.tenantId),
    eq(fpBankEffects.operationId, body.data.operationId),
  )).limit(1);
  if (existingEffect) {
    if (existingEffect.createdByUserId !== actor.userId || existingEffect.requestFingerprint !== requestFingerprint) {
      res.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const effect = await loadEffect(existingEffect.id, actor.tenantId);
    if (effect) {
      res.json(CreateFp360BankEffectResponse.parse(effect));
      return;
    }
  }
  if (!validDate(body.data.maturityDate) || body.data.maturityDate < SIMULATED_DATE) {
    res.status(400).json({ error: "La fecha de vencimiento debe ser una fecha simulada válida y futura." });
    return;
  }
  const [invoice] = await db.select().from(fpInvoices).where(and(
    eq(fpInvoices.id, body.data.invoiceId),
    eq(fpInvoices.tenantId, actor.tenantId),
    eq(fpInvoices.issuerOrganizationId, organizationId),
  )).limit(1);
  if (!invoice || !invoice.dueDate || invoice.dueDate !== body.data.maturityDate) {
    res.status(400).json({ error: "El efecto debe vincularse a una factura propia con el mismo vencimiento simulado." });
    return;
  }
  const payments = await db.select({ amountCents: fpPayments.amountCents }).from(fpPayments).where(and(
    eq(fpPayments.tenantId, actor.tenantId), eq(fpPayments.invoiceId, invoice.id),
  ));
  const outstanding = invoice.totalCents - payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const existingEffects = await db.select({ nominalCents: fpBankEffects.nominalCents, status: fpBankEffects.status }).from(fpBankEffects).where(and(
    eq(fpBankEffects.tenantId, actor.tenantId),
    eq(fpBankEffects.invoiceId, invoice.id),
  ));
  const alreadyPresented = existingEffects.reduce((sum, effect) =>
    sum + (["presented", "discounted", "settled"].includes(effect.status) ? effect.nominalCents : 0), 0);
  if (body.data.nominalCents > outstanding - alreadyPresented) {
    res.status(400).json({ error: "El nominal supera el saldo de la factura que aún puede respaldar efectos." });
    return;
  }
  const id = randomUUID();
  const reference = `EF-SIM-${id.slice(0, 8).toUpperCase()}`;
  await db.transaction(async (tx) => {
    await tx.insert(fpBankEffects).values({
      id, tenantId: actor.tenantId, organizationId, invoiceId: invoice.id,
      reference, nominalCents: body.data.nominalCents, maturityDate: body.data.maturityDate,
      status: "presented", operationId: body.data.operationId, requestFingerprint,
      createdByUserId: actor.userId, createdByName: actor.displayName,
    });
    await appendEvent(tx, actor, {
      organizationId,
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: "effect_presented",
      description: `Efecto simulado ${reference} presentado sobre la factura ${invoice.reference}.`,
    });
  });
  const effect = await loadEffect(id, actor.tenantId);
  if (!effect) {
    res.status(500).json({ error: "No se pudo cargar el efecto creado." });
    return;
  }
  res.status(201).json(CreateFp360BankEffectResponse.parse(effect));
}));

router.post("/redfp360/bank/financing", route(async (req, res) => {
  const actor = req.auth!;
  const body = CreateFp360BankFinancingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    res.status(403).json({ error: "La empresa solicitada no está disponible para este perfil." });
    return;
  }
  const account = await loadBankAccount(body.data.accountId, actor.tenantId);
  if (!account || account.organizationId !== organizationId || account.status !== "active") {
    res.status(400).json({ error: "Selecciona una cuenta activa de la empresa." });
    return;
  }
  if (body.data.productType === "loan" && (body.data.termMonths < 3 || body.data.termMonths > 60)) {
    res.status(400).json({ error: "El plazo de un préstamo debe estar entre 3 y 60 meses." });
    return;
  }
  if (body.data.productType === "credit_line" && (body.data.termMonths < 1 || body.data.termMonths > 60)) {
    res.status(400).json({ error: "El plazo de la póliza debe estar entre 1 y 60 meses." });
    return;
  }
  let maturityDate: string | null = null;
  let effectId: string | null = null;
  if (body.data.productType === "discount") {
    if (!body.data.effectId) {
      res.status(400).json({ error: "Para descontar, primero presenta un efecto simulado vinculado a una factura." });
      return;
    }
    const effect = await loadEffect(body.data.effectId, actor.tenantId);
    if (!effect || effect.organizationId !== organizationId || effect.status !== "presented"
      || effect.maturityDate <= SIMULATED_DATE || body.data.requestedAmountCents > effect.nominalCents) {
      res.status(400).json({ error: "El efecto no está disponible o el nominal solicitado no es elegible." });
      return;
    }
    maturityDate = effect.maturityDate;
    effectId = effect.id;
  } else if (body.data.effectId) {
    res.status(400).json({ error: "Solo un descuento de efectos puede vincular un efecto." });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const [existing] = await db.select().from(fpBankFinancing).where(and(
    eq(fpBankFinancing.tenantId, actor.tenantId),
    eq(fpBankFinancing.operationId, body.data.operationId),
  )).limit(1);
  if (existing) {
    if (existing.createdByUserId !== actor.userId || existing.requestFingerprint !== requestFingerprint) {
      res.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const financing = await loadFinancing(existing.id, actor.tenantId);
    if (financing) {
      res.json(CreateFp360BankFinancingResponse.parse(financing));
      return;
    }
  }
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(fpBankFinancing).values({
      id,
      tenantId: actor.tenantId,
      organizationId,
      accountId: account.id,
      productType: body.data.productType,
      effectId,
      requestedAmountCents: body.data.requestedAmountCents,
      offeredAmountCents: null,
      termMonths: body.data.termMonths,
      annualRateBps: body.data.annualRateBps,
      commissionBps: body.data.commissionBps,
      installmentCents: null,
      totalInterestCents: null,
      totalCostCents: null,
      netDisbursementCents: null,
      creditLimitCents: null,
      drawnCents: 0,
      maturityDate,
      status: "pending_review",
      decisionReason: null,
      operationId: body.data.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    });
    await appendEvent(tx, actor, {
      organizationId,
      financingId: id,
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: "financing_requested",
      description: `Solicitud simulada de ${body.data.productType} por ${(body.data.requestedAmountCents / 100).toFixed(2)} € enviada a revisión.`,
    });
  });
  const financing = await loadFinancing(id, actor.tenantId);
  if (!financing) {
    res.status(500).json({ error: "No se pudo cargar la solicitud de financiación." });
    return;
  }
  res.status(201).json(CreateFp360BankFinancingResponse.parse(financing));
}));

router.post("/redfp360/bank/financing/:id/action", route(async (req, res) => {
  const actor = req.auth!;
  const params = ActOnFp360BankFinancingParams.safeParse(req.params);
  const body = ActOnFp360BankFinancingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: params.error?.message ?? body.error?.message ?? "Solicitud no válida." });
    return;
  }
  const [current] = await db.select().from(fpBankFinancing).where(and(
    eq(fpBankFinancing.id, params.data.id), eq(fpBankFinancing.tenantId, actor.tenantId),
  )).limit(1);
  if (!current || (actor.organizationId && actor.organizationId !== current.organizationId)
    || (!actor.organizationId && !["teacher", "administrator"].includes(actor.role))) {
    res.status(404).json({ error: "Solicitud de financiación no encontrada para esta empresa." });
    return;
  }
  const action = body.data.action;
  if (["offer", "reject"].includes(action) && !canApprove(actor)) {
    res.status(403).json({ error: "Solo el profesorado o la administración puede resolver solicitudes." });
    return;
  }
  if (action === "accept" && actor.organizationId !== current.organizationId && !canApprove(actor)) {
    res.status(403).json({ error: "Solo la empresa solicitante puede aceptar la oferta." });
    return;
  }
  const requestFingerprint = fingerprint({ financingId: current.id, ...body.data });
  const [existingEvent] = await db.select().from(fpBankEvents).where(and(
    eq(fpBankEvents.tenantId, actor.tenantId),
    eq(fpBankEvents.operationId, body.data.operationId),
  )).limit(1);
  if (existingEvent) {
    if (existingEvent.actorUserId !== actor.userId ||
        existingEvent.requestFingerprint !== requestFingerprint ||
        existingEvent.financingId !== current.id) {
      res.status(409).json({ error: "El identificador de operación ya se utilizó con otros datos." });
      return;
    }
    const financing = await loadFinancing(current.id, actor.tenantId);
    if (financing) {
      res.json(ActOnFp360BankFinancingResponse.parse(financing));
      return;
    }
  }
  await db.transaction(async (tx) => {
    const [financing] = await tx.select().from(fpBankFinancing).where(and(
      eq(fpBankFinancing.id, current.id), eq(fpBankFinancing.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!financing) throw new BankError(404, "Solicitud de financiación no encontrada.");

    if (action === "offer") {
      if (financing.status !== "pending_review") throw new BankError(409, "Solo se pueden ofertar solicitudes pendientes.");
      const amount = body.data.amountCents ?? financing.requestedAmountCents;
      const rate = body.data.annualRateBps ?? financing.annualRateBps;
      const term = body.data.termMonths ?? financing.termMonths;
      if (amount <= 0 || amount > financing.requestedAmountCents || rate < 0 || rate > 5000) {
        throw new BankError(400, "La oferta debe respetar el importe solicitado y los límites de la simulación.");
      }
      if (amount > 5_000_000 && actor.userId === financing.createdByUserId) {
        throw new BankError(403, "Las concesiones superiores a 50.000 € requieren una segunda persona autorizadora.");
      }
      if (financing.productType === "loan" && (term < 3 || term > 60)) throw new BankError(400, "El plazo del préstamo debe estar entre 3 y 60 meses.");
      if (financing.productType === "credit_line" && (term < 1 || term > 60)) throw new BankError(400, "El plazo de la póliza debe estar entre 1 y 60 meses.");
      const quote = financingQuote(financing.productType, amount, rate, financing.commissionBps, term, financing.maturityDate);
      await tx.update(fpBankFinancing).set({
        offeredAmountCents: amount,
        annualRateBps: rate,
        termMonths: term,
        installmentCents: quote.installmentCents,
        totalInterestCents: quote.totalInterestCents,
        totalCostCents: quote.totalCostCents,
        netDisbursementCents: quote.netDisbursementCents,
        creditLimitCents: quote.creditLimitCents,
        status: "offered",
        decisionReason: body.data.reason?.trim() || null,
        offeredByUserId: actor.userId,
        offeredByName: actor.displayName,
      }).where(eq(fpBankFinancing.id, financing.id));
    } else if (action === "reject") {
      if (financing.status !== "pending_review" || !body.data.reason || body.data.reason.trim().length < 5) {
        throw new BankError(400, "Indica un motivo y selecciona una solicitud pendiente.");
      }
      await tx.update(fpBankFinancing).set({
        status: "rejected",
        decisionReason: body.data.reason.trim(),
        offeredByUserId: actor.userId,
        offeredByName: actor.displayName,
      }).where(eq(fpBankFinancing.id, financing.id));
    } else if (action === "accept") {
      if (financing.status !== "offered" || !financing.offeredAmountCents) throw new BankError(409, "La solicitud no tiene una oferta disponible para aceptar.");
      const [account] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, financing.accountId), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).for("update").limit(1);
      const [clearing] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, `bank-clearing:${actor.tenantId}`), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).for("update").limit(1);
      if (!account || !clearing || account.status !== "active") throw new BankError(409, "La cuenta asociada no está disponible.");
      if (financing.productType !== "credit_line") {
        const netAmount = financing.netDisbursementCents ?? financing.offeredAmountCents;
        await recordPair(tx, {
          actor,
          firstAccountId: account.id,
          secondAccountId: clearing.id,
          firstDeltaCents: netAmount,
          firstDirection: "credit",
          amountCents: netAmount,
          financingId: financing.id,
          reference: `FIN-${financing.id.slice(0, 8).toUpperCase()}`,
          description: financing.productType === "discount" ? "Abono neto por descuento simulado de efecto" : "Desembolso de préstamo simulado",
          operationId: body.data.operationId,
        });
      }
      if (financing.productType === "loan") {
        const quote = financingQuote("loan", financing.offeredAmountCents, financing.annualRateBps, financing.commissionBps, financing.termMonths, null);
        await tx.insert(fpBankInstallments).values(quote.schedule.map((item) => ({
          id: randomUUID(),
          tenantId: actor.tenantId,
          financingId: financing.id,
          installmentNumber: item.installmentNumber,
          dueDate: item.dueDate,
          principalCents: item.principalCents,
          interestCents: item.interestCents,
          totalCents: item.totalCents,
          status: "pending",
        })));
      }
      if (financing.effectId) {
        await tx.update(fpBankEffects).set({ status: "discounted" }).where(and(
          eq(fpBankEffects.id, financing.effectId), eq(fpBankEffects.tenantId, actor.tenantId),
        ));
      }
      await tx.update(fpBankFinancing).set({ status: "active", acceptedAt: new Date() }).where(eq(fpBankFinancing.id, financing.id));
    } else if (action === "draw") {
      if (financing.productType !== "credit_line" || financing.status !== "active" || !body.data.amountCents
        || body.data.amountCents > (financing.creditLimitCents ?? 0) - financing.drawnCents) {
        throw new BankError(409, "El importe supera el disponible o la póliza no está activa.");
      }
      const [clearing] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, `bank-clearing:${actor.tenantId}`), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).for("update").limit(1);
      if (!clearing) throw new BankError(409, "La cámara bancaria simulada no está disponible.");
      await recordPair(tx, {
        actor,
        firstAccountId: financing.accountId,
        secondAccountId: clearing.id,
        firstDeltaCents: body.data.amountCents,
        firstDirection: "credit",
        amountCents: body.data.amountCents,
        financingId: financing.id,
        reference: `DIS-${financing.id.slice(0, 8).toUpperCase()}`,
        description: "Disposición de póliza de crédito simulada",
        operationId: body.data.operationId,
      });
      await tx.update(fpBankFinancing).set({ drawnCents: financing.drawnCents + body.data.amountCents }).where(eq(fpBankFinancing.id, financing.id));
    } else if (action === "repay") {
      if (financing.productType !== "credit_line" || financing.status !== "active" || !body.data.amountCents
        || body.data.amountCents > financing.drawnCents) {
        throw new BankError(409, "El importe supera el dispuesto o la póliza no está activa.");
      }
      const [clearing] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, `bank-clearing:${actor.tenantId}`), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).for("update").limit(1);
      if (!clearing) throw new BankError(409, "La cámara bancaria simulada no está disponible.");
      await recordPair(tx, {
        actor,
        firstAccountId: financing.accountId,
        secondAccountId: clearing.id,
        firstDeltaCents: -body.data.amountCents,
        firstDirection: "debit",
        amountCents: body.data.amountCents,
        financingId: financing.id,
        reference: `AMO-${financing.id.slice(0, 8).toUpperCase()}`,
        description: "Amortización de póliza de crédito simulada",
        operationId: body.data.operationId,
      });
      await tx.update(fpBankFinancing).set({ drawnCents: financing.drawnCents - body.data.amountCents }).where(eq(fpBankFinancing.id, financing.id));
    } else if (action === "pay_installment") {
      if (financing.productType !== "loan" || financing.status !== "active" || !body.data.installmentId) {
        throw new BankError(409, "Selecciona una cuota pendiente de un préstamo activo.");
      }
      const [installment] = await tx.select().from(fpBankInstallments).where(and(
        eq(fpBankInstallments.id, body.data.installmentId),
        eq(fpBankInstallments.tenantId, actor.tenantId),
        eq(fpBankInstallments.financingId, financing.id),
        eq(fpBankInstallments.status, "pending"),
      )).for("update").limit(1);
      if (!installment) throw new BankError(409, "La cuota ya está pagada o no pertenece a esta solicitud.");
      const [clearing] = await tx.select().from(fpBankAccounts).where(and(
        eq(fpBankAccounts.id, `bank-clearing:${actor.tenantId}`), eq(fpBankAccounts.tenantId, actor.tenantId),
      )).for("update").limit(1);
      if (!clearing) throw new BankError(409, "La cámara bancaria simulada no está disponible.");
      await recordPair(tx, {
        actor,
        firstAccountId: financing.accountId,
        secondAccountId: clearing.id,
        firstDeltaCents: -installment.totalCents,
        firstDirection: "debit",
        amountCents: installment.totalCents,
        financingId: financing.id,
        reference: `CUO-${String(installment.installmentNumber).padStart(2, "0")}`,
        description: "Pago simulado de cuota de préstamo",
        operationId: body.data.operationId,
      });
      await tx.update(fpBankInstallments).set({ status: "paid", paidAt: new Date(), paymentOperationId: body.data.operationId }).where(eq(fpBankInstallments.id, installment.id));
      const remaining = await tx.select({ id: fpBankInstallments.id }).from(fpBankInstallments).where(and(
        eq(fpBankInstallments.tenantId, actor.tenantId),
        eq(fpBankInstallments.financingId, financing.id),
        eq(fpBankInstallments.status, "pending"),
      ));
      if (remaining.length === 0) {
        await tx.update(fpBankFinancing).set({ status: "closed", closedAt: new Date() }).where(eq(fpBankFinancing.id, financing.id));
      }
    } else {
      if (financing.status !== "active") throw new BankError(409, "Solo se pueden cerrar productos activos.");
      if (financing.productType === "credit_line" && financing.drawnCents !== 0) throw new BankError(409, "Amortiza el saldo dispuesto antes de cerrar la póliza.");
      if (financing.productType === "loan") {
        const unpaid = await tx.select({ id: fpBankInstallments.id }).from(fpBankInstallments).where(and(
          eq(fpBankInstallments.tenantId, actor.tenantId),
          eq(fpBankInstallments.financingId, financing.id),
          eq(fpBankInstallments.status, "pending"),
        ));
        if (unpaid.length) throw new BankError(409, "El préstamo no puede cerrarse mientras tenga cuotas pendientes.");
      }
      await tx.update(fpBankFinancing).set({ status: "closed", closedAt: new Date() }).where(eq(fpBankFinancing.id, financing.id));
    }

    await appendEvent(tx, actor, {
      organizationId: financing.organizationId,
      financingId: financing.id,
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: `financing_${action}`,
      description: `Operación de financiación: ${action}${body.data.reason ? ` · ${body.data.reason.trim()}` : ""}.`,
    });
  });
  const updated = await loadFinancing(current.id, actor.tenantId);
  if (!updated) {
    res.status(500).json({ error: "No se pudo cargar la operación de financiación." });
    return;
  }
  res.json(ActOnFp360BankFinancingResponse.parse(updated));
}));

export default router;

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, or } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import * as api from "@workspace/api-zod";
import {
  db,
  fpAuthMemberships,
  fpAuthUsers,
  fpDirectionAlertActions,
  fpDirectionDecisions,
  fpDirectionEvents,
  fpDirectionObjectives,
  fpDirectionReports,
  fpDirectionTasks,
  fpDirectionThresholds,
  fpInvoices,
  fpOrders,
  fpPayments,
  fpProducts,
  fpPurchaseInvoices,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: Router = Router();
const SIMULATED_DATE = "2027-09-15";
const THRESHOLD_KEYS = ["stock_low_units", "liquidity_min_cents"] as const;
type ThresholdKey = (typeof THRESHOLD_KEYS)[number];
type MetricKey = "sales_base_cents" | "purchase_base_cents" | "open_orders" | "open_tasks";
type DirectionEventType = "task" | "alert" | "decision" | "objective" | "report";

class DirectionHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function fail(status: number, message: string): never {
  throw new DirectionHttpError(status, message);
}

function route(handler: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return (req, res, next) => {
    void handler(req, res).catch(next);
  };
}

function isManager(role: AuthContext["role"]): boolean {
  return ["team_manager", "teacher", "administrator"].includes(role);
}

function canReview(role: AuthContext["role"]): boolean {
  return role === "teacher" || role === "administrator";
}

function validDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validatePeriod(start: string, end: string): void {
  if (!validDate(start) || !validDate(end) || start > end) {
    fail(400, "El periodo de simulación no es válido.");
  }
  const startMonth = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7));
  const endMonth = Number(end.slice(0, 4)) * 12 + Number(end.slice(5, 7));
  if (endMonth - startMonth > 35) fail(400, "El periodo máximo de consulta es de 36 meses.");
}

function periodFromQuery(query: { periodStart?: string; periodEnd?: string }) {
  const end = query.periodEnd ?? SIMULATED_DATE;
  const start = query.periodStart ?? `${end.slice(0, 4)}-01-01`;
  validatePeriod(start, end);
  return { periodStart: start, periodEnd: end, periodLabel: `${start} — ${end}` };
}

function monthsBetween(start: string, end: string): string[] {
  const output: string[] = [];
  const [startYear, startMonth] = start.slice(0, 7).split("-").map(Number);
  const [endYear, endMonth] = end.slice(0, 7).split("-").map(Number);
  let year = startYear;
  let month = startMonth;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    output.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return output;
}

async function getOverview(tenantId: string, periodStart: string, periodEnd: string) {
  validatePeriod(periodStart, periodEnd);
  const allInvoicesToEnd = await db.select().from(fpInvoices).where(and(
    eq(fpInvoices.tenantId, tenantId),
    lte(fpInvoices.simulatedDate, periodEnd),
  ));
  const periodInvoices = allInvoicesToEnd.filter((invoice) =>
    invoice.simulatedDate >= periodStart && invoice.simulatedDate <= periodEnd
  );
  const invoiceIds = allInvoicesToEnd.map((invoice) => invoice.id);
  const payments = invoiceIds.length
    ? await db.select().from(fpPayments).where(inArray(fpPayments.invoiceId, invoiceIds))
    : [];
  const paidByInvoice = new Map<string, number>();
  for (const payment of payments) {
    if (payment.simulatedDate <= periodEnd) {
      paidByInvoice.set(payment.invoiceId, (paidByInvoice.get(payment.invoiceId) ?? 0) + payment.amountCents);
    }
  }
  const outstandingBalances = allInvoicesToEnd.map((invoice) =>
    Math.max(0, invoice.totalCents - (paidByInvoice.get(invoice.id) ?? 0))
  );
  const purchaseInvoices = await db.select().from(fpPurchaseInvoices).where(and(
    eq(fpPurchaseInvoices.tenantId, tenantId),
    eq(fpPurchaseInvoices.status, "approved"),
    gte(fpPurchaseInvoices.invoiceDate, periodStart),
    lte(fpPurchaseInvoices.invoiceDate, periodEnd),
  ));
  const seriesByMonth = new Map<string, { period: string; salesBaseCents: number; purchaseBaseCents: number }>();
  for (const month of monthsBetween(periodStart, periodEnd)) {
    seriesByMonth.set(month, { period: month, salesBaseCents: 0, purchaseBaseCents: 0 });
  }
  for (const invoice of periodInvoices) {
    const key = invoice.simulatedDate.slice(0, 7);
    const entry = seriesByMonth.get(key);
    if (entry) entry.salesBaseCents += invoice.baseCents;
  }
  for (const invoice of purchaseInvoices) {
    const key = invoice.invoiceDate.slice(0, 7);
    const entry = seriesByMonth.get(key);
    if (entry) entry.purchaseBaseCents += invoice.baseCents;
  }
  const outstandingCustomerCents = outstandingBalances.reduce((total, value) => total + value, 0);
  const outstandingCustomerInvoiceCount = outstandingBalances.filter((balance) => balance > 0).length;
  const salesBaseCents = periodInvoices.reduce((total, invoice) => total + invoice.baseCents, 0);
  const purchaseBaseCents = purchaseInvoices.reduce((total, invoice) => total + invoice.baseCents, 0);

  return {
    periodStart,
    periodEnd,
    periodLabel: `${periodStart} — ${periodEnd}`,
    salesBaseCents,
    purchaseBaseCents,
    outstandingCustomerCents,
    outstandingCustomerInvoiceCount,
    salesInvoiceCount: periodInvoices.length,
    purchaseInvoiceCount: purchaseInvoices.length,
    overdueCustomerInvoiceCount: null,
    overdueCustomerInvoiceUnavailableReason: "Las facturas de venta no incluyen una fecha de vencimiento.",
    treasuryBalanceCents: null,
    treasuryBalanceUnavailableReason: "No hay una fuente de tesorería conciliada para este periodo.",
    grossMarginCents: null,
    grossMarginUnavailableReason: "No hay coste de ventas vinculado a artículos entregados; las compras no equivalen al coste de ventas.",
    series: [...seriesByMonth.values()],
    activityByArea: [],
    simulationOnly: true as const,
  };
}

function publicOverview(overview: Awaited<ReturnType<typeof getOverview>>) {
  return overview;
}

function publicTask(row: typeof fpDirectionTasks.$inferSelect) {
  const { tenantId: _tenantId, ...task } = row;
  return task;
}

function publicDecision(row: typeof fpDirectionDecisions.$inferSelect) {
  const { tenantId: _tenantId, updatedAt: _updatedAt, ...decision } = row;
  return decision;
}

function publicReport(row: typeof fpDirectionReports.$inferSelect) {
  const { tenantId: _tenantId, ...report } = row;
  return report;
}

function publicEvent(row: typeof fpDirectionEvents.$inferSelect) {
  const { tenantId: _tenantId, ...event } = row;
  return event;
}

async function tenantMembershipExists(tenantId: string, userId: string): Promise<boolean> {
  const [membership] = await db.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships).where(and(
    eq(fpAuthMemberships.tenantId, tenantId),
    eq(fpAuthMemberships.userId, userId),
    eq(fpAuthMemberships.isActive, true),
  )).limit(1);
  return Boolean(membership);
}

async function addEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actor: AuthContext,
  entityType: DirectionEventType,
  entityId: string,
  action: string,
  reason: string,
): Promise<void> {
  await tx.insert(fpDirectionEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    entityType,
    entityId,
    action,
    actorUserId: actor.userId,
    actorRole: actor.role,
    reason,
    simulatedDate: SIMULATED_DATE,
  });
}

router.use("/redfp360/direction", requireAuth);

router.get("/redfp360/direction/overview", route(async (req, res) => {
  const parsed = api.GetFp360DirectionOverviewQueryParams.safeParse(req.query);
  if (!parsed.success) fail(400, "El periodo de consulta no es válido.");
  const period = periodFromQuery(parsed.data);
  res.json(publicOverview(await getOverview(req.auth!.tenantId, period.periodStart, period.periodEnd)));
}));

router.get("/redfp360/direction/tasks", route(async (req, res) => {
  const actor = req.auth!;
  const tasks = await db.select().from(fpDirectionTasks).where(eq(fpDirectionTasks.tenantId, actor.tenantId))
    .orderBy(desc(fpDirectionTasks.createdAt));
  const visibleTasks = actor.role === "student"
    ? tasks.filter((task) => task.createdByUserId === actor.userId || task.assignedToUserId === actor.userId)
    : tasks;
  res.json(visibleTasks.map(publicTask));
}));

router.post("/redfp360/direction/tasks", requireSimulationWriteAccess, route(async (req, res) => {
  const parsed = api.CreateFp360DirectionTaskBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa el título, la prioridad y la fecha simulada.");
  const actor = req.auth!;
  const assigneeId = parsed.data.assignedToUserId ?? actor.userId;
  if (actor.role === "student" && assigneeId !== actor.userId) {
    fail(403, "El alumnado solo puede asignar tareas a su propia cuenta.");
  }
  if (!await tenantMembershipExists(actor.tenantId, assigneeId)) {
    fail(400, "La persona asignada no pertenece a esta empresa simulada.");
  }
  if (parsed.data.dueSimulatedDate && !validDate(parsed.data.dueSimulatedDate)) {
    fail(400, "La fecha de vencimiento simulada no es válida.");
  }
  const [task] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpDirectionTasks).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      title: parsed.data.title.trim(),
      detail: parsed.data.detail?.trim() ?? "",
      priority: parsed.data.priority,
      status: "open",
      dueSimulatedDate: parsed.data.dueSimulatedDate ?? null,
      assignedToUserId: assigneeId,
      createdByUserId: actor.userId,
      createdByRole: actor.role,
    }).returning();
    await addEvent(tx, actor, "task", created.id, "created", "Tarea de dirección creada.");
    return [created];
  });
  res.status(201).json(publicTask(task));
}));

router.get("/redfp360/direction/members", route(async (req, res) => {
  const actor = req.auth!;
  const members = await db.select({
    id: fpAuthUsers.id,
    displayName: fpAuthUsers.displayName,
    role: fpAuthMemberships.role,
    organizationId: fpAuthMemberships.organizationId,
  }).from(fpAuthMemberships)
    .innerJoin(fpAuthUsers, eq(fpAuthUsers.id, fpAuthMemberships.userId))
    .where(and(
      eq(fpAuthMemberships.tenantId, actor.tenantId),
      eq(fpAuthMemberships.isActive, true),
      eq(fpAuthUsers.isActive, true),
    ))
    .orderBy(asc(fpAuthUsers.displayName));
  res.json(actor.role === "student" ? members.filter((member) => member.id === actor.userId) : members);
}));

router.patch("/redfp360/direction/tasks/:id", requireSimulationWriteAccess, route(async (req, res) => {
  const params = api.UpdateFp360DirectionTaskParams.safeParse(req.params);
  const parsed = api.UpdateFp360DirectionTaskBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Indica un estado y un motivo válidos.");
  const actor = req.auth!;
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(fpDirectionTasks).where(and(
      eq(fpDirectionTasks.id, params.data.id),
      eq(fpDirectionTasks.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!current) return { kind: "missing" as const };
    const isOwner = current.createdByUserId === actor.userId || current.assignedToUserId === actor.userId;
    if (!isManager(actor.role) && !isOwner) return { kind: "forbidden" as const };
    const [updated] = await tx.update(fpDirectionTasks).set({
      status: parsed.data.status,
      updatedAt: new Date(),
    }).where(and(
      eq(fpDirectionTasks.id, current.id),
      eq(fpDirectionTasks.tenantId, actor.tenantId),
    )).returning();
    await addEvent(tx, actor, "task", current.id, `status_${parsed.data.status}`, parsed.data.reason.trim());
    return { kind: "updated" as const, task: updated };
  });
  if (result.kind === "missing") fail(404, "No se encontró la tarea en esta empresa.");
  if (result.kind === "forbidden") fail(403, "No tienes permiso para modificar esta tarea.");
  res.json(publicTask(result.task));
}));

async function deriveAlerts(tenantId: string) {
  const [threshold] = await db.select().from(fpDirectionThresholds).where(and(
    eq(fpDirectionThresholds.tenantId, tenantId),
    eq(fpDirectionThresholds.key, "stock_low_units"),
  )).limit(1);
  const products = await db.select().from(fpProducts).where(and(
    eq(fpProducts.tenantId, tenantId),
    eq(fpProducts.isActive, true),
  ));
  const stockAlerts = products.flatMap((product) => {
    const hasCompanyThreshold = threshold?.enabled && threshold.value !== null;
    const cutoff = hasCompanyThreshold ? threshold.value! : product.minimumStock;
    const available = Math.max(0, product.stock - product.reserved);
    const monitored = Boolean(hasCompanyThreshold) || product.minimumStock > 0;
    if (!monitored || available > cutoff) return [];
    return [{
      alertKey: `stock:${product.id}`,
      severity: available === 0 ? "high" : "medium",
      title: "Existencias por debajo del mínimo",
      description: `${product.name}: ${available} unidades disponibles; mínimo configurado ${cutoff}.`,
      sourceType: "inventory",
      sourceId: product.id,
      simulatedDate: SIMULATED_DATE,
      requiresEvidence: false,
    }];
  });
  const pendingSupplierInvoices = await db.select().from(fpPurchaseInvoices).where(and(
    eq(fpPurchaseInvoices.tenantId, tenantId),
    eq(fpPurchaseInvoices.status, "pending_review"),
  ));
  const invoiceAlerts = pendingSupplierInvoices.map((invoice) => {
    const match = invoice.matchStatus.toLowerCase();
    const critical = match.includes("mismatch") || match.includes("discrep");
    return {
      alertKey: `supplier-invoice:${invoice.id}`,
      severity: critical ? "critical" : "high",
      title: critical ? "Diferencia en factura de proveedor" : "Factura de proveedor pendiente de revisión",
      description: `${invoice.invoiceReference} · ${invoice.matchSummary}`,
      sourceType: "purchase_invoice",
      sourceId: invoice.id,
      simulatedDate: invoice.invoiceDate,
      requiresEvidence: critical,
    };
  });
  const alerts = [...stockAlerts, ...invoiceAlerts];
  const alertKeys = alerts.map((alert) => alert.alertKey);
  const actions = alertKeys.length
    ? await db.select().from(fpDirectionAlertActions).where(and(
      eq(fpDirectionAlertActions.tenantId, tenantId),
      inArray(fpDirectionAlertActions.alertKey, alertKeys),
    ))
    : [];
  const actionByKey = new Map(actions.map((action) => [action.alertKey, action]));
  return alerts.map((alert) => {
    const action = actionByKey.get(alert.alertKey);
    return {
      ...alert,
      status: action?.status ?? "open",
      assignedToUserId: action?.assignedToUserId ?? null,
      justification: action?.justification ?? "",
      evidenceReference: action?.evidenceReference ?? "",
    };
  });
}

router.get("/redfp360/direction/alerts", route(async (req, res) => {
  res.json(await deriveAlerts(req.auth!.tenantId));
}));

router.patch("/redfp360/direction/alerts/:alertKey", requireSimulationWriteAccess, route(async (req, res) => {
  const params = api.UpdateFp360DirectionAlertParams.safeParse(req.params);
  const parsed = api.UpdateFp360DirectionAlertBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Revisa el estado y la justificación de la alerta.");
  const actor = req.auth!;
  if (!isManager(actor.role)) fail(403, "Solo responsables de equipo y supervisores pueden gestionar alertas.");
  const [alert] = (await deriveAlerts(actor.tenantId)).filter((item) => item.alertKey === params.data.alertKey);
  if (!alert) fail(404, "La alerta ya no existe o no pertenece a esta empresa.");
  if (parsed.data.assignedToUserId && !await tenantMembershipExists(actor.tenantId, parsed.data.assignedToUserId)) {
    fail(400, "La persona asignada no pertenece a esta empresa simulada.");
  }
  const evidenceReference = parsed.data.evidenceReference?.trim() ?? "";
  if (alert.requiresEvidence && evidenceReference.length < 4) {
    fail(400, "Las alertas críticas requieren una referencia de evidencia.");
  }
  const [updated] = await db.transaction(async (tx) => {
    await tx.insert(fpDirectionAlertActions).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      alertKey: alert.alertKey,
      status: parsed.data.status,
      assignedToUserId: parsed.data.assignedToUserId ?? null,
      justification: parsed.data.justification.trim(),
      evidenceReference,
      updatedByUserId: actor.userId,
      updatedByRole: actor.role,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [fpDirectionAlertActions.tenantId, fpDirectionAlertActions.alertKey],
      set: {
        status: parsed.data.status,
        assignedToUserId: parsed.data.assignedToUserId ?? null,
        justification: parsed.data.justification.trim(),
        evidenceReference,
        updatedByUserId: actor.userId,
        updatedByRole: actor.role,
        updatedAt: new Date(),
      },
    }).returning();
    await addEvent(tx, actor, "alert", alert.alertKey, `status_${parsed.data.status}`, parsed.data.justification.trim());
    return tx.select().from(fpDirectionAlertActions).where(and(
      eq(fpDirectionAlertActions.tenantId, actor.tenantId),
      eq(fpDirectionAlertActions.alertKey, alert.alertKey),
    )).limit(1);
  });
  res.json({ ...alert, status: updated.status, assignedToUserId: updated.assignedToUserId, justification: updated.justification, evidenceReference: updated.evidenceReference });
}));

router.get("/redfp360/direction/thresholds", route(async (req, res) => {
  const actor = req.auth!;
  const rows = await db.select().from(fpDirectionThresholds).where(eq(fpDirectionThresholds.tenantId, actor.tenantId));
  const byKey = new Map(rows.map((row) => [row.key, row]));
  res.json(THRESHOLD_KEYS.map((key) => {
    const row = byKey.get(key);
    return {
      key,
      value: row?.value ?? null,
      enabled: row?.enabled ?? false,
      updatedByUserId: row?.updatedByUserId ?? null,
      updatedAt: row?.updatedAt ?? null,
    };
  }));
}));

router.put("/redfp360/direction/thresholds", requireSimulationWriteAccess, route(async (req, res) => {
  const params = api.UpsertFp360DirectionThresholdQueryParams.safeParse(req.query);
  const parsed = api.UpsertFp360DirectionThresholdBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "El umbral no es válido.");
  const actor = req.auth!;
  if (!isManager(actor.role)) fail(403, "Solo responsables y supervisores pueden configurar umbrales.");
  if (parsed.data.enabled && parsed.data.value === null) fail(400, "Indica un valor antes de activar el umbral.");
  const key = params.data.key as ThresholdKey;
  const [threshold] = await db.transaction(async (tx) => {
    await tx.insert(fpDirectionThresholds).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      key,
      value: parsed.data.value,
      enabled: parsed.data.enabled,
      updatedByUserId: actor.userId,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [fpDirectionThresholds.tenantId, fpDirectionThresholds.key],
      set: {
        value: parsed.data.value,
        enabled: parsed.data.enabled,
        updatedByUserId: actor.userId,
        updatedAt: new Date(),
      },
    }).returning();
    await addEvent(tx, actor, "alert", `threshold:${key}`, "threshold_updated", "Umbral de alerta actualizado.");
    return tx.select().from(fpDirectionThresholds).where(and(
      eq(fpDirectionThresholds.tenantId, actor.tenantId),
      eq(fpDirectionThresholds.key, key),
    )).limit(1);
  });
  res.json({
    key: threshold.key,
    value: threshold.value,
    enabled: threshold.enabled,
    updatedByUserId: threshold.updatedByUserId,
    updatedAt: threshold.updatedAt,
  });
}));

router.get("/redfp360/direction/decisions", route(async (req, res) => {
  const decisions = await db.select().from(fpDirectionDecisions).where(eq(fpDirectionDecisions.tenantId, req.auth!.tenantId))
    .orderBy(desc(fpDirectionDecisions.createdAt));
  res.json(decisions.map(publicDecision));
}));

router.post("/redfp360/direction/decisions", requireSimulationWriteAccess, route(async (req, res) => {
  const parsed = api.CreateFp360DirectionDecisionBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa la decisión, el motivo y el impacto previsto.");
  const actor = req.auth!;
  if (!isManager(actor.role)) fail(403, "Solo responsables y supervisores pueden enviar decisiones.");
  if (!validDate(parsed.data.simulatedDate)) fail(400, "La fecha simulada no es válida.");
  const [decision] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpDirectionDecisions).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      title: parsed.data.title.trim(),
      reason: parsed.data.reason.trim(),
      proposedAction: parsed.data.proposedAction.trim(),
      impactCents: parsed.data.impactCents ?? null,
      impactNote: parsed.data.impactNote.trim(),
      simulatedDate: parsed.data.simulatedDate,
      status: "pending",
      submittedByUserId: actor.userId,
      submittedByRole: actor.role,
    }).returning();
    await addEvent(tx, actor, "decision", created.id, "submitted", created.reason);
    return [created];
  });
  res.status(201).json(publicDecision(decision));
}));

router.post("/redfp360/direction/decisions/:id/decision", requireSimulationWriteAccess, route(async (req, res) => {
  const params = api.DecideFp360DirectionDecisionParams.safeParse(req.params);
  const parsed = api.DecideFp360DirectionDecisionBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Indica aprobar o rechazar la decisión y explica el motivo.");
  const actor = req.auth!;
  if (!canReview(actor.role)) fail(403, "Solo profesorado o administración pueden aprobar decisiones extraordinarias.");
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(fpDirectionDecisions).where(and(
      eq(fpDirectionDecisions.id, params.data.id),
      eq(fpDirectionDecisions.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!current) return { kind: "missing" as const };
    if (current.status !== "pending") return { kind: "closed" as const };
    if (current.submittedByUserId === actor.userId) return { kind: "self_review" as const };
    const status = parsed.data.decision === "approve" ? "approved" : "rejected";
    const [updated] = await tx.update(fpDirectionDecisions).set({
      status,
      reviewedByUserId: actor.userId,
      reviewedByRole: actor.role,
      reviewReason: parsed.data.reason.trim(),
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(fpDirectionDecisions.id, current.id),
      eq(fpDirectionDecisions.tenantId, actor.tenantId),
      eq(fpDirectionDecisions.status, "pending"),
    )).returning();
    if (!updated) return { kind: "closed" as const };
    await addEvent(tx, actor, "decision", updated.id, status, parsed.data.reason.trim());
    return { kind: "updated" as const, decision: updated };
  });
  if (result.kind === "missing") fail(404, "No se encontró la decisión en esta empresa.");
  if (result.kind === "closed") fail(400, "La decisión ya fue revisada y no puede aprobarse de nuevo.");
  if (result.kind === "self_review") fail(403, "Quien propone una decisión no puede aprobarla.");
  res.json(publicDecision(result.decision));
}));

async function actualObjectiveValue(
  tenantId: string,
  metric: MetricKey,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  if (metric === "sales_base_cents" || metric === "purchase_base_cents") {
    const overview = await getOverview(tenantId, periodStart, periodEnd);
    return metric === "sales_base_cents" ? overview.salesBaseCents : overview.purchaseBaseCents;
  }
  if (metric === "open_orders") {
    const orders = await db.select().from(fpOrders).where(and(
      eq(fpOrders.tenantId, tenantId),
      gte(fpOrders.simulatedDate, periodStart),
      lte(fpOrders.simulatedDate, periodEnd),
    ));
    return orders.filter((order) => ["draft", "confirmed", "partial"].includes(order.status)).length;
  }
  const tasks = await db.select().from(fpDirectionTasks).where(and(
    eq(fpDirectionTasks.tenantId, tenantId),
    inArray(fpDirectionTasks.status, ["open", "in_progress"]),
  ));
  return tasks.filter((task) =>
    task.dueSimulatedDate !== null &&
    task.dueSimulatedDate >= periodStart &&
    task.dueSimulatedDate <= periodEnd
  ).length;
}

async function withObjectiveProgress(row: typeof fpDirectionObjectives.$inferSelect) {
  const actualValue = await actualObjectiveValue(row.tenantId, row.metric as MetricKey, row.periodStart, row.periodEnd);
  const { tenantId: _tenantId, updatedAt: _updatedAt, createdByRole: _createdByRole, ...publicRow } = row;
  return { ...publicRow, actualValue, progressAvailable: true };
}

router.get("/redfp360/direction/objectives", route(async (req, res) => {
  const parsed = api.ListFp360DirectionObjectivesQueryParams.safeParse(req.query);
  if (!parsed.success) fail(400, "El periodo de consulta no es válido.");
  const period = periodFromQuery(parsed.data);
  const objectives = await db.select().from(fpDirectionObjectives).where(and(
    eq(fpDirectionObjectives.tenantId, req.auth!.tenantId),
    lte(fpDirectionObjectives.periodStart, period.periodEnd),
    gte(fpDirectionObjectives.periodEnd, period.periodStart),
  )).orderBy(asc(fpDirectionObjectives.periodStart));
  res.json(await Promise.all(objectives.map(withObjectiveProgress)));
}));

router.post("/redfp360/direction/objectives", requireSimulationWriteAccess, route(async (req, res) => {
  const parsed = api.CreateFp360DirectionObjectiveBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa el objetivo, el indicador, el valor y el periodo.");
  const actor = req.auth!;
  if (!isManager(actor.role)) fail(403, "Solo responsables y supervisores pueden definir objetivos.");
  validatePeriod(parsed.data.periodStart, parsed.data.periodEnd);
  const [objective] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpDirectionObjectives).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      label: parsed.data.label.trim(),
      metric: parsed.data.metric,
      targetValue: parsed.data.targetValue,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      notes: parsed.data.notes?.trim() ?? "",
      createdByUserId: actor.userId,
      createdByRole: actor.role,
    }).returning();
    await addEvent(tx, actor, "objective", created.id, "created", "Objetivo de dirección creado.");
    return [created];
  });
  res.status(201).json(await withObjectiveProgress(objective));
}));

router.patch("/redfp360/direction/objectives/:id", requireSimulationWriteAccess, route(async (req, res) => {
  const params = api.UpdateFp360DirectionObjectiveParams.safeParse(req.params);
  const parsed = api.UpdateFp360DirectionObjectiveBody.safeParse(req.body);
  if (!params.success || !parsed.success) fail(400, "Revisa el objetivo y el periodo.");
  const actor = req.auth!;
  if (!isManager(actor.role)) fail(403, "Solo responsables y supervisores pueden modificar objetivos.");
  validatePeriod(parsed.data.periodStart, parsed.data.periodEnd);
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(fpDirectionObjectives).where(and(
      eq(fpDirectionObjectives.id, params.data.id),
      eq(fpDirectionObjectives.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!current) return null;
    const [updated] = await tx.update(fpDirectionObjectives).set({
      label: parsed.data.label.trim(),
      metric: parsed.data.metric,
      targetValue: parsed.data.targetValue,
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      notes: parsed.data.notes?.trim() ?? "",
      updatedAt: new Date(),
    }).where(and(
      eq(fpDirectionObjectives.id, current.id),
      eq(fpDirectionObjectives.tenantId, actor.tenantId),
    )).returning();
    await addEvent(tx, actor, "objective", current.id, "updated", "Objetivo de dirección actualizado.");
    return updated;
  });
  if (!result) fail(404, "No se encontró el objetivo en esta empresa.");
  res.json(await withObjectiveProgress(result));
}));

function canViewReport(actor: AuthContext, createdByUserId: string, createdByRole: string): boolean {
  if (canReview(actor.role)) return true;
  if (actor.role === "team_manager") {
    return ["team_manager", "teacher", "administrator"].includes(createdByRole);
  }
  return createdByUserId === actor.userId;
}

async function reportRows(actor: AuthContext) {
  const rows = await db.select().from(fpDirectionReports).where(eq(fpDirectionReports.tenantId, actor.tenantId))
    .orderBy(desc(fpDirectionReports.createdAt));
  return rows.filter((row) => canViewReport(actor, row.createdByUserId, row.createdByRole)).map(publicReport);
}

router.get("/redfp360/direction/reports", route(async (req, res) => {
  res.json(await reportRows(req.auth!));
}));

router.post("/redfp360/direction/reports", requireSimulationWriteAccess, route(async (req, res) => {
  const parsed = api.CreateFp360DirectionReportBody.safeParse(req.body);
  if (!parsed.success) fail(400, "Revisa el título y el periodo del informe.");
  const actor = req.auth!;
  validatePeriod(parsed.data.periodStart, parsed.data.periodEnd);
  const snapshot = publicOverview(await getOverview(actor.tenantId, parsed.data.periodStart, parsed.data.periodEnd));
  const [report] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpDirectionReports).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      title: parsed.data.title.trim(),
      periodStart: parsed.data.periodStart,
      periodEnd: parsed.data.periodEnd,
      createdByUserId: actor.userId,
      createdByRole: actor.role,
      snapshot,
    }).returning();
    await addEvent(tx, actor, "report", created.id, "saved", "Informe de dirección guardado.");
    return [created];
  });
  res.status(201).json(publicReport(report));
}));

router.get("/redfp360/direction/reports/:id", route(async (req, res) => {
  const params = api.GetFp360DirectionReportParams.safeParse(req.params);
  if (!params.success) fail(400, "El identificador del informe no es válido.");
  const actor = req.auth!;
  const [report] = await db.select().from(fpDirectionReports).where(and(
    eq(fpDirectionReports.id, params.data.id),
    eq(fpDirectionReports.tenantId, actor.tenantId),
  )).limit(1);
  if (!report) fail(404, "No se encontró el informe en esta empresa.");
  if (!canViewReport(actor, report.createdByUserId, report.createdByRole)) {
    fail(403, "Este informe no está disponible para tu perfil.");
  }
  res.json(publicReport(report));
}));

router.get("/redfp360/direction/events", route(async (req, res) => {
  const parsed = api.ListFp360DirectionEventsQueryParams.safeParse(req.query);
  if (!parsed.success) fail(400, "Los filtros de auditoría no son válidos.");
  const actor = req.auth!;
  const conditions = [
    eq(fpDirectionEvents.tenantId, actor.tenantId),
    ...(parsed.data.entityType ? [eq(fpDirectionEvents.entityType, parsed.data.entityType)] : []),
    ...(parsed.data.entityId ? [eq(fpDirectionEvents.entityId, parsed.data.entityId)] : []),
    ...(!isManager(actor.role) ? [eq(fpDirectionEvents.actorUserId, actor.userId)] : []),
  ];
  const events = await db.select().from(fpDirectionEvents).where(and(...conditions))
    .orderBy(desc(fpDirectionEvents.createdAt)).limit(200);
  res.json(events.map(publicEvent));
}));

const directionErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof DirectionHttpError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
};

router.use(directionErrorHandler);

export default router;

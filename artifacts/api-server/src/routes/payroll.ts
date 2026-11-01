import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  ActOnFp360PayrollRunBody,
  ActOnFp360PayrollRunParams,
  ActOnFp360PayrollRunResponse,
  ActivateFp360PayrollPolicyBody,
  ActivateFp360PayrollPolicyParams,
  ActivateFp360PayrollPolicyResponse,
  CreateFp360PayrollPolicyBody,
  CreateFp360PayrollPolicyResponse,
  CreateFp360PayrollRunBody,
  CreateFp360PayrollRunResponse,
  GetFp360PayrollOverviewQueryParams,
  GetFp360PayrollOverviewResponse,
} from "@workspace/api-zod";
import {
  db,
  fpHrAbsences,
  fpHrEmployees,
  fpOrganizations,
  fpPayrollEvents,
  fpPayrollPolicies,
  fpPayrollRuns,
  type FpPayrollReceiptLine,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
const SIMULATED_DATE = "2027-09-15";
const SIMULATION_YEAR = "2027";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class PayrollError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof PayrollError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 payroll operation failed");
      next(error);
    });
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isTeacher(actor: AuthContext): boolean {
  return ["teacher", "administrator"].includes(actor.role);
}

function validPeriod(periodKey: string): boolean {
  return new RegExp(`^${SIMULATION_YEAR}-(0[1-9]|1[0-2])$`).test(periodKey);
}

function periodBounds(periodKey: string) {
  const [year, month] = periodKey.split("-").map(Number);
  return {
    start: `${periodKey}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

async function resolveOrganization(actor: AuthContext, organizationId: string): Promise<string | null> {
  if (actor.organizationId && actor.organizationId !== organizationId) return null;
  if (!actor.organizationId && !isTeacher(actor)) return null;
  const [organization] = await db.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return organization?.id ?? null;
}

async function priorEvent(actor: AuthContext, operationId: string, requestFingerprint: string) {
  const [event] = await db.select().from(fpPayrollEvents).where(and(
    eq(fpPayrollEvents.tenantId, actor.tenantId),
    eq(fpPayrollEvents.operationId, operationId),
  )).limit(1);
  if (event && (event.actorUserId !== actor.userId || event.requestFingerprint !== requestFingerprint)) {
    throw new PayrollError(409, "El identificador de operación ya se usó con otros datos.");
  }
  return event ?? null;
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  organizationId: string,
  entityId: string,
  operationId: string,
  requestFingerprint: string,
  eventType: string,
  description: string,
) {
  await tx.insert(fpPayrollEvents).values({
    id: randomUUID(), tenantId: actor.tenantId, organizationId, entityId, operationId,
    requestFingerprint, eventType, description, actorUserId: actor.userId, actorName: actor.displayName,
  });
}

function policyResponse(policy: typeof fpPayrollPolicies.$inferSelect) {
  return {
    id: policy.id, organizationId: policy.organizationId, version: policy.version,
    workerSocialSecurityBps: policy.workerSocialSecurityBps,
    employerSocialSecurityBps: policy.employerSocialSecurityBps,
    incomeWithholdingBps: policy.incomeWithholdingBps,
    status: policy.status, createdByName: policy.createdByName, activatedByName: policy.activatedByName,
    createdAt: policy.createdAt.toISOString(), activatedAt: policy.activatedAt?.toISOString() ?? null,
  };
}

function runResponse(run: typeof fpPayrollRuns.$inferSelect) {
  return {
    id: run.id, organizationId: run.organizationId, periodKey: run.periodKey, version: run.version,
    policyId: run.policyId, receiptLines: run.receiptLines, employeeCount: run.employeeCount,
    grossTotalCents: run.grossTotalCents, netTotalCents: run.netTotalCents,
    employerCostTotalCents: run.employerCostTotalCents, status: run.status,
    createdByName: run.createdByName, reviewedByName: run.reviewedByName,
    createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(),
  };
}

router.use("/redfp360/payroll", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/payroll/overview", route(async (request, response) => {
  const query = GetFp360PayrollOverviewQueryParams.safeParse(request.query);
  if (!query.success) {
    response.status(400).json({ error: "Selecciona una organización válida." });
    return;
  }
  const actor = request.auth as AuthContext;
  const organizationId = await resolveOrganization(actor, query.data.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  const [policies, runs, events, employees] = await Promise.all([
    db.select().from(fpPayrollPolicies).where(and(eq(fpPayrollPolicies.tenantId, actor.tenantId), eq(fpPayrollPolicies.organizationId, organizationId))).orderBy(desc(fpPayrollPolicies.version)).limit(50),
    db.select().from(fpPayrollRuns).where(and(eq(fpPayrollRuns.tenantId, actor.tenantId), eq(fpPayrollRuns.organizationId, organizationId))).orderBy(desc(fpPayrollRuns.periodKey), desc(fpPayrollRuns.version)).limit(60),
    db.select().from(fpPayrollEvents).where(and(eq(fpPayrollEvents.tenantId, actor.tenantId), eq(fpPayrollEvents.organizationId, organizationId))).orderBy(desc(fpPayrollEvents.createdAt)).limit(100),
    db.select().from(fpHrEmployees).where(and(eq(fpHrEmployees.tenantId, actor.tenantId), eq(fpHrEmployees.organizationId, organizationId))),
  ]);
  const latestRun = runs[0];
  response.json(GetFp360PayrollOverviewResponse.parse({
    organizationId,
    simulatedDate: SIMULATED_DATE,
    policies: policies.map(policyResponse),
    runs: runs.map(runResponse),
    employees: employees.filter((employee) => employee.status !== "pending").map((employee) => ({
      id: employee.id,
      workerRef: employee.workerRef,
      jobTitle: employee.jobTitle,
      department: employee.department,
      startDate: employee.startDate,
      endDate: employee.endDate,
      annualSalaryCents: employee.annualSalaryCents,
      status: employee.status,
    })),
    events: events.map((event) => ({
      id: event.id, organizationId: event.organizationId, eventType: event.eventType,
      description: event.description, actorName: event.actorName, createdAt: event.createdAt.toISOString(),
    })),
    summary: {
      activeEmployees: employees.filter((employee) => employee.status === "active").length,
      latestRunCount: latestRun?.employeeCount ?? 0,
      latestGrossCents: latestRun?.grossTotalCents ?? 0,
      latestNetCents: latestRun?.netTotalCents ?? 0,
      pendingApprovals: runs.filter((run) => run.status === "draft" || run.status === "reviewed").length
        + policies.filter((policy) => policy.status === "draft").length,
    },
  }));
}));

router.post("/redfp360/payroll/policies", route(async (request, response) => {
  const body = CreateFp360PayrollPolicyBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa los parámetros educativos de cotización y retención." });
    return;
  }
  const actor = request.auth as AuthContext;
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpPayrollPolicies).where(and(eq(fpPayrollPolicies.id, prior.entityId), eq(fpPayrollPolicies.organizationId, organizationId))).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360PayrollPolicyResponse.parse(policyResponse(existing)));
      return;
    }
  }
  const [latest] = await db.select().from(fpPayrollPolicies).where(and(eq(fpPayrollPolicies.tenantId, actor.tenantId), eq(fpPayrollPolicies.organizationId, organizationId))).orderBy(desc(fpPayrollPolicies.version)).limit(1);
  const now = new Date();
  const [created] = await db.transaction(async (tx) => {
    const [policy] = await tx.insert(fpPayrollPolicies).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId,
      version: (latest?.version ?? 0) + 1,
      workerSocialSecurityBps: body.data.workerSocialSecurityBps,
      employerSocialSecurityBps: body.data.employerSocialSecurityBps,
      incomeWithholdingBps: body.data.incomeWithholdingBps,
      status: "draft", operationId: body.data.operationId, requestFingerprint,
      createdByUserId: actor.userId, createdByName: actor.displayName, createdAt: now,
    }).returning();
    if (!policy) throw new PayrollError(500, "No se pudo guardar la política educativa.");
    await appendEvent(tx, actor, organizationId, policy.id, body.data.operationId, requestFingerprint, "policy_draft", `Parámetros educativos v${policy.version} creados como borrador.`);
    return [policy];
  });
  response.status(201).json(CreateFp360PayrollPolicyResponse.parse(policyResponse(created)));
}));

router.post("/redfp360/payroll/policies/:policyId/activate", route(async (request, response) => {
  const params = ActivateFp360PayrollPolicyParams.safeParse(request.params);
  const body = ActivateFp360PayrollPolicyBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "No se pudo validar la política educativa." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "Solo el profesorado o administración puede activar parámetros de nómina." });
    return;
  }
  const [policy] = await db.select().from(fpPayrollPolicies).where(and(eq(fpPayrollPolicies.id, params.data.policyId), eq(fpPayrollPolicies.tenantId, actor.tenantId))).limit(1);
  if (!policy || !await resolveOrganization(actor, policy.organizationId)) {
    response.status(404).json({ error: "No se encontró la política educativa." });
    return;
  }
  const requestFingerprint = fingerprint({ policyId: policy.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [current] = await db.select().from(fpPayrollPolicies).where(eq(fpPayrollPolicies.id, policy.id)).limit(1);
    if (current) {
      response.json(ActivateFp360PayrollPolicyResponse.parse(policyResponse(current)));
      return;
    }
  }
  if (policy.status !== "draft") {
    response.status(409).json({ error: "Solo se pueden activar parámetros en borrador." });
    return;
  }
  const now = new Date();
  const [activated] = await db.transaction(async (tx) => {
    await tx.update(fpPayrollPolicies).set({ status: "archived" }).where(and(
      eq(fpPayrollPolicies.tenantId, actor.tenantId), eq(fpPayrollPolicies.organizationId, policy.organizationId), eq(fpPayrollPolicies.status, "active"),
    ));
    const [saved] = await tx.update(fpPayrollPolicies).set({
      status: "active", activatedByUserId: actor.userId, activatedByName: actor.displayName, activatedAt: now,
    }).where(and(eq(fpPayrollPolicies.id, policy.id), eq(fpPayrollPolicies.status, "draft"))).returning();
    if (!saved) throw new PayrollError(409, "La política cambió mientras se activaba.");
    await appendEvent(tx, actor, policy.organizationId, saved.id, body.data.operationId, requestFingerprint, "policy_activated", `Parámetros educativos v${saved.version} activados.`);
    return [saved];
  });
  response.json(ActivateFp360PayrollPolicyResponse.parse(policyResponse(activated)));
}));

router.post("/redfp360/payroll/runs", route(async (request, response) => {
  const body = CreateFp360PayrollRunBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa el periodo, la política y las variables de cada empleado." });
    return;
  }
  const actor = request.auth as AuthContext;
  const input = body.data;
  const organizationId = await resolveOrganization(actor, input.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  if (!validPeriod(input.periodKey)) {
    response.status(400).json({ error: "El periodo debe pertenecer al escenario educativo de 2027." });
    return;
  }
  const requestFingerprint = fingerprint(input);
  const prior = await priorEvent(actor, input.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpPayrollRuns).where(and(eq(fpPayrollRuns.id, prior.entityId), eq(fpPayrollRuns.organizationId, organizationId))).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360PayrollRunResponse.parse(runResponse(existing)));
      return;
    }
  }
  const [policy] = await db.select().from(fpPayrollPolicies).where(and(
    eq(fpPayrollPolicies.id, input.policyId), eq(fpPayrollPolicies.tenantId, actor.tenantId),
    eq(fpPayrollPolicies.organizationId, organizationId), eq(fpPayrollPolicies.status, "active"),
  )).limit(1);
  if (!policy) {
    response.status(409).json({ error: "Activa primero una política educativa revisada por el profesorado." });
    return;
  }
  const { start: periodStart, end: periodEnd } = periodBounds(input.periodKey);
  const [employees, absences, previousRuns] = await Promise.all([
    db.select().from(fpHrEmployees).where(and(eq(fpHrEmployees.tenantId, actor.tenantId), eq(fpHrEmployees.organizationId, organizationId))),
    db.select().from(fpHrAbsences).where(and(eq(fpHrAbsences.tenantId, actor.tenantId), eq(fpHrAbsences.organizationId, organizationId), eq(fpHrAbsences.status, "approved"))),
    db.select().from(fpPayrollRuns).where(and(eq(fpPayrollRuns.tenantId, actor.tenantId), eq(fpPayrollRuns.organizationId, organizationId), eq(fpPayrollRuns.periodKey, input.periodKey))).orderBy(desc(fpPayrollRuns.version)).limit(1),
  ]);
  const eligibleEmployees = employees.filter((employee) =>
    employee.status !== "pending" && employee.startDate <= periodEnd && (employee.endDate === null || employee.endDate >= periodStart));
  const inputsByEmployee = new Map(input.employeeInputs.map((item) => [item.employeeId, item]));
  if (inputsByEmployee.size !== input.employeeInputs.length
    || eligibleEmployees.length !== input.employeeInputs.length
    || eligibleEmployees.some((employee) => !inputsByEmployee.has(employee.id))) {
    response.status(409).json({ error: "Las variables deben incluir exactamente una fila por empleado con vigencia en el periodo." });
    return;
  }
  const previousRun = previousRuns[0];
  if (previousRun && !["closed", "issued", "payment_prepared", "paid_simulated"].includes(previousRun.status)) {
    response.status(409).json({ error: "Cierra la versión anterior antes de crear un recálculo versionado." });
    return;
  }
  const lines: FpPayrollReceiptLine[] = [];
  for (const employee of eligibleEmployees) {
    const variable = inputsByEmployee.get(employee.id);
    if (!variable) continue;
    const monthlyBaseCents = Math.round(employee.annualSalaryCents / 12);
    const grossCents = monthlyBaseCents + variable.complementCents + variable.absenceAdjustmentCents;
    const netCents = grossCents
      - Math.round(grossCents * policy.workerSocialSecurityBps / 10_000)
      - Math.round(grossCents * policy.incomeWithholdingBps / 10_000)
      - variable.advancesCents - variable.otherDeductionsCents;
    if (grossCents < 0 || netCents < 0) {
      response.status(400).json({ error: `Las variables educativas dejan un líquido negativo para ${employee.workerRef}.` });
      return;
    }
    const contributionBaseCents = grossCents;
    const workerContributionCents = Math.round(contributionBaseCents * policy.workerSocialSecurityBps / 10_000);
    const employerContributionCents = Math.round(contributionBaseCents * policy.employerSocialSecurityBps / 10_000);
    const withholdingCents = Math.round(grossCents * policy.incomeWithholdingBps / 10_000);
    const employeeAbsences = absences.filter((absence) => absence.employeeId === employee.id
      && absence.startDate <= periodEnd && absence.endDate >= periodStart);
    const absenceDays = employeeAbsences.reduce((total, absence) => {
      const from = absence.startDate > periodStart ? absence.startDate : periodStart;
      const to = absence.endDate < periodEnd ? absence.endDate : periodEnd;
      return total + Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    }, 0);
    lines.push({
      employeeId: employee.id,
      workerRef: employee.workerRef,
      absenceDays,
      monthlyBaseCents,
      complementCents: variable.complementCents,
      absenceAdjustmentCents: variable.absenceAdjustmentCents,
      grossCents,
      contributionBaseCents,
      workerContributionCents,
      employerContributionCents,
      withholdingCents,
      advancesCents: variable.advancesCents,
      otherDeductionsCents: variable.otherDeductionsCents,
      netCents,
      employerCostCents: grossCents + employerContributionCents,
      receiptRef: `REC-${input.periodKey.replace("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`,
    });
  }
  const now = new Date();
  const version = (previousRun?.version ?? 0) + 1;
  const [created] = await db.transaction(async (tx) => {
    const [run] = await tx.insert(fpPayrollRuns).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId, periodKey: input.periodKey, version,
      policyId: policy.id, receiptLines: lines, employeeCount: lines.length,
      grossTotalCents: lines.reduce((total, line) => total + line.grossCents, 0),
      netTotalCents: lines.reduce((total, line) => total + line.netCents, 0),
      employerCostTotalCents: lines.reduce((total, line) => total + line.employerCostCents, 0),
      status: "draft", operationId: input.operationId, requestFingerprint,
      createdByUserId: actor.userId, createdByName: actor.displayName, createdAt: now, updatedAt: now,
    }).returning();
    if (!run) throw new PayrollError(500, "No se pudo guardar la nómina simulada.");
    await appendEvent(tx, actor, organizationId, run.id, input.operationId, requestFingerprint, "run_calculated", `Nómina educativa ${input.periodKey} · versión ${version} calculada para ${lines.length} persona(s) ficticia(s).`);
    return [run];
  });
  response.status(201).json(CreateFp360PayrollRunResponse.parse(runResponse(created)));
}));

router.post("/redfp360/payroll/runs/:runId/actions", route(async (request, response) => {
  const params = ActOnFp360PayrollRunParams.safeParse(request.params);
  const body = ActOnFp360PayrollRunBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la transición de la nómina educativa." });
    return;
  }
  const actor = request.auth as AuthContext;
  const [run] = await db.select().from(fpPayrollRuns).where(and(eq(fpPayrollRuns.id, params.data.runId), eq(fpPayrollRuns.tenantId, actor.tenantId))).limit(1);
  if (!run || !await resolveOrganization(actor, run.organizationId)) {
    response.status(404).json({ error: "No se encontró la nómina simulada." });
    return;
  }
  const requestFingerprint = fingerprint({ runId: run.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [current] = await db.select().from(fpPayrollRuns).where(eq(fpPayrollRuns.id, run.id)).limit(1);
    if (current) {
      response.json(ActOnFp360PayrollRunResponse.parse(runResponse(current)));
      return;
    }
  }
  const transitions: Record<string, string> = {
    review: "draft",
    close: "reviewed",
    issue: "closed",
    prepare_payment: "issued",
    mark_paid_simulated: "payment_prepared",
  };
  if (run.status !== transitions[body.data.action]) {
    response.status(409).json({ error: "La acción no corresponde al estado actual de la nómina." });
    return;
  }
  if (["review", "close", "mark_paid_simulated"].includes(body.data.action) && !isTeacher(actor)) {
    response.status(403).json({ error: "Esta transición requiere revisión docente o administrativa." });
    return;
  }
  const nextStatus: Record<string, string> = {
    review: "reviewed", close: "closed", issue: "issued", prepare_payment: "payment_prepared", mark_paid_simulated: "paid_simulated",
  };
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(fpPayrollRuns).set({
      status: nextStatus[body.data.action],
      reviewedByUserId: ["review", "close"].includes(body.data.action) ? actor.userId : run.reviewedByUserId,
      reviewedByName: ["review", "close"].includes(body.data.action) ? actor.displayName : run.reviewedByName,
      updatedAt: now,
    }).where(and(eq(fpPayrollRuns.id, run.id), eq(fpPayrollRuns.status, run.status))).returning();
    if (!saved) throw new PayrollError(409, "La nómina cambió mientras se confirmaba la acción.");
    const descriptions: Record<string, string> = {
      review: "Revisión docente completada.",
      close: "Periodo de nómina cerrado; sus importes quedan congelados.",
      issue: "Recibos educativos emitidos; no son documentos legales.",
      prepare_payment: "Orden de pago preparada en simulación; no se ha enviado a ningún banco.",
      mark_paid_simulated: "Pago marcado como resultado didáctico; no se movió dinero real.",
    };
    await appendEvent(tx, actor, run.organizationId, run.id, body.data.operationId, requestFingerprint,
      `run_${body.data.action}`, `${descriptions[body.data.action]} Nómina ${run.periodKey} v${run.version}.`);
    return [saved];
  });
  response.json(ActOnFp360PayrollRunResponse.parse(runResponse(updated)));
}));

export default router;

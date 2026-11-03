import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  CreateFp360SocialSecurityMovementBody,
  CreateFp360SocialSecurityMovementParams,
  CreateFp360SocialSecurityMovementResponse,
  CreateFp360SocialSecuritySettlementBody,
  CreateFp360SocialSecuritySettlementResponse,
  CreateFp360SocialSecurityWorkerBody,
  CreateFp360SocialSecurityWorkerResponse,
  GetFp360SocialSecurityOverviewQueryParams,
  GetFp360SocialSecurityOverviewResponse,
  ReviewFp360SocialSecurityMovementBody,
  ReviewFp360SocialSecurityMovementParams,
  ReviewFp360SocialSecurityMovementResponse,
  ReviewFp360SocialSecuritySettlementBody,
  ReviewFp360SocialSecuritySettlementParams,
  ReviewFp360SocialSecuritySettlementResponse,
} from "@workspace/api-zod";
import {
  db,
  fpOrganizations,
  fpHrEmployees,
  fpPayrollRuns,
  fpSocialSecurityEvents,
  fpSocialSecurityMovements,
  fpSocialSecuritySettlements,
  fpSocialSecurityWorkers,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
const SIMULATED_DATE = "2027-09-15";
const SCENARIO_START = "2027-01-01";
const SCENARIO_END = "2027-12-31";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class SocialSecurityError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof SocialSecurityError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 social security operation failed");
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

function pathId(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : Array.isArray(value) && value[0]?.trim() ? value[0].trim() : null;
}

function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function validScenarioDate(value: string): boolean {
  return validDate(value) && value >= SCENARIO_START && value <= SCENARIO_END;
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

async function organizationForWorker(actor: AuthContext, workerId: string) {
  const [worker] = await db.select().from(fpSocialSecurityWorkers).where(and(
    eq(fpSocialSecurityWorkers.id, workerId),
    eq(fpSocialSecurityWorkers.tenantId, actor.tenantId),
  )).limit(1);
  if (!worker || !await resolveOrganization(actor, worker.organizationId)) return null;
  return worker;
}

function workerResponse(worker: typeof fpSocialSecurityWorkers.$inferSelect) {
  return {
    id: worker.id,
    organizationId: worker.organizationId,
    hrEmployeeId: worker.hrEmployeeId,
    workerRef: worker.workerRef,
    contributionGroup: worker.contributionGroup,
    contractType: worker.contractType,
    startDate: worker.startDate,
    endDate: worker.endDate,
    monthlyContributionBaseCents: worker.monthlyContributionBaseCents,
    employerContributionCents: worker.employerContributionCents,
    workerContributionCents: worker.workerContributionCents,
    status: worker.status,
    createdByName: worker.createdByName,
    createdAt: worker.createdAt.toISOString(),
    updatedAt: worker.updatedAt.toISOString(),
  };
}

function movementResponse(
  movement: typeof fpSocialSecurityMovements.$inferSelect,
  workerRef: string,
) {
  return {
    id: movement.id,
    organizationId: movement.organizationId,
    workerId: movement.workerId,
    workerRef,
    operationType: movement.operationType,
    effectiveDate: movement.effectiveDate,
    contributionGroup: movement.contributionGroup,
    contractType: movement.contractType,
    monthlyContributionBaseCents: movement.monthlyContributionBaseCents,
    employerContributionCents: movement.employerContributionCents,
    workerContributionCents: movement.workerContributionCents,
    status: movement.status,
    createdByName: movement.createdByName,
    reviewedByName: movement.reviewedByName,
    reviewAction: movement.reviewAction,
    createdAt: movement.createdAt.toISOString(),
    reviewedAt: movement.reviewedAt?.toISOString() ?? null,
  };
}

async function settlementResponse(
  settlement: typeof fpSocialSecuritySettlements.$inferSelect,
  tenantId: string,
) {
  const linkedWorkers = settlement.workerIds.length ? await db.select({
    id: fpSocialSecurityWorkers.id,
    workerRef: fpSocialSecurityWorkers.workerRef,
  }).from(fpSocialSecurityWorkers).where(and(
    eq(fpSocialSecurityWorkers.tenantId, tenantId),
    eq(fpSocialSecurityWorkers.organizationId, settlement.organizationId),
    inArray(fpSocialSecurityWorkers.id, settlement.workerIds),
  )) : [];
  const refMap = new Map(linkedWorkers.map((worker) => [worker.id, worker.workerRef]));
  return {
    id: settlement.id,
    organizationId: settlement.organizationId,
    sourcePayrollRunId: settlement.sourcePayrollRunId,
    periodKey: settlement.periodKey,
    workerRefs: settlement.workerIds.map((id) => refMap.get(id)).filter((ref): ref is string => Boolean(ref)),
    workerCount: settlement.workerCount,
    contributionBaseCents: settlement.contributionBaseCents,
    employerContributionCents: settlement.employerContributionCents,
    workerContributionCents: settlement.workerContributionCents,
    totalContributionCents: settlement.totalContributionCents,
    status: settlement.status,
    createdByName: settlement.createdByName,
    reviewedByName: settlement.reviewedByName,
    createdAt: settlement.createdAt.toISOString(),
    updatedAt: settlement.updatedAt.toISOString(),
  };
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  organizationId: string,
  details: {
    operationId: string;
    requestFingerprint: string;
    eventType: string;
    description: string;
  },
) {
  await tx.insert(fpSocialSecurityEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId,
    operationId: details.operationId,
    requestFingerprint: details.requestFingerprint,
    eventType: details.eventType,
    description: details.description,
    actorUserId: actor.userId,
    actorName: actor.displayName,
  });
}

router.use("/redfp360/social-security", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/social-security/overview", route(async (request, response) => {
  const query = GetFp360SocialSecurityOverviewQueryParams.safeParse(request.query);
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
  const [workers, movements, settlements, events, hrEmployees, payrollRuns] = await Promise.all([
    db.select().from(fpSocialSecurityWorkers).where(and(
      eq(fpSocialSecurityWorkers.tenantId, actor.tenantId),
      eq(fpSocialSecurityWorkers.organizationId, organizationId),
    )).orderBy(desc(fpSocialSecurityWorkers.createdAt)).limit(200),
    db.select().from(fpSocialSecurityMovements).where(and(
      eq(fpSocialSecurityMovements.tenantId, actor.tenantId),
      eq(fpSocialSecurityMovements.organizationId, organizationId),
    )).orderBy(desc(fpSocialSecurityMovements.createdAt)).limit(200),
    db.select().from(fpSocialSecuritySettlements).where(and(
      eq(fpSocialSecuritySettlements.tenantId, actor.tenantId),
      eq(fpSocialSecuritySettlements.organizationId, organizationId),
    )).orderBy(desc(fpSocialSecuritySettlements.periodKey)).limit(36),
    db.select().from(fpSocialSecurityEvents).where(and(
      eq(fpSocialSecurityEvents.tenantId, actor.tenantId),
      eq(fpSocialSecurityEvents.organizationId, organizationId),
    )).orderBy(desc(fpSocialSecurityEvents.createdAt)).limit(100),
    db.select().from(fpHrEmployees).where(and(
      eq(fpHrEmployees.tenantId, actor.tenantId),
      eq(fpHrEmployees.organizationId, organizationId),
      eq(fpHrEmployees.status, "active"),
    )).orderBy(fpHrEmployees.workerRef),
    db.select({
      id: fpPayrollRuns.id,
      periodKey: fpPayrollRuns.periodKey,
      version: fpPayrollRuns.version,
      employeeCount: fpPayrollRuns.employeeCount,
      grossTotalCents: fpPayrollRuns.grossTotalCents,
      status: fpPayrollRuns.status,
    }).from(fpPayrollRuns).where(and(
      eq(fpPayrollRuns.tenantId, actor.tenantId),
      eq(fpPayrollRuns.organizationId, organizationId),
    )).orderBy(desc(fpPayrollRuns.periodKey), desc(fpPayrollRuns.version)),
  ]);
  const linkedEmployeeIds = new Set(workers.map((worker) => worker.hrEmployeeId).filter((id): id is string => id !== null));
  const attachedPayrollRunIds = new Set(settlements.map((settlement) => settlement.sourcePayrollRunId).filter((id): id is string => id !== null));
  const workerRefById = new Map(workers.map((worker) => [worker.id, worker.workerRef]));
  const responseBody = {
    organizationId,
    simulatedDate: SIMULATED_DATE,
    workers: workers.map(workerResponse),
    availableHrEmployees: hrEmployees.filter((employee) => !linkedEmployeeIds.has(employee.id)).map((employee) => ({
      id: employee.id,
      workerRef: employee.workerRef,
      contributionGroup: employee.contributionGroup,
      contractType: employee.contractType,
      startDate: employee.startDate,
      endDate: employee.endDate,
      annualSalaryCents: employee.annualSalaryCents,
    })),
    availablePayrollRuns: payrollRuns.filter((run) =>
      ["closed", "issued", "payment_prepared", "paid_simulated"].includes(run.status)
      && !attachedPayrollRunIds.has(run.id)).map(({ status: _status, ...run }) => run),
    movements: movements.map((movement) => movementResponse(movement, workerRefById.get(movement.workerId) ?? "TRABAJADOR SIMULADO")),
    settlements: await Promise.all(settlements.map((settlement) => settlementResponse(settlement, actor.tenantId))),
    events: events.map((event) => ({
      id: event.id,
      organizationId: event.organizationId,
      eventType: event.eventType,
      description: event.description,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
    summary: {
      activeWorkers: workers.filter((worker) => worker.status === "active").length,
      pendingMovements: movements.filter((movement) => movement.status === "pending_review").length,
      openSettlements: settlements.filter((settlement) => ["draft", "reviewed"].includes(settlement.status)).length,
      monthlyEmployerContributionCents: workers.filter((worker) => worker.status === "active").reduce((sum, worker) => sum + worker.employerContributionCents, 0),
      monthlyWorkerContributionCents: workers.filter((worker) => worker.status === "active").reduce((sum, worker) => sum + worker.workerContributionCents, 0),
    },
  };
  response.json(GetFp360SocialSecurityOverviewResponse.parse(responseBody));
}));

router.post("/redfp360/social-security/workers", route(async (request, response) => {
  const body = CreateFp360SocialSecurityWorkerBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa el grupo, contrato, fechas e importes educativos." });
    return;
  }
  const actor = request.auth as AuthContext;
  const input = body.data;
  const organizationId = await resolveOrganization(actor, input.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  if (!validScenarioDate(input.startDate)) {
    response.status(400).json({ error: "La fecha debe pertenecer al escenario 2027." });
    return;
  }
  const linkedEmployee = input.hrEmployeeId ? (await db.select().from(fpHrEmployees).where(and(
    eq(fpHrEmployees.id, input.hrEmployeeId),
    eq(fpHrEmployees.tenantId, actor.tenantId),
    eq(fpHrEmployees.organizationId, organizationId),
    eq(fpHrEmployees.status, "active"),
  )).limit(1))[0] : undefined;
  if (input.hrEmployeeId && !linkedEmployee) {
    response.status(404).json({ error: "No se encontró una persona activa de Recursos Humanos para esa empresa." });
    return;
  }
  const requestFingerprint = fingerprint(input);
  const [existingMovement] = await db.select().from(fpSocialSecurityMovements).where(and(
    eq(fpSocialSecurityMovements.tenantId, actor.tenantId),
    eq(fpSocialSecurityMovements.operationId, input.operationId),
  )).limit(1);
  if (existingMovement) {
    if (existingMovement.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se usó con otros datos." });
      return;
    }
    const [existingWorker] = await db.select().from(fpSocialSecurityWorkers).where(and(
      eq(fpSocialSecurityWorkers.id, existingMovement.workerId),
      eq(fpSocialSecurityWorkers.tenantId, actor.tenantId),
      eq(fpSocialSecurityWorkers.organizationId, organizationId),
    )).limit(1);
    if (existingWorker) {
      response.status(201).json(CreateFp360SocialSecurityWorkerResponse.parse(workerResponse(existingWorker)));
      return;
    }
  }
  if (linkedEmployee) {
    const [existingLinkedWorker] = await db.select({ id: fpSocialSecurityWorkers.id }).from(fpSocialSecurityWorkers).where(and(
      eq(fpSocialSecurityWorkers.tenantId, actor.tenantId),
      eq(fpSocialSecurityWorkers.organizationId, organizationId),
      eq(fpSocialSecurityWorkers.hrEmployeeId, linkedEmployee.id),
    )).limit(1);
    if (existingLinkedWorker) {
      response.status(409).json({ error: "La persona ya tiene un registro de Seguridad Social vinculado." });
      return;
    }
  }
  const now = new Date();
  const workerRef = `FPSS-${randomUUID().slice(0, 8).toUpperCase()}`;
  const created = await db.transaction(async (tx) => {
    const [worker] = await tx.insert(fpSocialSecurityWorkers).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId,
      hrEmployeeId: linkedEmployee?.id ?? null,
      workerRef: linkedEmployee?.workerRef ?? workerRef,
      contributionGroup: linkedEmployee?.contributionGroup ?? input.contributionGroup,
      contractType: linkedEmployee?.contractType ?? input.contractType,
      startDate: linkedEmployee?.startDate ?? input.startDate,
      endDate: linkedEmployee?.endDate ?? null,
      monthlyContributionBaseCents: input.monthlyContributionBaseCents,
      employerContributionCents: input.employerContributionCents,
      workerContributionCents: input.workerContributionCents,
      status: "pending",
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!worker) throw new SocialSecurityError(500, "No se pudo crear el registro simulado.");
    const movement = {
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId,
      workerId: worker.id,
      operationType: "alta",
      effectiveDate: input.startDate,
      contributionGroup: input.contributionGroup,
      contractType: input.contractType,
      monthlyContributionBaseCents: input.monthlyContributionBaseCents,
      employerContributionCents: input.employerContributionCents,
      workerContributionCents: input.workerContributionCents,
      status: "pending_review",
      operationId: input.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      createdAt: now,
    } as const;
    await tx.insert(fpSocialSecurityMovements).values(movement);
    await appendEvent(tx, actor, organizationId, {
      operationId: input.operationId,
      requestFingerprint,
      eventType: "registration_pending",
      description: `Alta simulada pendiente de revisión · ${worker.workerRef}.`,
    });
    return worker;
  });
  response.status(201).json(CreateFp360SocialSecurityWorkerResponse.parse(workerResponse(created)));
}));

router.post("/redfp360/social-security/workers/:workerId/movements", route(async (request, response) => {
  const params = CreateFp360SocialSecurityMovementParams.safeParse(request.params);
  const body = CreateFp360SocialSecurityMovementBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa el movimiento y la fecha educativa." });
    return;
  }
  const actor = request.auth as AuthContext;
  const worker = await organizationForWorker(actor, params.data.workerId);
  if (!worker) {
    response.status(404).json({ error: "No se encontró el trabajador simulado." });
    return;
  }
  const input = body.data;
  if (!validScenarioDate(input.effectiveDate)) {
    response.status(400).json({ error: "La fecha debe pertenecer al escenario 2027." });
    return;
  }
  if (input.operationType === "alta" && worker.status === "active") {
    response.status(409).json({ error: "El registro ya está activo; usa una variación o una baja simulada." });
    return;
  }
  if (input.operationType !== "alta" && worker.status !== "active") {
    response.status(409).json({ error: "Solo se pueden variar o dar de baja registros activos." });
    return;
  }
  if (input.operationType === "variacion"
    && input.contributionGroup === undefined
    && input.contractType === undefined
    && input.monthlyContributionBaseCents === undefined
    && input.employerContributionCents === undefined
    && input.workerContributionCents === undefined) {
    response.status(400).json({ error: "Indica al menos un cambio educativo para la variación." });
    return;
  }
  const requestFingerprint = fingerprint({ workerId: worker.id, ...input });
  const [prior] = await db.select().from(fpSocialSecurityMovements).where(and(
    eq(fpSocialSecurityMovements.tenantId, actor.tenantId),
    eq(fpSocialSecurityMovements.operationId, input.operationId),
  )).limit(1);
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se usó con otros datos." });
      return;
    }
    response.status(201).json(CreateFp360SocialSecurityMovementResponse.parse(movementResponse(prior, worker.workerRef)));
    return;
  }
  const [pendingMovement] = await db.select({ id: fpSocialSecurityMovements.id }).from(fpSocialSecurityMovements).where(and(
    eq(fpSocialSecurityMovements.tenantId, actor.tenantId),
    eq(fpSocialSecurityMovements.workerId, worker.id),
    eq(fpSocialSecurityMovements.status, "pending_review"),
  )).limit(1);
  if (pendingMovement) {
    response.status(409).json({ error: "Este registro ya tiene un movimiento pendiente de revisión." });
    return;
  }
  const createdAt = new Date();
  const [movement] = await db.transaction(async (tx) => {
    const [newMovement] = await tx.insert(fpSocialSecurityMovements).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId: worker.organizationId,
      workerId: worker.id,
      operationType: input.operationType,
      effectiveDate: input.effectiveDate,
      contributionGroup: input.contributionGroup ?? null,
      contractType: input.contractType ?? null,
      monthlyContributionBaseCents: input.monthlyContributionBaseCents ?? null,
      employerContributionCents: input.employerContributionCents ?? null,
      workerContributionCents: input.workerContributionCents ?? null,
      status: "pending_review",
      operationId: input.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      createdAt,
    }).returning();
    if (!newMovement) throw new SocialSecurityError(500, "No se pudo crear el movimiento simulado.");
    await appendEvent(tx, actor, worker.organizationId, {
      operationId: input.operationId,
      requestFingerprint,
      eventType: `${input.operationType}_pending`,
      description: `Movimiento ${input.operationType} pendiente de revisión · ${worker.workerRef}.`,
    });
    return [newMovement];
  });
  response.status(201).json(CreateFp360SocialSecurityMovementResponse.parse(movementResponse(movement, worker.workerRef)));
}));

router.post("/redfp360/social-security/movements/:movementId/review", route(async (request, response) => {
  const params = ReviewFp360SocialSecurityMovementParams.safeParse(request.params);
  const body = ReviewFp360SocialSecurityMovementBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción de revisión." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "Solo el profesorado o administración puede revisar movimientos." });
    return;
  }
  const [movement] = await db.select().from(fpSocialSecurityMovements).where(and(
    eq(fpSocialSecurityMovements.id, params.data.movementId),
    eq(fpSocialSecurityMovements.tenantId, actor.tenantId),
  )).limit(1);
  if (!movement || !await resolveOrganization(actor, movement.organizationId)) {
    response.status(404).json({ error: "No se encontró el movimiento simulado." });
    return;
  }
  const [worker] = await db.select().from(fpSocialSecurityWorkers).where(and(
    eq(fpSocialSecurityWorkers.id, movement.workerId),
    eq(fpSocialSecurityWorkers.tenantId, actor.tenantId),
  )).limit(1);
  if (!worker) {
    response.status(404).json({ error: "No se encontró el registro asociado." });
    return;
  }
  const requestFingerprint = fingerprint({ movementId: movement.id, ...body.data });
  const [priorEvent] = await db.select().from(fpSocialSecurityEvents).where(and(
    eq(fpSocialSecurityEvents.tenantId, actor.tenantId),
    eq(fpSocialSecurityEvents.operationId, body.data.operationId),
  )).limit(1);
  if (priorEvent) {
    if (priorEvent.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se usó con otros datos." });
      return;
    }
    const [current] = await db.select().from(fpSocialSecurityMovements).where(eq(fpSocialSecurityMovements.id, movement.id)).limit(1);
    if (current) {
      response.json(ReviewFp360SocialSecurityMovementResponse.parse(movementResponse(current, worker.workerRef)));
      return;
    }
  }
  if (movement.status !== "pending_review") {
    response.status(409).json({ error: "El movimiento ya fue revisado." });
    return;
  }
  const reviewedAt = new Date();
  const updated = await db.transaction(async (tx) => {
    if (body.data.action === "approve") {
      const workerChanges: Partial<typeof fpSocialSecurityWorkers.$inferInsert> = {
        updatedAt: reviewedAt,
      };
      if (movement.operationType === "alta") {
        workerChanges.status = "active";
        workerChanges.startDate = movement.effectiveDate;
        workerChanges.endDate = null;
      } else if (movement.operationType === "baja") {
        workerChanges.status = "inactive";
        workerChanges.endDate = movement.effectiveDate;
      }
      if (movement.contributionGroup !== null) workerChanges.contributionGroup = movement.contributionGroup;
      if (movement.contractType !== null) workerChanges.contractType = movement.contractType;
      if (movement.monthlyContributionBaseCents !== null) workerChanges.monthlyContributionBaseCents = movement.monthlyContributionBaseCents;
      if (movement.employerContributionCents !== null) workerChanges.employerContributionCents = movement.employerContributionCents;
      if (movement.workerContributionCents !== null) workerChanges.workerContributionCents = movement.workerContributionCents;
      await tx.update(fpSocialSecurityWorkers).set(workerChanges).where(and(
        eq(fpSocialSecurityWorkers.id, worker.id),
        eq(fpSocialSecurityWorkers.tenantId, actor.tenantId),
        eq(fpSocialSecurityWorkers.organizationId, movement.organizationId),
      ));
    }
    const [reviewed] = await tx.update(fpSocialSecurityMovements).set({
      status: body.data.action === "approve" ? "approved" : "observed",
      reviewedByUserId: actor.userId,
      reviewedByName: actor.displayName,
      reviewAction: body.data.action,
      reviewedAt,
    }).where(and(
      eq(fpSocialSecurityMovements.id, movement.id),
      eq(fpSocialSecurityMovements.tenantId, actor.tenantId),
      eq(fpSocialSecurityMovements.status, "pending_review"),
    )).returning();
    if (!reviewed) throw new SocialSecurityError(409, "El movimiento cambió mientras se revisaba.");
    await appendEvent(tx, actor, movement.organizationId, {
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: `movement_${body.data.action}`,
      description: `Movimiento ${movement.operationType} ${body.data.action === "approve" ? "aprobado" : "observado"} · ${worker.workerRef}.`,
    });
    return reviewed;
  });
  response.json(ReviewFp360SocialSecurityMovementResponse.parse(movementResponse(updated, worker.workerRef)));
}));

router.post("/redfp360/social-security/settlements", route(async (request, response) => {
  const body = CreateFp360SocialSecuritySettlementBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Indica organización, mes e identificador de operación válidos." });
    return;
  }
  const actor = request.auth as AuthContext;
  const input = body.data;
  const organizationId = await resolveOrganization(actor, input.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  if (!input.periodKey.startsWith("2027-")) {
    response.status(400).json({ error: "El periodo debe pertenecer al escenario educativo de 2027." });
    return;
  }
  const requestFingerprint = fingerprint(input);
  const [prior] = await db.select().from(fpSocialSecuritySettlements).where(and(
    eq(fpSocialSecuritySettlements.tenantId, actor.tenantId),
    eq(fpSocialSecuritySettlements.operationId, input.operationId),
  )).limit(1);
  if (prior) {
    if (prior.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se usó con otros datos." });
      return;
    }
    response.status(201).json(CreateFp360SocialSecuritySettlementResponse.parse(await settlementResponse(prior, actor.tenantId)));
    return;
  }
  const [existingPeriod] = await db.select().from(fpSocialSecuritySettlements).where(and(
    eq(fpSocialSecuritySettlements.tenantId, actor.tenantId),
    eq(fpSocialSecuritySettlements.organizationId, organizationId),
    eq(fpSocialSecuritySettlements.periodKey, input.periodKey),
  )).limit(1);
  if (existingPeriod) {
    response.status(409).json({ error: "Ya existe un resumen educativo para ese mes; revisa el registro existente." });
    return;
  }
  const monthStart = `${input.periodKey}-01`;
  const monthEnd = new Date(Date.UTC(Number(input.periodKey.slice(0, 4)), Number(input.periodKey.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const workers = await db.select().from(fpSocialSecurityWorkers).where(and(
    eq(fpSocialSecurityWorkers.tenantId, actor.tenantId),
    eq(fpSocialSecurityWorkers.organizationId, organizationId),
  ));
  const eligible = workers.filter((worker) =>
    worker.status !== "pending"
    && worker.startDate <= monthEnd
    && (worker.endDate === null || worker.endDate >= monthStart));
  if (!eligible.length) {
    response.status(409).json({ error: "No hay registros activos o con vigencia en ese mes para generar el resumen." });
    return;
  }
  let sourcePayrollRun: typeof fpPayrollRuns.$inferSelect | null = null;
  let selectedWorkers = eligible;
  let workerCount = eligible.length;
  let contributionBaseCents = eligible.reduce((sum, worker) => sum + worker.monthlyContributionBaseCents, 0);
  let employerContributionCents = eligible.reduce((sum, worker) => sum + worker.employerContributionCents, 0);
  let workerContributionCents = eligible.reduce((sum, worker) => sum + worker.workerContributionCents, 0);
  if (input.payrollRunId) {
    const [payrollRun] = await db.select().from(fpPayrollRuns).where(and(
      eq(fpPayrollRuns.id, input.payrollRunId),
      eq(fpPayrollRuns.tenantId, actor.tenantId),
      eq(fpPayrollRuns.organizationId, organizationId),
    )).limit(1);
    if (!payrollRun) {
      response.status(404).json({ error: "No se encontró la nómina de esa empresa." });
      return;
    }
    if (payrollRun.periodKey !== input.periodKey
      || !["closed", "issued", "payment_prepared", "paid_simulated"].includes(payrollRun.status)) {
      response.status(409).json({ error: "Solo se pueden importar nóminas del mismo mes ya cerradas y revisadas." });
      return;
    }
    const [existingSource] = await db.select({ id: fpSocialSecuritySettlements.id }).from(fpSocialSecuritySettlements).where(and(
      eq(fpSocialSecuritySettlements.tenantId, actor.tenantId),
      eq(fpSocialSecuritySettlements.organizationId, organizationId),
      eq(fpSocialSecuritySettlements.sourcePayrollRunId, payrollRun.id),
    )).limit(1);
    if (existingSource) {
      response.status(409).json({ error: "Esta nómina ya está vinculada a un resumen mensual." });
      return;
    }
    const payrollEmployeeIds = payrollRun.receiptLines.map((line) => line.employeeId);
    if (new Set(payrollEmployeeIds).size !== payrollEmployeeIds.length) {
      response.status(409).json({ error: "La nómina contiene referencias laborales duplicadas; revísala antes de importar." });
      return;
    }
    selectedWorkers = payrollEmployeeIds.length ? await db.select().from(fpSocialSecurityWorkers).where(and(
      eq(fpSocialSecurityWorkers.tenantId, actor.tenantId),
      eq(fpSocialSecurityWorkers.organizationId, organizationId),
      inArray(fpSocialSecurityWorkers.hrEmployeeId, payrollEmployeeIds),
      eq(fpSocialSecurityWorkers.status, "active"),
    )) : [];
    if (selectedWorkers.length !== payrollRun.receiptLines.length
      || selectedWorkers.some((worker) => worker.startDate > monthEnd || (worker.endDate !== null && worker.endDate < monthStart))) {
      response.status(409).json({ error: "Vincula y aprueba en Seguridad Social a todas las personas incluidas en la nómina antes de importarla." });
      return;
    }
    const selectedWorkerIds = new Set(selectedWorkers.map((worker) => worker.hrEmployeeId));
    const payrollLines = payrollRun.receiptLines.filter((line) => selectedWorkerIds.has(line.employeeId));
    sourcePayrollRun = payrollRun;
    workerCount = payrollLines.length;
    contributionBaseCents = payrollLines.reduce((sum, line) => sum + line.contributionBaseCents, 0);
    employerContributionCents = payrollLines.reduce((sum, line) => sum + line.employerContributionCents, 0);
    workerContributionCents = payrollLines.reduce((sum, line) => sum + line.workerContributionCents, 0);
  }
  const now = new Date();
  const settlement = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpSocialSecuritySettlements).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      organizationId,
      sourcePayrollRunId: sourcePayrollRun?.id ?? null,
      periodKey: input.periodKey,
      workerIds: selectedWorkers.map((worker) => worker.id),
      workerCount,
      contributionBaseCents,
      employerContributionCents,
      workerContributionCents,
      totalContributionCents: employerContributionCents + workerContributionCents,
      status: "draft",
      operationId: input.operationId,
      requestFingerprint,
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
      createdAt: now,
      updatedAt: now,
    }).returning();
    if (!created) throw new SocialSecurityError(500, "No se pudo crear el resumen mensual.");
    await appendEvent(tx, actor, organizationId, {
      operationId: input.operationId,
      requestFingerprint,
      eventType: sourcePayrollRun ? "settlement_from_payroll" : "settlement_created",
      description: sourcePayrollRun
        ? `Resumen educativo ${input.periodKey} importado desde nómina ${sourcePayrollRun.id} v${sourcePayrollRun.version}.`
        : `Resumen educativo ${input.periodKey} creado para ${selectedWorkers.length} registro(s) simulado(s).`,
    });
    return created;
  });
  response.status(201).json(CreateFp360SocialSecuritySettlementResponse.parse(await settlementResponse(settlement, actor.tenantId)));
}));

router.post("/redfp360/social-security/settlements/:settlementId/review", route(async (request, response) => {
  const params = ReviewFp360SocialSecuritySettlementParams.safeParse(request.params);
  const body = ReviewFp360SocialSecuritySettlementBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción de revisión del resumen." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "Solo el profesorado o administración puede revisar los resúmenes." });
    return;
  }
  const [settlement] = await db.select().from(fpSocialSecuritySettlements).where(and(
    eq(fpSocialSecuritySettlements.id, params.data.settlementId),
    eq(fpSocialSecuritySettlements.tenantId, actor.tenantId),
  )).limit(1);
  if (!settlement || !await resolveOrganization(actor, settlement.organizationId)) {
    response.status(404).json({ error: "No se encontró el resumen simulado." });
    return;
  }
  const requestFingerprint = fingerprint({ settlementId: settlement.id, ...body.data });
  const [priorEvent] = await db.select().from(fpSocialSecurityEvents).where(and(
    eq(fpSocialSecurityEvents.tenantId, actor.tenantId),
    eq(fpSocialSecurityEvents.operationId, body.data.operationId),
  )).limit(1);
  if (priorEvent) {
    if (priorEvent.requestFingerprint !== requestFingerprint) {
      response.status(409).json({ error: "El identificador de operación ya se usó con otros datos." });
      return;
    }
    const [current] = await db.select().from(fpSocialSecuritySettlements).where(eq(fpSocialSecuritySettlements.id, settlement.id)).limit(1);
    if (current) {
      response.json(ReviewFp360SocialSecuritySettlementResponse.parse(await settlementResponse(current, actor.tenantId)));
      return;
    }
  }
  if ((body.data.action === "review" && settlement.status !== "draft")
    || (body.data.action === "close" && settlement.status !== "reviewed")) {
    response.status(409).json({ error: body.data.action === "review"
      ? "Solo se puede revisar un resumen en borrador."
      : "Solo se puede cerrar una revisión docente." });
    return;
  }
  const updatedAt = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(fpSocialSecuritySettlements).set({
      status: body.data.action === "review" ? "reviewed" : "closed_simulated",
      reviewedByUserId: actor.userId,
      reviewedByName: actor.displayName,
      updatedAt,
    }).where(and(
      eq(fpSocialSecuritySettlements.id, settlement.id),
      eq(fpSocialSecuritySettlements.tenantId, actor.tenantId),
      eq(fpSocialSecuritySettlements.status, settlement.status),
    )).returning();
    if (!saved) throw new SocialSecurityError(409, "El resumen cambió mientras se revisaba.");
    await appendEvent(tx, actor, settlement.organizationId, {
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: `settlement_${body.data.action}`,
      description: `Resumen ${settlement.periodKey} ${body.data.action === "review" ? "revisado" : "cerrado en simulación"}.`,
    });
    return [saved];
  });
  response.json(ReviewFp360SocialSecuritySettlementResponse.parse(await settlementResponse(updated, actor.tenantId)));
}));

export default router;

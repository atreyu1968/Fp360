import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  CreateFp360HrAbsenceBody,
  CreateFp360HrAbsenceParams,
  CreateFp360HrAbsenceResponse,
  CreateFp360HrCandidateBody,
  CreateFp360HrCandidateParams,
  CreateFp360HrCandidateResponse,
  CreateFp360HrContractBody,
  CreateFp360HrContractParams,
  CreateFp360HrContractResponse,
  CreateFp360HrEmployeeBody,
  CreateFp360HrEmployeeResponse,
  CreateFp360HrTerminationBody,
  CreateFp360HrTerminationParams,
  CreateFp360HrTerminationResponse,
  CreateFp360HrVacancyBody,
  CreateFp360HrVacancyResponse,
  DecideFp360HrCandidateBody,
  DecideFp360HrCandidateParams,
  DecideFp360HrCandidateResponse,
  GetFp360HrOverviewQueryParams,
  GetFp360HrOverviewResponse,
  ReviewFp360HrAbsenceBody,
  ReviewFp360HrAbsenceParams,
  ReviewFp360HrAbsenceResponse,
  ReviewFp360HrContractBody,
  ReviewFp360HrContractParams,
  ReviewFp360HrContractResponse,
  ReviewFp360HrTerminationBody,
  ReviewFp360HrTerminationParams,
  ReviewFp360HrTerminationResponse,
} from "@workspace/api-zod";
import {
  db,
  fpHrAbsences,
  fpHrCandidates,
  fpHrContracts,
  fpHrEmployees,
  fpHrEvents,
  fpHrLifecycleChanges,
  fpHrVacancies,
  fpOrganizations,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
const SIMULATED_DATE = "2027-09-15";
const SCENARIO_START = "2027-01-01";
const SCENARIO_END = "2027-12-31";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class HrError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof HrError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 HR operation failed");
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

async function employeeFor(actor: AuthContext, employeeId: string) {
  const [employee] = await db.select().from(fpHrEmployees).where(and(
    eq(fpHrEmployees.id, employeeId),
    eq(fpHrEmployees.tenantId, actor.tenantId),
  )).limit(1);
  if (!employee || !await resolveOrganization(actor, employee.organizationId)) return null;
  return employee;
}

async function priorEvent(actor: AuthContext, operationId: string, requestFingerprint: string) {
  const [event] = await db.select().from(fpHrEvents).where(and(
    eq(fpHrEvents.tenantId, actor.tenantId),
    eq(fpHrEvents.operationId, operationId),
  )).limit(1);
  if (event && event.requestFingerprint !== requestFingerprint) {
    throw new HrError(409, "El identificador de operación ya se usó con otros datos.");
  }
  return event ?? null;
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  organizationId: string,
  details: { operationId: string; requestFingerprint: string; entityId: string; eventType: string; description: string },
) {
  await tx.insert(fpHrEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId,
    operationId: details.operationId,
    requestFingerprint: details.requestFingerprint,
    entityId: details.entityId,
    eventType: details.eventType,
    description: details.description,
    actorUserId: actor.userId,
    actorName: actor.displayName,
  });
}

function vacancyResponse(row: typeof fpHrVacancies.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function candidateResponse(row: typeof fpHrCandidates.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

function employeeResponse(row: typeof fpHrEmployees.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function contractResponse(row: typeof fpHrContracts.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

async function absenceResponse(row: typeof fpHrAbsences.$inferSelect, workerRef?: string) {
  const [employee] = workerRef ? [] : await db.select({ workerRef: fpHrEmployees.workerRef }).from(fpHrEmployees).where(and(
    eq(fpHrEmployees.id, row.employeeId),
    eq(fpHrEmployees.tenantId, row.tenantId),
  )).limit(1);
  return {
    id: row.id,
    organizationId: row.organizationId,
    employeeId: row.employeeId,
    workerRef: workerRef ?? employee?.workerRef ?? "EMPLEADO SIMULADO",
    absenceType: row.absenceType,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    reviewAction: row.reviewAction,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

async function lifecycleResponse(row: typeof fpHrLifecycleChanges.$inferSelect, workerRef?: string) {
  const [employee] = workerRef ? [] : await db.select({ workerRef: fpHrEmployees.workerRef }).from(fpHrEmployees).where(and(
    eq(fpHrEmployees.id, row.employeeId),
    eq(fpHrEmployees.tenantId, row.tenantId),
  )).limit(1);
  return {
    id: row.id,
    organizationId: row.organizationId,
    employeeId: row.employeeId,
    workerRef: workerRef ?? employee?.workerRef ?? "EMPLEADO SIMULADO",
    changeType: row.changeType,
    effectiveDate: row.effectiveDate,
    status: row.status,
    createdByName: row.createdByName,
    reviewedByName: row.reviewedByName,
    reviewAction: row.reviewAction,
    createdAt: row.createdAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

router.use("/redfp360/hr", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/hr/overview", route(async (request, response) => {
  const query = GetFp360HrOverviewQueryParams.safeParse(request.query);
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
  const [vacancies, candidates, employees, contracts, absenceRows, lifecycleChanges, events] = await Promise.all([
    db.select().from(fpHrVacancies).where(and(eq(fpHrVacancies.tenantId, actor.tenantId), eq(fpHrVacancies.organizationId, organizationId))).orderBy(desc(fpHrVacancies.createdAt)).limit(100),
    db.select().from(fpHrCandidates).where(and(eq(fpHrCandidates.tenantId, actor.tenantId), eq(fpHrCandidates.organizationId, organizationId))).orderBy(desc(fpHrCandidates.createdAt)).limit(200),
    db.select().from(fpHrEmployees).where(and(eq(fpHrEmployees.tenantId, actor.tenantId), eq(fpHrEmployees.organizationId, organizationId))).orderBy(desc(fpHrEmployees.createdAt)).limit(200),
    db.select().from(fpHrContracts).where(and(eq(fpHrContracts.tenantId, actor.tenantId), eq(fpHrContracts.organizationId, organizationId))).orderBy(desc(fpHrContracts.createdAt)).limit(300),
    db.select().from(fpHrAbsences).where(and(eq(fpHrAbsences.tenantId, actor.tenantId), eq(fpHrAbsences.organizationId, organizationId))).orderBy(desc(fpHrAbsences.createdAt)).limit(200),
    db.select().from(fpHrLifecycleChanges).where(and(eq(fpHrLifecycleChanges.tenantId, actor.tenantId), eq(fpHrLifecycleChanges.organizationId, organizationId))).orderBy(desc(fpHrLifecycleChanges.createdAt)).limit(100),
    db.select().from(fpHrEvents).where(and(eq(fpHrEvents.tenantId, actor.tenantId), eq(fpHrEvents.organizationId, organizationId))).orderBy(desc(fpHrEvents.createdAt)).limit(100),
  ]);
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const today = SIMULATED_DATE;
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 60);
  const soonDate = soon.toISOString().slice(0, 10);
  const responseBody = {
    organizationId,
    simulatedDate: SIMULATED_DATE,
    vacancies: vacancies.map(vacancyResponse),
    candidates: candidates.map(candidateResponse),
    employees: employees.map(employeeResponse),
    contracts: contracts.map(contractResponse),
    absences: await Promise.all(absenceRows.map((row) => absenceResponse(row, employeeById.get(row.employeeId)?.workerRef))),
    lifecycleChanges: await Promise.all(lifecycleChanges.map((row) => lifecycleResponse(row, employeeById.get(row.employeeId)?.workerRef))),
    events: events.map((event) => ({
      id: event.id,
      organizationId: event.organizationId,
      eventType: event.eventType,
      description: event.description,
      actorName: event.actorName,
      createdAt: event.createdAt.toISOString(),
    })),
    summary: {
      activeEmployees: employees.filter((employee) => employee.status === "active").length,
      openVacancies: vacancies.filter((vacancy) => vacancy.status === "open").length,
      pendingContracts: contracts.filter((contract) => contract.status === "pending_review").length,
      pendingAbsences: absenceRows.filter((absence) => absence.status === "pending_review").length,
      contractsExpiringSoon: employees.filter((employee) => employee.status === "active" && employee.endDate !== null && employee.endDate >= today && employee.endDate <= soonDate).length,
    },
  };
  response.json(GetFp360HrOverviewResponse.parse(responseBody));
}));

router.post("/redfp360/hr/vacancies", route(async (request, response) => {
  const body = CreateFp360HrVacancyBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa el perfil de la vacante y la organización." });
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
    const [existing] = await db.select().from(fpHrVacancies).where(and(eq(fpHrVacancies.id, prior.entityId), eq(fpHrVacancies.organizationId, organizationId))).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360HrVacancyResponse.parse(vacancyResponse(existing)));
      return;
    }
  }
  const now = new Date();
  const [created] = await db.transaction(async (tx) => {
    const [vacancy] = await tx.insert(fpHrVacancies).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId,
      jobTitle: body.data.jobTitle.trim(), department: body.data.department.trim(),
      contractType: body.data.contractType, description: body.data.description.trim(),
      status: "open", createdByUserId: actor.userId, createdByName: actor.displayName,
      createdAt: now, updatedAt: now,
    }).returning();
    if (!vacancy) throw new HrError(500, "No se pudo crear la vacante.");
    await appendEvent(tx, actor, organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: vacancy.id,
      eventType: "vacancy_opened", description: `Vacante ficticia abierta · ${vacancy.jobTitle}.`,
    });
    return [vacancy];
  });
  response.status(201).json(CreateFp360HrVacancyResponse.parse(vacancyResponse(created)));
}));

router.post("/redfp360/hr/vacancies/:vacancyId/candidates", route(async (request, response) => {
  const params = CreateFp360HrCandidateParams.safeParse(request.params);
  const body = CreateFp360HrCandidateBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa las puntuaciones objetivas de la candidatura ficticia." });
    return;
  }
  const actor = request.auth as AuthContext;
  const [vacancy] = await db.select().from(fpHrVacancies).where(and(
    eq(fpHrVacancies.id, params.data.vacancyId),
    eq(fpHrVacancies.tenantId, actor.tenantId),
  )).limit(1);
  if (!vacancy || !await resolveOrganization(actor, vacancy.organizationId)) {
    response.status(404).json({ error: "No se encontró la vacante." });
    return;
  }
  const requestFingerprint = fingerprint({ vacancyId: vacancy.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrCandidates).where(and(eq(fpHrCandidates.id, prior.entityId), eq(fpHrCandidates.organizationId, vacancy.organizationId))).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360HrCandidateResponse.parse(candidateResponse(existing)));
      return;
    }
  }
  if (vacancy.status !== "open") {
    response.status(409).json({ error: "Solo se pueden añadir candidaturas a vacantes abiertas." });
    return;
  }
  const now = new Date();
  const [created] = await db.transaction(async (tx) => {
    const candidate = {
      id: randomUUID(), tenantId: actor.tenantId, organizationId: vacancy.organizationId, vacancyId: vacancy.id,
      candidateRef: `CAND-${randomUUID().slice(0, 8).toUpperCase()}`,
      trainingScore: body.data.trainingScore, skillsScore: body.data.skillsScore,
      availabilityScore: body.data.availabilityScore, status: "received",
      createdByUserId: actor.userId, createdByName: actor.displayName, createdAt: now,
    };
    const [saved] = await tx.insert(fpHrCandidates).values(candidate).returning();
    if (!saved) throw new HrError(500, "No se pudo guardar la candidatura ficticia.");
    await appendEvent(tx, actor, vacancy.organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: saved.id,
      eventType: "candidate_received", description: `Candidatura ficticia recibida · ${saved.candidateRef}.`,
    });
    return [saved];
  });
  response.status(201).json(CreateFp360HrCandidateResponse.parse(candidateResponse(created)));
}));

router.post("/redfp360/hr/candidates/:candidateId/decision", route(async (request, response) => {
  const params = DecideFp360HrCandidateParams.safeParse(request.params);
  const body = DecideFp360HrCandidateBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la decisión de selección." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "La selección requiere revisión docente o administrativa." });
    return;
  }
  const [candidate] = await db.select().from(fpHrCandidates).where(and(
    eq(fpHrCandidates.id, params.data.candidateId),
    eq(fpHrCandidates.tenantId, actor.tenantId),
  )).limit(1);
  if (!candidate || !await resolveOrganization(actor, candidate.organizationId)) {
    response.status(404).json({ error: "No se encontró la candidatura." });
    return;
  }
  const requestFingerprint = fingerprint({ candidateId: candidate.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrCandidates).where(eq(fpHrCandidates.id, candidate.id)).limit(1);
    if (existing) {
      response.json(DecideFp360HrCandidateResponse.parse(candidateResponse(existing)));
      return;
    }
  }
  if (candidate.status !== "received") {
    response.status(409).json({ error: "La candidatura ya tiene una decisión." });
    return;
  }
  const [otherSelected] = body.data.action === "select" ? await db.select({ id: fpHrCandidates.id }).from(fpHrCandidates).where(and(
    eq(fpHrCandidates.tenantId, actor.tenantId),
    eq(fpHrCandidates.vacancyId, candidate.vacancyId),
    eq(fpHrCandidates.status, "selected"),
  )).limit(1) : [];
  if (otherSelected) {
    response.status(409).json({ error: "La vacante ya tiene una candidatura seleccionada." });
    return;
  }
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(fpHrCandidates).set({
      status: body.data.action === "select" ? "selected" : "rejected",
      reviewedByUserId: actor.userId, reviewedByName: actor.displayName, reviewedAt: now,
    }).where(and(eq(fpHrCandidates.id, candidate.id), eq(fpHrCandidates.status, "received"))).returning();
    if (!saved) throw new HrError(409, "La candidatura cambió mientras se revisaba.");
    if (body.data.action === "select") {
      await tx.update(fpHrVacancies).set({ status: "filled", updatedAt: now }).where(eq(fpHrVacancies.id, candidate.vacancyId));
    }
    await appendEvent(tx, actor, candidate.organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: saved.id,
      eventType: `candidate_${body.data.action}`,
      description: `Candidatura ${saved.candidateRef} ${body.data.action === "select" ? "seleccionada" : "no seleccionada"} con criterios objetivos.`,
    });
    return [saved];
  });
  response.json(DecideFp360HrCandidateResponse.parse(candidateResponse(updated)));
}));

router.post("/redfp360/hr/employees", route(async (request, response) => {
  const body = CreateFp360HrEmployeeBody.safeParse(request.body);
  if (!body.success) {
    response.status(400).json({ error: "Revisa las condiciones educativas, la fecha y la candidatura." });
    return;
  }
  const actor = request.auth as AuthContext;
  const organizationId = await resolveOrganization(actor, body.data.organizationId);
  if (!organizationId) {
    response.status(403).json({ error: "No tienes acceso a la organización seleccionada." });
    return;
  }
  if (!validScenarioDate(body.data.startDate) || (body.data.endDate && (!validScenarioDate(body.data.endDate) || body.data.endDate < body.data.startDate))) {
    response.status(400).json({ error: "Comprueba que las fechas estén en 2027 y sean coherentes." });
    return;
  }
  const requestFingerprint = fingerprint(body.data);
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrEmployees).where(and(eq(fpHrEmployees.id, prior.entityId), eq(fpHrEmployees.organizationId, organizationId))).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360HrEmployeeResponse.parse(employeeResponse(existing)));
      return;
    }
  }
  const [candidate] = await db.select().from(fpHrCandidates).where(and(
    eq(fpHrCandidates.id, body.data.candidateId),
    eq(fpHrCandidates.tenantId, actor.tenantId),
    eq(fpHrCandidates.organizationId, organizationId),
    eq(fpHrCandidates.status, "selected"),
  )).limit(1);
  if (!candidate) {
    response.status(409).json({ error: "Solo se puede iniciar expediente desde una candidatura seleccionada." });
    return;
  }
  const [vacancy] = await db.select().from(fpHrVacancies).where(and(eq(fpHrVacancies.id, candidate.vacancyId), eq(fpHrVacancies.tenantId, actor.tenantId))).limit(1);
  if (!vacancy) {
    response.status(404).json({ error: "No se encontró la vacante de origen." });
    return;
  }
  const now = new Date();
  const created = await db.transaction(async (tx) => {
    const workerRef = `FP-EMP-${randomUUID().slice(0, 8).toUpperCase()}`;
    const [employee] = await tx.insert(fpHrEmployees).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId, candidateId: candidate.id,
      workerRef, jobTitle: vacancy.jobTitle, department: vacancy.department, contractType: vacancy.contractType,
      weeklyHours: body.data.weeklyHours, contributionGroup: body.data.contributionGroup,
      annualSalaryCents: body.data.annualSalaryCents, conventionName: body.data.conventionName.trim(),
      virtualBankRef: `VB-${randomUUID().slice(0, 8).toUpperCase()}`,
      startDate: body.data.startDate, endDate: body.data.endDate ?? null, status: "pending",
      createdByUserId: actor.userId, createdByName: actor.displayName, createdAt: now, updatedAt: now,
    }).returning();
    if (!employee) throw new HrError(500, "No se pudo crear el expediente ficticio.");
    await tx.insert(fpHrContracts).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId, employeeId: employee.id, version: 1,
      documentType: "initial", effectiveDate: body.data.startDate, endDate: body.data.endDate ?? null,
      contractType: vacancy.contractType, weeklyHours: body.data.weeklyHours,
      annualSalaryCents: body.data.annualSalaryCents, contributionGroup: body.data.contributionGroup,
      conventionName: body.data.conventionName.trim(), status: "pending_review",
      operationId: body.data.operationId, requestFingerprint,
      createdByUserId: actor.userId, createdByName: actor.displayName, createdAt: now, updatedAt: now,
    });
    await appendEvent(tx, actor, organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: employee.id,
      eventType: "employee_pending", description: `Expediente ${workerRef} y contrato educativo enviados a revisión.`,
    });
    return employee;
  });
  response.status(201).json(CreateFp360HrEmployeeResponse.parse(employeeResponse(created)));
}));

router.post("/redfp360/hr/employees/:employeeId/contracts", route(async (request, response) => {
  const params = CreateFp360HrContractParams.safeParse(request.params);
  const body = CreateFp360HrContractBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa los términos educativos del contrato." });
    return;
  }
  const actor = request.auth as AuthContext;
  const employee = await employeeFor(actor, params.data.employeeId);
  if (!employee) {
    response.status(404).json({ error: "No se encontró el expediente ficticio." });
    return;
  }
  const input = body.data;
  if (!validScenarioDate(input.effectiveDate) || input.effectiveDate < employee.startDate
    || (input.endDate && (!validScenarioDate(input.endDate) || input.endDate < input.effectiveDate))) {
    response.status(400).json({ error: "Las fechas del cambio deben estar en 2027 y no ser retroactivas." });
    return;
  }
  if (employee.status !== "active") {
    response.status(409).json({ error: "Solo se pueden modificar contratos de expedientes activos." });
    return;
  }
  const requestFingerprint = fingerprint({ employeeId: employee.id, ...input });
  const prior = await priorEvent(actor, input.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrContracts).where(and(eq(fpHrContracts.id, prior.entityId), eq(fpHrContracts.organizationId, employee.organizationId))).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360HrContractResponse.parse(contractResponse(existing)));
      return;
    }
  }
  const [pending] = await db.select({ id: fpHrContracts.id }).from(fpHrContracts).where(and(
    eq(fpHrContracts.tenantId, actor.tenantId), eq(fpHrContracts.employeeId, employee.id), eq(fpHrContracts.status, "pending_review"),
  )).limit(1);
  if (pending) {
    response.status(409).json({ error: "Ya hay una modificación contractual pendiente de revisión." });
    return;
  }
  const [last] = await db.select().from(fpHrContracts).where(and(eq(fpHrContracts.tenantId, actor.tenantId), eq(fpHrContracts.employeeId, employee.id))).orderBy(desc(fpHrContracts.version)).limit(1);
  const now = new Date();
  const [created] = await db.transaction(async (tx) => {
    const [contract] = await tx.insert(fpHrContracts).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId: employee.organizationId, employeeId: employee.id,
      version: (last?.version ?? 0) + 1, documentType: "amendment", effectiveDate: input.effectiveDate,
      endDate: input.endDate ?? null, contractType: input.contractType, weeklyHours: input.weeklyHours,
      annualSalaryCents: input.annualSalaryCents, contributionGroup: input.contributionGroup,
      conventionName: input.conventionName.trim(), status: "pending_review",
      operationId: input.operationId, requestFingerprint,
      createdByUserId: actor.userId, createdByName: actor.displayName, createdAt: now, updatedAt: now,
    }).returning();
    if (!contract) throw new HrError(500, "No se pudo crear la versión contractual.");
    await appendEvent(tx, actor, employee.organizationId, {
      operationId: input.operationId, requestFingerprint, entityId: contract.id,
      eventType: "contract_amendment_pending", description: `Versión ${contract.version} del contrato de ${employee.workerRef} enviada a revisión.`,
    });
    return [contract];
  });
  response.status(201).json(CreateFp360HrContractResponse.parse(contractResponse(created)));
}));

router.post("/redfp360/hr/contracts/:contractId/review", route(async (request, response) => {
  const params = ReviewFp360HrContractParams.safeParse(request.params);
  const body = ReviewFp360HrContractBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción de validación contractual." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "Solo el profesorado o administración puede validar contratos." });
    return;
  }
  const [contract] = await db.select().from(fpHrContracts).where(and(eq(fpHrContracts.id, params.data.contractId), eq(fpHrContracts.tenantId, actor.tenantId))).limit(1);
  if (!contract || !await resolveOrganization(actor, contract.organizationId)) {
    response.status(404).json({ error: "No se encontró el contrato educativo." });
    return;
  }
  const requestFingerprint = fingerprint({ contractId: contract.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrContracts).where(eq(fpHrContracts.id, contract.id)).limit(1);
    if (existing) {
      response.json(ReviewFp360HrContractResponse.parse(contractResponse(existing)));
      return;
    }
  }
  if (contract.status !== "pending_review") {
    response.status(409).json({ error: "El contrato ya fue revisado." });
    return;
  }
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(fpHrContracts).set({
      status: body.data.action === "confirm" ? "confirmed" : "observed",
      reviewAction: body.data.action, reviewedByUserId: actor.userId, reviewedByName: actor.displayName,
      reviewedAt: now, updatedAt: now,
    }).where(and(eq(fpHrContracts.id, contract.id), eq(fpHrContracts.status, "pending_review"))).returning();
    if (!saved) throw new HrError(409, "El contrato cambió mientras se revisaba.");
    if (body.data.action === "confirm") {
      const [employee] = await tx.select().from(fpHrEmployees).where(and(eq(fpHrEmployees.id, contract.employeeId), eq(fpHrEmployees.tenantId, actor.tenantId))).limit(1);
      if (!employee) throw new HrError(404, "No se encontró el expediente vinculado.");
      await tx.update(fpHrEmployees).set({
        contractType: contract.contractType, weeklyHours: contract.weeklyHours,
        annualSalaryCents: contract.annualSalaryCents, contributionGroup: contract.contributionGroup,
        conventionName: contract.conventionName, startDate: contract.documentType === "initial" ? contract.effectiveDate : employee.startDate,
        endDate: contract.endDate, status: "active", updatedAt: now,
      }).where(eq(fpHrEmployees.id, employee.id));
    }
    await appendEvent(tx, actor, contract.organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: contract.id,
      eventType: `contract_${body.data.action}`,
      description: `Contrato educativo ${body.data.action === "confirm" ? "confirmado" : "observado"} · versión ${contract.version}.`,
    });
    return [saved];
  });
  response.json(ReviewFp360HrContractResponse.parse(contractResponse(updated)));
}));

router.post("/redfp360/hr/employees/:employeeId/absences", route(async (request, response) => {
  const params = CreateFp360HrAbsenceParams.safeParse(request.params);
  const body = CreateFp360HrAbsenceBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa el tipo y las fechas de la ausencia ficticia." });
    return;
  }
  const actor = request.auth as AuthContext;
  const employee = await employeeFor(actor, params.data.employeeId);
  if (!employee) {
    response.status(404).json({ error: "No se encontró el expediente ficticio." });
    return;
  }
  const requestFingerprint = fingerprint({ employeeId: employee.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrAbsences).where(and(eq(fpHrAbsences.id, prior.entityId), eq(fpHrAbsences.organizationId, employee.organizationId))).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360HrAbsenceResponse.parse(await absenceResponse(existing, employee.workerRef)));
      return;
    }
  }
  if (employee.status !== "active") {
    response.status(409).json({ error: "Solo se pueden solicitar ausencias para expedientes activos." });
    return;
  }
  if (!validScenarioDate(body.data.startDate) || !validScenarioDate(body.data.endDate) || body.data.endDate < body.data.startDate) {
    response.status(400).json({ error: "El periodo debe estar en 2027 y la fecha final no puede preceder a la inicial." });
    return;
  }
  const existingAbsences = await db.select().from(fpHrAbsences).where(and(eq(fpHrAbsences.tenantId, actor.tenantId), eq(fpHrAbsences.employeeId, employee.id)));
  const overlaps = existingAbsences.some((absence) => absence.status !== "observed" && body.data.startDate <= absence.endDate && body.data.endDate >= absence.startDate);
  if (overlaps) {
    response.status(409).json({ error: "El periodo se solapa con otra solicitud registrada." });
    return;
  }
  const now = new Date();
  const [created] = await db.transaction(async (tx) => {
    const [absence] = await tx.insert(fpHrAbsences).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId: employee.organizationId, employeeId: employee.id,
      absenceType: body.data.absenceType, startDate: body.data.startDate, endDate: body.data.endDate,
      status: "pending_review", operationId: body.data.operationId, requestFingerprint,
      createdByUserId: actor.userId, createdByName: actor.displayName, createdAt: now,
    }).returning();
    if (!absence) throw new HrError(500, "No se pudo guardar la solicitud de ausencia.");
    await appendEvent(tx, actor, employee.organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: absence.id,
      eventType: "absence_pending", description: `Solicitud de ausencia ${absence.startDate}–${absence.endDate} pendiente · ${employee.workerRef}.`,
    });
    return [absence];
  });
  response.status(201).json(CreateFp360HrAbsenceResponse.parse(await absenceResponse(created, employee.workerRef)));
}));

router.post("/redfp360/hr/absences/:absenceId/review", route(async (request, response) => {
  const params = ReviewFp360HrAbsenceParams.safeParse(request.params);
  const body = ReviewFp360HrAbsenceBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción de la solicitud." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "Solo el profesorado o administración puede revisar ausencias." });
    return;
  }
  const [absence] = await db.select().from(fpHrAbsences).where(and(eq(fpHrAbsences.id, params.data.absenceId), eq(fpHrAbsences.tenantId, actor.tenantId))).limit(1);
  if (!absence || !await resolveOrganization(actor, absence.organizationId)) {
    response.status(404).json({ error: "No se encontró la solicitud." });
    return;
  }
  const requestFingerprint = fingerprint({ absenceId: absence.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrAbsences).where(eq(fpHrAbsences.id, absence.id)).limit(1);
    if (existing) {
      response.json(ReviewFp360HrAbsenceResponse.parse(await absenceResponse(existing)));
      return;
    }
  }
  if (absence.status !== "pending_review") {
    response.status(409).json({ error: "La solicitud ya fue revisada." });
    return;
  }
  if (body.data.action === "approve") {
    const other = await db.select().from(fpHrAbsences).where(and(
      eq(fpHrAbsences.tenantId, actor.tenantId), eq(fpHrAbsences.employeeId, absence.employeeId), eq(fpHrAbsences.status, "approved"),
    ));
    if (other.some((row) => row.id !== absence.id && absence.startDate <= row.endDate && absence.endDate >= row.startDate)) {
      response.status(409).json({ error: "El periodo aprobado se solapa con otra ausencia confirmada." });
      return;
    }
  }
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(fpHrAbsences).set({
      status: body.data.action === "approve" ? "approved" : "observed",
      reviewAction: body.data.action, reviewedByUserId: actor.userId, reviewedByName: actor.displayName, reviewedAt: now,
    }).where(and(eq(fpHrAbsences.id, absence.id), eq(fpHrAbsences.status, "pending_review"))).returning();
    if (!saved) throw new HrError(409, "La solicitud cambió mientras se revisaba.");
    await appendEvent(tx, actor, absence.organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: absence.id,
      eventType: `absence_${body.data.action}`, description: `Ausencia ${body.data.action === "approve" ? "aprobada" : "observada"} · ${absence.startDate}–${absence.endDate}.`,
    });
    return [saved];
  });
  response.json(ReviewFp360HrAbsenceResponse.parse(await absenceResponse(updated)));
}));

router.post("/redfp360/hr/employees/:employeeId/termination", route(async (request, response) => {
  const params = CreateFp360HrTerminationParams.safeParse(request.params);
  const body = CreateFp360HrTerminationBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la fecha de baja educativa." });
    return;
  }
  const actor = request.auth as AuthContext;
  const employee = await employeeFor(actor, params.data.employeeId);
  if (!employee) {
    response.status(404).json({ error: "No se encontró el expediente ficticio." });
    return;
  }
  const requestFingerprint = fingerprint({ employeeId: employee.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrLifecycleChanges).where(and(eq(fpHrLifecycleChanges.id, prior.entityId), eq(fpHrLifecycleChanges.organizationId, employee.organizationId))).limit(1);
    if (existing) {
      response.status(201).json(CreateFp360HrTerminationResponse.parse(await lifecycleResponse(existing, employee.workerRef)));
      return;
    }
  }
  if (employee.status !== "active" || !validScenarioDate(body.data.effectiveDate) || body.data.effectiveDate < employee.startDate) {
    response.status(409).json({ error: "La baja debe corresponder a un expediente activo y una fecha coherente de 2027." });
    return;
  }
  const [pending] = await db.select({ id: fpHrLifecycleChanges.id }).from(fpHrLifecycleChanges).where(and(
    eq(fpHrLifecycleChanges.tenantId, actor.tenantId), eq(fpHrLifecycleChanges.employeeId, employee.id), eq(fpHrLifecycleChanges.status, "pending_review"),
  )).limit(1);
  if (pending) {
    response.status(409).json({ error: "Ya hay una modificación de ciclo laboral pendiente." });
    return;
  }
  const now = new Date();
  const [created] = await db.transaction(async (tx) => {
    const [change] = await tx.insert(fpHrLifecycleChanges).values({
      id: randomUUID(), tenantId: actor.tenantId, organizationId: employee.organizationId, employeeId: employee.id,
      changeType: "termination", effectiveDate: body.data.effectiveDate, status: "pending_review",
      operationId: body.data.operationId, requestFingerprint,
      createdByUserId: actor.userId, createdByName: actor.displayName, createdAt: now,
    }).returning();
    if (!change) throw new HrError(500, "No se pudo crear la solicitud de baja.");
    await appendEvent(tx, actor, employee.organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: change.id,
      eventType: "termination_pending", description: `Baja educativa pendiente de revisión · ${employee.workerRef}.`,
    });
    return [change];
  });
  response.status(201).json(CreateFp360HrTerminationResponse.parse(await lifecycleResponse(created, employee.workerRef)));
}));

router.post("/redfp360/hr/terminations/:changeId/review", route(async (request, response) => {
  const params = ReviewFp360HrTerminationParams.safeParse(request.params);
  const body = ReviewFp360HrTerminationBody.safeParse(request.body);
  if (!params.success || !body.success) {
    response.status(400).json({ error: "Revisa la acción de la baja." });
    return;
  }
  const actor = request.auth as AuthContext;
  if (!isTeacher(actor)) {
    response.status(403).json({ error: "Solo el profesorado o administración puede revisar bajas." });
    return;
  }
  const [change] = await db.select().from(fpHrLifecycleChanges).where(and(eq(fpHrLifecycleChanges.id, params.data.changeId), eq(fpHrLifecycleChanges.tenantId, actor.tenantId))).limit(1);
  if (!change || !await resolveOrganization(actor, change.organizationId)) {
    response.status(404).json({ error: "No se encontró la solicitud de baja." });
    return;
  }
  const requestFingerprint = fingerprint({ changeId: change.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    const [existing] = await db.select().from(fpHrLifecycleChanges).where(eq(fpHrLifecycleChanges.id, change.id)).limit(1);
    if (existing) {
      response.json(ReviewFp360HrTerminationResponse.parse(await lifecycleResponse(existing)));
      return;
    }
  }
  if (change.status !== "pending_review") {
    response.status(409).json({ error: "La solicitud ya fue revisada." });
    return;
  }
  const now = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [saved] = await tx.update(fpHrLifecycleChanges).set({
      status: body.data.action === "approve" ? "approved" : "observed",
      reviewAction: body.data.action, reviewedByUserId: actor.userId, reviewedByName: actor.displayName, reviewedAt: now,
    }).where(and(eq(fpHrLifecycleChanges.id, change.id), eq(fpHrLifecycleChanges.status, "pending_review"))).returning();
    if (!saved) throw new HrError(409, "La solicitud cambió mientras se revisaba.");
    if (body.data.action === "approve") {
      await tx.update(fpHrEmployees).set({
        status: "inactive", endDate: change.effectiveDate, updatedAt: now,
      }).where(and(eq(fpHrEmployees.id, change.employeeId), eq(fpHrEmployees.tenantId, actor.tenantId)));
    }
    await appendEvent(tx, actor, change.organizationId, {
      operationId: body.data.operationId, requestFingerprint, entityId: change.id,
      eventType: `termination_${body.data.action}`,
      description: `Baja educativa ${body.data.action === "approve" ? "aprobada" : "observada"}.`,
    });
    return [saved];
  });
  response.json(ReviewFp360HrTerminationResponse.parse(await lifecycleResponse(updated)));
}));

export default router;

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  CompleteFp360CommunicationsTaskBody,
  CompleteFp360CommunicationsTaskParams,
  CompleteFp360CommunicationsTaskResponse,
  CreateFp360CommunicationsTaskBody,
  CreateFp360CommunicationsTaskParams,
  CreateFp360CommunicationsTaskResponse,
  CreateFp360CommunicationsThreadBody,
  CreateFp360CommunicationsThreadResponse,
  GetFp360CommunicationsOverviewQueryParams,
  GetFp360CommunicationsOverviewResponse,
  ReplyFp360CommunicationsThreadBody,
  ReplyFp360CommunicationsThreadParams,
  ReplyFp360CommunicationsThreadResponse,
  SendFp360CommunicationsThreadBody,
  SendFp360CommunicationsThreadParams,
  SendFp360CommunicationsThreadResponse,
  UpdateFp360CommunicationsThreadStateBody,
  UpdateFp360CommunicationsThreadStateParams,
  UpdateFp360CommunicationsThreadStateResponse,
} from "@workspace/api-zod";
import {
  db,
  fpCommunicationsEvents,
  fpCommunicationsMessages,
  fpCommunicationsTasks,
  fpCommunicationsThreadStates,
  fpCommunicationsThreads,
  fpDocuments,
  fpOrganizations,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
const SIMULATED_DATE = "2027-09-15";
const SCENARIO_START = "2027-01-01";
const SCENARIO_END = "2028-12-31";
const DEPARTMENTS = [
  "management", "sales", "purchasing", "warehouse", "customer_service",
  "suppliers", "treasury", "accounting", "hr", "tax", "education", "logistics",
] as const;
const TEMPLATES = [
  {
    id: "delivery-date",
    title: "Solicitud de nueva fecha",
    subject: "Solicitud de actualización de fecha de entrega",
    body: "Solicitamos revisar la fecha prevista de entrega de la referencia indicada. Proponemos acordar una nueva fecha y dejar el cambio registrado en el expediente correspondiente.",
    department: "purchasing",
  },
  {
    id: "acknowledgment",
    title: "Acuse interno",
    subject: "Acuse de recepción de la comunicación",
    body: "Confirmamos la recepción de esta comunicación en el buzón de práctica. El acuse no implica aceptación de condiciones ni modificación de documentos comerciales.",
    department: "customer_service",
  },
  {
    id: "incident",
    title: "Escalado de incidencia",
    subject: "Solicitud de revisión de incidencia",
    body: "Solicitamos revisar la incidencia descrita y proponer una actuación dentro del plazo indicado. La comunicación es didáctica y no modifica automáticamente pedidos, cobros ni contratos.",
    department: "management",
  },
  {
    id: "quote",
    title: "Petición de oferta",
    subject: "Solicitud de oferta para el expediente indicado",
    body: "Solicitamos una oferta simulada para el expediente de referencia. Indiquen los datos de la propuesta dentro del caso didáctico; cualquier aceptación requerirá la acción formal correspondiente.",
    department: "sales",
  },
];

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

class CommunicationsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response).catch((error: unknown) => {
      if (error instanceof CommunicationsError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error }, "RED FP360 communications operation failed");
      next(error);
    });
  };
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isReviewer(actor: AuthContext): boolean {
  return ["teacher", "administrator"].includes(actor.role);
}

function actorRef(userId: string): string {
  return `USR-${userId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
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

function containsPersonalChannel(value: string): boolean {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || /\b(?:\+34[\s.-]?)?[6789]\d{2}(?:[\s.-]?\d{3}){2}\b/.test(value);
}

function validateMessage(body: string, subject?: string) {
  if (containsPersonalChannel(body) || (subject && containsPersonalChannel(subject))) {
    throw new CommunicationsError(400, "El mensaje parece contener un correo o teléfono. Usa solo referencias ficticias del escenario.");
  }
}

async function resolveOrganization(actor: AuthContext, organizationId: string) {
  if (actor.organizationId && actor.organizationId !== organizationId) return null;
  if (!actor.organizationId && !isReviewer(actor)) return null;
  const [organization] = await db.select().from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return organization ?? null;
}

async function resolveRecipientOrganization(actor: AuthContext, organizationId: string) {
  const [organization] = await db.select().from(fpOrganizations).where(and(
    eq(fpOrganizations.id, organizationId),
    eq(fpOrganizations.tenantId, actor.tenantId),
    eq(fpOrganizations.isActive, true),
  )).limit(1);
  return organization ?? null;
}

function requireParticipantOrganization(organizationId: string, thread: typeof fpCommunicationsThreads.$inferSelect) {
  if (organizationId !== thread.originOrganizationId && organizationId !== thread.recipientOrganizationId) {
    throw new CommunicationsError(403, "La empresa seleccionada no participa en esta conversación.");
  }
}

async function threadForActor(actor: AuthContext, threadId: string, organizationId: string) {
  const organization = await resolveOrganization(actor, organizationId);
  if (!organization) throw new CommunicationsError(403, "No tienes acceso a la empresa seleccionada.");
  const [thread] = await db.select().from(fpCommunicationsThreads).where(and(
    eq(fpCommunicationsThreads.id, threadId),
    eq(fpCommunicationsThreads.tenantId, actor.tenantId),
  )).limit(1);
  if (!thread) throw new CommunicationsError(404, "No se encontró la conversación.");
  requireParticipantOrganization(organizationId, thread);
  if (thread.status === "draft" && thread.originOrganizationId !== organizationId) {
    throw new CommunicationsError(404, "No se encontró la conversación.");
  }
  return { thread, organization };
}

async function priorEvent(actor: AuthContext, operationId: string, requestFingerprint: string) {
  if (containsPersonalChannel(operationId)) {
    throw new CommunicationsError(400, "El identificador de operación no puede contener datos de contacto.");
  }
  const [prior] = await db.select().from(fpCommunicationsEvents).where(and(
    eq(fpCommunicationsEvents.tenantId, actor.tenantId),
    eq(fpCommunicationsEvents.operationId, operationId),
  )).limit(1);
  if (!prior) return null;
  if (prior.requestFingerprint !== requestFingerprint) {
    throw new CommunicationsError(409, "Este identificador ya se utilizó para otra operación.");
  }
  return prior;
}

async function appendEvent(
  tx: Transaction,
  actor: AuthContext,
  organizationId: string,
  threadId: string,
  entityId: string,
  eventType: string,
  description: string,
  operationId: string,
  requestFingerprint: string,
) {
  await tx.insert(fpCommunicationsEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    organizationId,
    threadId,
    entityId,
    eventType,
    actorUserId: actor.userId,
    actorRef: actorRef(actor.userId),
    description,
    operationId,
    requestFingerprint,
  });
}

async function validateAttachments(actor: AuthContext, organizationId: string, documentIds: string[]) {
  if (documentIds.length > 5 || new Set(documentIds).size !== documentIds.length) {
    throw new CommunicationsError(400, "Selecciona hasta cinco referencias distintas.");
  }
  if (!documentIds.length) return;
  const documents = await db.select().from(fpDocuments).where(and(
    eq(fpDocuments.tenantId, actor.tenantId),
    eq(fpDocuments.organizationId, organizationId),
    inArray(fpDocuments.id, documentIds),
    eq(fpDocuments.visibility, "organization"),
    eq(fpDocuments.isSynthetic, true),
    eq(fpDocuments.status, "confirmed"),
  ));
  if (documents.length !== documentIds.length) {
    throw new CommunicationsError(400, "Solo se pueden referenciar documentos ficticios confirmados y visibles para la empresa de origen.");
  }
  if (documents.some((document) => containsPersonalChannel(document.documentRef) || containsPersonalChannel(document.title))) {
    throw new CommunicationsError(400, "Una referencia documental contiene un correo o teléfono y no puede compartirse.");
  }
}

function dateIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function overview(actor: AuthContext, organizationId: string, search?: string, onlyThreadId?: string) {
  const organization = await resolveOrganization(actor, organizationId);
  if (!organization) throw new CommunicationsError(403, "No tienes acceso a la empresa seleccionada.");
  const [organizations, threadRows] = await Promise.all([
    db.select({ id: fpOrganizations.id, name: fpOrganizations.name, center: fpOrganizations.center })
      .from(fpOrganizations)
      .where(and(eq(fpOrganizations.tenantId, actor.tenantId), eq(fpOrganizations.isActive, true)))
      .orderBy(fpOrganizations.name),
    db.select().from(fpCommunicationsThreads).where(and(
      eq(fpCommunicationsThreads.tenantId, actor.tenantId),
      onlyThreadId ? eq(fpCommunicationsThreads.id, onlyThreadId) : undefined,
      or(
        eq(fpCommunicationsThreads.originOrganizationId, organizationId),
        eq(fpCommunicationsThreads.recipientOrganizationId, organizationId),
      ),
    )).orderBy(desc(fpCommunicationsThreads.updatedAt)).limit(200),
  ]);
  const visibleThreads = threadRows.filter((thread) => thread.status !== "draft" || thread.originOrganizationId === organizationId);
  const filteredThreads = search?.trim()
    ? visibleThreads.filter((thread) => [thread.reference, thread.subject, thread.relatedReference ?? ""].some((value) => value.toLowerCase().includes(search.trim().toLowerCase())))
    : visibleThreads;
  const threadIds = filteredThreads.map((thread) => thread.id);
  const [messages, tasks, states] = threadIds.length ? await Promise.all([
    db.select().from(fpCommunicationsMessages).where(and(
      eq(fpCommunicationsMessages.tenantId, actor.tenantId),
      inArray(fpCommunicationsMessages.threadId, threadIds),
    )).orderBy(fpCommunicationsMessages.createdAt),
    db.select().from(fpCommunicationsTasks).where(and(
      eq(fpCommunicationsTasks.tenantId, actor.tenantId),
      inArray(fpCommunicationsTasks.threadId, threadIds),
    )).orderBy(fpCommunicationsTasks.dueDate),
    db.select().from(fpCommunicationsThreadStates).where(and(
      eq(fpCommunicationsThreadStates.tenantId, actor.tenantId),
      eq(fpCommunicationsThreadStates.userId, actor.userId),
      inArray(fpCommunicationsThreadStates.threadId, threadIds),
    )),
  ]) : [[], [], []];
  const documentIds = [...new Set(messages.flatMap((message) => message.attachmentDocumentIds))];
  const documents = documentIds.length ? await db.select({
    id: fpDocuments.id,
    organizationId: fpDocuments.organizationId,
    reference: fpDocuments.documentRef,
    title: fpDocuments.title,
    visibility: fpDocuments.visibility,
    status: fpDocuments.status,
    isSynthetic: fpDocuments.isSynthetic,
  }).from(fpDocuments).where(and(
    eq(fpDocuments.tenantId, actor.tenantId),
    inArray(fpDocuments.id, documentIds),
    eq(fpDocuments.visibility, "organization"),
    eq(fpDocuments.isSynthetic, true),
  )) : [];
  const orgById = new Map(organizations.map((item) => [item.id, item]));
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const stateByThread = new Map(states.map((state) => [state.threadId, state]));
  const messagesByThread = new Map<string, typeof messages>();
  for (const message of messages) {
    const list = messagesByThread.get(message.threadId) ?? [];
    list.push(message);
    messagesByThread.set(message.threadId, list);
  }
  const tasksByThread = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const list = tasksByThread.get(task.threadId) ?? [];
    list.push(task);
    tasksByThread.set(task.threadId, list);
  }
  const threads = filteredThreads.map((thread) => {
    const threadMessages = (messagesByThread.get(thread.id) ?? []).filter((message) => message.status !== "draft" || thread.originOrganizationId === organizationId);
    const state = stateByThread.get(thread.id);
    const latestMessage = threadMessages.at(-1);
    const unread = threadMessages.some((message) => (
      message.status === "sent"
      && message.senderOrganizationId !== organizationId
      && (!state?.lastReadAt || (message.sentAt && message.sentAt > state.lastReadAt))
    ));
    return {
      id: thread.id,
      reference: thread.reference,
      originOrganizationId: thread.originOrganizationId,
      originOrganizationName: orgById.get(thread.originOrganizationId)?.name ?? "Empresa de la red",
      recipientOrganizationId: thread.recipientOrganizationId,
      recipientOrganizationName: orgById.get(thread.recipientOrganizationId)?.name ?? "Empresa de la red",
      originDepartment: thread.originDepartment,
      recipientDepartment: thread.recipientDepartment,
      subject: thread.subject,
      priority: thread.priority,
      status: thread.status,
      relatedReference: thread.relatedReference,
      assignedOrganizationId: thread.assignedOrganizationId,
      assignedDepartment: thread.assignedDepartment,
      createdByRef: actorRef(thread.createdByUserId),
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      sentAt: dateIso(thread.sentAt),
      simulatedDate: latestMessage?.simulatedDate ?? SIMULATED_DATE,
      unread,
      archived: Boolean(state?.archivedAt),
      messages: threadMessages.map((message) => ({
        id: message.id,
        authorRef: actorRef(message.createdByUserId),
        senderOrganizationId: message.senderOrganizationId,
        department: message.senderDepartment,
        body: message.body,
        attachments: message.attachmentDocumentIds.flatMap((documentId) => {
          const document = documentById.get(documentId);
          return document ? [{
            id: document.id,
            reference: document.reference,
            title: document.title,
            accessible: document.organizationId === organizationId && document.status === "confirmed" && document.isSynthetic,
          }] : [];
        }),
        simulatedDate: message.simulatedDate,
        status: message.status,
        sentAt: dateIso(message.sentAt),
      })),
      tasks: (tasksByThread.get(thread.id) ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        assignedOrganizationId: task.assignedOrganizationId,
        assignedOrganizationName: orgById.get(task.assignedOrganizationId)?.name ?? "Empresa de la red",
        department: task.assignedDepartment,
        dueDate: task.dueDate,
        status: task.status,
        createdAt: task.createdAt.toISOString(),
        completedAt: dateIso(task.completedAt),
      })),
    };
  });
  const responseHours: number[] = [];
  for (const thread of threads) {
    let previous: (typeof messages)[number] | undefined;
    for (const message of messagesByThread.get(thread.id) ?? []) {
      if (message.status !== "sent") continue;
      if (previous && previous.senderOrganizationId !== message.senderOrganizationId) {
        responseHours.push(Math.max(0, (message.createdAt.getTime() - previous.createdAt.getTime()) / 3_600_000));
      }
      previous = message;
    }
  }
  return GetFp360CommunicationsOverviewResponse.parse({
    organizationId,
    organizations,
    threads,
    templates: TEMPLATES,
    metrics: {
      unreadCount: threads.filter((thread) => thread.unread).length,
      activeConversations: threads.filter((thread) => thread.status === "open" && !thread.archived).length,
      newRequests: threads.filter((thread) => thread.status === "open" && thread.originOrganizationId !== organizationId && thread.messages.length === 1).length,
      averageResponseHours: responseHours.length ? Math.round(responseHours.reduce((sum, hours) => sum + hours, 0) / responseHours.length * 10) / 10 : 0,
    },
  });
}

async function threadResponse(actor: AuthContext, organizationId: string, threadId: string) {
  const result = await overview(actor, organizationId, undefined, threadId);
  const thread = result.threads[0];
  if (!thread) throw new CommunicationsError(404, "No se encontró la conversación.");
  return thread;
}

router.use("/redfp360/communications", requireAuth, requireSimulationWriteAccess);

router.get("/redfp360/communications", route(async (request, response) => {
  const query = GetFp360CommunicationsOverviewQueryParams.safeParse(request.query);
  if (!query.success) throw new CommunicationsError(400, "Selecciona una empresa válida.");
  response.json(await overview(request.auth as AuthContext, query.data.organizationId, query.data.search));
}));

router.post("/redfp360/communications/threads", route(async (request, response) => {
  const body = CreateFp360CommunicationsThreadBody.safeParse(request.body);
  if (!body.success) throw new CommunicationsError(400, "Revisa la empresa, el destinatario, el asunto y el contenido.");
  const actor = request.auth as AuthContext;
  const origin = await resolveOrganization(actor, body.data.organizationId);
  if (!origin) throw new CommunicationsError(403, "No tienes acceso a la empresa de origen.");
  const recipient = await resolveRecipientOrganization(actor, body.data.recipientOrganizationId);
  if (!recipient || recipient.id === origin.id) throw new CommunicationsError(400, "Selecciona otra empresa activa de la red.");
  if (!validScenarioDate(body.data.simulatedDate)) throw new CommunicationsError(400, "La fecha debe estar dentro del escenario 2027–2028.");
  validateMessage(body.data.body, body.data.subject);
  if (body.data.relatedReference && containsPersonalChannel(body.data.relatedReference)) {
    throw new CommunicationsError(400, "La referencia del expediente no puede contener datos de contacto.");
  }
  await validateAttachments(actor, origin.id, body.data.attachmentDocumentIds);
  const requestFingerprint = fingerprint(body.data);
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    response.status(201).json(CreateFp360CommunicationsThreadResponse.parse(await threadResponse(actor, origin.id, prior.threadId)));
    return;
  }
  const now = new Date();
  const threadId = randomUUID();
  const messageId = randomUUID();
  const reference = `COM-${body.data.simulatedDate.slice(0, 4)}-${threadId.slice(0, 8).toUpperCase()}`;
  const status = body.data.saveAsDraft ? "draft" : "open";
  await db.transaction(async (tx) => {
    await tx.insert(fpCommunicationsThreads).values({
      id: threadId,
      tenantId: actor.tenantId,
      reference,
      originOrganizationId: origin.id,
      recipientOrganizationId: recipient.id,
      originDepartment: body.data.originDepartment,
      recipientDepartment: body.data.recipientDepartment,
      subject: body.data.subject.trim(),
      priority: body.data.priority,
      status,
      relatedReference: body.data.relatedReference?.trim() || null,
      createdByUserId: actor.userId,
      operationId: body.data.operationId,
      requestFingerprint,
      updatedAt: now,
      sentAt: body.data.saveAsDraft ? null : now,
    });
    await tx.insert(fpCommunicationsMessages).values({
      id: messageId,
      tenantId: actor.tenantId,
      threadId,
      senderOrganizationId: origin.id,
      senderDepartment: body.data.originDepartment,
      body: body.data.body.trim(),
      attachmentDocumentIds: body.data.attachmentDocumentIds,
      simulatedDate: body.data.simulatedDate,
      status: body.data.saveAsDraft ? "draft" : "sent",
      createdByUserId: actor.userId,
      operationId: body.data.operationId,
      requestFingerprint,
      sentAt: body.data.saveAsDraft ? null : now,
    });
    await tx.insert(fpCommunicationsThreadStates).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      threadId,
      organizationId: origin.id,
      userId: actor.userId,
      lastReadAt: now,
      updatedAt: now,
    });
    await appendEvent(tx, actor, origin.id, threadId, threadId, body.data.saveAsDraft ? "draft_created" : "thread_sent", body.data.saveAsDraft ? "Borrador guardado." : "Comunicación interna enviada a la red simulada.", body.data.operationId, requestFingerprint);
  });
  response.status(201).json(CreateFp360CommunicationsThreadResponse.parse(await threadResponse(actor, origin.id, threadId)));
}));

router.post("/redfp360/communications/threads/:threadId/send", route(async (request, response) => {
  const params = SendFp360CommunicationsThreadParams.safeParse(request.params);
  const body = SendFp360CommunicationsThreadBody.safeParse(request.body);
  if (!params.success || !body.success) throw new CommunicationsError(400, "No se pudo validar el borrador.");
  const actor = request.auth as AuthContext;
  const { thread } = await threadForActor(actor, params.data.threadId, body.data.organizationId);
  const requestFingerprint = fingerprint({ threadId: thread.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (prior) {
    if (prior.threadId !== thread.id) throw new CommunicationsError(409, "El identificador ya se usó para otra conversación.");
    response.json(SendFp360CommunicationsThreadResponse.parse(await threadResponse(actor, body.data.organizationId, thread.id)));
    return;
  }
  if (thread.originOrganizationId !== body.data.organizationId || thread.status !== "draft") {
    throw new CommunicationsError(409, "Solo se puede enviar un borrador propio una vez.");
  }
  {
    const [message] = await db.select().from(fpCommunicationsMessages).where(and(
      eq(fpCommunicationsMessages.tenantId, actor.tenantId),
      eq(fpCommunicationsMessages.threadId, thread.id),
      eq(fpCommunicationsMessages.status, "draft"),
    )).limit(1);
    if (!message) throw new CommunicationsError(409, "El borrador ya no está disponible.");
    await validateAttachments(actor, thread.originOrganizationId, message.attachmentDocumentIds);
    validateMessage(message.body, thread.subject);
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(fpCommunicationsThreads).set({ status: "open", sentAt: now, updatedAt: now }).where(and(
        eq(fpCommunicationsThreads.id, thread.id),
        eq(fpCommunicationsThreads.tenantId, actor.tenantId),
        eq(fpCommunicationsThreads.status, "draft"),
      ));
      await tx.update(fpCommunicationsMessages).set({ status: "sent", sentAt: now }).where(and(
        eq(fpCommunicationsMessages.id, message.id),
        eq(fpCommunicationsMessages.tenantId, actor.tenantId),
      ));
      await appendEvent(tx, actor, thread.originOrganizationId, thread.id, thread.id, "thread_sent", "Borrador enviado a la red simulada.", body.data.operationId, requestFingerprint);
    });
  }
  response.json(SendFp360CommunicationsThreadResponse.parse(await threadResponse(actor, body.data.organizationId, thread.id)));
}));

router.post("/redfp360/communications/threads/:threadId/messages", route(async (request, response) => {
  const params = ReplyFp360CommunicationsThreadParams.safeParse(request.params);
  const body = ReplyFp360CommunicationsThreadBody.safeParse(request.body);
  if (!params.success || !body.success) throw new CommunicationsError(400, "Revisa la empresa y el contenido de la respuesta.");
  const actor = request.auth as AuthContext;
  const { thread } = await threadForActor(actor, params.data.threadId, body.data.organizationId);
  if (thread.status !== "open") throw new CommunicationsError(409, "Esta conversación no admite respuestas.");
  validateMessage(body.data.body);
  await validateAttachments(actor, body.data.organizationId, body.data.attachmentDocumentIds);
  if (!validScenarioDate(body.data.simulatedDate)) throw new CommunicationsError(400, "La fecha debe estar dentro del escenario 2027–2028.");
  const requestFingerprint = fingerprint({ threadId: thread.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (!prior) {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(fpCommunicationsMessages).values({
        id: randomUUID(),
        tenantId: actor.tenantId,
        threadId: thread.id,
        senderOrganizationId: body.data.organizationId,
        senderDepartment: body.data.organizationId === thread.originOrganizationId ? thread.originDepartment : thread.recipientDepartment,
        body: body.data.body.trim(),
        attachmentDocumentIds: body.data.attachmentDocumentIds,
        simulatedDate: body.data.simulatedDate,
        status: "sent",
        createdByUserId: actor.userId,
        operationId: body.data.operationId,
        requestFingerprint,
        sentAt: now,
      });
      await tx.update(fpCommunicationsThreads).set({ updatedAt: now }).where(and(
        eq(fpCommunicationsThreads.id, thread.id),
        eq(fpCommunicationsThreads.tenantId, actor.tenantId),
      ));
      await tx.insert(fpCommunicationsThreadStates).values({
        id: randomUUID(),
        tenantId: actor.tenantId,
        threadId: thread.id,
        organizationId: body.data.organizationId,
        userId: actor.userId,
        lastReadAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [fpCommunicationsThreadStates.tenantId, fpCommunicationsThreadStates.threadId, fpCommunicationsThreadStates.userId],
        set: { organizationId: body.data.organizationId, lastReadAt: now, archivedAt: null, updatedAt: now },
      });
      await appendEvent(tx, actor, body.data.organizationId, thread.id, thread.id, "message_replied", "Respuesta añadida al hilo simulado.", body.data.operationId, requestFingerprint);
    });
  } else if (prior.threadId !== thread.id) {
    throw new CommunicationsError(409, "El identificador ya se usó para otra conversación.");
  }
  response.status(201).json(ReplyFp360CommunicationsThreadResponse.parse(await threadResponse(actor, body.data.organizationId, thread.id)));
}));

router.post("/redfp360/communications/threads/:threadId/state", route(async (request, response) => {
  const params = UpdateFp360CommunicationsThreadStateParams.safeParse(request.params);
  const body = UpdateFp360CommunicationsThreadStateBody.safeParse(request.body);
  if (!params.success || !body.success) throw new CommunicationsError(400, "Revisa la acción de la conversación.");
  const actor = request.auth as AuthContext;
  const { thread } = await threadForActor(actor, params.data.threadId, body.data.organizationId);
  const requestFingerprint = fingerprint({ threadId: thread.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (!prior) {
    const now = new Date();
    if (body.data.action === "assign") {
      if (!["team_manager", "teacher", "administrator", "promoter"].includes(actor.role)) {
        throw new CommunicationsError(403, "Solo una persona responsable puede asignar el buzón.");
      }
      if (!body.data.assignedOrganizationId || !body.data.assignedDepartment) {
        throw new CommunicationsError(400, "Selecciona una empresa participante y un departamento.");
      }
      requireParticipantOrganization(body.data.assignedOrganizationId, thread);
      const assignedOrganization = await resolveRecipientOrganization(actor, body.data.assignedOrganizationId);
      if (!assignedOrganization) throw new CommunicationsError(400, "La empresa asignada ya no está activa.");
      await db.transaction(async (tx) => {
        await tx.update(fpCommunicationsThreads).set({
          assignedOrganizationId: assignedOrganization.id,
          assignedDepartment: body.data.assignedDepartment,
          updatedAt: now,
        }).where(and(eq(fpCommunicationsThreads.id, thread.id), eq(fpCommunicationsThreads.tenantId, actor.tenantId)));
        await appendEvent(tx, actor, body.data.organizationId, thread.id, thread.id, "thread_assigned", `Asignada al buzón ${body.data.assignedDepartment}.`, body.data.operationId, requestFingerprint);
      });
    } else {
      await db.transaction(async (tx) => {
        await tx.insert(fpCommunicationsThreadStates).values({
          id: randomUUID(),
          tenantId: actor.tenantId,
          threadId: thread.id,
          organizationId: body.data.organizationId,
          userId: actor.userId,
          lastReadAt: now,
          archivedAt: body.data.action === "archive" ? now : null,
          updatedAt: now,
        }).onConflictDoUpdate({
          target: [fpCommunicationsThreadStates.tenantId, fpCommunicationsThreadStates.threadId, fpCommunicationsThreadStates.userId],
          set: {
            organizationId: body.data.organizationId,
            lastReadAt: now,
            ...(body.data.action === "archive" ? { archivedAt: now } : body.data.action === "unarchive" ? { archivedAt: null } : {}),
            updatedAt: now,
          },
        });
        await appendEvent(tx, actor, body.data.organizationId, thread.id, thread.id, `thread_${body.data.action}`, body.data.action === "mark_read" ? "Conversación marcada como leída." : body.data.action === "archive" ? "Conversación archivada para este usuario." : "Conversación restaurada para este usuario.", body.data.operationId, requestFingerprint);
      });
    }
  } else if (prior.threadId !== thread.id) {
    throw new CommunicationsError(409, "El identificador ya se usó para otra conversación.");
  }
  response.json(UpdateFp360CommunicationsThreadStateResponse.parse(await threadResponse(actor, body.data.organizationId, thread.id)));
}));

router.post("/redfp360/communications/threads/:threadId/tasks", route(async (request, response) => {
  const params = CreateFp360CommunicationsTaskParams.safeParse(request.params);
  const body = CreateFp360CommunicationsTaskBody.safeParse(request.body);
  if (!params.success || !body.success) throw new CommunicationsError(400, "Revisa los datos de la tarea.");
  const actor = request.auth as AuthContext;
  const { thread } = await threadForActor(actor, params.data.threadId, body.data.organizationId);
  if (thread.status !== "open") throw new CommunicationsError(409, "No se pueden crear compromisos en un borrador.");
  if (!validScenarioDate(body.data.dueDate)) throw new CommunicationsError(400, "El plazo debe estar dentro del escenario 2027–2028.");
  validateMessage(body.data.title);
  requireParticipantOrganization(body.data.assignedOrganizationId, thread);
  const assignedOrganization = await resolveRecipientOrganization(actor, body.data.assignedOrganizationId);
  if (!assignedOrganization) throw new CommunicationsError(400, "La empresa asignada ya no está activa.");
  const requestFingerprint = fingerprint({ threadId: thread.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (!prior) {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(fpCommunicationsTasks).values({
        id: randomUUID(),
        tenantId: actor.tenantId,
        threadId: thread.id,
        assignedOrganizationId: assignedOrganization.id,
        assignedDepartment: body.data.assignedDepartment,
        title: body.data.title.trim(),
        dueDate: body.data.dueDate,
        status: "open",
        createdByUserId: actor.userId,
        operationId: body.data.operationId,
        requestFingerprint,
      });
      await tx.update(fpCommunicationsThreads).set({ updatedAt: now }).where(and(
        eq(fpCommunicationsThreads.id, thread.id),
        eq(fpCommunicationsThreads.tenantId, actor.tenantId),
      ));
      await appendEvent(tx, actor, body.data.organizationId, thread.id, thread.id, "task_created", `Compromiso didáctico creado con vencimiento ${body.data.dueDate}.`, body.data.operationId, requestFingerprint);
    });
  } else if (prior.threadId !== thread.id) {
    throw new CommunicationsError(409, "El identificador ya se usó para otra conversación.");
  }
  response.status(201).json(CreateFp360CommunicationsTaskResponse.parse(await threadResponse(actor, body.data.organizationId, thread.id)));
}));

router.post("/redfp360/communications/tasks/:taskId/complete", route(async (request, response) => {
  const params = CompleteFp360CommunicationsTaskParams.safeParse(request.params);
  const body = CompleteFp360CommunicationsTaskBody.safeParse(request.body);
  if (!params.success || !body.success) throw new CommunicationsError(400, "No se pudo validar la tarea.");
  const actor = request.auth as AuthContext;
  const organization = await resolveOrganization(actor, body.data.organizationId);
  if (!organization) throw new CommunicationsError(403, "No tienes acceso a la empresa seleccionada.");
  const [task] = await db.select().from(fpCommunicationsTasks).where(and(
    eq(fpCommunicationsTasks.id, params.data.taskId),
    eq(fpCommunicationsTasks.tenantId, actor.tenantId),
    eq(fpCommunicationsTasks.assignedOrganizationId, organization.id),
  )).limit(1);
  if (!task) throw new CommunicationsError(404, "No se encontró la tarea en esta empresa.");
  await threadForActor(actor, task.threadId, organization.id);
  const requestFingerprint = fingerprint({ taskId: task.id, ...body.data });
  const prior = await priorEvent(actor, body.data.operationId, requestFingerprint);
  if (!prior) {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(fpCommunicationsTasks).set({
        status: "completed",
        completedAt: now,
        completedByUserId: actor.userId,
      }).where(and(
        eq(fpCommunicationsTasks.id, task.id),
        eq(fpCommunicationsTasks.tenantId, actor.tenantId),
      ));
      await appendEvent(tx, actor, organization.id, task.threadId, task.id, "task_completed", "Compromiso didáctico completado.", body.data.operationId, requestFingerprint);
    });
  } else if (prior.threadId !== task.threadId) {
    throw new CommunicationsError(409, "El identificador ya se usó para otra operación.");
  }
  response.json(await overview(actor, organization.id));
}));

export default router;

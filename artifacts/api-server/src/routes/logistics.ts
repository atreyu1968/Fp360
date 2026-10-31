import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ConfirmFp360LogisticsDeliveryBody,
  ConfirmFp360LogisticsDeliveryParams,
  CreateFp360LogisticsIncidentBody,
  CreateFp360LogisticsIncidentParams,
  ListFp360LogisticsShipmentsResponse,
  ListFp360LogisticsShipmentsResponseItem,
  ResolveFp360LogisticsIncidentBody,
  ResolveFp360LogisticsIncidentParams,
  UpdateFp360LogisticsRouteBody,
  UpdateFp360LogisticsRouteParams,
} from "@workspace/api-zod";
import {
  db,
  fpActivity,
  fpLogisticsEvents,
  fpLogisticsIncidents,
  fpLogisticsShipmentLines,
  fpLogisticsShipments,
  fpOrderLines,
  fpOrders,
  fpOrganizations,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth, requireSimulationWriteAccess);
const SIMULATED_DATE = "2027-09-15";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isNetworkSupervisor(actor: AuthContext) {
  return actor.role === "administrator" || (actor.role === "teacher" && actor.organizationId === null);
}
function canParticipate(actor: AuthContext, shipment: typeof fpLogisticsShipments.$inferSelect) {
  return isNetworkSupervisor(actor) ||
    (!!actor.organizationId && (
      actor.organizationId === shipment.originOrganizationId ||
      actor.organizationId === shipment.destinationOrganizationId
    ));
}
function canPlan(actor: AuthContext, shipment: typeof fpLogisticsShipments.$inferSelect) {
  return isNetworkSupervisor(actor) ||
    (!!actor.organizationId && actor.organizationId === shipment.originOrganizationId);
}
function canReceive(actor: AuthContext, shipment: typeof fpLogisticsShipments.$inferSelect) {
  return isNetworkSupervisor(actor) ||
    (!!actor.organizationId && actor.organizationId === shipment.destinationOrganizationId);
}
function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function dateTime(value: Date) {
  return value.toISOString();
}

async function readShipment(id: string, tenantId: string) {
  const [shipment] = await db
    .select()
    .from(fpLogisticsShipments)
    .where(and(eq(fpLogisticsShipments.id, id), eq(fpLogisticsShipments.tenantId, tenantId)))
    .limit(1);
  if (!shipment) return null;
  const [order] = await db
    .select()
    .from(fpOrders)
    .where(and(eq(fpOrders.id, shipment.orderId), eq(fpOrders.tenantId, tenantId)))
    .limit(1);
  const originRows = shipment.originOrganizationId
    ? await db.select().from(fpOrganizations).where(and(
      eq(fpOrganizations.id, shipment.originOrganizationId),
      eq(fpOrganizations.tenantId, tenantId),
    )).limit(1)
    : [];
  const [destination] = await db
    .select()
    .from(fpOrganizations)
    .where(and(
      eq(fpOrganizations.id, shipment.destinationOrganizationId),
      eq(fpOrganizations.tenantId, tenantId),
    ))
    .limit(1);
  const lines = await db
    .select()
    .from(fpLogisticsShipmentLines)
    .where(and(
      eq(fpLogisticsShipmentLines.shipmentId, shipment.id),
      eq(fpLogisticsShipmentLines.tenantId, tenantId),
    ));
  const events = await db
    .select()
    .from(fpLogisticsEvents)
    .where(and(
      eq(fpLogisticsEvents.shipmentId, shipment.id),
      eq(fpLogisticsEvents.tenantId, tenantId),
    ))
    .orderBy(asc(fpLogisticsEvents.createdAt));
  const incidents = await db
    .select()
    .from(fpLogisticsIncidents)
    .where(and(
      eq(fpLogisticsIncidents.shipmentId, shipment.id),
      eq(fpLogisticsIncidents.tenantId, tenantId),
    ))
    .orderBy(desc(fpLogisticsIncidents.createdAt));
  return ListFp360LogisticsShipmentsResponseItem.parse({
    id: shipment.id,
    reference: shipment.reference,
    orderId: shipment.orderId,
    orderReference: order?.reference ?? "Pedido",
    originOrganizationId: shipment.originOrganizationId,
    originName: originRows[0]?.name ?? null,
    destinationOrganizationId: shipment.destinationOrganizationId,
    destinationName: destination?.name ?? "Entidad de la red",
    routeName: shipment.routeName,
    carrierName: shipment.carrierName,
    parcelCount: shipment.parcelCount,
    plannedDeliveryDate: shipment.plannedDeliveryDate,
    status: shipment.status,
    simulatedDate: shipment.simulatedDate,
    deliveredDate: shipment.deliveredDate,
    lines: lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      receivedQuantity: line.receivedQuantity,
    })),
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      status: event.status,
      description: event.description,
      actorName: event.actorName,
      createdAt: dateTime(event.createdAt),
    })),
    incidents: incidents.map((incident) => ({
      id: incident.id,
      type: incident.type,
      description: incident.description,
      affectedQuantity: incident.affectedQuantity,
      status: incident.status,
      resolution: incident.resolution,
      createdByName: incident.createdByName,
      resolvedByName: incident.resolvedByName,
      createdAt: dateTime(incident.createdAt),
      resolvedAt: incident.resolvedAt ? dateTime(incident.resolvedAt) : null,
    })),
    createdAt: dateTime(shipment.createdAt),
  });
}

async function insertEvent(
  tx: Transaction,
  actor: AuthContext,
  shipment: typeof fpLogisticsShipments.$inferSelect,
  values: {
    operationId: string;
    requestFingerprint: string;
    eventType: string;
    status: string;
    description: string;
  },
) {
  await tx.insert(fpLogisticsEvents).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    shipmentId: shipment.id,
    operationId: values.operationId,
    requestFingerprint: values.requestFingerprint,
    eventType: values.eventType,
    status: values.status,
    description: values.description,
    actorUserId: actor.userId,
    actorName: actor.displayName,
  });
  await tx.insert(fpActivity).values({
    id: randomUUID(),
    tenantId: actor.tenantId,
    action: values.eventType,
    description: values.description,
    reference: shipment.reference,
    simulatedDate: SIMULATED_DATE,
  });
}

router.get("/redfp360/logistics/shipments", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const condition = isNetworkSupervisor(actor)
    ? eq(fpLogisticsShipments.tenantId, actor.tenantId)
    : actor.organizationId
      ? and(
        eq(fpLogisticsShipments.tenantId, actor.tenantId),
        or(
          eq(fpLogisticsShipments.originOrganizationId, actor.organizationId),
          eq(fpLogisticsShipments.destinationOrganizationId, actor.organizationId),
        ),
      )
      : and(
        eq(fpLogisticsShipments.tenantId, actor.tenantId),
        eq(fpLogisticsShipments.id, "__no_organization__"),
      );
  const shipments = await db
    .select()
    .from(fpLogisticsShipments)
    .where(condition)
    .orderBy(desc(fpLogisticsShipments.createdAt));
  const response = await Promise.all(shipments.map((shipment) => readShipment(shipment.id, actor.tenantId)));
  res.json(ListFp360LogisticsShipmentsResponse.parse(response.filter(Boolean)));
});

router.patch("/redfp360/logistics/shipments/:id/route", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = UpdateFp360LogisticsRouteParams.safeParse(req.params);
  const body = UpdateFp360LogisticsRouteBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const normalized = {
    ...body.data,
    routeName: body.data.routeName.trim(),
    carrierName: body.data.carrierName.trim(),
  };
  if (normalized.routeName.length < 2 || normalized.carrierName.length < 2) {
    res.status(400).json({ error: "Indica una ruta y un transportista con al menos dos caracteres." });
    return;
  }
  if (normalized.plannedDeliveryDate && normalized.plannedDeliveryDate < SIMULATED_DATE) {
    res.status(400).json({ error: "La fecha prevista no puede ser anterior al inicio del escenario." });
    return;
  }
  const requestFingerprint = fingerprint({ shipmentId: params.data.id, userId: actor.userId, ...normalized });
  const result = await db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(fpLogisticsShipments).where(and(
      eq(fpLogisticsShipments.id, params.data.id),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!shipment) return { ok: false as const, status: 404 as const, error: "Expedición no encontrada." };
    if (!canPlan(actor, shipment)) return { ok: false as const, status: 403 as const, error: "Solo la organización de origen puede planificar esta ruta." };
    const [prior] = await tx.select().from(fpLogisticsEvents).where(and(
      eq(fpLogisticsEvents.tenantId, actor.tenantId),
      eq(fpLogisticsEvents.operationId, normalized.operationId),
    )).limit(1);
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) {
        return { ok: false as const, status: 409 as const, error: "La clave de operación ya se usó con otros datos." };
      }
      return { ok: true as const, shipmentId: shipment.id, replay: true as const };
    }
    if (shipment.status === "delivered") return { ok: false as const, status: 400 as const, error: "No se puede modificar la ruta de una entrega completada." };
    await tx.update(fpLogisticsShipments).set({
      routeName: normalized.routeName,
      carrierName: normalized.carrierName,
      parcelCount: normalized.parcelCount,
      plannedDeliveryDate: normalized.plannedDeliveryDate,
    }).where(and(
      eq(fpLogisticsShipments.id, shipment.id),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    ));
    await insertEvent(tx, actor, shipment, {
      operationId: normalized.operationId,
      requestFingerprint,
      eventType: "route_planned",
      status: shipment.status,
      description: `Ruta ${normalized.routeName} asignada a ${normalized.carrierName}; ${normalized.parcelCount} bulto(s).`,
    });
    return { ok: true as const, shipmentId: shipment.id, replay: false as const };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const shipment = await readShipment(result.shipmentId, actor.tenantId);
  res.json(ListFp360LogisticsShipmentsResponseItem.parse(shipment));
});

router.post("/redfp360/logistics/shipments/:id/incidents", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = CreateFp360LogisticsIncidentParams.safeParse(req.params);
  const body = CreateFp360LogisticsIncidentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const normalized = { ...body.data, description: body.data.description.trim() };
  if (normalized.description.length < 5) {
    res.status(400).json({ error: "Describe la incidencia con al menos cinco caracteres." });
    return;
  }
  const requestFingerprint = fingerprint({ shipmentId: params.data.id, userId: actor.userId, ...normalized });
  const result = await db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(fpLogisticsShipments).where(and(
      eq(fpLogisticsShipments.id, params.data.id),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!shipment) return { ok: false as const, status: 404 as const, error: "Expedición no encontrada." };
    if (!canParticipate(actor, shipment)) return { ok: false as const, status: 403 as const, error: "Tu organización no participa en esta expedición." };
    if (shipment.status === "delivered") return { ok: false as const, status: 400 as const, error: "No se puede abrir una incidencia en una entrega ya confirmada." };
    const [prior] = await tx.select().from(fpLogisticsIncidents).where(and(
      eq(fpLogisticsIncidents.tenantId, actor.tenantId),
      eq(fpLogisticsIncidents.operationId, normalized.operationId),
    )).limit(1);
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) {
        return { ok: false as const, status: 409 as const, error: "La clave de operación ya se usó con otros datos." };
      }
      return { ok: true as const, shipmentId: shipment.id, replay: true as const };
    }
    const lines = await tx.select().from(fpLogisticsShipmentLines).where(and(
      eq(fpLogisticsShipmentLines.tenantId, actor.tenantId),
      eq(fpLogisticsShipmentLines.shipmentId, shipment.id),
    ));
    const maximumAffected = lines.reduce((total, line) => total + line.quantity, 0);
    if (normalized.affectedQuantity > maximumAffected) {
      return { ok: false as const, status: 400 as const, error: "La cantidad afectada supera las unidades de esta expedición." };
    }
    const incidentId = randomUUID();
    await tx.insert(fpLogisticsIncidents).values({
      id: incidentId,
      tenantId: actor.tenantId,
      shipmentId: shipment.id,
      operationId: normalized.operationId,
      requestFingerprint,
      type: normalized.type,
      description: normalized.description,
      affectedQuantity: normalized.affectedQuantity,
      status: "open",
      createdByUserId: actor.userId,
      createdByName: actor.displayName,
    });
    await tx.update(fpLogisticsShipments).set({ status: "incident" }).where(and(
      eq(fpLogisticsShipments.id, shipment.id),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    ));
    await insertEvent(tx, actor, shipment, {
      operationId: randomUUID(),
      requestFingerprint,
      eventType: "incident_reported",
      status: "incident",
      description: `Incidencia ${normalized.type}: ${normalized.description}`,
    });
    return { ok: true as const, shipmentId: shipment.id, replay: false as const };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const shipment = await readShipment(result.shipmentId, actor.tenantId);
  res.status(201).json(ListFp360LogisticsShipmentsResponseItem.parse(shipment));
});

router.post("/redfp360/logistics/shipments/:id/incidents/:incidentId/resolve", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = ResolveFp360LogisticsIncidentParams.safeParse(req.params);
  const body = ResolveFp360LogisticsIncidentBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const resolution = body.data.resolution.trim();
  if (resolution.length < 5) {
    res.status(400).json({ error: "La resolución debe tener al menos cinco caracteres." });
    return;
  }
  const requestFingerprint = fingerprint({
    shipmentId: params.data.id,
    incidentId: params.data.incidentId,
    userId: actor.userId,
    operationId: body.data.operationId,
    resolution,
    outcome: body.data.outcome,
  });
  const result = await db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(fpLogisticsShipments).where(and(
      eq(fpLogisticsShipments.id, params.data.id),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!shipment) return { ok: false as const, status: 404 as const, error: "Expedición no encontrada." };
    if (!canParticipate(actor, shipment)) return { ok: false as const, status: 403 as const, error: "Tu organización no participa en esta expedición." };
    const [prior] = await tx.select().from(fpLogisticsEvents).where(and(
      eq(fpLogisticsEvents.tenantId, actor.tenantId),
      eq(fpLogisticsEvents.operationId, body.data.operationId),
    )).limit(1);
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) {
        return { ok: false as const, status: 409 as const, error: "La clave de operación ya se usó con otros datos." };
      }
      return { ok: true as const, shipmentId: shipment.id };
    }
    const [incident] = await tx.select().from(fpLogisticsIncidents).where(and(
      eq(fpLogisticsIncidents.id, params.data.incidentId),
      eq(fpLogisticsIncidents.shipmentId, shipment.id),
      eq(fpLogisticsIncidents.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!incident) return { ok: false as const, status: 404 as const, error: "Incidencia no encontrada." };
    if (incident.status !== "open") return { ok: false as const, status: 400 as const, error: "La incidencia ya está resuelta." };
    if (body.data.outcome === "close_partial") {
      const shipmentLines = await tx.select().from(fpLogisticsShipmentLines).where(and(
        eq(fpLogisticsShipmentLines.shipmentId, shipment.id),
        eq(fpLogisticsShipmentLines.tenantId, actor.tenantId),
      ));
      if (!shipmentLines.some((line) => line.receivedQuantity > 0 && line.receivedQuantity < line.quantity)) {
        return { ok: false as const, status: 400 as const, error: "Solo puedes cerrar parcialmente una expedición con recepción incompleta registrada." };
      }
    }
    await tx.update(fpLogisticsIncidents).set({
      status: "resolved",
      resolution,
      resolvedByUserId: actor.userId,
      resolvedByName: actor.displayName,
      resolvedAt: new Date(),
    }).where(and(
      eq(fpLogisticsIncidents.id, incident.id),
      eq(fpLogisticsIncidents.tenantId, actor.tenantId),
    ));
    const openIncidents = await tx.select({ id: fpLogisticsIncidents.id }).from(fpLogisticsIncidents).where(and(
      eq(fpLogisticsIncidents.shipmentId, shipment.id),
      eq(fpLogisticsIncidents.tenantId, actor.tenantId),
      eq(fpLogisticsIncidents.status, "open"),
    ));
    const status = openIncidents.length
      ? "incident"
      : shipment.status === "delivered" || body.data.outcome === "close_partial"
        ? "delivered"
        : "in_transit";
    await tx.update(fpLogisticsShipments).set({
      status,
      ...(status === "delivered" ? { deliveredDate: shipment.deliveredDate ?? SIMULATED_DATE } : {}),
    }).where(and(
      eq(fpLogisticsShipments.id, shipment.id),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    ));
    await insertEvent(tx, actor, shipment, {
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: "incident_resolved",
      status,
      description: `Incidencia resuelta: ${resolution}${body.data.outcome === "close_partial" ? " Se cierra la entrega con las cantidades recibidas." : ""}`,
    });
    if (status === "delivered") {
      const orderShipments = await tx.select().from(fpLogisticsShipments).where(and(
        eq(fpLogisticsShipments.orderId, shipment.orderId),
        eq(fpLogisticsShipments.tenantId, actor.tenantId),
      ));
      const orderLines = await tx.select().from(fpOrderLines).where(eq(fpOrderLines.orderId, shipment.orderId));
      if (orderShipments.every((row) => row.status === "delivered") && orderLines.every((line) => line.shippedQuantity >= line.quantity)) {
        await tx.update(fpOrders).set({ status: "delivered" }).where(and(
          eq(fpOrders.id, shipment.orderId),
          eq(fpOrders.tenantId, actor.tenantId),
        ));
      }
    }
    return { ok: true as const, shipmentId: shipment.id };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const shipment = await readShipment(result.shipmentId, actor.tenantId);
  res.json(ListFp360LogisticsShipmentsResponseItem.parse(shipment));
});

router.post("/redfp360/logistics/shipments/:id/delivery", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const params = ConfirmFp360LogisticsDeliveryParams.safeParse(req.params);
  const body = ConfirmFp360LogisticsDeliveryBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const deliveryNote = body.data.deliveryNote?.trim() ?? "";
  const receivedByProduct = new Map(body.data.lines.map((line) => [line.productId, line.receivedQuantity]));
  if (receivedByProduct.size !== body.data.lines.length) {
    res.status(400).json({ error: "No repitas productos en la confirmación de recepción." });
    return;
  }
  const requestFingerprint = fingerprint({
    shipmentId: params.data.id,
    userId: actor.userId,
    operationId: body.data.operationId,
    deliveryNote,
    lines: [...body.data.lines].sort((a, b) => a.productId.localeCompare(b.productId)),
  });
  const result = await db.transaction(async (tx) => {
    const [shipment] = await tx.select().from(fpLogisticsShipments).where(and(
      eq(fpLogisticsShipments.id, params.data.id),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!shipment) return { ok: false as const, status: 404 as const, error: "Expedición no encontrada." };
    if (!canReceive(actor, shipment)) return { ok: false as const, status: 403 as const, error: "Solo la organización de destino puede confirmar la recepción." };
    const [order] = await tx.select().from(fpOrders).where(and(
      eq(fpOrders.id, shipment.orderId),
      eq(fpOrders.tenantId, actor.tenantId),
    )).for("update").limit(1);
    if (!order) return { ok: false as const, status: 404 as const, error: "Pedido de la expedición no encontrado." };
    const [prior] = await tx.select().from(fpLogisticsEvents).where(and(
      eq(fpLogisticsEvents.tenantId, actor.tenantId),
      eq(fpLogisticsEvents.operationId, body.data.operationId),
    )).limit(1);
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) {
        return { ok: false as const, status: 409 as const, error: "La clave de operación ya se usó con otros datos." };
      }
      return { ok: true as const, shipmentId: shipment.id };
    }
    if (shipment.status === "incident") return { ok: false as const, status: 409 as const, error: "Resuelve las incidencias abiertas antes de confirmar la recepción." };
    if (shipment.status === "delivered") return { ok: false as const, status: 400 as const, error: "La expedición ya está confirmada como entregada." };
    const orderLines = await tx.select().from(fpOrderLines).where(eq(fpOrderLines.orderId, shipment.orderId)).for("update");
    const shipmentLines = await tx.select().from(fpLogisticsShipmentLines).where(and(
      eq(fpLogisticsShipmentLines.shipmentId, shipment.id),
      eq(fpLogisticsShipmentLines.tenantId, actor.tenantId),
    )).for("update");
    if (receivedByProduct.size !== shipmentLines.length || shipmentLines.some((line) => !receivedByProduct.has(line.productId))) {
      return { ok: false as const, status: 400 as const, error: "Incluye cada referencia de esta expedición una sola vez." };
    }
    const shortages: Array<{ productName: string; quantity: number }> = [];
    for (const line of shipmentLines) {
      const receivedNow = receivedByProduct.get(line.productId) ?? 0;
      const orderLine = orderLines.find((item) => item.id === line.orderLineId);
      if (!orderLine) return { ok: false as const, status: 404 as const, error: "Línea de pedido de la expedición no encontrada." };
      if (receivedNow > line.quantity - line.receivedQuantity) {
        return { ok: false as const, status: 400 as const, error: "La cantidad recibida supera lo pendiente de esta expedición." };
      }
      const receivedTotal = line.receivedQuantity + receivedNow;
      if (receivedTotal < line.quantity) shortages.push({ productName: line.productName, quantity: line.quantity - receivedTotal });
      await tx.update(fpLogisticsShipmentLines).set({ receivedQuantity: receivedTotal }).where(and(
        eq(fpLogisticsShipmentLines.id, line.id),
        eq(fpLogisticsShipmentLines.tenantId, actor.tenantId),
      ));
      await tx.update(fpOrderLines).set({
        receivedQuantity: orderLine.receivedQuantity + receivedNow,
      }).where(and(
        eq(fpOrderLines.id, line.orderLineId),
        eq(fpOrderLines.orderId, shipment.orderId),
      ));
      orderLine.receivedQuantity += receivedNow;
    }
    const shipmentStatus = shortages.length ? "incident" : "delivered";
    await tx.update(fpLogisticsShipments).set({
      status: shipmentStatus,
      deliveredDate: shortages.length ? null : SIMULATED_DATE,
    }).where(and(
      eq(fpLogisticsShipments.id, shipment.id),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    ));
    if (shortages.length) {
      const affectedQuantity = shortages.reduce((sum, shortage) => sum + shortage.quantity, 0);
      const incidentDescription = `Recepción parcial: quedan ${affectedQuantity} unidades pendientes. ${deliveryNote}`.trim();
      await tx.insert(fpLogisticsIncidents).values({
        id: randomUUID(),
        tenantId: actor.tenantId,
        shipmentId: shipment.id,
        operationId: randomUUID(),
        requestFingerprint: fingerprint({ shipmentId: shipment.id, requestFingerprint, shortages }),
        type: "missing",
        description: incidentDescription,
        affectedQuantity,
        status: "open",
        createdByUserId: actor.userId,
        createdByName: actor.displayName,
      });
    }
    await insertEvent(tx, actor, shipment, {
      operationId: body.data.operationId,
      requestFingerprint,
      eventType: shortages.length ? "partial_delivery_received" : "delivery_confirmed",
      status: shipmentStatus,
      description: shortages.length
        ? `Recepción parcial; quedan ${shortages.reduce((sum, item) => sum + item.quantity, 0)} unidades pendientes.${deliveryNote ? ` ${deliveryNote}` : ""}`
        : deliveryNote
          ? `Recepción completa confirmada. ${deliveryNote}`
          : "La organización destinataria confirmó la recepción completa.",
    });
    const orderShipments = await tx.select().from(fpLogisticsShipments).where(and(
      eq(fpLogisticsShipments.orderId, shipment.orderId),
      eq(fpLogisticsShipments.tenantId, actor.tenantId),
    ));
    const allShipmentsDelivered = orderShipments.every((row) =>
      row.status === "delivered" || (row.id === shipment.id && !shortages.length),
    );
    if (
      allShipmentsDelivered &&
      orderLines.every((line) => line.shippedQuantity >= line.quantity)
    ) {
      await tx.update(fpOrders).set({ status: "delivered" }).where(and(
        eq(fpOrders.id, shipment.orderId),
        eq(fpOrders.tenantId, actor.tenantId),
      ));
    }
    return { ok: true as const, shipmentId: shipment.id };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const response = await readShipment(result.shipmentId, actor.tenantId);
  res.json(ListFp360LogisticsShipmentsResponseItem.parse(response));
});

export default router;

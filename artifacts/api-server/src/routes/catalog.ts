import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter } from "express";
import {
  AdjustFp360StockBody, AdjustFp360StockParams, AdjustFp360StockResponse,
  CreateFp360OrganizationBody, CreateFp360OrganizationResponse,
  CreateFp360ProductBody, CreateFp360ProductResponse,
  ListFp360StockAdjustmentsParams, ListFp360StockAdjustmentsResponse,
  UpdateFp360OrganizationBody, UpdateFp360OrganizationParams, UpdateFp360OrganizationResponse,
  UpdateFp360ProductBody, UpdateFp360ProductParams, UpdateFp360ProductResponse,
} from "@workspace/api-zod";
import { db, fpActivity, fpAuthInvitations, fpAuthMemberships, fpOrganizations, fpProducts, fpStockAdjustments } from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const SIMULATED_DATE = "2027-09-15";
class CatalogError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new CatalogError(status, message); }
function nonBlank(value: string | undefined, label: string) {
  if (value !== undefined && !value.trim()) fail(400, `${label} no puede estar vacío.`);
}
async function activity(tx: Transaction, actor: AuthContext, action: string, description: string, reference: string) {
  await tx.insert(fpActivity).values({
    id: randomUUID(), tenantId: actor.tenantId, action,
    description: `${description} · Responsable: ${actor.displayName}`,
    reference, simulatedDate: SIMULATED_DATE,
  });
}
async function lockDirectory(tx: Transaction, tenantId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fp360-directory:${tenantId}`}))`);
}
async function checkDuplicate(tx: Transaction, tenantId: string, name: string, center: string, excludingId = "") {
  const [duplicate] = await tx.select({ id: fpOrganizations.id }).from(fpOrganizations).where(and(
    eq(fpOrganizations.tenantId, tenantId), ne(fpOrganizations.id, excludingId),
    sql`lower(trim(${fpOrganizations.name})) = lower(trim(${name}))`,
    sql`lower(trim(${fpOrganizations.center})) = lower(trim(${center}))`,
  ));
  if (duplicate) fail(409, "Ya existe una empresa con ese nombre en el mismo centro, incluso si está archivada.");
}

router.use("/redfp360", requireAuth, requireSimulationWriteAccess);

router.post("/redfp360/organizations", async (req, res): Promise<void> => {
  const body = CreateFp360OrganizationBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa los datos de la empresa simulada.");
  nonBlank(body.data.name, "El nombre");
  nonBlank(body.data.center, "El centro");
  const actor = req.auth!;
  const organization = await db.transaction(async (tx) => {
    await lockDirectory(tx, actor.tenantId);
    await checkDuplicate(tx, actor.tenantId, body.data.name, body.data.center);
    const [created] = await tx.insert(fpOrganizations).values({
      ...body.data, name: body.data.name.trim(), center: body.data.center.trim(),
      id: randomUUID(), tenantId: actor.tenantId, isActive: true,
    }).returning();
    await activity(tx, actor, "Empresa creada", `Alta de ${created.name} en el directorio simulado.`, created.id);
    return created;
  });
  res.status(201).json(CreateFp360OrganizationResponse.parse(organization));
});

router.patch("/redfp360/organizations/:id", async (req, res): Promise<void> => {
  const params = UpdateFp360OrganizationParams.safeParse(req.params);
  const body = UpdateFp360OrganizationBody.safeParse(req.body);
  if (!params.success || !body.success || !Object.keys(body.data).length) fail(400, "No hay cambios válidos.");
  nonBlank(body.data.name, "El nombre");
  nonBlank(body.data.center, "El centro");
  const actor = req.auth!;
  const organization = await db.transaction(async (tx) => {
    await lockDirectory(tx, actor.tenantId);
    const [previous] = await tx.select().from(fpOrganizations).where(and(
      eq(fpOrganizations.id, params.data.id), eq(fpOrganizations.tenantId, actor.tenantId),
    )).for("update");
    if (!previous) fail(404, "Empresa no encontrada en tu red.");
    const name = body.data.name?.trim() ?? previous.name;
    const center = body.data.center?.trim() ?? previous.center;
    await checkDuplicate(tx, actor.tenantId, name, center, previous.id);
    if (body.data.isActive === false) {
      const [assignment] = await tx.select({ id: fpAuthMemberships.id }).from(fpAuthMemberships).where(and(
        eq(fpAuthMemberships.organizationId, previous.id), eq(fpAuthMemberships.isActive, true),
      )).limit(1);
      if (assignment) fail(409, "Reasigna primero las cuentas activas vinculadas a esta empresa.");
      const [invitation] = await tx.select({ id: fpAuthInvitations.id }).from(fpAuthInvitations).where(and(
        eq(fpAuthInvitations.organizationId, previous.id), isNull(fpAuthInvitations.acceptedAt),
        isNull(fpAuthInvitations.revokedAt), gt(fpAuthInvitations.expiresAt, new Date()),
      )).limit(1);
      if (invitation) fail(409, "Revoca primero las invitaciones pendientes vinculadas a esta empresa.");
    }
    const [updated] = await tx.update(fpOrganizations).set({ ...body.data, name, center })
      .where(and(eq(fpOrganizations.id, previous.id), eq(fpOrganizations.tenantId, actor.tenantId))).returning();
    await activity(tx, actor, "Empresa actualizada", `Se ha actualizado la ficha de ${name}; se conserva su historial.`, previous.id);
    return updated;
  });
  res.json(UpdateFp360OrganizationResponse.parse(organization));
});

router.post("/redfp360/products", async (req, res): Promise<void> => {
  const body = CreateFp360ProductBody.safeParse(req.body);
  if (!body.success) fail(400, "Revisa la referencia, los importes y las existencias.");
  nonBlank(body.data.name, "El nombre");
  nonBlank(body.data.category, "La categoría");
  const actor = req.auth!;
  const product = await db.transaction(async (tx) => {
    const [created] = await tx.insert(fpProducts).values({
      ...body.data, sku: body.data.sku.trim().toUpperCase(), name: body.data.name.trim(),
      category: body.data.category.trim(), costCents: body.data.costCents ?? 0,
      minimumStock: body.data.minimumStock ?? 0,
      id: randomUUID(), tenantId: actor.tenantId, reserved: 0, isActive: true, isPublished: false,
    }).returning();
    if (created.stock > 0) {
      await tx.insert(fpStockAdjustments).values({
        id: randomUUID(), tenantId: actor.tenantId, productId: created.id, quantityDelta: created.stock,
        stockBefore: 0, stockAfter: created.stock, reason: "Existencias iniciales al crear la referencia.",
        actorUserId: actor.userId, actorName: actor.displayName, simulatedDate: SIMULATED_DATE,
      });
    }
    await activity(tx, actor, "Producto creado", `Referencia ${created.sku} creada, pendiente de aprobación para el mercado.`, created.id);
    return created;
  });
  res.status(201).json(CreateFp360ProductResponse.parse(product));
});

router.patch("/redfp360/products/:id", async (req, res): Promise<void> => {
  const params = UpdateFp360ProductParams.safeParse(req.params);
  const body = UpdateFp360ProductBody.safeParse(req.body);
  if (!params.success || !body.success || !Object.keys(body.data).length) fail(400, "No hay cambios válidos.");
  nonBlank(body.data.name, "El nombre");
  nonBlank(body.data.category, "La categoría");
  const actor = req.auth!;
  if (body.data.isPublished !== undefined && !["teacher", "administrator"].includes(actor.role)) {
    fail(403, "Solo el profesorado y la administración pueden aprobar la publicación en el mercado.");
  }
  const product = await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(fpProducts).where(and(
      eq(fpProducts.id, params.data.id), eq(fpProducts.tenantId, actor.tenantId),
    )).for("update");
    if (!previous) fail(404, "Producto no encontrado en tu red.");
    const next = {
      ...body.data,
      ...(body.data.sku !== undefined ? { sku: body.data.sku.toUpperCase() } : {}),
      ...(body.data.name !== undefined ? { name: body.data.name.trim() } : {}),
      ...(body.data.category !== undefined ? { category: body.data.category.trim() } : {}),
    };
    const priceChanged =
      (next.unitPriceCents !== undefined && next.unitPriceCents !== previous.unitPriceCents) ||
      (next.igicBasisPoints !== undefined && next.igicBasisPoints !== previous.igicBasisPoints);
    if (priceChanged || next.isActive === false) next.isPublished = false;
    if (next.isActive === false && previous.reserved > 0) {
      fail(409, "No puedes archivar una referencia con unidades reservadas.");
    }
    if (next.isPublished === true && !(next.isActive ?? previous.isActive)) {
      fail(409, "Reactiva el producto antes de publicarlo.");
    }
    const [updated] = await tx.update(fpProducts).set(next).where(and(
      eq(fpProducts.id, previous.id), eq(fpProducts.tenantId, actor.tenantId),
    )).returning();
    await activity(tx, actor, "Producto actualizado",
      `Referencia ${updated.sku} actualizada.${priceChanged ? " El cambio de precio o impuesto requiere nueva aprobación; los documentos históricos no cambian." : ""}`,
      previous.id);
    return updated;
  });
  res.json(UpdateFp360ProductResponse.parse(product));
});

router.get("/redfp360/products/:id/stock-adjustments", async (req, res): Promise<void> => {
  const params = ListFp360StockAdjustmentsParams.safeParse(req.params);
  if (!params.success) fail(400, "Referencia no válida.");
  const tenantId = req.auth!.tenantId;
  const [product] = await db.select({ id: fpProducts.id }).from(fpProducts).where(and(
    eq(fpProducts.id, params.data.id), eq(fpProducts.tenantId, tenantId),
  ));
  if (!product) fail(404, "Producto no encontrado en tu red.");
  const rows = await db.select().from(fpStockAdjustments).where(and(
    eq(fpStockAdjustments.productId, product.id), eq(fpStockAdjustments.tenantId, tenantId),
  )).orderBy(desc(fpStockAdjustments.createdAt));
  res.json(ListFp360StockAdjustmentsResponse.parse(rows.map((row) => ({
    ...row, createdAt: row.createdAt.toISOString(),
  }))));
});

router.post("/redfp360/products/:id/stock-adjustments", async (req, res): Promise<void> => {
  const params = AdjustFp360StockParams.safeParse(req.params);
  const body = AdjustFp360StockBody.safeParse(req.body);
  if (!params.success || !body.success || body.data.quantityDelta === 0 || body.data.reason.trim().length < 5) {
    fail(400, "Indica una cantidad entera distinta de cero y un motivo de al menos cinco caracteres.");
  }
  const actor = req.auth!;
  const product = await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(fpProducts).where(and(
      eq(fpProducts.id, params.data.id), eq(fpProducts.tenantId, actor.tenantId),
    )).for("update");
    if (!previous) fail(404, "Producto no encontrado en tu red.");
    const [replay] = await tx.select().from(fpStockAdjustments).where(eq(fpStockAdjustments.id, body.data.operationId));
    if (replay) {
      if (replay.tenantId !== actor.tenantId || replay.productId !== previous.id || replay.actorUserId !== actor.userId ||
        replay.quantityDelta !== body.data.quantityDelta || replay.reason !== body.data.reason.trim()) {
        fail(409, "Este identificador de operación ya se utilizó. Reabre el formulario para registrar un ajuste nuevo.");
      }
      return previous;
    }
    if (!previous.isActive) fail(409, "Reactiva el producto antes de ajustar las existencias.");
    const stock = previous.stock + body.data.quantityDelta;
    if (stock < previous.reserved || stock < 0 || stock > 1000000) {
      fail(409, "El stock debe estar entre las unidades reservadas y un millón de unidades.");
    }
    const [updated] = await tx.update(fpProducts).set({ stock }).where(and(
      eq(fpProducts.id, previous.id), eq(fpProducts.tenantId, actor.tenantId),
    )).returning();
    await tx.insert(fpStockAdjustments).values({
      id: body.data.operationId, tenantId: actor.tenantId, productId: previous.id,
      quantityDelta: body.data.quantityDelta, stockBefore: previous.stock, stockAfter: stock,
      reason: body.data.reason.trim(), actorUserId: actor.userId, actorName: actor.displayName,
      simulatedDate: SIMULATED_DATE,
    });
    await activity(tx, actor, "Ajuste de existencias",
      `${previous.sku}: ${previous.stock} → ${stock} unidades. Motivo: ${body.data.reason.trim()}`, previous.id);
    return updated;
  });
  res.json(AdjustFp360StockResponse.parse(product));
});

const handleCatalogError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof CatalogError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error?.code === "23505" || error?.cause?.code === "23505") {
    res.status(409).json({ message: "Ya existe una referencia con ese SKU en tu red, incluso si está archivada." });
    return;
  }
  next(error);
};
router.use(handleCatalogError);
export default router;

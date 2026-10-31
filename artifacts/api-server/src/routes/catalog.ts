import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { Router, type ErrorRequestHandler, type IRouter } from "express";
import {
  AdjustFp360StockBody, AdjustFp360StockParams, AdjustFp360StockResponse,
  CompleteFp360ProductDocumentUploadParams, CompleteFp360ProductDocumentUploadResponse,
  CreateFp360OrganizationBody, CreateFp360OrganizationResponse,
  CreateFp360ProductBody, CreateFp360ProductResponse,
  DeleteFp360ProductDocumentParams, DeleteFp360ProductDocumentResponse,
  DownloadFp360ProductDocumentParams,
  ListFp360ProductDocumentsParams, ListFp360ProductDocumentsResponse,
  ListFp360ProductPriceVersionsParams, ListFp360ProductPriceVersionsResponse,
  RequestFp360ProductDocumentUploadUrlBody, RequestFp360ProductDocumentUploadUrlParams,
  RequestFp360ProductDocumentUploadUrlResponse,
  ListFp360StockAdjustmentsParams, ListFp360StockAdjustmentsResponse,
  UpdateFp360OrganizationBody, UpdateFp360OrganizationParams, UpdateFp360OrganizationResponse,
  UpdateFp360ProductBody, UpdateFp360ProductParams, UpdateFp360ProductResponse,
} from "@workspace/api-zod";
import { db, fpActivity, fpAuthInvitations, fpAuthMemberships, fpOrganizations, fpProducts, fpProductDocuments, fpProductPriceVersions, fpStockAdjustments } from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const SIMULATED_DATE = "2027-09-15";
const MAX_PRODUCT_DOCUMENT_BYTES = 10 * 1024 * 1024;
const DOCUMENT_EXTENSIONS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};
class CatalogError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new CatalogError(status, message); }
function nonBlank(value: string | undefined, label: string) {
  if (value !== undefined && !value.trim()) fail(400, `${label} no puede estar vacío.`);
}
function documentResponse(row: typeof fpProductDocuments.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
function sanitizeDocumentName(value: string) {
  return value.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim().slice(0, 200);
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
  nonBlank(body.data.unit, "La unidad de medida");
  const actor = req.auth!;
  const itemType = body.data.itemType ?? "product";
  const tracksInventory = body.data.tracksInventory ?? itemType === "product";
  const stock = body.data.stock;
  const minimumStock = body.data.minimumStock ?? 0;
  if ((itemType === "service" && tracksInventory) || (!tracksInventory && (stock !== 0 || minimumStock !== 0))) {
    fail(400, "Los servicios y las referencias sin control de almacén no pueden tener existencias ni stock mínimo.");
  }
  const product = await db.transaction(async (tx) => {
    const supplierOrganizationId = body.data.supplierOrganizationId ?? null;
    if (supplierOrganizationId) {
      const [supplier] = await tx.select().from(fpOrganizations).where(and(
        eq(fpOrganizations.id, supplierOrganizationId),
        eq(fpOrganizations.tenantId, actor.tenantId),
      ));
      if (!supplier || !supplier.isActive || !["seller", "both"].includes(supplier.role)) {
        fail(400, "Selecciona un proveedor activo de tu empresa o red autorizada.");
      }
    }
    const [created] = await tx.insert(fpProducts).values({
      ...body.data,
      sku: body.data.sku.trim().toUpperCase(),
      name: body.data.name.trim(),
      description: body.data.description?.trim() ?? "",
      category: body.data.category.trim(),
      itemType,
      unit: body.data.unit?.trim() || (itemType === "service" ? "servicio" : "unidad"),
      tracksInventory,
      stock: tracksInventory ? stock : 0,
      costCents: body.data.costCents ?? 0,
      minimumStock: tracksInventory ? minimumStock : 0,
      maxDiscountBasisPoints: body.data.maxDiscountBasisPoints ?? 0,
      leadTimeDays: body.data.leadTimeDays ?? 0,
      supplierOrganizationId,
      id: randomUUID(), tenantId: actor.tenantId, reserved: 0, isActive: true, isPublished: false,
    }).returning();
    await tx.insert(fpProductPriceVersions).values({
      id: randomUUID(),
      tenantId: actor.tenantId,
      productId: created.id,
      unitPriceCents: created.unitPriceCents,
      costCents: created.costCents,
      igicBasisPoints: created.igicBasisPoints,
      maxDiscountBasisPoints: created.maxDiscountBasisPoints,
      validFrom: SIMULATED_DATE,
      reason: "Tarifa inicial",
      actorUserId: actor.userId,
      actorName: actor.displayName,
    });
    if (created.tracksInventory && created.stock > 0) {
      await tx.insert(fpStockAdjustments).values({
        id: randomUUID(), tenantId: actor.tenantId, productId: created.id, quantityDelta: created.stock,
        stockBefore: 0, stockAfter: created.stock, reason: "Existencias iniciales al crear la referencia.",
        actorUserId: actor.userId, actorName: actor.displayName, simulatedDate: SIMULATED_DATE,
      });
    }
    await activity(tx, actor, "Referencia de catálogo creada", `${created.itemType === "service" ? "Servicio" : "Producto"} ${created.sku} creado, pendiente de aprobación para el mercado.`, created.id);
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
  nonBlank(body.data.unit, "La unidad de medida");
  const actor = req.auth!;
  if (body.data.isPublished !== undefined && !["teacher", "administrator"].includes(actor.role)) {
    fail(403, "Solo el profesorado y la administración pueden aprobar la publicación en el mercado.");
  }
  const { priceChangeReason, effectiveFrom, ...changes } = body.data;
  const product = await db.transaction(async (tx) => {
    const [previous] = await tx.select().from(fpProducts).where(and(
      eq(fpProducts.id, params.data.id), eq(fpProducts.tenantId, actor.tenantId),
    )).for("update");
    if (!previous) fail(404, "Referencia de catálogo no encontrada en tu red.");
    const next = {
      ...changes,
      ...(changes.sku !== undefined ? { sku: changes.sku.trim().toUpperCase() } : {}),
      ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
      ...(changes.description !== undefined ? { description: changes.description.trim() } : {}),
      ...(changes.category !== undefined ? { category: changes.category.trim() } : {}),
      ...(changes.unit !== undefined ? { unit: changes.unit.trim() } : {}),
    };
    const priceChanged =
      (next.unitPriceCents !== undefined && next.unitPriceCents !== previous.unitPriceCents) ||
      (next.costCents !== undefined && next.costCents !== previous.costCents) ||
      (next.igicBasisPoints !== undefined && next.igicBasisPoints !== previous.igicBasisPoints) ||
      (next.maxDiscountBasisPoints !== undefined && next.maxDiscountBasisPoints !== previous.maxDiscountBasisPoints);
    if (priceChanged && (!priceChangeReason || priceChangeReason.trim().length < 5)) {
      fail(400, "Explica el cambio de tarifa con un motivo de al menos cinco caracteres.");
    }
    if (!priceChanged && (priceChangeReason !== undefined || effectiveFrom !== undefined)) {
      fail(400, "El motivo y la fecha solo se aplican al versionar una tarifa.");
    }
    if (next.igicBasisPoints !== undefined && next.igicBasisPoints !== previous.igicBasisPoints &&
      !["teacher", "administrator"].includes(actor.role)) {
      fail(403, "El cambio de IGIC requiere revisión del profesorado o la administración.");
    }
    const nextType = next.itemType ?? previous.itemType;
    const nextTracksInventory = next.tracksInventory ?? (nextType === "service" ? false : previous.tracksInventory);
    if (nextType === "service" && nextTracksInventory) {
      fail(400, "Un servicio no puede controlar existencias de almacén.");
    }
    if (!nextTracksInventory && (previous.stock > 0 || previous.reserved > 0)) {
      fail(409, "Registra primero la salida de existencias y completa las reservas antes de retirar el control de almacén.");
    }
    if (nextType === "service") {
      next.tracksInventory = false;
      next.minimumStock = 0;
    }
    if (!nextTracksInventory && (next.minimumStock ?? previous.minimumStock) !== 0) {
      fail(400, "Una referencia sin control de almacén debe tener stock mínimo cero.");
    }
    if (next.supplierOrganizationId) {
      const [supplier] = await tx.select().from(fpOrganizations).where(and(
        eq(fpOrganizations.id, next.supplierOrganizationId),
        eq(fpOrganizations.tenantId, actor.tenantId),
      ));
      if (!supplier || !supplier.isActive || !["seller", "both"].includes(supplier.role)) {
        fail(400, "Selecciona un proveedor activo de tu empresa o red autorizada.");
      }
    }
    if (priceChanged || next.isActive === false) next.isPublished = false;
    if (next.isActive === false && previous.reserved > 0) {
      fail(409, "No puedes archivar una referencia con unidades reservadas.");
    }
    if (next.isPublished === true && !(next.isActive ?? previous.isActive)) {
      fail(409, "Reactiva la referencia antes de publicarla.");
    }
    const [updated] = await tx.update(fpProducts).set(next).where(and(
      eq(fpProducts.id, previous.id), eq(fpProducts.tenantId, actor.tenantId),
    )).returning();
    if (priceChanged) {
      const [latestVersion] = await tx.select().from(fpProductPriceVersions).where(and(
        eq(fpProductPriceVersions.tenantId, actor.tenantId),
        eq(fpProductPriceVersions.productId, previous.id),
      )).orderBy(desc(fpProductPriceVersions.validFrom), desc(fpProductPriceVersions.createdAt)).limit(1);
      const validFrom = effectiveFrom ?? SIMULATED_DATE;
      if (latestVersion && validFrom < latestVersion.validFrom) {
        fail(409, "La fecha de vigencia no puede ser anterior a la última tarifa registrada.");
      }
      await tx.insert(fpProductPriceVersions).values({
        id: randomUUID(),
        tenantId: actor.tenantId,
        productId: previous.id,
        unitPriceCents: updated.unitPriceCents,
        costCents: updated.costCents,
        igicBasisPoints: updated.igicBasisPoints,
        maxDiscountBasisPoints: updated.maxDiscountBasisPoints,
        validFrom,
        reason: priceChangeReason!.trim(),
        actorUserId: actor.userId,
        actorName: actor.displayName,
      });
    }
    await activity(tx, actor, "Referencia de catálogo actualizada",
      `Referencia ${updated.sku} actualizada.${priceChanged ? " La nueva tarifa requiere aprobación y los documentos históricos conservan sus importes." : ""}`,
      previous.id);
    return updated;
  });
  res.json(UpdateFp360ProductResponse.parse(product));
});

router.get("/redfp360/products/:id/price-versions", async (req, res): Promise<void> => {
  const params = ListFp360ProductPriceVersionsParams.safeParse(req.params);
  if (!params.success) fail(400, "Referencia no válida.");
  const tenantId = req.auth!.tenantId;
  const [product] = await db.select({ id: fpProducts.id }).from(fpProducts).where(and(
    eq(fpProducts.id, params.data.id), eq(fpProducts.tenantId, tenantId),
  ));
  if (!product) fail(404, "Referencia de catálogo no encontrada en tu red.");
  const rows = await db.select().from(fpProductPriceVersions).where(and(
    eq(fpProductPriceVersions.productId, product.id),
    eq(fpProductPriceVersions.tenantId, tenantId),
  )).orderBy(desc(fpProductPriceVersions.validFrom), desc(fpProductPriceVersions.createdAt));
  res.json(ListFp360ProductPriceVersionsResponse.parse(rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }))));
});

router.get("/redfp360/products/:id/documents", async (req, res): Promise<void> => {
  const params = ListFp360ProductDocumentsParams.safeParse(req.params);
  if (!params.success) fail(400, "Referencia no válida.");
  const tenantId = req.auth!.tenantId;
  const [product] = await db.select({ id: fpProducts.id }).from(fpProducts).where(and(
    eq(fpProducts.id, params.data.id), eq(fpProducts.tenantId, tenantId),
  ));
  if (!product) fail(404, "Referencia de catálogo no encontrada en tu red.");
  const documents = await db.select().from(fpProductDocuments).where(and(
    eq(fpProductDocuments.productId, product.id), eq(fpProductDocuments.tenantId, tenantId),
  )).orderBy(desc(fpProductDocuments.createdAt));
  res.json(ListFp360ProductDocumentsResponse.parse(documents.map(documentResponse)));
});

router.post("/redfp360/products/:id/documents/upload-url", async (req, res): Promise<void> => {
  const params = RequestFp360ProductDocumentUploadUrlParams.safeParse(req.params);
  const body = RequestFp360ProductDocumentUploadUrlBody.safeParse(req.body);
  if (!params.success || !body.success) fail(400, "Revisa el documento y su formato.");
  const actor = req.auth!;
  const [product] = await db.select().from(fpProducts).where(and(
    eq(fpProducts.id, params.data.id), eq(fpProducts.tenantId, actor.tenantId),
  ));
  if (!product) fail(404, "Referencia de catálogo no encontrada en tu red.");
  if (!product.isActive) fail(409, "Reactiva la referencia antes de adjuntar documentos.");
  if (body.data.size > MAX_PRODUCT_DOCUMENT_BYTES) fail(400, "El documento no puede superar los 10 MB.");
  const originalName = sanitizeDocumentName(body.data.name);
  if (!originalName) fail(400, "El nombre del documento no es válido.");
  const extension = `.${originalName.split(".").pop()?.toLocaleLowerCase("en") ?? ""}`;
  if (!DOCUMENT_EXTENSIONS[body.data.contentType]?.includes(extension)) {
    fail(400, "El tipo de archivo y su extensión no coinciden.");
  }

  const uploadURL = await objectStorageService.getObjectEntityUploadURL();
  const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
  if (!/^\/objects\/uploads\/[a-f0-9-]{36}$/i.test(objectPath)) {
    throw new Error("Object storage returned an unexpected private object path.");
  }
  const documentId = randomUUID();
  await db.insert(fpProductDocuments).values({
    id: documentId,
    tenantId: actor.tenantId,
    productId: product.id,
    objectPath,
    originalName,
    contentType: body.data.contentType,
    sizeBytes: body.data.size,
    description: body.data.description?.trim() ?? "",
    status: "pending",
    uploaderUserId: actor.userId,
    uploaderName: actor.displayName,
  });
  res.json(RequestFp360ProductDocumentUploadUrlResponse.parse({ documentId, uploadURL }));
});

router.post("/redfp360/products/:id/documents/:documentId/complete", async (req, res): Promise<void> => {
  const params = CompleteFp360ProductDocumentUploadParams.safeParse(req.params);
  if (!params.success) fail(400, "Documento no válido.");
  const actor = req.auth!;
  const document = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(fpProductDocuments).where(and(
      eq(fpProductDocuments.id, params.data.documentId),
      eq(fpProductDocuments.productId, params.data.id),
      eq(fpProductDocuments.tenantId, actor.tenantId),
    )).for("update");
    if (!row) fail(404, "Documento no encontrado en esta referencia.");
    if (row.status === "ready") return row;
    let file;
    try {
      file = await objectStorageService.getObjectEntityFile(row.objectPath);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) fail(404, "No se ha encontrado el archivo cargado.");
      throw error;
    }
    const [metadata] = await file.getMetadata();
    const actualSize = Number(metadata.size);
    const actualContentType = String(metadata.contentType ?? "");
    if (!Number.isSafeInteger(actualSize) || actualSize !== row.sizeBytes || actualSize > MAX_PRODUCT_DOCUMENT_BYTES ||
      actualContentType !== row.contentType) {
      try {
        await file.delete({ ignoreNotFound: true });
      } catch (error) {
        req.log.error({ err: error, documentId: row.id }, "Could not remove an invalid product document upload");
      }
      fail(400, "El archivo cargado no coincide con el tipo o tamaño declarado.");
    }
    const [updated] = await tx.update(fpProductDocuments).set({ status: "ready" }).where(and(
      eq(fpProductDocuments.id, row.id), eq(fpProductDocuments.tenantId, actor.tenantId),
    )).returning();
    const [product] = await tx.select({ name: fpProducts.name }).from(fpProducts).where(eq(fpProducts.id, row.productId));
    await activity(tx, actor, "Documento de catálogo adjuntado",
      `${row.originalName} se ha vinculado a ${product?.name ?? "una referencia de catálogo"}.`, row.productId);
    return updated;
  });
  res.json(CompleteFp360ProductDocumentUploadResponse.parse(documentResponse(document)));
});

router.get("/redfp360/products/:id/documents/:documentId/download", async (req, res): Promise<void> => {
  const params = DownloadFp360ProductDocumentParams.safeParse(req.params);
  if (!params.success) fail(400, "Documento no válido.");
  const [document] = await db.select().from(fpProductDocuments).where(and(
    eq(fpProductDocuments.id, params.data.documentId),
    eq(fpProductDocuments.productId, params.data.id),
    eq(fpProductDocuments.tenantId, req.auth!.tenantId),
    eq(fpProductDocuments.status, "ready"),
  ));
  if (!document) fail(404, "Documento disponible no encontrado en esta referencia.");
  let file;
  try {
    file = await objectStorageService.getObjectEntityFile(document.objectPath);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) fail(404, "No se ha encontrado el archivo.");
    throw error;
  }
  const [downloadURL] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 5 * 60 * 1000,
    responseDisposition: "attachment",
  });
  res.redirect(302, downloadURL);
});

router.delete("/redfp360/products/:id/documents/:documentId", async (req, res): Promise<void> => {
  const params = DeleteFp360ProductDocumentParams.safeParse(req.params);
  if (!params.success) fail(400, "Documento no válido.");
  const actor = req.auth!;
  const [document] = await db.select().from(fpProductDocuments).where(and(
    eq(fpProductDocuments.id, params.data.documentId),
    eq(fpProductDocuments.productId, params.data.id),
    eq(fpProductDocuments.tenantId, actor.tenantId),
  ));
  if (!document) fail(404, "Documento no encontrado en esta referencia.");
  try {
    const file = await objectStorageService.getObjectEntityFile(document.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (error) {
    if (!(error instanceof ObjectNotFoundError)) throw error;
  }
  await db.transaction(async (tx) => {
    await tx.delete(fpProductDocuments).where(and(
      eq(fpProductDocuments.id, document.id), eq(fpProductDocuments.tenantId, actor.tenantId),
    ));
    await activity(tx, actor, "Documento de catálogo eliminado",
      `Se ha eliminado ${document.originalName} de la referencia ${document.productId}.`, document.productId);
  });
  res.json(DeleteFp360ProductDocumentResponse.parse({ deleted: true }));
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
    if (!previous.tracksInventory) fail(409, "Esta referencia no controla existencias de almacén.");
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

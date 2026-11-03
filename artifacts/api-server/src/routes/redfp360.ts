import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateFp360OrderBody,
  CreateFp360OrderResponse,
  ConfirmFp360OrderParams,
  ConfirmFp360OrderResponse,
  DispatchFp360OrderBody,
  DispatchFp360OrderParams,
  DispatchFp360OrderResponse,
  GetFp360DashboardResponse,
  IssueFp360InvoiceBody,
  IssueFp360InvoiceResponse,
  ListFp360ActivityResponse,
  ListFp360InvoicesResponse,
  ListFp360OrdersResponse,
  ListFp360OrganizationsResponse,
  ListFp360ProductsResponse,
  RecordFp360PaymentBody,
  RecordFp360PaymentParams,
  RecordFp360PaymentResponse,
} from "@workspace/api-zod";
import {
  db,
  fpActivity,
  fpCrmContacts,
  fpCrmOpportunities,
  fpCrmOpportunityOrderLinks,
  fpInvoiceLines,
  fpInvoices,
  fpLogisticsEvents,
  fpLogisticsIncidents,
  fpLogisticsShipmentLines,
  fpLogisticsShipments,
  fpOrderLines,
  fpOrders,
  fpOrganizations,
  fpPayments,
  fpProducts,
  fpProjectBillings,
} from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { toFp360OrganizationDto } from "../lib/fp360-organization-profile";
import { requireAuth, requireSimulationWriteAccess, type AuthContext } from "../middlewares/auth";

const router: IRouter = Router();
const organizationObjectStorage = new ObjectStorageService();
router.use(requireAuth);
router.use(requireSimulationWriteAccess);
const DEMO_TENANT_ID = "red-fp360-demo";
const SIMULATED_DATE = "2027-09-15";
function isNetworkSupervisor(actor: AuthContext) {
  return actor.role === "administrator" || (actor.role === "teacher" && actor.organizationId === null);
}
function operationFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function addSimulatedDays(dateValue: string, days: number) {
  const date = new Date(`${dateValue}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const seedOrganizations = [
  {
    id: "org-atlantico",
    tenantId: DEMO_TENANT_ID,
    name: "Atlántico Distribuciones",
    center: "IES Manuel Martín González",
    island: "Tenerife",
    role: "both",
  },
  {
    id: "org-norte",
    tenantId: DEMO_TENANT_ID,
    name: "Norte Oficina",
    center: "IES La Orotava",
    island: "Tenerife",
    role: "buyer",
  },
  {
    id: "org-alisio",
    tenantId: DEMO_TENANT_ID,
    name: "Alisios Digital",
    center: "IES Politécnico Las Palmas",
    island: "Gran Canaria",
    role: "buyer",
  },
  {
    id: "org-palma",
    tenantId: DEMO_TENANT_ID,
    name: "La Palma Suministros",
    center: "IES Virgen de las Nieves",
    island: "La Palma",
    role: "both",
  },
] as const;

const seedProducts = [
  {
    id: "product-portatil",
    tenantId: DEMO_TENANT_ID,
    sku: "TEC-001",
    name: "Portátil profesional",
    category: "Tecnología",
    unitPriceCents: 68900,
    igicBasisPoints: 700,
    stock: 38,
    reserved: 2,
  },
  {
    id: "product-tableta",
    tenantId: DEMO_TENANT_ID,
    sku: "TEC-002",
    name: "Tableta gráfica",
    category: "Tecnología",
    unitPriceCents: 24900,
    igicBasisPoints: 700,
    stock: 22,
    reserved: 0,
  },
  {
    id: "product-papel",
    tenantId: DEMO_TENANT_ID,
    sku: "OFI-010",
    name: "Papel reciclado A4 · caja",
    category: "Material de oficina",
    unitPriceCents: 5800,
    igicBasisPoints: 700,
    stock: 64,
    reserved: 6,
  },
  {
    id: "product-mesa",
    tenantId: DEMO_TENANT_ID,
    sku: "MOB-004",
    name: "Mesa de trabajo modular",
    category: "Mobiliario",
    unitPriceCents: 42500,
    igicBasisPoints: 700,
    stock: 14,
    reserved: 0,
  },
] as const;

function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

async function ensureDemoData(tenantId: string): Promise<void> {
  if (tenantId !== DEMO_TENANT_ID) return;
  await db.insert(fpOrganizations).values([...seedOrganizations]).onConflictDoNothing();
  await db.insert(fpProducts).values([...seedProducts]).onConflictDoNothing();
  await db
    .insert(fpOrders)
    .values([
      {
        id: "order-demo-partial",
        tenantId: DEMO_TENANT_ID,
        reference: "PV-SIM-0001",
        buyerOrganizationId: "org-norte",
        status: "partial",
        totalCents: 275600,
        simulatedDate: SIMULATED_DATE,
      },
      {
        id: "order-demo-confirmed",
        tenantId: DEMO_TENANT_ID,
        reference: "PV-SIM-0002",
        buyerOrganizationId: "org-alisio",
        status: "confirmed",
        totalCents: 34800,
        simulatedDate: SIMULATED_DATE,
      },
    ])
    .onConflictDoNothing();
  await db
    .insert(fpOrderLines)
    .values([
      {
        id: "order-line-demo-partial",
        orderId: "order-demo-partial",
        productId: "product-portatil",
        productName: "Portátil profesional",
        quantity: 4,
        shippedQuantity: 2,
        invoicedQuantity: 2,
        unitPriceCents: 68900,
        igicBasisPoints: 700,
      },
      {
        id: "order-line-demo-confirmed",
        orderId: "order-demo-confirmed",
        productId: "product-papel",
        productName: "Papel reciclado A4 · caja",
        quantity: 6,
        shippedQuantity: 0,
        invoicedQuantity: 0,
        unitPriceCents: 5800,
        igicBasisPoints: 700,
      },
    ])
    .onConflictDoNothing();
  await db
    .insert(fpInvoices)
    .values({
      id: "invoice-demo-1",
      tenantId: DEMO_TENANT_ID,
      reference: "FP360-SIM-2027-0001",
      orderId: "order-demo-partial",
      buyerName: "Norte Oficina",
      baseCents: 137800,
      igicCents: 9646,
      totalCents: 147446,
      simulatedDate: SIMULATED_DATE,
    })
    .onConflictDoNothing();
  await db
    .insert(fpInvoiceLines)
    .values({
      id: "invoice-line-demo-1",
      invoiceId: "invoice-demo-1",
      productName: "Portátil profesional",
      quantity: 2,
      unitPriceCents: 68900,
      baseCents: 137800,
      igicBasisPoints: 700,
      igicCents: 9646,
      totalCents: 147446,
    })
    .onConflictDoNothing();
  await db
    .insert(fpPayments)
    .values({
      id: "payment-demo-1",
      invoiceId: "invoice-demo-1",
      amountCents: 75000,
      simulatedDate: SIMULATED_DATE,
    })
    .onConflictDoNothing();
  await db
    .insert(fpActivity)
    .values([
      {
        id: "activity-demo-1",
        tenantId: DEMO_TENANT_ID,
        action: "Entrega parcial",
        description: "Se han entregado 2 de 4 portátiles a Norte Oficina.",
        reference: "PV-SIM-0001",
        simulatedDate: SIMULATED_DATE,
      },
      {
        id: "activity-demo-2",
        tenantId: DEMO_TENANT_ID,
        action: "Cobro simulado",
        description: "Abono parcial registrado en Banco FP360.",
        reference: "FP360-SIM-2027-0001",
        simulatedDate: SIMULATED_DATE,
      },
      {
        id: "activity-demo-3",
        tenantId: DEMO_TENANT_ID,
        action: "Pedido confirmado",
        description: "Se han reservado 6 cajas de papel para Alisios Digital.",
        reference: "PV-SIM-0002",
        simulatedDate: SIMULATED_DATE,
      },
    ])
    .onConflictDoNothing();
}

function timestamp(value: Date): string {
  return value.toISOString();
}

async function loadOrder(id: string, actor: AuthContext) {
  const tenantId = actor.tenantId;
  const [order] = await db
    .select()
    .from(fpOrders)
    .where(and(eq(fpOrders.id, id), eq(fpOrders.tenantId, tenantId)))
    .limit(1);
  if (!order) return null;
  const [buyer] = await db
    .select()
    .from(fpOrganizations)
    .where(
      and(
        eq(fpOrganizations.id, order.buyerOrganizationId),
        eq(fpOrganizations.tenantId, tenantId),
      ),
    )
    .limit(1);
  const orderLines = await db
    .select()
    .from(fpOrderLines)
    .where(eq(fpOrderLines.orderId, id));
  const [crmLink] = await db.select({
    opportunityId: fpCrmOpportunityOrderLinks.opportunityId,
    opportunityTitle: fpCrmOpportunities.title,
    organizationId: fpCrmOpportunities.organizationId,
    contactId: fpCrmOpportunityOrderLinks.contactId,
    contactName: fpCrmContacts.fullName,
  }).from(fpCrmOpportunityOrderLinks).innerJoin(fpCrmOpportunities, and(
    eq(fpCrmOpportunities.id, fpCrmOpportunityOrderLinks.opportunityId),
    eq(fpCrmOpportunities.tenantId, fpCrmOpportunityOrderLinks.tenantId),
  )).leftJoin(fpCrmContacts, and(
    eq(fpCrmContacts.id, fpCrmOpportunityOrderLinks.contactId),
    eq(fpCrmContacts.tenantId, fpCrmOpportunityOrderLinks.tenantId),
  )).where(and(
    eq(fpCrmOpportunityOrderLinks.orderId, id),
    eq(fpCrmOpportunityOrderLinks.tenantId, tenantId),
  )).limit(1);
  const products = orderLines.length
    ? await db.select({
      id: fpProducts.id,
      supplierOrganizationId: fpProducts.supplierOrganizationId,
    }).from(fpProducts).where(and(
      eq(fpProducts.tenantId, tenantId),
      inArray(fpProducts.id, orderLines.map((line) => line.productId)),
    ))
    : [];
  const supplierByProductId = new Map(products.map((product) => [product.id, product.supplierOrganizationId]));
  const networkSupervisor = isNetworkSupervisor(actor);
  const buyerAccess = actor.organizationId === order.buyerOrganizationId;
  const canSeeCrm = !crmLink || networkSupervisor || actor.organizationId === crmLink.organizationId;
  const visibleLines = networkSupervisor || buyerAccess
    ? orderLines
    : actor.organizationId
      ? orderLines.filter((line) => {
        const supplierOrganizationId = supplierByProductId.get(line.productId);
        return supplierOrganizationId === null || supplierOrganizationId === actor.organizationId;
      })
      : [];
  if (!networkSupervisor && !buyerAccess && !visibleLines.length) return null;
  return {
    id: order.id,
    reference: order.reference,
    buyerOrganizationId: order.buyerOrganizationId,
    buyerName: buyer?.name ?? "Entidad de la red",
    crmOpportunityId: canSeeCrm ? crmLink?.opportunityId ?? null : null,
    crmOpportunityTitle: canSeeCrm ? crmLink?.opportunityTitle ?? null : null,
    crmContactId: canSeeCrm ? crmLink?.contactId ?? null : null,
    crmContactName: canSeeCrm ? crmLink?.contactName ?? null : null,
    status: order.status,
    lines: visibleLines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      shippedQuantity: line.shippedQuantity,
      receivedQuantity: line.receivedQuantity,
      invoicedQuantity: line.invoicedQuantity,
      unitPriceCents: line.unitPriceCents,
      unitCostCents: networkSupervisor || (!!actor.organizationId && supplierByProductId.get(line.productId) === actor.organizationId)
        ? line.unitCostCents
        : null,
      itemType: line.itemType,
      tracksInventory: line.tracksInventory,
    })),
    totalCents: networkSupervisor || buyerAccess
      ? order.totalCents
      : visibleLines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0),
    simulatedDate: order.simulatedDate,
    createdAt: timestamp(order.createdAt),
  };
}

async function loadInvoice(id: string, tenantId: string, actor: AuthContext) {
  const [invoice] = await db
    .select()
    .from(fpInvoices)
    .where(and(eq(fpInvoices.id, id), eq(fpInvoices.tenantId, tenantId)))
    .limit(1);
  if (!invoice) return null;
  const [crmLink] = await db.select({
    opportunityId: fpCrmOpportunityOrderLinks.opportunityId,
    opportunityTitle: fpCrmOpportunities.title,
    organizationId: fpCrmOpportunities.organizationId,
    contactId: fpCrmOpportunityOrderLinks.contactId,
    contactName: fpCrmContacts.fullName,
  }).from(fpCrmOpportunityOrderLinks).innerJoin(fpCrmOpportunities, and(
    eq(fpCrmOpportunities.id, fpCrmOpportunityOrderLinks.opportunityId),
    eq(fpCrmOpportunities.tenantId, fpCrmOpportunityOrderLinks.tenantId),
  )).leftJoin(fpCrmContacts, and(
    eq(fpCrmContacts.id, fpCrmOpportunityOrderLinks.contactId),
    eq(fpCrmContacts.tenantId, fpCrmOpportunityOrderLinks.tenantId),
  )).where(and(
    eq(fpCrmOpportunityOrderLinks.orderId, invoice.orderId),
    eq(fpCrmOpportunityOrderLinks.tenantId, tenantId),
  )).limit(1);
  const lines = await db
    .select()
    .from(fpInvoiceLines)
    .where(eq(fpInvoiceLines.invoiceId, id));
  const payments = await db
    .select()
    .from(fpPayments)
    .where(eq(fpPayments.invoiceId, id))
    .orderBy(fpPayments.createdAt);
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const balanceCents = Math.max(0, invoice.totalCents - paidCents);
  const canSeeCrm = !crmLink || isNetworkSupervisor(actor) || actor.organizationId === crmLink.organizationId;
  return {
    id: invoice.id,
    reference: invoice.reference,
    orderId: invoice.orderId,
    issuerOrganizationId: invoice.issuerOrganizationId,
    buyerName: invoice.buyerName,
    crmOpportunityId: canSeeCrm ? crmLink?.opportunityId ?? null : null,
    crmOpportunityTitle: canSeeCrm ? crmLink?.opportunityTitle ?? null : null,
    crmContactId: canSeeCrm ? crmLink?.contactId ?? null : null,
    crmContactName: canSeeCrm ? crmLink?.contactName ?? null : null,
    status: balanceCents === 0 ? "paid" : paidCents > 0 ? "partial" : "outstanding",
    lines: lines.map((line) => ({
      productName: line.productName,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      baseCents: line.baseCents,
      igicBasisPoints: line.igicBasisPoints,
      igicCents: line.igicCents,
      totalCents: line.totalCents,
    })),
    baseCents: invoice.baseCents,
    igicCents: invoice.igicCents,
    totalCents: invoice.totalCents,
    paidCents,
    balanceCents,
    simulatedDate: invoice.simulatedDate,
    dueDate: invoice.dueDate,
    createdAt: timestamp(invoice.createdAt),
    payments: payments.map((payment) => ({
      id: payment.id,
      amountCents: payment.amountCents,
      simulatedDate: payment.simulatedDate,
      createdAt: timestamp(payment.createdAt),
    })),
  };
}

async function addActivity(
  tenantId: string,
  action: string,
  description: string,
  reference: string,
): Promise<void> {
  await db.insert(fpActivity).values({
    id: newId("activity"),
    tenantId,
    action,
    description,
    reference,
    simulatedDate: SIMULATED_DATE,
  });
}

async function listOrders(actor: AuthContext) {
  const rows = await db
    .select({ id: fpOrders.id })
    .from(fpOrders)
    .where(eq(fpOrders.tenantId, actor.tenantId))
    .orderBy(desc(fpOrders.createdAt));
  const mapped = await Promise.all(rows.map((row) => loadOrder(row.id, actor)));
  return mapped.filter((order): order is NonNullable<typeof order> => Boolean(order));
}

async function listInvoices(tenantId: string, actor: AuthContext) {
  if (!actor.organizationId && !["teacher", "administrator"].includes(actor.role)) return [];
  const conditions = [eq(fpInvoices.tenantId, tenantId)];
  if (actor.organizationId) conditions.push(eq(fpInvoices.issuerOrganizationId, actor.organizationId));
  const rows = await db
    .select({ id: fpInvoices.id })
    .from(fpInvoices)
    .where(and(...conditions))
    .orderBy(desc(fpInvoices.createdAt));
  const mapped = await Promise.all(rows.map((row) => loadInvoice(row.id, tenantId, actor)));
  return mapped.filter((invoice): invoice is NonNullable<typeof invoice> =>
    Boolean(invoice),
  );
}

router.get("/redfp360/dashboard", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const tenantId = actor.tenantId;
  await ensureDemoData(tenantId);
  const orders = await listOrders(actor);
  const invoices = await listInvoices(tenantId, actor);
  const products = await db
    .select()
    .from(fpProducts)
    .where(and(eq(fpProducts.tenantId, tenantId), eq(fpProducts.isActive, true)));
  const activityRows = await db
    .select()
    .from(fpActivity)
    .where(eq(fpActivity.tenantId, tenantId))
    .orderBy(desc(fpActivity.createdAt))
    .limit(5);
  const activity = activityRows.map((item) => ({
    id: item.id,
    action: item.action,
    description: item.description,
    reference: item.reference,
    simulatedDate: item.simulatedDate,
    createdAt: timestamp(item.createdAt),
  }));
  res.json(
    GetFp360DashboardResponse.parse({
      salesCents: invoices.reduce((total, item) => total + item.totalCents, 0),
      outstandingCents: invoices.reduce(
        (total, item) => total + item.balanceCents,
        0,
      ),
      orderCount: orders.length,
      productCount: products.length,
      openOrders: orders.filter((item) =>
        ["draft", "confirmed", "partial", "delivered"].includes(item.status),
      ).length,
      invoicesDue: invoices.filter((item) => item.balanceCents > 0).length,
      recentActivity: activity,
      simulationOnly: true,
    }),
  );
});

router.get("/redfp360/organizations", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
  await ensureDemoData(tenantId);
  const organizations = await db
    .select()
    .from(fpOrganizations)
    .where(eq(fpOrganizations.tenantId, tenantId))
    .orderBy(fpOrganizations.name);
  res.json(
    ListFp360OrganizationsResponse.parse(
      organizations.map(toFp360OrganizationDto),
    ),
  );
});

router.get("/redfp360/organizations/:id/logo", async (req, res): Promise<void> => {
  const [organization] = await db
    .select()
    .from(fpOrganizations)
    .where(and(
      eq(fpOrganizations.id, req.params.id),
      eq(fpOrganizations.tenantId, req.auth!.tenantId),
    ))
    .limit(1);
  if (!organization?.logoObjectPath || !organization.logoContentType) {
    res.status(404).json({ error: "Logo no encontrado." });
    return;
  }
  try {
    const file = await organizationObjectStorage.getObjectEntityFile(organization.logoObjectPath);
    const [contents] = await file.download();
    res.set({
      "Content-Type": organization.logoContentType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    }).status(200).send(contents);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Logo no encontrado." });
      return;
    }
    throw error;
  }
});

router.get("/redfp360/products", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const tenantId = actor.tenantId;
  const networkSupervisor = isNetworkSupervisor(actor);
  await ensureDemoData(tenantId);
  const products = await db
    .select()
    .from(fpProducts)
    .where(eq(fpProducts.tenantId, tenantId))
    .orderBy(fpProducts.category, fpProducts.name);
  const visibleProducts = products.filter((product) =>
    networkSupervisor ||
    product.supplierOrganizationId === actor.organizationId ||
    (product.isActive && product.isPublished),
  );
  res.json(
    ListFp360ProductsResponse.parse(
      visibleProducts.map((product) => {
        const canSeeInternalFields = networkSupervisor ||
          (!!actor.organizationId && product.supplierOrganizationId === actor.organizationId);
        return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        category: product.category,
        itemType: product.itemType,
        unit: product.unit,
        tracksInventory: product.tracksInventory,
        unitPriceCents: product.unitPriceCents,
        igicBasisPoints: product.igicBasisPoints,
        stock: canSeeInternalFields ? product.stock : Math.max(0, product.stock - product.reserved),
        reserved: canSeeInternalFields ? product.reserved : 0,
        costCents: canSeeInternalFields ? product.costCents : null,
        minimumStock: canSeeInternalFields ? product.minimumStock : null,
        maxDiscountBasisPoints: canSeeInternalFields ? product.maxDiscountBasisPoints : null,
        leadTimeDays: product.leadTimeDays,
        supplierOrganizationId: product.supplierOrganizationId,
        isActive: product.isActive,
        isPublished: product.isPublished,
        };
      }),
    ),
  );
});

router.get("/redfp360/orders", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const tenantId = actor.tenantId;
  await ensureDemoData(tenantId);
  res.json(ListFp360OrdersResponse.parse(await listOrders(actor)));
});

router.post("/redfp360/orders", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const tenantId = actor.tenantId;
  await ensureDemoData(tenantId);
  const parsed = CreateFp360OrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.crmOpportunityId && !parsed.data.operationId) {
    res.status(400).json({ error: "La vinculación CRM requiere un identificador de operación para reintentar de forma segura." });
    return;
  }
  if (!isNetworkSupervisor(actor) && actor.organizationId !== parsed.data.buyerOrganizationId) {
    res.status(403).json({ error: "Solo puedes crear pedidos para tu propia empresa." });
    return;
  }
  const productQuantities = new Map<string, number>();
  for (const line of parsed.data.lines) {
    productQuantities.set(
      line.productId,
      (productQuantities.get(line.productId) ?? 0) + line.quantity,
    );
  }
  if (productQuantities.size !== parsed.data.lines.length) {
    res.status(400).json({ error: "No repitas productos en el mismo pedido." });
    return;
  }
  const created = await db.transaction(async (tx) => {
    const requestFingerprint = operationFingerprint(parsed.data);
    if (parsed.data.crmOpportunityId && parsed.data.operationId) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fp360-order-op:${tenantId}:${parsed.data.operationId}`}))`);
      const [previousLink] = await tx.select().from(fpCrmOpportunityOrderLinks).where(and(
        eq(fpCrmOpportunityOrderLinks.tenantId, tenantId),
        eq(fpCrmOpportunityOrderLinks.operationId, parsed.data.operationId),
      )).for("update");
      if (previousLink) {
        const [previousOrder] = await tx.select().from(fpOrders).where(and(
          eq(fpOrders.id, previousLink.orderId), eq(fpOrders.tenantId, tenantId),
        ));
        const [previousOpportunity] = await tx.select().from(fpCrmOpportunities).where(and(
          eq(fpCrmOpportunities.id, previousLink.opportunityId),
          eq(fpCrmOpportunities.tenantId, tenantId),
        ));
        const [currentBuyer] = previousOrder ? await tx.select({
          id: fpOrganizations.id, role: fpOrganizations.role,
        }).from(fpOrganizations).where(and(
          eq(fpOrganizations.id, previousOrder.buyerOrganizationId),
          eq(fpOrganizations.tenantId, tenantId),
          eq(fpOrganizations.isActive, true),
        )) : [];
        if (!previousOrder || !previousOpportunity || !currentBuyer || !["buyer", "both"].includes(currentBuyer.role)) {
          return { ok: false as const, status: 404 as const, error: "El pedido o la oportunidad vinculados ya no están disponibles." };
        }
        if (previousLink.actorUserId !== actor.userId || previousLink.requestFingerprint !== requestFingerprint) {
          return { ok: false as const, status: 409 as const, error: "El identificador de operación ya se utilizó con otra solicitud." };
        }
        if (
          previousOrder.buyerOrganizationId !== parsed.data.buyerOrganizationId ||
          previousOpportunity.organizationId !== previousOrder.buyerOrganizationId ||
          previousOpportunity.id !== parsed.data.crmOpportunityId ||
          (!isNetworkSupervisor(actor) && actor.organizationId !== previousOrder.buyerOrganizationId)
        ) {
          return { ok: false as const, status: 404 as const, error: "El pedido no existe en tu empresa." };
        }
        return { ok: true as const, orderId: previousOrder.id, replay: true };
      }
    }
    const [buyer] = await tx
      .select()
      .from(fpOrganizations)
      .where(
        and(
          eq(fpOrganizations.id, parsed.data.buyerOrganizationId),
          eq(fpOrganizations.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!buyer || !buyer.isActive || !["buyer", "both"].includes(buyer.role)) {
      return {
        ok: false as const, status: 400 as const,
        error: "Selecciona una empresa compradora activa de tu red.",
      };
    }
    let opportunity: typeof fpCrmOpportunities.$inferSelect | undefined;
    if (parsed.data.crmOpportunityId) {
      [opportunity] = await tx.select().from(fpCrmOpportunities).where(and(
        eq(fpCrmOpportunities.id, parsed.data.crmOpportunityId),
        eq(fpCrmOpportunities.tenantId, tenantId),
      )).for("update");
      if (!opportunity || opportunity.organizationId !== buyer.id) {
        return { ok: false as const, status: 404 as const, error: "La oportunidad no existe en la empresa compradora seleccionada." };
      }
      if (opportunity.stage !== "won") {
        return { ok: false as const, status: 409 as const, error: "Solo se pueden vincular pedidos a una oportunidad ganada." };
      }
      if (opportunity.contactId) {
        const [contact] = await tx.select({ id: fpCrmContacts.id }).from(fpCrmContacts).where(and(
          eq(fpCrmContacts.id, opportunity.contactId),
          eq(fpCrmContacts.tenantId, tenantId),
          eq(fpCrmContacts.organizationId, opportunity.organizationId),
        ));
        if (!contact) {
          return { ok: false as const, status: 409 as const, error: "El contacto asociado ya no pertenece a la empresa de la oportunidad." };
        }
      }
    }
    const productIds = [...productQuantities.keys()];
    const products = await tx
      .select()
      .from(fpProducts)
      .where(
        and(
          eq(fpProducts.tenantId, tenantId),
          inArray(fpProducts.id, productIds),
        ),
      )
      .for("update");
    if (products.length !== productIds.length) {
      return { ok: false as const, status: 400 as const, error: "Uno de los productos ya no está disponible." };
    }
    for (const product of products) {
      if (!product.isActive || !product.isPublished) {
        return { ok: false as const, status: 400 as const, error: "Uno de los productos no está activo y aprobado para el mercado." };
      }
      const requested = productQuantities.get(product.id) ?? 0;
      if (product.tracksInventory && product.stock - product.reserved < requested) {
        return { ok: false as const, status: 400 as const, error: `Stock insuficiente para ${product.name}.` };
      }
    }
    const totalCents = products.reduce(
      (sum, product) =>
        sum + product.unitPriceCents * (productQuantities.get(product.id) ?? 0),
      0,
    );
    if (!Number.isSafeInteger(totalCents)) {
      return {
        ok: false as const, status: 400 as const,
        error: "El importe supera el límite permitido para esta simulación.",
      };
    }
    const id = newId("order");
    const reference = `PV-SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.insert(fpOrders).values({
      id,
      tenantId,
      reference,
      buyerOrganizationId: buyer.id,
      status: "draft",
      totalCents,
      simulatedDate: SIMULATED_DATE,
    });
    await tx.insert(fpOrderLines).values(
      products.map((product) => ({
        id: newId("line"),
        orderId: id,
        productId: product.id,
        productName: product.name,
        quantity: productQuantities.get(product.id) ?? 0,
        shippedQuantity: 0,
        invoicedQuantity: 0,
        unitPriceCents: product.unitPriceCents,
        unitCostCents: product.costCents,
        igicBasisPoints: product.igicBasisPoints,
        itemType: product.itemType,
        tracksInventory: product.tracksInventory,
      })),
    );
    if (opportunity && parsed.data.operationId) {
      await tx.insert(fpCrmOpportunityOrderLinks).values({
        id: newId("crm-order-link"),
        tenantId,
        opportunityId: opportunity.id,
        orderId: id,
        contactId: opportunity.contactId,
        operationId: parsed.data.operationId,
        requestFingerprint,
        actorUserId: actor.userId,
        actorRole: actor.role,
      });
      await tx.insert(fpActivity).values({
        id: newId("activity"),
        tenantId,
        action: "Oportunidad vinculada con pedido",
        description: `${opportunity.title} vinculada explícitamente con ${reference}.`,
        reference,
        simulatedDate: SIMULATED_DATE,
      });
    }
    return { ok: true as const, orderId: id, reference, replay: false };
  });
  if (!created.ok) {
    res.status(created.status).json({ error: created.error });
    return;
  }
  if (!created.replay && "reference" in created && created.reference) {
    await addActivity(tenantId, "Presupuesto creado", "Nuevo pedido en borrador.", created.reference);
  }
  const order = await loadOrder(created.orderId, actor);
  if (!order) {
    res.status(500).json({ error: "No se pudo recuperar el pedido creado." });
    return;
  }
  res.status(201).json(CreateFp360OrderResponse.parse(order));
});

router.post("/redfp360/orders/:id/confirm", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const tenantId = actor.tenantId;
  await ensureDemoData(tenantId);
  const params = ConfirmFp360OrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(fpOrders)
      .where(
        and(
          eq(fpOrders.id, params.data.id),
          eq(fpOrders.tenantId, tenantId),
        ),
      )
      .for("update")
      .limit(1);
    if (!order) {
      return {
        ok: false as const,
        status: 404 as const,
        error: "Pedido no encontrado.",
      };
    }
    if (!isNetworkSupervisor(actor) && actor.organizationId !== order.buyerOrganizationId) {
      return { ok: false as const, status: 404 as const, error: "Pedido no encontrado." };
    }
    if (order.status !== "draft") {
      return {
        ok: false as const,
        status: 400 as const,
        error: "Solo se pueden confirmar pedidos en borrador.",
      };
    }
    const lines = await tx
      .select()
      .from(fpOrderLines)
      .where(eq(fpOrderLines.orderId, order.id));
    const productIds = lines.map((line) => line.productId);
    const products = await tx
      .select()
      .from(fpProducts)
      .where(
        and(
          eq(fpProducts.tenantId, tenantId),
          inArray(fpProducts.id, productIds),
        ),
      )
      .for("update");
    const productById = new Map(products.map((product) => [product.id, product]));
    for (const line of lines) {
      const product = productById.get(line.productId);
      if (
        !product ||
        !product.isActive ||
        !product.isPublished ||
        (line.tracksInventory && product.stock - product.reserved < line.quantity)
      ) {
        return {
          ok: false as const,
          status: 400 as const,
          error: `La referencia ${line.productName} ya no está disponible en las condiciones del pedido.`,
        };
      }
    }
    for (const line of lines) {
      const product = productById.get(line.productId);
      if (!product || !line.tracksInventory) continue;
      await tx
        .update(fpProducts)
        .set({ reserved: product.reserved + line.quantity })
        .where(eq(fpProducts.id, product.id));
    }
    await tx
      .update(fpOrders)
      .set({ status: "confirmed" })
      .where(eq(fpOrders.id, order.id));
    return { ok: true as const, reference: order.reference };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  await addActivity(
    tenantId,
    "Pedido confirmado",
    "El pedido y las unidades disponibles han quedado reservados.",
    result.reference,
  );
  const order = await loadOrder(params.data.id, actor);
  res.json(ConfirmFp360OrderResponse.parse(order));
});

router.post("/redfp360/orders/:id/dispatch", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const tenantId = actor.tenantId;
  await ensureDemoData(tenantId);
  const params = DispatchFp360OrderParams.safeParse(req.params);
  const body = DispatchFp360OrderBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const quantities = new Map<string, number>();
  for (const line of body.data.lines) {
    quantities.set(
      line.productId,
      (quantities.get(line.productId) ?? 0) + line.quantity,
    );
  }
  if (quantities.size !== body.data.lines.length) {
    res.status(400).json({ error: "No repitas productos en una entrega." });
    return;
  }
  const requestFingerprint = operationFingerprint({
    orderId: params.data.id,
    userId: actor.userId,
    organizationId: actor.organizationId,
    lines: [...body.data.lines].sort((a, b) => a.productId.localeCompare(b.productId)),
  });
  const result = await db.transaction(async (tx) => {
    const [previousShipment] = await tx
      .select()
      .from(fpLogisticsShipments)
      .where(and(
        eq(fpLogisticsShipments.tenantId, tenantId),
        eq(fpLogisticsShipments.operationId, body.data.operationId),
      ))
      .for("update")
      .limit(1);
    if (previousShipment) {
      if (previousShipment.requestFingerprint !== requestFingerprint) {
        return { ok: false as const, status: 409 as const, error: "La clave de operación ya se usó con otros datos." };
      }
      if (previousShipment.orderId !== params.data.id ||
        (!isNetworkSupervisor(actor) &&
          (!actor.organizationId || previousShipment.originOrganizationId !== actor.organizationId))) {
        return { ok: false as const, status: 404 as const, error: "Expedición no encontrada." };
      }
      return { ok: true as const, reference: previousShipment.reference, replay: true as const };
    }
    const [order] = await tx
      .select()
      .from(fpOrders)
      .where(
        and(
          eq(fpOrders.id, params.data.id),
          eq(fpOrders.tenantId, tenantId),
        ),
      )
      .for("update")
      .limit(1);
    if (!order) {
      return {
        ok: false as const,
        status: 404 as const,
        error: "Pedido no encontrado.",
      };
    }
    if (!["confirmed", "partial", "delivered"].includes(order.status)) {
      return {
        ok: false as const,
        status: 400 as const,
        error: "Confirma el pedido antes de preparar una entrega.",
      };
    }
    const lines = await tx
      .select()
      .from(fpOrderLines)
      .where(eq(fpOrderLines.orderId, order.id));
    for (const [productId, quantity] of quantities) {
      const line = lines.find((item) => item.productId === productId);
      if (!line || line.shippedQuantity + quantity > line.quantity) {
        return {
          ok: false as const,
          status: 400 as const,
          error: "La cantidad entregada supera las unidades pendientes del pedido.",
        };
      }
    }
    const productIds = [...quantities.keys()];
    const products = await tx
      .select()
      .from(fpProducts)
      .where(
        and(
          eq(fpProducts.tenantId, tenantId),
          inArray(fpProducts.id, productIds),
        ),
      )
      .for("update");
    const productById = new Map(products.map((product) => [product.id, product]));
    for (const [productId, quantity] of quantities) {
      const product = productById.get(productId);
      const line = lines.find((item) => item.productId === productId);
      if (!product || !line || (line.tracksInventory && (product.stock < quantity || product.reserved < quantity))) {
        return {
          ok: false as const,
          status: 400 as const,
          error: "El stock reservado ya no está disponible.",
        };
      }
    }
    const supplierIds = [...new Set(products.map((product) => product.supplierOrganizationId).filter((id): id is string => Boolean(id)))];
    if (supplierIds.length > 1 && !isNetworkSupervisor(actor)) {
      return { ok: false as const, status: 400 as const, error: "Separa la expedición cuando los productos tengan distintos proveedores." };
    }
    let originOrganizationId = supplierIds.length === 1 ? supplierIds[0] : null;
    if (!isNetworkSupervisor(actor)) {
      if (!actor.organizationId) {
        return { ok: false as const, status: 403 as const, error: "Tu perfil no puede registrar expediciones para esta organización." };
      }
      const [actorOrganization] = await tx
        .select()
        .from(fpOrganizations)
        .where(and(eq(fpOrganizations.id, actor.organizationId), eq(fpOrganizations.tenantId, tenantId)))
        .limit(1);
      if (!actorOrganization || !actorOrganization.isActive || !["seller", "both"].includes(actorOrganization.role)) {
        return { ok: false as const, status: 403 as const, error: "La organización debe tener perfil vendedor para expedir pedidos." };
      }
      if (supplierIds.length && supplierIds[0] !== actor.organizationId) {
        return { ok: false as const, status: 403 as const, error: "Solo la organización proveedora puede expedir estos productos." };
      }
      originOrganizationId = actor.organizationId;
    }
    for (const [productId, quantity] of quantities) {
      const product = productById.get(productId);
      const line = lines.find((item) => item.productId === productId);
      if (!product || !line) continue;
      if (line.tracksInventory) {
        await tx
          .update(fpProducts)
          .set({
            stock: product.stock - quantity,
            reserved: product.reserved - quantity,
          })
          .where(eq(fpProducts.id, productId));
      }
      await tx
        .update(fpOrderLines)
        .set({
          shippedQuantity: line.shippedQuantity + quantity,
          receivedQuantity: line.receivedQuantity + (line.itemType === "service" ? quantity : 0),
        })
        .where(eq(fpOrderLines.id, line.id));
    }
    const updated = lines.map((line) => ({
      ...line,
      shippedQuantity:
        line.shippedQuantity + (quantities.get(line.productId) ?? 0),
    }));
    const allLinesComplete = updated.every((line) => line.shippedQuantity === line.quantity);
    const hasPhysicalGoods = lines.some((line) => line.itemType === "product");
    const status = allLinesComplete && !hasPhysicalGoods ? "delivered" : "partial";
    await tx
      .update(fpOrders)
      .set({ status })
      .where(eq(fpOrders.id, order.id));
    const shipmentLines = [...quantities.entries()]
      .map(([productId, quantity]) => ({
        product: productById.get(productId),
        orderLine: lines.find((line) => line.productId === productId),
        quantity,
      }))
      .filter((entry) => entry.product && entry.orderLine?.itemType === "product");
    if (shipmentLines.length) {
      const shipmentId = randomUUID();
      const shipmentReference = `EXP-${randomUUID().slice(0, 8).toUpperCase()}`;
      await tx.insert(fpLogisticsShipments).values({
        id: shipmentId,
        tenantId,
        operationId: body.data.operationId,
        requestFingerprint,
        orderId: order.id,
        reference: shipmentReference,
        originOrganizationId,
        destinationOrganizationId: order.buyerOrganizationId,
        status: "in_transit",
        simulatedDate: SIMULATED_DATE,
        createdByUserId: actor.userId,
        createdByName: actor.displayName,
      });
      await tx.insert(fpLogisticsShipmentLines).values(shipmentLines.map(({ product, orderLine, quantity }) => ({
        id: randomUUID(),
        tenantId,
        shipmentId,
        orderLineId: orderLine!.id,
        productId: product!.id,
        productName: orderLine!.productName,
        quantity,
      })));
      await tx.insert(fpLogisticsEvents).values({
        id: randomUUID(),
        tenantId,
        shipmentId,
        operationId: body.data.operationId,
        requestFingerprint,
        eventType: "shipment_created",
        status: "in_transit",
        description: `Salida simulada registrada para ${order.reference}.`,
        actorUserId: actor.userId,
        actorName: actor.displayName,
      });
    }
    return { ok: true as const, reference: order.reference, replay: false as const };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  if (!result.replay) {
    await addActivity(
      tenantId,
      "Albarán simulado",
      "Se ha registrado una expedición simulada.",
      result.reference,
    );
  }
  const order = await loadOrder(params.data.id, actor);
  res.json(DispatchFp360OrderResponse.parse(order));
});

router.get("/redfp360/invoices", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const tenantId = actor.tenantId;
  await ensureDemoData(tenantId);
  res.json(ListFp360InvoicesResponse.parse(await listInvoices(tenantId, actor)));
});

router.post("/redfp360/invoices", async (req, res): Promise<void> => {
  const actor = req.auth!;
  const tenantId = actor.tenantId;
  await ensureDemoData(tenantId);
  const body = IssueFp360InvoiceBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(fpOrders)
      .where(
        and(
          eq(fpOrders.id, body.data.orderId),
          eq(fpOrders.tenantId, tenantId),
        ),
      )
      .for("update")
      .limit(1);
    if (!order) {
      return {
        ok: false as const,
        status: 404 as const,
        error: "Pedido no encontrado.",
      };
    }
    const [projectBilling] = await tx.select({ organizationId: fpProjectBillings.organizationId }).from(fpProjectBillings).where(and(
      eq(fpProjectBillings.tenantId, tenantId),
      eq(fpProjectBillings.orderId, order.id),
    )).limit(1);
    if (projectBilling && actor.organizationId !== projectBilling.organizationId) {
      return { ok: false as const, status: 403 as const, error: "La factura de este proyecto debe emitirla la empresa responsable." };
    }
    if (!["delivered", "invoiced", "paid"].includes(order.status)) {
      return { ok: false as const, status: 409 as const, error: "Confirma la recepción logística antes de facturar el pedido." };
    }
    const orderShipments = await tx.select({ id: fpLogisticsShipments.id }).from(fpLogisticsShipments).where(and(
      eq(fpLogisticsShipments.orderId, order.id),
      eq(fpLogisticsShipments.tenantId, tenantId),
    ));
    if (orderShipments.length) {
      const openIncidents = await tx.select({ id: fpLogisticsIncidents.id }).from(fpLogisticsIncidents).where(and(
        eq(fpLogisticsIncidents.tenantId, tenantId),
        inArray(fpLogisticsIncidents.shipmentId, orderShipments.map((shipment) => shipment.id)),
        eq(fpLogisticsIncidents.status, "open"),
      ));
      if (openIncidents.length) {
        return { ok: false as const, status: 409 as const, error: "Resuelve las incidencias logísticas antes de emitir la factura." };
      }
    }
    const lines = await tx
      .select()
      .from(fpOrderLines)
      .where(eq(fpOrderLines.orderId, order.id))
      .for("update");
    const unbilled = lines
      .map((line) => ({
        line,
        quantity: (orderShipments.length ? line.receivedQuantity : line.shippedQuantity) - line.invoicedQuantity,
      }))
      .filter((entry) => entry.quantity > 0);
    if (!unbilled.length) {
      return {
        ok: false as const,
        status: 400 as const,
        error: "No hay unidades entregadas pendientes de facturar.",
      };
    }
    const [buyer] = await tx
      .select()
      .from(fpOrganizations)
      .where(and(eq(fpOrganizations.id, order.buyerOrganizationId), eq(fpOrganizations.tenantId, tenantId)))
      .limit(1);
    const invoiceId = newId("invoice");
    const invoiceReference = `FP360-SIM-${new Date().getFullYear()}-${randomUUID()
      .slice(0, 8)
      .toUpperCase()}`;
    const invoiceLines = unbilled.map(({ line, quantity }) => {
      const baseCents = line.unitPriceCents * quantity;
      const igicCents = Math.round(
        (baseCents * line.igicBasisPoints) / 10000,
      );
      return {
        id: newId("invoice-line"),
        invoiceId,
        productName: line.productName,
        quantity,
        unitPriceCents: line.unitPriceCents,
        baseCents,
        igicBasisPoints: line.igicBasisPoints,
        igicCents,
        totalCents: baseCents + igicCents,
      };
    });
    const baseCents = invoiceLines.reduce((sum, line) => sum + line.baseCents, 0);
    const igicCents = invoiceLines.reduce((sum, line) => sum + line.igicCents, 0);
    const totalCents = baseCents + igicCents;
    if (!Number.isSafeInteger(totalCents)) {
      return {
        ok: false as const,
        status: 400 as const,
        error: "El importe supera el límite permitido.",
      };
    }
    await tx.insert(fpInvoices).values({
      id: invoiceId,
      tenantId,
      issuerOrganizationId: actor.organizationId,
      reference: invoiceReference,
      orderId: order.id,
      buyerName: buyer?.name ?? "Entidad de la red",
      dueDate: addSimulatedDays(SIMULATED_DATE, 30),
      baseCents,
      igicCents,
      totalCents,
      simulatedDate: SIMULATED_DATE,
    });
    await tx.insert(fpInvoiceLines).values(invoiceLines);
    for (const { line, quantity } of unbilled) {
      await tx
        .update(fpOrderLines)
        .set({ invoicedQuantity: line.invoicedQuantity + quantity })
        .where(eq(fpOrderLines.id, line.id));
    }
    const fullyDelivered = ["delivered", "invoiced", "paid"].includes(order.status);
    const fullyInvoiced = lines.every(
      (line) =>
        line.invoicedQuantity +
          (unbilled.find((entry) => entry.line.id === line.id)?.quantity ?? 0) ===
        (orderShipments.length ? line.receivedQuantity : line.shippedQuantity),
    );
    const status =
      fullyDelivered && fullyInvoiced
        ? "invoiced"
        : fullyDelivered
          ? "delivered"
          : "partial";
    await tx
      .update(fpOrders)
      .set({ status })
      .where(eq(fpOrders.id, order.id));
    return {
      ok: true as const,
      status: 201 as const,
      invoiceId,
      reference: invoiceReference,
    };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  await addActivity(
    tenantId,
    "Factura simulada",
    "Factura emitida para unidades ya entregadas.",
    result.reference,
  );
  const invoice = await loadInvoice(result.invoiceId, tenantId, actor);
  res.status(201).json(IssueFp360InvoiceResponse.parse(invoice));
});

router.post(
  "/redfp360/invoices/:id/payments",
  async (req, res): Promise<void> => {
    const actor = req.auth!;
    const tenantId = actor.tenantId;
    await ensureDemoData(tenantId);
    const params = RecordFp360PaymentParams.safeParse(req.params);
    const body = RecordFp360PaymentBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const requestFingerprint = operationFingerprint({
      invoiceId: params.data.id,
      amountCents: body.data.amountCents,
      organizationId: actor.organizationId,
    });
    const result = await db.transaction(async (tx) => {
      const [priorOperation] = await tx
        .select()
        .from(fpPayments)
        .where(and(
          eq(fpPayments.tenantId, tenantId),
          eq(fpPayments.operationId, body.data.operationId),
        ))
        .limit(1);
      if (priorOperation) {
        if (priorOperation.createdByUserId !== actor.userId ||
            priorOperation.requestFingerprint !== requestFingerprint) {
          return {
            ok: false as const,
            status: 409 as const,
            error: "El identificador de operación ya se usó con otros datos.",
          };
        }
        const [priorInvoice] = await tx
          .select({ reference: fpInvoices.reference })
          .from(fpInvoices)
          .where(and(
            eq(fpInvoices.id, priorOperation.invoiceId),
            eq(fpInvoices.tenantId, tenantId),
          ))
          .limit(1);
        return {
          ok: true as const,
          status: 200 as const,
          reference: priorInvoice?.reference ?? "Factura",
          replayed: true,
        };
      }
      const [invoice] = await tx
        .select()
        .from(fpInvoices)
        .where(
          and(
            eq(fpInvoices.id, params.data.id),
            eq(fpInvoices.tenantId, tenantId),
          ),
        )
        .for("update")
        .limit(1);
      if (!invoice) {
        return {
          ok: false as const,
          status: 404 as const,
          error: "Factura no encontrada.",
        };
      }
      if (actor.organizationId && invoice.issuerOrganizationId !== actor.organizationId) {
        return {
          ok: false as const,
          status: 403 as const,
          error: "Solo la empresa emisora puede registrar el cobro de esta factura.",
        };
      }
      const existing = await tx
        .select()
        .from(fpPayments)
        .where(eq(fpPayments.invoiceId, invoice.id));
      const paid = existing.reduce((total, payment) => total + payment.amountCents, 0);
      const balance = invoice.totalCents - paid;
      if (body.data.amountCents > balance) {
        return {
          ok: false as const,
          status: 400 as const,
          error: "El importe supera el saldo pendiente de esta factura.",
        };
      }
      await tx.insert(fpPayments).values({
        id: newId("payment"),
        tenantId,
        organizationId: invoice.issuerOrganizationId ?? actor.organizationId,
        invoiceId: invoice.id,
        amountCents: body.data.amountCents,
        simulatedDate: SIMULATED_DATE,
        operationId: body.data.operationId,
        requestFingerprint,
        createdByUserId: actor.userId,
        createdByName: actor.displayName,
      });
      const remainingBalance = balance - body.data.amountCents;
      if (remainingBalance === 0) {
        const orderInvoices = await tx
          .select()
          .from(fpInvoices)
          .where(
            and(
              eq(fpInvoices.orderId, invoice.orderId),
              eq(fpInvoices.tenantId, tenantId),
            ),
          );
        const balances: number[] = [];
        for (const item of orderInvoices) {
          const itemPayments = await tx
            .select()
            .from(fpPayments)
            .where(eq(fpPayments.invoiceId, item.id));
          const amountPaid = itemPayments.reduce(
            (total, payment) => total + payment.amountCents,
            0,
          );
          balances.push(item.totalCents - amountPaid);
        }
        if (balances.every((amount) => amount === 0)) {
          await tx
            .update(fpOrders)
            .set({ status: "paid" })
            .where(eq(fpOrders.id, invoice.orderId));
        }
      }
      return {
        ok: true as const,
        status: 201 as const,
        reference: invoice.reference,
        replayed: false,
      };
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    if (!result.replayed) {
      await addActivity(
        tenantId,
        "Cobro simulado",
        "Cobro simulado registrado; su asiento se prepara en Contabilidad.",
        result.reference,
      );
    }
    const invoice = await loadInvoice(params.data.id, tenantId, actor);
    res.status(result.status).json(RecordFp360PaymentResponse.parse(invoice));
  },
);

router.get("/redfp360/activity", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
  await ensureDemoData(tenantId);
  const activity = await db
    .select()
    .from(fpActivity)
    .where(eq(fpActivity.tenantId, tenantId))
    .orderBy(desc(fpActivity.createdAt))
    .limit(20);
  res.json(
    ListFp360ActivityResponse.parse(
      activity.map((item) => ({
        id: item.id,
        action: item.action,
        description: item.description,
        reference: item.reference,
        simulatedDate: item.simulatedDate,
        createdAt: timestamp(item.createdAt),
      })),
    ),
  );
});

export default router;

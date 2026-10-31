import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
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
  fpInvoiceLines,
  fpInvoices,
  fpOrderLines,
  fpOrders,
  fpOrganizations,
  fpPayments,
  fpProducts,
} from "@workspace/db";
import { requireAuth, requireSimulationWriteAccess } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth);
router.use(requireSimulationWriteAccess);
const DEMO_TENANT_ID = "red-fp360-demo";
const SIMULATED_DATE = "2027-09-15";

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

async function loadOrder(id: string, tenantId: string) {
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
  const lines = await db
    .select()
    .from(fpOrderLines)
    .where(eq(fpOrderLines.orderId, id));
  return {
    id: order.id,
    reference: order.reference,
    buyerOrganizationId: order.buyerOrganizationId,
    buyerName: buyer?.name ?? "Entidad de la red",
    status: order.status,
    lines: lines.map((line) => ({
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      shippedQuantity: line.shippedQuantity,
      invoicedQuantity: line.invoicedQuantity,
      unitPriceCents: line.unitPriceCents,
    })),
    totalCents: order.totalCents,
    simulatedDate: order.simulatedDate,
    createdAt: timestamp(order.createdAt),
  };
}

async function loadInvoice(id: string, tenantId: string) {
  const [invoice] = await db
    .select()
    .from(fpInvoices)
    .where(and(eq(fpInvoices.id, id), eq(fpInvoices.tenantId, tenantId)))
    .limit(1);
  if (!invoice) return null;
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
  return {
    id: invoice.id,
    reference: invoice.reference,
    orderId: invoice.orderId,
    buyerName: invoice.buyerName,
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

async function listOrders(tenantId: string) {
  const rows = await db
    .select({ id: fpOrders.id })
    .from(fpOrders)
    .where(eq(fpOrders.tenantId, tenantId))
    .orderBy(desc(fpOrders.createdAt));
  const mapped = await Promise.all(rows.map((row) => loadOrder(row.id, tenantId)));
  return mapped.filter((order): order is NonNullable<typeof order> => Boolean(order));
}

async function listInvoices(tenantId: string) {
  const rows = await db
    .select({ id: fpInvoices.id })
    .from(fpInvoices)
    .where(eq(fpInvoices.tenantId, tenantId))
    .orderBy(desc(fpInvoices.createdAt));
  const mapped = await Promise.all(rows.map((row) => loadInvoice(row.id, tenantId)));
  return mapped.filter((invoice): invoice is NonNullable<typeof invoice> =>
    Boolean(invoice),
  );
}

router.get("/redfp360/dashboard", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
  await ensureDemoData(tenantId);
  const orders = await listOrders(tenantId);
  const invoices = await listInvoices(tenantId);
  const products = await db
    .select()
    .from(fpProducts)
    .where(eq(fpProducts.tenantId, tenantId));
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
      organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        center: organization.center,
        island: organization.island,
        role: organization.role,
      })),
    ),
  );
});

router.get("/redfp360/products", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
  await ensureDemoData(tenantId);
  const products = await db
    .select()
    .from(fpProducts)
    .where(eq(fpProducts.tenantId, tenantId))
    .orderBy(fpProducts.category, fpProducts.name);
  res.json(
    ListFp360ProductsResponse.parse(
      products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category,
        unitPriceCents: product.unitPriceCents,
        igicBasisPoints: product.igicBasisPoints,
        stock: product.stock,
        reserved: product.reserved,
      })),
    ),
  );
});

router.get("/redfp360/orders", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
  await ensureDemoData(tenantId);
  res.json(ListFp360OrdersResponse.parse(await listOrders(tenantId)));
});

router.post("/redfp360/orders", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
  await ensureDemoData(tenantId);
  const parsed = CreateFp360OrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
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
  const id = newId("order");
  const reference = `PV-SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
  const created = await db.transaction(async (tx) => {
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
    if (!buyer) {
      return {
        ok: false as const,
        error: "La entidad seleccionada no pertenece a tu red.",
      };
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
      return { ok: false as const, error: "Uno de los productos ya no está disponible." };
    }
    for (const product of products) {
      const requested = productQuantities.get(product.id) ?? 0;
      if (product.stock - product.reserved < requested) {
        return { ok: false as const, error: `Stock insuficiente para ${product.name}.` };
      }
    }
    const totalCents = products.reduce(
      (sum, product) =>
        sum + product.unitPriceCents * (productQuantities.get(product.id) ?? 0),
      0,
    );
    if (!Number.isSafeInteger(totalCents)) {
      return {
        ok: false as const,
        error: "El importe supera el límite permitido para esta simulación.",
      };
    }
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
        igicBasisPoints: product.igicBasisPoints,
      })),
    );
    return { ok: true as const };
  });
  if (!created.ok) {
    res.status(400).json({ error: created.error });
    return;
  }
  await addActivity(tenantId, "Presupuesto creado", "Nuevo pedido en borrador.", reference);
  const order = await loadOrder(id, tenantId);
  if (!order) {
    res.status(500).json({ error: "No se pudo recuperar el pedido creado." });
    return;
  }
  res.status(201).json(CreateFp360OrderResponse.parse(order));
});

router.post("/redfp360/orders/:id/confirm", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
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
      if (!product || product.stock - product.reserved < line.quantity) {
        return {
          ok: false as const,
          status: 400 as const,
          error: `No hay stock suficiente para reservar ${line.productName}.`,
        };
      }
    }
    for (const line of lines) {
      const product = productById.get(line.productId);
      if (!product) continue;
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
  const order = await loadOrder(params.data.id, tenantId);
  res.json(ConfirmFp360OrderResponse.parse(order));
});

router.post("/redfp360/orders/:id/dispatch", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
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
      if (!product || product.stock < quantity || product.reserved < quantity) {
        return {
          ok: false as const,
          status: 400 as const,
          error: "El stock reservado ya no está disponible.",
        };
      }
    }
    for (const [productId, quantity] of quantities) {
      const product = productById.get(productId);
      const line = lines.find((item) => item.productId === productId);
      if (!product || !line) continue;
      await tx
        .update(fpProducts)
        .set({
          stock: product.stock - quantity,
          reserved: product.reserved - quantity,
        })
        .where(eq(fpProducts.id, productId));
      await tx
        .update(fpOrderLines)
        .set({ shippedQuantity: line.shippedQuantity + quantity })
        .where(eq(fpOrderLines.id, line.id));
    }
    const updated = lines.map((line) => ({
      ...line,
      shippedQuantity:
        line.shippedQuantity + (quantities.get(line.productId) ?? 0),
    }));
    const status = updated.every((line) => line.shippedQuantity === line.quantity)
      ? "delivered"
      : "partial";
    await tx
      .update(fpOrders)
      .set({ status })
      .where(eq(fpOrders.id, order.id));
    return { ok: true as const, reference: order.reference };
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  await addActivity(
    tenantId,
    "Albarán simulado",
    "Se ha registrado una entrega de mercancía.",
    result.reference,
  );
  const order = await loadOrder(params.data.id, tenantId);
  res.json(DispatchFp360OrderResponse.parse(order));
});

router.get("/redfp360/invoices", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
  await ensureDemoData(tenantId);
  res.json(ListFp360InvoicesResponse.parse(await listInvoices(tenantId)));
});

router.post("/redfp360/invoices", async (req, res): Promise<void> => {
  const tenantId = req.auth!.tenantId;
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
    const lines = await tx
      .select()
      .from(fpOrderLines)
      .where(eq(fpOrderLines.orderId, order.id))
      .for("update");
    const unbilled = lines
      .map((line) => ({
        line,
        quantity: line.shippedQuantity - line.invoicedQuantity,
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
      reference: invoiceReference,
      orderId: order.id,
      buyerName: buyer?.name ?? "Entidad de la red",
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
    const fullyDelivered = lines.every(
      (line) => line.shippedQuantity === line.quantity,
    );
    const fullyInvoiced = lines.every(
      (line) =>
        line.invoicedQuantity +
          (unbilled.find((entry) => entry.line.id === line.id)?.quantity ?? 0) ===
        line.quantity,
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
  const invoice = await loadInvoice(result.invoiceId, tenantId);
  res.status(201).json(IssueFp360InvoiceResponse.parse(invoice));
});

router.post(
  "/redfp360/invoices/:id/payments",
  async (req, res): Promise<void> => {
    const tenantId = req.auth!.tenantId;
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
    const result = await db.transaction(async (tx) => {
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
        invoiceId: invoice.id,
        amountCents: body.data.amountCents,
        simulatedDate: SIMULATED_DATE,
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
      };
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    await addActivity(
      tenantId,
      "Cobro simulado",
      "Abono registrado en Banco FP360.",
      result.reference,
    );
    const invoice = await loadInvoice(params.data.id, tenantId);
    res.status(201).json(RecordFp360PaymentResponse.parse(invoice));
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

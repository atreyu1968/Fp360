import { type FormEvent, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, BadgeCheck, Boxes, BriefcaseBusiness, CircleHelp, EyeOff, History, Package,
  PackagePlus, Pencil, RefreshCw, Search, SlidersHorizontal, Tags,
} from 'lucide-react';
import {
  getListFp360OrdersQueryKey, getListFp360ProductPriceVersionsQueryKey, getListFp360ProductsQueryKey,
  getListFp360StockAdjustmentsQueryKey, useAdjustFp360Stock, useCreateFp360Product,
  useGetCurrentIdentity, useListFp360Orders, useListFp360Organizations, useListFp360ProductPriceVersions,
  useListFp360Products, useListFp360StockAdjustments, useUpdateFp360Product,
} from '@workspace/api-client-react';
import type { Fp360Product, Fp360ProductInput, Fp360ProductUpdate } from '@workspace/api-client-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Link } from 'wouter';
import { Form } from '@/components/ui/form';
import {
  FormError, MasterDialog, PUBLISH_ROLES, ReadOnlyBanner, WRITE_ROLES, apiErrorMessage,
  basisToPercent, centsToEuros, eurosToCents, percentToBasis,
} from './master-shared';
import { ProductDocuments } from './product-documents';
import './catalog-page.css';

const money = (c: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100);
const dt = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
};
const SIMULATED_DATE = '2027-09-15';
type Filter = 'all' | 'product' | 'service' | 'published' | 'pending' | 'archived' | 'low';
type DialogAction = { product: Fp360Product; action: 'archive' | 'restore' | 'publish' | 'unpublish' };

function available(p: Fp360Product) { return Math.max(0, p.stock - p.reserved); }
function lowStock(p: Fp360Product) {
  return p.itemType === 'product' && p.tracksInventory && p.isActive &&
    p.minimumStock !== null && available(p) <= p.minimumStock;
}

function ItemState({ product }: { product: Fp360Product }) {
  if (!product.isActive) return <span className="status md-muted"><span className="status-dot" />Archivado</span>;
  if (product.isPublished) return <span className="status status-green"><span className="status-dot" />Publicado</span>;
  return <span className="status status-amber"><span className="status-dot" />Pendiente</span>;
}

export function CatalogPage({ onNotice }: { onNotice: (message: string) => void }) {
  const queryClient = useQueryClient();
  const identity = useGetCurrentIdentity();
  const catalog = useListFp360Products();
  const orders = useListFp360Orders();
  const organizations = useListFp360Organizations();
  const update = useUpdateFp360Product();
  const canWrite = WRITE_ROLES.includes(identity.data?.role ?? '');
  const canPublish = PUBLISH_ROLES.includes(identity.data?.role ?? '');
  const isNetworkSupervisor = identity.data?.role === 'administrator' ||
    (identity.data?.role === 'teacher' && !identity.data.organizationId);
  const canManageProduct = (product: Fp360Product) => canWrite &&
    (isNetworkSupervisor || (!!identity.data?.organizationId &&
      product.supplierOrganizationId === identity.data.organizationId));
  const ownOrganization = organizations.data?.find((org) => org.id === identity.data?.organizationId);
  const canCreateProduct = canWrite && (isNetworkSupervisor ||
    (!!ownOrganization && (ownOrganization.role === 'seller' || ownOrganization.role === 'both')));
  const suppliers = (organizations.data ?? []).filter((org) => org.isActive &&
    (org.role === 'seller' || org.role === 'both') &&
    (isNetworkSupervisor || org.id === identity.data?.organizationId));
  const canEditTax = canPublish;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Fp360Product | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<Fp360Product | null>(null);
  const [priceHistoryProduct, setPriceHistoryProduct] = useState<Fp360Product | null>(null);
  const [stockHistoryProduct, setStockHistoryProduct] = useState<Fp360Product | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<DialogAction | null>(null);
  const [actionError, setActionError] = useState('');

  const all = catalog.data ?? [];
  const query = search.trim().toLocaleLowerCase('es');
  const rows = all.filter((p) => {
    const matchesSearch = `${p.name} ${p.sku} ${p.category} ${p.description}`.toLocaleLowerCase('es').includes(query);
    const matchesFilter = filter === 'all' || filter === 'product' || filter === 'service'
      ? (filter === 'all' || p.itemType === filter)
      : filter === 'published' ? p.isActive && p.isPublished
        : filter === 'pending' ? p.isActive && !p.isPublished
          : filter === 'archived' ? !p.isActive : lowStock(p);
    return matchesSearch && matchesFilter;
  });
  const counts = {
    active: all.filter((p) => p.isActive).length,
    products: all.filter((p) => p.isActive && p.itemType === 'product').length,
    services: all.filter((p) => p.isActive && p.itemType === 'service').length,
    published: all.filter((p) => p.isActive && p.isPublished).length,
    pending: all.filter((p) => p.isActive && !p.isPublished).length,
    low: all.filter(lowStock).length,
  };
  const selectedProduct = all.find((p) => p.id === selected) ?? rows[0] ?? null;

  const refreshProducts = () => queryClient.invalidateQueries({ queryKey: getListFp360ProductsQueryKey() });
  const refreshOrders = () => queryClient.invalidateQueries({ queryKey: getListFp360OrdersQueryKey() });
  const refreshRelated = () => {
    void refreshProducts();
    void refreshOrders();
  };

  const runAction = () => {
    if (!confirmation) return;
    const { product, action } = confirmation;
    const data: Fp360ProductUpdate = action === 'archive' ? { isActive: false }
      : action === 'restore' ? { isActive: true }
        : { isPublished: action === 'publish' };
    setActionError('');
    update.mutate({ id: product.id, data }, {
      onSuccess: () => {
        refreshRelated();
        setConfirmation(null);
        onNotice({
          archive: `${product.name} archivado.`,
          restore: `${product.name} restaurado; queda pendiente de aprobación.`,
          publish: `${product.name} aprobado y publicado en el mercado.`,
          unpublish: `${product.name} retirado del mercado.`,
        }[action]);
      },
      onError: (error) => setActionError(apiErrorMessage(error, 'No se pudo completar la acción.')),
    });
  };

  const tabs: { id: Filter; label: string; count?: number }[] = [
    { id: 'all', label: 'Todo', count: all.length },
    { id: 'product', label: 'Productos', count: counts.products },
    { id: 'service', label: 'Servicios', count: counts.services },
    { id: 'published', label: 'Publicados', count: counts.published },
    { id: 'pending', label: 'Pendientes', count: counts.pending },
    { id: 'low', label: 'Stock bajo', count: counts.low },
    { id: 'archived', label: 'Archivados', count: all.filter((p) => !p.isActive).length },
  ];

  return <main className="page-content catalog-page">
    <div className="page-heading page-enter">
      <div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>COMERCIAL · CATÁLOGO</span></div>
      <div className="heading-row">
        <div><h1>Productos y servicios</h1><p>Fichas maestras, tarifas y aprobación comercial de la empresa simulada.</p></div>
        {canCreateProduct && <button className="button button-primary" onClick={() => setEditing('new')} data-testid="button-create-catalog-item"><PackagePlus size={16} /> Nueva referencia</button>}
      </div>
    </div>
    {!canWrite && identity.data && <ReadOnlyBanner text="Tu perfil puede consultar las referencias publicadas del catálogo, pero no modificar fichas." />}

    <div className="catalog-overview" aria-label="Resumen de catálogo">
      <div className="catalog-overview-title"><span className="catalog-overview-mark"><Tags size={17} /></span><div><b>Un catálogo, dos formas de vender</b><small>Los productos pueden controlar existencias; los servicios se gestionan por prestación.</small></div></div>
      <div className="catalog-stats">
        <div><span>Referencias activas</span><b>{catalog.data ? counts.active : '—'}</b></div>
        <div className="catalog-stat-product"><span>Productos</span><b>{catalog.data ? counts.products : '—'}</b></div>
        <div className="catalog-stat-service"><span>Servicios</span><b>{catalog.data ? counts.services : '—'}</b></div>
        <div className="catalog-stat-pending"><span>Pendientes de aprobación</span><b>{catalog.data ? counts.pending : '—'}</b></div>
      </div>
    </div>

    <div className="catalog-workspace">
      <section className="panel catalog-list-panel">
        <div className="catalog-list-heading"><div><h2>Relaciones comerciales</h2><p>Tarifas y disponibilidad registradas en el catálogo.</p></div><button className="icon-button" aria-label="Actualizar catálogo" onClick={() => { void catalog.refetch(); void orders.refetch(); }} data-testid="button-refresh-catalog"><RefreshCw size={15} /></button></div>
        <div className="catalog-toolbar">
          <label className="search-field catalog-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre, referencia o categoría" aria-label="Buscar en catálogo" data-testid="input-catalog-search" /></label>
          <div className="catalog-tabs" role="tablist" aria-label="Filtrar referencias">
            {tabs.map((tab) => <button type="button" key={tab.id} role="tab" aria-selected={filter === tab.id} className={filter === tab.id ? 'catalog-tab active' : 'catalog-tab'} onClick={() => setFilter(tab.id)} data-testid={`tab-catalog-${tab.id}`}>
              {tab.label}<span>{catalog.data ? tab.count : '—'}</span>
            </button>)}
          </div>
        </div>
        {catalog.isLoading && <div className="skeleton-list catalog-skeleton" aria-label="Cargando catálogo"><span /><span /><span /><span /></div>}
        {catalog.isError && <div className="inline-error" role="alert"><CircleHelp size={17} /><span>No se pudo cargar el catálogo.</span><button className="text-button" onClick={() => void catalog.refetch()} data-testid="button-retry-catalog">Reintentar</button></div>}
        {catalog.data && <div className="table-scroll redfp-scroll catalog-table-wrap"><table className="catalog-table"><thead><tr>
          <th>Referencia</th><th>Tipo</th><th>Precio unitario</th><th>Coste</th><th>IGIC</th><th>Existencias</th><th>Estado</th><th>Acciones</th>
        </tr></thead><tbody>
          {rows.map((p) => {
            const canManage = canManageProduct(p);
            return <tr key={p.id} className={`${p.isActive ? '' : 'md-row-archived'} ${selectedProduct?.id === p.id ? 'catalog-row-selected' : ''}`} data-testid={`row-catalog-item-${p.id}`}>
            <td><button className="catalog-item-select" onClick={() => setSelected(p.id)} aria-label={`Ver ficha de ${p.name}`} aria-pressed={selectedProduct?.id === p.id} data-testid={`button-select-item-${p.id}`}>
              <span className={`catalog-item-icon ${p.itemType === 'service' ? 'service' : ''}`}>{p.itemType === 'service' ? <BriefcaseBusiness size={17} /> : <Package size={17} />}</span>
              <span><b>{p.name}</b><small className="mono">{p.sku} <i>·</i> {p.category}</small></span>
            </button></td>
            <td><span className={`catalog-type ${p.itemType}`}>{p.itemType === 'service' ? 'Servicio' : p.tracksInventory ? 'Inventariable' : 'Producto'}</span></td>
            <td className="price-cell">{money(p.unitPriceCents)}<small className="table-secondary block">por {p.unit}</small></td>
            <td>{p.costCents === null ? '—' : money(p.costCents)}</td>
            <td>{basisToPercent(p.igicBasisPoints)} %</td>
            <td>{p.tracksInventory ? <><b className="catalog-stock">{available(p)}</b>{canManage
              ? <><small className="table-secondary block">de {p.stock} · {p.reserved} reservado</small>{lowStock(p) && <span className="md-low">Bajo mínimo {p.minimumStock}</span>}</>
              : <small className="table-secondary block">unidades disponibles</small>}</> : <span className="text-muted">No aplica</span>}</td>
            <td><ItemState product={p} /></td>
            <td><div className="row-actions catalog-actions">
              {canManage && p.isActive && <button className="mini-button" onClick={() => setEditing(p)} data-testid={`button-edit-item-${p.id}`}><Pencil size={13} /> Editar</button>}
              {canManage && p.tracksInventory && p.isActive && <button className="mini-button" onClick={() => setAdjusting(p)} data-testid={`button-adjust-stock-${p.id}`}><SlidersHorizontal size={13} /> Ajustar</button>}
              {canManage && <button className="mini-button" onClick={() => setPriceHistoryProduct(p)} data-testid={`button-price-history-${p.id}`}><History size={13} /> Tarifas</button>}
              {canManage && p.tracksInventory && <button className="mini-button" onClick={() => setStockHistoryProduct(p)} data-testid={`button-stock-history-${p.id}`}><Boxes size={13} /> Movimientos</button>}
              {canManage && canPublish && p.isActive && <button className="mini-button mini-button-blue" onClick={() => { setActionError(''); setConfirmation({ product: p, action: p.isPublished ? 'unpublish' : 'publish' }); }} data-testid={`${p.isPublished ? 'button-unpublish' : 'button-approve'}-item-${p.id}`}>
                {p.isPublished ? <><EyeOff size={13} /> Retirar</> : <><BadgeCheck size={13} /> Aprobar</>}
              </button>}
              {canManage && <button className="mini-button" onClick={() => { setActionError(''); setConfirmation({ product: p, action: p.isActive ? 'archive' : 'restore' }); }} data-testid={`${p.isActive ? 'button-archive' : 'button-restore'}-item-${p.id}`}>
                {p.isActive ? <><Archive size={13} /> Archivar</> : <><ArchiveRestore size={13} /> Restaurar</>}
              </button>}
              {canManage && <button className="mini-button" onClick={() => setEditing({ ...p, id: '', sku: '' } as Fp360Product)} data-testid={`button-duplicate-item-${p.id}`}><PackagePlus size={13} /> Duplicar</button>}
            </div></td>
            </tr>;
          })}
          {!rows.length && <tr><td colSpan={8}><div className="empty-state"><div className="empty-icon"><Package size={20} /></div><strong>{all.length ? 'No hay referencias coincidentes' : 'Aún no hay referencias'}</strong><p>{all.length ? 'Ajusta la búsqueda o el filtro para revisar el catálogo.' : 'Crea una ficha de producto o servicio para iniciar el catálogo de esta empresa.'}</p>{canCreateProduct && !all.length && <button className="button button-primary" onClick={() => setEditing('new')} data-testid="button-create-first-item">Crear primera referencia</button>}</div></td></tr>}
        </tbody></table></div>}
        <div className="table-footer"><span>{rows.length} de {catalog.data?.length ?? '—'} referencias</span><span className="catalog-table-note">La disponibilidad de inventario excluye unidades reservadas.</span></div>
      </section>

      <aside className="catalog-side">
        <section className="panel catalog-detail-panel">
          {selectedProduct ? <ProductDetail product={selectedProduct} supplierName={organizations.data?.find((org) => org.id === selectedProduct.supplierOrganizationId)?.name} orders={orders.data} ordersLoading={orders.isLoading} ordersError={orders.isError} onRetry={() => void orders.refetch()} onEdit={() => setEditing(selectedProduct)} onDuplicate={() => setEditing({ ...selectedProduct, id: '', sku: '' } as Fp360Product)} canWrite={canManageProduct(selectedProduct)} /> :
            <div className="catalog-detail-empty"><Package size={22} /><b>Selecciona una referencia</b><span>La ficha muestra sus condiciones comerciales y los resultados facturados disponibles.</span></div>}
        </section>
        <section className="catalog-learning-note"><div className="catalog-note-icon"><CircleHelp size={17} /></div><div><b>Trazabilidad comercial</b><p>Los cambios de tarifa guardan motivo, fecha efectiva y responsable. El inventario solo cambia mediante ajustes registrados o movimientos de ventas.</p></div></section>
      </aside>
    </div>
    {editing && <ProductForm product={editing === 'new' ? null : editing} suppliers={suppliers}
      defaultSupplierOrganizationId={isNetworkSupervisor ? '' : identity.data?.organizationId ?? ''} canEditTax={canEditTax}
      onClose={() => setEditing(null)} onSaved={(message, id) => { setEditing(null); refreshRelated(); if (id) setSelected(id); onNotice(message); }} />}
    {adjusting && <StockAdjustmentDialog product={adjusting} onClose={() => setAdjusting(null)} onSaved={() => {
      void refreshProducts(); void queryClient.invalidateQueries({ queryKey: getListFp360StockAdjustmentsQueryKey(adjusting.id) });
      setAdjusting(null); onNotice(`Ajuste de inventario registrado en ${adjusting.name}.`);
    }} />}
    {priceHistoryProduct && <PriceHistoryDialog product={priceHistoryProduct} onClose={() => setPriceHistoryProduct(null)} />}
    {stockHistoryProduct && <StockHistoryDialog product={stockHistoryProduct} onClose={() => setStockHistoryProduct(null)} />}
    {confirmation && <MasterDialog title={{ archive: 'Archivar referencia', restore: 'Restaurar referencia', publish: 'Aprobar y publicar', unpublish: 'Retirar del mercado' }[confirmation.action]} onClose={() => setConfirmation(null)}>
      <div className="form-stack">
        <p className="form-intro"><b>{confirmation.product.name}</b> <span className="mono">({confirmation.product.sku})</span></p>
        <p className="form-intro">{{
          archive: 'Dejará de estar disponible para nuevas operaciones. El historial existente se conserva.',
          restore: 'Volverá a estar activo y quedará pendiente de aprobación antes de publicarse.',
          publish: 'La referencia quedará visible en Mercado FP360 para nuevas operaciones.',
          unpublish: 'La referencia dejará de aparecer en el mercado; los pedidos existentes no cambian.',
        }[confirmation.action]}</p>
        {confirmation.action === 'archive' && confirmation.product.reserved > 0 && <FormError text={`Hay ${confirmation.product.reserved} unidades reservadas. Deben resolverse antes de archivar.`} />}
        <FormError text={actionError} />
        <div className="modal-actions"><button className="button button-quiet" onClick={() => setConfirmation(null)} data-testid="button-cancel-catalog-action">Cancelar</button>
          <button className={confirmation.action === 'archive' ? 'button admin-danger-button' : 'button button-primary'} disabled={update.isPending || (confirmation.action === 'archive' && confirmation.product.reserved > 0)} onClick={runAction} data-testid="button-confirm-catalog-action">{update.isPending ? 'Guardando…' : 'Confirmar'}</button></div>
      </div>
    </MasterDialog>}
  </main>;
}

function ProductDetail({ product, supplierName, orders, ordersLoading, ordersError, onRetry, onEdit, onDuplicate, canWrite }: {
  product: Fp360Product; orders?: import('@workspace/api-client-react').Fp360Order[]; ordersLoading: boolean; ordersError: boolean;
  supplierName?: string; onRetry: () => void; onEdit: () => void; onDuplicate: () => void; canWrite: boolean;
}) {
  const invoicedLines = (orders ?? []).flatMap((order) => order.lines
    .filter((line) => line.productId === product.id && line.invoicedQuantity > 0)
    .map((line) => ({ ...line, orderReference: order.reference, invoiceStatus: order.status })));
  const soldUnits = invoicedLines.reduce((sum, line) => sum + line.invoicedQuantity, 0);
  const revenue = invoicedLines.reduce((sum, line) => sum + line.unitPriceCents * line.invoicedQuantity, 0);
  const costKnown = invoicedLines.length > 0 && invoicedLines.every((line) => line.unitCostCents !== null);
  const marginCents = costKnown ? invoicedLines.reduce((sum, line) => sum + (line.unitPriceCents - (line.unitCostCents ?? 0)) * line.invoicedQuantity, 0) : null;
  return <>
    <div className="catalog-detail-head"><span className={`catalog-detail-mark ${product.itemType === 'service' ? 'service' : ''}`}>{product.itemType === 'service' ? <BriefcaseBusiness size={18} /> : <Package size={18} />}</span><div><span className="catalog-overline">FICHA DE REFERENCIA</span><h2>{product.name}</h2><p className="mono">{product.sku} · {product.category}</p></div></div>
    <div className="catalog-detail-status"><span className={`catalog-type ${product.itemType}`}>{product.itemType === 'service' ? 'Servicio' : 'Producto'}</span><ItemState product={product} /></div>
    <dl className="catalog-detail-list">
      <div><dt>Precio unitario</dt><dd>{money(product.unitPriceCents)} <small>por {product.unit}</small></dd></div>
      <div><dt>IGIC</dt><dd>{basisToPercent(product.igicBasisPoints)} %</dd></div>
      <div><dt>Coste registrado</dt><dd>{product.costCents === null ? 'Privado' : money(product.costCents)}</dd></div>
      {product.itemType === 'product' && <div><dt>Control de inventario</dt><dd>{product.tracksInventory ? 'Sí' : 'No'}</dd></div>}
      {product.tracksInventory && <div><dt>Disponible</dt><dd>{available(product)} <small>{canWrite ? `de ${product.stock}; ${product.reserved} reservado` : 'unidades disponibles'}</small></dd></div>}
      <div><dt>Proveedor asignado</dt><dd>{product.supplierOrganizationId ? supplierName ?? 'Proveedor no disponible' : 'Sin asignar'}</dd></div>
      <div><dt>Plazo previsto</dt><dd>{product.leadTimeDays ? `${product.leadTimeDays} días` : 'No indicado'}</dd></div>
    </dl>
    {product.description && <p className="catalog-description">{product.description}</p>}
    <div className="catalog-analysis">
      <div className="catalog-analysis-title"><span>ANÁLISIS FACTURADO</span><span className="catalog-analysis-origin">Datos de pedidos</span></div>
      {ordersLoading ? <div className="catalog-analysis-skeleton"><i /><i /></div>
        : ordersError ? <div className="catalog-analysis-error" role="alert">No se pudo consultar el análisis. <button className="text-button" onClick={onRetry}>Reintentar</button></div>
          : invoicedLines.length ? <>
             <div className="catalog-analysis-metrics"><div><span>Unidades / prestaciones</span><b>{soldUnits}</b></div><div><span>Base facturada</span><b>{money(revenue)}</b></div></div>
            <div className="catalog-analysis-margin"><span>Margen con coste histórico</span><b>{marginCents === null ? 'No disponible' : money(marginCents)}</b></div>
            {marginCents === null && <p className="catalog-analysis-caveat">Hay líneas facturadas sin coste histórico. No se estima el margen.</p>}
            <div className="catalog-invoiced-list">{invoicedLines.slice(0, 3).map((line, index) => <div key={`${line.orderReference}-${index}`}><span>{line.orderReference}</span><b>{line.invoicedQuantity} × {money(line.unitPriceCents)}</b></div>)}</div>
          </> : <div className="catalog-analysis-empty"><b>Sin líneas facturadas</b><span>El análisis aparece cuando existan pedidos facturados para esta referencia.</span></div>}
    </div>
    <ProductDocuments productId={product.id} canWrite={canWrite && product.isActive} />
    {canWrite && product.isActive && <div className="catalog-detail-actions"><button className="button button-primary" onClick={onEdit} data-testid={`button-edit-detail-${product.id}`}><Pencil size={14} /> Editar ficha</button><button className="button button-quiet" onClick={onDuplicate} data-testid={`button-duplicate-detail-${product.id}`}><PackagePlus size={14} /> Duplicar como plantilla</button></div>}
    <div className="catalog-next-steps"><b>Continuidad del proceso</b><span><Link href="/mercado" data-testid="link-catalog-market">Mercado</Link> para consultar ofertas · <Link href="/ventas" data-testid="link-catalog-sales">Ventas</Link> para pedidos y prestación · <Link href="/almacen" data-testid="link-catalog-inventory">Almacén</Link> para existencias</span></div>
  </>;
}

const productSchema = z.object({
  sku: z.string().trim().min(1, 'Indica una referencia.').max(40).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Usa letras, números, punto, guion o guion bajo.'),
  name: z.string().trim().min(1, 'Indica un nombre.').max(150),
  description: z.string().max(2000).optional(),
  category: z.string().trim().min(1, 'Indica una categoría.').max(100),
  itemType: z.enum(['product', 'service']),
  unit: z.string().trim().min(1, 'Indica una unidad.').max(40),
  tracksInventory: z.boolean(),
  price: z.string().min(1, 'Indica un precio.'),
  cost: z.string().min(1, 'Indica un coste.'),
  igic: z.string().min(1, 'Indica un tipo de IGIC.'),
  initialStock: z.string(),
  minimumStock: z.string(),
  maxDiscount: z.string(),
  leadTime: z.string(),
  supplierOrganizationId: z.string(),
  priceChangeReason: z.string(),
  effectiveFrom: z.string(),
}).superRefine((values, ctx) => {
  if (eurosToCents(values.price) === null) ctx.addIssue({ code: 'custom', path: ['price'], message: 'Importe inválido; usa hasta dos decimales.' });
  if (eurosToCents(values.cost) === null) ctx.addIssue({ code: 'custom', path: ['cost'], message: 'Importe inválido; usa hasta dos decimales.' });
  if (percentToBasis(values.igic) === null) ctx.addIssue({ code: 'custom', path: ['igic'], message: 'Porcentaje entre 0 y 100.' });
  for (const [field, label, max] of [['initialStock', 'El stock inicial', 1000000], ['minimumStock', 'El mínimo', 1000000], ['maxDiscount', 'El descuento máximo', 10000], ['leadTime', 'El plazo', 3650]] as const) {
    const value = Number(values[field]);
    if (!Number.isInteger(value) || value < 0 || value > max) ctx.addIssue({ code: 'custom', path: [field], message: `${label} debe ser un entero entre 0 y ${max}.` });
  }
  if (values.itemType === 'service' && values.tracksInventory) ctx.addIssue({ code: 'custom', path: ['tracksInventory'], message: 'Los servicios no pueden controlar existencias.' });
  if (values.priceChangeReason.trim().length > 0 && values.priceChangeReason.trim().length < 5) ctx.addIssue({ code: 'custom', path: ['priceChangeReason'], message: 'Indica un motivo de al menos 5 caracteres.' });
});
type ProductFormValues = z.infer<typeof productSchema>;

function ProductForm({ product, suppliers, defaultSupplierOrganizationId, canEditTax, onClose, onSaved }: {
  product: Fp360Product | null; suppliers: { id: string; name: string; island: string }[];
  defaultSupplierOrganizationId: string; canEditTax: boolean;
  onClose: () => void; onSaved: (message: string, id?: string) => void;
}) {
  const creating = !product || !product.id;
  const seed = product && !creating ? product : product;
  const create = useCreateFp360Product();
  const update = useUpdateFp360Product();
  const queryClient = useQueryClient();
  const history = useListFp360ProductPriceVersions(product?.id ?? '', { query: { enabled: !!product?.id && !creating, queryKey: getListFp360ProductPriceVersionsQueryKey(product?.id ?? '') } });
  const latestPriceDate = history.data?.[0]?.validFrom;
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      sku: creating ? '' : seed?.sku ?? '', name: seed?.name ?? '', description: seed?.description ?? '', category: seed?.category ?? '',
      itemType: seed?.itemType ?? 'product', unit: seed?.unit ?? 'ud.', tracksInventory: creating ? true : seed?.tracksInventory ?? false,
      price: seed ? centsToEuros(seed.unitPriceCents) : '', cost: seed ? centsToEuros(seed.costCents ?? 0) : '0.00',
      igic: seed ? basisToPercent(seed.igicBasisPoints) : '7', initialStock: '0', minimumStock: String(seed?.minimumStock ?? 0),
      maxDiscount: String(seed ? (seed.maxDiscountBasisPoints ?? 0) / 100 : 0), leadTime: String(seed?.leadTimeDays ?? 0),
      supplierOrganizationId: seed?.supplierOrganizationId ?? defaultSupplierOrganizationId, priceChangeReason: '', effectiveFrom: SIMULATED_DATE,
    },
  });
  const [serverError, setServerError] = useState('');
  const itemType = form.watch('itemType');
  const tracksInventory = form.watch('tracksInventory');
  const priceWatch = form.watch(['price', 'cost', 'igic', 'maxDiscount']);
  const tariffChanged = !!product?.id && (
    eurosToCents(priceWatch[0]) !== product.unitPriceCents ||
    eurosToCents(priceWatch[1]) !== (product.costCents ?? 0) ||
    percentToBasis(priceWatch[2]) !== product.igicBasisPoints ||
    Number(priceWatch[3]) * 100 !== (product.maxDiscountBasisPoints ?? 0)
  );
  const roleCanChangeIgic = canEditTax;
  useEffect(() => {
    if (itemType === 'service') form.setValue('tracksInventory', false);
    if (itemType === 'service' || !tracksInventory) form.setValue('minimumStock', '0');
    const effectiveFrom = form.getValues('effectiveFrom');
    if (latestPriceDate && effectiveFrom < latestPriceDate) form.setValue('effectiveFrom', latestPriceDate);
  }, [itemType, tracksInventory, latestPriceDate, form]);

  const submit = (values: ProductFormValues) => {
    setServerError('');
    const priceCents = eurosToCents(values.price)!;
    const costCents = eurosToCents(values.cost)!;
    const igicBasisPoints = percentToBasis(values.igic)!;
    const supplierOrganizationId = values.supplierOrganizationId || null;
    if (creating) {
      const data: Fp360ProductInput = {
        sku: values.sku.trim(), name: values.name.trim(), description: values.description?.trim() ?? '',
        category: values.category.trim(), itemType: values.itemType, unit: values.unit.trim(),
        tracksInventory: values.itemType === 'product' && values.tracksInventory,
        unitPriceCents: priceCents, costCents, igicBasisPoints,
        stock: values.itemType === 'product' && values.tracksInventory ? Number(values.initialStock) : 0,
        minimumStock: values.itemType === 'product' && values.tracksInventory ? Number(values.minimumStock) : 0,
        maxDiscountBasisPoints: Math.round(Number(values.maxDiscount) * 100), leadTimeDays: Number(values.leadTime),
        supplierOrganizationId,
      };
      create.mutate({ data }, {
        onSuccess: (created) => onSaved(`${created.name} creado; queda pendiente de aprobación.`, created.id),
        onError: (error) => setServerError(apiErrorMessage(error, 'No se pudo crear la referencia.')),
      });
      return;
    }
    if (!product) return;
    if (!roleCanChangeIgic && igicBasisPoints !== product.igicBasisPoints) {
      setServerError('Solo profesorado o administración puede modificar el IGIC.');
      return;
    }
    const data: Fp360ProductUpdate = {};
    if (values.sku.trim() !== product.sku) data.sku = values.sku.trim();
    if (values.name.trim() !== product.name) data.name = values.name.trim();
    if ((values.description?.trim() ?? '') !== product.description) data.description = values.description?.trim() ?? '';
    if (values.category.trim() !== product.category) data.category = values.category.trim();
    if (values.itemType !== product.itemType) data.itemType = values.itemType;
    if (values.unit.trim() !== product.unit) data.unit = values.unit.trim();
    if (values.itemType === 'product' && values.tracksInventory !== product.tracksInventory) data.tracksInventory = values.tracksInventory;
    if (priceCents !== product.unitPriceCents) data.unitPriceCents = priceCents;
    if (costCents !== (product.costCents ?? 0)) data.costCents = costCents;
    if (igicBasisPoints !== product.igicBasisPoints) data.igicBasisPoints = igicBasisPoints;
    const minimumStock = values.itemType === 'product' && values.tracksInventory ? Number(values.minimumStock) : 0;
    if (minimumStock !== (product.minimumStock ?? 0)) data.minimumStock = minimumStock;
    if (Math.round(Number(values.maxDiscount) * 100) !== (product.maxDiscountBasisPoints ?? 0)) data.maxDiscountBasisPoints = Math.round(Number(values.maxDiscount) * 100);
    if (Number(values.leadTime) !== product.leadTimeDays) data.leadTimeDays = Number(values.leadTime);
    if (supplierOrganizationId !== product.supplierOrganizationId) data.supplierOrganizationId = supplierOrganizationId;
    if (tariffChanged) {
      const reason = values.priceChangeReason.trim();
      if (reason.length < 5 || reason.length > 500) return setServerError('Indica el motivo del cambio de tarifa (5–500 caracteres).');
      if (!values.effectiveFrom) return setServerError('Indica la fecha efectiva del cambio de tarifa.');
      data.priceChangeReason = reason;
      data.effectiveFrom = values.effectiveFrom;
    }
    if (!Object.keys(data).length) return onClose();
    update.mutate({ id: product.id, data }, {
      onSuccess: (saved) => {
        void queryClient.invalidateQueries({ queryKey: getListFp360ProductPriceVersionsQueryKey(product.id) });
        onSaved(
          tariffChanged ? `Ficha guardada. La tarifa de ${saved.name} requiere nueva aprobación para publicarse.` : `Cambios guardados en ${saved.name}.`,
          saved.id,
        );
      },
      onError: (error) => setServerError(apiErrorMessage(error, 'No se pudieron guardar los cambios.')),
    });
  };
  const pending = create.isPending || update.isPending;
  const fieldError = (key: keyof ProductFormValues) => form.formState.errors[key]?.message as string | undefined;
  return <MasterDialog title={creating ? product ? 'Duplicar como plantilla' : 'Nueva referencia' : `Editar ${product?.name}`} onClose={onClose} wide>
    <Form {...form}>
      <form className="form-stack catalog-form" onSubmit={form.handleSubmit(submit)} noValidate>
        <p className="form-intro">{creating ? product ? 'Se crearán datos nuevos a partir de la ficha seleccionada. Define una referencia única antes de guardar.' : 'La nueva referencia se crea activa y pendiente de aprobación. El stock inicial, si procede, solo se admite en el alta.' : 'Los cambios de tarifa quedan auditados; las cantidades de inventario se registran por ajuste y no desde esta ficha.'}</p>
        <div className="catalog-form-grid">
          <label>Tipo de referencia<select {...form.register('itemType')} data-testid="select-item-type"><option value="product">Producto</option><option value="service">Servicio</option></select>{fieldError('itemType') && <small className="field-error">{fieldError('itemType')}</small>}</label>
          <label>Referencia / SKU<input autoFocus maxLength={40} {...form.register('sku')} className="mono" data-testid="input-item-sku" />{fieldError('sku') && <small className="field-error">{fieldError('sku')}</small>}</label>
          <label className="catalog-form-span">Nombre<input maxLength={150} {...form.register('name')} data-testid="input-item-name" />{fieldError('name') && <small className="field-error">{fieldError('name')}</small>}</label>
          <label>Categoría<input maxLength={100} {...form.register('category')} data-testid="input-item-category" />{fieldError('category') && <small className="field-error">{fieldError('category')}</small>}</label>
          <label>Unidad de venta<input maxLength={40} {...form.register('unit')} placeholder="ud., hora, servicio…" data-testid="input-item-unit" />{fieldError('unit') && <small className="field-error">{fieldError('unit')}</small>}</label>
          <label>Precio de venta (€)<input inputMode="decimal" {...form.register('price')} data-testid="input-item-price" />{fieldError('price') && <small className="field-error">{fieldError('price')}</small>}</label>
          <label>Coste unitario (€)<input inputMode="decimal" {...form.register('cost')} data-testid="input-item-cost" />{fieldError('cost') && <small className="field-error">{fieldError('cost')}</small>}</label>
          <label>IGIC (%)<input inputMode="decimal" {...form.register('igic')} disabled={!canEditTax} aria-describedby={!canEditTax ? 'catalog-igic-hint' : undefined} data-testid="input-item-igic" />{!canEditTax && <small id="catalog-igic-hint">Solo profesorado o administración puede modificarlo.</small>}{fieldError('igic') && <small className="field-error">{fieldError('igic')}</small>}</label>
          <label>Descuento máximo (%)<input type="number" min={0} max={100} step="0.01" {...form.register('maxDiscount')} data-testid="input-item-max-discount" />{fieldError('maxDiscount') && <small className="field-error">{fieldError('maxDiscount')}</small>}</label>
          <label>Plazo previsto (días)<input type="number" min={0} max={3650} step={1} {...form.register('leadTime')} data-testid="input-item-leadtime" />{fieldError('leadTime') && <small className="field-error">{fieldError('leadTime')}</small>}</label>
          <label className="catalog-form-span">Proveedor asignado<select {...form.register('supplierOrganizationId')} data-testid="select-item-supplier"><option value="">Sin proveedor asignado</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.island}</option>)}</select><small>Solo organizaciones activas con perfil vendedor.</small></label>
          <label className="catalog-form-span">Descripción<textarea maxLength={2000} rows={3} {...form.register('description')} data-testid="input-item-description" /></label>
          {itemType === 'product' && <div className="catalog-form-span catalog-inventory-field">
            <label className="catalog-check"><input type="checkbox" {...form.register('tracksInventory')} data-testid="checkbox-track-inventory" /><span><b>Controlar existencias</b><small>Este producto aparecerá en los procesos de almacén.</small></span></label>
            {tracksInventory && <div className="catalog-form-grid catalog-stock-create">
              {creating && <label>Stock inicial<input type="number" min={0} step={1} {...form.register('initialStock')} data-testid="input-initial-stock" />{fieldError('initialStock') && <small className="field-error">{fieldError('initialStock')}</small>}</label>}
              <label>Stock mínimo<input type="number" min={0} step={1} {...form.register('minimumStock')} data-testid="input-minimum-stock" />{fieldError('minimumStock') && <small className="field-error">{fieldError('minimumStock')}</small>}</label>
            </div>}
          </div>}
          {tariffChanged && <div className="catalog-form-span catalog-tariff-reason">
            <strong>Registro de cambio de tarifa</strong><span>Al modificar precio, coste, IGIC o descuento máximo se conserva la trazabilidad y la referencia vuelve a requerir aprobación.</span>
            <label>Motivo del cambio<textarea minLength={5} maxLength={500} {...form.register('priceChangeReason')} data-testid="input-price-change-reason" />{fieldError('priceChangeReason') && <small className="field-error">{fieldError('priceChangeReason')}</small>}</label>
            <label>Fecha efectiva<input type="date" min={latestPriceDate ?? SIMULATED_DATE} {...form.register('effectiveFrom')} data-testid="input-price-effective-date" /></label>
          </div>}
        </div>
        <FormError text={serverError} />
        {!creating && product && <div className="catalog-inline-history"><b>Último registro de tarifa</b>{history.isLoading ? <span>Cargando historial…</span> : history.isError ? <button type="button" className="text-button" onClick={() => void history.refetch()}>No se pudo cargar. Reintentar</button> : history.data?.[0] ? <span>{dt(history.data[0].validFrom)} · {history.data[0].reason}</span> : <span>Sin versiones históricas registradas.</span>}</div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose} data-testid="button-cancel-item-form">Cancelar</button><button className="button button-primary" disabled={pending} data-testid="button-submit-item-form">{pending ? 'Guardando…' : creating ? 'Crear referencia' : 'Guardar cambios'}</button></div>
      </form>
    </Form>
  </MasterDialog>;
}

function StockAdjustmentDialog({ product, onClose, onSaved }: { product: Fp360Product; onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const adjust = useAdjustFp360Stock();
  const [operationId] = useState(() => crypto.randomUUID());
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const change = Number(delta);
  const valid = !!delta && Number.isInteger(change) && change !== 0 && Math.abs(change) <= 1000000 && product.stock + change >= product.reserved && reason.trim().length >= 5;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError('');
    if (!Number.isInteger(change) || change === 0 || Math.abs(change) > 1000000) return setError('Indica una variación entera distinta de cero.');
    if (reason.trim().length < 5 || reason.trim().length > 500) return setError('El motivo debe tener entre 5 y 500 caracteres.');
    if (product.stock + change < product.reserved) return setError(`El stock resultante no puede ser inferior a las ${product.reserved} unidades reservadas.`);
    adjust.mutate({ id: product.id, data: { operationId, quantityDelta: change, reason: reason.trim() } }, {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getListFp360ProductsQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListFp360StockAdjustmentsQueryKey(product.id) });
        onSaved();
      },
      onError: (errorValue) => setError(apiErrorMessage(errorValue, 'No se pudo registrar el ajuste.')),
    });
  };
  return <MasterDialog title={`Ajuste de inventario · ${product.name}`} onClose={onClose}>
    <form className="form-stack" onSubmit={submit} noValidate>
      <p className="form-intro">Registra una entrada o salida excepcional con motivo. Las expediciones y reservas de ventas siguen su propio proceso.</p>
      <div className="md-stockline"><div><span>En almacén</span><b>{product.stock}</b></div><div><span>Reservado</span><b>{product.reserved}</b></div><div><span>Resultado</span><b data-testid="text-adjustment-result">{Number.isInteger(change) && change !== 0 ? product.stock + change : '—'}</b></div></div>
      <label>Variación de unidades (+ entrada / − salida)<input autoFocus type="number" step={1} value={delta} onChange={(event) => setDelta(event.target.value)} placeholder="Indica unidades" data-testid="input-stock-delta" /></label>
      <label>Motivo<textarea className="md-textarea" minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} data-testid="input-stock-adjustment-reason" /></label>
      <FormError text={error} />
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose} data-testid="button-cancel-stock-adjustment">Cancelar</button><button className="button button-primary" disabled={adjust.isPending || !valid} data-testid="button-submit-stock-adjustment">{adjust.isPending ? 'Registrando…' : 'Registrar ajuste'}</button></div>
    </form>
  </MasterDialog>;
}

function PriceHistoryDialog({ product, onClose }: { product: Fp360Product; onClose: () => void }) {
  const query = useListFp360ProductPriceVersions(product.id, { query: { enabled: !!product.id, queryKey: getListFp360ProductPriceVersionsQueryKey(product.id) } });
  return <MasterDialog title={`Historial de tarifas · ${product.name}`} onClose={onClose} wide>
    <div className="form-stack">
      <p className="form-intro">Versiones registradas para esta referencia, con fecha de efecto, motivo y responsable.</p>
      {query.isLoading && <div className="skeleton-list"><span /><span /><span /></div>}
      {query.isError && <div className="inline-error" role="alert"><CircleHelp size={16} />No se pudo cargar el historial.<button className="text-button" onClick={() => void query.refetch()} data-testid="button-retry-price-history">Reintentar</button></div>}
      {query.data && (query.data.length ? <div className="table-scroll redfp-scroll"><table className="catalog-history-table"><thead><tr><th>Vigente desde</th><th>Precio</th><th>Coste</th><th>IGIC</th><th>Descuento máximo</th><th>Motivo</th><th>Responsable</th></tr></thead><tbody>
        {query.data.map((version) => <tr key={version.id} data-testid={`row-price-version-${version.id}`}><td>{dt(version.validFrom)}</td><td>{money(version.unitPriceCents)}</td><td>{money(version.costCents)}</td><td>{basisToPercent(version.igicBasisPoints)} %</td><td>{basisToPercent(version.maxDiscountBasisPoints)} %</td><td>{version.reason}</td><td>{version.actorName}</td></tr>)}
      </tbody></table></div> : <div className="empty-state"><div className="empty-icon"><History size={20} /></div><strong>Sin versiones de tarifa</strong><p>Los cambios posteriores quedarán registrados aquí.</p></div>)}
    </div>
  </MasterDialog>;
}

function StockHistoryDialog({ product, onClose }: { product: Fp360Product; onClose: () => void }) {
  const query = useListFp360StockAdjustments(product.id, { query: { enabled: !!product.id, queryKey: getListFp360StockAdjustmentsQueryKey(product.id) } });
  return <MasterDialog title={`Movimientos manuales · ${product.name}`} onClose={onClose} wide>
    <div className="form-stack">
      <p className="form-intro">Este historial contiene ajustes manuales. Reservas y expediciones de pedidos se consultan en sus procesos de ventas.</p>
      {query.isLoading && <div className="skeleton-list"><span /><span /><span /></div>}
      {query.isError && <div className="inline-error" role="alert"><CircleHelp size={16} />No se pudo cargar el historial.<button className="text-button" onClick={() => void query.refetch()} data-testid="button-retry-stock-history">Reintentar</button></div>}
      {query.data && (query.data.length ? <ol className="md-history">{query.data.map((movement) => <li key={movement.id} data-testid={`row-stock-movement-${movement.id}`}>
        <span className={movement.quantityDelta > 0 ? 'md-delta md-delta-in' : 'md-delta md-delta-out'}>{movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta}</span>
        <div><b>{movement.reason}</b><small>{movement.stockBefore} → {movement.stockAfter} · {movement.actorName}</small></div><time>{dt(movement.simulatedDate)}</time>
      </li>)}</ol> : <div className="empty-state"><div className="empty-icon"><History size={20} /></div><strong>Sin ajustes manuales</strong><p>Los ajustes registrados aparecerán en este historial.</p></div>)}
    </div>
  </MasterDialog>;
}

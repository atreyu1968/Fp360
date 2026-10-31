import { type FormEvent, useState } from 'react';
import {
  Archive, ArchiveRestore, BadgeCheck, CircleHelp, EyeOff, History, Package, PackagePlus, Pencil, RefreshCw, Search, SlidersHorizontal,
} from 'lucide-react';
import {
  getListFp360StockAdjustmentsQueryKey, useAdjustFp360Stock, useCreateFp360Product, useGetCurrentIdentity,
  useListFp360Products, useListFp360StockAdjustments, useUpdateFp360Product,
} from '@workspace/api-client-react';
import type { Fp360Product, Fp360ProductUpdate } from '@workspace/api-client-react';
import {
  FormError, MasterDialog, PUBLISH_ROLES, ReadOnlyBanner, WRITE_ROLES, apiErrorMessage, basisToPercent,
  centsToEuros, eurosToCents, percentToBasis, useRefreshMaster,
} from './master-shared';

const money = (c: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100);
const dt = (v: string) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(d); };
type Filter = 'all' | 'published' | 'pending' | 'archived' | 'low';

function available(p: Fp360Product) { return Math.max(0, p.stock - p.reserved); }
function isLow(p: Fp360Product) { return p.isActive && available(p) <= p.minimumStock; }

function ProductState({ p }: { p: Fp360Product }) {
  if (!p.isActive) return <span className="status md-muted"><span className="status-dot" />Archivado</span>;
  if (p.isPublished) return <span className="status status-green"><span className="status-dot" />Publicado</span>;
  return <span className="status status-amber"><span className="status-dot" />Pendiente de aprobación</span>;
}

export function CatalogPage({ onNotice }: { onNotice: (m: string) => void }) {
  const identity = useGetCurrentIdentity();
  const role = identity.data?.role ?? '';
  const canWrite = WRITE_ROLES.includes(role);
  const canPublish = PUBLISH_ROLES.includes(role);
  const products = useListFp360Products();
  const update = useUpdateFp360Product();
  const refresh = useRefreshMaster();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<Fp360Product | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<Fp360Product | null>(null);
  const [history, setHistory] = useState<Fp360Product | null>(null);
  const [confirm, setConfirm] = useState<{ p: Fp360Product; action: 'archive' | 'restore' | 'publish' | 'unpublish' } | null>(null);
  const [confirmError, setConfirmError] = useState('');

  const all = products.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(q) && (
    filter === 'all' ? true : filter === 'published' ? p.isActive && p.isPublished : filter === 'pending' ? p.isActive && !p.isPublished : filter === 'archived' ? !p.isActive : isLow(p)));
  const counts = { active: all.filter((p) => p.isActive).length, published: all.filter((p) => p.isActive && p.isPublished).length, pending: all.filter((p) => p.isActive && !p.isPublished).length, low: all.filter(isLow).length };

  const runConfirm = () => {
    if (!confirm) return;
    const { p, action } = confirm;
    const data: Fp360ProductUpdate = action === 'archive' ? { isActive: false } : action === 'restore' ? { isActive: true } : { isPublished: action === 'publish' };
    setConfirmError('');
    update.mutate({ id: p.id, data }, {
      onSuccess: () => {
        refresh(); setConfirm(null);
        onNotice({ archive: `${p.name} archivado. Ya no aparece en mercado ni pedidos.`, restore: `${p.name} restaurado. Requiere nueva aprobación para publicarse.`, publish: `${p.name} publicado en el mercado FP360.`, unpublish: `${p.name} retirado del mercado.` }[action]);
      },
      onError: (err) => setConfirmError(apiErrorMessage(err, 'No se pudo completar la acción.')),
    });
  };

  const tabs: { id: Filter; label: string; n?: number }[] = [
    { id: 'all', label: 'Todos', n: all.length }, { id: 'published', label: 'Publicados', n: counts.published },
    { id: 'pending', label: 'Pendientes', n: counts.pending }, { id: 'low', label: 'Stock bajo', n: counts.low }, { id: 'archived', label: 'Archivados', n: all.length - counts.active },
  ];

  return <main className="page-content">
    <div className="page-heading page-enter"><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>CATÁLOGO · PRODUCTOS DE INVENTARIO</span></div>
      <div className="heading-row"><div><h1>Catálogo de productos</h1><p>Datos maestros de los artículos inventariables de la empresa simulada. Los servicios no forman parte de este catálogo.</p></div>
        {canWrite && <button className="button button-primary" onClick={() => setEditing('new')} data-testid="button-new-product"><PackagePlus size={16} /> Nuevo producto</button>}</div>
    </div>
    {!canWrite && identity.data && <ReadOnlyBanner text="Tu perfil permite consultar el catálogo y su historial, pero no modificarlo." />}
    <div className="md-strip">
      <div><span>Activos</span><b data-testid="text-active-products">{products.data ? counts.active : '—'}</b></div>
      <div className="md-strip-ok"><span>Publicados en mercado</span><b>{products.data ? counts.published : '—'}</b></div>
      <div className="md-strip-warn"><span>Esperando aprobación docente</span><b>{products.data ? counts.pending : '—'}</b></div>
      <div className="md-strip-low"><span>Bajo mínimo</span><b>{products.data ? counts.low : '—'}</b></div>
    </div>
    <section className="panel">
      <div className="list-toolbar">
        <div className="tabs" role="tablist" aria-label="Filtrar catálogo">{tabs.map((t) => <button key={t.id} role="tab" aria-selected={filter === t.id} className={filter === t.id ? 'tab-active' : ''} onClick={() => setFilter(t.id)} data-testid={`tab-catalog-${t.id}`}>{t.label}<span className="md-count">{t.n}</span></button>)}</div>
        <label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nombre, SKU o categoría" aria-label="Buscar productos" data-testid="input-catalog-search" /></label>
      </div>
      {products.isLoading && <div className="skeleton-list" aria-label="Cargando"><span /><span /><span /></div>}
      {products.isError && <div className="inline-error" role="alert"><CircleHelp size={18} /><span>No se ha podido cargar el catálogo.</span><button className="text-button" onClick={() => void products.refetch()}>Reintentar</button></div>}
      {products.data && <div className="table-scroll redfp-scroll"><table style={{ minWidth: 980 }}><thead><tr><th>Producto</th><th>Precio · IGIC</th><th>Coste</th><th>Stock</th><th>Reservado</th><th>Disponible</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
        {rows.map((p) => <tr key={p.id} className={p.isActive ? '' : 'md-row-archived'} data-testid={`row-product-${p.id}`}>
          <td><div className="product-cell"><span className="product-glyph"><Package size={17} /></span><span><b>{p.name}</b><small className="mono">{p.sku} · {p.category}</small></span></div></td>
          <td className="price-cell">{money(p.unitPriceCents)}<small className="table-secondary block">IGIC {basisToPercent(p.igicBasisPoints)} %</small></td>
          <td>{money(p.costCents)}</td>
          <td className="numeric">{p.stock}</td><td className="numeric">{p.reserved}</td>
          <td><span className="stock-value">{available(p)}</span>{isLow(p) && <span className="md-low" title={`Mínimo ${p.minimumStock}`}>Bajo mínimo ({p.minimumStock})</span>}</td>
          <td><ProductState p={p} /></td>
          <td><div className="row-actions md-actions">
            <button className="mini-button" onClick={() => setHistory(p)} data-testid={`button-history-${p.id}`}><History size={13} /> Ajustes</button>
            {canWrite && p.isActive && <button className="mini-button" onClick={() => setEditing(p)} data-testid={`button-edit-product-${p.id}`}><Pencil size={13} /> Editar</button>}
            {canWrite && p.isActive && <button className="mini-button" onClick={() => setAdjusting(p)} data-testid={`button-adjust-${p.id}`}><SlidersHorizontal size={13} /> Stock</button>}
            {canPublish && p.isActive && (p.isPublished
              ? <button className="mini-button" onClick={() => { setConfirmError(''); setConfirm({ p, action: 'unpublish' }); }} data-testid={`button-unpublish-${p.id}`}><EyeOff size={13} /> Retirar</button>
              : <button className="mini-button mini-button-blue" onClick={() => { setConfirmError(''); setConfirm({ p, action: 'publish' }); }} data-testid={`button-publish-${p.id}`}><BadgeCheck size={13} /> Aprobar</button>)}
            {canWrite && (p.isActive
              ? <button className="mini-button admin-danger" onClick={() => { setConfirmError(''); setConfirm({ p, action: 'archive' }); }} data-testid={`button-archive-product-${p.id}`}><Archive size={13} /> Archivar</button>
              : <button className="mini-button" onClick={() => { setConfirmError(''); setConfirm({ p, action: 'restore' }); }} data-testid={`button-restore-product-${p.id}`}><ArchiveRestore size={13} /> Restaurar</button>)}
          </div></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={8}><div className="empty-state"><div className="empty-icon"><Package size={20} /></div><strong>{all.length ? 'Sin coincidencias' : 'El catálogo está vacío'}</strong><p>{all.length ? 'Cambia el filtro o la búsqueda.' : 'Da de alta el primer producto; quedará pendiente de aprobación docente.'}</p></div></td></tr>}
      </tbody></table></div>}
      <div className="table-footer"><span>{rows.length} de {all.length} productos</span><button className="icon-button" aria-label="Actualizar catálogo" onClick={() => refresh()}><RefreshCw size={15} /></button></div>
    </section>
    <div className="learning-note"><CircleHelp size={17} /><div><b>Ciclo de publicación</b><p>Alta → pendiente de aprobación → publicación por profesorado o administración. Cambiar el precio o el IGIC retira automáticamente la publicación; los pedidos ya registrados conservan su precio histórico.</p></div></div>

    {editing && <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); refresh(); onNotice(m); }} />}
    {adjusting && <AdjustForm product={adjusting} onClose={() => setAdjusting(null)} onSaved={(m) => { refresh([getListFp360StockAdjustmentsQueryKey(adjusting.id) as unknown as unknown[]]); setAdjusting(null); onNotice(m); }} />}
    {history && <HistoryDialog product={history} onClose={() => setHistory(null)} />}
    {confirm && <MasterDialog title={{ archive: 'Archivar producto', restore: 'Restaurar producto', publish: 'Aprobar y publicar', unpublish: 'Retirar del mercado' }[confirm.action]} onClose={() => setConfirm(null)}>
      <div className="form-stack">
        <p className="form-intro"><b>{confirm.p.name}</b> <span className="mono">({confirm.p.sku})</span></p>
        <p className="form-intro">{{
          archive: 'Dejará de aparecer en el mercado y en los formularios de pedido. No se elimina: el historial de pedidos y facturas se conserva. No se puede archivar con unidades reservadas.',
          restore: 'Volverá a estar activo, pero sin publicar hasta que profesorado o administración lo apruebe.',
          publish: 'El producto será visible en el mercado FP360 y podrá incluirse en pedidos nuevos.',
          unpublish: 'Dejará de estar disponible para pedidos nuevos. Los pedidos existentes no cambian.',
        }[confirm.action]}</p>
        {confirm.action === 'archive' && confirm.p.reserved > 0 && <FormError text={`Hay ${confirm.p.reserved} unidades reservadas; el servidor rechazará el archivado hasta que se expidan.`} />}
        <FormError text={confirmError} />
        <div className="modal-actions"><button className="button button-quiet" onClick={() => setConfirm(null)}>Cancelar</button>
          <button className={confirm.action === 'archive' ? 'button admin-danger-button' : 'button button-primary'} disabled={update.isPending} onClick={runConfirm} data-testid="button-confirm-product-action">{update.isPending ? 'Guardando…' : 'Confirmar'}</button></div>
      </div>
    </MasterDialog>}
  </main>;
}

function ProductForm({ product, onClose, onSaved }: { product: Fp360Product | null; onClose: () => void; onSaved: (m: string) => void }) {
  const create = useCreateFp360Product();
  const update = useUpdateFp360Product();
  const [f, setF] = useState({
    sku: product?.sku ?? '', name: product?.name ?? '', category: product?.category ?? '',
    price: product ? centsToEuros(product.unitPriceCents) : '', cost: product ? centsToEuros(product.costCents) : '0.00',
    igic: product ? basisToPercent(product.igicBasisPoints) : '7', stock: '0', minimum: String(product?.minimumStock ?? 0),
  });
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const price = eurosToCents(f.price); const cost = eurosToCents(f.cost); const igic = percentToBasis(f.igic);
  const priceTaxChange = !!product && product.isPublished && (price !== product.unitPriceCents || igic !== product.igicBasisPoints);
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    const sku = f.sku.trim(); const name = f.name.trim(); const category = f.category.trim();
    if (!sku || !name || !category) return setError('SKU, nombre y categoría no pueden quedar vacíos.');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sku)) return setError('El SKU solo admite letras, números, punto, guion y guion bajo, y debe empezar por letra o número.');
    if (price === null || cost === null) return setError('Introduce importes en euros con hasta dos decimales (máx. 1.000.000 €).');
    if (igic === null) return setError('El IGIC debe estar entre 0 y 100 % con hasta dos decimales.');
    const minimumStock = Number(f.minimum);
    if (!Number.isInteger(minimumStock) || minimumStock < 0 || minimumStock > 1000000) return setError('El stock mínimo debe ser un entero entre 0 y 1.000.000.');
    if (!product) {
      const stock = Number(f.stock);
      if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) return setError('El stock inicial debe ser un entero entre 0 y 1.000.000.');
      create.mutate({ data: { sku, name, category, unitPriceCents: price, costCents: cost, igicBasisPoints: igic, stock, minimumStock } }, {
        onSuccess: (p) => onSaved(`${p.name} creado. Queda pendiente de aprobación docente para publicarse.`),
        onError: (err) => setError(apiErrorMessage(err, 'No se pudo crear el producto.')),
      });
    } else {
      const data: Fp360ProductUpdate = {};
      if (sku !== product.sku) data.sku = sku;
      if (name !== product.name) data.name = name;
      if (category !== product.category) data.category = category;
      if (price !== product.unitPriceCents) data.unitPriceCents = price;
      if (cost !== product.costCents) data.costCents = cost;
      if (igic !== product.igicBasisPoints) data.igicBasisPoints = igic;
      if (minimumStock !== product.minimumStock) data.minimumStock = minimumStock;
      if (!Object.keys(data).length) return onClose();
      update.mutate({ id: product.id, data }, {
        onSuccess: (p) => onSaved(p.isPublished || !priceTaxChange ? `Cambios guardados en ${p.name}.` : `Cambios guardados. ${p.name} se ha retirado del mercado hasta nueva aprobación.`),
        onError: (err) => setError(apiErrorMessage(err, 'No se pudieron guardar los cambios.')),
      });
    }
  };
  const pending = create.isPending || update.isPending;
  return <MasterDialog title={product ? `Editar ${product.name}` : 'Nuevo producto de inventario'} onClose={onClose} wide>
    <form className="form-stack" onSubmit={submit} noValidate>
      {!product && <p className="form-intro">El producto se crea activo y <b>sin publicar</b>. Profesorado o administración debe aprobarlo para que aparezca en el mercado.</p>}
      <div className="md-grid">
        <label>SKU<input required maxLength={40} value={f.sku} onChange={set('sku')} className="mono" data-testid="input-product-sku" /></label>
        <label>Categoría<input required maxLength={100} value={f.category} onChange={set('category')} data-testid="input-product-category" /></label>
        <label className="md-span">Nombre<input required maxLength={150} value={f.name} onChange={set('name')} data-testid="input-product-name" /></label>
        <label>Precio de venta (€, sin IGIC)<input inputMode="decimal" required value={f.price} onChange={set('price')} data-testid="input-product-price" /></label>
        <label>IGIC (%)<input inputMode="decimal" required value={f.igic} onChange={set('igic')} data-testid="input-product-igic" /></label>
        <label>Coste unitario (€)<input inputMode="decimal" value={f.cost} onChange={set('cost')} data-testid="input-product-cost" /></label>
        <label>Stock mínimo<input type="number" min={0} max={1000000} step={1} value={f.minimum} onChange={set('minimum')} data-testid="input-product-minimum" /></label>
        {!product && <label>Stock inicial<input type="number" min={0} max={1000000} step={1} value={f.stock} onChange={set('stock')} data-testid="input-product-stock" /></label>}
      </div>
      {product && <p className="field-hint">El stock no se edita aquí: usa «Stock» para registrar un ajuste manual con motivo.</p>}
      {priceTaxChange && <div className="auth-disabled" role="status"><EyeOff size={16} /><div><strong>Se retirará del mercado</strong><p>Cambiar precio o IGIC despublica el producto hasta nueva aprobación. Los pedidos existentes mantienen su precio.</p></div></div>}
      <FormError text={error} />
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={pending} data-testid="button-save-product">{pending ? 'Guardando…' : product ? 'Guardar cambios' : 'Crear producto'}</button></div>
    </form>
  </MasterDialog>;
}

function AdjustForm({ product, onClose, onSaved }: { product: Fp360Product; onClose: () => void; onSaved: (m: string) => void }) {
  const adjust = useAdjustFp360Stock();
  const [operationId] = useState(() => crypto.randomUUID());
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const n = Number(delta);
  const valid = delta.trim() !== '' && Number.isInteger(n) && n !== 0 && Math.abs(n) <= 1000000;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    if (adjust.isPending) return;
    if (!valid) return setError('Indica un número entero distinto de cero (positivo entrada, negativo salida).');
    const r = reason.trim();
    if (r.length < 5 || r.length > 500) return setError('El motivo debe tener entre 5 y 500 caracteres.');
    if (product.stock + n < product.reserved) return setError(`El stock resultante no puede quedar por debajo de las ${product.reserved} unidades reservadas.`);
    adjust.mutate({ id: product.id, data: { operationId, quantityDelta: n, reason: r } }, {
      onSuccess: () => onSaved(`Ajuste manual registrado en ${product.name} (${n > 0 ? '+' : ''}${n} ud.).`),
      onError: (err) => setError(apiErrorMessage(err, 'No se pudo registrar el ajuste.')),
    });
  };
  return <MasterDialog title={`Ajuste manual · ${product.name}`} onClose={onClose}>
    <form className="form-stack" onSubmit={submit} noValidate>
      <div className="md-stockline"><div><span>En almacén</span><b>{product.stock}</b></div><div><span>Reservado</span><b>{product.reserved}</b></div><div><span>Resultado</span><b data-testid="text-adjust-result">{valid ? product.stock + n : '—'}</b></div></div>
      <label>Variación de unidades (+ / −)<input type="number" step={1} value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="Ej. 12 o -3" data-testid="input-adjust-delta" /></label>
      <label>Motivo<textarea className="md-textarea" minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recuento de inventario, rotura, recepción…" data-testid="input-adjust-reason" /></label>
      <FormError text={error} />
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={adjust.isPending} data-testid="button-save-adjust">{adjust.isPending ? 'Registrando…' : 'Registrar ajuste'}</button></div>
    </form>
  </MasterDialog>;
}

function HistoryDialog({ product, onClose }: { product: Fp360Product; onClose: () => void }) {
  const q = useListFp360StockAdjustments(product.id, { query: { enabled: !!product.id, queryKey: getListFp360StockAdjustmentsQueryKey(product.id) } });
  return <MasterDialog title={`Ajustes manuales · ${product.name}`} onClose={onClose} wide>
    <div className="form-stack">
      <p className="form-intro">Se muestran los <b>ajustes manuales y las existencias iniciales</b> registradas al crear la referencia. No es el libro completo de movimientos: las expediciones de pedidos no aparecen aquí.</p>
      {q.isLoading && <div className="skeleton-list"><span /><span /></div>}
      {q.isError && <div className="inline-error" role="alert"><CircleHelp size={16} /><span>No se pudo cargar el historial.</span><button className="text-button" onClick={() => void q.refetch()}>Reintentar</button></div>}
      {q.data && (q.data.length ? <ol className="md-history">{q.data.map((a) => <li key={a.id} data-testid={`row-adjustment-${a.id}`}>
        <span className={a.quantityDelta > 0 ? 'md-delta md-delta-in' : 'md-delta md-delta-out'}>{a.quantityDelta > 0 ? '+' : ''}{a.quantityDelta}</span>
        <div><b>{a.reason}</b><small>{a.stockBefore} → {a.stockAfter} ud. · {a.actorName}</small></div>
        <time>{dt(a.simulatedDate)}</time>
      </li>)}</ol> : <div className="empty-state"><div className="empty-icon"><History size={20} /></div><strong>Sin ajustes manuales</strong><p>Este producto no tiene correcciones manuales registradas.</p></div>)}
    </div>
  </MasterDialog>;
}

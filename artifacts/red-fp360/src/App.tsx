import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Archive, ArrowDownLeft, ArrowRight, BadgeCheck, Banknote, BarChart3, Bell,
  BookOpen, Boxes, Building2, Check, CheckCircle2, ChevronDown, CircleHelp, ClipboardList,
  Clock3, CreditCard, Download, FileArchive, FileCheck2, FileText, Filter, Globe2,
  GraduationCap, LayoutDashboard, LifeBuoy, Menu, Package, PackageCheck, Plus,
  ReceiptText, RefreshCw, Search, ShieldAlert, ShoppingBag, ShoppingCart, Truck, Users, X, CircleAlert,
} from 'lucide-react';
import {
  getGetFp360DashboardQueryKey, useConfirmFp360Order, useCreateFp360Order,
  useDispatchFp360Order, useGetFp360Dashboard, useIssueFp360Invoice,
  useListFp360Activity, useListFp360Invoices, useListFp360Orders,
  useListFp360Organizations, useListFp360Products, useRecordFp360Payment,
  getGetAuthStatusQueryKey, getGetCurrentIdentityQueryKey, useGetAuthStatus,
  useGetCurrentIdentity, useLogout,
} from '@workspace/api-client-react';
import type {
  AuthIdentity,
  Fp360Activity,
  Fp360Dashboard,
  Fp360Invoice,
  Fp360Order,
  Fp360Organization,
  Fp360Product,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter, Link } from 'wouter';
import { AuthExperience } from '@/components/auth-experience';

const queryClient = new QueryClient();
type Product = Fp360Product;
type Organization = Fp360Organization;
type Order = Fp360Order;
type Invoice = Fp360Invoice;
type ActivityItem = Fp360Activity;
type Dashboard = Fp360Dashboard;
type DataState = { loading?: boolean; error?: boolean; retry?: () => void };

const appModules = [
  'Dirección y cuadro de mando', 'CRM y contactos', 'Ventas y facturación',
  'Compras y aprovisionamiento', 'Productos y servicios', 'Almacén e inventario',
  'Logística y distribución', 'Contabilidad', 'Tesorería', 'Recursos humanos',
  'Nóminas', 'Atención al cliente', 'Proyectos y servicios', 'Gestión documental',
  'Mercado FP360', 'Banco FP360', 'Hacienda FP360', 'Seguridad Social FP360',
  'Empleo FP360', 'Centro de comunicaciones', 'FP360 SIM — Dirección inteligente',
  'Portafolio profesional', 'Evaluación docente', 'Mentoría empresarial',
  'Coordinación intercentros', 'Administración del sistema',
];
const implemented = new Set([1, 2, 3, 5, 6, 15]);
const navItems = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/mercado', label: 'Mercado', icon: Globe2 },
  { href: '/ventas', label: 'Ventas', icon: ShoppingCart },
  { href: '/almacen', label: 'Almacén', icon: Boxes },
  { href: '/facturas', label: 'Facturas', icon: ReceiptText },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/aplicaciones', label: 'Aplicaciones', icon: Package },
  { href: '/documentacion', label: 'Documentación', icon: BookOpen },
];
const titles: Record<string, { title: string; kicker: string; description: string }> = {
  '/': { title: 'Cuadro de mando', kicker: 'DIRECCIÓN · VISTA GENERAL', description: 'Actividad comercial de la empresa simulada y operaciones recientes de la red.' },
  '/mercado': { title: 'Mercado FP360', kicker: 'RED INTERCENTROS · B2B', description: 'Empresas y catálogo comercial de la economía educativa canaria.' },
  '/ventas': { title: 'Ventas', kicker: 'CICLO COMERCIAL · OPERACIONES', description: 'Crea pedidos, confirma reservas y registra expediciones simuladas.' },
  '/almacen': { title: 'Almacén', kicker: 'EXISTENCIAS · CONTROL', description: 'Consulta stock físico, reservas y disponibilidad comercial.' },
  '/facturas': { title: 'Facturación', kicker: 'DOCUMENTOS · COBROS', description: 'Emite facturas y registra pagos en el circuito de prácticas.' },
  '/clientes': { title: 'Directorio de organizaciones', kicker: 'CRM · RED FP360', description: 'Empresas simuladas, centros participantes y relaciones de la red.' },
  '/aplicaciones': { title: 'Aplicaciones', kicker: 'PLATAFORMA · 26 MÓDULOS', description: 'Catálogo de capacidades previstas y módulos conectados en esta demostración.' },
  '/documentacion': { title: 'Documentación', kicker: 'CENTRO DE RECURSOS', description: 'Especificación funcional, referencias visuales y materiales del proyecto.' },
};

function money(cents?: number) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);
}
function dateLabel(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}
function statusLabel(status?: string) {
  const names: Record<string, string> = {
    draft: 'Borrador', confirmed: 'Confirmado', partial: 'Parcial', delivered: 'Entregado',
    invoiced: 'Facturado', paid: 'Pagado', outstanding: 'Pendiente de cobro',
  };
  return names[status ?? ''] ?? status ?? 'Sin estado';
}
function Status({ status }: { status?: string }) {
  const cls = status === 'paid' || status === 'delivered' ? 'status status-green' :
    status === 'draft' || status === 'outstanding' ? 'status status-amber' :
      status === 'partial' ? 'status status-teal' : 'status status-blue';
  return <span className={cls}><span className="status-dot" aria-hidden="true" />{statusLabel(status)}</span>;
}
function SectionTitle({ title, subtitle, aside }: { title: string; subtitle?: string; aside?: ReactNode }) {
  return <div className="section-title"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{aside}</div>;
}
function EmptyState({ title, detail, icon: Icon = ClipboardList }: { title: string; detail: string; icon?: typeof ClipboardList }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={20} /></div><strong>{title}</strong><p>{detail}</p></div>;
}
function LoadingRows() {
  return <div className="skeleton-list" aria-label="Cargando"><span /><span /><span /></div>;
}
function DataMessage({ state }: { state: DataState }) {
  if (state.loading) return <LoadingRows />;
  if (state.error) return <div className="inline-error"><ShieldAlert size={18} /><span>No se han podido cargar estos datos.</span><button className="text-button" onClick={state.retry}>Reintentar</button></div>;
  return null;
}
function SimulationNotice({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? 'simulation-note simulation-note-compact' : 'simulation-note'}>
    <span className="sim-mark"><ShieldAlert size={15} /></span>
    <span><b>Entorno educativo simulado</b>{compact ? ' · Sin operaciones reales.' : ' · Empresas, importes, IGIC, banca y organismos públicos son ficticios. Sin operaciones reales ni autenticación de producción.'}</span>
  </div>;
}
function Metric({ label, value, hint, icon: Icon, accent = 'blue' }: { label: string; value: string; hint: string; icon: typeof BarChart3; accent?: string }) {
  return <article className={`metric-card metric-${accent}`}><div className="metric-icon"><Icon size={18} /></div><p>{label}</p><strong>{value}</strong><span>{hint}</span></article>;
}
function PageHeading({ path, children }: { path: string; children?: ReactNode }) {
  const info = titles[path] ?? titles['/'];
  return <div className="page-heading page-enter"><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>{info.kicker}</span></div>
    <div className="heading-row"><div><h1>{info.title}</h1><p>{info.description}</p></div>{children}</div>
  </div>;
}
function DataTable({ children, minWidth = 650 }: { children: ReactNode; minWidth?: number }) {
  return <div className="table-scroll redfp-scroll"><table style={{ minWidth }}>{children}</table></div>;
}
function ToastMessage({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return <div className="toast-message" role="status"><CheckCircle2 size={17} /><span>{message}</span><button onClick={onClose} aria-label="Cerrar aviso"><X size={16} /></button></div>;
}
function clearBusinessCache() {
  void queryClient.removeQueries({ predicate: (query) => {
    const key = query.queryKey[0];
    return key !== getGetAuthStatusQueryKey()[0] && key !== getGetCurrentIdentityQueryKey()[0];
  } });
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="modal-head"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={18} /></button></div>
      {children}
    </section>
  </div>;
}
function TableEmpty({ colSpan, title, detail }: { colSpan: number; title: string; detail: string }) {
  return <tr><td colSpan={colSpan}><EmptyState title={title} detail={detail} /></td></tr>;
}

function DashboardPage({ dashboard, activity, products, orders, states }: {
  dashboard?: Dashboard;
  activity?: ActivityItem[]; products?: Product[]; orders?: Order[];
  states: { dashboard: DataState; activity: DataState; products: DataState; orders: DataState };
}) {
  const activityList = activity ?? dashboard?.recentActivity ?? [];
  return <main className="page-content">
    <PageHeading path="/" />
    <SimulationNotice />
    <div className="metrics-grid">
      <Metric label="Ventas simuladas" value={dashboard ? money(dashboard.salesCents) : '—'} hint="Acumulado del escenario" icon={BarChart3} />
      <Metric label="Pendiente de cobro" value={dashboard ? money(dashboard.outstandingCents) : '—'} hint={`${dashboard?.invoicesDue ?? '—'} facturas abiertas`} icon={ArrowDownLeft} accent="teal" />
      <Metric label="Pedidos abiertos" value={String(dashboard?.openOrders ?? '—')} hint={`${dashboard?.orderCount ?? '—'} operaciones registradas`} icon={ShoppingBag} accent="amber" />
      <Metric label="Referencias" value={String(dashboard?.productCount ?? products?.length ?? '—')} hint="Catálogo activo" icon={PackageCheck} accent="green" />
    </div>
    {states.dashboard.error && <DataMessage state={states.dashboard} />}
    <div className="dashboard-columns">
      <section className="panel activity-panel">
        <SectionTitle title="Actividad reciente" subtitle="Trazabilidad de operaciones en la empresa simulada" aside={<Link href="/ventas" className="subtle-link">Ver ventas <ArrowRight size={14} /></Link>} />
        <DataMessage state={states.activity} />
        {!states.activity.loading && !states.activity.error && (activityList.length ? <div className="activity-list">
          {activityList.slice(0, 7).map((item) => <article className="activity-item" key={item.id} data-testid={`activity-${item.id}`}>
            <div className="activity-symbol"><Activity size={16} /></div><div className="activity-copy"><strong>{item.action}</strong><p>{item.description}</p><span className="activity-meta">{item.reference}</span></div>
            <span className="activity-time">{dateLabel(item.simulatedDate)}</span>
          </article>)}
        </div> : <EmptyState title="Aún no hay movimientos" detail="Las operaciones registradas aparecerán aquí con su referencia y fecha simulada." icon={Activity} />)}
      </section>
      <aside className="dashboard-aside">
        <section className="panel">
          <SectionTitle title="Accesos de trabajo" subtitle="Continúa una tarea frecuente" />
          <div className="quick-actions">
            <Link href="/ventas" className="quick-action"><span className="quick-icon"><Plus size={17} /></span><span><b>Crear pedido</b><small>Registrar una venta simulada</small></span><ArrowRight size={15} /></Link>
            <Link href="/almacen" className="quick-action"><span className="quick-icon aqua"><Boxes size={17} /></span><span><b>Revisar existencias</b><small>Consultar stock y reservas</small></span><ArrowRight size={15} /></Link>
            <Link href="/facturas" className="quick-action"><span className="quick-icon green"><ReceiptText size={17} /></span><span><b>Gestionar facturas</b><small>Emitir y registrar cobros</small></span><ArrowRight size={15} /></Link>
          </div>
        </section>
        <section className="network-card">
          <div className="network-graphic" aria-hidden="true"><span /><span /><span /><span /><i /></div>
          <div className="network-label">RED EDUCATIVA · CANARIAS</div>
          <h3>Empresas que aprenden<br />haciendo.</h3>
          <p>Una red de organizaciones ficticias para practicar procesos empresariales de principio a fin.</p>
          <Link href="/mercado" className="network-link">Explorar mercado <ArrowRight size={15} /></Link>
        </section>
      </aside>
    </div>
  </main>;
}

function MarketPage({ organizations, products, stateOrg, stateProducts }: {
  organizations?: Organization[]; products?: Product[]; stateOrg: DataState; stateProducts: DataState;
}) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'products' | 'partners'>('products');
  const matchedOrgs = (organizations ?? []).filter((org) => `${org.name} ${org.center} ${org.island} ${org.role}`.toLowerCase().includes(search.toLowerCase()));
  const matchedProducts = (products ?? []).filter((product) => `${product.name} ${product.category} ${product.sku}`.toLowerCase().includes(search.toLowerCase()));
  return <main className="page-content">
    <PageHeading path="/mercado"><Link className="button button-primary" href="/ventas"><ShoppingCart size={16} /> Nuevo pedido</Link></PageHeading>
    <SimulationNotice />
    <div className="market-banner"><div className="market-banner-mark"><Globe2 size={22} /></div><div><strong>Una red comercial entre centros de FP</strong><p>Busca empresas proveedoras y productos publicados en el mercado de prácticas.</p></div><span className="banner-count">{organizations?.length ?? '—'} organizaciones</span></div>
    <section className="panel">
      <div className="list-toolbar">
        <div className="tabs" role="tablist" aria-label="Contenido del mercado">
          <button className={tab === 'products' ? 'tab-active' : ''} onClick={() => setTab('products')} role="tab" aria-selected={tab === 'products'}><Package size={15} /> Productos</button>
          <button className={tab === 'partners' ? 'tab-active' : ''} onClick={() => setTab('partners')} role="tab" aria-selected={tab === 'partners'}><Building2 size={15} /> Organizaciones</button>
        </div>
        <label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tab === 'products' ? 'Buscar productos o referencias' : 'Buscar empresa, centro o isla'} aria-label="Buscar en mercado" data-testid="input-market-search" /><kbd>⌘ K</kbd></label>
      </div>
      {tab === 'products' ? <>
        <DataMessage state={stateProducts} />
        <DataTable minWidth={700}><thead><tr><th>Producto</th><th>Referencia</th><th>Categoría</th><th>Stock disponible</th><th>Precio unitario</th><th></th></tr></thead><tbody>
          {!stateProducts.loading && !stateProducts.error && matchedProducts.map((product) => <tr key={product.id} data-testid={`row-market-product-${product.id}`}>
            <td><div className="product-cell"><span className="product-glyph"><Package size={17} /></span><span><b>{product.name}</b><small>Publicado para la red FP360</small></span></div></td><td className="mono">{product.sku}</td><td>{product.category}</td><td><span className="stock-value">{Math.max(0, product.stock - product.reserved)}</span><small className="table-secondary"> ud. disponibles</small></td><td className="price-cell">{money(product.unitPriceCents)}</td><td><Link href="/ventas" className="row-link">Solicitar <ArrowRight size={14} /></Link></td>
          </tr>)}
          {!stateProducts.loading && !stateProducts.error && matchedProducts.length === 0 && <TableEmpty colSpan={6} title="No encontramos productos" detail="Prueba con otra búsqueda o revisa el catálogo más adelante." />}
        </tbody></DataTable>
      </> : <>
        <DataMessage state={stateOrg} />
        <DataTable minWidth={700}><thead><tr><th>Organización</th><th>Centro educativo</th><th>Isla</th><th>Participación</th><th></th></tr></thead><tbody>
          {!stateOrg.loading && !stateOrg.error && matchedOrgs.map((org) => <tr key={org.id} data-testid={`row-market-org-${org.id}`}><td><div className="org-cell"><span className="org-avatar">{org.name.slice(0, 2).toUpperCase()}</span><b>{org.name}</b></div></td><td>{org.center}</td><td>{org.island}</td><td><span className="role-pill">{org.role === 'both' ? 'Compra y vende' : org.role === 'seller' ? 'Vende' : 'Compra'}</span></td><td><Link href="/clientes" className="row-link">Ver ficha <ArrowRight size={14} /></Link></td></tr>)}
          {!stateOrg.loading && !stateOrg.error && matchedOrgs.length === 0 && <TableEmpty colSpan={5} title="Sin organizaciones coincidentes" detail="Ajusta la búsqueda para explorar la red." />}
        </tbody></DataTable>
      </>}
      <div className="table-footer"><span>{tab === 'products' ? matchedProducts.length : matchedOrgs.length} resultados</span><span className="footer-simulation"><ShieldAlert size={13} /> Mercado exclusivamente simulado</span></div>
    </section>
  </main>;
}

function SalesPage({ products, organizations, orders, states, onRefresh, onNotice }: {
  products?: Product[]; organizations?: Organization[]; orders?: Order[];
  states: { products: DataState; organizations: DataState; orders: DataState };
  onRefresh: () => void; onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const orderQuery = useListFp360Orders<Order[]>();
  const productsQuery = useListFp360Products<Product[]>();
  const confirmOrder = useConfirmFp360Order();
  const dispatchOrder = useDispatchFp360Order();
  const createOrder = useCreateFp360Order();
  const [newOrder, setNewOrder] = useState(false);
  const [dispatching, setDispatching] = useState<Order | null>(null);
  const [buyerId, setBuyerId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [dispatchQuantity, setDispatchQuantity] = useState(1);
  const buyers = (organizations ?? []).filter((org) => org.role === 'buyer' || org.role === 'both');
  const selectedProduct = products?.find((p) => p.id === productId);
  const refreshOrders = () => { void queryClient.invalidateQueries({ queryKey: orderQuery.queryKey }); onRefresh(); };
  const submitOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!buyerId || !productId || quantity < 1) return;
    createOrder.mutate({ data: { buyerOrganizationId: buyerId, lines: [{ productId, quantity }] } }, {
      onSuccess: () => { setNewOrder(false); setBuyerId(''); setProductId(''); setQuantity(1); refreshOrders(); onNotice('Pedido simulado creado como borrador.'); },
      onError: () => onNotice('No se pudo crear el pedido. Revisa los datos e inténtalo de nuevo.'),
    });
  };
  const confirm = (order: Order) => confirmOrder.mutate({ id: order.id }, {
    onSuccess: () => { refreshOrders(); void queryClient.invalidateQueries({ queryKey: productsQuery.queryKey }); onNotice(`Pedido ${order.reference} confirmado; las unidades quedan reservadas.`); },
    onError: () => onNotice('No se pudo confirmar el pedido. Comprueba la disponibilidad.'),
  });
  const openDispatch = (order: Order) => {
    setDispatching(order);
    setDispatchQuantity(Math.max(1, order.lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0)));
  };
  const dispatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dispatching) return;
    const line = dispatching.lines.find((item) => item.quantity > item.shippedQuantity);
    if (!line) return;
    const remaining = line.quantity - line.shippedQuantity;
    const shipQty = Math.min(Math.max(1, dispatchQuantity), remaining);
    dispatchOrder.mutate({ id: dispatching.id, data: { lines: [{ productId: line.productId, quantity: shipQty }] } }, {
      onSuccess: () => { setDispatching(null); refreshOrders(); void queryClient.invalidateQueries({ queryKey: productsQuery.queryKey }); onNotice('Expedición simulada registrada.'); },
      onError: () => onNotice('No se pudo registrar la expedición. Revisa las unidades pendientes.'),
    });
  };
  const actionable = orders ?? [];
  return <main className="page-content">
    <PageHeading path="/ventas"><button className="button button-primary" onClick={() => setNewOrder(true)} data-testid="button-create-order"><Plus size={16} /> Crear pedido</button></PageHeading>
    <SimulationNotice />
    <div className="sub-metrics">
      <div><span>Pedidos del escenario</span><b>{orders?.length ?? '—'}</b><small>Historial de venta</small></div>
      <div><span>Pendientes de confirmar</span><b>{actionable.filter((o) => o.status === 'draft').length}</b><small>Requieren validación comercial</small></div>
      <div><span>En preparación o envío</span><b>{actionable.filter((o) => o.status === 'confirmed' || o.status === 'partial').length}</b><small>Reserva y expedición</small></div>
    </div>
    <section className="panel">
      <SectionTitle title="Pedidos" subtitle="Confirma el pedido para reservar stock; expide cuando esté preparado." aside={<button className="icon-button" aria-label="Actualizar pedidos" onClick={refreshOrders}><RefreshCw size={16} /></button>} />
      <DataMessage state={states.orders} />
      <DataTable minWidth={780}><thead><tr><th>Referencia</th><th>Empresa compradora</th><th>Fecha simulada</th><th>Estado</th><th>Total</th><th>Unidades</th><th>Acciones</th></tr></thead><tbody>
        {!states.orders.loading && !states.orders.error && actionable.map((order) => {
          const remaining = order.lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0);
          return <tr key={order.id} data-testid={`row-order-${order.id}`}><td><b className="mono ref">{order.reference}</b></td><td>{order.buyerName}</td><td>{dateLabel(order.simulatedDate)}</td><td><Status status={order.status} /></td><td className="price-cell">{money(order.totalCents)}</td><td>{order.lines.reduce((sum, item) => sum + item.shippedQuantity, 0)} / {order.lines.reduce((sum, item) => sum + item.quantity, 0)}</td><td><div className="row-actions">
            {order.status === 'draft' && <button className="mini-button" disabled={confirmOrder.isPending} onClick={() => confirm(order)} data-testid={`button-confirm-${order.id}`}><Check size={14} /> Confirmar</button>}
            {(order.status === 'confirmed' || order.status === 'partial') && remaining > 0 && <button className="mini-button mini-button-blue" onClick={() => openDispatch(order)} data-testid={`button-dispatch-${order.id}`}><Truck size={14} /> Expedición</button>}
            {order.status === 'delivered' && <span className="text-muted">Listo para facturar</span>}
          </div></td></tr>;
        })}
        {!states.orders.loading && !states.orders.error && !actionable.length && <TableEmpty colSpan={7} title="Todavía no hay pedidos" detail="Crea el primer pedido para iniciar el ciclo de ventas simulado." />}
      </tbody></DataTable>
    </section>
    <div className="learning-note"><CircleHelp size={17} /><div><b>Secuencia de venta</b><p>Pedido borrador → confirmación y reserva → expedición parcial o completa → factura. Los importes y movimientos de stock se calculan solo en el entorno de prácticas.</p></div></div>
    {newOrder && <Modal title="Crear pedido simulado" onClose={() => setNewOrder(false)}>
      <form className="form-stack" onSubmit={submitOrder}>
        <p className="form-intro">Selecciona una empresa de la red y una referencia disponible. Se creará un pedido en estado borrador.</p>
        <label>Empresa compradora<select required value={buyerId} onChange={(e) => setBuyerId(e.target.value)} data-testid="select-order-buyer"><option value="">Selecciona una organización</option>{buyers.map((org) => <option value={org.id} key={org.id}>{org.name} · {org.island}</option>)}</select></label>
        <label>Producto<select required value={productId} onChange={(e) => setProductId(e.target.value)} data-testid="select-order-product"><option value="">Selecciona un producto</option>{products?.map((product) => <option value={product.id} key={product.id}>{product.name} · {money(product.unitPriceCents)} · disp. {Math.max(0, product.stock - product.reserved)}</option>)}</select></label>
        <label>Unidades<input type="number" min={1} max={999} required value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} data-testid="input-order-quantity" /></label>
        {selectedProduct && <div className="calculation-box"><span>Subtotal estimado sin IGIC</span><strong>{money(selectedProduct.unitPriceCents * quantity)}</strong><small>El cálculo fiscal final se efectúa al emitir la factura simulada.</small></div>}
        {(!buyers.length || !products?.length) && <div className="inline-error"><ShieldAlert size={16} />Faltan organizaciones compradoras o productos para crear el pedido.</div>}
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setNewOrder(false)}>Cancelar</button><button className="button button-primary" disabled={createOrder.isPending || !buyers.length || !products?.length} data-testid="button-submit-order">{createOrder.isPending ? 'Guardando…' : 'Crear borrador'}</button></div>
      </form>
    </Modal>}
    {dispatching && <Modal title={`Expedir ${dispatching.reference}`} onClose={() => setDispatching(null)}>
      <form className="form-stack" onSubmit={dispatch}>
        <p className="form-intro">Registra unidades entregadas en una expedición de prácticas. Puedes completar el envío en varias partes.</p>
        <div className="dispatch-product"><PackageCheck size={18} /><div><b>{dispatching.lines.find((line) => line.quantity > line.shippedQuantity)?.productName}</b><small>Restan {dispatching.lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0)} unidades por expedir</small></div></div>
        <label>Unidades de esta expedición<input type="number" min={1} max={dispatching.lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0)} value={dispatchQuantity} onChange={(e) => setDispatchQuantity(Number(e.target.value))} required data-testid="input-dispatch-quantity" /></label>
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setDispatching(null)}>Cancelar</button><button className="button button-primary" disabled={dispatchOrder.isPending}>{dispatchOrder.isPending ? 'Registrando…' : 'Registrar expedición'}</button></div>
      </form>
    </Modal>}
  </main>;
}

function InventoryPage({ products, orders, stateProducts, stateOrders }: {
  products?: Product[]; orders?: Order[]; stateProducts: DataState; stateOrders: DataState;
}) {
  const [search, setSearch] = useState('');
  const rows = (products ?? []).filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(search.toLowerCase()));
  const totalAvailable = (products ?? []).reduce((sum, p) => sum + Math.max(0, p.stock - p.reserved), 0);
  const totalReserved = (products ?? []).reduce((sum, p) => sum + p.reserved, 0);
  return <main className="page-content">
    <PageHeading path="/almacen" />
    <SimulationNotice />
    <div className="sub-metrics">
      <div><span>Referencias catalogadas</span><b>{products?.length ?? '—'}</b><small>Artículos de la empresa</small></div>
      <div><span>Unidades disponibles</span><b>{stateProducts.loading ? '…' : totalAvailable}</b><small>Stock físico menos reservas</small></div>
      <div><span>Unidades reservadas</span><b>{stateProducts.loading ? '…' : totalReserved}</b><small>Comprometidas en pedidos</small></div>
    </div>
    <section className="panel">
      <div className="list-toolbar"><SectionTitle title="Existencias" subtitle="Stock disponible y comprometido por producto" /><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar referencia" aria-label="Buscar existencias" data-testid="input-stock-search" /></label></div>
      <DataMessage state={stateProducts} />
      <DataTable minWidth={720}><thead><tr><th>Artículo</th><th>SKU</th><th>Tipo</th><th>En almacén</th><th>Reservado</th><th>Disponible</th><th>Estado de stock</th></tr></thead><tbody>
        {!stateProducts.loading && !stateProducts.error && rows.map((p) => {
          const available = Math.max(0, p.stock - p.reserved);
          const level = available === 0 ? 'Agotado' : available <= 3 ? 'Bajo' : 'Disponible';
          return <tr key={p.id} data-testid={`row-stock-${p.id}`}><td><div className="product-cell"><span className="product-glyph"><Package size={17} /></span><b>{p.name}</b></div></td><td className="mono">{p.sku}</td><td>{p.category}</td><td className="numeric">{p.stock}</td><td className="numeric">{p.reserved}</td><td className="numeric stock-value">{available}</td><td><span className={`stock-state ${level === 'Disponible' ? 'stock-ok' : level === 'Bajo' ? 'stock-low' : 'stock-empty'}`}><span />{level}</span></td></tr>;
        })}
        {!stateProducts.loading && !stateProducts.error && rows.length === 0 && <TableEmpty colSpan={7} title="No hay artículos en este filtro" detail="Prueba otra búsqueda o consulta el catálogo del mercado." />}
      </tbody></DataTable>
    </section>
    <section className="panel compact-panel"><SectionTitle title="Pedidos pendientes de preparación" subtitle="Reservas que pueden dar lugar a una expedición parcial." aside={<Link href="/ventas" className="subtle-link">Ir a ventas <ArrowRight size={14} /></Link>} />
      <DataMessage state={stateOrders} />
      {!stateOrders.loading && !stateOrders.error && (orders ?? []).filter((order) => order.status === 'confirmed' || order.status === 'partial').length > 0 ? <div className="prep-list">{(orders ?? []).filter((order) => order.status === 'confirmed' || order.status === 'partial').map((order) => <div className="prep-row" key={order.id}><span className="prep-icon"><Truck size={16} /></span><span><b>{order.reference}</b><small>{order.buyerName} · {order.lines.reduce((a, line) => a + line.quantity - line.shippedQuantity, 0)} ud. pendientes</small></span><Status status={order.status} /></div>)}</div> : !stateOrders.loading && !stateOrders.error ? <EmptyState title="Almacén al día" detail="Los pedidos confirmados aparecerán aquí para su preparación." icon={PackageCheck} /> : null}
    </section>
  </main>;
}

function InvoicesPage({ invoices, orders, stateInvoices, stateOrders, onRefresh, onNotice }: {
  invoices?: Invoice[]; orders?: Order[]; stateInvoices: DataState; stateOrders: DataState;
  onRefresh: () => void; onNotice: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const invoiceQuery = useListFp360Invoices<Invoice[]>();
  const orderQuery = useListFp360Orders<Order[]>();
  const issueInvoice = useIssueFp360Invoice();
  const recordPayment = useRecordFp360Payment();
  const [paymentTarget, setPaymentTarget] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [tab, setTab] = useState<'all' | 'due'>('all');
  const refreshInvoices = () => { void queryClient.invalidateQueries({ queryKey: invoiceQuery.queryKey }); void queryClient.invalidateQueries({ queryKey: orderQuery.queryKey }); onRefresh(); };
  const issuable = (orders ?? []).filter((order) => order.lines.some((line) => line.shippedQuantity > line.invoicedQuantity));
  const issue = (order: Order) => issueInvoice.mutate({ data: { orderId: order.id } }, {
    onSuccess: () => { refreshInvoices(); onNotice('Factura simulada emitida a partir de las unidades expedidas.'); },
    onError: () => onNotice('No se pudo emitir la factura. Comprueba que haya unidades expedidas sin facturar.'),
  });
  const startPayment = (invoice: Invoice) => { setPaymentTarget(invoice); setPaymentAmount((invoice.balanceCents / 100).toFixed(2)); };
  const payment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentTarget) return;
    const amountCents = Math.round(Number(paymentAmount.replace(',', '.')) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > paymentTarget.balanceCents) return;
    recordPayment.mutate({ id: paymentTarget.id, data: { amountCents } }, {
      onSuccess: () => { setPaymentTarget(null); refreshInvoices(); onNotice('Cobro simulado registrado en la factura.'); },
      onError: () => onNotice('No se pudo registrar el pago. Revisa el importe pendiente.'),
    });
  };
  const shownInvoices = (invoices ?? []).filter((invoice) => tab === 'all' || invoice.balanceCents > 0);
  const outstanding = (invoices ?? []).reduce((sum, invoice) => sum + invoice.balanceCents, 0);
  return <main className="page-content">
    <PageHeading path="/facturas" />
    <SimulationNotice />
    <div className="metrics-grid invoice-metrics">
      <Metric label="Facturas emitidas" value={String(invoices?.length ?? '—')} hint="Documentos del escenario" icon={FileCheck2} />
      <Metric label="Pendiente de cobro" value={money(outstanding)} hint="Saldo abierto simulado" icon={ArrowDownLeft} accent="amber" />
      <Metric label="Cobrado" value={money((invoices ?? []).reduce((sum, i) => sum + i.paidCents, 0))} hint="Pagos registrados" icon={Banknote} accent="green" />
    </div>
    <section className="panel">
      <SectionTitle title="Emitir factura" subtitle="Solo se pueden facturar unidades ya expedidas y aún no facturadas." />
      <DataMessage state={stateOrders} />
      {!stateOrders.loading && !stateOrders.error && (issuable.length ? <div className="invoice-eligible">
        {issuable.map((order) => <div className="eligible-row" key={order.id}><span className="eligible-icon"><ReceiptText size={17} /></span><div className="eligible-copy"><b>{order.reference} <span>· {order.buyerName}</span></b><small>{order.lines.filter((line) => line.shippedQuantity > line.invoicedQuantity).map((line) => `${line.shippedQuantity - line.invoicedQuantity} × ${line.productName}`).join(', ')}</small></div><button className="button button-secondary" disabled={issueInvoice.isPending} onClick={() => issue(order)} data-testid={`button-issue-${order.id}`}><Plus size={15} /> Emitir</button></div>)}
      </div> : <div className="issuance-empty"><FileCheck2 size={19} /><span><b>No hay expediciones pendientes de facturar</b><small>Cuando un pedido se expida, podrás emitir aquí la factura correspondiente.</small></span><Link href="/ventas" className="text-button">Ver pedidos <ArrowRight size={14} /></Link></div>)}
    </section>
    <section className="panel">
      <div className="list-toolbar"><SectionTitle title="Facturas" subtitle="Documentos y pagos asociados a pedidos simulados." /><div className="tabs small-tabs"><button className={tab === 'all' ? 'tab-active' : ''} onClick={() => setTab('all')}>Todas</button><button className={tab === 'due' ? 'tab-active' : ''} onClick={() => setTab('due')}>Pendientes</button></div></div>
      <DataMessage state={stateInvoices} />
      <DataTable minWidth={800}><thead><tr><th>Factura</th><th>Empresa</th><th>Fecha simulada</th><th>Base</th><th>IGIC</th><th>Total</th><th>Saldo</th><th>Estado / acción</th></tr></thead><tbody>
        {!stateInvoices.loading && !stateInvoices.error && shownInvoices.map((invoice) => <tr key={invoice.id} data-testid={`row-invoice-${invoice.id}`}><td><b className="mono ref">{invoice.reference}</b><small className="table-secondary block">Pedido {invoice.orderId}</small></td><td>{invoice.buyerName}</td><td>{dateLabel(invoice.simulatedDate)}</td><td>{money(invoice.baseCents)}</td><td>{money(invoice.igicCents)}</td><td className="price-cell">{money(invoice.totalCents)}</td><td className={invoice.balanceCents ? 'balance-due' : 'balance-paid'}>{money(invoice.balanceCents)}</td><td><div className="invoice-action"><Status status={invoice.status} />{invoice.balanceCents > 0 && <button className="mini-button" onClick={() => startPayment(invoice)} data-testid={`button-payment-${invoice.id}`}>Registrar pago</button>}</div></td></tr>)}
        {!stateInvoices.loading && !stateInvoices.error && shownInvoices.length === 0 && <TableEmpty colSpan={8} title={tab === 'due' ? 'Sin saldos pendientes' : 'Aún no hay facturas'} detail={tab === 'due' ? 'Todas las facturas registradas están pagadas.' : 'Emite una factura tras registrar una expedición simulada.'} />}
      </tbody></DataTable>
    </section>
    <div className="learning-note"><CircleHelp size={17} /><div><b>IGIC y pagos en el escenario</b><p>Los tipos y cuotas de IGIC son datos didácticos de la ficha de producto. La factura no tiene validez fiscal y los pagos no mueven dinero real ni conectan con entidades bancarias.</p></div></div>
    {paymentTarget && <Modal title={`Registrar pago · ${paymentTarget.reference}`} onClose={() => setPaymentTarget(null)}>
      <form className="form-stack" onSubmit={payment}>
        <div className="payment-summary"><span>Saldo pendiente</span><strong>{money(paymentTarget.balanceCents)}</strong></div>
        <label>Importe del pago (EUR)<input type="number" min="0.01" step="0.01" max={(paymentTarget.balanceCents / 100).toFixed(2)} required value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} data-testid="input-payment-amount" /></label>
        <p className="field-hint">Se admite un cobro parcial. Importe máximo: {money(paymentTarget.balanceCents)}.</p>
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setPaymentTarget(null)}>Cancelar</button><button className="button button-primary" disabled={recordPayment.isPending}>{recordPayment.isPending ? 'Registrando…' : 'Registrar pago simulado'}</button></div>
      </form>
    </Modal>}
  </main>;
}

function CustomersPage({ organizations, orders, stateOrg }: { organizations?: Organization[]; orders?: Order[]; stateOrg: DataState }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const results = (organizations ?? []).filter((org) => `${org.name} ${org.center} ${org.island}`.toLowerCase().includes(search.toLowerCase()) && (role === 'all' || org.role === role));
  const ordersFor = (organization: Organization) => (orders ?? []).filter((order) => order.buyerOrganizationId === organization.id).length;
  return <main className="page-content">
    <PageHeading path="/clientes"><Link href="/mercado" className="button button-secondary"><Globe2 size={16} /> Ver mercado</Link></PageHeading>
    <SimulationNotice />
    <div className="sub-metrics">
      <div><span>Organizaciones conectadas</span><b>{organizations?.length ?? '—'}</b><small>Empresas ficticias participantes</small></div>
      <div><span>Islas representadas</span><b>{new Set((organizations ?? []).map((o) => o.island)).size || '—'}</b><small>En la red educativa</small></div>
      <div><span>Pedidos de la red</span><b>{orders?.length ?? '—'}</b><small>Relaciones con actividad comercial</small></div>
    </div>
    <section className="panel">
      <div className="list-toolbar"><SectionTitle title="Organizaciones" subtitle="Empresas simuladas vinculadas a centros de Formación Profesional." /><div className="filter-tools"><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar organización" aria-label="Buscar organizaciones" data-testid="input-org-search" /></label><label className="select-filter"><Filter size={14} /><select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filtrar por participación"><option value="all">Todas</option><option value="seller">Vendedoras</option><option value="buyer">Compradoras</option><option value="both">Ambas</option></select></label></div></div>
      <DataMessage state={stateOrg} />
      <DataTable minWidth={760}><thead><tr><th>Organización</th><th>Centro</th><th>Isla</th><th>Rol en red</th><th>Pedidos</th><th>Acción</th></tr></thead><tbody>
        {!stateOrg.loading && !stateOrg.error && results.map((org) => <tr key={org.id} data-testid={`row-org-${org.id}`}><td><div className="org-cell"><span className="org-avatar">{org.name.slice(0, 2).toUpperCase()}</span><span><b>{org.name}</b><small>Miembro de la red educativa</small></span></div></td><td>{org.center}</td><td><span className="island-label">{org.island}</span></td><td><span className="role-pill">{org.role === 'both' ? 'Compra y vende' : org.role === 'seller' ? 'Vende' : 'Compra'}</span></td><td className="numeric">{ordersFor(org)}</td><td><Link href="/mercado" className="row-link">Mercado <ArrowRight size={14} /></Link></td></tr>)}
        {!stateOrg.loading && !stateOrg.error && !results.length && <TableEmpty colSpan={6} title="No hay resultados" detail="Modifica el filtro o busca por centro o isla." />}
      </tbody></DataTable>
      <div className="table-footer"><span>{results.length} organizaciones</span><span className="footer-simulation"><ShieldAlert size={13} /> Directorio de demostración</span></div>
    </section>
  </main>;
}

function ApplicationsPage() {
  const [search, setSearch] = useState('');
  const filtered = appModules.map((name, index) => ({ name, id: index + 1 })).filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));
  return <main className="page-content">
    <PageHeading path="/aplicaciones" />
    <SimulationNotice />
    <div className="catalog-intro"><div className="catalog-orbit"><GraduationCap size={28} /></div><div><div className="catalog-kicker">MAPA DE CAPACIDADES · CURSO 2027—2028</div><h2>26 aplicaciones.<br /><span>Una empresa de aprendizaje.</span></h2><p>La visión funcional de RED FP360 cubre el ciclo empresarial completo. Solo las capacidades conectadas a los servicios disponibles están marcadas como disponibles en esta demo.</p></div><div className="catalog-stat"><b>06</b><span>disponibles<br />en la demo</span></div></div>
    <div className="catalog-toolbar"><div><h2>Catálogo de aplicaciones</h2><p>Estado funcional actual de cada módulo de acuerdo con esta demostración.</p></div><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar módulo" aria-label="Buscar módulos" data-testid="input-modules-search" /></label></div>
    <div className="module-list">{filtered.map(({ name, id }) => {
      const available = implemented.has(id);
      const icon = id === 1 ? LayoutDashboard : id === 2 ? Users : id === 3 ? ShoppingCart : id === 5 ? Package : id === 6 ? Boxes : id === 15 ? Globe2 : id === 16 ? CreditCard : id === 17 ? FileCheck2 : id === 18 ? Building2 : id >= 21 ? GraduationCap : ClipboardList;
      const Icon = icon;
      return <article className={`module-row ${available ? 'module-live' : ''}`} key={id} data-testid={`module-${id}`}>
        <span className="module-number">{String(id).padStart(2, '0')}</span><span className="module-icon"><Icon size={18} /></span><div className="module-copy"><b>{name}</b><small>{available ? 'Conectado a datos y operaciones simuladas' : 'Definición funcional del catálogo; aún no disponible'}</small></div>
        <span className={available ? 'module-status module-available' : 'module-status module-planned'}><span />{available ? 'Disponible en demo' : 'Planificada'}</span>
        {available ? <span className="module-arrow"><CheckCircle2 size={17} /></span> : <span className="module-arrow muted"><Clock3 size={16} /></span>}
      </article>;
    })}</div>
    <div className="catalog-footnote"><ShieldAlert size={16} /><span>“Disponible en demo” identifica pantallas y funciones enlazadas a las API suministradas. “Planificada” es una especificación futura, no una funcionalidad activa.</span></div>
  </main>;
}

const referenceMockups = [
  ['Dirección y cuadro de mando', '01-direccion-y-cuadro-de-mando'],
  ['CRM y contactos', '02-crm-y-contactos'],
  ['Ventas y facturación', '03-ventas-y-facturacion'],
  ['Compras y aprovisionamiento', '04-compras-y-aprovisionamiento'],
  ['Productos y servicios', '05-productos-y-servicios'],
  ['Almacén e inventario', '06-almacen-e-inventario'],
  ['Logística y distribución', '07-logistica-y-distribucion'],
  ['Contabilidad', '08-contabilidad'],
  ['Tesorería', '09-tesoreria'],
  ['Recursos humanos', '10-recursos-humanos'],
  ['Nóminas', '11-nominas'],
  ['Atención al cliente', '12-atencion-al-cliente'],
  ['Proyectos y servicios', '13-proyectos-y-servicios'],
  ['Gestión documental', '14-gestion-documental'],
  ['Mercado FP360', '15-mercado-fp360'],
  ['Banco FP360', '16-banco-fp360'],
  ['Hacienda FP360', '17-hacienda-fp360'],
  ['Seguridad Social FP360', '18-seguridad-social-fp360'],
  ['Empleo FP360', '19-empleo-fp360'],
  ['Comunicaciones', '20-comunicaciones'],
  ['FP360 SIM — Dirección inteligente', '21-fp360-sim--direccion-inteligente'],
  ['Portafolio profesional', '22-portafolio-profesional'],
  ['Evaluación docente', '23-evaluacion-docente'],
  ['Mentoría empresarial', '24-mentoria-empresarial'],
  ['Coordinación intercentros', '25-coordinacion-intercentros'],
  ['Administración del sistema', '26-administracion-del-sistema'],
] as const;

function ReferenceWireframe({ title, slug }: { title: string; slug: string }) {
  return <img
    className="reference-preview"
    src={`https://redfp360.net/assets/mockups/${slug}.webp`}
    alt={`Maqueta original de referencia: ${title}`}
    loading="lazy"
    width={1920}
    height={1080}
  />;
}
function DocumentationPage() {
  const [expanded, setExpanded] = useState<number | null>(null);
  const resourceCards = [
    { icon: FileArchive, title: 'Paquete funcional completo', kind: 'ZIP · DOSSIERS Y CATÁLOGO', text: 'Dossieres funcionales de 26 aplicaciones, guía maestra, catálogo y referencias visuales originales.', action: 'Ver contenido', body: 'El paquete fuente adjunto contiene los 26 dossieres funcionales en formato Word, las instrucciones para Replit, el sistema de diseño visual, el catálogo JSON y las maquetas PNG de referencia. Las especificaciones describen una visión futura; no certifican que los módulos estén implementados.' },
    { icon: FileText, title: 'Documento funcional', kind: 'LECTURA · PDF / IMPRESIÓN', text: 'Resumen de alcance, criterios de diseño y reglas de uso pedagógico de RED FP360.', action: 'Preparar PDF', body: 'Resumen de la guía maestra: interfaz de empresa simulada, organizaciones multi-centro, trazabilidad de procesos, reglas deterministas y estados visibles. Banco, Hacienda, Seguridad Social, empleo, pagos e IGIC son simulaciones didácticas. Usa “Imprimir / Guardar como PDF” en el diálogo del navegador para conservar esta vista.' },
    { icon: LayoutDashboard, title: 'Maquetas de referencia', kind: '26 VISTAS · 1920 × 1080', text: 'Modelos conceptuales para orientar las aplicaciones; no son pantallas operativas.', action: 'Consultar maquetas', body: 'Las referencias aprobadas presentan una barra lateral, cabecera de empresa, indicadores, filtros, tablas y panel contextual. Esta interfaz recrea patrones y jerarquía con componentes web reales; las imágenes de referencia no se utilizan como pantallas funcionales.' },
  ];
  const downloadOutline = () => {
    const text = `RED FP360 · Documento de alcance\\n\\nEmpresa simulada para la Formación Profesional canaria.\\n\\nIncluye: 26 módulos previstos; catálogo y operaciones de demo enlazadas a servicios API; pedidos, reservas, expediciones, facturas e importes de IGIC de práctica.\\n\\nAviso: Los datos, interacciones con bancos y organismos públicos, pagos, autenticación de personas demo y actividad empresarial son simulados. No realizar trámites reales.\\n\\nFuente funcional adjunta: RED_FP360_DOCUMENTACION_FUNCIONAL_COMPLETA_26_APLICACIONES.zip`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'RED-FP360-resumen-funcional.txt'; link.click(); URL.revokeObjectURL(url);
  };
  return <main className="page-content">
    <PageHeading path="/documentacion" />
    <SimulationNotice />
    <div className="docs-intro"><div className="docs-emblem"><BookOpen size={24} /></div><div><div className="catalog-kicker">BIBLIOTECA DEL PROYECTO</div><h2>Especificación y referencias<br /><span>para construir con contexto.</span></h2><p>La documentación presenta un ERP educativo prospectivo: maqueta las interfaces, describe procesos y separa claramente lo que está disponible de lo planificado.</p></div></div>
    <div className="source-downloads">
      <a className="button button-primary" href="https://redfp360.net/assets/downloads/RED_FP360_DOCUMENTACION_FUNCIONAL_COMPLETA_26_APLICACIONES.zip" target="_blank" rel="noreferrer">
        <Download size={16} /> Descargar 26 dossieres y maquetas · ZIP · 47 MB
      </a>
      <a className="button button-secondary" href="https://redfp360.net/assets/downloads/RED_FP360_Memoria_Borrador.pdf" target="_blank" rel="noreferrer">
        <FileText size={16} /> Descargar memoria del proyecto · PDF
      </a>
    </div>
    <div className="resource-grid">{resourceCards.map((card, index) => {
      const Icon = card.icon;
      return <article className="resource-card" key={card.title}><span className="resource-icon"><Icon size={20} /></span><div className="resource-kind">{card.kind}</div><h3>{card.title}</h3><p>{card.text}</p><button className="resource-button" onClick={() => setExpanded(index)} data-testid={`button-doc-${index}`}>{index === 1 ? <Download size={15} /> : <ArrowRight size={15} />}{card.action}</button></article>;
    })}</div>
    <section className="docs-section">
      <SectionTitle title="Referencias visuales" subtitle="Estructuras recreadas en HTML y CSS; las maquetas son guías, no producto." aside={<span className="count-chip">26 aplicaciones</span>} />
      <div className="reference-grid">{referenceMockups.map(([title, slug]) => <a
        className="reference-card"
        key={slug}
        href={`https://redfp360.net/assets/mockups/${slug}.webp`}
        target="_blank"
        rel="noreferrer"
      >
        <ReferenceWireframe title={title} slug={slug} />
        <span><b>{title}</b><small>Maqueta original · abrir imagen completa</small></span>
        <ArrowRight size={15} />
      </a>)}</div>
    </section>
    <section className="source-bundle"><div className="source-icon"><Archive size={19} /></div><div><b>Fuente funcional original descargada</b><p>El ZIP contiene los 26 dossieres Word, guía maestra, catálogo JSON, sistema de diseño y maquetas PNG originales. Las imágenes anteriores permiten abrir las referencias de una en una.</p></div><span className="source-tag"><BadgeCheck size={14} /> Incluida</span></section>
    <div className="learning-note"><ShieldAlert size={17} /><div><b>La documentación no equivale a disponibilidad</b><p>Las especificaciones son prospectivas. La demostración no incluye autenticación de producción; las personas y accesos demo no deben usarse como credenciales reales.</p></div></div>
    {expanded !== null && <Modal title={resourceCards[expanded].title} onClose={() => setExpanded(null)}>
      <div className="doc-modal-content"><div className="doc-modal-label">{resourceCards[expanded].kind}</div><p>{resourceCards[expanded].body}</p>
        {expanded === 2 && <div className="mockup-list">{referenceMockups.slice(0, 6).map(([name, slug], index) => <div key={slug}><ReferenceWireframe title={name} slug={slug} /><span>{String(index + 1).padStart(2, '0')} · {name}</span></div>)}</div>}
        <div className="modal-actions"><button className="button button-quiet" onClick={() => setExpanded(null)}>Cerrar</button>{expanded === 0 ? <button className="button button-secondary" onClick={downloadOutline}><Download size={15} /> Descargar resumen</button> : expanded === 1 ? <button className="button button-primary" onClick={() => { setExpanded(null); window.print(); }}><Download size={15} /> Imprimir / guardar PDF</button> : null}</div>
      </div>
    </Modal>}
  </main>;
}

function identityInitials(identity: AuthIdentity) {
  return identity.displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'RF';
}
function roleLabel(role: AuthIdentity['role']) {
  const labels: Record<AuthIdentity['role'], string> = {
    student: 'Estudiante', team_manager: 'Responsable de equipo', teacher: 'Docente',
    promoter: 'Promotor/a', mentor: 'Mentoría', administrator: 'Administración',
  };
  return labels[role];
}

function Shell({ identity }: { identity: AuthIdentity }) {
  const [location, setLocation] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState('');
  const logout = useLogout();
  const dashboardQuery = useGetFp360Dashboard<Dashboard>();
  const organizationsQuery = useListFp360Organizations<Organization[]>();
  const productsQuery = useListFp360Products<Product[]>();
  const ordersQuery = useListFp360Orders<Order[]>();
  const invoicesQuery = useListFp360Invoices<Invoice[]>();
  const activityQuery = useListFp360Activity<ActivityItem[]>();
  const retryAll = () => { void queryClient.invalidateQueries(); };
  const states = {
    dashboard: { loading: dashboardQuery.isLoading, error: dashboardQuery.isError, retry: retryAll },
    organizations: { loading: organizationsQuery.isLoading, error: organizationsQuery.isError, retry: retryAll },
    products: { loading: productsQuery.isLoading, error: productsQuery.isError, retry: retryAll },
    orders: { loading: ordersQuery.isLoading, error: ordersQuery.isError, retry: retryAll },
    invoices: { loading: invoicesQuery.isLoading, error: invoicesQuery.isError, retry: retryAll },
    activity: { loading: activityQuery.isLoading, error: activityQuery.isError, retry: retryAll },
  };
  const page = useMemo(() => {
    switch (location) {
      case '/': return <DashboardPage dashboard={dashboardQuery.data} activity={activityQuery.data} products={productsQuery.data} orders={ordersQuery.data} states={{ dashboard: states.dashboard, activity: states.activity, products: states.products, orders: states.orders }} />;
      case '/mercado': return <MarketPage organizations={organizationsQuery.data} products={productsQuery.data} stateOrg={states.organizations} stateProducts={states.products} />;
      case '/ventas': return <SalesPage products={productsQuery.data} organizations={organizationsQuery.data} orders={ordersQuery.data} states={{ products: states.products, organizations: states.organizations, orders: states.orders }} onRefresh={() => { void queryClient.invalidateQueries({ queryKey: getGetFp360DashboardQueryKey() }); void queryClient.invalidateQueries(); }} onNotice={setNotice} />;
      case '/almacen': return <InventoryPage products={productsQuery.data} orders={ordersQuery.data} stateProducts={states.products} stateOrders={states.orders} />;
      case '/facturas': return <InvoicesPage invoices={invoicesQuery.data} orders={ordersQuery.data} stateInvoices={states.invoices} stateOrders={states.orders} onRefresh={() => { void queryClient.invalidateQueries({ queryKey: getGetFp360DashboardQueryKey() }); void queryClient.invalidateQueries(); }} onNotice={setNotice} />;
      case '/clientes': return <CustomersPage organizations={organizationsQuery.data} orders={ordersQuery.data} stateOrg={states.organizations} />;
       case '/aplicaciones':
       case '/apps': return <ApplicationsPage />;
       case '/documentacion':
       case '/docs': return <DocumentationPage />;
      default: return null;
    }
  }, [location, dashboardQuery.data, dashboardQuery.isLoading, dashboardQuery.isError, organizationsQuery.data, organizationsQuery.isLoading, organizationsQuery.isError, productsQuery.data, productsQuery.isLoading, productsQuery.isError, ordersQuery.data, ordersQuery.isLoading, ordersQuery.isError, invoicesQuery.data, invoicesQuery.isLoading, invoicesQuery.isError, activityQuery.data, activityQuery.isLoading, activityQuery.isError]);
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand-lockup" onClick={() => setMobileNav(false)}>
        <span className="brand-mark"><span>R</span><i /></span><span className="brand-name"><b>RED FP360</b><small>EMPRESA SIMULADA · FP</small></span>
      </Link>
      <div className="sidebar-context"><span className="context-label">ENTORNO ACTIVO</span><button className="context-selector" type="button"><span className="context-avatar">CE</span><span><b>Empresa de prácticas</b><small>Centro educativo · Canarias</small></span><ChevronDown size={14} /></button></div>
      <div className="nav-caption">ESPACIO DE TRABAJO</div>
      <nav className="main-nav" aria-label="Navegación principal">{navItems.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={`nav-link ${location === href ? 'nav-active' : ''}`} onClick={() => setMobileNav(false)} aria-current={location === href ? 'page' : undefined}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{href === '/aplicaciones' && <span className="nav-count">26</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><LifeBuoy size={17} /></div><b>¿Primera vez por aquí?</b><p>Consulta la guía de aprendizaje de la red.</p><Link href="/documentacion" onClick={() => setMobileNav(false)}>Abrir recursos <ArrowRight size={13} /></Link></div>
         <div className="profile-chip"><span className="profile-avatar">{identityInitials(identity)}</span><span><b>{identity.displayName}</b><small>{roleLabel(identity.role)}</small></span><button className="profile-logout" type="button" disabled={logout.isPending} onClick={() => logout.mutate(undefined, { onSuccess: () => { clearBusinessCache(); void queryClient.resetQueries({ queryKey: getGetCurrentIdentityQueryKey(), exact: true }); setLocation('/sign-in'); }, onError: () => setNotice('No se pudo cerrar la sesión. Comprueba la conexión e inténtalo de nuevo.') })} aria-label="Cerrar sesión" title="Cerrar sesión" data-testid="button-logout"><ArrowRight size={15} /></button></div>
      </div>
    </aside>
    {mobileNav && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={() => setMobileNav(false)} />}
    <div className="main-shell">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu icon-button" aria-label="Abrir menú" onClick={() => setMobileNav(true)}><Menu size={20} /></button><div className="topbar-path"><span>Curso 2027–2028</span><i>/</i><b>Simulación intercentros</b></div></div>
        <div className="topbar-right"><span className="environment-pill"><span /> SIMULACIÓN · SIN OPERACIONES REALES</span><button className="top-icon" aria-label="Notificaciones de demostración" title="Sin notificaciones"><Bell size={17} /><i /></button><span className="top-divider" /><span className="top-user" aria-label={identity.displayName}>{identityInitials(identity)}</span></div>
      </header>
      <div className="content-scroll redfp-scroll"><Switch>
        <Route path="/">{page}</Route>
        <Route path="/mercado">{page}</Route>
        <Route path="/ventas">{page}</Route>
        <Route path="/almacen">{page}</Route>
        <Route path="/facturas">{page}</Route>
        <Route path="/clientes">{page}</Route>
        <Route path="/aplicaciones">{page}</Route>
        <Route path="/documentacion">{page}</Route>
        <Route path="/apps">{page}</Route>
        <Route path="/docs">{page}</Route>
        <Route component={NotFound} />
      </Switch></div>
      <footer className="app-footer"><span>RED FP360 <i>·</i> Entorno educativo de prácticas</span><span>Sin conexión a sistemas reales <b>·</b> © 2027</span></footer>
    </div>
    <ToastMessage message={notice} onClose={() => setNotice('')} />
  </div>;
}

function isUnauthorized(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'status' in error && (error as { status: unknown }).status === 401);
}
function AuthLoading({ label = 'Comprobando acceso seguro' }: { label?: string }) {
  return <main className="auth-loading" role="status" aria-live="polite"><div className="auth-loading-brand"><span className="brand-mark"><span>R</span><i /></span><b>RED FP360</b></div><div className="auth-skeleton"><span /><span /><span /></div><p>{label}…</p></main>;
}
function AuthRouter() {
  const [location, setLocation] = useLocation();
  const authStatus = useGetAuthStatus({ query: { queryKey: getGetAuthStatusQueryKey(), retry: 1 } });
  const identityQuery = useGetCurrentIdentity({ query: { queryKey: getGetCurrentIdentityQueryKey(), retry: false } });
  const [validatedIdentity, setValidatedIdentity] = useState('');
  const previousIdentity = useRef('');
  const identity = identityQuery.data;
  const identityKey = identity ? `${identity.id}:${identity.tenantId}:${identity.organizationId ?? ''}` : '';

  useEffect(() => {
    if (!identity || identityQuery.isFetching || identityQuery.isError) return;
    if (previousIdentity.current && previousIdentity.current !== identityKey) clearBusinessCache();
    previousIdentity.current = identityKey;
    setValidatedIdentity(identityKey);
  }, [identity, identityQuery.isFetching, identityQuery.isError, identityKey]);

  const onAuthenticated = (nextIdentity: AuthIdentity) => {
    const nextKey = `${nextIdentity.id}:${nextIdentity.tenantId}:${nextIdentity.organizationId ?? ''}`;
    if (previousIdentity.current && previousIdentity.current !== nextKey) clearBusinessCache();
    previousIdentity.current = nextKey;
    setValidatedIdentity(nextKey);
    queryClient.setQueryData(getGetCurrentIdentityQueryKey(), nextIdentity);
    queryClient.setQueryData(getGetAuthStatusQueryKey(), { setupRequired: false });
    setLocation('/');
  };

  if (authStatus.isLoading) return <AuthLoading label="Cargando configuración del acceso" />;
  if (authStatus.isError || !authStatus.data) return <main className="auth-loading"><div className="auth-state-card"><CircleHelp size={22} /><h1>No podemos comprobar el acceso</h1><p>El servicio de autenticación no responde. Comprueba la conexión e inténtalo otra vez.</p><button className="auth-submit" type="button" onClick={() => { void authStatus.refetch(); void identityQuery.refetch(); }} data-testid="button-retry-auth">Reintentar <ArrowRight size={16} /></button></div></main>;

  if (identityQuery.isLoading || (identity && identityQuery.isFetching) || (identity && validatedIdentity !== identityKey)) return <AuthLoading />;
  if (identity && !identityQuery.isError && validatedIdentity === identityKey) {
    if (location === '/sign-in' || location === '/setup') {
      return <AuthRedirect target="/" />;
    }
    return <ErrorBoundary resetKey={location}><Shell identity={identity} /></ErrorBoundary>;
  }

  if (identityQuery.isError && !isUnauthorized(identityQuery.error)) {
    return <main className="auth-loading"><div className="auth-state-card"><CircleAlert size={22} /><h1>Acceso temporalmente no disponible</h1><p>No se pudo verificar tu sesión. No se han cargado datos del espacio de trabajo.</p><button className="auth-submit" type="button" onClick={() => void identityQuery.refetch()} data-testid="button-retry-identity">Volver a comprobar <ArrowRight size={16} /></button></div></main>;
  }

  const setupRequired = authStatus.data.setupRequired;
  if (location === '/setup' && !setupRequired) return <AuthExperience mode="setup-complete" onAuthenticated={onAuthenticated} setupEnabled={false} />;
  if (setupRequired && location !== '/sign-in' && location !== '/setup') return <AuthRedirect target="/setup" />;
  if (location !== '/sign-in' && location !== '/setup') return <AuthRedirect target="/sign-in" />;
  return <AuthExperience mode={location === '/setup' ? 'setup' : 'sign-in'} onAuthenticated={onAuthenticated} setupEnabled={setupRequired} />;
}
function AuthRedirect({ target }: { target: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation(target); }, [target, setLocation]);
  return <AuthLoading label={`Abriendo ${target === '/setup' ? 'la configuración inicial' : 'el espacio de trabajo'}`} />;
}
function Router() {
  return <AuthRouter />;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;

import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity, Archive, ArrowDownLeft, ArrowRight, BadgeCheck, Banknote, BarChart3, Bell, BriefcaseBusiness,
  BookOpen, Boxes, Building2, Check, CheckCircle2, ChevronDown, CircleHelp, ClipboardList,
  Clock3, CreditCard, Download, FileArchive, FileCheck2, FileText, Filter, Globe2,
  GraduationCap, Landmark, LayoutDashboard, LifeBuoy, Mail, Menu, Package, PackageCheck, Plus,
  ReceiptText, RefreshCw, Search, ShieldAlert, ShieldCheck, ShoppingBag, ShoppingCart, Truck, Users, X, CircleAlert,
} from 'lucide-react';
import {
  getGetFp360DashboardQueryKey, useConfirmFp360Order, useCreateFp360Order,
  useConfirmFp360LogisticsDelivery, useCreateFp360LogisticsIncident,
  useDispatchFp360Order, useIssueFp360Invoice, useListFp360LogisticsShipments,
  useListFp360Invoices, useListFp360Orders,
  useListFp360Organizations, useListFp360Products, useRecordFp360Payment,
  useResolveFp360LogisticsIncident, useUpdateFp360LogisticsRoute,
  getGetAuthStatusQueryKey, getGetCurrentIdentityQueryKey, useGetAuthStatus,
  useGetCurrentIdentity, useLogout,
} from '@workspace/api-client-react';
import type {
  AuthIdentity,
  Fp360Activity,
  Fp360Dashboard,
  Fp360Invoice,
  Fp360LogisticsShipment,
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
import { AdminAccessDenied, AdminPage } from '@/components/admin-page';
import { AcceptInvitation } from '@/components/accept-invitation';
import { CatalogPage } from '@/components/catalog-page';
import { OrganizationsDirectory } from '@/components/organizations-directory';
import { CrmPage } from '@/components/crm-page';
import { PurchasesPage } from '@/components/purchases-page';
import DirectionPage from '@/components/direction/DirectionPage';
import { AccountingPage } from '@/components/accounting-page';
import { TreasuryPage } from '@/components/treasury-page';
import { BankPage } from '@/components/bank-page';
import { HaciendaPage } from '@/components/hacienda-page';
import { SocialSecurityPage } from '@/components/social-security-page';
import { HumanResourcesPage } from '@/components/human-resources-page';
import { EmploymentPage } from '@/components/employment-page';
import { CommunicationsPage } from '@/components/communications-page';
import SimulationCampaignsPage from '@/components/simulation-campaigns-page';
import { PayrollPage } from '@/components/payroll-page';
import { CustomerServicePage } from '@/components/customer-service-page';
import { ProjectsServicesPage } from '@/components/projects-services-page';
import { DocumentManagementPage } from '@/components/document-management-page';
import '@/components/treasury-page.css';

const queryClient = new QueryClient();
type Product = Fp360Product;
type Organization = Fp360Organization;
type Order = Fp360Order;
type Invoice = Fp360Invoice;
type LogisticsShipment = Fp360LogisticsShipment;
type ActivityItem = Fp360Activity;
type Dashboard = Fp360Dashboard;
type DataState = { loading?: boolean; error?: boolean; retry?: () => void };
const paymentOperationKey = (invoiceId: string) => `redfp360:invoice-payment:${invoiceId}`;
type StoredInvoicePayment = { operationId: string; amountCents: number; attempted: boolean };
function readPaymentAttempt(key: string): StoredInvoicePayment | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredInvoicePayment>;
      if (typeof parsed.operationId === 'string') {
        return {
          operationId: parsed.operationId,
          amountCents: typeof parsed.amountCents === 'number' ? parsed.amountCents : 0,
          attempted: parsed.attempted === true,
        };
      }
    } catch { /* Older sessions stored only the operation ID. */ }
    return { operationId: raw, amountCents: 0, attempted: false };
  } catch { return null; }
}
function writePaymentAttempt(key: string, value: StoredInvoicePayment | null) {
  try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Keep the active form usable when storage is unavailable. */ }
}

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
const implemented = new Set([1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
const navItems = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/mercado', label: 'Mercado', icon: Globe2 },
  { href: '/ventas', label: 'Ventas', icon: ShoppingCart },
  { href: '/compras', label: 'Compras', icon: ShoppingBag },
  { href: '/productos', label: 'Catálogo', icon: PackageCheck },
  { href: '/almacen', label: 'Almacén', icon: Boxes },
  { href: '/logistica', label: 'Logística', icon: Truck },
  { href: '/contabilidad', label: 'Contabilidad', icon: BookOpen },
  { href: '/tesoreria', label: 'Tesorería', icon: Banknote },
  { href: '/banco', label: 'Banco FP360', icon: Landmark },
  { href: '/hacienda', label: 'Hacienda FP360', icon: FileCheck2 },
  { href: '/recursos-humanos', label: 'Recursos humanos', icon: Users },
  { href: '/empleo', label: 'Empleo FP360', icon: BriefcaseBusiness },
  { href: '/comunicaciones', label: 'Centro de comunicaciones', icon: Mail },
  { href: '/simulaciones', label: 'FP360 SIM', icon: Activity },
  { href: '/nominas', label: 'Nóminas', icon: FileCheck2 },
  { href: '/seguridad-social', label: 'Seguridad Social', icon: Users },
  { href: '/facturas', label: 'Facturas', icon: ReceiptText },
  { href: '/clientes', label: 'Clientes', icon: Users },
  { href: '/crm', label: 'CRM', icon: BriefcaseBusiness },
  { href: '/atencion-cliente', label: 'Atención al cliente', icon: CircleHelp },
  { href: '/proyectos-servicios', label: 'Proyectos y servicios', icon: BriefcaseBusiness },
  { href: '/gestion-documental', label: 'Gestión documental', icon: FileArchive },
  { href: '/aplicaciones', label: 'Aplicaciones', icon: Package },
  { href: '/documentacion', label: 'Documentación', icon: BookOpen },
];
const titles: Record<string, { title: string; kicker: string; description: string }> = {
  '/': { title: 'Cuadro de mando', kicker: 'DIRECCIÓN · VISTA GENERAL', description: 'Actividad comercial de la empresa simulada y operaciones recientes de la red.' },
  '/mercado': { title: 'Mercado FP360', kicker: 'RED INTERCENTROS · B2B', description: 'Empresas y catálogo comercial de la economía educativa canaria.' },
  '/ventas': { title: 'Ventas', kicker: 'CICLO COMERCIAL · OPERACIONES', description: 'Crea pedidos, confirma reservas y registra expediciones simuladas.' },
  '/compras': { title: 'Compras y aprovisionamiento', kicker: 'APROVISIONAMIENTO · RED FP360', description: 'Solicita, compara ofertas y emite pedidos de compra simulados.' },
  '/almacen': { title: 'Almacén', kicker: 'EXISTENCIAS · CONTROL', description: 'Consulta stock físico, reservas y disponibilidad comercial.' },
  '/logistica': { title: 'Logística y distribución', kicker: 'OPERACIONES · ENTREGAS', description: 'Prepara expediciones simuladas y sigue las cantidades entregadas.' },
  '/contabilidad': { title: 'Contabilidad', kicker: 'CICLO ECONÓMICO · LIBROS', description: 'Registra asientos didácticos, consulta el mayor y prepara los cierres.' },
  '/tesoreria': { title: 'Tesorería', kicker: 'TESORERÍA · LIQUIDEZ', description: 'Conecta vencimientos, cobros y saldo contabilizado. Cada decisión se practica, no se liquida.' },
  '/banco': { title: 'Banco FP360', kicker: 'BANCO SIMULADO · OPERACIONES', description: 'Gestiona la liquidez y practica transferencias, financiación y efectos sin operar con bancos reales.' },
  '/hacienda': { title: 'Hacienda FP360', kicker: 'FISCALIDAD SIMULADA · SIN VALIDEZ OFICIAL', description: 'Prepara y revisa expedientes fiscales educativos; no se presentan declaraciones reales.' },
  '/recursos-humanos': { title: 'Recursos humanos', kicker: 'GESTIÓN LABORAL EDUCATIVA · DATOS FICTICIOS', description: 'Gestiona selección, expedientes, contratos, calendario e incidencias del personal simulado.' },
  '/empleo': { title: 'Empleo FP360 · Contratación', kicker: 'PROCESOS LABORALES · SIMULACIÓN EDUCATIVA', description: 'Practica ofertas, comunicaciones contractuales, subsanaciones y finalizaciones con datos ficticios.' },
  '/comunicaciones': { title: 'Centro de comunicaciones FP360', kicker: 'BUZONES INTERNOS · RED SIMULADA', description: 'Coordina conversaciones, tareas y avisos entre empresas sin enviar mensajes a personas reales.' },
  '/simulaciones': { title: 'FP360 SIM · Dirección inteligente', kicker: 'CAMPAÑAS FORMATIVAS · CANARIAS', description: 'Diseña campañas, revisa propuestas y publica eventos educativos sin modificar operaciones del ERP.' },
  '/nominas': { title: 'Nóminas FP360', kicker: 'RECIBOS EDUCATIVOS · IMPORTES DIDÁCTICOS', description: 'Calcula nóminas con parámetros configurables; no se envían pagos, retenciones ni cotizaciones reales.' },
  '/atencion-cliente': { title: 'Atención al cliente', kicker: 'CASOS, DEVOLUCIONES Y ACUERDOS EDUCATIVOS', description: 'Gestiona reclamaciones y su trazabilidad; las comunicaciones y los efectos comerciales permanecen simulados.' },
  '/proyectos-servicios': { title: 'Proyectos y servicios', kicker: 'ÓRDENES · ENTREGABLES · COSTES DIDÁCTICOS', description: 'Planifica servicios simulados, valida entregables y controla costes e hitos sin operar fuera del ERP educativo.' },
  '/gestion-documental': { title: 'Gestión documental', kicker: 'EXPEDIENTES · VERSIONES · TRAZABILIDAD', description: 'Organiza documentos didácticos por empresa y expediente, conserva versiones y registra las revisiones.' },
  '/seguridad-social': { title: 'Seguridad Social FP360', kicker: 'AFILIACIÓN Y COTIZACIÓN SIMULADAS', description: 'Gestiona movimientos laborales y resúmenes educativos; no hay trámites ni pagos reales.' },
  '/facturas': { title: 'Facturación', kicker: 'DOCUMENTOS · COBROS', description: 'Emite facturas y registra pagos en el circuito de prácticas.' },
  '/productos': { title: 'Catálogo de productos', kicker: 'CATÁLOGO · INVENTARIO', description: 'Productos inventariables, publicación y ajustes manuales.' },
  '/clientes': { title: 'Directorio de organizaciones', kicker: 'CRM · RED FP360', description: 'Empresas simuladas, centros participantes y relaciones de la red.' },
  '/crm': { title: 'CRM de prácticas', kicker: 'RELACIONES COMERCIALES · SIMULACIÓN', description: 'Empresas ficticias, oportunidades y seguimiento para aprender el ciclo comercial.' },
  '/aplicaciones': { title: 'Aplicaciones', kicker: 'PLATAFORMA · 26 MÓDULOS', description: 'Catálogo de capacidades previstas y módulos conectados en esta demostración.' },
  '/administracion': { title: 'Usuarios y accesos', kicker: 'ADMINISTRACIÓN', description: 'Gestión de cuentas e invitaciones.' },
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

function MarketPage({ organizations, products, orders, stateOrg, stateProducts, stateOrders }: {
  organizations?: Organization[]; products?: Product[]; orders?: Order[];
  stateOrg: DataState; stateProducts: DataState; stateOrders: DataState;
}) {
  const identity = useGetCurrentIdentity();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'partners' | 'products' | 'operations'>('partners');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const activeOrganizations = (organizations ?? []).filter((org) => org.isActive);
  const suppliers = activeOrganizations.filter((org) => org.role === 'seller' || org.role === 'both');
  const publishedProducts = (products ?? []).filter((product) => product.isActive && product.isPublished);
  const complete = (order: Order) => ['delivered', 'invoiced', 'paid'].includes(order.status);
  const completedOrders = (orders ?? []).filter(complete);
  const currentOrganization = activeOrganizations.find((org) => org.id === identity.data?.organizationId);
  const canRequestOffer = !['mentor', 'promoter'].includes(identity.data?.role ?? '') &&
    (currentOrganization?.role === 'buyer' || currentOrganization?.role === 'both');
  const searchText = search.trim().toLocaleLowerCase('es');
  const purchaseRequestHref = (productId?: string, supplierId?: string) => {
    const params = new URLSearchParams();
    if (productId) params.set('marketProduct', productId);
    if (supplierId) params.set('marketSupplier', supplierId);
    const query = params.toString();
    return query ? `/compras?${query}` : '/compras';
  };
  const productsFor = (organizationId: string) => publishedProducts.filter((product) => product.supplierOrganizationId === organizationId);
  const averageLeadTime = (organizationId: string) => {
    const values = productsFor(organizationId).map((product) => product.leadTimeDays).filter((days) => days > 0);
    return values.length ? `${Math.round(values.reduce((sum, days) => sum + days, 0) / values.length)} días` : 'No indicado';
  };
  const matchedSuppliers = suppliers.filter((org) => {
    const catalog = productsFor(org.id);
    const searchable = `${org.name} ${org.center} ${org.island} ${catalog.map((item) => `${item.name} ${item.category} ${item.sku}`).join(' ')}`;
    return searchable.toLocaleLowerCase('es').includes(searchText);
  });
  const matchedProducts = publishedProducts.filter((product) => {
    const supplier = activeOrganizations.find((org) => org.id === product.supplierOrganizationId)?.name ?? 'sin proveedor asignado';
    return `${product.name} ${product.category} ${product.sku} ${product.itemType} ${supplier}`.toLocaleLowerCase('es').includes(searchText);
  });
  const matchedOrders = (orders ?? []).filter((order) => `${order.reference} ${order.buyerName} ${order.status}`.toLocaleLowerCase('es').includes(searchText));
  const selectedSupplier = suppliers.find((org) => org.id === selectedOrganizationId) ?? matchedSuppliers[0] ?? null;
  const selectedProduct = publishedProducts.find((product) => product.id === selectedProductId) ?? matchedProducts[0] ?? null;
  const selectedOrder = (orders ?? []).find((order) => order.id === selectedOrderId) ?? matchedOrders[0] ?? null;
  const recentOrders = [...(orders ?? [])].sort((a, b) => b.simulatedDate.localeCompare(a.simulatedDate)).slice(0, 4);
  const inProgressOrders = (orders ?? []).filter((order) => order.status === 'confirmed' || order.status === 'partial');
  const closedPercent = orders?.length ? Math.round((completedOrders.length / orders.length) * 100) : 0;

  return <main className="page-content market-page">
    <PageHeading path="/mercado"><Link className="button button-primary" href="/ventas" data-testid="button-market-new-operation"><Plus size={16} /> Nueva operación</Link></PageHeading>
    <SimulationNotice />
    <section className="market-kpis" aria-label="Indicadores reales de la red simulada">
      <div className="market-kpi"><span className="market-kpi-icon blue"><Building2 size={16} /></span><div><small>Empresas activas</small><b>{organizations ? activeOrganizations.length : '—'}</b><span>Participantes de la red</span></div></div>
      <div className="market-kpi"><span className="market-kpi-icon green"><Package size={16} /></span><div><small>Referencias publicadas</small><b>{products ? publishedProducts.length : '—'}</b><span>Productos y servicios</span></div></div>
      <div className="market-kpi"><span className="market-kpi-icon amber"><ShoppingCart size={16} /></span><div><small>Pedidos intercentros</small><b>{orders ? orders.length : '—'}</b><span>En este escenario</span></div></div>
      <div className="market-kpi"><span className="market-kpi-icon violet"><CheckCircle2 size={16} /></span><div><small>Operaciones cerradas</small><b>{orders ? completedOrders.length : '—'}</b><span>Con entrega registrada</span></div></div>
    </section>

    <div className="market-dashboard-grid">
      <section className="panel market-activity-panel">
        <div className="market-section-heading"><div><h2>Actividad intercentros</h2><p>Empresas, catálogo publicado y operaciones registradas.</p></div><Link href="/documentacion" className="market-text-link">Guía del módulo <ArrowRight size={13} /></Link></div>
        <div className="market-table-toolbar">
          <div className="tabs" role="tablist" aria-label="Vistas del mercado">
            <button className={tab === 'partners' ? 'tab-active' : ''} onClick={() => setTab('partners')} role="tab" aria-selected={tab === 'partners'} data-testid="tab-market-organizations"><Building2 size={14} /> Empresas</button>
            <button className={tab === 'products' ? 'tab-active' : ''} onClick={() => setTab('products')} role="tab" aria-selected={tab === 'products'} data-testid="tab-market-products"><Package size={14} /> Catálogo</button>
            <button className={tab === 'operations' ? 'tab-active' : ''} onClick={() => setTab('operations')} role="tab" aria-selected={tab === 'operations'} data-testid="tab-market-operations"><Activity size={14} /> Operaciones</button>
          </div>
          <label className="search-field market-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={tab === 'partners' ? 'Buscar empresa, centro o referencia…' : tab === 'products' ? 'Buscar producto, servicio o proveedor…' : 'Buscar pedido o comprador…'} aria-label="Buscar en Mercado FP360" data-testid="input-market-search" /></label>
        </div>
        {tab === 'partners' && <>
          <DataMessage state={stateOrg} />
          <DataTable minWidth={700}><thead><tr><th>Empresa proveedora</th><th>Familias publicadas</th><th>Isla</th><th>Referencias</th><th>Plazo medio</th><th>Estado</th></tr></thead><tbody>
            {!stateOrg.loading && !stateOrg.error && matchedSuppliers.map((org) => {
              const catalog = productsFor(org.id);
              const categories = [...new Set(catalog.map((item) => item.category))].slice(0, 2).join(' · ') || 'Sin catálogo';
              return <tr key={org.id} className={selectedSupplier?.id === org.id ? 'market-selected-row' : ''} data-testid={`row-market-org-${org.id}`}>
                <td><button className="market-row-select" onClick={() => setSelectedOrganizationId(org.id)}><span className="org-avatar">{org.name.slice(0, 2).toUpperCase()}</span><span><b>{org.name}</b><small>{org.center}</small></span></button></td>
                <td>{categories}</td><td>{org.island}</td><td className="numeric">{catalog.length}</td><td>{averageLeadTime(org.id)}</td>
                <td><span className={`status ${catalog.length ? 'status-green' : 'status-amber'}`}><span className="status-dot" />{catalog.length ? 'Disponible' : 'Sin catálogo'}</span></td>
              </tr>;
            })}
            {!stateOrg.loading && !stateOrg.error && !matchedSuppliers.length && <TableEmpty colSpan={6} title="No hay proveedores coincidentes" detail="Solo aparecen empresas activas con perfil vendedor o mixto." />}
          </tbody></DataTable>
          <div className="table-footer"><span>{matchedSuppliers.length} empresas proveedoras</span><span>Solo datos publicados</span></div>
        </>}
        {tab === 'products' && <>
          <DataMessage state={stateProducts} />
          <DataTable minWidth={740}><thead><tr><th>Referencia</th><th>Proveedor</th><th>Tipo</th><th>Precio</th><th>Disponibilidad</th><th>Plazo</th></tr></thead><tbody>
            {!stateProducts.loading && !stateProducts.error && matchedProducts.map((product) => {
              const supplier = activeOrganizations.find((org) => org.id === product.supplierOrganizationId);
              return <tr key={product.id} className={selectedProduct?.id === product.id ? 'market-selected-row' : ''} data-testid={`row-market-product-${product.id}`}>
                <td><button className="market-row-select" onClick={() => setSelectedProductId(product.id)}><span className={`product-glyph ${product.itemType === 'service' ? 'service' : ''}`}>{product.itemType === 'service' ? <BriefcaseBusiness size={16} /> : <Package size={16} />}</span><span><b>{product.name}</b><small className="mono">{product.sku} · {product.category}</small></span></button></td>
                <td>{supplier?.name ?? 'Proveedor no asignado'}</td><td>{product.itemType === 'service' ? 'Servicio' : 'Producto'}</td><td className="price-cell">{money(product.unitPriceCents)}<small className="table-secondary block">por {product.unit}</small></td>
                <td>{product.tracksInventory ? `${Math.max(0, product.stock - product.reserved)} disponibles` : 'Cotización por prestación'}</td><td>{product.leadTimeDays ? `${product.leadTimeDays} días` : 'Por acordar'}</td>
              </tr>;
            })}
            {!stateProducts.loading && !stateProducts.error && !matchedProducts.length && <TableEmpty colSpan={6} title="No hay referencias publicadas" detail="Las referencias activas aparecen aquí después de su aprobación en el catálogo." />}
          </tbody></DataTable>
          <div className="table-footer"><span>{matchedProducts.length} referencias publicadas</span><span>Precios e importes exclusivamente simulados</span></div>
        </>}
        {tab === 'operations' && <>
          <DataMessage state={stateOrders} />
          <DataTable minWidth={650}><thead><tr><th>Pedido</th><th>Empresa compradora</th><th>Fecha simulada</th><th>Estado</th><th>Total</th></tr></thead><tbody>
            {!stateOrders.loading && !stateOrders.error && matchedOrders.map((order) => <tr key={order.id} className={selectedOrder?.id === order.id ? 'market-selected-row' : ''} data-testid={`row-market-order-${order.id}`}>
              <td><button className="market-row-select" onClick={() => setSelectedOrderId(order.id)}><b className="mono">{order.reference}</b><small>{order.lines.length} referencias</small></button></td><td>{order.buyerName}</td><td>{dateLabel(order.simulatedDate)}</td><td><Status status={order.status} /></td><td className="price-cell">{money(order.totalCents)}</td>
            </tr>)}
            {!stateOrders.loading && !stateOrders.error && !matchedOrders.length && <TableEmpty colSpan={5} title="Aún no hay operaciones" detail="Los pedidos entre empresas aparecerán aquí cuando se registren en Ventas." />}
          </tbody></DataTable>
          <div className="table-footer"><span>{matchedOrders.length} pedidos</span><Link href="/ventas" className="market-text-link">Ir a Ventas <ArrowRight size={13} /></Link></div>
        </>}
      </section>

      <aside className="market-context-column">
        <section className="panel market-context-panel">
          {tab === 'partners' && selectedSupplier && <div data-testid="market-partner-detail">
            <div className="market-context-heading"><span className="market-context-icon"><Building2 size={17} /></span><div><small>PERFIL DE EMPRESA</small><h2>{selectedSupplier.name}</h2><span>{selectedSupplier.center} · {selectedSupplier.island}</span></div></div>
            <dl className="market-context-list">
              <div><dt>Participación</dt><dd>{selectedSupplier.role === 'both' ? 'Compra y vende' : 'Proveedor'}</dd></div>
              <div><dt>Referencias publicadas</dt><dd>{productsFor(selectedSupplier.id).length}</dd></div>
              <div><dt>Plazo medio</dt><dd>{averageLeadTime(selectedSupplier.id)}</dd></div>
              <div><dt>Condiciones / valoraciones</dt><dd>No hay registros</dd></div>
            </dl>
            <div className="market-context-subtitle">Catálogo visible</div>
            <div className="market-context-listing">{productsFor(selectedSupplier.id).slice(0, 4).map((product) => <button key={product.id} onClick={() => { setTab('products'); setSelectedProductId(product.id); }}><span>{product.name}<small>{product.itemType === 'service' ? 'Servicio' : product.category}</small></span><b>{money(product.unitPriceCents)}</b></button>)}
              {!productsFor(selectedSupplier.id).length && <p>Esta empresa aún no tiene referencias publicadas.</p>}
            </div>
            <Link href={canRequestOffer ? purchaseRequestHref(undefined, selectedSupplier.id) : '/compras'} className="button button-primary market-context-cta" data-testid="link-market-request-quote">{canRequestOffer ? 'Solicitar presupuesto' : 'Consultar solicitudes'} <ArrowRight size={14} /></Link>
          </div>}
          {tab === 'products' && selectedProduct && <div data-testid="market-product-detail">
            <div className="market-context-heading"><span className="market-context-icon"><Package size={17} /></span><div><small>CATÁLOGO DEL MERCADO</small><h2>{selectedProduct.name}</h2><span className="mono">{selectedProduct.sku}</span></div></div>
            <dl className="market-context-list">
              <div><dt>Proveedor</dt><dd>{activeOrganizations.find((org) => org.id === selectedProduct.supplierOrganizationId)?.name ?? 'No asignado'}</dd></div>
              <div><dt>Precio orientativo</dt><dd>{money(selectedProduct.unitPriceCents)} / {selectedProduct.unit}</dd></div>
              <div><dt>Disponibilidad</dt><dd>{selectedProduct.tracksInventory ? `${Math.max(0, selectedProduct.stock - selectedProduct.reserved)} unidades` : 'A negociar'}</dd></div>
              <div><dt>Plazo previsto</dt><dd>{selectedProduct.leadTimeDays ? `${selectedProduct.leadTimeDays} días` : 'A negociar'}</dd></div>
            </dl>
            {selectedProduct.description && <p className="market-context-description">{selectedProduct.description}</p>}
            <Link href={canRequestOffer ? purchaseRequestHref(selectedProduct.id, selectedProduct.supplierOrganizationId ?? undefined) : '/compras'} className="button button-primary market-context-cta">{canRequestOffer ? 'Solicitar presupuesto' : 'Consultar solicitudes'} <ArrowRight size={14} /></Link>
          </div>}
          {tab === 'operations' && selectedOrder && <div data-testid="market-order-detail">
            <div className="market-context-heading"><span className="market-context-icon"><ShoppingCart size={17} /></span><div><small>OPERACIÓN INTERCENTROS</small><h2>{selectedOrder.reference}</h2><span>{selectedOrder.buyerName}</span></div></div>
            <dl className="market-context-list">
              <div><dt>Fecha simulada</dt><dd>{dateLabel(selectedOrder.simulatedDate)}</dd></div>
              <div><dt>Estado</dt><dd><Status status={selectedOrder.status} /></dd></div>
              <div><dt>Importe simulado</dt><dd>{money(selectedOrder.totalCents)}</dd></div>
            </dl>
            <div className="market-context-subtitle">Líneas</div>
            <div className="market-context-listing">{selectedOrder.lines.map((line) => <div key={line.productId}><span>{line.productName}<small>{line.itemType === 'service' ? 'Servicio' : 'Producto'} · {line.shippedQuantity}/{line.quantity} atendidas</small></span><b>{line.quantity} × {money(line.unitPriceCents)}</b></div>)}</div>
            <Link href="/ventas" className="button button-primary market-context-cta">Gestionar pedido <ArrowRight size={14} /></Link>
          </div>}
          {((tab === 'partners' && !selectedSupplier) || (tab === 'products' && !selectedProduct) || (tab === 'operations' && !selectedOrder)) && <div className="market-context-empty"><Globe2 size={21} /><b>Selecciona un elemento</b><span>El panel mostrará información procedente de los registros de la red.</span></div>}
        </section>
        <section className="market-privacy-note"><ShieldCheck size={16} /><div><b>Acceso entre organizaciones</b><p>El mercado muestra únicamente empresas activas y referencias aprobadas. Todos los importes son ficticios.</p></div></section>
      </aside>
    </div>

    <div className="market-lower-grid">
      <section className="panel market-lower-panel"><div className="market-section-heading"><div><h2>Actividad reciente</h2><p>Pedidos registrados en este escenario.</p></div><Activity size={16} /></div>
        {stateOrders.loading ? <LoadingRows /> : stateOrders.error ? <DataMessage state={stateOrders} /> : recentOrders.length ? <ul className="market-recent-list">{recentOrders.map((order) => <li key={order.id}><span className="market-recent-mark"><Clock3 size={13} /></span><span><b>{order.reference} · {order.buyerName}</b><small>{dateLabel(order.simulatedDate)} · {order.lines.length} líneas</small></span><Status status={order.status} /></li>)}</ul> : <EmptyState title="Sin actividad registrada" detail="Los pedidos confirmados aparecerán aquí." icon={Activity} />}
      </section>
      <section className="panel market-lower-panel"><div className="market-section-heading"><div><h2>Ciclo de operaciones</h2><p>Avance calculado desde pedidos reales.</p></div><BarChart3 size={16} /></div>
        <div className="market-cycle-stats"><div><span>Borradores</span><b>{orders ? orders.filter((order) => order.status === 'draft').length : '—'}</b></div><div><span>En preparación</span><b>{orders ? inProgressOrders.length : '—'}</b></div><div><span>Cerradas</span><b>{orders ? completedOrders.length : '—'}</b></div></div>
        <div className="market-cycle-progress"><div><span>Operaciones cerradas</span><b>{orders?.length ? `${closedPercent}%` : 'Sin operaciones'}</b></div><div className="market-progress-track"><span style={{ width: `${closedPercent}%` }} /></div><small>{orders?.length ? `${completedOrders.length} de ${orders.length} pedidos` : 'El indicador aparecerá al registrar pedidos.'}</small></div>
      </section>
    </div>
    <div className="market-quick-actions">
      <Link href="/ventas"><ShoppingCart size={14} /> Crear pedido</Link>
      <Link href="/compras"><FileText size={14} /> Solicitar compra</Link>
      <Link href="/productos"><Package size={14} /> Gestionar catálogo</Link>
      <Link href="/documentacion"><BookOpen size={14} /> Consultar documentación</Link>
    </div>
  </main>;
}

function SalesPage({ products, organizations, orders, states, onRefresh, onNotice }: {
  products?: Product[]; organizations?: Organization[]; orders?: Order[];
  states: { products: DataState; organizations: DataState; orders: DataState };
  onRefresh: () => void; onNotice: (message: string) => void;
}) {
  const identity = useGetCurrentIdentity();
  const readOnly = !identity.data || ['promoter', 'mentor'].includes(identity.data.role);
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
  const [dispatchOperationId, setDispatchOperationId] = useState('');
  const buyers = (organizations ?? []).filter((org) => org.isActive && (org.role === 'buyer' || org.role === 'both'));
  const orderable = (products ?? []).filter((p) => p.isActive && p.isPublished);
  const selectedProduct = orderable.find((p) => p.id === productId);
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
    onSuccess: () => { refreshOrders(); void queryClient.invalidateQueries({ queryKey: productsQuery.queryKey }); onNotice(`Pedido ${order.reference} confirmado; los productos inventariables quedan reservados.`); },
    onError: () => onNotice('No se pudo confirmar el pedido. Comprueba la disponibilidad.'),
  });
  const openDispatch = (order: Order) => {
    setDispatching(order);
    setDispatchOperationId(crypto.randomUUID());
    setDispatchQuantity(Math.max(1, order.lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0)));
  };
  const dispatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dispatching) return;
    const line = dispatching.lines.find((item) => item.quantity > item.shippedQuantity);
    if (!line) return;
    const isService = line.itemType === 'service';
    const remaining = line.quantity - line.shippedQuantity;
    const shipQty = Math.min(Math.max(1, dispatchQuantity), remaining);
    dispatchOrder.mutate({ id: dispatching.id, data: { operationId: dispatchOperationId, lines: [{ productId: line.productId, quantity: shipQty }] } }, {
      onSuccess: () => { setDispatching(null); refreshOrders(); void queryClient.invalidateQueries({ queryKey: productsQuery.queryKey }); onNotice(isService ? 'Prestación de servicio registrada.' : 'Expedición simulada registrada.'); },
      onError: () => onNotice('No se pudo registrar la expedición. Revisa las unidades pendientes.'),
    });
  };
  const actionable = orders ?? [];
  return <main className="page-content">
    <PageHeading path="/ventas"><button className="button button-primary" disabled={readOnly} onClick={() => setNewOrder(true)} data-testid="button-create-order"><Plus size={16} /> Crear pedido</button></PageHeading>
    {readOnly && <p role="status">Tu perfil permite consultar los pedidos, pero no modificarlos.</p>}
    <SimulationNotice />
    <div className="sub-metrics">
      <div><span>Pedidos del escenario</span><b>{orders?.length ?? '—'}</b><small>Historial de venta</small></div>
      <div><span>Pendientes de confirmar</span><b>{actionable.filter((o) => o.status === 'draft').length}</b><small>Requieren validación comercial</small></div>
      <div><span>En preparación o envío</span><b>{actionable.filter((o) => o.status === 'confirmed' || o.status === 'partial').length}</b><small>Reserva y expedición</small></div>
    </div>
    <section className="panel">
      <SectionTitle title="Pedidos" subtitle="Confirma el pedido para reservar existencias; registra la entrega o prestación cuando esté completada." aside={<button className="icon-button" aria-label="Actualizar pedidos" onClick={refreshOrders}><RefreshCw size={16} /></button>} />
      <DataMessage state={states.orders} />
      <DataTable minWidth={780}><thead><tr><th>Referencia</th><th>Empresa compradora</th><th>Fecha simulada</th><th>Estado</th><th>Total</th><th>Unidades</th><th>Acciones</th></tr></thead><tbody>
        {!states.orders.loading && !states.orders.error && actionable.map((order) => {
          const remaining = order.lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0);
          return <tr key={order.id} data-testid={`row-order-${order.id}`}><td><b className="mono ref">{order.reference}</b></td><td>{order.buyerName}</td><td>{dateLabel(order.simulatedDate)}</td><td><Status status={order.status} /></td><td className="price-cell">{money(order.totalCents)}</td><td>{order.lines.reduce((sum, item) => sum + item.shippedQuantity, 0)} / {order.lines.reduce((sum, item) => sum + item.quantity, 0)}</td><td><div className="row-actions">
            {order.status === 'draft' && <button className="mini-button" disabled={readOnly || confirmOrder.isPending} onClick={() => confirm(order)} data-testid={`button-confirm-${order.id}`}><Check size={14} /> Confirmar</button>}
            {(order.status === 'confirmed' || order.status === 'partial') && remaining > 0 && <button className="mini-button mini-button-blue" disabled={readOnly} onClick={() => openDispatch(order)} data-testid={`button-dispatch-${order.id}`}><Truck size={14} /> Expedición</button>}
            {order.status === 'delivered' && <span className="text-muted">Listo para facturar</span>}
          </div></td></tr>;
        })}
        {!states.orders.loading && !states.orders.error && !actionable.length && <TableEmpty colSpan={7} title="Todavía no hay pedidos" detail="Crea el primer pedido para iniciar el ciclo de ventas simulado." />}
      </tbody></DataTable>
    </section>
    <div className="learning-note"><CircleHelp size={17} /><div><b>Secuencia de venta</b><p>Pedido borrador → confirmación y reserva → expedición parcial o completa → factura. Los importes y movimientos de stock se calculan solo en el entorno de prácticas.</p></div></div>
    {newOrder && <Modal title="Crear pedido simulado" onClose={() => setNewOrder(false)}>
      <form className="form-stack" onSubmit={submitOrder}>
        <p className="form-intro">Selecciona una empresa de la red y una referencia publicada. Se creará un pedido en estado borrador.</p>
        <label>Empresa compradora<select required value={buyerId} onChange={(e) => setBuyerId(e.target.value)} data-testid="select-order-buyer"><option value="">Selecciona una organización</option>{buyers.map((org) => <option value={org.id} key={org.id}>{org.name} · {org.island}</option>)}</select></label>
        <label>Producto o servicio<select required value={productId} onChange={(e) => setProductId(e.target.value)} data-testid="select-order-product"><option value="">Selecciona una referencia</option>{orderable.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.itemType === 'service' ? 'Servicio' : 'Producto'} · {money(product.unitPriceCents)} · {product.tracksInventory ? `disp. ${Math.max(0, product.stock - product.reserved)}` : 'sin stock'}</option>)}</select></label>
        <label>Unidades o servicios<input type="number" min={1} max={999} required value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} data-testid="input-order-quantity" /></label>
        {selectedProduct && <div className="calculation-box"><span>Subtotal estimado sin IGIC</span><strong>{money(selectedProduct.unitPriceCents * quantity)}</strong><small>El cálculo fiscal final se efectúa al emitir la factura simulada.</small></div>}
        {(!buyers.length || !orderable.length) && <div className="inline-error"><ShieldAlert size={16} />Faltan organizaciones compradoras activas o referencias publicadas para crear el pedido.</div>}
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setNewOrder(false)}>Cancelar</button><button className="button button-primary" disabled={createOrder.isPending || !buyers.length || !orderable.length} data-testid="button-submit-order">{createOrder.isPending ? 'Guardando…' : 'Crear borrador'}</button></div>
      </form>
    </Modal>}
    {dispatching && <Modal title={`${dispatching.lines.find((line) => line.quantity > line.shippedQuantity)?.itemType === 'service' ? 'Registrar prestación' : 'Expedir'} ${dispatching.reference}`} onClose={() => setDispatching(null)}>
      <form className="form-stack" onSubmit={dispatch}>
        <p className="form-intro">Registra la entrega del producto o la prestación del servicio. Puedes completar el pedido en varias partes.</p>
        <div className="dispatch-product"><PackageCheck size={18} /><div><b>{dispatching.lines.find((line) => line.quantity > line.shippedQuantity)?.productName}</b><small>Restan {dispatching.lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0)} unidades por completar</small></div></div>
        <label>Unidades de esta entrega o prestación<input type="number" min={1} max={dispatching.lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0)} value={dispatchQuantity} onChange={(e) => setDispatchQuantity(Number(e.target.value))} required data-testid="input-dispatch-quantity" /></label>
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setDispatching(null)}>Cancelar</button><button className="button button-primary" disabled={dispatchOrder.isPending}>{dispatchOrder.isPending ? 'Registrando…' : dispatching.lines.find((line) => line.quantity > line.shippedQuantity)?.itemType === 'service' ? 'Registrar prestación' : 'Registrar expedición'}</button></div>
      </form>
    </Modal>}
  </main>;
}

function InventoryPage({ products, orders, stateProducts, stateOrders }: {
  products?: Product[]; orders?: Order[]; stateProducts: DataState; stateOrders: DataState;
}) {
  const [search, setSearch] = useState('');
  const inventoryProducts = (products ?? []).filter((p) => p.tracksInventory);
  const rows = inventoryProducts.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(search.toLowerCase()));
  const totalAvailable = inventoryProducts.reduce((sum, p) => sum + Math.max(0, p.stock - p.reserved), 0);
  const totalReserved = inventoryProducts.reduce((sum, p) => sum + p.reserved, 0);
  const prepOrders = (orders ?? []).filter((order) => (order.status === 'confirmed' || order.status === 'partial') &&
    order.lines.some((line) => line.tracksInventory && line.shippedQuantity < line.quantity));
  return <main className="page-content">
    <PageHeading path="/almacen" />
    <SimulationNotice />
    <div className="sub-metrics">
      <div><span>Referencias de almacén</span><b>{products ? inventoryProducts.length : '—'}</b><small>Artículos con control de existencias</small></div>
      <div><span>Unidades disponibles</span><b>{stateProducts.loading ? '…' : totalAvailable}</b><small>Stock físico menos reservas</small></div>
      <div><span>Unidades reservadas</span><b>{stateProducts.loading ? '…' : totalReserved}</b><small>Comprometidas en pedidos</small></div>
    </div>
    <section className="panel">
      <div className="list-toolbar"><SectionTitle title="Existencias" subtitle="Incluye productos archivados y sin publicar." aside={<Link href="/productos" className="subtle-link">Gestionar catálogo <ArrowRight size={14} /></Link>} /><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar referencia" aria-label="Buscar existencias" data-testid="input-stock-search" /></label></div>
      <DataMessage state={stateProducts} />
      <DataTable minWidth={720}><thead><tr><th>Artículo</th><th>SKU</th><th>Tipo</th><th>En almacén</th><th>Reservado</th><th>Disponible</th><th>Estado de stock</th></tr></thead><tbody>
        {!stateProducts.loading && !stateProducts.error && rows.map((p) => {
          const available = Math.max(0, p.stock - p.reserved);
          const level = available === 0 ? 'Agotado' : available <= p.minimumStock ? 'Bajo' : 'Disponible';
          return <tr key={p.id} data-testid={`row-stock-${p.id}`}><td><div className="product-cell"><span className="product-glyph"><Package size={17} /></span><span><b>{p.name}</b><small className="table-secondary">{!p.isActive ? 'Archivado · fuera de venta' : p.isPublished ? 'Publicado' : 'Sin publicar'}</small></span></div></td><td className="mono">{p.sku}</td><td>{p.category}</td><td className="numeric">{p.stock}</td><td className="numeric">{p.reserved}</td><td className="numeric stock-value">{available}</td><td><span className={`stock-state ${level === 'Disponible' ? 'stock-ok' : level === 'Bajo' ? 'stock-low' : 'stock-empty'}`}><span />{level}</span></td></tr>;
        })}
        {!stateProducts.loading && !stateProducts.error && rows.length === 0 && <TableEmpty colSpan={7} title="No hay artículos en este filtro" detail="Prueba otra búsqueda o consulta el catálogo del mercado." />}
      </tbody></DataTable>
    </section>
    <section className="panel compact-panel"><SectionTitle title="Pedidos pendientes de preparación" subtitle="Solo muestra unidades inventariables pendientes de entrega." aside={<Link href="/ventas" className="subtle-link">Ir a ventas <ArrowRight size={14} /></Link>} />
      <DataMessage state={stateOrders} />
      {!stateOrders.loading && !stateOrders.error && prepOrders.length > 0 ? <div className="prep-list">{prepOrders.map((order) => <div className="prep-row" key={order.id}><span className="prep-icon"><Truck size={16} /></span><span><b>{order.reference}</b><small>{order.buyerName} · {order.lines.filter((line) => line.tracksInventory).reduce((a, line) => a + line.quantity - line.shippedQuantity, 0)} ud. pendientes</small></span><Status status={order.status} /></div>)}</div> : !stateOrders.loading && !stateOrders.error ? <EmptyState title="Almacén al día" detail="Los pedidos con productos inventariables confirmados aparecerán aquí." icon={PackageCheck} /> : null}
    </section>
  </main>;
}

function LogisticsPage({ orders, organizations, stateOrders, onRefresh, onNotice }: {
  orders?: Order[]; organizations?: Organization[]; stateOrders: DataState;
  onRefresh: () => void; onNotice: (message: string) => void;
}) {
  const identity = useGetCurrentIdentity();
  const queryClient = useQueryClient();
  const ordersQuery = useListFp360Orders<Order[]>();
  const productsQuery = useListFp360Products<Product[]>();
  const shipmentsQuery = useListFp360LogisticsShipments<LogisticsShipment[]>();
  const dispatchOrder = useDispatchFp360Order();
  const [tab, setTab] = useState<'dispatch' | 'tracking' | 'delivered' | 'analysis'>('dispatch');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [dispatching, setDispatching] = useState<Order | null>(null);
  const [dispatchQuantities, setDispatchQuantities] = useState<Record<string, number>>({});
  const [dispatchOperationId, setDispatchOperationId] = useState('');
  const readOnly = !identity.data || ['mentor', 'promoter'].includes(identity.data.role);
  const isSupervisor = identity.data?.role === 'administrator' || (identity.data?.role === 'teacher' && !identity.data.organizationId);
  const currentOrganization = organizations?.find((organization) => organization.id === identity.data?.organizationId);
  const shipmentRows = shipmentsQuery.data ?? [];
  const physicalLines = (order: Order) => order.lines.filter((line) => line.itemType === 'product');
  const canShipLine = (line: Order['lines'][number]) => {
    if (isSupervisor) return true;
    if (!identity.data?.organizationId || !currentOrganization || !['seller', 'both'].includes(currentOrganization.role)) return false;
    const product = productsQuery.data?.find((item) => item.id === line.productId);
    return Boolean(product && (!product.supplierOrganizationId || product.supplierOrganizationId === identity.data.organizationId));
  };
  const dispatchableLines = (order: Order) => physicalLines(order).filter(canShipLine);
  const shipmentProgress = (order: Order) => {
    const lines = physicalLines(order);
    return {
      total: lines.reduce((sum, line) => sum + line.quantity, 0),
      shipped: lines.reduce((sum, line) => sum + line.shippedQuantity, 0),
      remaining: lines.reduce((sum, line) => sum + line.quantity - line.shippedQuantity, 0),
    };
  };
  const physicalOrders = (orders ?? []).filter((order) => physicalLines(order).length > 0 && (
    isSupervisor ||
    shipmentRows.some((shipment) => shipment.orderId === order.id) ||
    dispatchableLines(order).some((line) => line.quantity > line.shippedQuantity)
  ));
  const awaitingDispatch = physicalOrders.filter((order) => dispatchableLines(order).some((line) => line.quantity > line.shippedQuantity));
  const inTransit = physicalOrders.filter((order) => shipmentRows.some((shipment) => shipment.orderId === order.id && shipment.status !== 'delivered'));
  const fullyShipped = physicalOrders.filter((order) => {
    const orderShipments = shipmentRows.filter((shipment) => shipment.orderId === order.id);
    return orderShipments.length > 0 && orderShipments.every((shipment) => shipment.status === 'delivered') && shipmentProgress(order).remaining === 0;
  });
  const tabOrders = tab === 'dispatch' ? awaitingDispatch : tab === 'tracking' ? inTransit : tab === 'delivered' ? fullyShipped : physicalOrders;
  const filteredOrders = tabOrders.filter((order) => `${order.reference} ${order.buyerName}`.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')));
  const selectedOrder = filteredOrders.find((order) => order.id === selectedId) ?? filteredOrders[0] ?? null;
  const buyer = organizations?.find((organization) => organization.id === selectedOrder?.buyerOrganizationId);
  const origin = organizations?.find((organization) => organization.id === identity.data?.organizationId);
  const completedShipments = shipmentRows.filter((shipment) => shipment.status === 'delivered').length;
  const openIncidents = shipmentRows.flatMap((shipment) => shipment.incidents).filter((incident) => incident.status === 'open').length;
  const progressPercent = shipmentRows.length ? Math.round((completedShipments / shipmentRows.length) * 100) : 0;
  const openDispatch = (order: Order) => {
    setDispatching(order);
    setDispatchOperationId(crypto.randomUUID());
    setDispatchQuantities(Object.fromEntries(dispatchableLines(order).filter((line) => line.quantity > line.shippedQuantity).map((line) => [line.productId, line.quantity - line.shippedQuantity])));
  };
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ordersQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: productsQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: shipmentsQuery.queryKey });
    onRefresh();
  };
  const submitDispatch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!dispatching) return;
    const lines = dispatchableLines(dispatching)
      .map((line) => ({ productId: line.productId, quantity: dispatchQuantities[line.productId] ?? 0 }))
      .filter((line) => line.quantity > 0);
    if (!lines.length) return;
    dispatchOrder.mutate({ id: dispatching.id, data: { operationId: dispatchOperationId, lines } }, {
      onSuccess: () => {
        setDispatching(null);
        refresh();
        onNotice(`Expedición simulada registrada para ${dispatching.reference}.`);
      },
      onError: () => onNotice('No se pudo registrar la expedición. Revisa las cantidades y el stock reservado.'),
    });
  };

  return <main className="page-content logistics-page">
    <PageHeading path="/logistica"><Link className="button button-primary" href="/ventas"><Plus size={15} /> Nueva operación</Link></PageHeading>
    <SimulationNotice />
    <div className="logistics-kpis">
      <div><span className="market-kpi-icon blue"><Truck size={16} /></span><small>Pedidos pendientes</small><b>{orders ? awaitingDispatch.length : '—'}</b><span>Con mercancía por expedir</span></div>
      <div><span className="market-kpi-icon amber"><Activity size={16} /></span><small>Expediciones en curso</small><b>{shipmentsQuery.data ? shipmentRows.filter((shipment) => shipment.status !== 'delivered').length : '—'}</b><span>Con ruta pendiente de recepción</span></div>
      <div><span className="market-kpi-icon green"><CheckCircle2 size={16} /></span><small>Entregas confirmadas</small><b>{shipmentsQuery.data ? completedShipments : '—'}</b><span>Confirmadas por destino</span></div>
      <div><span className="market-kpi-icon violet"><CircleAlert size={16} /></span><small>Incidencias abiertas</small><b>{shipmentsQuery.data ? openIncidents : '—'}</b><span>Requieren resolución</span></div>
    </div>
    <section className="logistics-disclaimer"><ShieldAlert size={15} /><span>Las rutas, transportistas y fechas son datos simulados introducidos por la organización. No se calculan distancias, costes ni geolocalización reales.</span></section>
    <div className="logistics-workspace">
      <section className="panel logistics-list-panel">
        <div className="market-section-heading"><div><h2>Operaciones logísticas</h2><p>Expediciones vinculadas a pedidos y mercancía disponible.</p></div><Link href="/almacen" className="market-text-link">Ver almacén <ArrowRight size={13} /></Link></div>
        <div className="market-table-toolbar">
          <div className="tabs" role="tablist" aria-label="Vistas logísticas">
            <button className={tab === 'dispatch' ? 'tab-active' : ''} onClick={() => setTab('dispatch')} role="tab" aria-selected={tab === 'dispatch'}><Truck size={14} /> Expediciones</button>
            <button className={tab === 'tracking' ? 'tab-active' : ''} onClick={() => setTab('tracking')} role="tab" aria-selected={tab === 'tracking'}><Activity size={14} /> Seguimiento</button>
            <button className={tab === 'delivered' ? 'tab-active' : ''} onClick={() => setTab('delivered')} role="tab" aria-selected={tab === 'delivered'}><CheckCircle2 size={14} /> Entregas</button>
            <button className={tab === 'analysis' ? 'tab-active' : ''} onClick={() => setTab('analysis')} role="tab" aria-selected={tab === 'analysis'}><BarChart3 size={14} /> Análisis</button>
          </div>
          <label className="search-field market-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar pedido o destinatario…" aria-label="Buscar operaciones logísticas" /></label>
        </div>
        {tab === 'analysis' ? <div className="logistics-analysis">
          <div className="logistics-analysis-stat"><span>Pedidos con mercancía</span><b>{orders ? physicalOrders.length : '—'}</b></div>
          <div className="logistics-analysis-stat"><span>Con expedición parcial</span><b>{orders ? inTransit.length : '—'}</b></div>
          <div className="logistics-analysis-stat"><span>Mercancía expedida al completo</span><b>{orders ? fullyShipped.length : '—'}</b></div>
          <div className="logistics-progress"><div><span>Entregas confirmadas</span><b>{shipmentRows.length ? `${progressPercent}%` : 'Sin expediciones'}</b></div><div className="market-progress-track"><span style={{ width: `${progressPercent}%` }} /></div><small>{shipmentRows.length ? `${completedShipments} de ${shipmentRows.length} expediciones confirmadas por destino` : 'El análisis se calculará cuando existan expediciones.'}</small></div>
          <p>Las rutas y transportistas se registran como datos simulados. No se estiman distancias ni costes; la puntualidad requiere fechas previstas.</p>
        </div> : <>
          <DataMessage state={stateOrders} />
          <DataTable minWidth={680}><thead><tr><th>Pedido / expedición</th><th>Empresa destinataria</th><th>Contenido</th><th>Fecha pedido</th><th>Estado</th></tr></thead><tbody>
            {!stateOrders.loading && !stateOrders.error && filteredOrders.map((order) => {
              const progress = shipmentProgress(order);
              return <tr key={order.id} className={selectedOrder?.id === order.id ? 'market-selected-row' : ''} data-testid={`row-logistics-${order.id}`}>
                <td><button className="market-row-select" onClick={() => setSelectedId(order.id)}><b className="mono">{order.reference}</b><small>{origin?.name ?? 'Origen de la red'}</small></button></td>
                <td>{order.buyerName}{buyer && <small className="table-secondary block">{buyer.center} · {buyer.island}</small>}</td>
                <td>{progress.shipped} / {progress.total} unidades</td><td>{dateLabel(order.simulatedDate)}</td><td><Status status={order.status} /></td>
              </tr>;
            })}
            {!stateOrders.loading && !stateOrders.error && !filteredOrders.length && <TableEmpty colSpan={5} title={tab === 'dispatch' ? 'No hay expediciones pendientes' : tab === 'tracking' ? 'Sin entregas parciales' : 'No hay entregas completadas'} detail="Los pedidos y sus cantidades se consultan desde el servidor." />}
          </tbody></DataTable>
          <div className="table-footer"><span>{filteredOrders.length} operaciones</span><span>Datos persistidos del escenario</span></div>
        </>}
      </section>
      <aside className="panel logistics-detail-panel">
        {selectedOrder && tab !== 'analysis' ? <>
          <div className="market-context-heading"><span className="market-context-icon"><Truck size={17} /></span><div><small>DETALLE DE EXPEDICIÓN</small><h2>{selectedOrder.reference}</h2><span>Pedido · {dateLabel(selectedOrder.simulatedDate)}</span></div></div>
          <dl className="market-context-list">
            <div><dt>Origen</dt><dd>{origin?.name ?? 'Empresa de la red'}</dd></div>
            <div><dt>Destino</dt><dd>{buyer?.name ?? selectedOrder.buyerName}</dd></div>
            <div><dt>Centro / isla</dt><dd>{buyer ? `${buyer.center} · ${buyer.island}` : 'No disponible'}</dd></div>
            <div><dt>Estado</dt><dd><Status status={selectedOrder.status} /></dd></div>
          </dl>
          <div className="market-context-subtitle">Mercancía del pedido</div>
          <div className="market-context-listing">{selectedOrder.lines.map((line) => <div key={line.productId}><span>{line.productName}<small>{line.itemType === 'service' ? 'Servicio · se registra en Ventas' : `${line.shippedQuantity}/${line.quantity} unidades expedidas`}</small></span><b>{line.itemType === 'service' ? '—' : `${Math.max(0, line.quantity - line.shippedQuantity)} pendientes`}</b></div>)}</div>
          {tab === 'dispatch' && shipmentProgress(selectedOrder).remaining > 0 && <button className="button button-primary market-context-cta" disabled={readOnly} onClick={() => openDispatch(selectedOrder)} data-testid={`button-logistics-dispatch-${selectedOrder.id}`}><Truck size={14} /> Registrar expedición simulada</button>}
          {tab === 'delivered' && <Link href="/facturas" className="button button-primary market-context-cta">Continuar a facturación <ArrowRight size={14} /></Link>}
          {(tab === 'tracking' || tab === 'delivered') && <p className="logistics-note">El historial de ruta, recepción e incidencias está en el panel de expediciones registradas.</p>}
        </> : <div className="market-context-empty"><Truck size={21} /><b>{tab === 'analysis' ? 'Resumen del escenario' : 'Selecciona una operación'}</b><span>{tab === 'analysis' ? 'Indicadores calculados con pedidos y cantidades expedidas.' : 'El panel mostrará el detalle del pedido seleccionado.'}</span></div>}
      </aside>
    </div>
    <LogisticsShipmentsPanel organizations={organizations} onRefresh={refresh} onNotice={onNotice} />
    <div className="market-quick-actions">
      <Link href="/ventas"><ShoppingCart size={14} /> Gestionar pedidos</Link>
      <Link href="/almacen"><Package size={14} /> Revisar existencias</Link>
      <Link href="/compras"><FileText size={14} /> Recepciones de compra</Link>
      <Link href="/documentacion"><BookOpen size={14} /> Consultar documentación</Link>
    </div>
    {dispatching && <Modal title={`Registrar expedición · ${dispatching.reference}`} onClose={() => setDispatching(null)}>
      <form className="form-stack" onSubmit={submitDispatch}>
        <p className="form-intro">Indica las cantidades que salen del almacén en esta entrega. La operación es simulada y se registra de forma transaccional.</p>
        {dispatchableLines(dispatching).filter((line) => line.quantity > line.shippedQuantity).map((line) => <label key={line.productId}>{line.productName} · {line.quantity - line.shippedQuantity} pendientes<input type="number" min={0} max={line.quantity - line.shippedQuantity} value={dispatchQuantities[line.productId] ?? 0} onChange={(event) => setDispatchQuantities((current) => ({ ...current, [line.productId]: Number(event.target.value) }))} data-testid={`input-logistics-quantity-${line.productId}`} /></label>)}
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setDispatching(null)}>Cancelar</button><button className="button button-primary" disabled={dispatchOrder.isPending || !Object.values(dispatchQuantities).some((quantity) => quantity > 0)}>{dispatchOrder.isPending ? 'Registrando…' : 'Confirmar salida'}</button></div>
      </form>
    </Modal>}
  </main>;
}

function LogisticsShipmentsPanel({ organizations, onRefresh, onNotice }: {
  organizations?: Organization[];
  onRefresh: () => void;
  onNotice: (message: string) => void;
}) {
  const identity = useGetCurrentIdentity();
  const queryClient = useQueryClient();
  const shipmentsQuery = useListFp360LogisticsShipments<LogisticsShipment[]>();
  const updateRoute = useUpdateFp360LogisticsRoute();
  const confirmDelivery = useConfirmFp360LogisticsDelivery();
  const createIncident = useCreateFp360LogisticsIncident();
  const resolveIncident = useResolveFp360LogisticsIncident();
  const [selectedId, setSelectedId] = useState('');
  const [routeModal, setRouteModal] = useState<LogisticsShipment | null>(null);
  const [incidentModal, setIncidentModal] = useState<LogisticsShipment | null>(null);
  const [deliveryModal, setDeliveryModal] = useState<LogisticsShipment | null>(null);
  const [resolutionModal, setResolutionModal] = useState<{ shipment: LogisticsShipment; incident: LogisticsShipment['incidents'][number] } | null>(null);
  const [routeName, setRouteName] = useState('');
  const [carrierName, setCarrierName] = useState('');
  const [parcelCount, setParcelCount] = useState(1);
  const [plannedDeliveryDate, setPlannedDeliveryDate] = useState('');
  const [incidentType, setIncidentType] = useState<'delay' | 'damage' | 'missing' | 'address' | 'rejected' | 'other'>('delay');
  const [incidentDescription, setIncidentDescription] = useState('');
  const [affectedQuantity, setAffectedQuantity] = useState(0);
  const [deliveryNote, setDeliveryNote] = useState('');
  const [deliveryQuantities, setDeliveryQuantities] = useState<Record<string, number>>({});
  const [resolution, setResolution] = useState('');
  const [resolutionOutcome, setResolutionOutcome] = useState<'resume' | 'close_partial'>('resume');
  const [operationId, setOperationId] = useState('');
  const shipments = shipmentsQuery.data ?? [];
  const selectedShipment = shipments.find((shipment) => shipment.id === selectedId) ?? shipments[0] ?? null;
  const isSupervisor = identity.data?.role === 'administrator' || (identity.data?.role === 'teacher' && !identity.data.organizationId);
  const readOnly = !identity.data || ['mentor', 'promoter'].includes(identity.data.role);
  const currentOrganization = organizations?.find((organization) => organization.id === identity.data?.organizationId);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: shipmentsQuery.queryKey });
    onRefresh();
  };
  const canPlan = (shipment: LogisticsShipment) => !readOnly && (isSupervisor || Boolean(identity.data?.organizationId && identity.data.organizationId === shipment.originOrganizationId));
  const canReceive = (shipment: LogisticsShipment) => !readOnly && (isSupervisor || Boolean(identity.data?.organizationId && identity.data.organizationId === shipment.destinationOrganizationId));
  const canParticipate = (shipment: LogisticsShipment) => !readOnly && (isSupervisor || Boolean(identity.data?.organizationId && [shipment.originOrganizationId, shipment.destinationOrganizationId].includes(identity.data.organizationId)));
  const openRoute = (shipment: LogisticsShipment) => {
    setRouteModal(shipment);
    setRouteName(shipment.routeName ?? '');
    setCarrierName(shipment.carrierName ?? '');
    setParcelCount(shipment.parcelCount);
    setPlannedDeliveryDate(shipment.plannedDeliveryDate ?? '');
    setOperationId(crypto.randomUUID());
  };
  const openIncident = (shipment: LogisticsShipment) => {
    setIncidentModal(shipment);
    setIncidentType('delay');
    setIncidentDescription('');
    setAffectedQuantity(0);
    setOperationId(crypto.randomUUID());
  };
  const openDelivery = (shipment: LogisticsShipment) => {
    setDeliveryModal(shipment);
    setDeliveryNote('');
    setDeliveryQuantities(Object.fromEntries(shipment.lines.map((line) => [line.productId, line.quantity - line.receivedQuantity])));
    setOperationId(crypto.randomUUID());
  };
  const submitRoute = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!routeModal) return;
    updateRoute.mutate({ id: routeModal.id, data: {
      operationId, routeName, carrierName, parcelCount,
      plannedDeliveryDate: plannedDeliveryDate || null,
    } }, {
      onSuccess: () => {
        setRouteModal(null);
        refresh();
        onNotice(`Ruta simulada guardada para ${routeModal.reference}.`);
      },
      onError: () => onNotice('No se pudo guardar la planificación de ruta.'),
    });
  };
  const submitIncident = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!incidentModal) return;
    createIncident.mutate({ id: incidentModal.id, data: {
      operationId, type: incidentType, description: incidentDescription, affectedQuantity,
    } }, {
      onSuccess: () => {
        setIncidentModal(null);
        refresh();
        onNotice(`Incidencia registrada en ${incidentModal.reference}.`);
      },
      onError: () => onNotice('No se pudo registrar la incidencia. Revisa la cantidad afectada.'),
    });
  };
  const submitDelivery = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!deliveryModal) return;
    confirmDelivery.mutate({ id: deliveryModal.id, data: {
      operationId,
      deliveryNote,
      lines: deliveryModal.lines.map((line) => ({
        productId: line.productId,
        receivedQuantity: deliveryQuantities[line.productId] ?? line.quantity - line.receivedQuantity,
      })),
    } }, {
      onSuccess: () => {
        setDeliveryModal(null);
        refresh();
        onNotice(`Recepción confirmada para ${deliveryModal.reference}.`);
      },
      onError: () => onNotice('No se pudo confirmar la recepción. Comprueba que no haya incidencias abiertas.'),
    });
  };
  const submitResolution = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!resolutionModal) return;
    resolveIncident.mutate({ id: resolutionModal.shipment.id, incidentId: resolutionModal.incident.id, data: { operationId, resolution, outcome: resolutionOutcome } }, {
      onSuccess: () => {
        setResolutionModal(null);
        refresh();
        onNotice('Incidencia resuelta; la expedición puede continuar.');
      },
      onError: () => onNotice('No se pudo resolver la incidencia.'),
    });
  };

  return <section className="panel logistics-records">
    <div className="market-section-heading"><div><h2>Expediciones registradas</h2><p>Planificación, confirmación de entrega e incidencias con historial auditable.</p></div><span className="market-context-icon"><Activity size={16} /></span></div>
    <DataMessage state={{ loading: shipmentsQuery.isLoading, error: shipmentsQuery.isError }} />
    {!shipmentsQuery.isLoading && !shipmentsQuery.isError && shipments.length === 0 && <EmptyState title="Todavía no hay expediciones" detail="Cuando se registre una salida de mercancía, aquí podrás asignar ruta, transportista y fecha prevista." icon={Truck} />}
    {shipments.length > 0 && <div className="logistics-record-layout">
      <div className="logistics-record-list" role="list" aria-label="Expediciones registradas">
        {shipments.map((shipment) => <button key={shipment.id} className={`logistics-record-row ${selectedShipment?.id === shipment.id ? 'logistics-record-selected' : ''}`} onClick={() => setSelectedId(shipment.id)} role="listitem" data-testid={`shipment-${shipment.id}`}>
          <span className="logistics-record-row-top"><b className="mono">{shipment.reference}</b><Status status={shipment.status} /></span>
          <span>{shipment.orderReference} · {shipment.destinationName}</span>
          <small>{shipment.lines.reduce((sum, line) => sum + line.quantity, 0)} unidades · {shipment.routeName ?? 'Ruta sin planificar'}</small>
        </button>)}
      </div>
      {selectedShipment && <div className="logistics-record-detail">
        <div className="market-context-heading"><span className="market-context-icon"><Truck size={17} /></span><div><small>EXPEDICIÓN · {selectedShipment.orderReference}</small><h3>{selectedShipment.reference}</h3><span>{selectedShipment.originName ?? currentOrganization?.name ?? 'Origen de red'} → {selectedShipment.destinationName}</span></div></div>
        <div className="logistics-route-summary">
          <span><small>Ruta</small><b>{selectedShipment.routeName ?? 'Sin planificar'}</b></span>
          <span><small>Transportista simulado</small><b>{selectedShipment.carrierName ?? 'Sin asignar'}</b></span>
          <span><small>Bultos</small><b>{selectedShipment.parcelCount}</b></span>
          <span><small>Fecha prevista</small><b>{selectedShipment.plannedDeliveryDate ? dateLabel(selectedShipment.plannedDeliveryDate) : 'No indicada'}</b></span>
        </div>
        <div className="market-context-subtitle">Mercancía expedida</div>
        <div className="market-context-listing">{selectedShipment.lines.map((line) => <div key={line.productId}><span>{line.productName}<small>{line.receivedQuantity}/{line.quantity} unidades recibidas</small></span><b>{line.quantity - line.receivedQuantity} pendientes</b></div>)}</div>
        <div className="logistics-record-actions">
          {canPlan(selectedShipment) && selectedShipment.status !== 'delivered' && <button className="button button-secondary" onClick={() => openRoute(selectedShipment)}><Truck size={14} /> Planificar ruta</button>}
          {canParticipate(selectedShipment) && selectedShipment.status !== 'delivered' && <button className="button button-secondary" onClick={() => openIncident(selectedShipment)}><CircleAlert size={14} /> Registrar incidencia</button>}
          {canReceive(selectedShipment) && selectedShipment.status === 'in_transit' && <button className="button button-primary" onClick={() => openDelivery(selectedShipment)}><CheckCircle2 size={14} /> Confirmar recepción</button>}
        </div>
        {selectedShipment.incidents.length > 0 && <div className="logistics-incidents">
          <div className="market-context-subtitle">Incidencias</div>
          {selectedShipment.incidents.map((incident) => <div className={`logistics-incident ${incident.status === 'open' ? 'incident-open' : ''}`} key={incident.id}>
            <div><b>{incident.type} · {incident.status === 'open' ? 'Abierta' : 'Resuelta'}</b><small>{incident.description}</small><small>Unidades afectadas: {incident.affectedQuantity} · Registró {incident.createdByName}</small>{incident.resolution && <small>Resolución: {incident.resolution}</small>}</div>
            {incident.status === 'open' && canParticipate(selectedShipment) && <button className="mini-button" onClick={() => { setResolutionModal({ shipment: selectedShipment, incident }); setResolution(''); setResolutionOutcome('resume'); setOperationId(crypto.randomUUID()); }}>Resolver</button>}
          </div>)}
        </div>}
        <div className="market-context-subtitle">Historial de operación</div>
        <ol className="logistics-event-timeline">{selectedShipment.events.map((event) => <li key={event.id}><span className="event-dot" /><div><b>{event.eventType.replaceAll('_', ' ')}</b><small>{event.description}</small><small>{event.actorName} · {dateLabel(event.createdAt)}</small></div><Status status={event.status} /></li>)}</ol>
      </div>}
    </div>}
    {routeModal && <Modal title={`Planificar ruta · ${routeModal.reference}`} onClose={() => setRouteModal(null)}>
      <form className="form-stack" onSubmit={submitRoute}>
        <p className="form-intro">Introduce datos simulados del recorrido. No se consultan mapas ni se calculan distancias o costes reales.</p>
        <label>Ruta o itinerario<input required minLength={2} maxLength={120} value={routeName} onChange={(event) => setRouteName(event.target.value)} /></label>
        <label>Transportista simulado<input required minLength={2} maxLength={100} value={carrierName} onChange={(event) => setCarrierName(event.target.value)} /></label>
        <label>Número de bultos<input type="number" min={1} max={9999} required value={parcelCount} onChange={(event) => setParcelCount(Number(event.target.value))} /></label>
        <label>Fecha prevista<input type="date" min="2027-09-15" value={plannedDeliveryDate} onChange={(event) => setPlannedDeliveryDate(event.target.value)} /></label>
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setRouteModal(null)}>Cancelar</button><button className="button button-primary" disabled={updateRoute.isPending}>{updateRoute.isPending ? 'Guardando…' : 'Guardar planificación'}</button></div>
      </form>
    </Modal>}
    {incidentModal && <Modal title={`Registrar incidencia · ${incidentModal.reference}`} onClose={() => setIncidentModal(null)}>
      <form className="form-stack" onSubmit={submitIncident}>
        <label>Tipo<select value={incidentType} onChange={(event) => setIncidentType(event.target.value as typeof incidentType)}><option value="delay">Retraso</option><option value="damage">Daño</option><option value="missing">Faltante</option><option value="address">Dirección</option><option value="rejected">Rechazo</option><option value="other">Otra</option></select></label>
        <label>Descripción<textarea required minLength={5} maxLength={500} value={incidentDescription} onChange={(event) => setIncidentDescription(event.target.value)} /></label>
        <label>Unidades afectadas<input type="number" min={0} max={incidentModal.lines.reduce((sum, line) => sum + line.quantity, 0)} required value={affectedQuantity} onChange={(event) => setAffectedQuantity(Number(event.target.value))} /></label>
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setIncidentModal(null)}>Cancelar</button><button className="button button-primary" disabled={createIncident.isPending}>{createIncident.isPending ? 'Registrando…' : 'Registrar incidencia'}</button></div>
      </form>
    </Modal>}
    {deliveryModal && <Modal title={`Confirmar recepción · ${deliveryModal.reference}`} onClose={() => setDeliveryModal(null)}>
      <form className="form-stack" onSubmit={submitDelivery}>
        <p className="form-intro">Indica cuántas unidades ha recibido tu organización. Las diferencias abrirán una incidencia y bloquearán la facturación hasta resolverla.</p>
        {deliveryModal.lines.map((line) => <label key={line.productId}>{line.productName} · {line.quantity - line.receivedQuantity} pendientes<input type="number" min={0} max={line.quantity - line.receivedQuantity} required value={deliveryQuantities[line.productId] ?? 0} onChange={(event) => setDeliveryQuantities((current) => ({ ...current, [line.productId]: Number(event.target.value) }))} /></label>)}
        <label>Nota de recepción<textarea maxLength={300} value={deliveryNote} onChange={(event) => setDeliveryNote(event.target.value)} /></label>
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setDeliveryModal(null)}>Cancelar</button><button className="button button-primary" disabled={confirmDelivery.isPending}>{confirmDelivery.isPending ? 'Confirmando…' : 'Confirmar entrega'}</button></div>
      </form>
    </Modal>}
    {resolutionModal && <Modal title={`Resolver incidencia · ${resolutionModal.shipment.reference}`} onClose={() => setResolutionModal(null)}>
      <form className="form-stack" onSubmit={submitResolution}>
        <p className="form-intro">{resolutionModal.incident.description}</p>
        <label>Resolución aplicada<textarea required minLength={5} maxLength={500} value={resolution} onChange={(event) => setResolution(event.target.value)} /></label>
        <label>Resultado<select value={resolutionOutcome} onChange={(event) => setResolutionOutcome(event.target.value as typeof resolutionOutcome)}><option value="resume">Continuar el transporte</option>{resolutionModal.shipment.lines.some((line) => line.receivedQuantity > 0 && line.receivedQuantity < line.quantity) && <option value="close_partial">Cerrar con entrega parcial</option>}</select></label>
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setResolutionModal(null)}>Cancelar</button><button className="button button-primary" disabled={resolveIncident.isPending}>{resolveIncident.isPending ? 'Guardando…' : 'Resolver incidencia'}</button></div>
      </form>
    </Modal>}
  </section>;
}

function InvoicesPage({ invoices, orders, stateInvoices, stateOrders, onRefresh, onNotice }: {
  invoices?: Invoice[]; orders?: Order[]; stateInvoices: DataState; stateOrders: DataState;
  onRefresh: () => void; onNotice: (message: string) => void;
}) {
  const identity = useGetCurrentIdentity();
  const readOnly = !identity.data || ['promoter', 'mentor'].includes(identity.data.role);
  const queryClient = useQueryClient();
  const invoiceQuery = useListFp360Invoices<Invoice[]>();
  const orderQuery = useListFp360Orders<Order[]>();
  const logisticsQuery = useListFp360LogisticsShipments<LogisticsShipment[]>();
  const issueInvoice = useIssueFp360Invoice();
  const recordPayment = useRecordFp360Payment();
  const [paymentTarget, setPaymentTarget] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentOperationId, setPaymentOperationId] = useState('');
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  const [tab, setTab] = useState<'all' | 'due'>('all');
  const refreshInvoices = () => { void queryClient.invalidateQueries({ queryKey: invoiceQuery.queryKey }); void queryClient.invalidateQueries({ queryKey: orderQuery.queryKey }); void queryClient.invalidateQueries({ queryKey: logisticsQuery.queryKey }); onRefresh(); };
  const invoiceableQuantity = (order: Order, line: Order['lines'][number]) => {
    const hasShipment = (logisticsQuery.data ?? []).some((shipment) => shipment.orderId === order.id);
    return (hasShipment ? line.receivedQuantity : line.shippedQuantity) - line.invoicedQuantity;
  };
  const issuable = logisticsQuery.isLoading || logisticsQuery.isError ? [] : (orders ?? []).filter((order) =>
    ['delivered', 'invoiced', 'paid'].includes(order.status) &&
    order.lines.some((line) => invoiceableQuantity(order, line) > 0),
  );
  const issue = (order: Order) => issueInvoice.mutate({ data: { orderId: order.id } }, {
    onSuccess: () => { refreshInvoices(); onNotice('Factura simulada emitida a partir de las unidades recibidas.'); },
    onError: () => onNotice('No se pudo emitir la factura. Confirma la recepción y resuelve las incidencias pendientes.'),
  });
  const startPayment = (invoice: Invoice) => {
    setPaymentTarget(invoice);
    const key = paymentOperationKey(invoice.id);
    const retained = readPaymentAttempt(key);
    const retainedAmount = retained?.amountCents || invoice.balanceCents;
    const retainedId = retained?.operationId || crypto.randomUUID();
    setPaymentAmount((retainedAmount / 100).toFixed(2));
    setPaymentAttempted(retained?.attempted ?? false);
    setPaymentOperationId(retainedId);
    writePaymentAttempt(key, { operationId: retainedId, amountCents: retainedAmount, attempted: retained?.attempted ?? false });
  };
  const changePaymentAmount = (value: string) => {
    if (paymentAttempted) return;
    setPaymentAmount(value);
    if (!paymentTarget) return;
    const nextOperationId = crypto.randomUUID();
    const amountCents = Math.round(Number(value.replace(',', '.')) * 100);
    setPaymentOperationId(nextOperationId);
    writePaymentAttempt(paymentOperationKey(paymentTarget.id), {
      operationId: nextOperationId,
      amountCents: Number.isFinite(amountCents) ? amountCents : 0,
      attempted: false,
    });
  };
  const payment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentTarget) return;
    const amountCents = Math.round(Number(paymentAmount.replace(',', '.')) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > paymentTarget.balanceCents) return;
    setPaymentAttempted(true);
    writePaymentAttempt(paymentOperationKey(paymentTarget.id), { operationId: paymentOperationId, amountCents, attempted: true });
    recordPayment.mutate({ id: paymentTarget.id, data: { amountCents, operationId: paymentOperationId } }, {
      onSuccess: () => { writePaymentAttempt(paymentOperationKey(paymentTarget.id), null); setPaymentTarget(null); setPaymentOperationId(''); setPaymentAttempted(false); refreshInvoices(); onNotice('Cobro simulado registrado en la factura.'); },
      onError: () => onNotice('No se pudo confirmar el pago. Reintenta con el mismo importe e identificador de operación.'),
    });
  };
  const shownInvoices = (invoices ?? []).filter((invoice) => tab === 'all' || invoice.balanceCents > 0);
  const outstanding = (invoices ?? []).reduce((sum, invoice) => sum + invoice.balanceCents, 0);
  return <main className="page-content">
    <PageHeading path="/facturas" />
    {readOnly && <p role="status">Tu perfil permite consultar las facturas, pero no emitir documentos ni registrar pagos.</p>}
    <SimulationNotice />
    <div className="metrics-grid invoice-metrics">
      <Metric label="Facturas emitidas" value={String(invoices?.length ?? '—')} hint="Documentos del escenario" icon={FileCheck2} />
      <Metric label="Pendiente de cobro" value={money(outstanding)} hint="Saldo abierto simulado" icon={ArrowDownLeft} accent="amber" />
      <Metric label="Cobrado" value={money((invoices ?? []).reduce((sum, i) => sum + i.paidCents, 0))} hint="Pagos registrados" icon={Banknote} accent="green" />
    </div>
    <section className="panel">
      <SectionTitle title="Emitir factura" subtitle="Solo se facturan unidades recibidas y sin incidencias abiertas." />
      <DataMessage state={stateOrders} />
      <DataMessage state={{ loading: logisticsQuery.isLoading, error: logisticsQuery.isError, retry: () => void queryClient.invalidateQueries({ queryKey: logisticsQuery.queryKey }) }} />
      {!stateOrders.loading && !stateOrders.error && !logisticsQuery.isLoading && !logisticsQuery.isError && (issuable.length ? <div className="invoice-eligible">
        {issuable.map((order) => <div className="eligible-row" key={order.id}><span className="eligible-icon"><ReceiptText size={17} /></span><div className="eligible-copy"><b>{order.reference} <span>· {order.buyerName}</span></b><small>{order.lines.filter((line) => invoiceableQuantity(order, line) > 0).map((line) => `${invoiceableQuantity(order, line)} × ${line.productName}`).join(', ')}</small></div><button className="button button-secondary" disabled={readOnly || issueInvoice.isPending} onClick={() => issue(order)} data-testid={`button-issue-${order.id}`}><Plus size={15} /> Emitir</button></div>)}
      </div> : <div className="issuance-empty"><FileCheck2 size={19} /><span><b>No hay recepciones pendientes de facturar</b><small>Confirma la recepción logística para habilitar la factura correspondiente.</small></span><Link href="/logistica" className="text-button">Ver logística <ArrowRight size={14} /></Link></div>)}
    </section>
    <section className="panel">
      <div className="list-toolbar"><SectionTitle title="Facturas" subtitle="Documentos y pagos asociados a pedidos simulados." /><div className="tabs small-tabs"><button className={tab === 'all' ? 'tab-active' : ''} onClick={() => setTab('all')}>Todas</button><button className={tab === 'due' ? 'tab-active' : ''} onClick={() => setTab('due')}>Pendientes</button></div></div>
      <DataMessage state={stateInvoices} />
      <DataTable minWidth={900}><thead><tr><th>Factura</th><th>Empresa</th><th>Fecha emitida</th><th>Vencimiento</th><th>Base</th><th>IGIC</th><th>Total</th><th>Saldo</th><th>Estado / acción</th></tr></thead><tbody>
        {!stateInvoices.loading && !stateInvoices.error && shownInvoices.map((invoice) => <tr key={invoice.id} data-testid={`row-invoice-${invoice.id}`}><td><b className="mono ref">{invoice.reference}</b><small className="table-secondary block">Pedido {invoice.orderId}</small></td><td>{invoice.buyerName}</td><td>{dateLabel(invoice.simulatedDate)}</td><td>{invoice.dueDate ? dateLabel(invoice.dueDate) : '—'}</td><td>{money(invoice.baseCents)}</td><td>{money(invoice.igicCents)}</td><td className="price-cell">{money(invoice.totalCents)}</td><td className={invoice.balanceCents ? 'balance-due' : 'balance-paid'}>{money(invoice.balanceCents)}</td><td><div className="invoice-action"><Status status={invoice.status} />{invoice.balanceCents > 0 && <button className="mini-button" disabled={readOnly} onClick={() => startPayment(invoice)} data-testid={`button-payment-${invoice.id}`}>Registrar pago</button>}</div></td></tr>)}
        {!stateInvoices.loading && !stateInvoices.error && shownInvoices.length === 0 && <TableEmpty colSpan={9} title={tab === 'due' ? 'Sin saldos pendientes' : 'Aún no hay facturas'} detail={tab === 'due' ? 'Todas las facturas registradas están pagadas.' : 'Emite una factura tras registrar una expedición simulada.'} />}
      </tbody></DataTable>
    </section>
    <div className="learning-note"><CircleHelp size={17} /><div><b>IGIC y pagos en el escenario</b><p>Los tipos y cuotas de IGIC son datos didácticos de la ficha de producto. La factura no tiene validez fiscal y los pagos no mueven dinero real ni conectan con entidades bancarias.</p></div></div>
    {paymentTarget && <Modal title={`Registrar pago · ${paymentTarget.reference}`} onClose={() => setPaymentTarget(null)}>
      <form className="form-stack" onSubmit={payment}>
        <div className="payment-summary"><span>Saldo pendiente</span><strong>{money(paymentTarget.balanceCents)}</strong></div>
        <label>Importe del pago (EUR)<input type="number" min="0.01" step="0.01" max={(paymentTarget.balanceCents / 100).toFixed(2)} required value={paymentAmount} onChange={(e) => changePaymentAmount(e.target.value)} disabled={paymentAttempted || recordPayment.isPending} data-testid="input-payment-amount" /></label>
        {paymentAttempted && <small className="field-hint">Se conserva el importe enviado para que un reintento no genere un segundo cobro.</small>}
        <p className="field-hint">Se admite un cobro parcial. Importe máximo: {money(paymentTarget.balanceCents)}.</p>
        <SimulationNotice compact />
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setPaymentTarget(null)}>Cancelar</button><button className="button button-primary" disabled={recordPayment.isPending}>{recordPayment.isPending ? 'Registrando…' : 'Registrar pago simulado'}</button></div>
      </form>
    </Modal>}
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
  const organizationsQuery = useListFp360Organizations<Organization[]>();
  const productsQuery = useListFp360Products<Product[]>();
  const ordersQuery = useListFp360Orders<Order[]>();
  const invoicesQuery = useListFp360Invoices<Invoice[]>();
  const retryAll = () => { void queryClient.invalidateQueries(); };
  const states = {
    organizations: { loading: organizationsQuery.isLoading, error: organizationsQuery.isError, retry: retryAll },
    products: { loading: productsQuery.isLoading, error: productsQuery.isError, retry: retryAll },
    orders: { loading: ordersQuery.isLoading, error: ordersQuery.isError, retry: retryAll },
    invoices: { loading: invoicesQuery.isLoading, error: invoicesQuery.isError, retry: retryAll },
  };
  const page = useMemo(() => {
    switch (location) {
      case '/': return <DirectionPage actorRole={identity.role} />;
      case '/mercado': return <MarketPage organizations={organizationsQuery.data} products={productsQuery.data} orders={ordersQuery.data} stateOrg={states.organizations} stateProducts={states.products} stateOrders={states.orders} />;
      case '/ventas': return <SalesPage products={productsQuery.data} organizations={organizationsQuery.data} orders={ordersQuery.data} states={{ products: states.products, organizations: states.organizations, orders: states.orders }} onRefresh={() => { void queryClient.invalidateQueries({ queryKey: getGetFp360DashboardQueryKey() }); void queryClient.invalidateQueries(); }} onNotice={setNotice} />;
      case '/compras': return <PurchasesPage onNotice={setNotice} />;
      case '/almacen': return <InventoryPage products={productsQuery.data} orders={ordersQuery.data} stateProducts={states.products} stateOrders={states.orders} />;
      case '/logistica': return <LogisticsPage orders={ordersQuery.data} organizations={organizationsQuery.data} stateOrders={states.orders} onRefresh={retryAll} onNotice={setNotice} />;
      case '/contabilidad': return <AccountingPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/tesoreria': return <TreasuryPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/banco': return <BankPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/hacienda': return <HaciendaPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/recursos-humanos': return <HumanResourcesPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/empleo': return <EmploymentPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/comunicaciones': return <CommunicationsPage identity={identity} organizationId={identity.organizationId ?? null} organizations={organizationsQuery.data ?? []} onNotice={setNotice} />;
      case '/simulaciones': return <SimulationCampaignsPage identity={{ role: identity.role, organizationId: identity.organizationId ?? undefined }} onNotice={setNotice} />;
      case '/nominas': return <PayrollPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/atencion-cliente': return <CustomerServicePage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/proyectos-servicios': return <ProjectsServicesPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/gestion-documental': return <DocumentManagementPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/seguridad-social': return <SocialSecurityPage identity={identity} organizations={organizationsQuery.data} onNotice={setNotice} />;
      case '/facturas': return <InvoicesPage invoices={invoicesQuery.data} orders={ordersQuery.data} stateInvoices={states.invoices} stateOrders={states.orders} onRefresh={() => { void queryClient.invalidateQueries({ queryKey: getGetFp360DashboardQueryKey() }); void queryClient.invalidateQueries(); }} onNotice={setNotice} />;
      case '/clientes': return <OrganizationsDirectory onNotice={setNotice} />;
      case '/crm': return <CrmPage onNotice={setNotice} />;
      case '/productos': return <CatalogPage onNotice={setNotice} />;
       case '/aplicaciones':
       case '/apps': return <ApplicationsPage />;
       case '/documentacion':
       case '/docs': return <DocumentationPage />;
      case '/administracion': return identity.role === 'administrator' ? <AdminPage identity={identity} /> : <AdminAccessDenied />;
      default: return null;
    }
  }, [location, organizationsQuery.data, organizationsQuery.isLoading, organizationsQuery.isError, productsQuery.data, productsQuery.isLoading, productsQuery.isError, ordersQuery.data, ordersQuery.isLoading, ordersQuery.isError, invoicesQuery.data, invoicesQuery.isLoading, invoicesQuery.isError, identity]);
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <Link href="/" className="brand-lockup" onClick={() => setMobileNav(false)}>
        <span className="brand-mark"><span>R</span><i /></span><span className="brand-name"><b>RED FP360</b><small>EMPRESA SIMULADA · FP</small></span>
      </Link>
      <div className="sidebar-context"><span className="context-label">ENTORNO ACTIVO</span><button className="context-selector" type="button"><span className="context-avatar">CE</span><span><b>Empresa de prácticas</b><small>Centro educativo · Canarias</small></span><ChevronDown size={14} /></button></div>
      <div className="nav-caption">ESPACIO DE TRABAJO</div>
      <nav className="main-nav" aria-label="Navegación principal">{[...navItems, ...(identity.role === 'administrator' ? [{ href: '/administracion', label: 'Usuarios y accesos', icon: ShieldCheck }] : [])].map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={`nav-link ${location === href ? 'nav-active' : ''}`} onClick={() => setMobileNav(false)} aria-current={location === href ? 'page' : undefined}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{href === '/aplicaciones' && <span className="nav-count">26</span>}</Link>)}</nav>
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
        <Route path="/compras">{page}</Route>
        <Route path="/almacen">{page}</Route>
        <Route path="/logistica">{page}</Route>
        <Route path="/contabilidad">{page}</Route>
        <Route path="/tesoreria">{page}</Route>
        <Route path="/banco">{page}</Route>
        <Route path="/hacienda">{page}</Route>
        <Route path="/recursos-humanos">{page}</Route>
        <Route path="/empleo">{page}</Route>
        <Route path="/comunicaciones">{page}</Route>
        <Route path="/simulaciones">{page}</Route>
        <Route path="/nominas">{page}</Route>
        <Route path="/atencion-cliente">{page}</Route>
        <Route path="/proyectos-servicios">{page}</Route>
        <Route path="/gestion-documental">{page}</Route>
        <Route path="/seguridad-social">{page}</Route>
        <Route path="/facturas">{page}</Route>
        <Route path="/clientes">{page}</Route>
        <Route path="/crm">{page}</Route>
        <Route path="/productos">{page}</Route>
        <Route path="/aplicaciones">{page}</Route>
        <Route path="/documentacion">{page}</Route>
        <Route path="/apps">{page}</Route>
        <Route path="/docs">{page}</Route>
        <Route path="/administracion">{page}</Route>
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
  const identityKey = identity ? `${identity.id}:${identity.tenantId}:${identity.organizationId ?? ''}:${identity.role}` : '';

  useEffect(() => {
    if (identityQuery.isError && isUnauthorized(identityQuery.error)) {
      clearBusinessCache();
      setValidatedIdentity('');
      return;
    }
    if (!identity || identityQuery.isError) return;
    if (previousIdentity.current && previousIdentity.current !== identityKey) clearBusinessCache();
    previousIdentity.current = identityKey;
    setValidatedIdentity(identityKey);
  }, [identity, identityQuery.isFetching, identityQuery.isError, identityKey]);

  const onAuthenticated = (nextIdentity: AuthIdentity) => {
    const nextKey = `${nextIdentity.id}:${nextIdentity.tenantId}:${nextIdentity.organizationId ?? ''}:${nextIdentity.role}`;
    if (previousIdentity.current && previousIdentity.current !== nextKey) clearBusinessCache();
    previousIdentity.current = nextKey;
    setValidatedIdentity(nextKey);
    queryClient.setQueryData(getGetCurrentIdentityQueryKey(), nextIdentity);
    queryClient.setQueryData(getGetAuthStatusQueryKey(), { setupRequired: false });
    setLocation('/');
  };

  if (location === '/accept-invitation') return <AcceptInvitation onAuthenticated={onAuthenticated} />;
  if (authStatus.isLoading) return <AuthLoading label="Cargando configuración del acceso" />;
  if (authStatus.isError || !authStatus.data) return <main className="auth-loading"><div className="auth-state-card"><CircleHelp size={22} /><h1>No podemos comprobar el acceso</h1><p>El servicio de autenticación no responde. Comprueba la conexión e inténtalo otra vez.</p><button className="auth-submit" type="button" onClick={() => { void authStatus.refetch(); void identityQuery.refetch(); }} data-testid="button-retry-auth">Reintentar <ArrowRight size={16} /></button></div></main>;

  if (identityQuery.isLoading || (identity && !identityQuery.isError && validatedIdentity !== identityKey)) return <AuthLoading />;
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

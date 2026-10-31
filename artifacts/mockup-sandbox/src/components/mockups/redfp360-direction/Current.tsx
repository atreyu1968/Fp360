import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  ChevronDown,
  Globe2,
  LayoutDashboard,
  LifeBuoy,
  Package,
  PackageCheck,
  Plus,
  ReceiptText,
  ShieldAlert,
  ShoppingBag,
  ShoppingCart,
  Users,
} from "lucide-react";
import "./_group.css";

type DataState = { loading?: boolean; error?: boolean };
type ActivityItem = {
  id: string;
  action: string;
  description: string;
  reference: string;
  simulatedDate?: string;
};
type Dashboard = {
  salesCents: number;
  outstandingCents: number;
  invoicesDue: number;
  openOrders: number;
  orderCount: number;
  productCount: number;
  recentActivity?: ActivityItem[];
};

const sampleActivity: ActivityItem[] = [
  {
    id: "act-01",
    action: "Pedido confirmado",
    description: "Comercial Horizonte · 4 referencias de catálogo",
    reference: "PED-2027-0041",
    simulatedDate: "2027-05-09T11:15:00Z",
  },
  {
    id: "act-02",
    action: "Factura emitida",
    description: "Taller Atlántico · factura simulada pendiente de cobro",
    reference: "FAC-2027-0028",
    simulatedDate: "2027-05-08T15:40:00Z",
  },
  {
    id: "act-03",
    action: "Pago registrado",
    description: "Centro Insular de Formación · conciliación de práctica",
    reference: "COB-2027-0016",
    simulatedDate: "2027-05-08T09:05:00Z",
  },
];

const sampleDashboard: Dashboard = {
  salesCents: 1492400,
  outstandingCents: 346000,
  invoicesDue: 2,
  openOrders: 3,
  orderCount: 12,
  productCount: 18,
  recentActivity: sampleActivity,
};

const navItems = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/mercado", label: "Mercado", icon: Globe2 },
  { href: "/ventas", label: "Ventas", icon: ShoppingCart },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/productos", label: "Catálogo", icon: PackageCheck },
  { href: "/almacen", label: "Almacén", icon: Boxes },
  { href: "/facturas", label: "Facturas", icon: ReceiptText },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/crm", label: "CRM", icon: BriefcaseBusiness },
  { href: "/aplicaciones", label: "Aplicaciones", icon: Package },
  { href: "/documentacion", label: "Documentación", icon: BookOpen },
];

function money(cents?: number) {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format((cents ?? 0) / 100);
}

function dateLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-ES", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(date);
}

function SectionTitle({
  title,
  subtitle,
  aside,
}: {
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {aside}
    </div>
  );
}

function EmptyState({
  title,
  detail,
  icon: Icon = Activity,
}: {
  title: string;
  detail: string;
  icon?: typeof Activity;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={20} />
      </div>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function DataMessage({ state }: { state: DataState }) {
  if (state.loading) return <div className="skeleton-list" aria-label="Cargando"><span /><span /><span /></div>;
  if (state.error) return <div className="inline-error"><ShieldAlert size={18} /><span>No se han podido cargar estos datos.</span></div>;
  return null;
}

function SimulationNotice() {
  return (
    <div className="simulation-note">
      <span className="sim-mark"><ShieldAlert size={15} /></span>
      <span><b>Entorno educativo simulado</b> · Empresas, importes, IGIC, banca y organismos públicos son ficticios. Sin operaciones reales ni autenticación de producción.</span>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  accent = "blue",
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof BarChart3;
  accent?: string;
}) {
  return (
    <article className={`metric-card metric-${accent}`}>
      <div className="metric-icon"><Icon size={18} /></div>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{hint}</span>
    </article>
  );
}

function PageHeading() {
  return (
    <div className="page-heading page-enter">
      <div className="breadcrumbs">
        <span>RED FP360</span><span className="crumb-slash">/</span>
        <span>DIRECCIÓN · VISTA GENERAL</span>
      </div>
      <div className="heading-row">
        <div>
          <h1>Cuadro de mando</h1>
          <p>Actividad comercial de la empresa simulada y operaciones recientes de la red.</p>
        </div>
      </div>
    </div>
  );
}

function DashboardPage() {
  const dashboard = sampleDashboard;
  const activity = sampleActivity;
  const states = {
    dashboard: { loading: false, error: false },
    activity: { loading: false, error: false },
  };
  const activityList = activity ?? dashboard.recentActivity ?? [];

  return (
    <main className="page-content">
      <PageHeading />
      <SimulationNotice />
      <div className="metrics-grid">
        <Metric label="Ventas simuladas" value={money(dashboard.salesCents)} hint="Acumulado del escenario" icon={BarChart3} />
        <Metric label="Pendiente de cobro" value={money(dashboard.outstandingCents)} hint={`${dashboard.invoicesDue} facturas abiertas`} icon={ArrowDownLeft} accent="teal" />
        <Metric label="Pedidos abiertos" value={String(dashboard.openOrders)} hint={`${dashboard.orderCount} operaciones registradas`} icon={ShoppingBag} accent="amber" />
        <Metric label="Referencias" value={String(dashboard.productCount)} hint="Catálogo activo" icon={PackageCheck} accent="green" />
      </div>
      {states.dashboard.error && <DataMessage state={states.dashboard} />}
      <div className="dashboard-columns">
        <section className="panel activity-panel">
          <SectionTitle
            title="Actividad reciente"
            subtitle="Trazabilidad de operaciones en la empresa simulada"
            aside={<a href="/ventas" className="subtle-link">Ver ventas <ArrowRight size={14} /></a>}
          />
          <DataMessage state={states.activity} />
          {!states.activity.loading && !states.activity.error && (activityList.length ? (
            <div className="activity-list">
              {activityList.slice(0, 7).map((item) => (
                <article className="activity-item" key={item.id}>
                  <div className="activity-symbol"><Activity size={16} /></div>
                  <div className="activity-copy">
                    <strong>{item.action}</strong>
                    <p>{item.description}</p>
                    <span className="activity-meta">{item.reference}</span>
                  </div>
                  <span className="activity-time">{dateLabel(item.simulatedDate)}</span>
                </article>
              ))}
            </div>
          ) : <EmptyState title="Aún no hay movimientos" detail="Las operaciones registradas aparecerán aquí con su referencia y fecha simulada." icon={Activity} />)}
        </section>
        <aside className="dashboard-aside">
          <section className="panel">
            <SectionTitle title="Accesos de trabajo" subtitle="Continúa una tarea frecuente" />
            <div className="quick-actions">
              <a href="/ventas" className="quick-action"><span className="quick-icon"><Plus size={17} /></span><span><b>Crear pedido</b><small>Registrar una venta simulada</small></span><ArrowRight size={15} /></a>
              <a href="/almacen" className="quick-action"><span className="quick-icon aqua"><Boxes size={17} /></span><span><b>Revisar existencias</b><small>Consultar stock y reservas</small></span><ArrowRight size={15} /></a>
              <a href="/facturas" className="quick-action"><span className="quick-icon green"><ReceiptText size={17} /></span><span><b>Gestionar facturas</b><small>Emitir y registrar cobros</small></span><ArrowRight size={15} /></a>
            </div>
          </section>
          <section className="network-card">
            <div className="network-graphic" aria-hidden="true"><span /><span /><span /><span /><i /></div>
            <div className="network-label">RED EDUCATIVA · CANARIAS</div>
            <h3>Empresas que aprenden<br />haciendo.</h3>
            <p>Una red de organizaciones ficticias para practicar procesos empresariales de principio a fin.</p>
            <a href="/mercado" className="network-link">Explorar mercado <ArrowRight size={15} /></a>
          </section>
        </aside>
      </div>
    </main>
  );
}

export function Current() {
  return (
    <div className="redfp-preview">
      <div className="app-shell">
        <aside className="sidebar">
          <a href="/" className="brand-lockup">
            <span className="brand-mark"><span>R</span><i /></span>
            <span className="brand-name"><b>RED FP360</b><small>EMPRESA SIMULADA · FP</small></span>
          </a>
          <div className="sidebar-context">
            <span className="context-label">ENTORNO ACTIVO</span>
            <button className="context-selector" type="button">
              <span className="context-avatar">CE</span>
              <span><b>Empresa de prácticas</b><small>Centro educativo · Canarias</small></span>
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="nav-caption">ESPACIO DE TRABAJO</div>
          <nav className="main-nav" aria-label="Navegación principal">
            {navItems.map(({ href, label, icon: Icon }) => (
              <a href={href} key={href} className={`nav-link ${href === "/" ? "nav-active" : ""}`} aria-current={href === "/" ? "page" : undefined}>
                <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
                {href === "/aplicaciones" && <span className="nav-count">26</span>}
              </a>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="help-card">
              <div className="help-icon"><LifeBuoy size={17} /></div>
              <b>¿Primera vez por aquí?</b>
              <p>Consulta la guía de aprendizaje de la red.</p>
              <a href="/documentacion">Abrir recursos <ArrowRight size={13} /></a>
            </div>
            <div className="profile-chip">
              <span className="profile-avatar">AM</span>
              <span><b>Ana Martín</b><small>Docente supervisora</small></span>
              <button className="profile-logout" type="button" aria-label="Cerrar sesión" title="Cerrar sesión"><ArrowRight size={15} /></button>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="topbar-left"><div className="topbar-path"><span>Curso 2027–2028</span><i>/</i><b>Simulación intercentros</b></div></div>
            <div className="topbar-right">
              <span className="environment-pill"><span /> SIMULACIÓN · SIN OPERACIONES REALES</span>
              <button className="top-icon" aria-label="Notificaciones de demostración" title="Sin notificaciones"><Bell size={17} /><i /></button>
              <span className="top-divider" /><span className="top-user" aria-label="Ana Martín">AM</span>
            </div>
          </header>
          <div className="content-scroll redfp-scroll"><DashboardPage /></div>
          <footer className="app-footer"><span>RED FP360 <i>·</i> Entorno educativo de prácticas</span><span>Sin conexión a sistemas reales <b>·</b> © 2027</span></footer>
        </div>
      </div>
    </div>
  );
}

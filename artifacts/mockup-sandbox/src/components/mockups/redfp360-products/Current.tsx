import { useMemo, useState } from "react";
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowRight,
  Bell,
  BookOpen,
  Boxes,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  EyeOff,
  Globe2,
  History,
  LayoutDashboard,
  LifeBuoy,
  Package,
  PackagePlus,
  Pencil,
  ReceiptText,
  Search,
  ShoppingBag,
  ShoppingCart,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import "../redfp360-direction/_group.css";
import "./_group.css";

type DemoProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  unitPriceCents: number;
  costCents: number;
  igicBasisPoints: number;
  stock: number;
  reserved: number;
  minimumStock: number;
  isActive: boolean;
  isPublished: boolean;
};

const products: DemoProduct[] = [
  { id: "paper", sku: "PAP-A4-80", name: "Papel reciclado A4 · 80 g", category: "Papelería", unitPriceCents: 780, costCents: 520, igicBasisPoints: 700, stock: 38, reserved: 4, minimumStock: 12, isActive: true, isPublished: true },
  { id: "pens", sku: "BOL-AZ-01", name: "Bolígrafo azul borrable", category: "Escritura", unitPriceCents: 235, costCents: 112, igicBasisPoints: 700, stock: 22, reserved: 7, minimumStock: 10, isActive: true, isPublished: true },
  { id: "folder", sku: "ARC-OF-02", name: "Archivador de oficina A4", category: "Archivo", unitPriceCents: 590, costCents: 410, igicBasisPoints: 700, stock: 8, reserved: 2, minimumStock: 12, isActive: true, isPublished: false },
  { id: "labels", sku: "ETQ-REC-04", name: "Etiquetas adhesivas recicladas", category: "Papelería", unitPriceCents: 420, costCents: 285, igicBasisPoints: 700, stock: 64, reserved: 0, minimumStock: 15, isActive: true, isPublished: false },
  { id: "old", sku: "CAR-ANT-01", name: "Carpeta clasificadora antigua", category: "Archivo", unitPriceCents: 350, costCents: 200, igicBasisPoints: 700, stock: 0, reserved: 0, minimumStock: 0, isActive: false, isPublished: false },
];

const navItems = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/mercado", label: "Mercado", icon: Globe2 },
  { href: "/ventas", label: "Ventas", icon: ShoppingCart },
  { href: "/compras", label: "Compras", icon: ShoppingBag },
  { href: "/productos", label: "Catálogo", icon: Package },
  { href: "/almacen", label: "Almacén", icon: Boxes },
  { href: "/facturas", label: "Facturas", icon: ReceiptText },
  { href: "/clientes", label: "Clientes", icon: Users },
  { href: "/crm", label: "CRM", icon: BriefcaseBusiness },
  { href: "/aplicaciones", label: "Aplicaciones", icon: PackagePlus },
  { href: "/documentacion", label: "Documentación", icon: BookOpen },
];

const money = (cents: number) =>
  new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
const available = (product: DemoProduct) => Math.max(0, product.stock - product.reserved);
const low = (product: DemoProduct) =>
  product.isActive && available(product) <= product.minimumStock;

function ProductState({ product }: { product: DemoProduct }) {
  if (!product.isActive) return <span className="status md-muted"><span className="status-dot" />Archivado</span>;
  if (product.isPublished) return <span className="status status-green"><span className="status-dot" />Publicado</span>;
  return <span className="status status-amber"><span className="status-dot" />Pendiente de aprobación</span>;
}

function CatalogPage() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const counts = {
    active: products.filter((product) => product.isActive).length,
    published: products.filter((product) => product.isActive && product.isPublished).length,
    pending: products.filter((product) => product.isActive && !product.isPublished).length,
    low: products.filter(low).length,
  };
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) =>
      `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(query)
      && (filter === "all" || (filter === "published" && product.isActive && product.isPublished)
        || (filter === "pending" && product.isActive && !product.isPublished)
        || (filter === "archived" && !product.isActive)
        || (filter === "low" && low(product))),
    );
  }, [filter, search]);
  const tabs = [
    ["all", "Todos", products.length],
    ["published", "Publicados", counts.published],
    ["pending", "Pendientes", counts.pending],
    ["low", "Stock bajo", counts.low],
    ["archived", "Archivados", products.length - counts.active],
  ];

  return (
    <main className="page-content">
      <div className="page-heading page-enter">
        <div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>CATÁLOGO · PRODUCTOS DE INVENTARIO</span></div>
        <div className="heading-row">
          <div><h1>Catálogo de productos</h1><p>Datos maestros de los artículos inventariables de la empresa simulada. Los servicios no forman parte de este catálogo.</p></div>
          <button className="button button-primary" type="button"><PackagePlus size={16} /> Nuevo producto</button>
        </div>
      </div>
      <div className="md-strip">
        <div><span>Activos</span><b>{counts.active}</b></div>
        <div className="md-strip-ok"><span>Publicados en mercado</span><b>{counts.published}</b></div>
        <div className="md-strip-warn"><span>Esperando aprobación docente</span><b>{counts.pending}</b></div>
        <div className="md-strip-low"><span>Bajo mínimo</span><b>{counts.low}</b></div>
      </div>
      <section className="panel">
        <div className="list-toolbar">
          <div className="tabs" role="tablist" aria-label="Filtrar catálogo">
            {tabs.map(([id, label, count]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={filter === id ? "tab-active" : ""} onClick={() => setFilter(String(id))}>
                {label}<span className="md-count">{count}</span>
              </button>
            ))}
          </div>
          <label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre, SKU o categoría" aria-label="Buscar productos" /></label>
        </div>
        <div className="table-scroll redfp-scroll"><table style={{ minWidth: 980 }}>
          <thead><tr><th>Producto</th><th>Precio · IGIC</th><th>Coste</th><th>Stock</th><th>Reservado</th><th>Disponible</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.id} className={product.isActive ? "" : "md-row-archived"}>
                <td><div className="product-cell"><span className="product-glyph"><Package size={17} /></span><span><b>{product.name}</b><small className="mono">{product.sku} · {product.category}</small></span></div></td>
                <td className="price-cell">{money(product.unitPriceCents)}<small className="table-secondary block">IGIC {product.igicBasisPoints / 100} %</small></td>
                <td>{money(product.costCents)}</td>
                <td className="numeric">{product.stock}</td><td className="numeric">{product.reserved}</td>
                <td><span className="stock-value">{available(product)}</span>{low(product) && <span className="md-low">Bajo mínimo ({product.minimumStock})</span>}</td>
                <td><ProductState product={product} /></td>
                <td><div className="row-actions md-actions">
                  <button className="mini-button" type="button"><History size={13} /> Ajustes</button>
                  {product.isActive && <><button className="mini-button" type="button"><Pencil size={13} /> Editar</button><button className="mini-button" type="button"><SlidersHorizontal size={13} /> Stock</button></>}
                  {product.isActive && (product.isPublished ? <button className="mini-button" type="button"><EyeOff size={13} /> Retirar</button> : <button className="mini-button mini-button-blue" type="button"><CircleHelp size={13} /> Aprobar</button>)}
                  {product.isActive ? <button className="mini-button admin-danger" type="button"><Archive size={13} /> Archivar</button> : <button className="mini-button" type="button"><ArchiveRestore size={13} /> Restaurar</button>}
                </div></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8}><div className="empty-state"><div className="empty-icon"><Package size={20} /></div><strong>Sin coincidencias</strong><p>Cambia el filtro o la búsqueda.</p></div></td></tr>}
          </tbody>
        </table></div>
        <div className="table-footer"><span>{rows.length} de {products.length} productos</span><button className="icon-button" aria-label="Actualizar catálogo" type="button"><Activity size={15} /></button></div>
      </section>
      <div className="learning-note"><CircleHelp size={17} /><div><b>Ciclo de publicación</b><p>Alta → pendiente de aprobación → publicación por profesorado o administración. Cambiar el precio o el IGIC retira automáticamente la publicación; los pedidos ya registrados conservan su precio histórico.</p></div></div>
    </main>
  );
}

export function Current() {
  return (
    <div className="redfp-preview">
      <div className="app-shell">
        <aside className="sidebar">
          <a href="/" className="brand-lockup"><span className="brand-mark"><span>R</span><i /></span><span className="brand-name"><b>RED FP360</b><small>EMPRESA SIMULADA · FP</small></span></a>
          <div className="sidebar-context"><span className="context-label">ENTORNO ACTIVO</span><button className="context-selector" type="button"><span className="context-avatar">CE</span><span><b>Empresa de prácticas</b><small>Centro educativo · Canarias</small></span><ChevronDown size={14} /></button></div>
          <div className="nav-caption">ESPACIO DE TRABAJO</div>
          <nav className="main-nav" aria-label="Navegación principal">
            {navItems.map(({ href, label, icon: Icon }) => <a href={href} key={href} className={`nav-link ${href === "/productos" ? "nav-active" : ""}`} aria-current={href === "/productos" ? "page" : undefined}><Icon size={18} strokeWidth={1.8} /><span>{label}</span></a>)}
          </nav>
          <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><LifeBuoy size={17} /></div><b>¿Primera vez por aquí?</b><p>Consulta la guía de aprendizaje de la red.</p><a href="/documentacion">Abrir recursos <ArrowRight size={13} /></a></div><div className="profile-chip"><span className="profile-avatar">AM</span><span><b>Ana Martín</b><small>Docente supervisora</small></span><button className="profile-logout" type="button" aria-label="Cerrar sesión"><ArrowRight size={15} /></button></div></div>
        </aside>
        <div className="main-shell">
          <header className="topbar"><div className="topbar-left"><div className="topbar-path"><span>Curso 2027–2028</span><i>/</i><b>Simulación intercentros</b></div></div><div className="topbar-right"><span className="environment-pill"><span /> SIMULACIÓN · SIN OPERACIONES REALES</span><button className="top-icon" aria-label="Notificaciones de demostración" type="button"><Bell size={17} /><i /></button><span className="top-divider" /><span className="top-user">AM</span></div></header>
          <div className="content-scroll redfp-scroll"><CatalogPage /></div>
          <footer className="app-footer"><span>RED FP360 <i>·</i> Entorno educativo de prácticas</span><span>Sin conexión a sistemas reales <b>·</b> © 2027</span></footer>
        </div>
      </div>
    </div>
  );
}

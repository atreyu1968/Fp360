import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays, Check,
  CircleAlert, ClipboardCheck, Clock3, FileCheck2, FilePlus2, FileText, History,
  Landmark, LockKeyhole, RefreshCw, ShieldAlert, Wallet, X,
} from 'lucide-react';
import {
  getGetFp360TaxOverviewQueryKey, useActOnFp360TaxDeclaration,
  useActOnFp360TaxRequirement, useCreateFp360TaxDeclaration,
  useCreateFp360TaxRequirement, useGetFp360TaxOverview,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360Organization, Fp360TaxDeclaration, Fp360TaxOverview,
} from '@workspace/api-client-react';
import './hacienda-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'calendar' | 'igic' | 'retentions' | 'draft' | 'requirements' | 'payments' | 'history';
const tabs: Array<{ id: View; label: string; icon: typeof CalendarDays }> = [
  { id: 'calendar', label: 'Calendario fiscal', icon: CalendarDays },
  { id: 'igic', label: 'IGIC', icon: ArrowRight },
  { id: 'retentions', label: 'Retenciones', icon: FileText },
  { id: 'draft', label: 'Modelos', icon: FilePlus2 },
  { id: 'requirements', label: 'Requerimientos', icon: ClipboardCheck },
  { id: 'payments', label: 'Pagos y devoluciones', icon: Wallet },
  { id: 'history', label: 'Historial', icon: History },
];
const statuses: Record<string, string> = {
  scheduled: 'Programado', draft: 'Borrador', pending_review: 'Pendiente de revisión',
  validated: 'Validado', presented: 'Presentado', payment_pending: 'Pago solicitado',
  paid: 'Pagado · Banco FP360', refund_pending: 'Devolución pendiente', closed: 'Cerrado',
  observed: 'Con observaciones', rectified: 'Rectificado', overdue: 'Vencimiento superado',
  open: 'Abierto', answered: 'Respondido', resolved: 'Resuelto',
};
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
};
const euro = (cents?: number | null) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);
const operationId = () => crypto.randomUUID();
const readOnlyRole = (role: AuthIdentity['role']) => ['promoter', 'mentor'].includes(role);

function Status({ value }: { value?: string | null }) {
  const tone = ['paid', 'validated', 'presented', 'closed', 'resolved'].includes(value ?? '') ? 'good' :
    ['overdue', 'observed', 'open'].includes(value ?? '') ? 'warn' : 'neutral';
  return <span className={`hacienda-status ${tone}`} data-testid={`status-hacienda-${value ?? 'none'}`}><i />{statuses[value ?? ''] ?? value ?? 'Sin estado'}</span>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="hacienda-empty"><span><FileCheck2 size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Skeleton() {
  return <div className="hacienda-skeleton" role="status" aria-label="Cargando información fiscal"><span /><span /><span /><span /></div>;
}
function ErrorNotice({ retry, message }: { retry: () => void; message?: string }) {
  return <div className="hacienda-error" role="alert"><CircleAlert size={17} /><span>{message || 'No se ha podido cargar la información fiscal.'}</span><button type="button" onClick={retry}>Reintentar</button></div>;
}
function Metric({ label, value, note, icon: Icon, tone = '' }: { label: string; value: string; note: string; icon: typeof Wallet; tone?: string }) {
  return <article className={`hacienda-metric ${tone}`}><span><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{note}</em></article>;
}
function SectionHead({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="hacienda-section-head"><div><span className="hacienda-overline">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>;
}

export function HaciendaPage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const [view, setView] = useState<View>('calendar');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(identity.organizationId ?? organizations[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [requirementTarget, setRequirementTarget] = useState<Fp360TaxDeclaration | null>(null);
  const organizationId = identity.organizationId ?? selectedOrganizationId;
  const canChooseOrganization = !identity.organizationId && ['teacher', 'administrator'].includes(identity.role);
  const readOnly = readOnlyRole(identity.role);
  const canTeach = ['teacher', 'administrator'].includes(identity.role);
  useEffect(() => {
    if (!identity.organizationId && !selectedOrganizationId && organizations[0]) setSelectedOrganizationId(organizations[0].id);
  }, [identity.organizationId, organizations, selectedOrganizationId]);

  const queryKey = getGetFp360TaxOverviewQueryKey({ organizationId });
  const overviewQuery = useGetFp360TaxOverview(
    { organizationId },
    { query: { enabled: !!organizationId, queryKey } },
  );
  const createDeclaration = useCreateFp360TaxDeclaration();
  const actDeclaration = useActOnFp360TaxDeclaration();
  const createRequirement = useCreateFp360TaxRequirement();
  const actRequirement = useActOnFp360TaxRequirement();
  const data = overviewQuery.data as Fp360TaxOverview | undefined;
  const declarations = data?.declarations ?? [];
  const obligations = data?.obligations ?? [];
  const sources = data?.sourceDocuments ?? [];
  const requirements = data?.requirements ?? [];
  const term = search.trim().toLocaleLowerCase('es');
  const filteredSources = useMemo(() => sources.filter((item) =>
    `${item.reference} ${item.counterparty} ${item.status}`.toLocaleLowerCase('es').includes(term)), [sources, term]);
  const filteredDeclarations = useMemo(() => declarations.filter((item) =>
    `${item.modelCode} ${item.periodKey} ${item.status} ${item.receiptReference ?? ''}`.toLocaleLowerCase('es').includes(term)), [declarations, term]);
  const retry = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const invalidate = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
  const actOnDeclaration = (item: Fp360TaxDeclaration, action: 'recalculate' | 'validate' | 'present' | 'request_payment' | 'rectify' | 'close' | 'observe') => {
    setBusyId(item.id); setActionError('');
    actDeclaration.mutate({ id: item.id, data: { action, operationId: operationId(), ...(action === 'observe' ? { reason: 'Revisión docente del escenario educativo.' } : {}) } }, {
      onSuccess: () => {
        invalidate(); setBusyId('');
        const messages: Record<string, string> = {
          recalculate: 'Borrador recalculado desde los documentos de origen.',
          validate: 'Validación del borrador registrada.',
          present: 'Presentación simulada registrada con su justificante.',
          request_payment: 'Solicitud educativa registrada. El pago queda pendiente de confirmación en Banco FP360.',
          rectify: 'Solicitud de rectificación registrada como nueva versión didáctica.',
          close: 'Modelo cerrado en el escenario educativo.',
          observe: 'Observación docente registrada.',
        };
        onNotice(messages[action]);
      },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo aplicar la acción fiscal.')); },
    });
  };
  const actOnRequirement = (id: string, action: 'respond' | 'resolve', response?: string) => {
    setBusyId(id); setActionError('');
    actRequirement.mutate({ id, data: { action, operationId: operationId(), ...(response !== undefined ? { response } : {}) } }, {
      onSuccess: () => { invalidate(); setBusyId(''); onNotice(action === 'respond' ? 'Respuesta al requerimiento registrada.' : 'Requerimiento resuelto en el escenario educativo.'); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo actualizar el requerimiento.')); },
    });
  };
  const submitDeclaration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    if (!organizationId) { setFormError('Selecciona una empresa antes de preparar un modelo.'); return; }
    if (readOnly) { setFormError('Tu perfil tiene acceso de solo lectura.'); return; }
    const fd = new FormData(event.currentTarget);
    const taxType = String(fd.get('taxType')) as 'igic' | 'withholding';
    const modelCode = String(fd.get('modelCode')) as '420' | '425' | '111' | '190' | '115';
    const periodKey = String(fd.get('periodKey') ?? '').trim();
    const parseEuros = (field: string) => Math.round(Number(String(fd.get(field) ?? '0').replace(',', '.')) * 100);
    const withholdingBaseCents = parseEuros('withholdingBase');
    const withholdingCents = parseEuros('withholdingAmount');
    if (!/^\d{4}(-Q[1-4])?$/.test(periodKey)) { setFormError('Usa un ejercicio (2027) o un trimestre (2027-Q3).'); return; }
    if (taxType === 'withholding' && (!Number.isInteger(withholdingBaseCents) || !Number.isInteger(withholdingCents) || withholdingBaseCents < 0 || withholdingCents < 0 || withholdingCents > withholdingBaseCents)) {
      setFormError('Revisa las retenciones: importes positivos y retención no superior a la base.'); return;
    }
    createDeclaration.mutate({ data: {
      organizationId, taxType, modelCode, periodKey,
      ...(taxType === 'withholding' ? { withholdingBaseCents, withholdingCents } : {}),
      operationId: operationId(),
    } }, {
      onSuccess: () => { invalidate(); onNotice('Borrador fiscal creado. El cálculo y los documentos origen proceden del escenario.'); setView('draft'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo crear el borrador.')),
    });
  };
  const submitRequirement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requirementTarget) return;
    const fd = new FormData(event.currentTarget);
    const title = String(fd.get('title') ?? '').trim();
    const detail = String(fd.get('detail') ?? '').trim();
    if (title.length < 3 || detail.length < 5) { setFormError('Completa un título y un detalle para el requerimiento.'); return; }
    setFormError('');
    createRequirement.mutate({ data: { declarationId: requirementTarget.id, title, detail, operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setRequirementTarget(null); setFormError(''); onNotice('Requerimiento docente creado y vinculado al modelo.'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo crear el requerimiento.')),
    });
  };
  const modelLabel = (code: string) => ({ '420': 'Autoliquidación IGIC', '425': 'Resumen anual IGIC', '111': 'Retenciones de trabajo', '190': 'Resumen anual retenciones', '115': 'Retenciones de alquiler' }[code] ?? `Modelo ${code}`);
  const canPresent = (item: Fp360TaxDeclaration) => ['draft', 'validated', 'observed', 'rectified'].includes(item.status);
  const canEdit = (item: Fp360TaxDeclaration) => !['closed', 'payment_pending', 'paid'].includes(item.status);
  const actionButtons = (item: Fp360TaxDeclaration) => <div className="hacienda-actions">
    {canEdit(item) && <button type="button" onClick={() => actOnDeclaration(item, 'recalculate')} disabled={readOnly || busyId === item.id}><RefreshCw size={13} /> Recalcular</button>}
    {item.status === 'draft' && <button type="button" onClick={() => actOnDeclaration(item, 'validate')} disabled={readOnly || busyId === item.id}><Check size={13} /> Validar</button>}
    {canPresent(item) && <button type="button" className="primary" onClick={() => actOnDeclaration(item, 'present')} disabled={readOnly || busyId === item.id}><BadgeCheck size={13} /> Presentar simulación</button>}
    {item.status === 'presented' && <button type="button" className="primary" onClick={() => actOnDeclaration(item, 'request_payment')} disabled={readOnly || busyId === item.id}>{item.resultCents < 0 ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{item.resultCents < 0 ? 'Solicitar devolución' : 'Solicitar pago'}</button>}
    {['presented', 'observed', 'rectified'].includes(item.status) && <button type="button" onClick={() => actOnDeclaration(item, 'rectify')} disabled={readOnly || busyId === item.id}>Nueva rectificación</button>}
    {!['closed', 'paid'].includes(item.status) && <button type="button" onClick={() => actOnDeclaration(item, 'close')} disabled={readOnly || busyId === item.id}>Cerrar</button>}
    {canTeach && item.status === 'presented' && <button type="button" onClick={() => { setFormError(''); setRequirementTarget(item); }} disabled={busyId === item.id}>Crear requerimiento</button>}
  </div>;
  const requirementResponse = (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault(); const value = new FormData(event.currentTarget).get('response');
    const response = String(value ?? '').trim();
    if (response.length < 5) { setActionError('La respuesta debe contener al menos 5 caracteres.'); return; }
    actOnRequirement(id, 'respond', response);
  };

  return <main className="page-content hacienda-page">
    <header className="hacienda-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>FISCALIDAD · TRAZABILIDAD</span></div><h1>Hacienda FP360</h1><p>Prepara, revisa y sigue documentación fiscal educativa desde los registros de la empresa.</p></div>
      <div className="hacienda-tools">
        {canChooseOrganization && <label className="hacienda-org-select">Empresa<select value={organizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)} data-testid="select-hacienda-organization"><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <span className="hacienda-date"><CalendarDays size={14} /> Escenario · 15 sep 2027</span>
      </div>
    </header>
    <div className="hacienda-legal"><ShieldAlert size={17} /><div><strong>SIN VALIDEZ OFICIAL</strong><span>Solo práctica educativa. Los plazos son fechas de escenario; los documentos no son legalmente válidos y no se presentan a ninguna autoridad real.</span></div><b>NO PRESENTA A ORGANISMOS</b></div>
    {!organizationId && <section className="hacienda-unselected"><Landmark size={24} /><span className="hacienda-overline">ÁMBITO DE TRABAJO</span><h2>Selecciona una organización</h2><p>Calendario, documentos origen, modelos y eventos se consultan para una sola empresa cada vez.</p>{canChooseOrganization ? <label>Organización<select value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)}><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label> : <p>Tu perfil no tiene una empresa asignada. Solicita al equipo docente que configure el acceso.</p>}</section>}
    {organizationId && <>
      <nav className="hacienda-tabs" role="tablist" aria-label="Tareas de Hacienda FP360">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setActionError(''); }} data-testid={`tab-hacienda-${id}`}><Icon size={14} />{label}</button>)}</nav>
      <div className="hacienda-topline"><span><i /> Organización · datos trazables</span><span>Fecha simulada fija · 15/09/2027</span></div>
      {overviewQuery.isLoading ? <Skeleton /> : overviewQuery.isError ? <ErrorNotice retry={retry} message={errorText(overviewQuery.error, 'No se ha podido cargar la información fiscal.')} /> : data && <>
        <section className="hacienda-metrics">
          <Metric label="Modelos pendientes" value={String(data.summary.pendingCount)} note={`${data.summary.presentedCount} presentados en el escenario`} icon={FileText} tone="blue" />
          <Metric label="IGIC repercutido" value={euro(data.summary.outputIgicCents)} note="Derivado de facturas de venta" icon={ArrowUpRight} tone="teal" />
          <Metric label="IGIC soportado" value={euro(data.summary.inputIgicCents)} note="Derivado de facturas de compra" icon={ArrowDownLeft} tone="amber" />
          <Metric label="Resultado fiscal" value={euro(data.summary.resultCents)} note="Cálculo de declaraciones registradas" icon={Landmark} tone="violet" />
        </section>
        {actionError && <div className="hacienda-inline-error" role="alert"><CircleAlert size={15} />{actionError}<button type="button" onClick={() => setActionError('')} aria-label="Cerrar error"><X size={14} /></button></div>}
        <div className="hacienda-view page-enter">
          {view === 'calendar' && <div className="hacienda-calendar-grid">
            <section className="hacienda-panel">
              <SectionHead eyebrow="VENCIMIENTOS DEL ESCENARIO" title="Calendario fiscal" description="Fechas educativas por obligación. No son plazos oficiales." />
              {obligations.length ? <div className="hacienda-obligation-list">{obligations.map((item) => {
                const decl = declarations.find((entry) => entry.id === item.declarationId);
                return <article key={item.id} className="hacienda-obligation" data-testid={`row-hacienda-obligation-${item.id}`}><span className="hacienda-calendar-mark"><b>{item.simulatedDueDate.slice(8, 10)}</b><small>{dateLabel(item.simulatedDueDate).split(' ')[1]}</small></span><div className="hacienda-obligation-copy"><small>{item.taxType === 'igic' ? 'IGIC' : 'RETENCIONES'} · MODELO {item.modelCode} · {item.periodKey}</small><b>{modelLabel(item.modelCode)}</b><span>Vencimiento simulado · {dateLabel(item.simulatedDueDate)}</span></div><Status value={item.status} />{decl && <button type="button" className="hacienda-row-link" onClick={() => setView('draft')}>Ver modelo <ArrowRight size={13} /></button>}</article>;
              })}</div> : <Empty title="Sin obligaciones registradas" detail="El calendario aparecerá cuando existan obligaciones fiscales en el escenario." />}
            </section>
            <aside className="hacienda-side-stack"><section className="hacienda-panel hacienda-focus"><span className="hacienda-overline">FOCO DE APRENDIZAJE</span><h3>Un modelo trazable empieza en su origen.</h3><p>Comprueba las facturas incluidas, recalcula el borrador y conserva la secuencia de revisión y presentación simulada.</p><button type="button" onClick={() => setView('igic')}>Revisar documentos origen <ArrowRight size={14} /></button><div className="hacienda-focus-mark"><FileCheck2 size={22} /></div></section>
              <section className="hacienda-panel hacienda-quick"><SectionHead eyebrow="SEGUIMIENTO" title="Estado de trabajo" /><div><span>Requerimientos abiertos</span><b>{data.summary.openRequirementCount}</b></div><div><span>Documentos origen</span><b>{sources.length}</b></div><div><span>Actividad registrada</span><b>{data.events.length}</b></div><p>Las cifras se actualizan desde las respuestas del módulo fiscal.</p></section>
            </aside>
          </div>}
          {(view === 'igic' || view === 'retentions') && <section className="hacienda-panel">
            <SectionHead eyebrow={view === 'igic' ? 'FACTURAS DE ORIGEN' : 'RETENCIONES EDUCATIVAS'} title={view === 'igic' ? 'Documentos para IGIC' : 'Base de trabajo de retenciones'} description={view === 'igic' ? 'Consulta los registros disponibles para el cálculo. Los importes de los modelos los calcula el servicio.' : 'La fuente de nóminas aún no está integrada. Los importes manuales se identifican como entrada educativa, no como nómina.'} />
            {view === 'retentions' && <div className="hacienda-manual-note"><ShieldAlert size={15} /><span>Las bases y retenciones se introducen manualmente con fines formativos. No existe conexión con un módulo de nóminas.</span></div>}
            <label className="hacienda-search"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Referencia, contraparte o estado" aria-label="Buscar documentos fiscales" data-testid="input-hacienda-source-search" /></label>
            <div className="hacienda-table-scroll"><table className="hacienda-table"><thead><tr><th>Documento</th><th>Tipo</th><th>Fecha</th><th>Contraparte</th><th>Base</th><th>{view === 'igic' ? 'IGIC' : 'Impuesto origen'}</th><th>Estado origen</th></tr></thead><tbody>{filteredSources.map((item) => <tr key={item.id} data-testid={`row-hacienda-source-${item.id}`}><td><b className="mono">{item.reference}</b></td><td>{item.sourceType === 'sales_invoice' ? 'Factura emitida' : 'Factura recibida'}</td><td>{dateLabel(item.date)}</td><td>{item.counterparty}</td><td>{euro(item.baseCents)}</td><td>{euro(item.taxCents)}</td><td><Status value={item.status} /></td></tr>)}{!filteredSources.length && <tr><td colSpan={7}><Empty title={term ? 'Sin coincidencias' : 'No hay documentos de origen'} detail={term ? 'Prueba con otra referencia o contraparte.' : 'No hay registros reales del escenario disponibles para esta organización.'} /></td></tr>}</tbody></table></div>
            <div className="hacienda-panel-foot"><span>{filteredSources.length} documentos origen</span><span>Consulta de solo lectura · datos recibidos de la API fiscal</span></div>
          </section>}
          {view === 'draft' && <div className="hacienda-draft-layout">
            <section className="hacienda-panel"><SectionHead eyebrow="PREPARACIÓN EDUCATIVA" title="Crear un borrador" description="El servicio vincula documentos del escenario y calcula el resultado fiscal." />
              <form className="hacienda-form" onSubmit={submitDeclaration}>
                <label>Impuesto<select name="taxType" defaultValue="igic"><option value="igic">IGIC</option><option value="withholding">Retenciones</option></select></label>
                <label>Modelo<select name="modelCode" defaultValue="420"><option value="420">420 · Autoliquidación IGIC</option><option value="425">425 · Resumen anual IGIC</option><option value="111">111 · Retenciones trimestrales</option><option value="190">190 · Resumen anual retenciones</option><option value="115">115 · Retenciones de alquiler</option></select></label>
                <label>Periodo<select name="periodKey" defaultValue="2027-Q3"><option value="2027-Q1">2027 · 1.er trimestre</option><option value="2027-Q2">2027 · 2.º trimestre</option><option value="2027-Q3">2027 · 3.er trimestre</option><option value="2027-Q4">2027 · 4.º trimestre</option><option value="2027">Ejercicio 2027</option></select></label>
                <div className="hacienda-form-divider"><span>Solo para modelos de retenciones</span></div>
                <label>Base de retención educativa (€)<input name="withholdingBase" inputMode="decimal" placeholder="0,00" defaultValue="0" /></label>
                <label>Retención educativa (€)<input name="withholdingAmount" inputMode="decimal" placeholder="0,00" defaultValue="0" /></label>
                <p className="hacienda-form-hint"><ShieldAlert size={14} /> Los modelos IGIC se calculan con las facturas de origen de esta empresa. Retenciones: entradas manuales educativas.</p>
                {formError && <p className="hacienda-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}
                {readOnly && <p className="hacienda-form-error"><LockKeyhole size={14} />Perfil de solo lectura: no puedes crear modelos.</p>}
                <button className="hacienda-button primary" type="submit" disabled={readOnly || createDeclaration.isPending}>{createDeclaration.isPending ? 'Preparando borrador…' : <><FilePlus2 size={14} /> Crear borrador fiscal</>}</button>
              </form>
            </section>
            <section className="hacienda-panel"><SectionHead eyebrow="BORRADORES Y VERSIONES" title="Modelos registrados" description="Recalcular y validar no presenta documentos. Cada presentación es simulada." />
              <label className="hacienda-search"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Modelo, periodo o estado" aria-label="Buscar modelos" data-testid="input-hacienda-declaration-search" /></label>
              {!filteredDeclarations.length ? <Empty title={term ? 'Sin coincidencias' : 'Aún no hay declaraciones'} detail={term ? 'Prueba con otro modelo o periodo.' : 'Crea un borrador para comenzar a practicar la preparación y revisión.'} /> : <div className="hacienda-declaration-list">{filteredDeclarations.map((item) => <article className="hacienda-declaration" key={item.id} data-testid={`card-hacienda-declaration-${item.id}`}>
                <div className="hacienda-declaration-top"><span className="hacienda-model-icon"><FileText size={17} /></span><div><small>MODELO {item.modelCode} · {item.periodKey} · VERSIÓN {item.version}</small><b>{modelLabel(item.modelCode)}</b></div><Status value={item.status} /></div>
                <div className="hacienda-declaration-values"><span>Base imponible <b>{euro(item.taxableBaseCents)}</b></span><span>IGIC repercutido <b>{euro(item.outputIgicCents)}</b></span><span>IGIC soportado <b>{euro(item.inputIgicCents)}</b></span><span>Retenciones <b>{euro(item.withholdingCents)}</b></span><span>Resultado provisional <b className={item.resultCents < 0 ? 'hacienda-negative' : ''}>{euro(item.resultCents)}</b></span></div>
                <div className="hacienda-declaration-foot"><span><Clock3 size={13} /> Vencimiento educativo · {dateLabel(item.simulatedDueDate)}</span><span>Pago · {statuses[item.paymentStatus] ?? item.paymentStatus}</span></div>
                {item.receiptReference && <div className="hacienda-receipt"><BadgeCheck size={14} /><span>Justificante simulado <b className="mono">{item.receiptReference}</b></span><small>No es un justificante oficial</small></div>}
                {item.supersedesId && <div className="hacienda-version-note">Rectifica versión anterior · <span className="mono">{item.supersedesId}</span></div>}
                {actionButtons(item)}
              </article>)}</div>}
            </section>
          </div>}
          {view === 'requirements' && <section className="hacienda-panel">
            <SectionHead eyebrow="COMUNICACIONES DEL ESCENARIO" title="Requerimientos y respuestas" description="Las solicitudes se crean para un modelo concreto; las respuestas quedan registradas en su historial." />
            {!requirements.length ? <Empty title="Sin requerimientos" detail="No hay requerimientos creados para esta organización. El equipo docente puede abrir uno desde un modelo presentado." /> : <div className="hacienda-requirement-list">{requirements.map((item) => <article className="hacienda-requirement" key={item.id} data-testid={`card-hacienda-requirement-${item.id}`}><div className="hacienda-req-top"><span><ClipboardCheck size={16} /></span><div><small className="mono">{item.reference} · MODELO {declarations.find((d) => d.id === item.declarationId)?.modelCode ?? '—'}</small><b>{item.title}</b></div><Status value={item.status} /></div><p>{item.detail}</p><div className="hacienda-req-meta"><span>Creado por {item.createdByName}</span><span>{dateLabel(item.createdAt)}</span></div>{item.response && <blockquote><b>Respuesta · {item.respondedByName ?? 'equipo'}</b>{item.response}</blockquote>}
              {item.status === 'open' && !readOnly && <form className="hacienda-response-form" onSubmit={(event) => requirementResponse(event, item.id)}><label>Respuesta al requerimiento<textarea name="response" minLength={5} maxLength={2000} required placeholder="Describe la documentación o explicación educativa…" /></label><button className="hacienda-button primary" type="submit" disabled={busyId === item.id}>Enviar respuesta</button></form>}
              {canTeach && item.status === 'answered' && <button className="hacienda-button" type="button" onClick={() => actOnRequirement(item.id, 'resolve')} disabled={busyId === item.id}><Check size={14} /> Marcar resuelto</button>}
            </article>)}</div>}
          </section>}
          {view === 'payments' && <div className="hacienda-payment-view">
            <div className="hacienda-payment-banner"><div><span className="hacienda-overline">SOLICITUD EDUCATIVA · SIN CARGO NI ABONO</span><h2>Pagos y devoluciones</h2><p>La solicitud permanece pendiente. El estado pagado solo puede venir de una confirmación del flujo Banco FP360.</p></div><span className="hacienda-payment-mark"><Landmark size={21} /></span></div>
            <section className="hacienda-panel"><SectionHead eyebrow="MODELOS PRESENTADOS" title="Situación de liquidación" description="Crea una solicitud desde un modelo presentado. No se marca como pagado desde Hacienda." />
              {declarations.filter((item) => ['presented', 'payment_pending', 'refund_pending', 'closed', 'paid'].includes(item.status)).length ? <div className="hacienda-table-scroll"><table className="hacienda-table"><thead><tr><th>Modelo / periodo</th><th>Resultado</th><th>Estado del modelo</th><th>Estado de pago</th><th>Justificante</th><th>Solicitud</th></tr></thead><tbody>{declarations.filter((item) => ['presented', 'payment_pending', 'refund_pending', 'closed', 'paid'].includes(item.status)).map((item) => <tr key={item.id}><td><b>Modelo {item.modelCode}</b><small>{item.periodKey} · v{item.version}</small></td><td className={item.resultCents < 0 ? 'hacienda-negative' : ''}>{euro(item.resultCents)}</td><td><Status value={item.status} /></td><td><Status value={item.paymentStatus} /></td><td className="mono">{item.receiptReference ?? '—'}</td><td>{item.status === 'presented' ? <button className="hacienda-button primary small" type="button" onClick={() => actOnDeclaration(item, 'request_payment')} disabled={readOnly || busyId === item.id}>{item.resultCents < 0 ? 'Solicitar devolución' : 'Solicitar pago'}</button> : item.paymentStatus === 'paid' ? <span className="hacienda-confirmed"><BadgeCheck size={13} /> Confirmado por Banco FP360</span> : <span className="hacienda-pending">Pendiente de confirmación bancaria</span>}</td></tr>)}</tbody></table></div> : <Empty title="No hay liquidaciones simuladas" detail="Al presentar un borrador educativo aparecerá aquí la solicitud que corresponda al resultado." />}
              <div className="hacienda-panel-foot"><span><ShieldAlert size={13} /> No se ejecutan transferencias ni devoluciones desde este módulo.</span><span>Pago confirmado solo en Banco FP360</span></div>
            </section>
          </div>}
          {view === 'history' && <section className="hacienda-panel"><SectionHead eyebrow="TRAZABILIDAD" title="Historial de actividad" description="Acciones registradas por la API para esta empresa y fecha educativa." />
            {!data.events.length ? <Empty title="Sin actividad registrada" detail="La actividad aparecerá aquí cuando se creen o revisen modelos o requerimientos." /> : <div className="hacienda-event-list">{[...data.events].sort((a, b) => b.simulatedDate.localeCompare(a.simulatedDate)).map((event) => <article key={event.id} data-testid={`row-hacienda-event-${event.id}`}><span><Activity size={14} /></span><div><b>{event.description}</b><small>{event.actorName} · {dateLabel(event.simulatedDate)}</small></div><small className="hacienda-event-type">{event.eventType.replaceAll('_', ' ')}</small></article>)}</div>}
          </section>}
        </div>
      </>}
    </>}
    {requirementTarget && <div className="hacienda-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !createRequirement.isPending) setRequirementTarget(null); }}><section className="hacienda-modal" role="dialog" aria-modal="true" aria-labelledby="hacienda-requirement-title">
      <header><div><span className="hacienda-overline">SOLICITUD DOCENTE · MODELO {requirementTarget.modelCode}</span><h2 id="hacienda-requirement-title">Crear requerimiento</h2></div><button type="button" onClick={() => setRequirementTarget(null)} aria-label="Cerrar formulario"><X size={17} /></button></header>
      <p>Se vinculará al borrador presentado del periodo {requirementTarget.periodKey}.</p>
      <form onSubmit={submitRequirement}><label>Título<input name="title" required minLength={3} maxLength={160} placeholder="p. ej. Aclaración de documento" /></label><label>Detalle<textarea name="detail" required minLength={5} maxLength={1000} placeholder="Describe la actividad de revisión educativa…" /></label>{formError && <p className="hacienda-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}<footer><button type="button" className="hacienda-button" onClick={() => setRequirementTarget(null)} disabled={createRequirement.isPending}>Cancelar</button><button type="submit" className="hacienda-button primary" disabled={createRequirement.isPending}>{createRequirement.isPending ? 'Creando…' : 'Crear requerimiento'}</button></footer></form>
    </section></div>}
  </main>;
}

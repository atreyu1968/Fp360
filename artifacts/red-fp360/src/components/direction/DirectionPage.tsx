import { type FormEvent, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, ArrowDownLeft, ArrowUpRight, BarChart3, Check, CheckCheck, ChevronDown,
  CircleHelp, Clock3, FileBarChart2, FileText, Gauge, History, ListChecks, Plus, RefreshCw,
  ShieldCheck, Target, Wallet, X,
} from 'lucide-react';
import {
  getGetFp360DirectionOverviewQueryKey,
  getGetFp360DirectionReportQueryKey,
  getListFp360DirectionAlertsQueryKey,
  getListFp360DirectionDecisionsQueryKey,
  getListFp360DirectionEventsQueryKey,
  getListFp360DirectionObjectivesQueryKey,
  getListFp360DirectionReportsQueryKey,
  getListFp360DirectionTasksQueryKey,
  getListFp360DirectionThresholdsQueryKey,
  useCreateFp360DirectionDecision,
  useCreateFp360DirectionObjective,
  useCreateFp360DirectionReport,
  useCreateFp360DirectionTask,
  useDecideFp360DirectionDecision,
  useGetFp360DirectionOverview,
  useGetFp360DirectionReport,
  useGetCurrentIdentity,
  useListFp360DirectionAlerts,
  useListFp360DirectionDecisions,
  useListFp360DirectionEvents,
  useListFp360DirectionMembers,
  useListFp360DirectionObjectives,
  useListFp360DirectionReports,
  useListFp360DirectionTasks,
  useListFp360DirectionThresholds,
  useUpdateFp360DirectionAlert,
  useUpdateFp360DirectionObjective,
  useUpdateFp360DirectionTask,
  useUpsertFp360DirectionThreshold,
} from '@workspace/api-client-react';
import type {
  DirectionAlert, DirectionDecision, DirectionObjective, DirectionTask,
  DirectionThreshold, DirectionThresholdKey, DirectionObjectiveMetric, DirectionEvent,
} from '@workspace/api-client-react';
import './direction.css';

type Props = { actorRole: string; organizationId: string; organizationName: string };
type Tab = 'resumen' | 'alertas' | 'decisiones' | 'objetivos' | 'informes';
type Notice = { kind: 'success' | 'error'; text: string };
type ModalKind = 'task' | 'decision' | 'objective' | 'report' | 'threshold' | 'alert' | 'review' | null;

const roleNames: Record<string, string> = {
  student: 'Alumnado', team_manager: 'Responsable de equipo', teacher: 'Docencia',
  promoter: 'Promoción', mentor: 'Mentoría', administrator: 'Administración',
};
const metricLabels: Record<DirectionObjectiveMetric, string> = {
  sales_base_cents: 'Base de ventas', purchase_base_cents: 'Base de compras aprobadas',
  open_orders: 'Pedidos abiertos', open_tasks: 'Tareas abiertas',
};
const priorityNames: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };
const statusNames: Record<string, string> = {
  open: 'Abierta', in_progress: 'En curso', done: 'Completada', resolved: 'Resuelta',
  pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada',
};
const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const amount = (cents: number | null | undefined) => cents == null ? '—' : eur.format(cents / 100);
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const dateInputValue = (value?: string | null) => value?.slice(0, 10) ?? '';
const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const isValidPeriod = (start: string, end: string) => {
  if (!isValidDate(start) || !isValidDate(end) || start > end) return false;
  const months = (Number(end.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(start.slice(5, 7));
  return months <= 35;
};
const errorText = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`dir-panel ${className}`}>{children}</section>;
}
function PanelHeading({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="dir-panel-heading"><div>{eyebrow && <span className="dir-eyebrow">{eyebrow}</span>}<h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</div>;
}
function Empty({ title, detail, icon: Icon = CircleHelp }: { title: string; detail: string; icon?: typeof CircleHelp }) {
  return <div className="dir-empty"><span><Icon size={19} /></span><strong>{title}</strong><p>{detail}</p></div>;
}
function LoadState({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <div className="dir-skeleton" aria-label="Cargando"><i /><i /><i /></div>;
  if (error) return <div className="dir-error" role="alert"><AlertTriangle size={17} /><span>No se pudieron cargar los datos.</span><button type="button" onClick={retry}>Reintentar</button></div>;
  return null;
}
function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  return <div className="dir-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="dir-modal" role="dialog" aria-modal="true" aria-labelledby="dir-modal-title">
      <header><div><span className="dir-eyebrow">DIRECCIÓN · SIMULACIÓN</span><h2 id="dir-modal-title">{title}</h2></div><button className="dir-icon-button" type="button" onClick={close} aria-label="Cerrar diálogo"><X size={18} /></button></header>
      {children}
    </section>
  </div>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="dir-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function StateTag({ value }: { value: string }) {
  return <span className={`dir-status dir-status-${value}`}>{statusNames[value] ?? value}</span>;
}

export default function DirectionPage({ actorRole, organizationId, organizationName }: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('resumen');
  const [periodStart, setPeriodStart] = useState<string>();
  const [periodEnd, setPeriodEnd] = useState<string>();
  const [modal, setModal] = useState<ModalKind>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activeAlert, setActiveAlert] = useState<DirectionAlert | null>(null);
  const [activeObjective, setActiveObjective] = useState<DirectionObjective | null>(null);
  const [activeReview, setActiveReview] = useState<{ item: DirectionDecision; decision: 'approve' | 'reject' } | null>(null);
  const [activeThreshold, setActiveThreshold] = useState<DirectionThresholdKey>('stock_low_units');
  const [activeReportId, setActiveReportId] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState('');
  const [reportDetailOpen, setReportDetailOpen] = useState(false);

  const overviewParams = {
    organizationId,
    ...(periodStart && periodEnd ? { periodStart, periodEnd } : {}),
  };
  const overview = useGetFp360DirectionOverview(overviewParams, { query: { staleTime: 30_000 } });
  const tasks = useListFp360DirectionTasks({ query: { staleTime: 20_000 } });
  const members = useListFp360DirectionMembers({ query: { staleTime: 60_000 } });
  const alerts = useListFp360DirectionAlerts({ query: { staleTime: 20_000 } });
  const thresholds = useListFp360DirectionThresholds({ query: { staleTime: 60_000 } });
  const decisions = useListFp360DirectionDecisions({ query: { staleTime: 20_000 } });
  const objectives = useListFp360DirectionObjectives(
    periodStart && periodEnd ? { periodStart, periodEnd } : undefined,
    { query: { staleTime: 30_000 } },
  );
  const reports = useListFp360DirectionReports({ query: { staleTime: 30_000 } });
  const events = useListFp360DirectionEvents(undefined, { query: { staleTime: 15_000 } });
  const reportDetail = useGetFp360DirectionReport(activeReportId ?? '', {
    query: { enabled: Boolean(activeReportId && reportDetailOpen), queryKey: getGetFp360DirectionReportQueryKey(activeReportId ?? '') },
  });
  const identity = useGetCurrentIdentity();

  const createTask = useCreateFp360DirectionTask();
  const updateTask = useUpdateFp360DirectionTask();
  const updateAlert = useUpdateFp360DirectionAlert();
  const upsertThreshold = useUpsertFp360DirectionThreshold();
  const createDecision = useCreateFp360DirectionDecision();
  const decideDecision = useDecideFp360DirectionDecision();
  const createObjective = useCreateFp360DirectionObjective();
  const updateObjective = useUpdateFp360DirectionObjective();
  const createReport = useCreateFp360DirectionReport();

  const canManage = ['team_manager', 'teacher', 'administrator'].includes(actorRole);
  const canReview = ['teacher', 'administrator'].includes(actorRole);
  const canWrite = ['student', 'team_manager', 'teacher', 'administrator'].includes(actorRole);
  const displayStart = periodStart ?? overview.data?.periodStart ?? '';
  const displayEnd = periodEnd ?? overview.data?.periodEnd ?? '';
  const membersById = useMemo(() => new Map((members.data ?? []).map((member) => [member.id, member.displayName])), [members.data]);
  const pendingDecisions = (decisions.data ?? []).filter((decision) => decision.status === 'pending');
  const openTasks = (tasks.data ?? []).filter((task) => task.status !== 'done');
  const openAlerts = (alerts.data ?? []).filter((alert) => alert.status !== 'resolved');
  const currentEvents = events.data ?? [];
  const notify = (kind: Notice['kind'], text: string) => setNotice({ kind, text });
  const invalidate = async (...keys: (readonly unknown[])[]) => {
    await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  };
  const overviewKey = getGetFp360DirectionOverviewQueryKey(overviewParams);
  const auditKey = getListFp360DirectionEventsQueryKey();
  const objectiveKey = getListFp360DirectionObjectivesQueryKey(periodStart && periodEnd ? { periodStart, periodEnd } : undefined);

  const onPeriodChange = (start: string, end: string) => {
    setPeriodStart(start);
    setPeriodEnd(end);
  };
  const refreshAll = () => {
    void invalidate(overviewKey, getListFp360DirectionTasksQueryKey(), getListFp360DirectionAlertsQueryKey(),
      getListFp360DirectionDecisionsQueryKey(), objectiveKey, getListFp360DirectionReportsQueryKey(), auditKey);
  };
  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const detail = String(form.get('detail') ?? '').trim();
    const due = String(form.get('due') ?? '');
    if (title.length < 3 || title.length > 140 || (due && !isValidDate(due))) {
      notify('error', 'Revisa el título y la fecha de vencimiento.');
      return;
    }
    createTask.mutate({ data: {
      title, detail, priority: String(form.get('priority')) as 'low' | 'medium' | 'high' | 'critical',
      dueSimulatedDate: due || null, assignedToUserId: String(form.get('assignee') || '') || null,
    } }, {
      onSuccess: () => { setModal(null); notify('success', 'Tarea creada y añadida al seguimiento.'); void invalidate(getListFp360DirectionTasksQueryKey(), auditKey, overviewKey, objectiveKey); },
      onError: (error) => notify('error', errorText(error, 'No se pudo crear la tarea. Comprueba los datos y tus permisos.')),
    });
  };
  const changeTaskStatus = (task: DirectionTask, status: 'open' | 'in_progress' | 'done') => {
    const reason = status === 'done' ? 'Tarea marcada como completada desde Dirección.' : `Estado actualizado a ${statusNames[status].toLowerCase()}.`;
    updateTask.mutate({ id: task.id, data: { status, reason } }, {
      onSuccess: () => { notify('success', 'Estado de la tarea actualizado.'); void invalidate(getListFp360DirectionTasksQueryKey(), auditKey, overviewKey, objectiveKey); },
      onError: (error) => notify('error', errorText(error, 'No se pudo actualizar la tarea. Revisa el acceso de tu perfil.')),
    });
  };
  const submitAlert = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeAlert) return;
    const form = new FormData(event.currentTarget);
    const justification = String(form.get('justification') ?? '').trim();
    const evidenceReference = String(form.get('evidence') ?? '').trim();
    if (justification.length < 3 || (activeAlert.requiresEvidence && evidenceReference.length < 4)) {
      notify('error', activeAlert.requiresEvidence ? 'La justificación y la referencia de evidencia son obligatorias para una alerta crítica.' : 'Escribe una justificación de al menos 3 caracteres.');
      return;
    }
    updateAlert.mutate({ alertKey: activeAlert.alertKey, data: {
      status: String(form.get('status')) as 'open' | 'in_progress' | 'resolved',
      assignedToUserId: String(form.get('assignee') || '') || null,
      justification, evidenceReference,
    } }, {
      onSuccess: () => { setModal(null); setActiveAlert(null); notify('success', 'Seguimiento de la alerta actualizado.'); void invalidate(getListFp360DirectionAlertsQueryKey(), auditKey); },
      onError: (error) => notify('error', errorText(error, 'No se pudo guardar el seguimiento de la alerta.')),
    });
  };
  const submitDecision = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const reason = String(form.get('reason') ?? '').trim();
    const proposedAction = String(form.get('action') ?? '').trim();
    const impactNote = String(form.get('impactNote') ?? '').trim();
    const simulatedDate = String(form.get('date') ?? '');
    const impactEuros = String(form.get('impact') ?? '').trim();
    const impactCents = impactEuros ? Math.round(Number(impactEuros) * 100) : null;
    if (title.length < 3 || reason.length < 3 || proposedAction.length < 3 || impactNote.length < 3 ||
      !isValidPeriod(simulatedDate, simulatedDate) || (impactEuros && (!Number.isFinite(Number(impactEuros)) || Number(impactEuros) < 0))) {
      notify('error', 'Revisa los campos obligatorios y el importe previsto.');
      return;
    }
    createDecision.mutate({ data: { title, reason, proposedAction, impactCents, impactNote, simulatedDate } }, {
      onSuccess: () => { setModal(null); notify('success', 'Propuesta enviada para revisión.'); void invalidate(getListFp360DirectionDecisionsQueryKey(), auditKey); },
      onError: (error) => notify('error', errorText(error, 'No se pudo enviar la propuesta.')),
    });
  };
  const submitReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeReview) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '').trim();
    if (reason.length < 3) { notify('error', 'Explica el motivo de la revisión (mínimo 3 caracteres).'); return; }
    decideDecision.mutate({ id: activeReview.item.id, data: { decision: activeReview.decision, reason } }, {
      onSuccess: () => { setModal(null); setActiveReview(null); notify('success', activeReview.decision === 'approve' ? 'Propuesta aprobada.' : 'Propuesta rechazada.'); void invalidate(getListFp360DirectionDecisionsQueryKey(), auditKey); },
      onError: (error) => notify('error', errorText(error, 'No se pudo revisar la propuesta.')),
    });
  };
  const submitObjective = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get('label') ?? '').trim();
    const metric = String(form.get('metric')) as DirectionObjectiveMetric;
    const targetInput = Number(form.get('target'));
    const periodStartValue = String(form.get('periodStart') ?? '');
    const periodEndValue = String(form.get('periodEnd') ?? '');
    const isMoney = metric === 'sales_base_cents' || metric === 'purchase_base_cents';
    const targetValue = isMoney ? Math.round(targetInput * 100) : Math.round(targetInput);
    if (label.length < 3 || !Number.isFinite(targetInput) || targetInput < 0 || !isValidPeriod(periodStartValue, periodEndValue)) {
      notify('error', 'Revisa el nombre, el valor objetivo y el periodo.');
      return;
    }
    const data = { label, metric, targetValue, periodStart: periodStartValue, periodEnd: periodEndValue, notes: String(form.get('notes') ?? '').trim() };
    const onSuccess = () => { setModal(null); setActiveObjective(null); notify('success', activeObjective ? 'Objetivo actualizado.' : 'Objetivo creado.'); void invalidate(objectiveKey, auditKey); };
    const onError = (error: Error) => notify('error', errorText(error, 'No se pudo guardar el objetivo.'));
    if (activeObjective) updateObjective.mutate({ id: activeObjective.id, data }, { onSuccess, onError });
    else createObjective.mutate({ data }, { onSuccess, onError });
  };
  const submitReport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidPeriod(displayStart, displayEnd)) { notify('error', 'El periodo del informe no es válido.'); return; }
    if (reportTitle.trim().length < 3 || reportTitle.trim().length > 140) { notify('error', 'El título debe tener entre 3 y 140 caracteres.'); return; }
    createReport.mutate({ data: { title: reportTitle.trim(), periodStart: displayStart, periodEnd: displayEnd } }, {
      onSuccess: (report) => { setModal(null); setReportTitle(''); setActiveReportId(report.id); setReportDetailOpen(true); notify('success', 'Informe guardado con una instantánea real del periodo.'); void invalidate(getListFp360DirectionReportsQueryKey(), auditKey); },
      onError: (error) => notify('error', errorText(error, 'No se pudo guardar el informe.')),
    });
  };
  const submitThreshold = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const enabled = form.get('enabled') === 'on';
    const raw = String(form.get('value') ?? '').trim();
    const parsed = raw === '' ? null : Number(raw);
    const value = activeThreshold === 'liquidity_min_cents' && parsed !== null ? Math.round(parsed * 100) : parsed;
    if (enabled && (value === null || !Number.isFinite(value) || value < 0)) { notify('error', 'Indica un umbral válido antes de activarlo.'); return; }
    upsertThreshold.mutate({ params: { key: activeThreshold }, data: { enabled, value } }, {
      onSuccess: () => { setModal(null); notify('success', 'Umbral actualizado.'); void invalidate(getListFp360DirectionThresholdsQueryKey(), getListFp360DirectionAlertsQueryKey(), auditKey); },
      onError: (error) => notify('error', errorText(error, 'No se pudo guardar el umbral.')),
    });
  };

  const openReport = (id: string) => { setActiveReportId(id); setReportDetailOpen(true); };
  const openObjective = (objective?: DirectionObjective) => { setActiveObjective(objective ?? null); setModal('objective'); };
  const openAlert = (alert: DirectionAlert) => { setActiveAlert(alert); setModal('alert'); };
  const openThreshold = (key: DirectionThresholdKey) => { setActiveThreshold(key); setModal('threshold'); };
  const startReview = (item: DirectionDecision, decision: 'approve' | 'reject') => { setActiveReview({ item, decision }); setModal('review'); };
  const reloadOverview = () => { void overview.refetch(); };
  const thresholdByKey = new Map((thresholds.data ?? []).map((threshold) => [threshold.key, threshold]));
  const reportSnapshot = reportDetail.data;

  return <main className="direction-page page-enter">
    <header className="dir-hero">
      <div className="dir-hero-top"><span className="dir-breadcrumb">RED FP360 <i>/</i> DIRECCIÓN</span><span className="dir-sim-label"><ShieldCheck size={14} /> SIMULACIÓN EDUCATIVA</span></div>
      <div className="dir-hero-main">
        <div><div className="dir-hero-kicker">LECTURA EJECUTIVA · {roleNames[actorRole] ?? 'Perfil'}</div><h1>Dirección<span>.</span></h1><p>Una lectura trazable de los datos disponibles para orientar el siguiente paso.</p></div>
        <div className="dir-period">
          <label><span>Desde</span><input aria-label="Inicio del periodo" type="date" value={displayStart} onChange={(event) => onPeriodChange(event.target.value, displayEnd)} /></label>
          <span className="dir-period-sep">—</span>
          <label><span>Hasta</span><input aria-label="Fin del periodo" type="date" value={displayEnd} onChange={(event) => onPeriodChange(displayStart, event.target.value)} /></label>
          <button type="button" onClick={reloadOverview} aria-label="Actualizar indicadores" title="Actualizar indicadores"><RefreshCw size={16} /></button>
        </div>
      </div>
      <div className="dir-hero-foot"><span>{organizationName} · {overview.data?.periodLabel ?? 'Periodo simulado'}</span><span>Indicadores financieros de esta empresa. Tareas, alertas, decisiones, objetivos, informes y auditoría son de toda la red.</span></div>
    </header>

    {notice && <div className={`dir-notice dir-notice-${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <Check size={16} /> : <AlertTriangle size={16} />}{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso"><X size={15} /></button></div>}
    <nav className="dir-tabs" aria-label="Secciones de Dirección" role="tablist">
      {([
        ['resumen', 'Resumen', Gauge], ['alertas', 'Alertas y tareas', ListChecks],
        ['decisiones', 'Decisiones', ShieldCheck], ['objetivos', 'Objetivos', Target], ['informes', 'Informes y auditoría', History],
      ] as const).map(([id, label, Icon]) => <button type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}><Icon size={16} /><span>{label}</span>{id === 'alertas' && openAlerts.length > 0 && <b>{openAlerts.length}</b>}</button>)}
    </nav>

    {tab === 'resumen' && <div className="dir-content">
      <LoadState loading={overview.isLoading} error={overview.isError} retry={reloadOverview} />
      {overview.data && <>
        <div className="dir-kpi-grid">
          <article className="dir-kpi dir-kpi-blue"><div><span>Ventas · base</span><BarChart3 size={17} /></div><strong>{amount(overview.data.salesBaseCents)}</strong><small>{overview.data.salesInvoiceCount} facturas emitidas · base factura</small></article>
          <article className="dir-kpi dir-kpi-teal"><div><span>Compras aprobadas · base</span><ArrowDownLeft size={17} /></div><strong>{amount(overview.data.purchaseBaseCents)}</strong><small>{overview.data.purchaseInvoiceCount} facturas proveedor aprobadas</small></article>
          <article className="dir-kpi dir-kpi-gold"><div><span>Pendiente de cobro</span><Wallet size={17} /></div><strong>{amount(overview.data.outstandingCustomerCents)}</strong><small>{overview.data.outstandingCustomerInvoiceCount} facturas abiertas</small></article>
          <article className="dir-kpi dir-kpi-ink"><div><span>Margen bruto</span><Activity size={17} /></div><strong>{overview.data.grossMarginCents === null ? 'No disponible' : amount(overview.data.grossMarginCents)}</strong><small>{overview.data.grossMarginCents === null ? overview.data.grossMarginUnavailableReason : 'Importe calculado para el periodo'}</small></article>
        </div>
        <div className="dir-data-note"><ShieldCheck size={16} /><p><b>Transparencia de fuentes.</b> Ventas usa bases de facturas de venta. Compras recoge la base de facturas de proveedor aprobadas; no equivale a efectivo pagado ni al coste de ventas.</p></div>
        <div className="dir-overview-grid">
          <Panel className="dir-chart-panel">
            <PanelHeading eyebrow="EVOLUCIÓN DEL PERIODO" title="Ventas y compras" detail="Importes de base por mes, según facturas disponibles." />
            {overview.data.series.length ? <div className="dir-chart">
              <div className="dir-chart-legend"><span><i className="sales-dot" />Ventas · base</span><span><i className="purchase-dot" />Compras aprobadas · base</span></div>
              <div className="dir-chart-bars" role="img" aria-label="Comparación mensual de ventas y compras aprobadas">
                {overview.data.series.map((point) => {
                  const max = Math.max(1, ...overview.data!.series.flatMap((item) => [item.salesBaseCents, item.purchaseBaseCents]));
                  return <div className="dir-month" key={point.period} title={`${point.period}: ventas ${amount(point.salesBaseCents)}, compras ${amount(point.purchaseBaseCents)}`}>
                    <div className="dir-bars"><i className="dir-bar sales" style={{ height: `${point.salesBaseCents === 0 ? 0 : Math.max(3, point.salesBaseCents / max * 100)}%` }} /><i className="dir-bar purchases" style={{ height: `${point.purchaseBaseCents === 0 ? 0 : Math.max(3, point.purchaseBaseCents / max * 100)}%` }} /></div>
                    <span>{point.period.slice(5)}</span>
                  </div>;
                })}
              </div>
              <div className="dir-chart-axis"><span>{amount(Math.max(...overview.data.series.flatMap((point) => [point.salesBaseCents, point.purchaseBaseCents]), 0))}</span><span>Escala visual proporcional · meses del periodo</span></div>
            </div> : <Empty title="Sin series en el periodo" detail="No hay puntos mensuales para mostrar en la selección actual." icon={BarChart3} />}
          </Panel>
          <Panel className="dir-source-panel">
            <PanelHeading eyebrow="DATOS NO DISPONIBLES" title="Lo que aún no se puede medir" detail="La ausencia de una fuente no se interpreta como cero." />
            <div className="dir-unavailable-list">
              <div><span className="dir-unavailable-icon"><Wallet size={17} /></span><section><b>Saldo de tesorería</b><strong>{overview.data.treasuryBalanceCents === null ? 'No disponible' : amount(overview.data.treasuryBalanceCents)}</strong><p>{overview.data.treasuryBalanceCents === null ? overview.data.treasuryBalanceUnavailableReason : 'Saldo de tesorería disponible para el periodo.'}</p></section></div>
              <div><span className="dir-unavailable-icon"><Clock3 size={17} /></span><section><b>Facturas de cliente vencidas</b><strong>{overview.data.overdueCustomerInvoiceCount === null ? 'No disponible' : overview.data.overdueCustomerInvoiceCount}</strong><p>{overview.data.overdueCustomerInvoiceCount === null ? overview.data.overdueCustomerInvoiceUnavailableReason : 'Recuento disponible para el periodo.'}</p></section></div>
              <div><span className="dir-unavailable-icon"><ArrowUpRight size={17} /></span><section><b>Margen bruto</b><strong>{overview.data.grossMarginCents === null ? 'No disponible' : amount(overview.data.grossMarginCents)}</strong><p>{overview.data.grossMarginCents === null ? overview.data.grossMarginUnavailableReason : 'Margen calculado para el periodo.'}</p></section></div>
            </div>
          </Panel>
        </div>
        <div className="dir-summary-bottom">
          <Panel><PanelHeading eyebrow="SEGUIMIENTO" title="Alertas y tareas abiertas" action={<button type="button" className="dir-text-action" onClick={() => setTab('alertas')}>Ver seguimiento <ChevronDown size={14} /></button>} />
            {tasks.isLoading || alerts.isLoading ? <div className="dir-skeleton"><i /><i /></div> : tasks.isError || alerts.isError ? <LoadState loading={false} error retry={() => { void tasks.refetch(); void alerts.refetch(); }} /> :
              <div className="dir-mini-stats"><div><span>Alertas abiertas</span><b>{openAlerts.length}</b></div><div><span>Tareas pendientes</span><b>{openTasks.length}</b></div><div><span>Propuestas por revisar</span><b>{pendingDecisions.length}</b></div></div>}
          </Panel>
          <Panel><PanelHeading eyebrow="TRAZABILIDAD" title="Actividad de Dirección" action={<button type="button" className="dir-text-action" onClick={() => setTab('informes')}>Ver auditoría <ChevronDown size={14} /></button>} />
            {events.isLoading ? <div className="dir-skeleton"><i /><i /></div> : events.isError ? <LoadState loading={false} error retry={() => { void events.refetch(); }} /> :
              currentEvents.length ? <div className="dir-event-peek">{currentEvents.slice(0, 3).map((item) => <EventRow event={item} key={item.id} />)}</div> : <Empty title="Sin eventos registrados" detail="Las acciones de Dirección aparecerán aquí cuando existan." icon={History} />}
          </Panel>
          <Panel><PanelHeading eyebrow="LECTURA DE ACTIVIDAD" title="Desglose por área" detail="Solo se muestra cuando la fuente devuelve actividad." />
            {overview.data.activityByArea.length ? <div className="dir-area-list">{overview.data.activityByArea.map((area) => <div key={area.area}><span>{area.area}</span><b>{area.count}</b><i style={{ width: `${Math.min(100, area.count / Math.max(1, ...overview.data!.activityByArea.map((item) => item.count)) * 100)}%` }} /></div>)}</div> : <Empty title="Sin desglose disponible" detail="La fuente no devuelve actividad por área para este periodo." icon={Activity} />}
          </Panel>
        </div>
      </>}
      {!overview.isLoading && !overview.isError && !overview.data && <Empty title="No hay una lectura disponible" detail="No se ha recibido una instantánea para el periodo." icon={Gauge} />}
    </div>}

    {tab === 'alertas' && <div className="dir-content dir-two-col">
      <Panel><PanelHeading eyebrow="SEÑALES DE FUENTE" title="Alertas actuales" detail="Derivadas de inventario y facturas de proveedor pendientes." action={canManage && <button className="dir-button dir-button-secondary" onClick={() => openThreshold('stock_low_units')} type="button"><Gauge size={15} /> Umbrales</button>} />
        <LoadState loading={alerts.isLoading} error={alerts.isError} retry={() => { void alerts.refetch(); }} />
        {!alerts.isLoading && !alerts.isError && (alerts.data?.length ? <div className="dir-alert-list">{alerts.data.map((alert) => <article className={`dir-alert dir-alert-${alert.severity}`} key={alert.alertKey}>
          <div className="dir-alert-icon"><AlertTriangle size={17} /></div><div className="dir-alert-main"><div className="dir-alert-title"><b>{alert.title}</b><span className={`dir-severity severity-${alert.severity}`}>{alert.severity === 'critical' ? 'Crítica' : alert.severity === 'high' ? 'Alta' : alert.severity === 'medium' ? 'Media' : 'Baja'}</span><StateTag value={alert.status} /></div>
            <p>{alert.description}</p><div className="dir-alert-meta"><span>{alert.sourceType === 'inventory' ? 'Inventario' : alert.sourceType === 'purchase_invoice' ? 'Factura proveedor' : alert.sourceType}</span><span>{dateLabel(alert.simulatedDate)}</span>{alert.assignedToUserId && <span>Asignada a {membersById.get(alert.assignedToUserId) ?? 'miembro'}</span>}</div>
            {alert.justification && <div className="dir-justification"><b>Seguimiento:</b> {alert.justification}{alert.evidenceReference && <span> · Evidencia: {alert.evidenceReference}</span>}</div>}
          </div>{canManage && <button className="dir-button dir-button-quiet" type="button" onClick={() => openAlert(alert)}>Gestionar</button>}
        </article>)}</div> : <Empty title="Sin alertas actuales" detail="No se han derivado alertas de las fuentes disponibles en este momento." icon={ShieldCheck} />)}
      </Panel>
      <Panel><PanelHeading eyebrow="ACCIONES" title="Tareas de dirección" detail="Seguimiento de trabajo con persona asignada." action={canWrite && <button type="button" className="dir-button dir-button-primary" onClick={() => setModal('task')}><Plus size={15} /> Nueva tarea</button>} />
        <LoadState loading={tasks.isLoading} error={tasks.isError} retry={() => { void tasks.refetch(); }} />
        {!tasks.isLoading && !tasks.isError && (tasks.data?.length ? <div className="dir-task-list">{tasks.data.map((task) => {
          const canUpdate = canManage || task.createdByUserId === identity.data?.id || task.assignedToUserId === identity.data?.id;
          return <article className="dir-task" key={task.id}><div className={`dir-priority priority-${task.priority}`} /><div className="dir-task-copy"><div className="dir-task-top"><b>{task.title}</b><span className={`dir-priority-label priority-${task.priority}`}>{priorityNames[task.priority]}</span></div>{task.detail && <p>{task.detail}</p>}<small>{task.assignedToUserId ? `Asignada a ${membersById.get(task.assignedToUserId) ?? 'miembro'}` : 'Sin asignar'} · Vence {dateLabel(task.dueSimulatedDate)}</small><StateTag value={task.status} /></div>
            {canUpdate && task.status !== 'done' && <select aria-label={`Cambiar estado de ${task.title}`} value={task.status} disabled={updateTask.isPending} onChange={(event) => changeTaskStatus(task, event.target.value as 'open' | 'in_progress' | 'done')}><option value="open">Abierta</option><option value="in_progress">En curso</option><option value="done">Completada</option></select>}
          </article>;
        })}</div> : <Empty title="No hay tareas todavía" detail="Crea una tarea para convertir una necesidad en seguimiento concreto." icon={ListChecks} />)}
        <ThresholdSummary thresholds={thresholds.data ?? []} loading={thresholds.isLoading} error={thresholds.isError} canManage={canManage} openThreshold={openThreshold} retry={() => { void thresholds.refetch(); }} />
      </Panel>
    </div>}

    {tab === 'decisiones' && <div className="dir-content">
      <Panel><PanelHeading eyebrow="PROPUESTAS DE DIRECCIÓN" title="Decisiones" detail="Propuestas con motivo, acción prevista e impacto documentado." action={canManage && <button type="button" className="dir-button dir-button-primary" onClick={() => setModal('decision')}><Plus size={15} /> Proponer decisión</button>} />
        {!canManage && <div className="dir-info-line"><ShieldCheck size={15} /> Tu perfil puede consultar propuestas, pero no enviar nuevas decisiones.</div>}
        <LoadState loading={decisions.isLoading} error={decisions.isError} retry={() => { void decisions.refetch(); }} />
        {!decisions.isLoading && !decisions.isError && (decisions.data?.length ? <div className="dir-decision-list">{decisions.data.map((decision) => {
          const identityKnown = Boolean(identity.data?.id);
          const selfReview = identityKnown && decision.submittedByUserId === identity.data?.id;
          const reviewAllowed = canReview && identityKnown && decision.status === 'pending' && !selfReview;
          return <article className="dir-decision" key={decision.id}><div className="dir-decision-rail"><span>{decision.status === 'pending' ? <Clock3 size={17} /> : decision.status === 'approved' ? <CheckCheck size={17} /> : <X size={17} />}</span><i /></div>
            <div className="dir-decision-content"><div className="dir-decision-heading"><div><span className="dir-eyebrow">PROPUESTA · {dateLabel(decision.simulatedDate)}</span><h3>{decision.title}</h3></div><StateTag value={decision.status} /></div>
              <div className="dir-decision-details"><section><small>Motivo</small><p>{decision.reason}</p></section><section><small>Acción propuesta</small><p>{decision.proposedAction}</p></section></div>
              <div className="dir-decision-foot"><span>Impacto previsto: <b>{decision.impactCents === null ? 'No cuantificado' : amount(decision.impactCents)}</b></span><span>{decision.impactNote}</span>{decision.reviewReason && <span className="dir-review-reason">Revisión: {decision.reviewReason}</span>}</div>
              {selfReview && decision.status === 'pending' && <p className="dir-self-review">Has enviado esta propuesta; no puedes revisarla.</p>}
              {canReview && !identityKnown && decision.status === 'pending' && <p className="dir-self-review">La revisión no está disponible hasta verificar la identidad del revisor.</p>}
            </div>{reviewAllowed && <div className="dir-review-actions"><button type="button" className="dir-button dir-button-primary" onClick={() => startReview(decision, 'approve')}>Aprobar</button><button type="button" className="dir-button dir-button-danger" onClick={() => startReview(decision, 'reject')}>Rechazar</button></div>}
          </article>;
        })}</div> : <Empty title="Aún no hay propuestas" detail="Cuando se registre una propuesta, su estado y revisión quedarán visibles aquí." icon={ShieldCheck} />)}
      </Panel>
    </div>}

    {tab === 'objetivos' && <div className="dir-content">
      <Panel><PanelHeading eyebrow="SEGUIMIENTO DE RESULTADOS" title="Objetivos" detail="El avance usa únicamente los datos reales disponibles para cada indicador." action={canManage && <button type="button" className="dir-button dir-button-primary" onClick={() => openObjective()}><Plus size={15} /> Nuevo objetivo</button>} />
        {!canManage && <div className="dir-info-line"><Target size={15} /> Tu perfil puede consultar objetivos, pero no modificarlos.</div>}
        <LoadState loading={objectives.isLoading} error={objectives.isError} retry={() => { void objectives.refetch(); }} />
        {!objectives.isLoading && !objectives.isError && (objectives.data?.length ? <div className="dir-objective-grid">{objectives.data.map((objective) => <ObjectiveCard key={objective.id} objective={objective} canManage={canManage} edit={() => openObjective(objective)} />)}</div> :
          <Empty title="No hay objetivos para el periodo" detail="Define un objetivo para hacer seguimiento de una métrica respaldada por las fuentes disponibles." icon={Target} />)}
      </Panel>
    </div>}

    {tab === 'informes' && <div className="dir-content dir-two-col dir-reports-layout">
        <Panel><PanelHeading eyebrow="INSTANTÁNEAS DE PERIODO" title="Informes guardados" detail="Cada informe conserva una instantánea real del periodo consultado." action={canWrite && <button type="button" className="dir-button dir-button-primary" onClick={() => { setReportTitle(''); setModal('report'); }}><Plus size={15} /> Guardar informe</button>} />
        <LoadState loading={reports.isLoading} error={reports.isError} retry={() => { void reports.refetch(); }} />
        {!reports.isLoading && !reports.isError && (reports.data?.length ? <div className="dir-report-list">{reports.data.map((report) => <button className={`dir-report-row ${activeReportId === report.id ? 'selected' : ''}`} key={report.id} type="button" onClick={() => openReport(report.id)}>
          <span className="dir-report-icon"><FileBarChart2 size={18} /></span><span className="dir-report-copy"><b>{report.title}</b><small>{dateLabel(report.periodStart)} — {dateLabel(report.periodEnd)}</small><small>Guardado {dateLabel(report.createdAt)}</small></span><ChevronDown size={16} />
        </button>)}</div> : <Empty title="Sin informes guardados" detail="Guarda una instantánea con título y periodo para consultarla más adelante." icon={FileText} />)}
        {reportDetailOpen && activeReportId && <div className="dir-report-detail">
          <div className="dir-report-detail-head"><div><span className="dir-eyebrow">DETALLE DEL INFORME</span><h3>{reportSnapshot?.title ?? 'Cargando informe'}</h3></div><button type="button" aria-label="Cerrar informe" className="dir-icon-button" onClick={() => { setReportDetailOpen(false); setActiveReportId(null); }}><X size={17} /></button></div>
          <LoadState loading={reportDetail.isLoading} error={reportDetail.isError} retry={() => { void reportDetail.refetch(); }} />
          {reportSnapshot && <><p className="dir-report-period">{reportSnapshot.snapshot.periodLabel}</p><div className="dir-report-values"><div><small>Ventas · base</small><b>{amount(reportSnapshot.snapshot.salesBaseCents)}</b></div><div><small>Compras aprobadas · base</small><b>{amount(reportSnapshot.snapshot.purchaseBaseCents)}</b></div><div><small>Pendiente de cobro</small><b>{amount(reportSnapshot.snapshot.outstandingCustomerCents)}</b></div><div><small>Tesorería</small><b>{reportSnapshot.snapshot.treasuryBalanceCents === null ? 'No disponible' : amount(reportSnapshot.snapshot.treasuryBalanceCents)}</b></div><div><small>Margen bruto</small><b>{reportSnapshot.snapshot.grossMarginCents === null ? 'No disponible' : amount(reportSnapshot.snapshot.grossMarginCents)}</b></div><div><small>Facturas vencidas</small><b>{reportSnapshot.snapshot.overdueCustomerInvoiceCount === null ? 'No disponible' : reportSnapshot.snapshot.overdueCustomerInvoiceCount}</b></div></div>
            <div className="dir-report-reasons">{reportSnapshot.snapshot.treasuryBalanceCents === null && <p><b>Tesorería:</b> {reportSnapshot.snapshot.treasuryBalanceUnavailableReason}</p>}{reportSnapshot.snapshot.grossMarginCents === null && <p><b>Margen:</b> {reportSnapshot.snapshot.grossMarginUnavailableReason}</p>}{reportSnapshot.snapshot.overdueCustomerInvoiceCount === null && <p><b>Vencimientos:</b> {reportSnapshot.snapshot.overdueCustomerInvoiceUnavailableReason}</p>}</div>
            <p className="dir-report-disclaimer">La instantánea conserva los indicadores y limitaciones de fuente registrados al guardar el informe.</p></>}
        </div>}
      </Panel>
      <Panel><PanelHeading eyebrow="TRAZABILIDAD" title="Historial de auditoría" detail="Acciones registradas por el módulo Dirección." />
        <LoadState loading={events.isLoading} error={events.isError} retry={() => { void events.refetch(); }} />
        {!events.isLoading && !events.isError && (currentEvents.length ? <div className="dir-audit-list">{currentEvents.map((event) => <EventRow event={event} key={event.id} detailed />)}</div> : <Empty title="Sin actividad registrada" detail="Las acciones de Dirección se mostrarán aquí cuando se realicen." icon={History} />)}
      </Panel>
    </div>}

    {modal === 'task' && <Modal title="Crear tarea" close={() => setModal(null)}><form className="dir-form" onSubmit={submitTask}>
      <p className="dir-form-intro">Crea seguimiento de Dirección dentro de la empresa simulada.</p>
      <Field label="Título"><input name="title" required minLength={3} maxLength={140} autoFocus placeholder="Describe la tarea" /></Field>
      <Field label="Detalle"><textarea name="detail" maxLength={2000} rows={3} placeholder="Contexto adicional, si hace falta" /></Field>
      <div className="dir-form-grid"><Field label="Prioridad"><select name="priority" defaultValue="medium"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></Field>
        <Field label="Vencimiento simulado"><input type="date" name="due" /></Field></div>
          <Field label="Persona asignada"><select name="assignee" defaultValue={identity.data?.id ?? ''}><option value="">Mi cuenta (asignación predeterminada)</option>{(members.data ?? []).map((member) => <option value={member.id} key={member.id}>{member.displayName} · {roleNames[member.role] ?? member.role}</option>)}</select><small>{members.isError ? 'No se pudieron cargar miembros; al dejar el campo vacío, la tarea se asignará a tu cuenta.' : 'Opciones disponibles en esta empresa simulada.'}</small></Field>
      <FormError queryError={members.isError ? 'No se pudieron cargar miembros. Reintenta para asignar la tarea.' : undefined} onRetry={() => { void members.refetch(); }} />
      <div className="dir-form-actions"><button type="button" className="dir-button dir-button-quiet" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="dir-button dir-button-primary" disabled={createTask.isPending || members.isLoading}>{createTask.isPending ? 'Guardando…' : 'Crear tarea'}</button></div>
    </form></Modal>}

    {modal === 'alert' && activeAlert && <Modal title="Gestionar alerta" close={() => { setModal(null); setActiveAlert(null); }}><form className="dir-form" onSubmit={submitAlert}>
      <div className="dir-form-source"><b>{activeAlert.title}</b><p>{activeAlert.description}</p><small>Fuente: {activeAlert.sourceType} · {dateLabel(activeAlert.simulatedDate)}</small></div>
      <Field label="Estado"><select name="status" defaultValue={activeAlert.status}><option value="open">Abierta</option><option value="in_progress">En curso</option><option value="resolved">Resuelta</option></select></Field>
      <Field label="Asignar a"><select name="assignee" defaultValue={activeAlert.assignedToUserId ?? ''}><option value="">Sin asignar</option>{(members.data ?? []).map((member) => <option value={member.id} key={member.id}>{member.displayName}</option>)}</select></Field>
      <Field label="Justificación" hint="Mínimo 3 caracteres."><textarea name="justification" required minLength={3} maxLength={1000} rows={3} defaultValue={activeAlert.justification} /></Field>
      <Field label={`Referencia de evidencia${activeAlert.requiresEvidence ? ' · obligatoria' : ''}`} hint={activeAlert.requiresEvidence ? 'Las alertas críticas no se pueden actualizar sin evidencia (mínimo 4 caracteres).' : 'Opcional.'}><input name="evidence" maxLength={300} required={activeAlert.requiresEvidence} minLength={activeAlert.requiresEvidence ? 4 : undefined} defaultValue={activeAlert.evidenceReference} /></Field>
      <div className="dir-form-actions"><button type="button" className="dir-button dir-button-quiet" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="dir-button dir-button-primary" disabled={updateAlert.isPending}>{updateAlert.isPending ? 'Guardando…' : 'Guardar seguimiento'}</button></div>
    </form></Modal>}

    {modal === 'threshold' && <Modal title="Configurar umbral" close={() => setModal(null)}><ThresholdForm threshold={thresholdByKey.get(activeThreshold)} thresholdKey={activeThreshold} busy={upsertThreshold.isPending} onSubmit={submitThreshold} onClose={() => setModal(null)} /></Modal>}

    {modal === 'decision' && <Modal title="Proponer una decisión" close={() => setModal(null)}><form className="dir-form" onSubmit={submitDecision}>
      <p className="dir-form-intro">La propuesta quedará pendiente de revisión según los permisos establecidos.</p>
      <Field label="Título"><input name="title" required minLength={3} maxLength={140} autoFocus /></Field>
      <Field label="Motivo"><textarea name="reason" required minLength={3} maxLength={2000} rows={3} /></Field>
      <Field label="Acción propuesta"><textarea name="action" required minLength={3} maxLength={2000} rows={3} /></Field>
      <div className="dir-form-grid"><Field label="Impacto previsto (EUR)"><input name="impact" type="number" min="0" step="0.01" /></Field><Field label="Fecha simulada"><input name="date" type="date" required defaultValue={displayEnd} /></Field></div>
      <Field label="Nota de impacto" hint="Explica el impacto aunque no sea cuantificable."><textarea name="impactNote" required minLength={3} maxLength={1000} rows={2} /></Field>
      <div className="dir-form-actions"><button type="button" className="dir-button dir-button-quiet" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="dir-button dir-button-primary" disabled={createDecision.isPending}>{createDecision.isPending ? 'Enviando…' : 'Enviar propuesta'}</button></div>
    </form></Modal>}

    {modal === 'review' && activeReview && <Modal title={activeReview.decision === 'approve' ? 'Aprobar propuesta' : 'Rechazar propuesta'} close={() => { setModal(null); setActiveReview(null); }}><form className="dir-form" onSubmit={submitReview}>
      <div className="dir-form-source"><b>{activeReview.item.title}</b><p>{activeReview.item.proposedAction}</p></div>
      <Field label="Motivo de revisión" hint="Mínimo 3 caracteres."><textarea name="reason" required minLength={3} maxLength={1000} rows={4} autoFocus /></Field>
      <div className="dir-form-actions"><button type="button" className="dir-button dir-button-quiet" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className={`dir-button ${activeReview.decision === 'approve' ? 'dir-button-primary' : 'dir-button-danger'}`} disabled={decideDecision.isPending}>{decideDecision.isPending ? 'Guardando…' : activeReview.decision === 'approve' ? 'Aprobar propuesta' : 'Rechazar propuesta'}</button></div>
    </form></Modal>}

    {modal === 'objective' && <Modal title={activeObjective ? 'Editar objetivo' : 'Definir objetivo'} close={() => { setModal(null); setActiveObjective(null); }}><ObjectiveForm key={activeObjective?.id ?? 'new'} objective={activeObjective} periodStart={displayStart} periodEnd={displayEnd} busy={createObjective.isPending || updateObjective.isPending} onSubmit={submitObjective} onClose={() => { setModal(null); setActiveObjective(null); }} /></Modal>}

    {modal === 'report' && <Modal title="Guardar informe" close={() => setModal(null)}><form className="dir-form" onSubmit={submitReport}>
      <p className="dir-form-intro">Se guardará una instantánea real del periodo seleccionado: <b>{dateLabel(displayStart)} — {dateLabel(displayEnd)}</b>.</p>
      <Field label="Título del informe"><input autoFocus required minLength={3} maxLength={140} value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} placeholder="Ej. Seguimiento del periodo" /></Field>
      <div className="dir-form-actions"><button type="button" className="dir-button dir-button-quiet" onClick={() => setModal(null)}>Cancelar</button><button type="submit" className="dir-button dir-button-primary" disabled={createReport.isPending || !isValidPeriod(displayStart, displayEnd)}>{createReport.isPending ? 'Guardando…' : 'Guardar instantánea'}</button></div>
    </form></Modal>}
  </main>;
}

function FormError({ queryError, onRetry }: { queryError?: string; onRetry?: () => void }) {
  return queryError ? <p className="dir-form-warning" role="alert"><AlertTriangle size={15} />{queryError}{onRetry && <button type="button" onClick={onRetry}>Reintentar</button>}</p> : null;
}

function ThresholdSummary({ thresholds, loading, error, canManage, openThreshold, retry }: {
  thresholds: DirectionThreshold[]; loading: boolean; error: boolean; canManage: boolean; openThreshold: (key: DirectionThresholdKey) => void; retry: () => void;
}) {
  if (loading) return <div className="dir-threshold-summary">Cargando umbrales…</div>;
  if (error) return <div className="dir-error" role="alert"><AlertTriangle size={15} />No se pudieron cargar umbrales.<button type="button" onClick={retry}>Reintentar</button></div>;
  return <div className="dir-threshold-summary"><div><span>Umbral de existencias bajas</span><b>{thresholds.find((item) => item.key === 'stock_low_units')?.enabled ? `Activo · ${thresholds.find((item) => item.key === 'stock_low_units')?.value} uds.` : 'No configurado'}</b></div><div><span>Umbral de liquidez</span><b>{thresholds.find((item) => item.key === 'liquidity_min_cents')?.enabled ? amount(thresholds.find((item) => item.key === 'liquidity_min_cents')?.value) : 'No configurado'}</b></div>{canManage && <button type="button" className="dir-text-action" onClick={() => openThreshold('liquidity_min_cents')}>Configurar liquidez</button>}</div>;
}

function ThresholdForm({ threshold, thresholdKey, busy, onSubmit, onClose }: {
  threshold?: DirectionThreshold; thresholdKey: DirectionThresholdKey; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void;
}) {
  return <form className="dir-form" onSubmit={onSubmit}>
    <p className="dir-form-intro">{thresholdKey === 'stock_low_units' ? 'El umbral de existencias define el corte para alertas de inventario.' : 'Este umbral queda guardado como referencia de Dirección; el saldo de tesorería puede seguir sin estar disponible si no hay fuente conciliada.'}</p>
    <Field label={thresholdKey === 'stock_low_units' ? 'Mínimo de unidades disponibles' : 'Saldo mínimo (EUR)'}><input name="value" type="number" min="0" step={thresholdKey === 'stock_low_units' ? '1' : '0.01'} defaultValue={threshold?.value == null ? '' : thresholdKey === 'liquidity_min_cents' ? (threshold.value / 100).toFixed(2) : threshold.value} /></Field>
    <label className="dir-check-field"><input name="enabled" type="checkbox" defaultChecked={threshold?.enabled ?? false} /><span>Activar este umbral</span></label>
    <div className="dir-form-actions"><button type="button" className="dir-button dir-button-quiet" onClick={onClose}>Cancelar</button><button type="submit" className="dir-button dir-button-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar umbral'}</button></div>
  </form>;
}

function ObjectiveForm({ objective, periodStart, periodEnd, busy, onSubmit, onClose }: {
  objective: DirectionObjective | null; periodStart: string; periodEnd: string; busy: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void;
}) {
  const metric = objective?.metric ?? 'sales_base_cents';
  const target = objective ? ((metric === 'sales_base_cents' || metric === 'purchase_base_cents') ? objective.targetValue / 100 : objective.targetValue) : '';
  return <form className="dir-form" onSubmit={onSubmit}>
    <Field label="Nombre"><input name="label" required minLength={3} maxLength={140} defaultValue={objective?.label ?? ''} autoFocus /></Field>
    <Field label="Indicador"><select name="metric" defaultValue={metric}><option value="sales_base_cents">Base de ventas (EUR)</option><option value="purchase_base_cents">Base de compras aprobadas (EUR)</option><option value="open_orders">Pedidos abiertos (número)</option><option value="open_tasks">Tareas abiertas (número)</option></select></Field>
    <Field label="Valor objetivo"><input name="target" type="number" min="0" step="0.01" required defaultValue={target} /></Field>
    <div className="dir-form-grid"><Field label="Inicio"><input type="date" name="periodStart" required defaultValue={dateInputValue(objective?.periodStart) || periodStart} /></Field><Field label="Fin"><input type="date" name="periodEnd" required defaultValue={dateInputValue(objective?.periodEnd) || periodEnd} /></Field></div>
    <Field label="Notas"><textarea name="notes" rows={2} maxLength={1000} defaultValue={objective?.notes ?? ''} /></Field>
    <div className="dir-form-actions"><button type="button" className="dir-button dir-button-quiet" onClick={onClose}>Cancelar</button><button type="submit" className="dir-button dir-button-primary" disabled={busy}>{busy ? 'Guardando…' : objective ? 'Guardar cambios' : 'Crear objetivo'}</button></div>
  </form>;
}

function ObjectiveCard({ objective, canManage, edit }: { objective: DirectionObjective; canManage: boolean; edit: () => void }) {
  const isMoney = objective.metric === 'sales_base_cents' || objective.metric === 'purchase_base_cents';
  const actual = objective.actualValue;
  const progress = objective.progressAvailable && actual !== null && objective.targetValue > 0 ? Math.min(100, Math.max(0, actual / objective.targetValue * 100)) : null;
  return <article className="dir-objective-card">
    <div className="dir-objective-top"><span className="dir-objective-icon"><Target size={17} /></span><span className="dir-objective-period">{dateLabel(objective.periodStart)} — {dateLabel(objective.periodEnd)}</span>{canManage && <button type="button" className="dir-text-action" onClick={edit}>Editar</button>}</div>
    <h3>{objective.label}</h3><small>{metricLabels[objective.metric]}</small>
    <div className="dir-objective-figures"><div><span>Actual</span><b>{actual === null ? 'No disponible' : isMoney ? amount(actual) : actual}</b></div><div><span>Objetivo</span><b>{isMoney ? amount(objective.targetValue) : objective.targetValue}</b></div></div>
    {progress === null ? <p className="dir-progress-unavailable">El avance no está disponible para esta fuente.</p> : <><div className="dir-progress" role="progressbar" aria-label={`Avance de ${objective.label}`} aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div><div className="dir-progress-label"><span>Avance calculado</span><b>{progress.toLocaleString('es-ES', { maximumFractionDigits: 1 })}%</b></div></>}
    {objective.notes && <p className="dir-objective-notes">{objective.notes}</p>}
  </article>;
}

function EventRow({ event, detailed = false }: { event: DirectionEvent; detailed?: boolean }) {
  const entityNames: Record<string, string> = { task: 'Tarea', alert: 'Alerta', decision: 'Decisión', objective: 'Objetivo', report: 'Informe' };
  const actionNames: Record<string, string> = {
    created: 'creó', updated: 'actualizó', submitted: 'envió', approved: 'aprobó', rejected: 'rechazó',
    saved: 'guardó',
    status_open: 'reabrió', status_in_progress: 'puso en curso', status_done: 'completó',
    status_resolved: 'resolvió', status_pending: 'marcó pendiente', threshold_updated: 'actualizó el umbral',
  };
  return <article className={`dir-event-row ${detailed ? 'detailed' : ''}`}><span className="dir-event-dot"><Activity size={13} /></span><div><div><b>{entityNames[event.entityType] ?? event.entityType}</b><span>{actionNames[event.action] ?? event.action}</span></div>{detailed && <small>{event.reason || 'Sin motivo añadido'}</small>}<small>{roleNames[event.actorRole] ?? event.actorRole} · {dateLabel(event.simulatedDate)}</small></div></article>;
}

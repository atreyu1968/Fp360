import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ArrowRight, BadgeCheck, BriefcaseBusiness, CalendarDays, Check,
  ChevronRight, CircleDollarSign, ClipboardCheck, Clock3, FileCheck2, FileText, HardHat,
  Plus, RefreshCw, ShieldAlert, WalletCards,
} from 'lucide-react';
import {
  getGetFp360ProjectsOverviewQueryKey,
  useActOnFp360Project, useActOnFp360ProjectDeliverable, useActOnFp360ProjectMilestone,
  useActOnFp360ProjectWorkOrder, useCreateFp360Project, useCreateFp360ProjectBilling,
  useCreateFp360ProjectDeliverable, useCreateFp360ProjectMilestone, useCreateFp360ProjectResource,
  useCreateFp360ProjectRevision, useCreateFp360ProjectTimeEntry, useCreateFp360ProjectWorkOrder,
  useGetFp360ProjectsOverview, useIssueFp360Invoice, useReviewFp360ProjectResource,
  useReviewFp360ProjectRevision, useReviewFp360ProjectTimeEntry,
} from '@workspace/api-client-react';
import type { AuthIdentity, Fp360Organization, Fp360ProjectsOverview } from '@workspace/api-client-react';
import './projects-services-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'portfolio' | 'file' | 'work' | 'costs' | 'deliverables' | 'billing' | 'results';
const tabs: Array<{ id: View; label: string; icon: typeof ClipboardCheck }> = [
  { id: 'portfolio', label: 'Cartera', icon: BriefcaseBusiness }, { id: 'file', label: 'Ficha', icon: FileText },
  { id: 'work', label: 'Órdenes de trabajo', icon: HardHat }, { id: 'costs', label: 'Recursos y costes', icon: WalletCards },
  { id: 'deliverables', label: 'Entregables', icon: ClipboardCheck }, { id: 'billing', label: 'Facturación', icon: CircleDollarSign },
  { id: 'results', label: 'Resultados', icon: Activity },
];
const labels: Record<string, string> = {
  draft: 'Borrador', planned: 'Planificado', in_progress: 'En curso', on_hold: 'En pausa', completed: 'Completado', closed: 'Cerrado', cancelled: 'Cancelado',
  pending_review: 'Pendiente de revisión', approved: 'Aprobado', rejected: 'Rechazado', assigned: 'Asignada', reviewed: 'Revisada', blocked: 'Bloqueada',
  submitted: 'En revisión', accepted: 'Aceptado', changes_requested: 'Cambios solicitados', invoiced: 'Facturado', billing_ready: 'Pedido preparado',
};
const money = (n?: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((n ?? 0) / 100);
const date = (d?: string | null) => d ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '—';
const opId = () => crypto.randomUUID();
const teach = (role: AuthIdentity['role']) => role === 'teacher' || role === 'administrator';
const failure = (error: unknown) => {
  const raw = error instanceof Error ? error.message : '';
  try {
    const parsed = JSON.parse(raw) as { message?: string; error?: string };
    const detail = parsed.message ?? parsed.error;
    return detail ? `El servidor no ha aceptado la operación: ${detail}` : 'No se pudo completar la operación. Revisa los datos y vuelve a intentarlo.';
  } catch { return raw ? `El servidor no ha aceptado la operación: ${raw}` : 'No se pudo completar la operación. Revisa los datos y vuelve a intentarlo.'; }
};
function Status({ value }: { value: string }) {
  const kind = ['approved', 'accepted', 'completed', 'closed', 'reviewed'].includes(value) ? 'good' : ['rejected', 'cancelled', 'blocked'].includes(value) ? 'bad' : 'waiting';
  return <span className={`ps-status ${kind}`}><i />{labels[value] ?? value.replaceAll('_', ' ')}</span>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="ps-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="ps-empty"><span><ClipboardCheck size={21} /></span><b>{title}</b><p>{detail}</p></div>;
}
function FormError({ children }: { children: string }) {
  return children ? <p className="ps-error" role="alert"><AlertCircle size={15} />{children}</p> : null;
}

export function ProjectsServicesPage({ identity, organizations = [], onNotice }: Props) {
  const queryClient = useQueryClient();
  const canReview = teach(identity.role);
  const [selectedOrg, setSelectedOrg] = useState(identity.organizationId ?? '');
  const organizationId = identity.organizationId ?? selectedOrg;
  const params = useMemo(() => ({ organizationId }), [organizationId]);
  const queryKey = getGetFp360ProjectsOverviewQueryKey(params);
  const overview = useGetFp360ProjectsOverview(params, { query: { enabled: Boolean(organizationId), queryKey } });
  const data = overview.data as Fp360ProjectsOverview | undefined;
  const [view, setView] = useState<View>('portfolio');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newProject, setNewProject] = useState(false);
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewReason, setReviewReason] = useState('');
  const [resourceSourceType, setResourceSourceType] = useState<'manual' | 'purchase_receipt'>('manual');
  const [selectedServiceSku, setSelectedServiceSku] = useState('');
  const createProject = useCreateFp360Project(); const actProject = useActOnFp360Project();
  const createRevision = useCreateFp360ProjectRevision(); const reviewRevision = useReviewFp360ProjectRevision();
  const createWorkOrder = useCreateFp360ProjectWorkOrder(); const actWorkOrder = useActOnFp360ProjectWorkOrder();
  const createTimeEntry = useCreateFp360ProjectTimeEntry(); const reviewTimeEntry = useReviewFp360ProjectTimeEntry();
  const createResource = useCreateFp360ProjectResource(); const reviewResource = useReviewFp360ProjectResource();
  const createMilestone = useCreateFp360ProjectMilestone(); const actMilestone = useActOnFp360ProjectMilestone();
  const createDeliverable = useCreateFp360ProjectDeliverable(); const actDeliverable = useActOnFp360ProjectDeliverable();
  const createBilling = useCreateFp360ProjectBilling(); const issueInvoice = useIssueFp360Invoice();
  const projects = data?.projects ?? [];
  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? projects[0];
  const project = newProject ? undefined : selectedProject;
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true); setActionError('');
    try { await fn(); await queryClient.invalidateQueries({ queryKey }); onNotice(message); }
    catch (error) { await queryClient.invalidateQueries({ queryKey }); setActionError(failure(error)); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent<HTMLFormElement>, handler: (fd: FormData) => Promise<unknown>, success: string) => {
    event.preventDefault(); setFormError('');
    const form = event.currentTarget;
    void (async () => {
      try {
        const result = await handler(new FormData(form));
        await queryClient.invalidateQueries({ queryKey });
        if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') {
          setSelectedProjectId(result.id);
          setNewProject(false);
        }
        form.reset(); onNotice(success);
      }
      catch (error) { setFormError(failure(error)); }
    })();
  };
  const createProjectForm = (fd: FormData) => createProject.mutateAsync({ data: {
    organizationId, ...(String(fd.get('customerOrganizationId') ?? '') ? { customerOrganizationId: String(fd.get('customerOrganizationId')) } : {}),
    projectType: String(fd.get('projectType')) as 'internal' | 'external', title: String(fd.get('title')).trim(),
    objective: String(fd.get('objective')).trim(), scope: String(fd.get('scope')).trim(),
    budgetMinutes: Math.round(Number(fd.get('budgetMinutes')) * 60), budgetAmountCents: Math.round(Number(fd.get('budgetAmount')) * 100),
    startDate: String(fd.get('startDate')), endDate: String(fd.get('endDate')), operationId: opId(),
  } });
  const createWorkForm = (fd: FormData) => project ? createWorkOrder.mutateAsync({ projectId: project.id, data: {
    title: String(fd.get('title')).trim(), description: String(fd.get('description')).trim(), plannedMinutes: Math.round(Number(fd.get('plannedMinutes')) * 60),
    hourlyCostRateCents: Math.round(Number(fd.get('rate')) * 100), operationId: opId(),
  } }) : Promise.resolve();
  const createTimeForm = (fd: FormData) => createTimeEntry.mutateAsync({ data: {
    workOrderId: String(fd.get('workOrderId')), minutes: Number(fd.get('minutes')), simulatedDate: String(fd.get('simulatedDate')),
    description: String(fd.get('description')).trim(), operationId: opId(),
  } });
  const createResourceForm = (fd: FormData) => project ? createResource.mutateAsync({ data: {
    projectId: project.id, ...(String(fd.get('workOrderId') ?? '') ? { workOrderId: String(fd.get('workOrderId')) } : {}),
    resourceType: String(fd.get('resourceType')) as 'material' | 'external_service', description: String(fd.get('description')).trim(),
    quantityUnits: Number(fd.get('quantityUnits')),
    ...(String(fd.get('unitCost') ?? '') !== '' ? { unitCostCents: Math.round(Number(fd.get('unitCost')) * 100) } : {}),
    sourceType: String(fd.get('sourceType')) as 'manual' | 'purchase_receipt',
    ...(String(fd.get('sourceReference') ?? '') ? { sourceReference: String(fd.get('sourceReference')) } : {}), operationId: opId(),
    ...(String(fd.get('sourceLineId') ?? '') ? { sourceLineId: String(fd.get('sourceLineId')) } : {}),
  } }) : Promise.resolve();
  const createMilestoneForm = (fd: FormData) => project ? createMilestone.mutateAsync({ projectId: project.id, data: {
    title: String(fd.get('title')).trim(), description: String(fd.get('description')).trim(), dueDate: String(fd.get('dueDate')) || undefined,
    billingAmountCents: Math.round(Number(fd.get('amount')) * 100), requiresApproval: fd.get('requiresApproval') === 'on', operationId: opId(),
  } }) : Promise.resolve();
  const createDeliverableForm = (fd: FormData) => project ? createDeliverable.mutateAsync({ projectId: project.id, data: {
    ...(String(fd.get('milestoneId') ?? '') ? { milestoneId: String(fd.get('milestoneId')) } : {}), title: String(fd.get('title')).trim(),
    description: String(fd.get('description')).trim(), ...(String(fd.get('documentReference') ?? '') ? { documentReference: String(fd.get('documentReference')) } : {}), operationId: opId(),
  } }) : Promise.resolve();
  const filtered = projects.filter((p) => `${p.projectRef} ${p.title} ${p.customerOrganizationName ?? ''} ${p.status}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  const projectAction = (action: 'plan' | 'start' | 'hold' | 'resume' | 'complete' | 'close' | 'cancel') => project && void run(() => actProject.mutateAsync({ projectId: project.id, data: { action, operationId: opId() } }), 'Estado del proyecto actualizado.');
  const actionWork = (id: string, action: 'start' | 'complete' | 'review' | 'block') => void run(() => actWorkOrder.mutateAsync({ workOrderId: id, data: { action, operationId: opId() } }), 'Orden de trabajo actualizada.');
  const actionMilestone = (id: string, action: 'start' | 'submit' | 'accept' | 'reject') => {
    if (action === 'reject' && !reviewReason.trim()) { setActionError('Explica el motivo del rechazo del hito.'); return; }
    void run(() => actMilestone.mutateAsync({ milestoneId: id, data: { action, ...(reviewReason.trim() ? { description: reviewReason.trim() } : {}), operationId: opId() } }), 'Hito actualizado.');
  };
  const actionDeliverable = (id: string, action: 'submit' | 'accept' | 'request_changes' | 'reject') => {
    if (['request_changes', 'reject'].includes(action) && !reviewReason.trim()) { setActionError('Escribe la nota para solicitar cambios o rechazar el entregable.'); return; }
    void run(() => actDeliverable.mutateAsync({ deliverableId: id, data: { action, ...(reviewReason.trim() ? { description: reviewReason.trim() } : {}), operationId: opId() } }), 'Entregable actualizado.');
  };
  const refresh = () => { void queryClient.invalidateQueries({ queryKey }); };

  return <main className="page-content ps-page">
    <header className="ps-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>OPERACIONES · APLICACIÓN 13</span></div><span className="ps-kicker">EMPRESAS FICTICIAS · PROCESO TRAZABLE</span><h1>Proyectos y prestación de servicios</h1><p>Planifica el alcance, registra el trabajo y valida la evidencia antes de preparar una factura de servicio.</p></div>
      {!identity.organizationId && canReview && <Field label="Organización de trabajo"><select value={organizationId} onChange={(e) => setSelectedOrg(e.target.value)}><option value="">Selecciona organización</option>{organizations.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.center}</option>)}</select></Field>}
    </header>
    <aside className="ps-safety"><ShieldAlert size={19} /><div><b>ENTORNO EDUCATIVO · SOLO REGISTROS DE ESCENARIO</b><span>Importes y tarifas son didácticos. No se realizan pagos ni comunicaciones. Las referencias de recepción solo aportan trazabilidad y nunca modifican existencias.</span></div></aside>
    {!organizationId ? <section className="ps-unselected"><BriefcaseBusiness size={27} /><h2>Selecciona una organización</h2><p>La cartera y sus operaciones corresponden a una organización cada vez.</p>{canReview && <select aria-label="Organización de trabajo" value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}><option value="">Selecciona organización</option>{organizations.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.center}</option>)}</select>}</section> : <>
      <div className="ps-topline"><span><i /> Proceso auditable · datos recibidos del sistema</span><span>Fecha simulada · {date(data?.simulatedDate)}</span></div>
      <nav className="ps-tabs" role="tablist" aria-label="Vistas de proyectos y servicios">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => { if (id !== 'file') setNewProject(false); setView(id); setFormError(''); setActionError(''); }}><Icon size={15} />{label}</button>)}</nav>
      {overview.isLoading ? <div className="ps-skeleton" role="status" aria-label="Cargando cartera"><span /><span /><span /><span /></div> : overview.isError ? <div className="ps-error-banner" role="alert"><AlertCircle size={17} />No se ha podido cargar la cartera.<button type="button" onClick={refresh}><RefreshCw size={14} /> Reintentar</button></div> : data && <>
        <section className="ps-metrics">
          <article><span className="blue"><BriefcaseBusiness size={17} /></span><small>Proyectos activos</small><strong>{data.summary.activeProjects}</strong><em>En esta organización</em></article>
          <article><span className="teal"><Clock3 size={17} /></span><small>Horas aprobadas</small><strong>{(data.summary.approvedMinutes / 60).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h</strong><em>{(data.summary.plannedMinutes / 60).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h planificadas</em></article>
          <article><span className="amber"><CalendarDays size={17} /></span><small>Hitos próximos</small><strong>{data.summary.upcomingMilestones}</strong><em>{data.summary.pendingReviews} revisiones pendientes</em></article>
          <article><span className="green"><CircleDollarSign size={17} /></span><small>Valor aceptado</small><strong>{money(data.summary.acceptedValueCents)}</strong><em>Facturado {money(data.summary.invoicedCents)}</em></article>
        </section>
        {!canReview && <div className="ps-permission"><BadgeCheck size={15} /> Puedes crear y ejecutar registros. Las revisiones y aprobaciones solo están disponibles para docentes y administración.</div>}
         {canReview && <div className="ps-review-note"><Field label="Nota de revisión"><input value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} placeholder="Motivo de rechazo o cambios solicitados" /></Field></div>}
        {actionError && <div className="ps-error-banner inline" role="alert"><AlertCircle size={16} />{actionError}<button type="button" onClick={() => setActionError('')}>Cerrar</button></div>}
        <div className="ps-stage page-enter">
          {view === 'portfolio' && <section className="ps-panel">
            <header className="ps-section-head"><div><span className="ps-eyebrow">OPERACIONES EN MARCHA</span><h2>Cartera de proyectos</h2><p>Cliente, responsable, progreso financiero y estado del trabajo.</p></div><button className="ps-button primary" type="button" onClick={() => { setNewProject(true); setView('file'); }}><Plus size={15} /> Nuevo proyecto</button></header>
            <label className="ps-search"><span>Buscar proyecto</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Referencia, nombre o cliente" /></label>
            <div className="ps-table-wrap"><table><thead><tr><th>Proyecto</th><th>Cliente</th><th>Responsable</th><th>Progreso económico</th><th>Objetivo</th><th>Estado</th></tr></thead><tbody>
              {filtered.map((p) => <tr key={p.id} className={project?.id === p.id ? 'selected' : ''}><td><button className="ps-row-select" onClick={() => { setNewProject(false); setSelectedProjectId(p.id); setView('file'); }}><b className="mono">{p.projectRef}</b><small>{p.title}</small></button></td><td>{p.customerOrganizationName ?? 'Interno'}</td><td>{p.createdByName}</td><td><div className="ps-progress"><span><i style={{ width: `${Math.max(0, Math.min(100, p.budgetAmountCents ? p.actualCostCents / p.budgetAmountCents * 100 : 0))}%` }} /></span><small>{money(p.actualCostCents)} / {money(p.budgetAmountCents)}</small></div></td><td>{date(p.endDate)}</td><td><Status value={p.status} /></td></tr>)}
              {!filtered.length && <tr><td colSpan={6}><Empty title="No hay proyectos coincidentes" detail="Ajusta la búsqueda o registra un proyecto para comenzar." /></td></tr>}
            </tbody></table></div>
          </section>}
          {view === 'file' && <div className="ps-columns"><section className="ps-panel">
            <header className="ps-section-head"><div><span className="ps-eyebrow">{project ? `FICHA · ${project.projectRef}` : 'ALTA DE PROYECTO'}</span><h2>{project?.title ?? 'Nuevo proyecto'}</h2><p>{project ? 'Alcance, presupuesto, fechas e historial de revisión.' : 'Define el alcance inicial del servicio en el escenario.'}</p></div>{project && <Status value={project.status} />}</header>
            {project ? <>
              <div className="ps-detail-grid"><div><small>Cliente</small><b>{project.customerOrganizationName ?? 'Proyecto interno'}</b></div><div><small>Versión</small><b>v{project.version}</b></div><div><small>Periodo</small><b>{date(project.startDate)} — {date(project.endDate)}</b></div><div><small>Presupuesto</small><b>{money(project.budgetAmountCents)} · {(project.budgetMinutes / 60).toLocaleString('es-ES')} h</b></div><div className="wide"><small>Objetivo</small><p>{project.objective}</p></div><div className="wide"><small>Alcance aprobado</small><p>{project.scope}</p></div></div>
              <div className="ps-actions">{(({
                draft: ['plan'], planned: ['start','cancel'], in_progress: ['hold','complete'], on_hold: ['resume','cancel'], completed: ['close'],
              } as Record<string, Array<'plan' | 'start' | 'hold' | 'resume' | 'complete' | 'close' | 'cancel'>>)[project.status] ?? []).filter((action) => canReview || !['plan', 'complete', 'close', 'cancel'].includes(action)).map((action) => <button key={action} className="ps-button secondary" disabled={busy} onClick={() => projectAction(action)}>{({ plan:'Planificar', start:'Iniciar', hold:'Poner en pausa', resume:'Reanudar', complete:'Completar', close:'Cerrar', cancel:'Cancelar' })[action]}</button>)}</div>
              <h3 className="ps-subtitle">Solicitar revisión de versión</h3><form className="ps-form" onSubmit={(e) => submit(e, (fd) => createRevision.mutateAsync({ projectId: project.id, data: { title: String(fd.get('title')).trim(), objective: String(fd.get('objective')).trim(), scope: String(fd.get('scope')).trim(), budgetMinutes: Math.round(Number(fd.get('budgetMinutes')) * 60), budgetAmountCents: Math.round(Number(fd.get('budgetAmount')) * 100), reason: String(fd.get('reason')).trim(), operationId: opId() } }), 'Nueva versión enviada a revisión.')}>
              <div className="ps-grid"><Field label="Título"><input name="title" required minLength={3} defaultValue={project.title} /></Field><Field label="Horas presupuestadas"><input name="budgetMinutes" type="number" min="1" step=".25" required defaultValue={project.budgetMinutes / 60} /></Field></div>
                <Field label="Objetivo"><textarea name="objective" minLength={10} required defaultValue={project.objective} /></Field><Field label="Alcance"><textarea name="scope" minLength={10} required defaultValue={project.scope} /></Field>
              <div className="ps-grid"><Field label="Presupuesto (€)"><input name="budgetAmount" type="number" min="0" step=".01" required defaultValue={project.budgetAmountCents / 100} /></Field><Field label="Motivo de cambio"><input name="reason" required minLength={10} placeholder="Explica la revisión solicitada" /></Field></div><FormError>{formError}</FormError><button className="ps-button primary" disabled={createRevision.isPending}><Plus size={14} />Solicitar revisión</button>
              </form>
              <h3 className="ps-subtitle">Historial de versiones</h3><div className="ps-record-list">{data.revisions.filter((r) => r.projectId === project.id).map((r) => <article key={r.id}><div><b>v{r.version} · {r.title}</b><small>{r.reason} · {r.createdByName} · {date(r.createdAt)}</small></div><Status value={r.status} />{canReview && r.status === 'pending_review' && <><button className="ps-button secondary" disabled={busy} onClick={() => void run(() => reviewRevision.mutateAsync({ revisionId: r.id, data: { action: 'approve', operationId: opId() } }), 'Versión aprobada.')}>Aprobar</button><button className="ps-button subtle" disabled={busy} onClick={() => void run(() => reviewRevision.mutateAsync({ revisionId: r.id, data: { action: 'reject', operationId: opId() } }), 'Versión rechazada.')}>Rechazar</button></>}</article>)}{!data.revisions.some((r) => r.projectId === project.id) && <p className="ps-muted">Sin revisiones registradas.</p>}</div>
              <h3 className="ps-subtitle">Historial de actividad</h3><div className="ps-timeline">{data.events.filter((ev) => ev.projectId === project.id).slice(0, 8).map((ev) => <article key={ev.id}><i /><div><b>{ev.description}</b><small>{ev.actorName} · {date(ev.simulatedDate)}</small></div></article>)}{!data.events.some((ev) => ev.projectId === project.id) && <p className="ps-muted">Las actuaciones aparecerán en esta cronología.</p>}</div>
            </> : <form className="ps-form" onSubmit={(e) => submit(e, createProjectForm, 'Proyecto creado en el escenario educativo.')}>
              <div className="ps-grid"><Field label="Tipo de proyecto"><select name="projectType"><option value="external">Servicio a cliente</option><option value="internal">Proyecto interno</option></select></Field><Field label="Cliente"><select name="customerOrganizationId"><option value="">Sin cliente externo</option>{data.customerOrganizations.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.center} · {c.island}</option>)}</select></Field></div>
              <Field label="Nombre del proyecto"><input name="title" required minLength={3} maxLength={140} /></Field><Field label="Objetivo"><textarea name="objective" required minLength={10} placeholder="Resultado esperado para este escenario" /></Field><Field label="Alcance"><textarea name="scope" required minLength={10} placeholder="Incluye entregables y límites del servicio" /></Field>
              <div className="ps-grid"><Field label="Horas presupuestadas"><input name="budgetMinutes" type="number" min="1" step=".25" required /></Field><Field label="Presupuesto (€)"><input name="budgetAmount" type="number" min="0" step=".01" required /><small>Importe didáctico de escenario</small></Field></div>
              <div className="ps-grid"><Field label="Inicio"><input name="startDate" type="date" required /></Field><Field label="Fecha objetivo"><input name="endDate" type="date" required /></Field></div>
              <FormError>{formError}</FormError><button className="ps-button primary" disabled={createProject.isPending || !organizationId}><Plus size={14} />Crear proyecto</button>
            </form>}
          </section><aside className="ps-aside"><ShieldAlert size={19} /><span className="ps-eyebrow">CONTROL DE ALCANCE</span><h3>Versiones claras.<br />Cambios revisables.</h3><p>Las modificaciones de presupuesto, objetivo o alcance se registran como una versión y requieren revisión docente para su aprobación.</p><div className="ps-aside-note">No incluyas datos personales ni información de clientes reales.</div></aside></div>}
          {view === 'work' && <div className="ps-columns"><section className="ps-panel"><header className="ps-section-head"><div><span className="ps-eyebrow">EJECUCIÓN · {project?.projectRef ?? 'PROYECTO'}</span><h2>Órdenes de trabajo</h2><p>Asigna tareas y registra partes de trabajo con tarifa didáctica.</p></div></header>{project ? <>
            <form className="ps-form compact" onSubmit={(e) => submit(e, createWorkForm, 'Orden de trabajo registrada.')}>
              <div className="ps-grid"><Field label="Tarea"><input name="title" required minLength={3} /></Field><Field label="Horas planificadas"><input name="plannedMinutes" type="number" min=".25" step=".25" required /></Field></div><Field label="Descripción"><textarea name="description" required minLength={10} /></Field><Field label="Tarifa de coste (€/h)" hint="Tarifa exclusivamente didáctica; no es una nómina ni un pago."><input name="rate" type="number" min="0" step=".01" required /></Field><FormError>{formError}</FormError><button className="ps-button primary" disabled={createWorkOrder.isPending}><Plus size={14} />Crear orden</button>
            </form>
            <div className="ps-record-list">{data.workOrders.filter((w) => w.projectId === project.id).map((w) => <article key={w.id} className="ps-work-card"><div><b>{w.workRef} · {w.title}</b><small>{w.description}</small><small>{w.assignedToName} · {w.plannedMinutes} min · {money(w.hourlyCostRateCents)}/h</small></div><Status value={w.status} /><div className="ps-actions">{w.status === 'assigned' && <button className="ps-button secondary" onClick={() => actionWork(w.id,'start')}>Iniciar</button>}{w.status === 'in_progress' && <button className="ps-button secondary" onClick={() => actionWork(w.id,'complete')}>Marcar completada</button>}{canReview && w.status === 'completed' && <button className="ps-button primary" onClick={() => actionWork(w.id,'review')}>Revisar orden</button>}</div>
              {w.status !== 'reviewed' && <form className="ps-inline-form" onSubmit={(e) => submit(e, createTimeForm, 'Parte de trabajo registrado para revisión.')}><input type="hidden" name="workOrderId" value={w.id} /><Field label="Minutos"><input name="minutes" type="number" min="1" max="1440" required /></Field><Field label="Fecha simulada"><input name="simulatedDate" type="date" defaultValue={data.simulatedDate} required /></Field><Field label="Descripción"><input name="description" minLength={10} required placeholder="Trabajo realizado" /></Field><button className="ps-button secondary" disabled={createTimeEntry.isPending}>Registrar parte</button></form>}
            </article>)}{!data.workOrders.some((w) => w.projectId === project.id) && <Empty title="Sin órdenes de trabajo" detail="Crea una orden para iniciar el seguimiento de tareas." />}</div>
            <h3 className="ps-subtitle">Partes de trabajo</h3>{data.timeEntries.filter((e) => e.projectId === project.id).map((entry) => <div className="ps-list-row" key={entry.id}><span><b>{entry.description}</b><small>{entry.minutes} min · {date(entry.simulatedDate)} · {money(entry.costCents)}</small></span><Status value={entry.status} />{canReview && entry.status === 'pending_review' && <><button className="ps-button secondary" disabled={busy} onClick={() => void run(() => reviewTimeEntry.mutateAsync({ entryId: entry.id, data: { action: 'approve', operationId: opId() } }), 'Parte de trabajo aprobado.')}>Aprobar</button><button className="ps-button subtle" disabled={busy || !reviewReason.trim()} onClick={() => void run(() => reviewTimeEntry.mutateAsync({ entryId: entry.id, data: { action: 'reject', reason: reviewReason.trim(), operationId: opId() } }), 'Parte de trabajo rechazado.')}>Rechazar</button></>}</div>)}
          </> : <Empty title="Selecciona un proyecto" detail="Elige un proyecto desde la cartera para gestionar sus tareas." />}</section><aside className="ps-aside"><Clock3 size={19} /><span className="ps-eyebrow">REGISTRO DE TRABAJO</span><h3>El tiempo deja rastro.</h3><p>Los partes se vinculan a una orden. Las horas y tarifas se guardan como valores del escenario, sujetos a revisión docente.</p></aside></div>}
          {view === 'costs' && <div className="ps-columns"><section className="ps-panel"><header className="ps-section-head"><div><span className="ps-eyebrow">CONSUMOS DE ESCENARIO</span><h2>Recursos y costes</h2><p>Registra material o servicios y vincula una referencia de recepción auditable.</p></div></header>{project ? <>
            <form className="ps-form" onSubmit={(e) => submit(e, createResourceForm, 'Recurso registrado para revisión. No se han modificado existencias.')}>
              <div className="ps-grid"><Field label="Tipo de recurso"><select name="resourceType"><option value="material">Material</option><option value="external_service">Servicio externo</option></select></Field><Field label="Orden vinculada"><select name="workOrderId"><option value="">Sin orden</option>{data.workOrders.filter((w) => w.projectId === project.id).map((w) => <option key={w.id} value={w.id}>{w.workRef} · {w.title}</option>)}</select></Field></div>
              <Field label="Descripción"><input name="description" required minLength={3} /></Field><div className="ps-grid"><Field label="Unidades"><input name="quantityUnits" type="number" min="1" required /></Field>{resourceSourceType === 'manual' ? <Field label="Coste unitario didáctico (€)" hint="Valor de escenario, no pago real"><input name="unitCost" type="number" min="0" step=".01" required /></Field> : <Field label="Línea aceptada del albarán"><select name="sourceLineId" required><option value="">Selecciona una línea recibida</option>{data.purchaseReceiptLines.map((line) => <option key={line.id} value={line.id}>{line.receiptReference} · {line.sku} · {line.productName} · {line.quantityAccepted} ud. · {money(line.unitPriceCents)}/ud.</option>)}</select><small>El coste unitario y la referencia se obtienen del albarán recibido.</small></Field>}</div>
              <div className="ps-grid"><Field label="Origen de trazabilidad"><select name="sourceType" value={resourceSourceType} onChange={(event) => setResourceSourceType(event.target.value as 'manual' | 'purchase_receipt')}><option value="manual">Referencia interna</option><option value="purchase_receipt">Recepción de compra</option></select></Field>{resourceSourceType === 'manual' && <Field label="Referencia interna"><input name="sourceReference" maxLength={120} placeholder="Referencia opcional" /></Field>}</div>
              <FormError>{formError}</FormError><button className="ps-button primary" disabled={createResource.isPending}><Plus size={14} />Registrar coste</button>
            </form>
            <div className="ps-record-list">{data.resources.filter((r) => r.projectId === project.id).map((r) => <article key={r.id}><div><b>{r.description}</b><small>{r.quantityUnits} × {money(r.unitCostCents)} = {money(r.totalCostCents)} · {r.sourceReference ?? 'Sin referencia'}</small></div><Status value={r.status} />{canReview && r.status === 'pending_review' && <><button className="ps-button secondary" disabled={busy} onClick={() => void run(() => reviewResource.mutateAsync({ resourceId: r.id, data: { action: 'approve', operationId: opId() } }), 'Coste aprobado.')}>Aprobar</button><button className="ps-button subtle" disabled={busy || !reviewReason.trim()} onClick={() => void run(() => reviewResource.mutateAsync({ resourceId: r.id, data: { action: 'reject', reason: reviewReason.trim(), operationId: opId() } }), 'Coste rechazado.')}>Rechazar</button></>}</article>)}{!data.resources.some((r) => r.projectId === project.id) && <Empty title="Sin costes registrados" detail="Los costes aprobados aparecerán aquí con su referencia de origen." />}</div>
          </> : <Empty title="Selecciona un proyecto" detail="Elige un proyecto de la cartera." />}</section><aside className="ps-aside caution"><WalletCards size={19} /><span className="ps-eyebrow">REFERENCIA, NO MOVIMIENTO</span><h3>La recepción no toca stock.</h3><p>Una recepción de compra sirve solo como fuente de auditoría. Este registro no altera almacén, existencias ni pedidos.</p></aside></div>}
          {view === 'deliverables' && <div className="ps-columns"><section className="ps-panel"><header className="ps-section-head"><div><span className="ps-eyebrow">HITOS Y EVIDENCIAS</span><h2>Entregables y validación</h2><p>Relaciona evidencias con hitos y sigue la aceptación interna.</p></div></header>{project ? <>
            <h3 className="ps-subtitle">Nuevo hito de servicio</h3><form className="ps-form" onSubmit={(e) => submit(e, createMilestoneForm, 'Hito registrado en el proyecto.')}>
              <div className="ps-grid"><Field label="Nombre del hito"><input name="title" required minLength={3} /></Field><Field label="Fecha objetivo"><input name="dueDate" type="date" /></Field></div><Field label="Descripción"><textarea name="description" required minLength={10} /></Field><div className="ps-grid"><Field label="Valor facturable (€)" hint="Valor educativo previsto"><input name="amount" type="number" min="0" step=".01" required /></Field><Field label="Revisión"><span className="ps-check"><input type="checkbox" name="requiresApproval" defaultChecked /> Requiere aceptación</span></Field></div><FormError>{formError}</FormError><button className="ps-button primary" disabled={createMilestone.isPending}><Plus size={14} />Crear hito</button>
            </form>
            <h3 className="ps-subtitle">Hitos</h3><div className="ps-record-list">{data.milestones.filter((m) => m.projectId === project.id).map((m) => <article key={m.id}><div><b>{m.milestoneRef} · {m.title}</b><small>{m.description} · {date(m.dueDate)} · {money(m.billingAmountCents)}</small></div><Status value={m.status} /><div className="ps-actions">{m.status === 'planned' && <button className="ps-button secondary" onClick={() => actionMilestone(m.id,'start')}>Iniciar</button>}{['planned','in_progress'].includes(m.status) && <button className="ps-button secondary" onClick={() => actionMilestone(m.id,'submit')}>Enviar a validación</button>}{canReview && m.status === 'submitted' && <><button className="ps-button primary" onClick={() => actionMilestone(m.id,'accept')}>Aceptar</button><button className="ps-button subtle" onClick={() => actionMilestone(m.id,'reject')}>Rechazar</button></>}</div></article>)}{!data.milestones.some((m) => m.projectId === project.id) && <Empty title="Sin hitos definidos" detail="Crea el primer hito para ordenar las entregas del servicio." />}</div>
            <h3 className="ps-subtitle">Registrar evidencia</h3><form className="ps-form" onSubmit={(e) => submit(e, createDeliverableForm, 'Entregable registrado como borrador.')}>
              <div className="ps-grid"><Field label="Título"><input name="title" required minLength={3} /></Field><Field label="Hito relacionado"><select name="milestoneId"><option value="">Sin hito</option>{data.milestones.filter((m) => m.projectId === project.id).map((m) => <option key={m.id} value={m.id}>{m.milestoneRef} · {m.title}</option>)}</select></Field></div><Field label="Descripción"><textarea name="description" required minLength={10} /></Field><Field label="Referencia documental"><input name="documentReference" maxLength={200} placeholder="Código o ubicación interna, sin adjuntar datos personales" /></Field><FormError>{formError}</FormError><button className="ps-button primary" disabled={createDeliverable.isPending}><Plus size={14} />Registrar entregable</button>
            </form>
            <div className="ps-record-list">{data.deliverables.filter((d) => d.projectId === project.id).map((d) => <article key={d.id}>
              <div><b>{d.deliverableRef} · {d.title}</b><small>{d.description} · Evidencia: {d.documentReference ?? 'Sin referencia'} · v{d.version}</small></div><Status value={d.status} />
              <div className="ps-actions">
                {d.status === 'draft' && <button className="ps-button secondary" disabled={busy} onClick={() => actionDeliverable(d.id, 'submit')}>Enviar</button>}
                {d.status === 'changes_requested' && <form className="ps-revision-form" onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void run(() => actDeliverable.mutateAsync({ deliverableId: d.id, data: {
                    action: 'submit',
                    description: String(form.get('description')).trim(),
                    ...(String(form.get('documentReference') ?? '').trim() ? { documentReference: String(form.get('documentReference')).trim() } : {}),
                    operationId: opId(),
                  } }), 'Nueva versión remitida a revisión.');
                }}>
                  <Field label="Descripción revisada"><textarea name="description" required minLength={10} defaultValue={d.description} /></Field>
                  <Field label="Nueva referencia documental"><input name="documentReference" maxLength={200} defaultValue={d.documentReference ?? ''} /></Field>
                  <button className="ps-button secondary" disabled={busy}>Reenviar versión {d.version + 1}</button>
                </form>}
                {canReview && d.status === 'submitted' && <><button className="ps-button primary" disabled={busy} onClick={() => actionDeliverable(d.id, 'accept')}>Aceptar</button><button className="ps-button secondary" disabled={busy} onClick={() => actionDeliverable(d.id, 'request_changes')}>Solicitar cambios</button><button className="ps-button subtle" disabled={busy} onClick={() => actionDeliverable(d.id, 'reject')}>Rechazar</button></>}
              </div>
            </article>)}{!data.deliverables.some((d) => d.projectId === project.id) && <Empty title="Sin entregables" detail="Registra una evidencia interna para iniciar su validación." />}</div>
          </> : <Empty title="Selecciona un proyecto" detail="Elige un proyecto de la cartera." />}</section><aside className="ps-aside"><FileCheck2 size={19} /><span className="ps-eyebrow">VALIDACIÓN INTERNA</span><h3>La evidencia precede al valor.</h3><p>Los estados aceptados reflejan revisión en el escenario. No implican conformidad ni recepción por parte de un cliente real.</p></aside></div>}
          {view === 'billing' && <div className="ps-columns"><section className="ps-panel"><header className="ps-section-head"><div><span className="ps-eyebrow">FACTURACIÓN DE SERVICIOS</span><h2>Hitos aceptados</h2><p>Prepara un único pedido de servicio por hito aceptado y después emite la factura normal.</p></div></header>{project ? <>
            <div className="ps-callout"><ShieldAlert size={17} /><span>La acción usa el circuito estándar de facturación. No marques una factura como emitida hasta recibir confirmación del sistema.</span></div>
            {data.serviceProducts.length > 0 ? <Field label="Servicio del catálogo"><select value={selectedServiceSku || data.serviceProducts[0].sku} onChange={(event) => setSelectedServiceSku(event.target.value)}>{data.serviceProducts.map((item) => <option key={item.id} value={item.sku}>{item.sku} · {item.name}</option>)}</select></Field> : <p className="ps-note">No hay servicios activos y aprobados en el catálogo. Añade uno antes de preparar una factura.</p>}
            <div className="ps-record-list">{data.milestones.filter((m) => m.projectId === project.id).map((m) => { const billing = data.billings.find((b) => b.milestoneId === m.id); return <article key={m.id}><div><b>{m.milestoneRef} · {m.title}</b><small>{money(m.billingAmountCents)} · {m.requiresApproval ? 'Requiere aceptación' : 'Sin aprobación requerida'}</small>{billing && <small>Pedido {billing.orderReference} · {billing.invoiceReference ? `Factura ${billing.invoiceReference}` : 'Factura pendiente'}</small>}</div><Status value={billing?.invoiceId ? 'invoiced' : billing ? 'billing_ready' : m.status} />{m.status === 'accepted' && !billing && identity.organizationId === organizationId && <button className="ps-button primary" disabled={busy || !data.serviceProducts.length} onClick={() => {
              if (!project.customerOrganizationId) { setActionError('Este proyecto no tiene una organización cliente y no puede preparar un pedido de servicio.'); return; }
              const product = data.serviceProducts.find((item) => item.sku === selectedServiceSku) ?? data.serviceProducts[0];
              if (!product) { setActionError('No hay un servicio disponible en el catálogo del escenario.'); return; }
              void run(async () => {
                const order = await createBilling.mutateAsync({ data: { milestoneId: m.id, serviceSku: product.sku, operationId: opId() } });
                await issueInvoice.mutateAsync({ data: { orderId: order.orderId } });
              }, 'Factura emitida por el circuito estándar.');
            }}><ArrowRight size={14} />Preparar pedido y emitir factura</button>}{billing && !billing.invoiceId && identity.organizationId === organizationId && <button className="ps-button secondary" disabled={busy} onClick={() => void run(() => issueInvoice.mutateAsync({ data: { orderId: billing.orderId } }), 'Factura emitida por el circuito estándar.')}>Emitir factura</button>}{billing && <span className="ps-billing-meta">{billing.invoiceId ? `Factura ${billing.invoiceReference ?? 'registrada'}` : `Pedido ${billing.orderReference} sin factura`}</span>}</article>; })}{!data.milestones.some((m) => m.projectId === project.id) && <Empty title="Sin hitos facturables" detail="Los hitos aceptados aparecerán aquí para preparar su facturación." />}</div>
            <p className="ps-note">Se vincula un pedido de servicio por hito aceptado. La factura solo se muestra como emitida si el endpoint estándar devuelve éxito.</p>
          </> : <Empty title="Selecciona un proyecto" detail="Elige un proyecto de la cartera." />}</section><aside className="ps-aside caution"><CircleDollarSign size={19} /><span className="ps-eyebrow">CIRCUITO NORMAL</span><h3>Sin facturas ficticias.</h3><p>El módulo registra el pedido de servicio ligado al hito y llama al servicio de facturación existente. No simula ni inventa una factura emitida.</p></aside></div>}
          {view === 'results' && <section className="ps-panel"><header className="ps-section-head"><div><span className="ps-eyebrow">CIERRE DE GESTIÓN</span><h2>Resultados</h2><p>Acumulados aprobados y valores aceptados por proyecto.</p></div></header>{project ? <>
            <div className="ps-results-head"><div><span className="mono">{project.projectRef}</span><h3>{project.title}</h3><Status value={project.status} /></div><div><small>Margen previsto</small><b className={project.projectedMarginCents < 0 ? 'negative' : ''}>{money(project.projectedMarginCents)}</b></div></div>
            <div className="ps-results-grid"><article><small>Horas aprobadas</small><b>{(data.timeEntries.filter((x) => x.projectId === project.id && x.status === 'approved').reduce((s, x) => s + x.minutes, 0) / 60).toLocaleString('es-ES', { maximumFractionDigits: 1 })} h</b></article><article><small>Coste de trabajo aprobado</small><b>{money(data.timeEntries.filter((x) => x.projectId === project.id && x.status === 'approved').reduce((s, x) => s + x.costCents, 0))}</b></article><article><small>Costes de recursos aprobados</small><b>{money(data.resources.filter((x) => x.projectId === project.id && x.status === 'approved').reduce((s, x) => s + x.totalCostCents, 0))}</b></article><article><small>Valor aceptado</small><b>{money(project.acceptedValueCents)}</b></article><article><small>Facturas registradas</small><b>{money(project.invoicedCents)}</b></article><article><small>Coste real registrado</small><b>{money(project.actualCostCents)}</b></article></div>
          </> : <Empty title="Selecciona un proyecto" detail="Los resultados se calculan con registros recibidos del API." />}</section>}
        </div>
      </>}
    </>}
  </main>;
}

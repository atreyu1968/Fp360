import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, Archive, ArrowDownToLine, ArrowRight, BadgeCheck, BookOpen, Check, CheckCircle2,
  ChevronRight, CircleAlert, ClipboardCheck, FileClock, FileText, Filter, History, LockKeyhole,
  MessageSquareText, Plus, Send, ShieldCheck, Users, X,
} from 'lucide-react';
import {
  getGetFp360SimulationsOverviewQueryKey, getGetPortfolioEntryHistoryQueryKey,
  getGetPortfolioOverviewQueryKey, useCreatePortfolioCriterion, useCreatePortfolioEntry,
  useGetFp360SimulationsOverview, useGetPortfolioEntryHistory, useGetPortfolioOverview,
  useReviewPortfolioEntry, useSubmitPortfolioEntry, useUpdatePortfolioEntry,
} from '@workspace/api-client-react';
import type { PortfolioEntry } from '@workspace/api-client-react';
import { Form } from '@/components/ui/form';
import './portfolio-page.css';

type PortfolioView = 'mine' | 'criteria' | 'activity' | 'team' | 'feedback' | 'reports';
type Props = { identity: { role: string; organizationId?: string }; onNotice: (message: string) => void };
type EntryValues = { reflection: string; contribution: string; selfAssessment: string };
type CriterionValues = { code: string; title: string; description: string; isRequired: boolean };
type ReviewValues = { feedback: string };

const views: { id: PortfolioView; label: string; icon: typeof BookOpen; eyebrow: string }[] = [
  { id: 'mine', label: 'Mi portafolio', icon: BookOpen, eyebrow: 'EVIDENCIAS' },
  { id: 'criteria', label: 'Evidencias por criterio', icon: ClipboardCheck, eyebrow: 'APRENDIZAJE' },
  { id: 'activity', label: 'Actividad', icon: Activity, eyebrow: 'SIMULACIÓN' },
  { id: 'team', label: 'Portafolio cooperativo', icon: Users, eyebrow: 'EQUIPO' },
  { id: 'feedback', label: 'Retroalimentación', icon: MessageSquareText, eyebrow: 'REVISIÓN' },
  { id: 'reports', label: 'Informes y exportación', icon: Archive, eyebrow: 'TRAZABILIDAD' },
];
const statusText: Record<string, string> = {
  draft: 'Borrador', submitted: 'En revisión', returned: 'Requiere ajuste', validated: 'Validada',
};
const statusTone: Record<string, string> = {
  draft: 'draft', submitted: 'submitted', returned: 'returned', validated: 'validated',
};
const eventTypeText: Record<string, string> = {
  offer: 'Oferta comercial', late_payment: 'Retraso de pago', stock_break: 'Rotura de stock',
  claim: 'Reclamación', financing: 'Financiación', service_incident: 'Incidencia de servicio',
  other: 'Caso de simulación',
};
const dateText = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const operationId = () => `portfolio:${crypto.randomUUID()}`;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la acción. Revisa tus permisos e inténtalo de nuevo.';

function Status({ value }: { value: string }) {
  return <span className={`pf-status pf-status-${statusTone[value] ?? 'draft'}`} data-testid={`status-portfolio-${value}`}><i />{statusText[value] ?? value}</span>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="pf-empty"><span><FileText size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Skeleton() {
  return <div className="pf-skeleton" aria-label="Cargando portafolio"><i /><i /><i /><i /></div>;
}
function EntryRow({ entry, active, onSelect, summaryOnly = false }: { entry: PortfolioEntry; active: boolean; onSelect: () => void; summaryOnly?: boolean }) {
  return <button className={`pf-entry-row ${active ? 'active' : ''}`} onClick={onSelect} data-testid={`row-portfolio-entry-${entry.id}`}>
    <span className="pf-entry-symbol"><FileText size={16} /></span>
    <span className="pf-entry-info"><small>{entry.campaignTitle} · {dateText(entry.simulatedDate)}</small><b>{entry.activityTitle}</b>
      <span>{summaryOnly ? 'Aportación registrada' : `${entry.criteria.length} criterios vinculados · v${entry.version}`}</span></span>
    <Status value={entry.status} /><ChevronRight size={15} className="pf-row-chevron" />
  </button>;
}
function EntryForm({ entry, criteria, onSave, onClose, busy }: {
  entry?: PortfolioEntry; criteria: { id: string; code: string | null; title: string; description: string; isRequired: boolean }[];
  onSave: (values: EntryValues, criterionIds: string[]) => void; onClose: () => void; busy: boolean;
}) {
  const form = useForm<EntryValues>({
    defaultValues: { reflection: entry?.reflection ?? '', contribution: entry?.contribution ?? '', selfAssessment: entry?.selfAssessment ?? '' },
  });
  const [selected, setSelected] = useState<string[]>(entry?.criteria.map((item) => item.id) ?? []);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <div className="pf-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="pf-modal" role="dialog" aria-modal="true" aria-labelledby="pf-entry-modal-title">
      <header><div><small>{entry ? 'EDICIÓN DE EVIDENCIA' : 'NUEVA EVIDENCIA'}</small><h2 id="pf-entry-modal-title">{entry?.activityTitle ?? 'Documentar una actividad'}</h2></div><button className="pf-icon-button" aria-label="Cerrar" onClick={onClose} data-testid="button-close-entry-form"><X size={18} /></button></header>
      <p className="pf-modal-context">{entry ? `${entry.campaignTitle} · ${dateText(entry.simulatedDate)}` : 'La evidencia se vincula a un evento completado de FP360 SIM.'}</p>
      <Form {...form}><form className="pf-form" onSubmit={form.handleSubmit((values) => onSave(values, selected))} data-testid="form-portfolio-entry">
        <fieldset className="pf-criteria-select"><legend>Criterios de aprendizaje <span>Selecciona al menos uno</span></legend>
          {criteria.length ? criteria.map((criterion) => <label key={criterion.id} className="pf-check-row">
            <input type="checkbox" checked={selected.includes(criterion.id)} onChange={() => toggle(criterion.id)} data-testid={`checkbox-entry-criterion-${criterion.id}`} />
            <span><b>{criterion.code ? `${criterion.code} · ` : ''}{criterion.title}</b><small>{criterion.description}{criterion.isRequired ? ' · Obligatorio' : ''}</small></span>
          </label>) : <p className="pf-inline-hint">Aún no hay criterios disponibles para esta campaña.</p>}
        </fieldset>
        <label className="pf-field"><span>Reflexión personal <small>Solo visible para ti y el equipo docente autorizado.</small></span>
          <textarea {...form.register('reflection', { required: true, minLength: 20, maxLength: 2000 })} rows={4} placeholder="¿Qué decisión tomaste y qué aprendiste del resultado?" data-testid="textarea-entry-reflection" />
          {form.formState.errors.reflection && <em>Escribe al menos 20 caracteres (máximo 2.000).</em>}
        </label>
        <label className="pf-field"><span>Mi contribución <small>Describe qué parte realizaste tú.</small></span>
          <textarea {...form.register('contribution', { required: true, minLength: 10, maxLength: 1000 })} rows={3} placeholder="Tareas, decisiones o entregables propios…" data-testid="textarea-entry-contribution" />
          {form.formState.errors.contribution && <em>Escribe al menos 10 caracteres (máximo 1.000).</em>}
        </label>
        <label className="pf-field"><span>Autoevaluación <small>Opcional · hasta 1.000 caracteres.</small></span>
          <textarea {...form.register('selfAssessment', { maxLength: 1000 })} rows={2} placeholder="¿Qué harías de otra manera la próxima vez?" data-testid="textarea-entry-self-assessment" />
        </label>
        <div className="pf-form-foot"><span><LockKeyhole size={13} /> La reflexión no se comparte en vistas cooperativas.</span>
          <div><button type="button" className="pf-button quiet" onClick={onClose} data-testid="button-cancel-entry">Cancelar</button>
            <button className="pf-button primary" disabled={busy || selected.length === 0} type="submit" data-testid="button-save-entry">{busy ? 'Guardando…' : 'Guardar borrador'} <ArrowRight size={14} /></button></div></div>
      </form></Form>
    </section>
  </div>;
}

export function PortfolioPage({ identity, onNotice }: Props) {
  const client = useQueryClient();
  const [view, setView] = useState<PortfolioView>(identity?.role === 'team_manager' ? 'team' : 'mine');
  const [campaignId, setCampaignId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [formActivityId, setFormActivityId] = useState('');
  const [criterionOpen, setCriterionOpen] = useState(false);
  const [reviewEntryId, setReviewEntryId] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const notify = (text: string, error = false) => { setNotice({ text, error }); onNotice(text); };

  const simulation = useGetFp360SimulationsOverview({ query: { queryKey: getGetFp360SimulationsOverviewQueryKey() } });
  const params = campaignId ? { campaignId } : undefined;
  const overview = useGetPortfolioOverview(params, { query: { queryKey: getGetPortfolioOverviewQueryKey(params) } });
  const selected = overview.data?.entries.find((entry) => entry.id === selectedId) ?? overview.data?.entries[0];
  const historyQuery = useGetPortfolioEntryHistory(selected?.id ?? '', {
    query: { queryKey: getGetPortfolioEntryHistoryQueryKey(selected?.id ?? ''), enabled: Boolean(selected?.id && identity?.role !== 'team_manager') },
  });
  const createCriterion = useCreatePortfolioCriterion();
  const createEntry = useCreatePortfolioEntry();
  const updateEntry = useUpdatePortfolioEntry();
  const submitEntry = useSubmitPortfolioEntry();
  const reviewEntry = useReviewPortfolioEntry();

  const entries = overview.data?.entries ?? [];
  const criteria = overview.data?.criteria ?? [];
  const activities = overview.data?.activities ?? [];
  const role = identity?.role ?? 'student';
  const isManager = role === 'team_manager';
  const isStudent = role === 'student';
  const canReview = overview.data?.canReview === true;
  const canManageCriteria = overview.data?.canManageCriteria === true;
  const campaignOptions = useMemo(() => {
    const all = [
      ...(simulation.data?.campaigns ?? []).map((item) => ({ id: item.id, title: item.title })),
      ...entries.map((item) => ({ id: item.campaignId, title: item.campaignTitle })),
      ...activities.map((item) => ({ id: item.campaignId, title: item.campaignTitle })),
    ];
    return [...new Map(all.map((item) => [item.id, item])).values()];
  }, [simulation.data?.campaigns, entries, activities]);
  const visibleViews = views.filter((item) => !isManager || ['team', 'reports'].includes(item.id));
  const reviewQueue = canReview ? entries.filter((entry) => entry.status === 'submitted') : [];
  const availableActivities = activities.filter((activity) => !entries.some((entry) => entry.eventId === activity.eventId));
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getGetPortfolioOverviewQueryKey(params) });
    void client.invalidateQueries({ queryKey: getGetFp360SimulationsOverviewQueryKey() });
  };
  const announceError = (error: unknown) => notify(errorText(error), true);
  const selectedActivity = activities.find((activity) => activity.eventId === formActivityId);

  const saveEntry = (values: EntryValues, criterionIds: string[]) => {
    if (!formActivityId || criterionIds.length === 0) return;
    const payload = { criterionIds, reflection: values.reflection.trim(), contribution: values.contribution.trim(), selfAssessment: values.selfAssessment.trim() };
    if (selectedId && entries.some((entry) => entry.id === selectedId && ['draft', 'returned'].includes(entry.status))) {
      updateEntry.mutate({ id: selectedId, data: payload }, {
        onSuccess: (updated) => { setSelectedId(updated.id); setFormActivityId(''); notify('Borrador actualizado.'); refresh(); },
        onError: announceError,
      });
    } else {
      createEntry.mutate({ data: { eventId: formActivityId, ...payload } }, {
        onSuccess: (created) => { setSelectedId(created.id); setFormActivityId(''); notify('Evidencia guardada como borrador.'); refresh(); },
        onError: announceError,
      });
    }
  };

  const createCriterionForm = useForm<CriterionValues>({ defaultValues: { code: '', title: '', description: '', isRequired: false } });
  const saveCriterion = createCriterionForm.handleSubmit((values) => {
    const campaign = campaignId ||
      simulation.data?.campaigns.find((item) => item.status !== 'closed')?.id ||
      activities[0]?.campaignId ||
      entries[0]?.campaignId;
    if (!campaign) { notify('No hay una campaña disponible para vincular el criterio.', true); return; }
    createCriterion.mutate({ data: { campaignId: campaign, code: values.code.trim() || undefined, title: values.title.trim(), description: values.description.trim(), isRequired: values.isRequired } }, {
      onSuccess: () => { setCriterionOpen(false); createCriterionForm.reset(); notify('Criterio añadido a la campaña.'); refresh(); },
      onError: announceError,
    });
  });
  const reviewForm = useForm<ReviewValues>({ defaultValues: { feedback: '' } });
  const doReview = (outcome: 'validated' | 'returned') => reviewForm.handleSubmit((values) => {
    if (!reviewEntryId) return;
    reviewEntry.mutate({ id: reviewEntryId, data: { outcome, feedback: values.feedback.trim() } }, {
      onSuccess: () => { setReviewEntryId(''); reviewForm.reset(); notify(outcome === 'validated' ? 'Evidencia validada. No constituye una calificación final.' : 'Evidencia devuelta con indicaciones.'); refresh(); },
      onError: announceError,
    });
  })();

  const beginNewEntry = (eventId: string) => {
    const existing = entries.find((item) => item.eventId === eventId);
    setSelectedId(existing?.id ?? '');
    setFormActivityId(eventId);
  };
  const sendForReview = (entry: PortfolioEntry) => submitEntry.mutate({ id: entry.id, data: { operationId: operationId() } }, {
    onSuccess: () => { notify('Evidencia enviada a revisión.'); refresh(); },
    onError: announceError,
  });
  const exportCsv = () => {
    const headings = ['Campaña', 'Actividad', 'Tipo de actividad', 'Fecha simulada', 'Documento', 'Estado', 'Criterios', 'Versión'];
    const rows = entries.map((entry) => [
      entry.campaignTitle,
      entry.activityTitle,
      eventTypeText[entry.eventType] ?? entry.eventType,
      entry.simulatedDate,
      entry.evidenceDocumentReference ?? '',
      statusText[entry.status] ?? entry.status,
      entry.criteria.map((criterion) => `${criterion.code ? `${criterion.code} · ` : ''}${criterion.title}`).join(' | '),
      entry.version,
    ]);
    if (role === 'teacher' || role === 'administrator') {
      headings.splice(1, 0, 'Estudiante');
      rows.forEach((row, index) => row.splice(1, 0, entries[index].studentName));
    }
    const csv = [headings, ...rows]
      .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';'))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `portafolio-redfp360-${campaignId || 'completo'}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const renderEntryDetail = (entry: PortfolioEntry) => {
    const privateAllowed = entry.canViewPrivateDetails && !isManager;
    return <section className="pf-detail" data-testid={`panel-entry-detail-${entry.id}`}>
      <div className="pf-detail-top"><div><span className="pf-overline">EVIDENCIA · {entry.version > 1 ? `VERSIÓN ${entry.version}` : 'REGISTRO'}</span><h2>{entry.activityTitle}</h2><p>{entry.campaignTitle} · {eventTypeText[entry.eventType] ?? entry.eventType} · {dateText(entry.simulatedDate)}</p></div><Status value={entry.status} /></div>
      <div className="pf-document-link"><span className="pf-document-icon"><FileText size={16} /></span><span><small>DOCUMENTO DE EVIDENCIA</small><b>{entry.evidenceDocumentReference || 'Documento vinculado a la actividad'}</b></span><CheckCircle2 size={16} /></div>
      {privateAllowed ? <div className="pf-reflection-grid">
        <article><small>REFLEXIÓN PERSONAL</small><p>{entry.reflection || 'Sin reflexión registrada.'}</p></article>
        <article><small>CONTRIBUCIÓN INDIVIDUAL</small><p>{entry.contribution || 'Sin contribución registrada.'}</p></article>
        {entry.selfAssessment && <article className="pf-self-assessment"><small>AUTOEVALUACIÓN</small><p>{entry.selfAssessment}</p></article>}
      </div> : <div className="pf-private-note"><LockKeyhole size={15} /> El detalle privado de esta evidencia no está disponible en esta vista.</div>}
      <div className="pf-detail-criteria"><div className="pf-subheading"><div><small>VINCULACIÓN</small><h3>Criterios asociados</h3></div><span>{entry.criteria.length} criterios</span></div>
        {entry.criteria.length ? <div className="pf-tag-list">{entry.criteria.map((criterion) => <span key={criterion.id}><Check size={12} />{criterion.code ? `${criterion.code} · ` : ''}{criterion.title}</span>)}</div> : <p className="pf-inline-hint">No se han asociado criterios.</p>}
      </div>
      {privateAllowed && entry.feedback && <div className="pf-feedback-card"><span><MessageSquareText size={15} /> Comentario docente</span><p>{entry.feedback}</p><small>{entry.reviewerName ? `${entry.reviewerName} · ` : ''}{dateText(entry.reviewedAt)}</small></div>}
      <div className="pf-entry-footer"><span><History size={14} /> Versión {entry.version} · actualizado {dateText(entry.updatedAt)}</span>
        <div>{historyQuery.data && <span className="pf-history-count">{historyQuery.data.revisions.length} revisiones · {historyQuery.data.reviews.length} respuestas</span>}
          {['draft', 'returned'].includes(entry.status) && isStudent && privateAllowed && <button className="pf-button quiet" onClick={() => beginNewEntry(entry.eventId)} data-testid={`button-edit-entry-${entry.id}`}>Editar</button>}
          {entry.status === 'draft' && isStudent && <button className="pf-button primary" onClick={() => sendForReview(entry)} disabled={submitEntry.isPending} data-testid={`button-submit-entry-${entry.id}`}><Send size={14} /> Enviar a revisión</button>}
        </div></div>
    </section>;
  };

  return <main className="portfolio-page page-enter" data-testid="portfolio-page">
    <header className="pf-hero">
      <div className="pf-hero-top"><span>RED FP360 <i>/</i> PORTAFOLIO PROFESIONAL</span><span className="pf-edu-pill"><ShieldCheck size={13} /> ENTORNO EDUCATIVO</span></div>
      <div className="pf-hero-body"><div><span className="pf-kicker">MÓDULO 22 · APRENDIZAJE Y TRAZABILIDAD</span><h1>Portafolio <em>profesional</em></h1>
        <p>Reúne evidencias propias de actividades completadas, reflexiona sobre tu práctica y deja constancia de cada revisión.</p></div>
        <div className="pf-hero-stamp"><small>REGISTRO FORMATIVO</small><strong>{overview.data ? String(entries.length).padStart(2, '0') : '—'}</strong><span>evidencias</span></div></div>
      <div className="pf-hero-foot"><span>Simulación educativa · Canarias</span><span>Validar una evidencia no equivale a emitir una calificación.</span></div>
    </header>

    <nav className="pf-nav" aria-label="Vistas del portafolio" role="tablist">
      {visibleViews.map(({ id, label, eyebrow, icon: Icon }) => <button type="button" key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => setView(id)} data-testid={`tab-portfolio-${id}`}><Icon size={15} /><span><small>{eyebrow}</small>{label}</span>
        {id === 'feedback' && reviewQueue.length > 0 && <b>{reviewQueue.length}</b>}</button>)}
      <label className="pf-campaign-filter"><Filter size={13} /><span className="sr-only">Filtrar campaña</span><select aria-label="Filtrar por campaña" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} data-testid="select-portfolio-campaign"><option value="">Todas las campañas</option>{campaignOptions.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}</select></label>
    </nav>

    {notice && <div className={`pf-notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'} data-testid="status-portfolio-notice">{notice.error ? <CircleAlert size={16} /> : <CheckCircle2 size={16} />}{notice.text}<button onClick={() => setNotice(null)} aria-label="Cerrar aviso" data-testid="button-dismiss-notice"><X size={14} /></button></div>}
    {(overview.isLoading || simulation.isLoading) && <section className="pf-panel"><Skeleton /></section>}
    {(overview.isError || simulation.isError) && <div className="pf-error" role="alert"><CircleAlert size={17} /><span>No se pudo cargar la información del portafolio o de las actividades.</span><button onClick={() => { void overview.refetch(); void simulation.refetch(); }} data-testid="button-retry-portfolio">Reintentar</button></div>}

    {!overview.isLoading && !overview.isError && <>
      <section className="pf-summary" aria-label="Resumen del portafolio">
        <article><span className="pf-summary-icon"><FileText size={17} /></span><small>Evidencias registradas</small><b>{entries.length}</b><span>En esta campaña</span></article>
        <article><span className="pf-summary-icon teal"><ClipboardCheck size={17} /></span><small>Criterios vinculados</small><b>{new Set(entries.flatMap((entry) => entry.criteria.map((criterion) => criterion.id))).size}</b><span>De {criteria.length} disponibles</span></article>
        <article><span className="pf-summary-icon amber"><FileClock size={17} /></span><small>Pendientes de revisión</small><b>{entries.filter((entry) => entry.status === 'submitted').length}</b><span>Sin calificación numérica</span></article>
        <article><span className="pf-summary-icon green"><BadgeCheck size={17} /></span><small>Evidencias validadas</small><b>{entries.filter((entry) => entry.status === 'validated').length}</b><span>Validación formativa</span></article>
      </section>

      {view === 'mine' && <div className="pf-workspace">
        <section className="pf-panel pf-list-panel"><header className="pf-section-head"><div><span className="pf-overline">MI TRAYECTORIA</span><h2>Mis evidencias</h2><p>Actividad propia, atribuida y completada en FP360 SIM.</p></div>
          {isStudent && <button className="pf-button primary" onClick={() => setView('activity')} data-testid="button-add-evidence"><Plus size={15} /> Añadir evidencia</button>}</header>
          {entries.length ? <div className="pf-entry-list">{entries.map((entry) => <EntryRow key={entry.id} entry={entry} active={selected?.id === entry.id} onSelect={() => setSelectedId(entry.id)} />)}</div> :
            <Empty title="Tu portafolio aún está vacío" detail="Cuando completes una actividad de simulación, podrás documentar tu contribución y reflexión." />}
          <div className="pf-list-foot"><span>{entries.length} evidencias registradas</span><span><LockKeyhole size={12} /> Acceso según permisos del centro</span></div>
        </section>
        <div className="pf-detail-column">{selected ? renderEntryDetail(selected) : <section className="pf-panel"><Empty title="Selecciona una evidencia" detail="El detalle, la trazabilidad y la retroalimentación aparecerán en este panel." /></section>}
          {!isManager && <section className="pf-history-panel"><div className="pf-subheading"><div><small>TRAZABILIDAD INMUTABLE</small><h3>Historial de versiones</h3></div><History size={16} /></div>
            {historyQuery.isLoading ? <div className="pf-mini-skeleton"><i /><i /></div> : historyQuery.isError ? <p className="pf-inline-hint">No se pudo cargar el historial. Selecciona de nuevo la evidencia para reintentar.</p> :
              <div className="pf-history-line">{(historyQuery.data?.revisions ?? []).slice(-3).reverse().map((revision) => <article key={`${revision.version}-${revision.createdAt}`}><i /><div><b>Versión {revision.version}</b><span>{revision.createdByName} · {dateText(revision.createdAt)}</span></div></article>)}
                {!historyQuery.data?.revisions.length && <p className="pf-inline-hint">El historial se mostrará tras guardar la primera versión.</p>}</div>}
          </section>}</div>
      </div>}

      {view === 'criteria' && <section className="pf-panel"><header className="pf-section-head"><div><span className="pf-overline">MAPA DE APRENDIZAJE</span><h2>Evidencias por criterio</h2><p>Consulta qué criterios están asociados a las evidencias registradas.</p></div>{canManageCriteria && <button className="pf-button primary" onClick={() => setCriterionOpen(true)} data-testid="button-add-criterion"><Plus size={15} /> Añadir criterio</button>}</header>
        {criteria.length ? <div className="pf-criterion-grid">{criteria.map((criterion) => {
          const criterionEntries = entries.filter((entry) => entry.criteria.some((item) => item.id === criterion.id));
          return <article key={criterion.id} className="pf-criterion" data-testid={`card-criterion-${criterion.id}`}><div><span className="pf-criterion-code">{criterion.code || 'CRITERIO'}</span>{criterion.isRequired && <span className="pf-required">Requerido</span>}</div><h3>{criterion.title}</h3><p>{criterion.description}</p>
            <footer><span>{criterionEntries.length} evidencias vinculadas</span><div className="pf-criterion-meter"><i style={{ transform: `scaleX(${Math.min(1, criterionEntries.length / Math.max(1, entries.length))})` }} /></div></footer></article>;
        })}</div> : <Empty title="Sin criterios configurados" detail="Los criterios de aprendizaje aparecerán aquí cuando se definan para una campaña." />}</section>}

      {view === 'activity' && <section className="pf-panel"><header className="pf-section-head"><div><span className="pf-overline">FP360 SIM · EVENTOS COMPLETADOS</span><h2>Actividades disponibles</h2><p>Solo aparecen actividades elegibles devueltas por el servicio de simulación.</p></div><span className="pf-count-chip">{availableActivities.length} disponibles</span></header>
        {availableActivities.length ? <div className="pf-activity-list">{availableActivities.map((activity, index) => <article key={activity.eventId} data-testid={`card-portfolio-activity-${activity.eventId}`}><span className="pf-activity-index">{String(index + 1).padStart(2, '0')}</span><div className="pf-activity-copy"><small>{activity.campaignTitle} · {eventTypeText[activity.eventType] ?? activity.eventType}</small><h3>{activity.title}</h3><p>Completada el {dateText(activity.completedAt ?? activity.simulatedDate)}{activity.evidenceDocumentReference ? ` · Documento ${activity.evidenceDocumentReference}` : ''}</p></div>
            {isStudent && <button className="pf-button quiet" onClick={() => beginNewEntry(activity.eventId)} data-testid={`button-document-activity-${activity.eventId}`}><Plus size={14} /> Documentar</button>}
          </article>)}</div> : <Empty title="No hay nuevas actividades elegibles" detail="Las actividades completadas y aún no documentadas se mostrarán aquí. No se crean evidencias sin un evento real." />}</section>}

      {view === 'team' && <section className="pf-panel"><header className="pf-section-head"><div><span className="pf-overline">APRENDIZAJE COOPERATIVO</span><h2>{isStudent ? 'Mi participación en el equipo' : 'Portafolio cooperativo'}</h2><p>Resumen de aportaciones y estado. Las reflexiones privadas y los comentarios docentes no se comparten.</p></div><span className="pf-privacy-chip"><LockKeyhole size={13} /> Vista protegida</span></header>
        {entries.length ? <div className="pf-team-table"><div className="pf-team-head"><span>Actividad</span><span>Participante</span><span>Aportación</span><span>Estado</span></div>{entries.map((entry) => <div className="pf-team-row" key={entry.id} data-testid={`row-team-entry-${entry.id}`}><div><b>{entry.activityTitle}</b><small>{entry.campaignTitle} · {dateText(entry.simulatedDate)}</small></div><span>{entry.studentName}</span><span className="pf-team-contribution">{entry.contribution || 'Pendiente'}</span><Status value={entry.status} /></div>)}</div> : <Empty title="Sin aportaciones compartidas" detail="Los resúmenes de actividad cooperativa aparecerán cuando se registren evidencias." />}
        <div className="pf-privacy-note"><ShieldCheck size={15} /> Esta vista muestra únicamente participante, actividad, aportación registrada y estado.</div></section>}

      {view === 'feedback' && <section className="pf-panel"><header className="pf-section-head"><div><span className="pf-overline">DOCENCIA · REVISIÓN FORMATIVA</span><h2>{canReview ? 'Cola de revisión' : 'Retroalimentación'}</h2><p>{canReview ? 'Revisa evidencias enviadas de tu organización y deja una respuesta escrita.' : 'Revisa las respuestas docentes asociadas a tus evidencias.'}</p></div><span className="pf-count-chip">{canReview ? reviewQueue.length : entries.filter((entry) => entry.feedback).length} {canReview ? 'por revisar' : 'comentarios'}</span></header>
        {canReview ? reviewQueue.length ? <div className="pf-review-list">{reviewQueue.map((entry) => <article key={entry.id} data-testid={`card-review-entry-${entry.id}`}><div className="pf-review-main"><small>{entry.studentName} · {entry.campaignTitle}</small><h3>{entry.activityTitle}</h3><p>{entry.canViewPrivateDetails ? entry.contribution : 'Detalle privado no disponible para este perfil.'}</p><span>{entry.criteria.length} criterios · versión {entry.version}</span></div>
          {entry.canViewPrivateDetails && <button className="pf-button quiet" onClick={() => { setReviewEntryId(entry.id); reviewForm.reset({ feedback: '' }); }} data-testid={`button-review-entry-${entry.id}`}>Revisar <ArrowRight size={14} /></button>}
        </article>)}</div> : <Empty title="Cola al día" detail="Las evidencias enviadas por estudiantes de tu organización aparecerán aquí." /> :
          entries.some((entry) => entry.feedback && entry.canViewPrivateDetails) ? <div className="pf-feedback-list">{entries.filter((entry) => entry.feedback && entry.canViewPrivateDetails).map((entry) => <article key={entry.id} data-testid={`feedback-entry-${entry.id}`}><span className="pf-feedback-mark"><MessageSquareText size={15} /></span><div><small>{entry.activityTitle} · {dateText(entry.reviewedAt)}</small><p>{entry.feedback}</p><b>{entry.reviewerName || 'Equipo docente'}</b></div><Status value={entry.status} /></article>)}</div> :
            <Empty title="Aún no hay comentarios" detail="La retroalimentación aparecerá cuando el equipo docente revise una evidencia enviada." />}
        <div className="pf-grading-note"><CheckCircle2 size={15} /> La validación confirma una evidencia de aprendizaje; no es una nota ni una calificación final.</div>
      </section>}

      {view === 'reports' && <section className="pf-panel"><header className="pf-section-head"><div><span className="pf-overline">RESUMEN Y TRAZABILIDAD</span><h2>Informes y exportación</h2><p>Consulta el estado del portafolio con datos devueltos por la API.</p></div>
        <div className="pf-report-actions"><button className="pf-button quiet" onClick={exportCsv} disabled={!entries.length} data-testid="button-export-portfolio-csv"><ArrowDownToLine size={14} /> Exportar CSV</button><button className="pf-button primary" onClick={() => window.print()} disabled={!entries.length} data-testid="button-print-portfolio-report"><FileText size={14} /> Imprimir / PDF</button></div>
      </header>
        <div className="pf-report-banner"><div><span className="pf-report-seal"><ShieldCheck size={18} /></span><div><b>Informe de evidencias</b><small>Organizado por campaña y estado · {dateText(new Date().toISOString())}</small></div></div><span className="pf-report-total">{entries.length.toString().padStart(2, '0')}<small>registros</small></span></div>
        <div className="pf-report-stats">{Object.entries(statusText).map(([status, label]) => <article key={status}><Status value={status} /><b>{entries.filter((entry) => entry.status === status).length}</b></article>)}</div>
        {entries.length ? <div className="pf-report-list">{entries.map((entry) => <div key={entry.id} data-testid={`report-entry-${entry.id}`}><span><FileText size={14} />{entry.activityTitle}</span><small>{entry.campaignTitle} · {dateText(entry.updatedAt)}</small><Status value={entry.status} /></div>)}</div> : <Empty title="No hay registros que incluir" detail="El informe se formará con evidencias persistidas, sin añadir registros ficticios." />}
        <div className="pf-export-note"><ArrowDownToLine size={15} /> El CSV se descarga con los datos autorizados para tu perfil. “Imprimir / PDF” abre el diálogo del navegador para guardar el informe.</div>
      </section>}
    </>}

    {formActivityId && selectedActivity && <EntryForm entry={entries.find((entry) => entry.eventId === formActivityId)} criteria={criteria.filter((criterion) => criterion.campaignId === selectedActivity.campaignId)} busy={createEntry.isPending || updateEntry.isPending} onClose={() => setFormActivityId('')} onSave={saveEntry} />}
    {criterionOpen && <div className="pf-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setCriterionOpen(false); }}><section className="pf-modal pf-small-modal" role="dialog" aria-modal="true" aria-labelledby="pf-criterion-title">
      <header><div><small>CONFIGURACIÓN DOCENTE</small><h2 id="pf-criterion-title">Añadir criterio</h2></div><button className="pf-icon-button" aria-label="Cerrar" onClick={() => setCriterionOpen(false)} data-testid="button-close-criterion"><X size={18} /></button></header>
      <Form {...createCriterionForm}><form className="pf-form" onSubmit={saveCriterion} data-testid="form-create-criterion">
        <label className="pf-field"><span>Código <small>Opcional</small></span><input {...createCriterionForm.register('code', { maxLength: 40 })} placeholder="Ej. CE 3.2" data-testid="input-criterion-code" /></label>
        <label className="pf-field"><span>Nombre del criterio</span><input {...createCriterionForm.register('title', { required: true, minLength: 3, maxLength: 120 })} placeholder="Describe el desempeño esperado" data-testid="input-criterion-title" /></label>
        <label className="pf-field"><span>Descripción</span><textarea {...createCriterionForm.register('description', { maxLength: 500 })} rows={3} placeholder="Ámbito de aprendizaje que se observará." data-testid="textarea-criterion-description" /></label>
        <label className="pf-check-row"><input type="checkbox" {...createCriterionForm.register('isRequired')} data-testid="checkbox-criterion-required" /><span><b>Criterio obligatorio</b><small>Se marcará como requerido en la campaña.</small></span></label>
        <div className="pf-form-foot"><span>Se guardará en la campaña seleccionada.</span><div><button type="button" className="pf-button quiet" onClick={() => setCriterionOpen(false)} data-testid="button-cancel-criterion">Cancelar</button><button className="pf-button primary" disabled={createCriterion.isPending} data-testid="button-save-criterion">{createCriterion.isPending ? 'Guardando…' : 'Guardar criterio'}</button></div></div>
      </form></Form>
    </section></div>}
    {reviewEntryId && <div className="pf-modal-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewEntryId(''); }}><section className="pf-modal pf-small-modal" role="dialog" aria-modal="true" aria-labelledby="pf-review-title">
      <header><div><small>RESPUESTA DOCENTE</small><h2 id="pf-review-title">{entries.find((entry) => entry.id === reviewEntryId)?.activityTitle ?? 'Revisar evidencia'}</h2></div><button className="pf-icon-button" aria-label="Cerrar" onClick={() => setReviewEntryId('')} data-testid="button-close-review"><X size={18} /></button></header>
      <p className="pf-modal-context">Escribe una respuesta clara y específica. La decisión afecta al estado de la evidencia, no a una nota final.</p>
      <Form {...reviewForm}><form className="pf-form" onSubmit={(event) => event.preventDefault()} data-testid="form-review-entry">
        <label className="pf-field"><span>Retroalimentación escrita</span><textarea {...reviewForm.register('feedback', { required: true, minLength: 10, maxLength: 1000 })} rows={5} placeholder="Indica qué está bien documentado y qué conviene revisar." data-testid="textarea-review-feedback" /></label>
        {reviewForm.formState.errors.feedback && <p className="pf-field-error">Escribe al menos 10 caracteres.</p>}
        <div className="pf-form-foot"><span>La revisión quedará registrada en el historial.</span><div><button className="pf-button quiet" type="button" onClick={() => doReview('returned')} disabled={reviewEntry.isPending} data-testid="button-return-evidence">Devolver</button><button className="pf-button primary" type="button" onClick={() => doReview('validated')} disabled={reviewEntry.isPending} data-testid="button-validate-evidence"><Check size={14} /> Validar evidencia</button></div></div>
      </form></Form>
    </section></div>}
  </main>;
}

export default PortfolioPage;

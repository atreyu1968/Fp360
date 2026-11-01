import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ArrowRightLeft, BadgeCheck, CalendarDays, Check, ChevronRight,
  ClipboardList, FileText, Flag, GitBranch, History, MapPinned, Plus, RefreshCw,
  ShieldCheck, Users, X,
} from 'lucide-react';
import {
  getGetCoordinationOverviewQueryKey, useActOnCoordinationCampaign,
  useActOnCoordinationEvent, useActOnCoordinationIncident,
  useActOnCoordinationParticipation, useActOnCoordinationTask,
  useCreateCoordinationCampaign, useCreateCoordinationEvent,
  useCreateCoordinationIncident, useCreateCoordinationTask,
  useCreateCoordinationTransfer, useGetCoordinationOverview,
  useUpdateCoordinationTransfer,
} from '@workspace/api-client-react';
import type { CoordinationOverview } from '@workspace/api-client-react';
import './coordination-page.css';

type Props = { identity: { role: string; organizationId?: string }; onNotice(message: string): void };
type View = 'network' | 'calendar' | 'campaigns' | 'tasks' | 'incidents' | 'transfer' | 'memory';
const views: { id: View; name: string; eyebrow: string; icon: typeof Activity }[] = [
  { id: 'network', name: 'Red de centros', eyebrow: 'ALCANCE', icon: MapPinned },
  { id: 'calendar', name: 'Calendario común', eyebrow: 'TIEMPO ACADÉMICO', icon: CalendarDays },
  { id: 'campaigns', name: 'Campañas', eyebrow: 'ACUERDOS', icon: GitBranch },
  { id: 'tasks', name: 'Tareas y acuerdos', eyebrow: 'EVIDENCIAS', icon: ClipboardList },
  { id: 'incidents', name: 'Incidencias', eyebrow: 'MEDIACIÓN', icon: Flag },
  { id: 'transfer', name: 'Transferencia', eyebrow: 'ADOPCIÓN', icon: ArrowRightLeft },
  { id: 'memory', name: 'Memoria e impacto', eyebrow: 'SEGUIMIENTO', icon: History },
];
const labels: Record<string, string> = {
  draft: 'Borrador', active: 'Activa', paused: 'En pausa', closed: 'Cerrada',
  pending_approval: 'Pendiente de aprobación', approved: 'Aprobada', rejected: 'Rechazada',
  withdrawn: 'Retirada', invited: 'Invitada', planned: 'Planificado', confirmed: 'Confirmado',
  completed: 'Completado', cancelled: 'Cancelado', open: 'Abierta', resolved: 'Resuelta',
  in_progress: 'En curso', blocked: 'Bloqueada', todo: 'Pendiente', interested: 'Interés',
  prepared: 'Preparada', training: 'En formación', adopted: 'Adoptada', declined: 'No adoptada',
  lead: 'Centro coordinador', participant: 'Participante activo', recipient: 'Centro destinatario',
  meeting: 'Reunión', deadline: 'Fecha límite', test: 'Prueba', local_break: 'Pausa local',
  mentoring: 'Mentoría', async_activity: 'Actividad asíncrona', in_person: 'Presencial',
  remote: 'A distancia', async: 'Asíncrona', low: 'Baja', medium: 'Media', high: 'Alta',
  supplier_block: 'Bloqueo de proveedor', absence: 'Ausencia', schedule_conflict: 'Conflicto de horario',
  permission_conflict: 'Conflicto de permisos', center_withdrawal: 'Retirada de centro', other: 'Otra',
  student: 'Estudiante', team_manager: 'Responsable de equipo', teacher: 'Docente',
};
const text = (value: string) => labels[value] ?? value.replaceAll('_', ' ');
const date = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const d = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(d);
};
const operationId = () => crypto.randomUUID();
const values = (event: FormEvent<HTMLFormElement>) => {
  const form = new FormData(event.currentTarget);
  return Object.fromEntries(Array.from(new Set(form.keys())).map((key) => [key, form.getAll(key).join(',')]));
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la acción. Revisa los permisos e inténtalo de nuevo.';

function Field({ label, name, type = 'text', required, area, options, hint, multiple, defaultValue, value, onChange }: {
  label: string; name: string; type?: string; required?: boolean; area?: boolean;
  options?: { value: string; label: string }[]; hint?: string; multiple?: boolean;
  defaultValue?: string; value?: string; onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  return <label className="co-field"><span>{label}{required ? ' · Obligatorio' : ''}</span>
    {options ? <select name={name} required={required} multiple={multiple} value={value} defaultValue={value === undefined ? defaultValue ?? (multiple ? [] : options[0]?.value) : undefined} onChange={onChange} aria-label={label} data-testid={`input-coordination-${name}`}>
      {!multiple && options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      {multiple && options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select> : area ? <textarea name={name} rows={3} required={required} aria-label={label} data-testid={`input-coordination-${name}`} /> :
      <input name={name} type={type} required={required} aria-label={label} data-testid={`input-coordination-${name}`} />}
    {hint && <small>{hint}</small>}
  </label>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="co-empty"><span><FileText size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Section({ eyebrow, title, detail, action, children }: { eyebrow: string; title: string; detail: string; action?: ReactNode; children: ReactNode }) {
  return <section className="co-panel"><header className="co-section-head"><div><span className="co-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{detail}</p></div>{action}</header>{children}</section>;
}
function Status({ value }: { value: string }) { return <span className={`co-status co-status-${value}`}>{text(value)}</span>; }

export default function CoordinationPage({ identity, onNotice }: Props) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('network');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [form, setForm] = useState<View | null>(null);
  const query = useGetCoordinationOverview(campaignFilter ? { campaignId: campaignFilter } : undefined, {
    query: { queryKey: getGetCoordinationOverviewQueryKey(campaignFilter ? { campaignId: campaignFilter } : undefined), refetchOnMount: 'always' },
  });
  const createCampaign = useCreateCoordinationCampaign();
  const actCampaign = useActOnCoordinationCampaign();
  const actParticipation = useActOnCoordinationParticipation();
  const createEvent = useCreateCoordinationEvent();
  const actEvent = useActOnCoordinationEvent();
  const createTask = useCreateCoordinationTask();
  const actTask = useActOnCoordinationTask();
  const createIncident = useCreateCoordinationIncident();
  const actIncident = useActOnCoordinationIncident();
  const createTransfer = useCreateCoordinationTransfer();
  const updateTransfer = useUpdateCoordinationTransfer();
  const data = query.data as CoordinationOverview | undefined;
  const caps = data?.capabilities;
  const currentCenterId = data?.currentCenterId ?? null;
  const centers = data?.centers ?? [];
  const campaigns = (data?.campaigns ?? []).filter((item) =>
    identity.role !== 'teacher' || item.ownerCenterId === currentCenterId);
  const campaign = campaigns.find((item) => item.id === campaignFilter) ?? campaigns[0];
  const campaignId = campaign?.id ?? '';
  const busy = [createCampaign, actCampaign, actParticipation, createEvent, actEvent, createTask, actTask, createIncident, actIncident, createTransfer, updateTransfer].some((mutation) => mutation.isPending);
  const notify = (message: string, error = false) => { onNotice(message); setFeedback({ message, error }); };
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const done = (message: string) => {
    setForm(null); notify(message);
    void queryClient.invalidateQueries({ queryKey: getGetCoordinationOverviewQueryKey() });
  };
  const failed = (error: unknown) => notify(errorMessage(error), true);
  const options = (message: string) => ({ onSuccess: () => done(message), onError: failed });
  const submit = (event: FormEvent<HTMLFormElement>, action: (v: Record<string, FormDataEntryValue>) => void) => {
    event.preventDefault();
    if (!busy) action(values(event));
  };
  const [formCampaignId, setFormCampaignId] = useState('');
  const showForm = (which: View) => {
    if (form !== which) setFormCampaignId(campaignId);
    setForm(form === which ? null : which);
  };
  const availableCenterOptions = (data?.availableCenters ?? []).map((center) => ({ value: center.id, label: `${center.name} · ${center.island}` }));
  const ownerCenterOptions = caps?.isGlobalCoordinator
    ? availableCenterOptions
    : availableCenterOptions.filter((center) => center.value === currentCenterId);
  const currentCampaignOptions = (selectedCampaignId: string, onlyRecipients = false) => {
    const selectedCampaign = campaigns.find((item) => item.id === selectedCampaignId);
    return (selectedCampaign?.participants ?? [])
      .filter((participant) => onlyRecipients
        ? participant.role === 'recipient'
        : ['lead', 'participant'].includes(participant.role) && participant.status === 'approved')
      .map((participant) => ({ value: participant.centerId, label: `${participant.centerName} · ${participant.island}` }));
  };
  const campaignOptions = campaigns.map((item) => ({ value: item.id, label: item.title }));
  const taskRecords = (data?.tasks ?? []).filter((task) =>
    !currentCenterId || caps?.isGlobalCoordinator || task.centerId === currentCenterId);
  const transferRecords = (data?.transfers ?? []).filter((item) =>
    !currentCenterId || caps?.isGlobalCoordinator || item.centerId === currentCenterId);
  const incidentRecords = (data?.incidents ?? []).filter((item) =>
    !currentCenterId || caps?.isGlobalCoordinator || item.centerId === currentCenterId);
  const visibleCampaignIds = new Set(campaigns.map((item) => item.id));
  const events = (data?.events ?? []).filter((event) =>
    (identity.role !== 'teacher' || visibleCampaignIds.has(event.campaignId)) &&
    (!currentCenterId || caps?.isGlobalCoordinator || event.centerIds.includes(currentCenterId)));

  const campaignForm = <form className="co-form" onSubmit={(e) => submit(e, (v) => createCampaign.mutate({ data: {
    operationId: operationId(), ownerCenterId: String(v.ownerCenterId), title: String(v.title).trim(), objective: String(v.objective).trim(),
    startDate: String(v.startDate), endDate: String(v.endDate), resourcePlan: String(v.resourcePlan).trim(),
    simulationCampaignId: v.simulationCampaignId ? String(v.simulationCampaignId) : null,
    centers: [
      ...(v.centers ? String(v.centers).split(',') : []).filter(Boolean).map((centerId) => ({ centerId, role: 'participant' as const })),
      ...(v.recipients ? String(v.recipients).split(',') : []).filter(Boolean).map((centerId) => ({ centerId, role: 'recipient' as const })),
    ],
  } }, options('Campaña compartida registrada.')))} data-testid="form-coordination-campaign">
    <h3>Preparar campaña intercentros</h3><div className="co-form-grid">
      <Field label="Centro responsable" name="ownerCenterId" required options={ownerCenterOptions} defaultValue={currentCenterId ?? undefined} />
      <Field label="Título de campaña" name="title" required />
      <Field label="Inicio académico" name="startDate" type="date" required /><Field label="Cierre académico" name="endDate" type="date" required />
      <Field label="Centros participantes" name="centers" options={availableCenterOptions} multiple hint="Centros que aportan activamente a la campaña." />
      <Field label="Centros destinatarios" name="recipients" options={availableCenterOptions} multiple hint="Reciben la práctica para valorar su adopción; no cuentan como participantes activos." />
      <Field label="Plan de recursos" name="resourcePlan" area required />
      <Field label="Objetivo común" name="objective" area required />
    </div><div className="co-form-foot"><span>Fechas académicas simuladas. No se programan operaciones reales.</span><button className="co-button primary" disabled={busy || !caps?.canCreateCampaign} data-testid="button-save-coordination-campaign"><Plus size={14} />{createCampaign.isPending ? 'Guardando…' : 'Crear campaña'}</button></div>
  </form>;
  const eventForm = <form className="co-form" onSubmit={(e) => submit(e, (v) => createEvent.mutate({ data: {
    operationId: operationId(), campaignId: String(v.campaignId), centerIds: v.centerIds ? String(v.centerIds).split(',').filter(Boolean) : [],
    title: String(v.title).trim(), eventType: String(v.eventType) as 'meeting', startDate: String(v.startDate),
    startTime: String(v.startTime), endTime: String(v.endTime), modality: String(v.modality) as 'in_person',
    summary: String(v.summary).trim(),
  } }, options('Hito añadido al calendario compartido.')))} data-testid="form-coordination-event">
    <h3>Incorporar hito académico</h3><div className="co-form-grid"><Field label="Campaña" name="campaignId" required options={campaignOptions} value={formCampaignId} onChange={(event) => setFormCampaignId(event.target.value)} /><Field label="Título" name="title" required />
      <Field label="Tipo de hito" name="eventType" options={['meeting','deadline','test','local_break','mentoring','async_activity'].map((x) => ({ value:x,label:text(x) }))} />
      <Field label="Modalidad" name="modality" options={['in_person','remote','async'].map((x) => ({value:x,label:text(x)}))} />
      <Field label="Fecha académica" name="startDate" type="date" required /><Field label="Hora de inicio" name="startTime" type="time" required />
      <Field label="Hora de fin" name="endTime" type="time" required /><Field label="Centros convocados" name="centerIds" options={currentCampaignOptions(formCampaignId)} multiple />
      <Field label="Resumen para equipos" name="summary" area required />
    </div><div className="co-form-foot"><span>Las horas describen el calendario didáctico, no la hora real de actividad.</span><button className="co-button primary" disabled={busy || !caps?.canSchedule} data-testid="button-save-coordination-event"><Plus size={14}/>{createEvent.isPending?'Guardando…':'Añadir hito'}</button></div>
  </form>;
  const taskForm = <form className="co-form" onSubmit={(e) => submit(e, (v) => createTask.mutate({ data: {
    operationId: operationId(), campaignId: String(v.campaignId), centerId: String(v.centerId), title: String(v.title).trim(),
    description: String(v.description).trim(), department: String(v.department).trim(),
    responsibleRole: String(v.responsibleRole) as 'student', dueDate: String(v.dueDate),
  } }, options('Tarea compartida creada.')))} data-testid="form-coordination-task">
    <h3>Asignar tarea o acuerdo</h3><div className="co-form-grid"><Field label="Campaña" name="campaignId" required options={campaignOptions} value={formCampaignId} onChange={(event) => setFormCampaignId(event.target.value)} /><Field label="Centro responsable" name="centerId" required options={currentCampaignOptions(formCampaignId)} />
      <Field label="Título" name="title" required /><Field label="Área o departamento" name="department" required />
      <Field label="Responsabilidad" name="responsibleRole" options={['student','team_manager','teacher'].map((x) => ({value:x,label:text(x)}))} />
      <Field label="Fecha académica límite" name="dueDate" type="date" required /><Field label="Acuerdo y alcance" name="description" area required />
    </div><div className="co-form-foot"><span>Las evidencias se vinculan mediante documentos elegibles del servicio.</span><button className="co-button primary" disabled={busy || !caps?.canManageTasks} data-testid="button-save-coordination-task"><Plus size={14}/>{createTask.isPending?'Guardando…':'Crear tarea'}</button></div>
  </form>;
  const incidentForm = <form className="co-form" onSubmit={(e) => submit(e, (v) => createIncident.mutate({ data: {
    operationId: operationId(), campaignId: String(v.campaignId), centerId: String(v.centerId), incidentType: String(v.incidentType) as 'other',
    severity: String(v.severity) as 'medium', summary: String(v.summary).trim(),
  } }, options('Incidencia registrada para mediación.')))} data-testid="form-coordination-incident">
    <h3>Registrar incidencia de coordinación</h3><div className="co-form-grid"><Field label="Campaña" name="campaignId" required options={campaignOptions} value={formCampaignId} onChange={(event) => setFormCampaignId(event.target.value)} /><Field label="Centro que informa" name="centerId" required options={currentCampaignOptions(formCampaignId)} />
      <Field label="Tipo" name="incidentType" options={['supplier_block','absence','schedule_conflict','permission_conflict','center_withdrawal','other'].map((x) => ({value:x,label:text(x)}))} />
      <Field label="Nivel de atención" name="severity" options={['low','medium','high'].map((x) => ({value:x,label:text(x)}))} />
      <Field label="Resumen sin datos personales" name="summary" area required />
    </div><div className="co-form-foot"><span>No incluyas nombres, contactos ni expedientes de alumnado.</span><button className="co-button primary" disabled={busy || !caps?.canReportIncident} data-testid="button-save-coordination-incident"><Flag size={14}/>{createIncident.isPending?'Guardando…':'Registrar incidencia'}</button></div>
  </form>;
  const transferForm = <form className="co-form" onSubmit={(e) => submit(e, (v) => createTransfer.mutate({ data: {
    operationId: operationId(), campaignId: String(v.campaignId), centerId: String(v.centerId), adoptionSummary: String(v.adoptionSummary).trim(),
  } }, options('Interés de transferencia registrado.')))} data-testid="form-coordination-transfer">
    <h3>Registrar interés de adopción</h3><div className="co-form-grid"><Field label="Campaña" name="campaignId" required options={campaignOptions} value={formCampaignId} onChange={(event) => setFormCampaignId(event.target.value)} /><Field label="Centro destinatario" name="centerId" required options={currentCampaignOptions(formCampaignId, true)} />
      <Field label="Aprendizaje transferible" name="adoptionSummary" area required />
    </div><div className="co-form-foot"><span>Un destinatario no se contabiliza como participante activo.</span><button className="co-button primary" disabled={busy || !caps?.canManageTransfer} data-testid="button-save-coordination-transfer"><Plus size={14}/>{createTransfer.isPending?'Guardando…':'Registrar transferencia'}</button></div>
  </form>;

  const actionTask = (taskId: string, action: 'start'|'block'|'complete'|'cancel'|'reassign'|'comment', targetCenterId: string|null = null, documentId: string|null = null) => {
    const note = window.prompt('Añade una nota breve para dejar constancia:');
    if (note === null) return;
    let selectedDocumentId = documentId;
    if (action === 'complete' && (data?.documents.length ?? 0) > 0) {
      const documentList = data?.documents ?? [];
      const choice = window.prompt(`Referencia documental elegible (opcional). Escribe el número:\n${documentList.map((doc,index)=>`${index+1}. ${doc.reference} · ${doc.title}`).join('\n')}\nDeja en blanco si no vinculas documento.`);
      if (choice === null) return;
      const chosen = Number(choice);
      selectedDocumentId = Number.isInteger(chosen) && chosen > 0 && chosen <= documentList.length ? documentList[chosen-1].id : null;
    }
    actTask.mutate({ id: taskId, data: { operationId: operationId(), action, note: note.trim() || `Acción: ${text(action)}.`, evidenceSummary: action === 'complete' || action === 'comment' ? note.trim() : null, documentId: selectedDocumentId, targetCenterId } }, options(`Tarea actualizada: ${text(action).toLocaleLowerCase('es')}.`));
  };
  const actionIncident = (id: string, action: 'escalate'|'mediate'|'resolve'|'reassign', targetCenterId: string|null = null) => {
    const note = window.prompt('Nota de coordinación para el registro:');
    if (note === null) return;
    actIncident.mutate({ id, data: { operationId: operationId(), action, note: note.trim() || `Acción de coordinación: ${text(action)}.`, targetCenterId } }, options(`Incidencia actualizada: ${text(action).toLocaleLowerCase('es')}.`));
  };
  const actionCampaign = (id: string, action: 'activate'|'pause'|'close') => {
    const reason = window.prompt(`Motivo para ${text(action).toLocaleLowerCase('es')}:`);
    if (reason === null) return;
    actCampaign.mutate({ id, data: { operationId: operationId(), action, reason: reason.trim() || `Cambio de estado: ${text(action)}.` } }, options(`Campaña ${text(action).toLocaleLowerCase('es')}.`));
  };
  const actionEvent = (eventId: string, action: 'confirm'|'reschedule'|'complete'|'cancel') => {
    const reason = window.prompt(`Motivo para ${text(action).toLocaleLowerCase('es')} este hito:`);
    if (reason === null) return;
    const startDate = action === 'reschedule' ? window.prompt('Nueva fecha académica (AAAA-MM-DD):') : null;
    if (action === 'reschedule' && startDate === null) return;
    const startTime = action === 'reschedule' ? window.prompt('Nueva hora de inicio (HH:MM):') : null;
    if (action === 'reschedule' && startTime === null) return;
    const endTime = action === 'reschedule' ? window.prompt('Nueva hora de fin (HH:MM):') : null;
    if (action === 'reschedule' && endTime === null) return;
    actEvent.mutate({ id: eventId, data: { operationId: operationId(), action, reason: reason.trim() || `Hito: ${text(action)}.`, startDate, startTime, endTime } }, options(`Hito actualizado: ${text(action).toLocaleLowerCase('es')}.`));
  };
  const selectCenter = (promptLabel: string, selectedCampaignId: string) => {
    const available = currentCampaignOptions(selectedCampaignId);
    const chosen = window.prompt(`${promptLabel}\n${available.map((center,index)=>`${index+1}. ${center.label}`).join('\n')}\nEscribe el número de centro.`);
    if (chosen === null) return null;
    const index = Number(chosen) - 1;
    return Number.isInteger(index) && index >= 0 && index < available.length ? available[index].value : null;
  };

  return <main className="co-page" data-testid="coordination-page">
    <header className="co-hero">
      <div className="co-hero-top"><span>RED FP360 <i>/</i> COORDINACIÓN DE CENTROS</span><span className="co-sim-pill"><ShieldCheck size={14}/> ENTORNO FORMATIVO · SIN OPERACIONES REALES</span></div>
      <div className="co-hero-body"><div><span className="co-kicker">MÓDULO 25 · CANARIAS</span><h1>Coordinación <em>intercentros</em></h1>
        <p>Un espacio común para acordar simulaciones, cuidar los tiempos académicos y saber siempre qué centro sostiene cada compromiso.</p></div>
        <div className="co-stamp"><small>RED EDUCATIVA</small><strong>25</strong><span>FP360 · CANARIAS</span></div></div>
      <div className="co-hero-foot"><span>Coordinación con responsables visibles</span><span>El calendario es didáctico. Nunca representa tiempo u operaciones reales.</span></div>
    </header>
    <div className="co-privacy"><ShieldCheck size={16}/><span><b>Privacidad y alcance.</b> Datos agregados por centro, sin contacto externo ni expedientes personales. Destinatarios y participantes activos se contabilizan por separado.</span></div>
    <nav className="co-toolbar" aria-label="Áreas de coordinación"><div className="co-tabs" role="tablist" aria-label="Áreas del módulo">
      {views.map(({id,name,eyebrow,icon:Icon}) => <button key={id} id={`tab-coordination-${id}`} type="button" role="tab" aria-selected={view===id} aria-controls={`coordination-panel-${id}`} className={view===id?'selected':''} onClick={() => {setView(id);setForm(null);}} data-testid={`tab-coordination-${id}`}><Icon size={15}/><span><small>{eyebrow}</small>{name}</span></button>)}
    </div><label className="co-filter"><span className="sr-only">Filtrar campaña</span><select aria-label="Filtrar por campaña" value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} data-testid="input-coordination-campaign-filter"><option value="">Todas las campañas</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label></nav>
    {feedback && <div className={`co-feedback ${feedback.error?'error':''}`} role={feedback.error?'alert':'status'}><span>{feedback.error?<AlertCircle size={16}/>:<Check size={16}/>}</span>{feedback.message}<button type="button" aria-label="Cerrar aviso" onClick={() => setFeedback(null)} data-testid="button-dismiss-coordination-notice"><X size={14}/></button></div>}
    {query.isLoading && <section className="co-panel"><div className="co-skeleton" aria-label="Cargando coordinación"><i/><i/><i/><i/></div></section>}
    {query.isError && <div className="co-error" role="alert"><AlertCircle size={18}/><span>No se pudo cargar el espacio de coordinación.</span><button type="button" onClick={() => void query.refetch()} data-testid="button-retry-coordination"><RefreshCw size={14}/> Reintentar</button></div>}
    {!query.isLoading && !query.isError && data && <>
      <section className="co-metrics" aria-label="Seguimiento agregado">
        {[
          ['Centros activos',data.impact.centersActive,'red'],
          ['Destinatarios',data.impact.recipients,'sand'],
          ['Hitos planificados',data.impact.eventsPlanned,'blue'],
          ['Tareas abiertas',data.impact.tasksOpen,'amber'],
          ['Incidencias abiertas',data.impact.incidentsOpen,'rose'],
        ].map(([label,value,color]) => <article className={`co-metric ${color}`} key={String(label)}><small>{label}</small><b>{value}</b><span>Alcance del servicio</span></article>)}
      </section>
      {identity.role === 'student' && <div className="co-scope"><ShieldCheck size={14}/>Vista de centro: se muestran únicamente los registros autorizados para tu centro.</div>}
      <div id={`coordination-panel-${view}`} role="tabpanel" aria-labelledby={`tab-coordination-${view}`}>
        {view === 'network' && <Section eyebrow="ALCANCE DE LA RED" title="Centros que coordinan" detail="El mapa de trabajo muestra únicamente centros y participación agregada que el servicio autoriza.">
          {centers.length ? <div className="co-center-grid">{centers.map((center,index) => <article className="co-center" key={center.id} data-testid={`card-coordination-center-${center.id}`}><span className="co-center-index">{String(index+1).padStart(2,'0')}</span><div><small>{center.island}</small><h3>{center.name}</h3><p>{center.companyCount} entidades simuladas vinculadas</p></div><ChevronRight size={17}/></article>)}</div> : <Empty title="No hay centros en este alcance" detail="Los centros habilitados por el servicio aparecerán aquí."/>}
          <div className="co-role-note"><Users size={17}/><p><b>Responsabilidad distribuida</b><br/>Cada campaña conserva su centro responsable, los centros participantes y los destinatarios por separado.</p></div>
        </Section>}
        {view === 'calendar' && <Section eyebrow="TIEMPO ACADÉMICO" title="Calendario compartido" detail="Hitos didácticos y convocatorias entre centros; la fecha no activa sucesos reales." action={caps?.canSchedule && <button className="co-button primary" onClick={() => showForm('calendar')} data-testid="button-open-coordination-event-form"><Plus size={14}/>Añadir hito</button>}>
          {form==='calendar' && eventForm}
          {events.length ? <div className="co-record-list">{events.map((event) => <article className="co-record" key={event.id} data-testid={`card-coordination-event-${event.id}`}><div className="co-date-block"><b>{date(event.startDate).split(' ')[0]}</b><small>{date(event.startDate).split(' ').slice(1).join(' ')}</small></div><div className="co-record-main"><span className="co-overline">{text(event.eventType)} · {event.startTime}–{event.endTime}</span><h3>{event.title}</h3><p>{event.summary}</p><div className="co-meta"><span>{text(event.modality)}</span><span>{event.centerIds.length} centros convocados</span></div></div><div className="co-record-side"><Status value={event.status}/>{caps?.canSchedule && <div className="co-actions">{event.status==='proposed' && <button className="co-button small" disabled={busy} onClick={() => actionEvent(event.id,'confirm')} data-testid={`button-confirm-coordination-event-${event.id}`}>Confirmar</button>}{['proposed','confirmed','rescheduled'].includes(event.status) && <><button className="co-button small quiet" disabled={busy} onClick={() => actionEvent(event.id,'reschedule')} data-testid={`button-reschedule-coordination-event-${event.id}`}>Reprogramar</button><button className="co-button small" disabled={busy} onClick={() => actionEvent(event.id,'complete')} data-testid={`button-complete-coordination-event-${event.id}`}>Completar</button><button className="co-button small warn" disabled={busy} onClick={() => actionEvent(event.id,'cancel')} data-testid={`button-cancel-coordination-event-${event.id}`}>Cancelar</button></>}</div>}</div></article>)}</div> : <Empty title="Calendario sin hitos" detail="Añade una reunión, fecha límite o actividad asíncrona para hacer visible el tiempo académico compartido."/>}
        </Section>}
        {view === 'campaigns' && <Section eyebrow="CAMPAÑAS Y APROBACIÓN" title="Acuerdos entre centros" detail="Consulta responsables y decisiones de participación sin perder el estado de cada invitación." action={caps?.canCreateCampaign && <button className="co-button primary" onClick={() => showForm('campaigns')} data-testid="button-open-coordination-campaign-form"><Plus size={14}/>Nueva campaña</button>}>
          {form==='campaigns' && campaignForm}
          {campaigns.length ? <div className="co-campaign-list">{campaigns.map((item) => {
            const canManageCampaign = Boolean(caps?.isGlobalCoordinator || item.ownerCenterId === currentCenterId);
            const canReviewParticipant = (participantCenterId: string) => Boolean(caps?.isGlobalCoordinator || participantCenterId === currentCenterId);
            return <article className="co-campaign-card" key={item.id} data-testid={`card-coordination-campaign-${item.id}`}><header><div><span className="co-overline">{item.ownerIsland} · RESPONSABLE: {item.ownerCenterName}</span><h3>{item.title}</h3></div><Status value={item.status}/></header><p>{item.objective}</p><div className="co-campaign-dates"><span><small>INICIO ACADÉMICO</small>{date(item.startDate)}</span><span><small>CIERRE ACADÉMICO</small>{date(item.endDate)}</span></div><div className="co-participant-list">{item.participants.map((participant) => <div key={participant.centerId} className="co-participant"><span className="co-participant-mark">{participant.role==='lead'?'R':participant.role==='recipient'?'D':'P'}</span><div><b>{participant.centerName}</b><small>{text(participant.role)} · {participant.island}{participant.decisionNote ? ` · ${participant.decisionNote}` : ''}</small></div><Status value={participant.status}/><div className="co-actions">{caps?.canApproveCenter && canReviewParticipant(participant.centerId) && participant.status==='pending_approval' && <><button className="co-button small" disabled={busy} onClick={() => actParticipation.mutate({id:item.id,centerId:participant.centerId,data:{operationId:operationId(),action:'approve',note:'Participación aprobada por coordinación.'}},options('Participación aprobada.'))} data-testid={`button-approve-coordination-participant-${participant.centerId}`}><Check size={12}/> Aprobar</button><button className="co-button small warn" disabled={busy} onClick={() => { const note=window.prompt('Motivo de la decisión:'); if(note!==null) actParticipation.mutate({id:item.id,centerId:participant.centerId,data:{operationId:operationId(),action:'reject',note:note.trim()}},options('Decisión de participación registrada.')); }} data-testid={`button-reject-coordination-participant-${participant.centerId}`}>Rechazar</button></>}</div></div>)}</div><footer className="co-card-footer"><span>{date(item.startDate)} — {date(item.endDate)} · tiempo académico</span><div className="co-actions">{caps?.canCreateCampaign && canManageCampaign && item.status==='pending_approval' && <button className="co-button small" disabled={busy} onClick={() => actionCampaign(item.id,'activate')} data-testid={`button-activate-coordination-campaign-${item.id}`}>Activar</button>}{caps?.canCreateCampaign && canManageCampaign && item.status==='active' && <><button className="co-button small" disabled={busy} onClick={() => actionCampaign(item.id,'pause')} data-testid={`button-pause-coordination-campaign-${item.id}`}>Pausar</button><button className="co-button small warn" disabled={busy} onClick={() => actionCampaign(item.id,'close')} data-testid={`button-close-coordination-campaign-${item.id}`}>Cerrar</button></>}{caps?.canCreateCampaign && canManageCampaign && item.status==='paused' && <button className="co-button small" disabled={busy} onClick={() => actionCampaign(item.id,'activate')} data-testid={`button-resume-coordination-campaign-${item.id}`}>Reanudar</button>}</div></footer></article>;
          })}</div> : <Empty title="Sin campañas compartidas" detail="Crea una propuesta cuando exista un propósito común y centros responsables identificados."/>}
        </Section>}
        {view === 'tasks' && <Section eyebrow="ACUERDOS Y EVIDENCIAS" title="Tareas con responsable" detail="Sigue acuerdos por centro y registra su avance con notas y referencias documentales elegibles." action={caps?.canManageTasks && <button className="co-button primary" onClick={() => showForm('tasks')} data-testid="button-open-coordination-task-form"><Plus size={14}/>Asignar tarea</button>}>
          {form==='tasks' && taskForm}
          {taskRecords.length ? <div className="co-record-list">{taskRecords.map((task) => <article className="co-record co-task" key={task.id} data-testid={`card-coordination-task-${task.id}`}><div className="co-record-main"><span className="co-overline">{task.centerName} · {task.department} · Responsable: {text(task.responsibleRole)}</span><h3>{task.title}</h3><p>{task.description}</p><div className="co-meta"><span>Vence {date(task.dueDate)}</span><span>{task.evidenceSummary || 'Sin evidencia registrada'}</span>{task.documentReference && <span>Documento {task.documentReference}</span>}</div></div><div className="co-record-side"><Status value={task.status}/>{caps?.canUpdateTasks && <div className="co-actions">{['open','blocked'].includes(task.status) && <button className="co-button small" disabled={busy} onClick={() => actionTask(task.id,'start')} data-testid={`button-start-coordination-task-${task.id}`}>Iniciar</button>}{task.status==='in_progress' && <><button className="co-button small" disabled={busy} onClick={() => actionTask(task.id,'complete')} data-testid={`button-complete-coordination-task-${task.id}`}>Completar</button><button className="co-button small warn" disabled={busy} onClick={() => actionTask(task.id,'block')} data-testid={`button-block-coordination-task-${task.id}`}>Bloquear</button></>}{!['completed','cancelled'].includes(task.status) && <><button className="co-button small quiet" disabled={busy} onClick={() => actionTask(task.id,'comment')} data-testid={`button-comment-coordination-task-${task.id}`}>Añadir nota</button><button className="co-button small warn" disabled={busy} onClick={() => actionTask(task.id,'cancel')} data-testid={`button-cancel-coordination-task-${task.id}`}>Cancelar</button></>}{caps?.isGlobalCoordinator && !['completed','cancelled'].includes(task.status) && <button className="co-button small quiet" disabled={busy} onClick={() => {const targetCenterId=selectCenter('Centro de destino para reasignar la tarea:',task.campaignId); if(targetCenterId) actionTask(task.id,'reassign',targetCenterId);}} data-testid={`button-reassign-coordination-task-${task.id}`}>Reasignar</button>}</div>}</div></article>)}</div> : <Empty title="No hay tareas asignadas" detail="Los acuerdos autorizados se mostrarán aquí con un centro y una responsabilidad claramente identificados."/>}
        </Section>}
        {view === 'incidents' && <Section eyebrow="MEDIACIÓN Y CONTINUIDAD" title="Incidencias de coordinación" detail="Registra bloqueos de agenda y acuerda mediación o reasignación sin exponer información personal." action={caps?.canReportIncident && <button className="co-button primary" onClick={() => showForm('incidents')} data-testid="button-open-coordination-incident-form"><Plus size={14}/>Informar incidencia</button>}>
          {form==='incidents' && incidentForm}
          {incidentRecords.length ? <div className="co-record-list">{incidentRecords.map((incident) => <article className="co-record" key={incident.id} data-testid={`card-coordination-incident-${incident.id}`}><div className={`co-severity ${incident.severity}`}/><div className="co-record-main"><span className="co-overline">{incident.centerName} · {text(incident.incidentType)} · Atención {text(incident.severity)}</span><h3>{incident.summary}</h3><p>{incident.resolution || 'Pendiente de resolución documentada.'}</p><div className="co-meta"><span>Responsable de seguimiento: {incident.assignedCenterName || 'Sin asignar'}</span></div></div><div className="co-record-side"><Status value={incident.status}/>{caps?.canMediate && !['resolved','closed'].includes(incident.status) && <div className="co-actions"><button className="co-button small" disabled={busy} onClick={() => actionIncident(incident.id,'mediate')} data-testid={`button-mediate-coordination-incident-${incident.id}`}>Mediar</button><button className="co-button small" disabled={busy} onClick={() => actionIncident(incident.id,'resolve')} data-testid={`button-resolve-coordination-incident-${incident.id}`}>Resolver</button>{caps?.isGlobalCoordinator && <button className="co-button small quiet" disabled={busy} onClick={() => {const targetCenterId=selectCenter('Centro responsable de seguimiento:',incident.campaignId);if(targetCenterId)actionIncident(incident.id,'reassign',targetCenterId);}} data-testid={`button-reassign-coordination-incident-${incident.id}`}>Reasignar</button>}</div>}</div></article>)}</div> : <Empty title="Sin incidencias abiertas" detail="Cuando un equipo informe un bloqueo aparecerá aquí, con su centro y estado de mediación."/>}
        </Section>}
        {view === 'transfer' && <Section eyebrow="DIFUSIÓN Y ADOPCIÓN" title="Transferencia entre centros" detail="Una invitación a conocer una práctica no equivale a participar en su campaña." action={caps?.canManageTransfer && <button className="co-button primary" onClick={() => showForm('transfer')} data-testid="button-open-coordination-transfer-form"><Plus size={14}/>Registrar destinatario</button>}>
          {form==='transfer' && transferForm}
          <div className="co-transfer-legend"><span><i className="active-dot"/> Participación activa: aporta a la campaña</span><span><i className="recipient-dot"/> Destinatario: recibe una práctica transferible</span></div>
          {transferRecords.length ? <div className="co-record-list">{transferRecords.map((item) => <article className="co-record" key={item.id} data-testid={`card-coordination-transfer-${item.id}`}><div className="co-transfer-mark"><ArrowRightLeft size={17}/></div><div className="co-record-main"><span className="co-overline">{item.centerName} · CENTRO DESTINATARIO</span><h3>{campaigns.find((c)=>c.id===item.campaignId)?.title || 'Campaña intercentros'}</h3><p>{item.adoptionSummary || 'Sin resumen de adopción todavía.'}</p></div><div className="co-record-side"><Status value={item.status}/>{caps?.canManageTransfer && <label className="co-inline-field"><span className="sr-only">Estado de adopción</span><select aria-label={`Estado de adopción para ${item.centerName}`} defaultValue={item.status} onChange={(e) => updateTransfer.mutate({id:item.id,data:{operationId:operationId(),status:e.target.value as 'interested',adoptionSummary:item.adoptionSummary}},options('Estado de transferencia actualizado.'))} data-testid={`input-coordination-transfer-status-${item.id}`}>{['interested','prepared','training','adopted','declined'].map((x)=><option value={x} key={x}>{text(x)}</option>)}</select></label>}</div></article>)}</div> : <Empty title="Sin transferencias registradas" detail="Registra centros destinatarios y conserva el estado de adopción separado de la participación activa."/>}
        </Section>}
        {view === 'memory' && <div className="co-memory-grid"><Section eyebrow="SEGUIMIENTO AGREGADO" title="Memoria de la red" detail="Cifras agregadas disponibles para el alcance autorizado.">
          <div className="co-impact-grid">{[
            ['Centros activos',data.impact.centersActive],['Centros destinatarios',data.impact.recipients],
            ['Hitos planificados',data.impact.eventsPlanned],['Tareas abiertas',data.impact.tasksOpen],
            ['Tareas completadas',data.impact.tasksCompleted],['Incidencias abiertas',data.impact.incidentsOpen],
            ['Incidencias resueltas',data.impact.incidentsResolved],['Prácticas adoptadas',data.impact.adoptions],
            ['Sesiones de mentoría',data.impact.mentorshipSessions],
          ].map(([label,value]) => <article key={String(label)}><small>{label}</small><b>{value}</b></article>)}</div>
          <p className="co-memory-note">El seguimiento no identifica estudiantes. Los destinatarios se informan aparte de los centros que participan activamente.</p>
        </Section><Section eyebrow="TRAZABILIDAD" title="Actividad reciente" detail="Registro de decisiones y cambios autorizados por el servicio.">
          {caps?.canViewAudit ? data.audit.length ? <div className="co-audit">{data.audit.map((entry) => <article key={entry.id} data-testid={`row-coordination-audit-${entry.id}`}><span><History size={15}/></span><div><small>{date(entry.createdAt)} · {entry.centerName || 'Coordinación de red'} · {entry.actorLabel}</small><b>{entry.summary}</b><p>{text(entry.action)} · {text(entry.resourceType)}</p></div></article>)}</div> : <Empty title="Sin actividad registrada" detail="El historial aparecerá aquí cuando se registren decisiones o cambios."/> : <Empty title="Historial no disponible" detail="El servicio no ha habilitado la consulta de trazabilidad para este perfil."/>}
        </Section></div>}
      </div>
    </>}
    <footer className="co-foot"><span><BadgeCheck size={14}/> Coordinación educativa simulada</span><span>Sin mensajes a personas externas · Sin operaciones reales</span></footer>
  </main>;
}

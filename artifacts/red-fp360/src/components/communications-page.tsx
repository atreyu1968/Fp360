import { type FormEvent, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive, Bell, BookOpen, Building2, CalendarClock, Check, CheckCheck, ChevronRight,
  CircleAlert, ClipboardList, FileText, Inbox, LockKeyhole, Mail, MessageSquare,
  Plus, Search, Send, ShieldAlert, Sparkles, Users, X,
} from 'lucide-react';
import {
  getGetFp360CommunicationsOverviewQueryKey, useCompleteFp360CommunicationsTask,
  useCreateFp360CommunicationsTask, useCreateFp360CommunicationsThread,
  useGetFp360DocumentsOverview,
  useGetFp360CommunicationsOverview, useReplyFp360CommunicationsThread,
  useSendFp360CommunicationsThread, useUpdateFp360CommunicationsThreadState,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360CommunicationsThread, Fp360Organization,
} from '@workspace/api-client-react';
import './communications-page.css';

type Props = {
  identity: AuthIdentity;
  organizationId: string | null;
  organizations: Fp360Organization[];
  onNotice: (message: string) => void;
};
type View = 'inbox' | 'compose' | 'departments' | 'commercial' | 'notifications' | 'templates' | 'registry';
const DEFAULT_SIMULATED_DATE = '2027-09-15';
const views: Array<{ id: View; label: string; icon: typeof Inbox }> = [
  { id: 'inbox', label: 'Bandeja de entrada', icon: Inbox },
  { id: 'compose', label: 'Redactar mensaje', icon: Plus },
  { id: 'departments', label: 'Buzones departamentales', icon: Building2 },
  { id: 'commercial', label: 'Conversaciones comerciales', icon: MessageSquare },
  { id: 'notifications', label: 'Avisos y notificaciones', icon: Bell },
  { id: 'templates', label: 'Plantillas y automatización', icon: BookOpen },
  { id: 'registry', label: 'Registro y búsqueda', icon: Search },
];
const departments = [
  ['management', 'Dirección'], ['sales', 'Ventas'], ['purchasing', 'Compras'],
  ['warehouse', 'Almacén'], ['customer_service', 'Atención al cliente'], ['suppliers', 'Proveedores'],
  ['treasury', 'Tesorería'], ['accounting', 'Contabilidad'], ['hr', 'Recursos humanos'],
  ['tax', 'Fiscalidad'], ['education', 'Coordinación educativa'], ['logistics', 'Logística'],
] as const;
const departmentName = (value?: string | null) => departments.find(([key]) => key === value)?.[1] ?? value ?? 'General';
const dateLabel = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: value.includes('T') ? 'short' : undefined }).format(date);
};
const operationId = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sim-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const isReviewer = (role: AuthIdentity['role']) => ['teacher', 'administrator', 'team_manager'].includes(role);
const priorityName: Record<string, string> = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };

export function CommunicationsPage({ identity, organizationId, organizations, onNotice }: Props) {
  const client = useQueryClient();
  const [fallbackOrg, setFallbackOrg] = useState('');
  const activeOrg = organizationId || fallbackOrg;
  const canAssign = isReviewer(identity.role);
  const [view, setView] = useState<View>('inbox');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'drafts' | 'archived'>('all');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyAttachmentIds, setReplyAttachmentIds] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [assignedOrg, setAssignedOrg] = useState('');
  const [assignedDepartment, setAssignedDepartment] = useState('purchasing');
  const queryKey = getGetFp360CommunicationsOverviewQueryKey({ organizationId: activeOrg, search: search.trim() || undefined });
  const query = useGetFp360CommunicationsOverview(
    { organizationId: activeOrg, search: search.trim() || undefined },
    { query: { enabled: Boolean(activeOrg), queryKey, refetchOnWindowFocus: true } },
  );
  const documentsQuery = useGetFp360DocumentsOverview(
    { organizationId: activeOrg || '' },
    { query: { enabled: Boolean(activeOrg) } },
  );
  const createThread = useCreateFp360CommunicationsThread();
  const sendThread = useSendFp360CommunicationsThread();
  const replyThread = useReplyFp360CommunicationsThread();
  const changeState = useUpdateFp360CommunicationsThreadState();
  const createTask = useCreateFp360CommunicationsTask();
  const completeTask = useCompleteFp360CommunicationsTask();
  const overview = query.data;
  const threads = useMemo(() => overview?.threads ?? [], [overview?.threads]);
  const templates = useMemo(() => overview?.templates ?? [], [overview?.templates]);
  const attachableDocuments = useMemo(
    () => (documentsQuery.data?.documents ?? []).filter((document) => document.status === 'confirmed' && document.visibility === 'organization' && document.isSynthetic),
    [documentsQuery.data?.documents],
  );
  const selected = threads.find((thread) => thread.id === selectedId) ?? threads[0] ?? null;
  const refresh = () => { void client.invalidateQueries({ queryKey: getGetFp360CommunicationsOverviewQueryKey({ organizationId: activeOrg }) }); };
  const finish = (message: string) => { setBusy(''); setActionError(''); refresh(); onNotice(message); };
  const fail = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
  const availableOrganizations = organizations.filter((org) => org.isActive !== false);
  const visibleThreads = threads.filter((thread) => {
    if (view === 'departments' && thread.originOrganizationId !== activeOrg && thread.recipientOrganizationId !== activeOrg) return false;
    if (view === 'commercial' && !thread.relatedReference) return false;
    if (view === 'departments' && departmentFilter && thread.originDepartment !== departmentFilter && thread.recipientDepartment !== departmentFilter) return false;
    if (filter === 'unread' && !thread.unread) return false;
    if (filter === 'drafts' && thread.status !== 'draft') return false;
    if (filter === 'archived' && !thread.archived) return false;
    if (filter !== 'archived' && thread.archived) return false;
    return true;
  });
  const runState = (thread: Fp360CommunicationsThread, action: 'mark_read' | 'archive' | 'unarchive' | 'assign', assignedOrganizationId?: string, assignedDepartmentValue?: string) => {
    if (!activeOrg) return;
    setBusy(thread.id); setActionError('');
    changeState.mutate({ threadId: thread.id, data: {
      organizationId: activeOrg, action, operationId: operationId(),
      ...(action === 'assign' ? { assignedOrganizationId: assignedOrganizationId || null, assignedDepartment: assignedDepartmentValue || null } : {}),
    } }, { onSuccess: () => finish(action === 'archive' ? 'Conversación archivada en la simulación.' : action === 'assign' ? 'Asignación registrada.' : 'Estado actualizado.'), onError: (error) => { setBusy(''); setActionError(fail(error, 'No se pudo actualizar la conversación.')); } });
  };
  const handleCompose = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    if (!activeOrg) { setFormError('Selecciona una organización de trabajo.'); return; }
    const fd = new FormData(event.currentTarget);
    const recipient = String(fd.get('recipientOrganizationId') || '');
    const subject = String(fd.get('subject') || '').trim();
    const body = String(fd.get('body') || '').trim();
    const references = fd.getAll('documentIds').map((value) => String(value).trim()).filter(Boolean);
    if (!recipient || !subject || body.length < 10 || references.length > 5) { setFormError('Revisa destinatario, asunto, mensaje (mínimo 10 caracteres) y hasta cinco referencias documentales.'); return; }
    createThread.mutate({ data: {
      organizationId: activeOrg, recipientOrganizationId: recipient,
      originDepartment: String(fd.get('originDepartment')) as never,
      recipientDepartment: String(fd.get('recipientDepartment')) as never,
      subject, body, priority: String(fd.get('priority')) as never,
      relatedReference: String(fd.get('relatedReference') || '').trim() || null,
      attachmentDocumentIds: references, simulatedDate: String(fd.get('simulatedDate')),
      saveAsDraft: fd.get('saveAsDraft') === 'on', operationId: operationId(),
    } }, { onSuccess: (thread) => { refresh(); setSelectedId(thread.id); setView('inbox'); onNotice(thread.status === 'draft' ? 'Borrador guardado.' : 'Mensaje enviado dentro de la simulación.'); }, onError: (error) => setFormError(fail(error, 'No se pudo guardar el mensaje. El contenido permanece en el formulario.')) });
  };
  const handleReply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !activeOrg || replyText.trim().length < 10) return;
    setBusy(selected.id);
    if (replyAttachmentIds.length > 5) { setActionError('Puedes adjuntar hasta cinco referencias documentales.'); return; }
    replyThread.mutate({ threadId: selected.id, data: { organizationId: activeOrg, body: replyText.trim(), attachmentDocumentIds: replyAttachmentIds, simulatedDate: DEFAULT_SIMULATED_DATE, operationId: operationId() } }, {
      onSuccess: () => { setReplyText(''); setReplyAttachmentIds([]); finish('Respuesta registrada en el hilo simulado.'); },
      onError: (error) => { setBusy(''); setActionError(fail(error, 'No se pudo registrar la respuesta.')); },
    });
  };
  const sendDraft = (thread: Fp360CommunicationsThread) => {
    if (!activeOrg || !window.confirm('Enviar este mensaje solo a la bandeja interna simulada?')) return;
    setBusy(thread.id);
    sendThread.mutate({ threadId: thread.id, data: { organizationId: activeOrg, operationId: operationId() } }, {
      onSuccess: () => finish('Borrador enviado dentro del entorno simulado.'),
      onError: (error) => { setBusy(''); setActionError(fail(error, 'No se pudo enviar el borrador.')); },
    });
  };
  const assignThread = (thread: Fp360CommunicationsThread) => {
    if (!canAssign || !assignedOrg) return;
    runState(thread, 'assign', assignedOrg, assignedDepartment);
  };
  const addTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected || !activeOrg || !taskTitle.trim() || !taskDue) return;
    setBusy(selected.id);
    createTask.mutate({ threadId: selected.id, data: { organizationId: activeOrg, title: taskTitle.trim(), assignedOrganizationId: assignedOrg || activeOrg, assignedDepartment: assignedDepartment as never, dueDate: taskDue, operationId: operationId() } }, {
      onSuccess: () => { setTaskTitle(''); setTaskDue(''); finish('Tarea y plazo vinculados a la conversación.'); },
      onError: (error) => { setBusy(''); setActionError(fail(error, 'No se pudo crear la tarea.')); },
    });
  };
  const markComplete = (taskId: string) => {
    if (!activeOrg) return;
    setBusy(taskId);
    completeTask.mutate({ taskId, data: { organizationId: activeOrg, operationId: operationId() } }, {
      onSuccess: () => finish('Tarea completada en la simulación.'),
      onError: (error) => { setBusy(''); setActionError(fail(error, 'No se pudo completar la tarea.')); },
    });
  };
  const applyTemplate = (template: { subject: string; body: string; department: string }) => {
    setView('compose');
    window.setTimeout(() => {
      const subject = document.querySelector<HTMLInputElement>('[data-testid="input-communications-subject"]');
      const body = document.querySelector<HTMLTextAreaElement>('[data-testid="input-communications-body"]');
      const origin = document.querySelector<HTMLSelectElement>('[data-testid="select-communications-origin-department"]');
      if (subject) subject.value = template.subject;
      if (body) body.value = template.body;
      if (origin) origin.value = template.department;
    }, 0);
  };
  const exportCsv = () => {
    const rows = [['Referencia', 'Asunto', 'Origen', 'Destino', 'Departamento', 'Estado', 'Prioridad', 'Fecha simulada', 'Referencia documental']];
    threads.forEach((thread) => rows.push([
      thread.reference, thread.subject, thread.originOrganizationName, thread.recipientOrganizationName,
      departmentName(thread.recipientDepartment), thread.status, priorityName[thread.priority] ?? thread.priority,
      thread.simulatedDate, thread.relatedReference ?? '',
    ]));
    const csv = rows.map((row) => row.map((cell) => {
      const safe = /^[=+\-@]/.test(String(cell)) ? `'${String(cell)}` : String(cell);
      return `"${safe.replaceAll('"', '""')}"`;
    }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'red-fp360-registro-comunicaciones.csv'; anchor.click(); URL.revokeObjectURL(url);
    onNotice('Exportación CSV de evidencias preparada. Solo contiene datos simulados.');
  };
  const filteredByView = view === 'registry' ? threads : visibleThreads;
  const unreadCount = overview?.metrics.unreadCount ?? 0;
  const pendingTasks = threads.flatMap((thread) => thread.tasks.map((task) => ({ ...task, thread }))).filter((task) => task.status === 'open');
  const detailThread = selected;

  return <main className="page-content comm-page">
    <header className="comm-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>APLICACIÓN 20 · SERVICIOS COMUNES</span></div><span className="comm-kicker">COMUNICACIÓN INTERCENTROS · CANARIAS</span><h1>Centro de comunicaciones</h1><p>Mensajería interna, buzones departamentales y conversaciones comerciales trazables.</p></div>
      <div className="comm-heading-actions">
        {!organizationId && <label className="comm-org-select">Organización activa<select value={fallbackOrg} onChange={(e) => setFallbackOrg(e.target.value)} data-testid="select-communications-organization"><option value="">Selecciona organización</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <button className="comm-button primary" type="button" onClick={() => { setView('compose'); setFormError(''); }} disabled={!activeOrg} data-testid="button-new-communication"><Plus size={15} /> Nueva operación</button>
      </div>
    </header>
    <aside className="comm-simulation" data-testid="communications-simulation-notice"><ShieldAlert size={18} /><div><b>SIMULACIÓN INTERNA · PRIVACIDAD POR DISEÑO</b><span>Solo participan organizaciones y personas ficticias de RED FP360. No se envían correos externos ni se solicitan datos personales. Un mensaje no modifica compras, contratos ni pagos; esos cambios requieren una acción formal en su módulo. Las referencias documentales no transfieren acceso al documento original.</span></div><strong>NO EXTERNO</strong></aside>
    {activeOrg && <section className="comm-metrics" aria-label="Indicadores de comunicaciones">
      <Metric icon={Mail} label="Mensajes sin leer" value={overview ? String(unreadCount) : '—'} note="En la organización activa" tint="blue" />
      <Metric icon={MessageSquare} label="Conversaciones activas" value={overview ? String(overview.metrics.activeConversations) : '—'} note="Hilos internos y comerciales" tint="green" />
      <Metric icon={Bell} label="Solicitudes nuevas" value={overview ? String(overview.metrics.newRequests) : '—'} note="Registradas en el escenario" tint="amber" />
      <Metric icon={CalendarClock} label="Tiempo de respuesta registrado" value={overview ? `${overview.metrics.averageResponseHours.toLocaleString('es-ES')} h` : '—'} note="Promedio registrado · fecha simulada aparte" tint="violet" />
    </section>}
    {!activeOrg ? <section className="comm-no-org"><Building2 size={26} /><small>ÁMBITO DE TRABAJO</small><h2>Selecciona una organización</h2><p>El centro de comunicaciones muestra únicamente los hilos disponibles para una organización activa.</p></section> : <>
      <div className="comm-tabs" role="tablist" aria-label="Vistas del centro de comunicaciones">
        {views.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} key={id} onClick={() => { setView(id); setFormError(''); setActionError(''); }} data-testid={`tab-communications-${id}`}><Icon size={15} />{label}{id === 'inbox' && unreadCount > 0 && <span className="comm-count">{unreadCount}</span>}</button>)}
      </div>
      {!canAssign && <p className="comm-permission"><LockKeyhole size={14} /> Tu perfil puede redactar y tramitar mensajes. La asignación entre organizaciones está reservada a responsables y equipo docente.</p>}
      {actionError && <div className="comm-error" role="alert" data-testid="communications-action-error"><CircleAlert size={16} /><span>{actionError}</span><button type="button" aria-label="Cerrar error" onClick={() => setActionError('')}><X size={15} /></button></div>}
      {!overview && query.isLoading && <div className="comm-loading" role="status" aria-label="Cargando comunicaciones"><span /><span /><span /><span /></div>}
      {query.isError && <div className="comm-load-error" role="alert" data-testid="communications-load-error"><CircleAlert size={18} /><span>No se pudo cargar el centro de comunicaciones.</span><button type="button" onClick={() => void query.refetch()} data-testid="button-retry-communications">Reintentar</button></div>}
      {view === 'compose' && <section className="comm-card comm-compose">
        <CardHead eyebrow="MENSAJERÍA INTERNA" title="Redactar comunicación" detail="Elige un destino de la red, añade el contexto y conserva una referencia trazable." />
        <form onSubmit={handleCompose} className="comm-form" data-testid="form-new-communication">
          <Field label="Organización destinataria"><select name="recipientOrganizationId" required defaultValue="" data-testid="select-communications-recipient"><option value="">Selecciona una organización</option>{availableOrganizations.filter((org) => org.id !== activeOrg).map((org) => <option key={org.id} value={org.id}>{org.name} · {org.center}</option>)}</select></Field>
          <Field label="Departamento de origen"><select name="originDepartment" defaultValue="purchasing" data-testid="select-communications-origin-department">{departments.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
          <Field label="Departamento destinatario"><select name="recipientDepartment" defaultValue="purchasing" data-testid="select-communications-recipient-department">{departments.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
          <Field label="Prioridad"><select name="priority" defaultValue="normal" data-testid="select-communications-priority"><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></Field>
          <Field label="Asunto"><input name="subject" required minLength={3} maxLength={160} placeholder="Asunto claro y concreto" data-testid="input-communications-subject" /></Field>
          <Field label="Fecha simulada"><input name="simulatedDate" type="date" min="2027-01-01" max="2028-12-31" defaultValue={DEFAULT_SIMULATED_DATE} required data-testid="input-communications-date" /></Field>
          <Field label="Referencia de expediente (opcional)"><input name="relatedReference" maxLength={100} placeholder="Código interno, sin datos personales" data-testid="input-communications-reference" /></Field>
          <Field label="Adjuntar documentos autorizados (opcional)" hint="Solo documentos ficticios confirmados de la empresa de origen; el vínculo no abre el original."><select name="documentIds" multiple size={4} disabled={documentsQuery.isLoading || documentsQuery.isError} data-testid="select-communications-documents">{attachableDocuments.map((document) => <option key={document.id} value={document.id}>{document.reference} · {document.title}</option>)}</select>{documentsQuery.isLoading && <small role="status">Cargando documentos autorizados…</small>}{documentsQuery.isError && <small role="alert">No se pudo cargar el registro documental.</small>}{!documentsQuery.isLoading && !documentsQuery.isError && attachableDocuments.length === 0 && <small>No hay documentos ficticios confirmados para adjuntar.</small>}</Field>
          <Field label="Mensaje" className="full"><textarea name="body" minLength={10} maxLength={5000} required placeholder="Redacta el mensaje de trabajo. No incluyas correo, teléfono ni información personal." data-testid="input-communications-body" /></Field>
          {formError && <p className="comm-form-error" role="alert" data-testid="communications-form-error"><CircleAlert size={14} />{formError}</p>}
          <div className="comm-form-foot"><label className="comm-check"><input type="checkbox" name="saveAsDraft" data-testid="checkbox-save-draft" /> Guardar como borrador</label><span>Envío interno simulado; no cambia operaciones comerciales.</span><button className="comm-button primary" disabled={createThread.isPending} data-testid="button-submit-communication"><Send size={14} />{createThread.isPending ? 'Guardando…' : 'Guardar mensaje'}</button></div>
        </form>
      </section>}
      {view === 'templates' && <section className="comm-card"><CardHead eyebrow="REDACCIÓN ASISTIDA" title="Plantillas de comunicación" detail="Modelos de texto para el escenario educativo. Revísalos y personalízalos antes de guardar." />
        {query.isSuccess && templates.length ? <div className="comm-template-list">{templates.map((item) => <article className="comm-template" key={item.id} data-testid={`template-${item.id}`}><div className="comm-template-mark"><Sparkles size={16} /></div><div><small>{departmentName(item.department)}</small><h3>{item.title}</h3><b>{item.subject}</b><p>{item.body}</p></div><button type="button" className="comm-button secondary" onClick={() => applyTemplate(item)} data-testid={`button-use-template-${item.id}`}>Usar plantilla <ChevronRight size={14} /></button></article>)}</div> : query.isSuccess && <Empty title="No hay plantillas disponibles" detail="Las plantillas habilitadas para la organización aparecerán aquí." icon={BookOpen} />}
      </section>}
      {view === 'notifications' && <section className="comm-card"><CardHead eyebrow="SEGUIMIENTO" title="Avisos y notificaciones" detail="No leídos, tareas abiertas y plazos próximos dentro de esta organización." />
        {query.isSuccess && <div className="comm-notice-list">{threads.filter((thread) => thread.unread).map((thread) => <button key={thread.id} type="button" className="comm-notice" onClick={() => { setSelectedId(thread.id); setView('inbox'); runState(thread, 'mark_read'); }} data-testid={`notification-thread-${thread.id}`}><span className="comm-notice-icon"><Mail size={16} /></span><span><b>{thread.subject}</b><small>{thread.originOrganizationName} · {thread.reference} · {dateLabel(thread.updatedAt)}</small></span><ChevronRight size={15} /></button>)}
          {pendingTasks.map(({ id, title, dueDate, thread }) => <button key={id} type="button" className="comm-notice task" onClick={() => { setSelectedId(thread.id); setView('inbox'); }} data-testid={`notification-task-${id}`}><span className="comm-notice-icon amber"><CalendarClock size={16} /></span><span><b>{title}</b><small>Plazo {dateLabel(dueDate)} · {thread.reference}</small></span><ChevronRight size={15} /></button>)}
          {!threads.some((thread) => thread.unread) && !pendingTasks.length && <Empty title="Todo al día" detail="No hay mensajes sin leer ni tareas abiertas vinculadas a la organización." icon={CheckCheck} />}
        </div>}
      </section>}
      {view === 'registry' && <section className="comm-card"><CardHead eyebrow="TRAZABILIDAD Y EVIDENCIAS" title="Registro y búsqueda" detail="Consulta el historial disponible y exporta una relación CSV de las evidencias." action={<button type="button" className="comm-button primary" onClick={exportCsv} disabled={!threads.length} data-testid="button-export-communications-csv"><FileText size={14} /> Exportar CSV</button>} />
        <SearchBar value={search} onChange={setSearch} label="Buscar en registro" testId="input-communications-search" />
        <ThreadList threads={filteredByView} activeId={selectedId} select={(thread) => { setSelectedId(thread.id); setView('inbox'); }} onMarkRead={(thread) => runState(thread, 'mark_read')} busy={busy} emptyTitle="Sin resultados en el registro" />
      </section>}
      {['inbox', 'departments', 'commercial'].includes(view) && <div className="comm-workspace">
        <section className="comm-card comm-list-card">
          <CardHead eyebrow={view === 'departments' ? 'VISTAS POR EQUIPO' : view === 'commercial' ? 'RELACIÓN INTEREMPRESARIAL' : 'BANDEJA INTERNA'} title={view === 'departments' ? 'Buzones departamentales' : view === 'commercial' ? 'Conversaciones comerciales' : 'Actividad intercentros'} detail={view === 'departments' ? 'Consulta mensajes dirigidos a los equipos de la organización.' : view === 'commercial' ? 'Hilos con referencia de expediente; un mensaje no formaliza acuerdos ni cambia operaciones.' : 'Mensajes internos, prioridades, estados y próximos plazos.'} />
          <div className="comm-toolbar"><SearchBar value={search} onChange={setSearch} label="Buscar por referencia, asunto u organización" testId="input-communications-search-main" /><label className="comm-filter">Estado<select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} data-testid="select-communications-filter"><option value="all">Todos</option><option value="unread">Sin leer</option><option value="drafts">Borradores</option><option value="archived">Archivados</option></select></label></div>
          {view === 'departments' && <div className="comm-dept-pills" aria-label="Buzones departamentales"><button type="button" className={!departmentFilter ? 'active' : ''} onClick={() => setDepartmentFilter('')} data-testid="department-filter-all">Todos los buzones</button>{departments.map(([id, label]) => <button type="button" className={departmentFilter === id ? 'active' : ''} key={id} onClick={() => setDepartmentFilter(id)} data-testid={`department-filter-${id}`}>{label}</button>)}</div>}
          {query.isSuccess && <ThreadList threads={filteredByView} activeId={selected?.id ?? ''} select={(thread) => { setSelectedId(thread.id); if (thread.unread) runState(thread, 'mark_read'); }} onMarkRead={(thread) => runState(thread, 'mark_read')} busy={busy} emptyTitle={filter === 'drafts' ? 'No hay borradores' : 'No hay mensajes para mostrar'} />}
        </section>
        <aside className="comm-detail">
          {detailThread ? <ThreadDetail thread={detailThread} organizations={availableOrganizations} canAssign={canAssign} currentOrg={activeOrg} busy={busy} onArchive={() => runState(detailThread, detailThread.archived ? 'unarchive' : 'archive')} onSend={() => sendDraft(detailThread)} replyText={replyText} setReplyText={setReplyText} onReply={handleReply} replyPending={replyThread.isPending} assignedOrg={assignedOrg} setAssignedOrg={setAssignedOrg} assignedDepartment={assignedDepartment} setAssignedDepartment={setAssignedDepartment} onAssign={() => assignThread(detailThread)} taskTitle={taskTitle} setTaskTitle={setTaskTitle} taskDue={taskDue} setTaskDue={setTaskDue} onAddTask={addTask} onCompleteTask={markComplete} taskPending={createTask.isPending || completeTask.isPending} />
            : <div className="comm-detail-empty"><MessageSquare size={23} /><b>Selecciona una conversación</b><p>El detalle mostrará mensajes, referencias, historial y tareas asociadas.</p></div>}
        </aside>
      </div>}
      <footer className="comm-footer"><ShieldAlert size={14} /><span>La comunicación es evidencia de trabajo, no una aceptación comercial ni una instrucción de pago.</span><span>RED FP360 · Módulo 20</span></footer>
    </>}
  </main>;
}

function Metric({ icon: Icon, label, value, note, tint }: { icon: typeof Inbox; label: string; value: string; note: string; tint: string }) {
  return <article className={`comm-metric ${tint}`}><span><Icon size={16} /></span><div><small>{label}</small><b>{value}</b><em>{note}</em></div></article>;
}
function CardHead({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <header className="comm-card-head"><div><small>{eyebrow}</small><h2>{title}</h2><p>{detail}</p></div>{action}</header>;
}
function Field({ label, children, hint, className = '' }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return <label className={`comm-field ${className}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function SearchBar({ value, onChange, label, testId }: { value: string; onChange: (value: string) => void; label: string; testId: string }) {
  return <label className="comm-search"><Search size={15} /><input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} data-testid={testId} /></label>;
}
function Empty({ title, detail, icon: Icon = Inbox }: { title: string; detail: string; icon?: typeof Inbox }) {
  return <div className="comm-empty" data-testid="communications-empty"><span><Icon size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function ThreadList({ threads, activeId, select, onMarkRead, busy, emptyTitle }: { threads: Fp360CommunicationsThread[]; activeId: string; select: (thread: Fp360CommunicationsThread) => void; onMarkRead: (thread: Fp360CommunicationsThread) => void; busy: string; emptyTitle: string }) {
  return <div className="comm-thread-list">{threads.map((thread) => <article className={`comm-thread-row ${thread.id === activeId ? 'selected' : ''} ${thread.unread ? 'unread' : ''}`} key={thread.id} data-testid={`communication-thread-${thread.id}`}>
    <button type="button" className="comm-thread-open" onClick={() => select(thread)} aria-label={`Abrir ${thread.subject}`} data-testid={`button-open-thread-${thread.id}`}><span className="comm-thread-mark">{thread.originOrganizationName.slice(0, 2).toUpperCase()}</span><span className="comm-thread-main"><span className="comm-thread-line"><b>{thread.originOrganizationName}</b><time>{dateLabel(thread.updatedAt)}</time></span><strong>{thread.subject}</strong><small>{thread.reference} · {departmentName(thread.recipientDepartment)} · {thread.messages.length} mensajes</small></span><span className={`comm-status ${thread.status}`}>{thread.status === 'draft' ? 'Borrador' : thread.unread ? 'Sin leer' : thread.status === 'closed' ? 'Cerrada' : 'Leída'}</span></button>
    <div className="comm-row-tools"><span className={`comm-priority ${thread.priority}`}>{priorityName[thread.priority] ?? thread.priority}</span>{thread.relatedReference && <span className="comm-ref">{thread.relatedReference}</span>}<button type="button" className="comm-icon-action" disabled={busy === thread.id || !thread.unread} onClick={() => onMarkRead(thread)} aria-label="Marcar como leído" title="Marcar como leído" data-testid={`button-mark-read-${thread.id}`}><Check size={14} /></button></div>
  </article>)}{!threads.length && <Empty title={emptyTitle} detail="Prueba otra búsqueda o filtro. Los mensajes nuevos aparecerán aquí tras confirmarse en el servidor." />}</div>;
}
function ThreadDetail({ thread, organizations, canAssign, currentOrg, busy, onArchive, onSend, replyText, setReplyText, onReply, replyPending, assignedOrg, setAssignedOrg, assignedDepartment, setAssignedDepartment, onAssign, taskTitle, setTaskTitle, taskDue, setTaskDue, onAddTask, onCompleteTask, taskPending }: {
  thread: Fp360CommunicationsThread; organizations: Fp360Organization[]; canAssign: boolean; currentOrg: string; busy: string; onArchive: () => void; onSend: () => void;
  replyText: string; setReplyText: (value: string) => void; onReply: (event: FormEvent<HTMLFormElement>) => void; replyPending: boolean;
  assignedOrg: string; setAssignedOrg: (value: string) => void; assignedDepartment: string; setAssignedDepartment: (value: string) => void; onAssign: () => void;
  taskTitle: string; setTaskTitle: (value: string) => void; taskDue: string; setTaskDue: (value: string) => void; onAddTask: (event: FormEvent<HTMLFormElement>) => void; onCompleteTask: (id: string) => void; taskPending: boolean;
}) {
  const [tab, setTab] = useState<'info' | 'documents' | 'history'>('info');
  const documents = thread.messages.flatMap((message) => message.attachments);
  return <section className="comm-card comm-detail-card" data-testid={`communication-detail-${thread.id}`}>
    <div className="comm-detail-head"><span className="comm-detail-symbol"><Mail size={17} /></span><div><small>{thread.reference} · {departmentName(thread.recipientDepartment)}</small><h2>{thread.subject}</h2><p>{thread.originOrganizationName} <ChevronRight size={12} /> {thread.recipientOrganizationName}</p></div><button type="button" className="comm-icon-action" onClick={onArchive} disabled={busy === thread.id} aria-label={thread.archived ? 'Desarchivar conversación' : 'Archivar conversación'} title={thread.archived ? 'Desarchivar' : 'Archivar'} data-testid="button-archive-thread"><Archive size={15} /></button></div>
    <div className="comm-detail-tabs" role="tablist" aria-label="Información de conversación">{(['info', 'documents', 'history'] as const).map((item) => <button type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)} data-testid={`tab-thread-${item}`}>{item === 'info' ? 'Información' : item === 'documents' ? 'Documentos' : 'Historial'}</button>)}</div>
    {tab === 'info' && <div className="comm-detail-content">
      <dl className="comm-facts"><div><dt>De</dt><dd>{thread.originOrganizationName}</dd></div><div><dt>Para</dt><dd>{thread.recipientOrganizationName} · {departmentName(thread.recipientDepartment)}</dd></div><div><dt>Asunto</dt><dd>{thread.subject}</dd></div><div><dt>Fecha simulada</dt><dd>{dateLabel(thread.simulatedDate)}</dd></div><div><dt>Prioridad</dt><dd>{priorityName[thread.priority] ?? thread.priority}</dd></div><div><dt>Referencia</dt><dd>{thread.relatedReference || 'Sin referencia asociada'}</dd></div></dl>
      <div className="comm-message-stack">{thread.messages.map((message) => <article className="comm-message" key={message.id}><div><b>{message.senderOrganizationId === thread.originOrganizationId ? thread.originOrganizationName : thread.recipientOrganizationName}</b><time>{dateLabel(message.sentAt || message.simulatedDate)}</time></div><p>{message.body}</p><small>{departmentName(message.department)} · Autor {message.authorRef}</small></article>)}</div>
      {thread.status === 'draft' ? <button type="button" className="comm-button primary full-width" disabled={busy === thread.id} onClick={onSend} data-testid="button-send-draft"><Send size={14} />{busy === thread.id ? 'Enviando…' : 'Enviar a bandeja interna'}</button> : <form className="comm-reply-form" onSubmit={onReply} data-testid="form-reply-communication"><label className="comm-field"><span>Responder dentro de la simulación</span><textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} minLength={10} maxLength={5000} placeholder="Escribe una respuesta sin datos personales." required data-testid="input-reply-communication" /></label><button className="comm-button primary" type="submit" disabled={replyPending || replyText.trim().length < 10} data-testid="button-reply-communication"><Send size={13} />{replyPending ? 'Registrando…' : 'Responder'}</button></form>}
      {canAssign && <div className="comm-assignment"><b>Asignación de seguimiento</b><div className="comm-assignment-form"><label className="comm-field"><span>Organización</span><select value={assignedOrg || thread.assignedOrganizationId || currentOrg} onChange={(e) => setAssignedOrg(e.target.value)} data-testid="select-thread-assignment-org"><option value="">Sin asignar</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label><label className="comm-field"><span>Departamento</span><select value={assignedDepartment || thread.assignedDepartment || 'purchasing'} onChange={(e) => setAssignedDepartment(e.target.value)} data-testid="select-thread-assignment-department">{departments.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><button type="button" className="comm-button secondary" onClick={onAssign} disabled={busy === thread.id} data-testid="button-assign-thread">Asignar</button></div></div>}
      <div className="comm-task-panel"><div className="comm-task-title"><ClipboardList size={15} /><b>Tareas y plazos</b><span>{thread.tasks.filter((task) => task.status === 'open').length} abiertas</span></div>
        {thread.tasks.map((task) => <div className={`comm-task ${task.status}`} key={task.id} data-testid={`communication-task-${task.id}`}><span><b>{task.title}</b><small>{task.assignedOrganizationName} · {departmentName(task.department)} · Plazo {dateLabel(task.dueDate)}</small></span>{task.status === 'open' ? <button type="button" className="comm-icon-action" onClick={() => onCompleteTask(task.id)} disabled={taskPending} aria-label="Completar tarea" title="Completar tarea" data-testid={`button-complete-task-${task.id}`}><CheckCheck size={15} /></button> : <span className="comm-task-done">Completada</span>}</div>)}
        <form className="comm-add-task" onSubmit={onAddTask} data-testid="form-create-communication-task"><label className="comm-field"><span>Nueva tarea</span><input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} required minLength={3} maxLength={160} placeholder="Acción de seguimiento" data-testid="input-task-title" /></label><label className="comm-field"><span>Fecha límite</span><input type="date" min="2027-01-01" max="2028-12-31" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} required data-testid="input-task-due" /></label><button className="comm-button secondary" type="submit" disabled={taskPending} data-testid="button-create-communication-task"><Plus size={13} /> Añadir</button></form>
      </div>
      <p className="comm-legal-inline"><ShieldAlert size={13} /> Este hilo no formaliza acuerdos ni actualiza pedidos, contratos o pagos.</p>
    </div>}
    {tab === 'documents' && <div className="comm-detail-content">{documents.length ? <div className="comm-document-list">{documents.map((doc) => <div className="comm-document" key={doc.id}><FileText size={16} /><span><b>{doc.title}</b><small>{doc.reference}</small></span><span className="comm-doc-access">{doc.accessible ? 'Referencia vinculada' : 'Sin acceso al original'}</span></div>)}</div> : <Empty title="Sin documentos vinculados" detail="Los mensajes pueden referenciar documentos autorizados. El vínculo nunca transfiere acceso al original." icon={FileText} />}<p className="comm-legal-inline"><LockKeyhole size={13} /> La referencia es solo trazabilidad; no abre ni copia el documento original.</p></div>}
    {tab === 'history' && <div className="comm-detail-content"><div className="comm-history"><HistoryLine label="Conversación creada" date={thread.createdAt} /><HistoryLine label={thread.status === 'draft' ? 'Borrador guardado' : 'Comunicación registrada'} date={thread.sentAt || thread.updatedAt} /><HistoryLine label={thread.archived ? 'Archivada' : thread.unread ? 'Pendiente de lectura' : 'Lectura registrada'} date={thread.updatedAt} /></div><p className="comm-legal-inline"><ShieldAlert size={13} /> El historial conserva únicamente eventos de la simulación.</p></div>}
  </section>;
}
function HistoryLine({ label, date }: { label: string; date: string }) {
  return <div className="comm-history-line"><i /><span><b>{label}</b><small>{dateLabel(date)}</small></span></div>;
}

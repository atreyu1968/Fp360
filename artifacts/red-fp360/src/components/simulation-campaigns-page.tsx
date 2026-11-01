import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowRight, BookOpen, CalendarDays, Check, CheckCircle2, ChevronRight, CircleAlert,
  ClipboardList, Clock3, FileText, Gauge, MapPin, Pause, Play, Plus, Radio,
  ShieldCheck, Users, X,
} from 'lucide-react';
import {
  getGetFp360SimulationsOverviewQueryKey, useActOnFp360SimulationCampaign,
  useActOnFp360SimulationEvent, useCreateFp360SimulationCampaign,
  useCreateFp360SimulationEvent, useGetFp360DocumentsOverview,
  useGetFp360SimulationsOverview, useLinkFp360SimulationEventEvidence,
  useUpdateFp360SimulationEvent,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360SimulationCampaign, Fp360SimulationEvent, Fp360SimulationEventEventType,
} from '@workspace/api-client-react';
import './simulation-campaigns-page.css';

type Props = {
  identity: Pick<AuthIdentity, 'role'> & { organizationId?: string };
  onNotice: (message: string, kind: 'success' | 'error') => void;
};
type View = 'overview' | 'create' | 'network' | 'queue' | 'editor' | 'student' | 'review' | 'analytics';
type PendingAction =
  | { kind: 'campaign'; id: string; action: 'submit' | 'approve' | 'reject' | 'start' | 'pause' | 'close'; label: string }
  | { kind: 'event'; id: string; action: 'submit' | 'approve' | 'publish' | 'cancel' | 'return'; label: string }
  | null;

const views: { id: View; title: string; eyebrow: string; icon: typeof Activity }[] = [
  { id: 'overview', title: 'Campañas', eyebrow: 'RESUMEN', icon: Gauge },
  { id: 'create', title: 'Nueva campaña', eyebrow: 'DISEÑO', icon: Plus },
  { id: 'network', title: 'Organizaciones', eyebrow: 'RED', icon: MapPin },
  { id: 'queue', title: 'Cola de eventos', eyebrow: 'OPERACIONES', icon: ClipboardList },
  { id: 'editor', title: 'Caso / evento', eyebrow: 'CONTENIDO', icon: FileText },
  { id: 'student', title: 'Mi jornada', eyebrow: 'ALUMNADO', icon: BookOpen },
  { id: 'review', title: 'Revisión', eyebrow: 'SUPERVISIÓN', icon: ShieldCheck },
  { id: 'analytics', title: 'Cierre y lectura', eyebrow: 'SEGUIMIENTO', icon: Activity },
];
const campaignStatus: Record<string, string> = {
  draft: 'Borrador', review: 'En revisión', approved: 'Aprobada', active: 'En marcha',
  paused: 'En pausa', closed: 'Cerrada', rejected: 'Devuelta',
};
const eventStatus: Record<string, string> = {
  draft: 'Borrador', proposed: 'Pendiente', approved: 'Aprobado', published: 'Publicado', completed: 'Completado', cancelled: 'Cancelado',
};
const eventTypes: { value: Fp360SimulationEventEventType; label: string }[] = [
  { value: 'offer', label: 'Oferta comercial' }, { value: 'late_payment', label: 'Retraso de pago' },
  { value: 'stock_break', label: 'Rotura de stock' }, { value: 'claim', label: 'Reclamación' },
  { value: 'financing', label: 'Financiación simulada' }, { value: 'service_incident', label: 'Incidencia de servicio' },
  { value: 'other', label: 'Otro caso' },
];
const today = () => '2027-09-15';
const operationId = () => `sim:${crypto.randomUUID()}`;
const dateText = (value?: string) => {
  if (!value) return 'Sin fecha';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la acción. Revisa tus permisos y vuelve a intentarlo.';

function Status({ value, event = false }: { value: string; event?: boolean }) {
  return <span className={`sc-status sc-status-${value}`} data-testid={`status-${event ? 'event' : 'campaign'}-${value}`}>
    <i aria-hidden="true" />{(event ? eventStatus : campaignStatus)[value] ?? value}
  </span>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="sc-empty"><span><ClipboardList size={20} /></span><b>{title}</b><p>{detail}</p></div>;
}
function PanelTitle({ kicker, title, detail, action }: { kicker: string; title: string; detail?: string; action?: ReactNode }) {
  return <header className="sc-panel-title"><div><span>{kicker}</span><h2>{title}</h2>{detail && <p>{detail}</p>}</div>{action}</header>;
}
function Skeleton() {
  return <div className="sc-skeleton" aria-label="Cargando campañas"><i /><i /><i /></div>;
}

export function SimulationCampaignsPage({ identity, onNotice }: Props) {
  const client = useQueryClient();
  const overview = useGetFp360SimulationsOverview({ query: { staleTime: 15_000 } });
  const createCampaign = useCreateFp360SimulationCampaign();
  const campaignAction = useActOnFp360SimulationCampaign();
  const createEvent = useCreateFp360SimulationEvent();
  const eventAction = useActOnFp360SimulationEvent();
  const linkEvidence = useLinkFp360SimulationEventEvidence();
  const updateEvent = useUpdateFp360SimulationEvent();
  const [view, setView] = useState<View>(identity.role === 'student' ? 'student' : 'overview');
  const [campaignId, setCampaignId] = useState('');
  const [eventId, setEventId] = useState('');
  const [search, setSearch] = useState('');
  const [islandFilter, setIslandFilter] = useState('Todas');
  const [actionNote, setActionNote] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [template, setTemplate] = useState<'incidencia' | 'oferta'>('incidencia');
  const [eventType, setEventType] = useState<Fp360SimulationEventEventType>('service_incident');
  const [evidenceSelection, setEvidenceSelection] = useState<Record<string, string>>({});
  const organizationId = identity.organizationId ?? '';
  const documentOverview = useGetFp360DocumentsOverview({ organizationId }, {
    query: { enabled: identity.role === 'student' && Boolean(organizationId) },
  });

  const canReview = ['teacher', 'administrator'].includes(identity.role);
  const canCreate = ['team_manager', 'teacher', 'administrator'].includes(identity.role);
  const campaigns = overview.data?.campaigns ?? [];
  const events = overview.data?.events ?? [];
  const organizations = overview.data?.organizations ?? [];
  const selectedCampaign = campaigns.find((item) => item.id === campaignId) ?? campaigns[0];
  const selectedEvent = events.find((item) => item.id === eventId) ?? null;
  const currentOrg = organizations.find((org) => org.id === identity.organizationId);
  const selectedCampaignEvents = events.filter((item) => item.campaignId === selectedCampaign?.id);
  const studentEvents = events.filter((item) => item.organizationId === identity.organizationId && ['published', 'completed'].includes(item.status))
    .sort((a, b) => a.simulatedDate.localeCompare(b.simulatedDate));
  const evidenceDocuments = (event: Fp360SimulationEvent) => (documentOverview.data?.documents ?? []).filter((document) =>
    document.isSynthetic && document.visibility === 'organization' && document.status === 'confirmed' &&
    (!event.requiredDocumentType || document.documentType === event.requiredDocumentType));
  const organizationMap = useMemo(() => new Map(organizations.map((org) => [org.id, org])), [organizations]);
  const reload = () => { void overview.refetch(); };
  const refresh = () => client.invalidateQueries({ queryKey: getGetFp360SimulationsOverviewQueryKey() });
  const notifyError = (error: unknown) => onNotice(errorMessage(error), 'error');
  const submitEvidence = (event: Fp360SimulationEvent) => {
    const available = evidenceDocuments(event);
    const documentId = evidenceSelection[event.id] ?? available[0]?.id;
    if (!documentId) {
      onNotice('No hay un documento confirmado que cumpla los requisitos de esta actividad.', 'error');
      return;
    }
    linkEvidence.mutate({ id: event.id, data: { organizationId, documentId, operationId: operationId() } }, {
      onSuccess: () => { onNotice('Actividad completada con evidencia documental confirmada.', 'success'); void refresh(); },
      onError: notifyError,
    });
  };
  const participants = (campaign: Fp360SimulationCampaign) => campaign.participantOrganizationIds
    .map((id) => organizationMap.get(id)?.name ?? campaign.participantNames[campaign.participantOrganizationIds.indexOf(id)] ?? 'Organización')
    .filter(Boolean);

  const mutateCampaign = (campaign: Fp360SimulationCampaign, action: 'submit' | 'approve' | 'reject' | 'start' | 'pause' | 'close', label: string, note = '') => {
    campaignAction.mutate({ id: campaign.id, data: {
      organizationId: identity.organizationId && campaign.participantOrganizationIds.includes(identity.organizationId)
        ? identity.organizationId : campaign.ownerOrganizationId,
      action, ...(note.trim() ? { note: note.trim() } : {}), operationId: operationId(),
    } }, {
      onSuccess: () => { setPendingAction(null); setActionNote(''); onNotice(`${label}: campaña actualizada.`, 'success'); void refresh(); },
      onError: notifyError,
    });
  };
  const mutateEvent = (event: Fp360SimulationEvent, action: 'submit' | 'approve' | 'publish' | 'cancel' | 'return', label: string, note = '') => {
    eventAction.mutate({ id: event.id, data: {
      organizationId: event.organizationId, action, ...(note.trim() ? { note: note.trim() } : {}), operationId: operationId(),
    } }, {
      onSuccess: () => { setPendingAction(null); setActionNote(''); onNotice(`${label}: evento actualizado.`, 'success'); void refresh(); },
      onError: notifyError,
    });
  };
  const askAction = (
    kind: 'campaign' | 'event', id: string,
    action: 'submit' | 'approve' | 'reject' | 'start' | 'pause' | 'close' | 'publish' | 'cancel' | 'return',
    label: string,
  ) => {
    setActionNote('');
    if (kind === 'campaign' && ['submit', 'approve', 'reject', 'start', 'pause', 'close'].includes(action)) {
      setPendingAction({ kind, id, action: action as 'submit' | 'approve' | 'reject' | 'start' | 'pause' | 'close', label });
    } else if (kind === 'event' && ['submit', 'approve', 'publish', 'cancel', 'return'].includes(action)) {
      setPendingAction({ kind, id, action: action as 'submit' | 'approve' | 'publish' | 'cancel' | 'return', label });
    }
  };
  const confirmAction = () => {
    if (!pendingAction) return;
    if (pendingAction.kind === 'campaign') {
      const campaign = campaigns.find((item) => item.id === pendingAction.id);
      if (campaign) mutateCampaign(campaign, pendingAction.action, pendingAction.label, actionNote);
    } else {
      const event = events.find((item) => item.id === pendingAction.id);
      if (event) {
        if (pendingAction.action === 'cancel' && event.status === 'published' && !actionNote.trim()) {
          onNotice('Escribe el motivo antes de cancelar una actividad publicada.', 'error');
          return;
        }
        mutateEvent(event, pendingAction.action, pendingAction.label, actionNote);
      }
    }
  };
  const submitCampaign = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ownerOrganizationId = String(form.get('ownerOrganizationId') || organizationId);
    const startDate = String(form.get('startDate') ?? '');
    const weeks = Number(form.get('durationWeeks'));
    const end = new Date(`${startDate}T12:00:00`);
    end.setDate(end.getDate() + weeks * 7);
    const selectedIds = [...new Set([ownerOrganizationId, ...form.getAll('participants').map(String)])];
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const endDate = end.toISOString().slice(0, 10);
    if (!ownerOrganizationId || title.length < 3 || !description || !startDate || weeks < 1 || !selectedIds.length) {
      onNotice('Completa título, descripción, calendario y al menos una organización participante.', 'error'); return;
    }
    if (startDate < '2027-01-01' || endDate > '2028-12-31') {
      onNotice('El periodo debe quedar dentro del escenario 2027–2028.', 'error'); return;
    }
    createCampaign.mutate({ data: {
      ownerOrganizationId, title, description,
      mode: String(form.get('mode')) as 'manual' | 'supervised' | 'autonomous',
      durationWeeks: weeks, difficulty: String(form.get('difficulty')) as 'low' | 'medium' | 'high',
      startDate, endDate, participantOrganizationIds: selectedIds, operationId: operationId(),
    } }, {
      onSuccess: (created) => {
        onNotice('Campaña guardada como borrador.', 'success');
        setCampaignId(created.id); setView('overview'); void refresh();
      }, onError: notifyError,
    });
  };
  const submitEvent = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCampaign) { onNotice('Selecciona primero una campaña.', 'error'); return; }
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const preconditions = String(form.get('preconditions') ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    const eventOrganizationId = selectedEvent?.status === 'draft'
      ? selectedEvent.organizationId : String(form.get('organizationId') ?? '');
    const simulatedDate = String(form.get('simulatedDate') ?? '');
    if (title.length < 3 || description.length < 10 || !eventOrganizationId || !simulatedDate) {
      onNotice('Revisa el título, el caso, la organización y la fecha simulada.', 'error'); return;
    }
    const data = {
      organizationId: eventOrganizationId,
      title, eventType: String(form.get('eventType')) as Fp360SimulationEventEventType,
      description, preconditions, requiredDocumentType: String(form.get('requiredDocumentType') ?? '').trim() || null,
      simulatedDate, operationId: operationId(),
    };
    if (selectedEvent?.status === 'draft') {
      updateEvent.mutate({ id: selectedEvent.id, data }, {
        onSuccess: (updated) => { setEventId(updated.id); onNotice('Borrador actualizado. Puedes volver a proponerlo desde la cola.', 'success'); setView('queue'); void refresh(); },
        onError: notifyError,
      });
    } else {
      createEvent.mutate({ id: selectedCampaign.id, data }, {
        onSuccess: (created) => { setEventId(created.id); onNotice('Evento propuesto y añadido a la cola.', 'success'); setView('queue'); void refresh(); },
        onError: notifyError,
      });
    }
  };

  const allowedViews = views.filter((item) => {
    if (identity.role === 'student') return item.id === 'student';
    if (item.id === 'create' || item.id === 'editor') return canCreate || canReview;
    if (item.id === 'review') return canReview;
    return true;
  });
  const filteredOrgs = organizations.filter((org) =>
    (islandFilter === 'Todas' || org.island === islandFilter) &&
    `${org.name} ${org.center} ${org.island}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  const islands = [...new Set(organizations.map((org) => org.island))].sort((a, b) => a.localeCompare(b, 'es'));

  return <main className="simulation-campaigns page-enter" data-testid="simulation-campaigns-page">
    <header className="sc-hero">
      <div className="sc-hero-top"><span>RED FP360 <i>/</i> SIMULACIÓN INTERCENTROS</span><span className="sc-sim-label"><ShieldCheck size={14} /> ENTORNO EDUCATIVO</span></div>
      <div className="sc-hero-body">
        <div><div className="sc-kicker">MÓDULO 21 · ORQUESTACIÓN DIDÁCTICA</div><h1>FP360 <em>SIM</em></h1>
          <p>Coordina campañas, casos y jornadas entre organizaciones ficticias de Canarias.</p></div>
        <div className="sc-hero-stamp"><span>CAMPAÑAS</span><strong>{overview.data ? campaigns.length.toString().padStart(2, '0') : '—'}</strong><small>en la red</small></div>
      </div>
      <div className="sc-hero-foot"><span>{currentOrg?.name ?? 'RED EDUCATIVA CANARIA'}</span><span>Las acciones y documentos son simulados; no modifican operaciones empresariales reales.</span></div>
    </header>

    <nav className="sc-nav" aria-label="Vistas de campañas" role="tablist">
      {allowedViews.map(({ id, title, eyebrow, icon: Icon }) => <button type="button" key={id} role="tab" aria-selected={view === id}
        className={view === id ? 'active' : ''} onClick={() => setView(id)} data-testid={`tab-sim-${id}`}>
        <Icon size={15} /><span><small>{eyebrow}</small>{title}</span>{id === 'review' && campaigns.filter((c) => c.status === 'review').length > 0 && <b>{campaigns.filter((c) => c.status === 'review').length}</b>}
      </button>)}
    </nav>

    {overview.isLoading && <section className="sc-panel"><Skeleton /></section>}
    {overview.isError && <div className="sc-error" role="alert"><CircleAlert size={18} /><span>No se pudo cargar el espacio de simulación.</span><button type="button" onClick={reload} data-testid="button-sim-retry">Reintentar</button></div>}

    {!overview.isLoading && !overview.isError && <>
      {view === 'overview' && <div className="sc-stack">
        <section className="sc-metrics" aria-label="Indicadores de campañas">
          <article><span className="sc-metric-icon"><Radio size={17} /></span><small>Campañas activas</small><strong>{campaigns.filter((item) => item.status === 'active').length}</strong><p>En curso ahora</p></article>
          <article><span className="sc-metric-icon teal"><Users size={17} /></span><small>Organizaciones</small><strong>{organizations.length}</strong><p>Disponibles en la red</p></article>
          <article><span className="sc-metric-icon amber"><ClipboardList size={17} /></span><small>Eventos pendientes</small><strong>{events.filter((item) => ['draft', 'proposed', 'approved', 'published'].includes(item.status)).length}</strong><p>En preparación, revisión o jornada</p></article>
          <article><span className="sc-metric-icon ink"><CheckCircle2 size={17} /></span><small>Eventos publicados</small><strong>{events.filter((item) => item.status === 'published').length}</strong><p>Visibles para alumnado</p></article>
        </section>
        <div className="sc-columns">
          <section className="sc-panel"><PanelTitle kicker="PORTAFOLIO" title="Campañas de la red" detail="Selección real del servicio de simulación."
            action={canCreate && <button className="sc-button primary" onClick={() => setView('create')} data-testid="button-sim-new-campaign"><Plus size={15} /> Diseñar campaña</button>} />
            {campaigns.length ? <div className="sc-campaign-list">{campaigns.map((item) => <article className={`sc-campaign-row ${selectedCampaign?.id === item.id ? 'selected' : ''}`} key={item.id} data-testid={`card-campaign-${item.id}`}>
              <button className="sc-campaign-select" onClick={() => setCampaignId(item.id)} data-testid={`button-select-campaign-${item.id}`}>
                <span className="sc-campaign-monogram">{item.ownerOrganizationName.slice(0, 2).toUpperCase()}</span>
                <span className="sc-campaign-copy"><small>{item.ownerOrganizationName} <i>·</i> {item.difficulty === 'low' ? 'Inicial' : item.difficulty === 'medium' ? 'Intermedio' : 'Avanzado'}</small><b>{item.title}</b><span>{item.durationWeeks} semanas · {item.eventCount} eventos · {dateText(item.startDate)}</span></span>
              </button><Status value={item.status} /><button className="sc-row-arrow" aria-label={`Seleccionar ${item.title}`} onClick={() => { setCampaignId(item.id); setView('queue'); }}><ChevronRight size={17} /></button>
            </article>)}</div> : <Empty title="Aún no hay campañas" detail="Cuando exista una campaña, aparecerá aquí con su estado y calendario." />}
          </section>
          <aside className="sc-side">
            <section className="sc-panel"><PanelTitle kicker="SELECCIÓN" title={selectedCampaign?.title ?? 'Sin campaña seleccionada'} detail={selectedCampaign?.description ?? 'Elige una campaña para consultar su actividad.'} />
              {selectedCampaign && <><div className="sc-detail-line"><span>Estado</span><Status value={selectedCampaign.status} /></div><div className="sc-detail-line"><span>Participantes</span><b>{participants(selectedCampaign).length}</b></div><div className="sc-detail-line"><span>Periodo</span><b>{dateText(selectedCampaign.startDate)} — {dateText(selectedCampaign.endDate)}</b></div>
                <div className="sc-chip-list">{participants(selectedCampaign).slice(0, 5).map((name) => <span key={name}>{name}</span>)}{participants(selectedCampaign).length > 5 && <span>+{participants(selectedCampaign).length - 5}</span>}</div>
              </>}
            </section>
            <section className="sc-note-card"><div><ShieldCheck size={16} /><span>Marco didáctico</span></div><p>Los casos representan situaciones de aprendizaje. No generan saldos, pedidos, contratos ni cambios contables.</p></section>
          </aside>
        </div>
      </div>}

      {view === 'create' && <section className="sc-panel sc-form-panel">
        <PanelTitle kicker="DISEÑO DE ESCENARIO" title="Crear campaña" detail="Define el marco común para una práctica entre empresas simuladas." />
        {!canCreate ? <Empty title="Acceso restringido" detail="La creación de campañas está disponible para responsables de equipo y docentes." /> :
          <form className="sc-form" onSubmit={submitCampaign} data-testid="form-sim-campaign">
            <div className="sc-form-grid">
              {canReview && <label className="sc-field"><span>Empresa responsable</span><select name="ownerOrganizationId" defaultValue={organizationId || organizations[0]?.id || ''} required data-testid="select-sim-owner-organization">{organizations.map((org) => <option key={org.id} value={org.id}>{org.name} · {org.center}</option>)}</select></label>}
              <label className="sc-field wide"><span>Nombre de campaña</span><input name="title" required minLength={3} maxLength={120} placeholder="Ej. Operación Atlántico: gestión de incidencias" data-testid="input-sim-campaign-title" /></label>
              <label className="sc-field"><span>Modalidad</span><select name="mode" defaultValue="supervised" data-testid="select-sim-mode"><option value="manual">Manual</option><option value="supervised">Supervisada</option><option value="autonomous">Autónoma</option></select></label>
              <label className="sc-field"><span>Dificultad</span><select name="difficulty" defaultValue="medium" data-testid="select-sim-difficulty"><option value="low">Inicial</option><option value="medium">Intermedia</option><option value="high">Avanzada</option></select></label>
              <label className="sc-field"><span>Duración · semanas</span><input name="durationWeeks" type="number" min="1" max="16" defaultValue="4" required data-testid="input-sim-duration" /></label>
              <label className="sc-field"><span>Inicio simulado</span><input name="startDate" type="date" min="2027-01-01" max="2028-12-31" defaultValue={today()} required data-testid="input-sim-start-date" /></label>
              <label className="sc-field wide"><span>Propósito didáctico</span><textarea name="description" required maxLength={1000} rows={4} placeholder="Describe los objetivos y el contexto del caso." data-testid="input-sim-description" /></label>
            </div>
            <div className="sc-participant-picker"><div><b>Organizaciones participantes</b><small>Selecciona al menos una organización ficticia de la red.</small></div>
              <div className="sc-org-checks">{organizations.map((org) => <label key={org.id}><input type="checkbox" name="participants" value={org.id} defaultChecked={org.id === organizationId} data-testid={`checkbox-sim-participant-${org.id}`} /><span><b>{org.name}</b><small>{org.center} · {org.island}</small></span></label>)}</div>
            </div>
            <div className="sc-info"><ShieldCheck size={16} /><span>La ayuda de contenido es una guía local, no contenido generado por IA. Las organizaciones y consecuencias son simuladas.</span></div>
            <div className="sc-form-actions"><button type="button" className="sc-button quiet" onClick={() => setView('overview')} data-testid="button-sim-cancel-create">Cancelar</button><button className="sc-button primary" type="submit" disabled={createCampaign.isPending} data-testid="button-sim-save-campaign">{createCampaign.isPending ? 'Guardando…' : 'Guardar borrador'} <ArrowRight size={15} /></button></div>
          </form>}
      </section>}

      {view === 'network' && <section className="sc-panel">
        <PanelTitle kicker="RED INTERCENTROS" title="Organizaciones participantes" detail="Directorio de organizaciones devuelto por el servicio; sin datos de personas." />
        <div className="sc-network-tools"><label className="sc-search"><span className="sr-only">Buscar organizaciones</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar organización, centro o isla…" data-testid="input-sim-org-search" /></label>
          <select aria-label="Filtrar por isla" value={islandFilter} onChange={(event) => setIslandFilter(event.target.value)} data-testid="select-sim-island"><option>Todas</option>{islands.map((island) => <option key={island}>{island}</option>)}</select></div>
        <div className="sc-island-strip" aria-label="Mapa esquemático del archipiélago">
          {['Lanzarote', 'Fuerteventura', 'Gran Canaria', 'Tenerife', 'La Gomera', 'La Palma', 'El Hierro', 'La Graciosa'].map((island, index) => <button type="button" key={island} className={`sc-island-node island-${index}`} onClick={() => setIslandFilter(island)} aria-label={`Filtrar organizaciones de ${island}`} data-testid={`button-island-${index}`}><i /><span>{island}</span></button>)}
        </div>
        <div className="sc-org-list">{filteredOrgs.length ? filteredOrgs.map((org, index) => <article key={org.id} data-testid={`row-sim-organization-${org.id}`}>
          <span className={`sc-org-number n-${index % 5}`}>{String(index + 1).padStart(2, '0')}</span><div><b>{org.name}</b><small>{org.center}</small></div><span className="sc-org-island"><MapPin size={13} />{org.island}</span>
        </article>) : <Empty title="Sin coincidencias" detail="Prueba con otra búsqueda o isla." />}</div>
        <div className="sc-footer-note">{filteredOrgs.length} organizaciones · directorio real de la simulación</div>
      </section>}

      {view === 'queue' && <section className="sc-panel">
        <PanelTitle kicker="TRAZABILIDAD DEL ESCENARIO" title="Cola de eventos" detail={selectedCampaign ? `Eventos asociados a ${selectedCampaign.title}.` : 'Selecciona una campaña desde el resumen.'}
          action={(canCreate || canReview) && selectedCampaign && <button className="sc-button primary" onClick={() => { setEventId(''); setEventType('service_incident'); setTemplate('incidencia'); setView('editor'); }} data-testid="button-sim-new-event"><Plus size={15} /> Proponer evento</button>} />
        <div className="sc-queue-toolbar"><label>Campaña<select value={selectedCampaign?.id ?? ''} onChange={(event) => setCampaignId(event.target.value)} aria-label="Seleccionar campaña" data-testid="select-sim-queue-campaign">{campaigns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label><span>{selectedCampaignEvents.length} eventos</span></div>
        {selectedCampaignEvents.length ? <div className="sc-event-list">{selectedCampaignEvents.map((item) => <article key={item.id} className="sc-event-row" data-testid={`card-sim-event-${item.id}`}>
          <span className="sc-event-date"><small>{dateText(item.simulatedDate).split(' ')[1] ?? '—'}</small><b>{dateText(item.simulatedDate).split(' ')[0]}</b></span>
          <div className="sc-event-copy"><div><b>{item.title}</b><Status value={item.status} event /></div><p>{item.description}</p><small>{organizationMap.get(item.organizationId)?.name ?? 'Organización'} · {eventTypes.find((type) => type.value === item.eventType)?.label ?? item.eventType}</small></div>
          <div className="sc-event-actions">{item.status === 'proposed' && canReview && <button type="button" className="sc-button mini" onClick={() => askAction('event', item.id, 'approve', 'Aprobar')} data-testid={`button-approve-event-${item.id}`}><Check size={14} /> Aprobar</button>}
            {item.status === 'approved' && canReview && campaigns.find((campaign) => campaign.id === item.campaignId)?.status === 'active' && <button type="button" className="sc-button mini primary" onClick={() => askAction('event', item.id, 'publish', 'Publicar')} data-testid={`button-publish-event-${item.id}`}><Radio size={14} /> Publicar</button>}
            {item.status === 'draft' && canCreate && (canReview || item.organizationId === organizationId) && <button type="button" className="sc-button mini" onClick={() => { setCampaignId(item.campaignId); setEventId(item.id); setEventType(item.eventType); setTemplate(item.eventType === 'offer' ? 'oferta' : 'incidencia'); setView('editor'); }} data-testid={`button-edit-event-${item.id}`}>Editar</button>}
            {item.status === 'draft' && identity.role === 'team_manager' && item.organizationId === organizationId && <button type="button" className="sc-button mini primary" onClick={() => askAction('event', item.id, 'submit', 'Volver a proponer')} data-testid={`button-resubmit-event-${item.id}`}>Volver a proponer</button>}
            {['proposed', 'approved'].includes(item.status) && canReview && <button type="button" className="sc-button mini quiet" onClick={() => askAction('event', item.id, 'return', 'Devolver')} data-testid={`button-return-event-${item.id}`}>Devolver</button>}
            {['draft', 'proposed', 'approved', 'published'].includes(item.status) && canReview && <button type="button" className="sc-button mini danger" onClick={() => askAction('event', item.id, 'cancel', 'Cancelar')} data-testid={`button-cancel-event-${item.id}`}>Cancelar</button>}
          </div>
        </article>)}</div> : <Empty title="Cola vacía" detail="Al proponer un caso, aparecerá aquí para su seguimiento." />}
      </section>}

      {view === 'editor' && <section className="sc-panel sc-form-panel">
        <PanelTitle kicker="CASO DIDÁCTICO" title={selectedEvent?.status === 'draft' ? 'Corregir evento devuelto' : 'Proponer un evento'} detail={selectedEvent?.status === 'draft' ? 'Actualiza el borrador y vuelve a proponerlo desde la cola.' : 'La propuesta queda vinculada a una campaña y organización de la red.'} />
        {(!canCreate && !canReview) ? <Empty title="Acceso restringido" detail="Solo responsables de equipo y supervisión pueden proponer casos." /> :
          <form className="sc-form" onSubmit={submitEvent} data-testid="form-sim-event">
            <div className="sc-template-bar"><span><BookOpen size={15} /> Guía local de composición</span><div><button type="button" className={template === 'incidencia' ? 'selected' : ''} onClick={() => setTemplate('incidencia')} data-testid="button-template-incident">Incidencia</button><button type="button" className={template === 'oferta' ? 'selected' : ''} onClick={() => setTemplate('oferta')} data-testid="button-template-offer">Oferta</button></div></div>
            <p className="sc-template-copy">{template === 'incidencia' ? 'Contexto, decisión requerida y evidencia documental sugerida.' : 'Necesidad del cliente, condiciones y respuesta comercial esperada.'} Esta orientación es una plantilla local, no una generación de IA.</p>
            <div className="sc-form-grid">
              <label className="sc-field wide"><span>Campaña</span><select value={selectedCampaign?.id ?? ''} onChange={(event) => setCampaignId(event.target.value)} required disabled={selectedEvent?.status === 'draft'} data-testid="select-sim-event-campaign">{campaigns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <label className="sc-field wide"><span>Título del evento</span><input name="title" defaultValue={selectedEvent?.status === 'draft' ? selectedEvent.title : ''} required minLength={3} maxLength={120} placeholder="Describe la situación en una frase" data-testid="input-sim-event-title" /></label>
              <label className="sc-field"><span>Tipo de caso</span><select name="eventType" value={eventType} onChange={(change) => { const value = change.target.value as Fp360SimulationEventEventType; setEventType(value); setTemplate(value === 'offer' ? 'oferta' : 'incidencia'); }} data-testid="select-sim-event-type">{eventTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
              <label className="sc-field"><span>Organización destinataria</span><select name="organizationId" defaultValue={selectedEvent?.status === 'draft' ? selectedEvent.organizationId : (organizationId && selectedCampaign?.participantOrganizationIds.includes(organizationId) ? organizationId : selectedCampaign?.participantOrganizationIds[0])} required disabled={selectedEvent?.status === 'draft'} data-testid="select-sim-event-org">{(selectedCampaign?.participantOrganizationIds ?? []).filter((id) => canReview || id === organizationId).map((id) => <option key={id} value={id}>{organizationMap.get(id)?.name ?? id}</option>)}</select></label>
              <label className="sc-field"><span>Fecha simulada</span><input name="simulatedDate" type="date" min={selectedCampaign?.startDate ?? '2027-01-01'} max={selectedCampaign?.endDate ?? '2028-12-31'} defaultValue={selectedEvent?.status === 'draft' ? selectedEvent.simulatedDate : today()} required data-testid="input-sim-event-date" /></label>
              <label className="sc-field"><span>Documento requerido · opcional</span><select name="requiredDocumentType" defaultValue={selectedEvent?.status === 'draft' ? selectedEvent.requiredDocumentType ?? '' : ''} data-testid="input-sim-event-document"><option value="">Sin requisito documental</option><option value="purchase_request">Solicitud de compra</option><option value="quote">Presupuesto</option><option value="purchase_order">Pedido</option><option value="delivery_note">Albarán</option><option value="invoice">Factura</option><option value="payment">Pago</option><option value="incident">Incidencia</option><option value="contract">Contrato</option><option value="project">Proyecto</option><option value="accounting">Contabilidad</option><option value="educational">Educativo</option><option value="other">Otro</option></select></label>
              <label className="sc-field wide"><span>Descripción del caso</span><textarea name="description" defaultValue={selectedEvent?.status === 'draft' ? selectedEvent.description : ''} required minLength={10} maxLength={2000} rows={5} placeholder="Explica el contexto y la decisión que tendrá que practicar el equipo." data-testid="input-sim-event-description" /></label>
              <label className="sc-field wide"><span>Precondiciones · una por línea</span><textarea name="preconditions" defaultValue={selectedEvent?.status === 'draft' ? selectedEvent.preconditions.join('\n') : ''} rows={3} placeholder="El equipo conoce el procedimiento aplicable&#10;El expediente simulado está disponible" data-testid="input-sim-event-preconditions" /></label>
            </div>
            <div className="sc-info"><ShieldCheck size={16} /><span>Los casos son educativos. No alteran saldos, stock, nóminas, impuestos, contabilidad, contratos ni organizaciones reales.</span></div>
            <div className="sc-form-actions"><button type="button" className="sc-button quiet" onClick={() => { setEventId(''); setView('queue'); }} data-testid="button-sim-cancel-event">Cancelar</button><button type="submit" className="sc-button primary" disabled={createEvent.isPending || updateEvent.isPending || !campaigns.length} data-testid="button-sim-save-event">{updateEvent.isPending ? 'Guardando…' : createEvent.isPending ? 'Enviando…' : selectedEvent?.status === 'draft' ? 'Guardar corrección' : 'Proponer a la cola'} <ArrowRight size={15} /></button></div>
          </form>}
      </section>}

      {view === 'student' && <div className="sc-stack">
        <section className="sc-student-banner"><div><span>JORNADA DE APRENDIZAJE</span><h2>{currentOrg?.name ?? 'Mi organización'}</h2><p>Solo se muestran eventos publicados para tu organización.</p></div><div className="sc-student-date"><CalendarDays size={17} /><span>{dateText(today())}</span></div></section>
        <section className="sc-panel"><PanelTitle kicker="AGENDA PUBLICADA" title="Actividades de campaña" detail={`${studentEvents.length} actividades publicadas o completadas para esta organización.`} />
          {studentEvents.length ? <div className="sc-student-events">{studentEvents.map((item, index) => {
            const available = evidenceDocuments(item);
            return <article key={item.id} data-testid={`student-event-${item.id}`}>
              <span className="sc-student-index">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <small>{dateText(item.simulatedDate)} · {eventTypes.find((type) => type.value === item.eventType)?.label ?? item.eventType}</small>
                <h3>{item.title}</h3><p>{item.description}</p>
                {item.preconditions.length > 0 && <details><summary>Preparación necesaria</summary><ul>{item.preconditions.map((condition, i) => <li key={`${item.id}-${i}`}>{condition}</li>)}</ul></details>}
                {item.requiredDocumentType && <span className="sc-required-document"><FileText size={13} /> Documento requerido: {item.requiredDocumentType}</span>}
                {item.status === 'completed' ? <div className="sc-student-evidence-confirmed"><CheckCircle2 size={15} /><span>Evidencia confirmada · {item.evidenceDocumentReference ?? 'Documento vinculado'}</span></div> : <>
                  {documentOverview.isLoading && <p className="sc-evidence-help">Cargando documentos confirmados…</p>}
                  {documentOverview.isError && <div className="sc-evidence-error"><span>No se pudo consultar la documentación de la organización.</span><button type="button" onClick={() => void documentOverview.refetch()}>Reintentar</button></div>}
                  {!documentOverview.isLoading && !documentOverview.isError && available.length > 0 && <div className="sc-student-evidence">
                    <label className="sc-field"><span>Documento ficticio confirmado</span><select value={evidenceSelection[item.id] ?? available[0]?.id ?? ''} onChange={(change) => setEvidenceSelection((selection) => ({ ...selection, [item.id]: change.target.value }))} data-testid={`select-sim-evidence-${item.id}`}>
                      {available.map((document) => <option key={document.id} value={document.id}>{document.reference} · {document.title}</option>)}
                    </select></label>
                    <button type="button" className="sc-button primary" onClick={() => submitEvidence(item)} disabled={linkEvidence.isPending} data-testid={`button-sim-complete-${item.id}`}>
                      {linkEvidence.isPending ? 'Registrando…' : 'Registrar evidencia'} <Check size={14} />
                    </button>
                  </div>}
                  {!documentOverview.isLoading && !documentOverview.isError && available.length === 0 && <p className="sc-evidence-help">Confirma un documento ficticio en Gestión documental{item.requiredDocumentType ? ` con tipo ${item.requiredDocumentType}` : ''} y vuelve para vincularlo.</p>}
                </>}
              </div>
              <Status value={item.status} event />
            </article>;
          })}</div> : <Empty title="La agenda está en calma" detail="Los eventos se mostrarán aquí cuando una persona supervisora los publique para tu organización." />}
        </section>
      </div>}

      {view === 'review' && <div className="sc-stack">
        {!canReview ? <section className="sc-panel"><Empty title="Vista de supervisión" detail="La revisión de campañas y eventos está reservada a docentes y administradores." /></section> : <>
          <section className="sc-panel"><PanelTitle kicker="VALIDACIÓN DEL ESCENARIO" title="Campañas pendientes" detail="Revisa alcance y participantes antes de iniciar la práctica." />
            {campaigns.filter((item) => item.status === 'review').length ? <div className="sc-review-list">{campaigns.filter((item) => item.status === 'review').map((item) => <article key={item.id} data-testid={`review-campaign-${item.id}`}><div><span className="sc-review-kind">CAMPAÑA · {item.ownerOrganizationName}</span><h3>{item.title}</h3><p>{item.description}</p><small>{participants(item).join(' · ')} · {item.durationWeeks} semanas</small></div><div className="sc-review-actions"><button className="sc-button primary" onClick={() => askAction('campaign', item.id, 'approve', 'Aprobar')} data-testid={`button-review-approve-${item.id}`}><Check size={14} /> Aprobar</button><button className="sc-button quiet" onClick={() => askAction('campaign', item.id, 'reject', 'Devolver')} data-testid={`button-review-reject-${item.id}`}>Devolver</button></div></article>)}</div> : <Empty title="Sin campañas pendientes" detail="Las campañas enviadas a revisión aparecerán aquí." />}
          </section>
          <section className="sc-panel"><PanelTitle kicker="REVISIÓN DE CASOS" title="Eventos pendientes" detail="Aprueba una propuesta y publícala para que llegue a su jornada." />
            {events.filter((item) => item.status === 'proposed').length ? <div className="sc-review-list">{events.filter((item) => item.status === 'proposed').map((item) => <article key={item.id} data-testid={`review-event-${item.id}`}><div><span className="sc-review-kind">EVENTO · {organizationMap.get(item.organizationId)?.name ?? 'Organización'}</span><h3>{item.title}</h3><p>{item.description}</p><small>{dateText(item.simulatedDate)} · {campaigns.find((campaign) => campaign.id === item.campaignId)?.title}</small></div><div className="sc-review-actions"><button className="sc-button primary" onClick={() => askAction('event', item.id, 'approve', 'Aprobar')} data-testid={`button-review-event-approve-${item.id}`}><Check size={14} /> Aprobar</button><button className="sc-button quiet" onClick={() => askAction('event', item.id, 'return', 'Devolver')} data-testid={`button-review-event-return-${item.id}`}>Devolver</button></div></article>)}</div> : <Empty title="Sin eventos por revisar" detail="Las propuestas nuevas estarán disponibles aquí." />}
          </section>
        </>}
      </div>}

      {view === 'analytics' && <div className="sc-stack">
        <section className="sc-panel"><PanelTitle kicker="CIERRE DE CAMPAÑA" title="Lectura y cierre" detail="Resumen derivado únicamente de campañas y eventos disponibles; no es una evaluación académica." />
          <div className="sc-analytics-grid"><article><small>Eventos publicados</small><strong>{events.filter((item) => item.status === 'published').length}</strong><span>Visibles en jornadas</span></article><article><small>Actividades completadas</small><strong>{events.filter((item) => item.status === 'completed').length}</strong><span>Con evidencia documental</span></article><article><small>Propuestas pendientes</small><strong>{events.filter((item) => ['proposed', 'draft'].includes(item.status)).length}</strong><span>Requieren corrección o revisión</span></article><article><small>Campañas cerradas</small><strong>{campaigns.filter((item) => item.status === 'closed').length}</strong><span>Cierre registrado</span></article></div>
          <div className="sc-close-list">{campaigns.map((item) => {
            const unfinishedEvents = events.filter((event) => event.campaignId === item.id && ['draft', 'proposed', 'approved', 'published'].includes(event.status)).length;
            return <article key={item.id} data-testid={`close-campaign-${item.id}`}><div><b>{item.title}</b><small>{item.ownerOrganizationName} · {item.eventCount} eventos · {participants(item).length} organizaciones{unfinishedEvents ? ` · ${unfinishedEvents} pendientes` : ''}</small></div><Status value={item.status} />
            {canReview && item.status === 'active' && <button className="sc-button mini quiet" onClick={() => askAction('campaign', item.id, 'pause', 'Pausar')} data-testid={`button-pause-campaign-${item.id}`}><Pause size={13} /> Pausar</button>}
            {canReview && item.status === 'paused' && <button className="sc-button mini" onClick={() => askAction('campaign', item.id, 'start', 'Reanudar')} data-testid={`button-start-campaign-${item.id}`}><Play size={13} /> Reanudar</button>}
            {canReview && ['active', 'paused'].includes(item.status) && <button className="sc-button mini danger" disabled={unfinishedEvents > 0} title={unfinishedEvents ? 'Completa o cancela primero las actividades pendientes.' : undefined} onClick={() => askAction('campaign', item.id, 'close', 'Cerrar')} data-testid={`button-close-campaign-${item.id}`}>Cerrar</button>}
            {canCreate && item.ownerOrganizationId === organizationId && item.status === 'draft' && <button className="sc-button mini" onClick={() => askAction('campaign', item.id, 'submit', 'Enviar a revisión')} data-testid={`button-submit-campaign-${item.id}`}>Enviar a revisión <ArrowRight size={13} /></button>}
            {canReview && item.status === 'approved' && <button className="sc-button mini primary" onClick={() => askAction('campaign', item.id, 'start', 'Iniciar')} data-testid={`button-start-approved-campaign-${item.id}`}><Play size={13} /> Iniciar</button>}
          </article>;
          })}</div>
          {!campaigns.length && <Empty title="Sin actividad para resumir" detail="El seguimiento aparecerá cuando se creen campañas y eventos." />}
          <div className="sc-info"><Clock3 size={16} /><span>El cierre cambia únicamente el estado de la campaña dentro del módulo de simulación. No se archivan ni modifican datos de otros módulos.</span></div>
        </section>
      </div>}
    </>}

    {pendingAction && <div className="sc-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingAction(null); }}>
      <section className="sc-modal" role="dialog" aria-modal="true" aria-labelledby="sc-modal-heading">
        <header><div><span>ACCIÓN DE SUPERVISIÓN</span><h2 id="sc-modal-heading">{pendingAction.label}</h2></div><button type="button" aria-label="Cerrar diálogo" onClick={() => setPendingAction(null)} data-testid="button-sim-action-close"><X size={18} /></button></header>
        <p>Esta acción actualizará el estado del elemento en la simulación y quedará sujeta a los permisos del servicio.</p>
        <label className="sc-field"><span>{pendingAction.kind === 'event' && pendingAction.action === 'cancel' && events.find((item) => item.id === pendingAction.id)?.status === 'published' ? 'Motivo obligatorio' : 'Nota opcional'}</span><textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} maxLength={500} rows={3} placeholder="Añade una indicación para el equipo." data-testid="input-sim-action-note" /></label>
        <div className="sc-form-actions"><button className="sc-button quiet" onClick={() => setPendingAction(null)} data-testid="button-sim-action-cancel">Cancelar</button><button className="sc-button primary" onClick={confirmAction} disabled={campaignAction.isPending || eventAction.isPending} data-testid="button-sim-action-confirm">{campaignAction.isPending || eventAction.isPending ? 'Procesando…' : 'Confirmar'} <Check size={14} /></button></div>
      </section>
    </div>}
    {selectedEvent && <span className="sr-only" data-testid="selected-event-status">{selectedEvent.title} · {eventStatus[selectedEvent.status]}</span>}
  </main>;
}

export default SimulationCampaignsPage;

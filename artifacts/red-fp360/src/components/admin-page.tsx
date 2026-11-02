import { type FormEvent, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, Archive, BadgeCheck, Building2, CheckCircle2, ChevronRight, CircleAlert, Copy,
  Clock3, Database, FileClock, Gauge, History, KeyRound, Layers3, Lock, MailPlus, Network,
  Plus, RefreshCw, Search, Server, Shield, ShieldAlert, ShieldCheck, SlidersHorizontal,
  UserCog, Users, X,
} from 'lucide-react';
import {
  getGetAdminSystemOverviewQueryKey, getListAdminAuditQueryKey, getListAdminInvitationsQueryKey,
  getListAdminPrivilegeRequestsQueryKey, getListAdminUsersQueryKey, useActOnAdminOrganization,
  useActOnAdminPrivilegeRequest, useCheckAdminIntegration, useCreateAdminBackupExercise,
  useCreateAdminInvitation, useCreateAdminOrganization, useCreateAdminPrivilegeRequest,
  useCreateAdminScenarioVersion, useEvaluateAdminPolicy, useGetAdminSystemOverview, useListAdminGroqAiModels,
  useListAdminAudit, useListAdminInvitations, useListAdminPrivilegeRequests, useListAdminUsers,
  useRevokeAdminInvitation, useTestAdminAiCoordinatorConnection, useUpdateAdminAiCoordinatorSettings,
  useUpdateAdminUser,
} from '@workspace/api-client-react';
import type { AccessRole, AdminPolicyPermission, AdminSystemOverview, AuthIdentity, IssuedInvitation, ManagedUser } from '@workspace/api-client-react';
import { ROLE_OPTIONS, accessRoleLabel, dateTime, httpStatus } from './admin-shared';
import './admin-page.css';
import './admin-ai.css';
import { AdminAiDelegations } from './admin-ai-delegations';

type View = 'health' | 'organizations' | 'users' | 'policies' | 'scenario' | 'security' | 'recovery' | 'integrations';
const views: { id: View; label: string; icon: typeof Activity; eyebrow: string; title: string; intro: string }[] = [
  { id: 'health', label: 'Estado del sistema', icon: Gauge, eyebrow: '01 · OBSERVABILIDAD', title: 'Estado del sistema', intro: 'Salud y capacidad del entorno de aprendizaje RED FP360.' },
  { id: 'organizations', label: 'Centros y empresas', icon: Building2, eyebrow: '02 · RED MULTICENTRO', title: 'Centros y empresas', intro: 'Control de organizaciones participantes. Suspender conserva todos sus datos.' },
  { id: 'users', label: 'Usuarios y roles', icon: Users, eyebrow: '03 · IDENTIDADES', title: 'Usuarios y roles', intro: 'Revisa cuentas, invitaciones y solicitudes de privilegios con trazabilidad.' },
  { id: 'policies', label: 'Políticas', icon: KeyRound, eyebrow: '04 · AUTORIZACIÓN', title: 'Políticas y permisos', intro: 'Consulta la matriz y evalúa permisos sin modificar la autorización activa.' },
  { id: 'scenario', label: 'Escenario', icon: SlidersHorizontal, eyebrow: '05 · CONFIGURACIÓN', title: 'Configuración del escenario', intro: 'Publica una nueva versión de parámetros. Las versiones anteriores permanecen intactas.' },
  { id: 'security', label: 'Auditoría y seguridad', icon: FileClock, eyebrow: '06 · TRAZABILIDAD', title: 'Auditoría y seguridad', intro: 'Registro de acciones de acceso y solicitudes sensibles.' },
  { id: 'recovery', label: 'Respaldo y recuperación', icon: Database, eyebrow: '07 · PREPARACIÓN', title: 'Respaldo y recuperación', intro: 'Ensayos de preparación basados únicamente en recuentos de datos.' },
  { id: 'integrations', label: 'Integraciones', icon: Network, eyebrow: '08 · CONECTIVIDAD', title: 'Integraciones y despliegue', intro: 'Comprueba estados simulados sin conectar servicios externos ni manejar credenciales.' },
];
const permissionLabels: Record<string, string> = {
  system_admin: 'Administración del sistema', network_admin: 'Administrar la red',
  manage_center_accounts: 'Gestionar cuentas del centro', manage_scenario_settings: 'Configurar escenarios',
  run_backup_exercise: 'Realizar ensayo de respaldo', manage_intercenter_campaigns: 'Coordinar campañas intercentros',
  manage_company_operations: 'Gestionar operaciones de empresa', work_assigned_cases: 'Atender casos asignados',
};
const stateNames: Record<string, string> = { pending: 'Pendiente de revisión', approved: 'Aprobada', rejected: 'Rechazada', accepted: 'Aceptada', revoked: 'Revocada', expired: 'Caducada', verified: 'Ensayo registrado', attention: 'Revisión necesaria', not_configured: 'No configurada', simulation_only: 'Solo simulación' };
const readable = (v?: string) => stateNames[v ?? ''] ?? v ?? 'Sin estado';
const privilegeLabel = (type: string) => type === 'promote_user' ? 'Promoción a administración' : type === 'deactivate_administrator' ? 'Baja de administración' : 'Invitación administrativa';
const auditLabel = (action: string) => ({
  'invitation.created': 'Invitación creada',
  'invitation.revoked': 'Invitación revocada',
  'invitation.accepted': 'Invitación aceptada',
  'invitation.accepted_existing': 'Cuenta existente aceptó la invitación',
  'membership.created_by_invitation': 'Pertenencia creada por invitación',
  'membership.left': 'Pertenencia abandonada por su titular',
  'invitation.rejected': 'Invitación rechazada',
  'user.updated': 'Usuario actualizado',
  'organization.created': 'Organización creada',
  'organization.activate': 'Organización activada',
  'organization.suspend': 'Organización suspendida',
  'organization.archive': 'Organización archivada',
  'privilege.requested': 'Solicitud de privilegio creada',
  'privilege.approve': 'Solicitud de privilegio aprobada',
  'privilege.reject': 'Solicitud de privilegio rechazada',
  'mfa.enabled': 'MFA configurado',
  'mfa.verified': 'MFA verificado',
  'mfa.recovery_code.used': 'Código de recuperación usado',
  'scenario.version.created': 'Versión de escenario añadida',
  'backup.exercise.created': 'Ensayo de preparación registrado',
} as Record<string, string>)[action] ?? (action.startsWith('integration.check.') ? 'Comprobación de integración simulada' : action);
const newOperationId = () => crypto.randomUUID();
const bytes = (n?: number) => n == null ? '—' : n < 1_000_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${(n / 1_000_000_000).toFixed(2)} GB`;
const roleNames = ['buyer', 'supplier', 'both'] as const;

function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' | 'blue' }) {
  return <span className={`ac-badge ac-${tone}`}><i aria-hidden="true" />{children}</span>;
}
function Notice({ kind, children, onClose }: { kind: 'success' | 'error' | 'info'; children: React.ReactNode; onClose?: () => void }) {
  const Icon = kind === 'success' ? CheckCircle2 : kind === 'error' ? CircleAlert : ShieldAlert;
  return <div className={`ac-notice ac-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}><Icon size={17} /><span>{children}</span>{onClose && <button onClick={onClose} aria-label="Cerrar aviso"><X size={15} /></button>}</div>;
}
function LoadState({ loading, error, retry, empty, children }: { loading: boolean; error: boolean; retry?: () => void; empty?: boolean; children?: React.ReactNode }) {
  if (loading) return <div className="ac-skeleton" aria-label="Cargando"><span /><span /><span /></div>;
  if (error) return <Notice kind="error">No se pudieron cargar los datos. <button className="ac-inline" onClick={retry}>Reintentar</button></Notice>;
  if (empty) return <div className="ac-empty"><span><Layers3 size={19} /></span><b>No hay registros todavía</b><p>Los elementos que se generen aparecerán aquí.</p></div>;
  return <>{children}</>;
}
function Panel({ title, note, action, children }: { title: string; note?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="ac-panel"><header className="ac-panel-head"><div><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</header>{children}</section>;
}
function Metric({ label, value, note, icon: Icon }: { label: string; value: string | number; note: string; icon: typeof Activity }) {
  return <article className="ac-metric"><span className="ac-metric-icon"><Icon size={17} /></span><div><small>{label}</small><strong>{value}</strong><span>{note}</span></div></article>;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="ac-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) close(); }} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
    <section className="ac-modal" role="dialog" aria-modal="true" aria-labelledby="ac-modal-title"><header><h2 id="ac-modal-title">{title}</h2><button className="ac-icon-button" onClick={close} aria-label="Cerrar"><X size={17} /></button></header>{children}</section>
  </div>;
}
function AdminTable({ children, min = 700 }: { children: React.ReactNode; min?: number }) {
  return <div className="ac-table-wrap"><table style={{ minWidth: min }}>{children}</table></div>;
}
function explainMutation(error: unknown, fallback: string) {
  const status = httpStatus(error);
  if (status === 403) return 'Acción no permitida para este perfil.';
  if (status === 409) return 'El estado ha cambiado. Actualiza los datos antes de continuar.';
  if (status === 400 || status === 422) return 'Revisa los datos introducidos e inténtalo de nuevo.';
  return fallback;
}
function explainApiMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
      return data.message;
    }
  }
  return fallback;
}

export function AdminAccessDenied() {
  return <main className="page-content"><section className="ac-denied" role="alert"><Lock size={24} /><h1>Acceso restringido</h1><p>Esta consola solo está disponible para perfiles de administración. Contacta con la persona responsable de tu centro.</p></section></main>;
}

export function AdminPage({ identity }: { identity: AuthIdentity }) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('health');
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const overview = useGetAdminSystemOverview();
  const refreshOverview = () => void qc.invalidateQueries({ queryKey: getGetAdminSystemOverviewQueryKey() });
  const refreshUsers = () => { void qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() }); void qc.invalidateQueries({ queryKey: getListAdminInvitationsQueryKey() }); void qc.invalidateQueries({ queryKey: getListAdminAuditQueryKey() }); refreshOverview(); };
  const header = views.find(v => v.id === view)!;
  const o = overview.data;
  return <main className="page-content admin-console">
    <div className="ac-breadcrumb"><span>RED FP360</span><b>/</b><span>ADMINISTRACIÓN DEL SISTEMA</span><i>Consola de administración</i></div>
    <header className="ac-heading">
      <div><div className="ac-kicker"><span className="ac-live-dot" />ENTORNO EDUCATIVO · CONTROL ADMINISTRATIVO</div><h1>{header.title}</h1><p>{header.intro}</p></div>
      <div className="ac-heading-side"><span className="ac-brand-chip"><ShieldCheck size={15} /> RED FP360</span><small>Sesión administrativa</small><b>{identity.displayName}</b></div>
    </header>
    <div className="ac-simulation"><ShieldAlert size={16} /><span><b>Entorno de formación simulado</b> · Los ensayos registran actividad didáctica. No se ejecutan operaciones reales de infraestructura.</span><span className="ac-sim-tag">SIMULACIÓN</span></div>
    {notice && <Notice kind={notice.kind} onClose={() => setNotice(null)}>{notice.text}</Notice>}
    <div className="ac-workspace">
      <nav className="ac-nav" aria-label="Vistas de administración">
        <div className="ac-nav-caption">CONTROL DEL SISTEMA</div>
        {views.map(({ id, label, icon: Icon }, i) => <button key={id} onClick={() => { setView(id); setNotice(null); }} aria-current={view === id ? 'page' : undefined} className={view === id ? 'active' : ''}><span className="ac-nav-number">{String(i + 1).padStart(2, '0')}</span><Icon size={16} /><span>{label}</span><ChevronRight size={14} className="ac-chevron" /></button>)}
        <div className="ac-nav-foot"><span><Lock size={13} /> Acceso restringido</span><small>Solo administradores</small></div>
      </nav>
      <div className="ac-content">
        <div className="ac-view-title"><div><span>{header.eyebrow}</span><h2>{header.title}</h2></div><button className="ac-refresh" onClick={() => void overview.refetch()}><RefreshCw size={14} /> Actualizar</button></div>
        <LoadState loading={overview.isLoading} error={overview.isError} retry={() => void overview.refetch()} />
        {o && <>
          {view === 'health' && <HealthView data={o} refresh={() => void overview.refetch()} />}
          {view === 'organizations' && <OrganizationsView data={o} done={(t, k) => { setNotice({ text: t, kind: k }); if (k === 'success') refreshOverview(); }} />}
          {view === 'users' && <UsersView identity={identity} done={(t, k) => { setNotice({ text: t, kind: k }); if (k === 'success') refreshUsers(); }} />}
          {view === 'policies' && <PoliciesView data={o} />}
          {view === 'scenario' && <ScenarioView data={o} done={(t, k) => { setNotice({ text: t, kind: k }); if (k === 'success') refreshOverview(); }} />}
          {view === 'security' && <SecurityView identity={identity} />}
          {view === 'recovery' && <RecoveryView data={o} done={(t, k) => { setNotice({ text: t, kind: k }); if (k === 'success') refreshOverview(); }} />}
          {view === 'integrations' && <IntegrationsView data={o} done={(t, k) => { setNotice({ text: t, kind: k }); if (k === 'success') refreshOverview(); }} />}
        </>}
        <footer className="ac-footnote"><span>RED FP360 · Administración del sistema</span><span>Acciones auditables <i>·</i> Sin operaciones reales</span></footer>
      </div>
    </div>
  </main>;
}

function HealthView({ data, refresh }: { data: AdminSystemOverview; refresh: () => void }) {
  const h = data.health;
  const systemGood = ['ok', 'healthy', 'connected', 'up'].includes(h.apiStatus.toLowerCase()) && ['ok', 'healthy', 'connected', 'up'].includes(h.databaseStatus.toLowerCase());
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), mins = Math.floor(seconds % 3600 / 60);
    return `${days} d ${hours} h ${mins} min`;
  };
  return <div className="ac-stack">
    <div className={`ac-health-banner ${systemGood ? 'is-good' : 'is-check'}`}><div className="ac-health-mark"><Activity size={20} /></div><div><small>LECTURA MÁS RECIENTE · {dateTime(h.checkedAt)}</small><h3>{systemGood ? 'Servicios disponibles' : 'Revisión de estado necesaria'}</h3><p>Indicadores informativos del entorno de aplicación.</p></div><Badge tone={systemGood ? 'good' : 'warn'}>{systemGood ? 'Operativo' : 'Comprobar estado'}</Badge></div>
    <div className="ac-metrics-grid"><Metric label="Organizaciones" value={data.counts.activeOrganizations} note={`${data.counts.organizations} registradas`} icon={Building2} /><Metric label="Cuentas activas" value={data.counts.activeUsers} note={`${data.counts.users} cuentas totales`} icon={Users} /><Metric label="Versiones de escenario" value={data.counts.scenarioVersions} note="Configuración versionada" icon={Layers3} /><Metric label="Eventos de auditoría" value={data.counts.auditEvents} note="Eventos registrados" icon={History} /></div>
    <div className="ac-grid-two">
      <Panel title="Servicios de aplicación" note="Señales observadas; no equivalen a un SLA."><div className="ac-service-row"><span className="ac-service-icon"><Server size={16} /></span><div><b>API RED FP360</b><small>Servicio de aplicación</small></div><Badge tone={systemGood ? 'good' : 'warn'}>{readable(h.apiStatus)}</Badge></div><div className="ac-service-row"><span className="ac-service-icon"><Database size={16} /></span><div><b>Almacenamiento de datos</b><small>Estado informado por la aplicación</small></div><Badge tone={systemGood ? 'good' : 'warn'}>{readable(h.databaseStatus)}</Badge></div></Panel>
      <Panel title="Recursos del proceso" note="Uso actual reportado por el entorno."><div className="ac-resource"><div><span>Memoria residente</span><b>{bytes(h.memoryRssBytes)}</b></div><div className="ac-bar"><i style={{ width: `${h.memoryRssBytes ? Math.min(100, h.memoryRssBytes / Math.max(h.memoryRssBytes + h.heapTotalBytes, 1) * 100) : 0}%` }} /></div></div><div className="ac-resource"><div><span>Heap utilizado / asignado</span><b>{bytes(h.heapUsedBytes)} <small>/ {bytes(h.heapTotalBytes)}</small></b></div><div className="ac-bar"><i style={{ width: `${h.heapTotalBytes ? Math.min(100, h.heapUsedBytes / h.heapTotalBytes * 100) : 0}%` }} /></div></div><div className="ac-uptime"><Clock3 size={15} /> Tiempo activo del proceso <b>{formatUptime(h.uptimeSeconds)}</b></div></Panel>
    </div>
    <Panel title="Alcance de esta vista" note="Información operativa, no una consola de infraestructura."><div className="ac-callout"><Shield size={16} /><p>Estos datos describen el proceso y los registros de RED FP360. No permiten operar servidores, redes ni bases de datos.</p><button className="ac-inline" onClick={refresh}>Volver a consultar</button></div></Panel>
  </div>;
}

function OrganizationsView({ data, done }: { data: AdminSystemOverview; done: (t: string, k: 'success' | 'error') => void }) {
  const create = useCreateAdminOrganization(), act = useActOnAdminOrganization();
  const [search, setSearch] = useState(''), [creating, setCreating] = useState(false), [confirm, setConfirm] = useState<{ id: string; name: string; action: 'suspend' | 'archive' } | null>(null);
  const [formError, setFormError] = useState('');
  const [name, setName] = useState(''), [center, setCenter] = useState(''), [island, setIsland] = useState('Tenerife'), [role, setRole] = useState<(typeof roleNames)[number]>('both');
  const rows = useMemo(() => data.organizations.filter(x => `${x.name} ${x.center} ${x.island}`.toLowerCase().includes(search.toLowerCase())), [data.organizations, search]);
  const submit = (e: FormEvent) => { e.preventDefault(); setFormError(''); create.mutate({ data: { operationId: newOperationId(), name: name.trim(), center: center.trim(), island, role } }, { onSuccess: () => { setCreating(false); setName(''); setCenter(''); done('Organización añadida a la red.', 'success'); }, onError: err => setFormError(explainMutation(err, 'No se pudo crear la organización.')) }); };
  const perform = (action: 'activate' | 'suspend' | 'archive', id: string) => act.mutate({ id, data: { operationId: newOperationId(), action, note: action === 'activate' ? 'Reactivación solicitada desde administración.' : `Acción de ${action === 'suspend' ? 'suspensión' : 'archivo'} confirmada desde administración.` } }, { onSuccess: () => { setConfirm(null); done(`Organización ${action === 'activate' ? 'activada' : action === 'suspend' ? 'suspendida' : 'archivada'}; los datos se conservan.`, 'success'); }, onError: err => { setConfirm(null); done(explainMutation(err, 'No se pudo actualizar la organización.'), 'error'); } });
  return <div className="ac-stack"><div className="ac-metrics-grid ac-metrics-three"><Metric label="Organizaciones" value={data.counts.organizations} note="En el registro de red" icon={Building2} /><Metric label="Activas" value={data.counts.activeOrganizations} note="Participación habilitada" icon={BadgeCheck} /><Metric label="Suspendidas / archivadas" value={data.organizations.length - data.organizations.filter(x => x.isActive).length} note="Conservan el historial" icon={Archive} /></div>
    <Panel title="Registro de organizaciones" note="No hay acción de borrado de datos." action={<button className="ac-button ac-primary" onClick={() => setCreating(true)}><Plus size={15} /> Añadir organización</button>}>
      <div className="ac-toolbar"><label className="ac-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar centro, empresa o isla" aria-label="Buscar organizaciones" /></label><span>{rows.length} resultados</span></div>
      <AdminTable min={760}><thead><tr><th>Organización</th><th>Centro</th><th>Isla</th><th>Tipo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{rows.map(org => <tr key={org.id}><td><b>{org.name}</b><small className="ac-sub">{org.id.slice(0, 8)}</small></td><td>{org.center}</td><td>{org.island}</td><td>{org.role === 'buyer' ? 'Compradora' : org.role === 'supplier' ? 'Proveedora' : 'Compradora y proveedora'}</td><td><Badge tone={org.isActive ? 'good' : 'warn'}>{org.isActive ? 'Activa' : 'Inactiva'}</Badge></td><td>{org.isActive ? <div className="ac-actions"><button className="ac-text-danger" onClick={() => setConfirm({ id: org.id, name: org.name, action: 'suspend' })}>Suspender</button><button className="ac-text-muted" onClick={() => setConfirm({ id: org.id, name: org.name, action: 'archive' })}>Archivar</button></div> : <button className="ac-text-link" onClick={() => perform('activate', org.id)}>Activar</button>}</td></tr>)}{!rows.length && <tr><td colSpan={6}><div className="ac-empty"><b>Sin coincidencias</b><p>Ajusta la búsqueda o crea una organización.</p></div></td></tr>}</tbody></AdminTable>
    </Panel>
    {creating && <Modal title="Añadir organización" close={() => setCreating(false)}><form className="ac-form" onSubmit={submit}><p>La organización quedará registrada en la red simulada.</p><label>Nombre de la empresa<input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label><label>Centro educativo<input required minLength={2} maxLength={120} value={center} onChange={e => setCenter(e.target.value)} /></label><label>Isla<input required minLength={2} maxLength={60} value={island} onChange={e => setIsland(e.target.value)} /></label><label>Participación<select value={role} onChange={e => setRole(e.target.value as typeof role)}><option value="buyer">Compradora</option><option value="supplier">Proveedora</option><option value="both">Compradora y proveedora</option></select></label>{formError && <Notice kind="error">{formError}</Notice>}<div className="ac-form-actions"><button type="button" className="ac-button" onClick={() => setCreating(false)}>Cancelar</button><button disabled={create.isPending} className="ac-button ac-primary">{create.isPending ? 'Guardando…' : 'Crear organización'}</button></div></form></Modal>}
    {confirm && <Modal title={confirm.action === 'suspend' ? 'Confirmar suspensión' : 'Confirmar archivo'} close={() => setConfirm(null)}><div className="ac-form"><div className="ac-confirm"><CircleAlert size={19} /><p><b>{confirm.name}</b> quedará {confirm.action === 'suspend' ? 'suspendida' : 'archivada'}. No se borran cuentas, documentos ni historial.</p></div><label>Nota de auditoría<input required minLength={5} maxLength={300} defaultValue={`Confirmación de ${confirm.action} desde consola administrativa.`} id="org-action-note" /></label><div className="ac-form-actions"><button className="ac-button" onClick={() => setConfirm(null)}>Cancelar</button><button className="ac-button ac-danger" disabled={act.isPending} onClick={() => { const note = (document.getElementById('org-action-note') as HTMLInputElement)?.value; if (note?.trim().length >= 5) act.mutate({ id: confirm.id, data: { operationId: newOperationId(), action: confirm.action, note: note.trim() } }, { onSuccess: () => { setConfirm(null); done(`Organización ${confirm.action === 'suspend' ? 'suspendida' : 'archivada'}; sus datos se conservan.`, 'success'); }, onError: e => { setConfirm(null); done(explainMutation(e, 'No se pudo completar la acción.'), 'error'); } }); }}>{act.isPending ? 'Procesando…' : `Confirmar ${confirm.action === 'suspend' ? 'suspensión' : 'archivo'}`}</button></div></div></Modal>}
  </div>;
}

function UsersView({ identity, done }: { identity: AuthIdentity; done: (t: string, k: 'success' | 'error') => void }) {
  const qc = useQueryClient();
  const users = useListAdminUsers(), invitations = useListAdminInvitations(), requests = useListAdminPrivilegeRequests();
  const update = useUpdateAdminUser(), invite = useCreateAdminInvitation(), revoke = useRevokeAdminInvitation(), request = useCreateAdminPrivilegeRequest();
  const decide = useActOnAdminPrivilegeRequest();
  const [search, setSearch] = useState(''), [editing, setEditing] = useState<ManagedUser | null>(null), [creating, setCreating] = useState(false), [email, setEmail] = useState(''), [role, setRole] = useState<AccessRole>('student'), [formError, setFormError] = useState('');
  const [issued, setIssued] = useState<IssuedInvitation | null>(null), [copied, setCopied] = useState(false);
  const [orgId, setOrgId] = useState(''), [decision, setDecision] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null);
  const [adminInviteToken, setAdminInviteToken] = useState<string | null>(null), [adminInviteCopied, setAdminInviteCopied] = useState(false);
  const orgs = useGetAdminSystemOverview();
  const rows = (users.data ?? []).filter(u => `${u.displayName} ${u.email} ${accessRoleLabel(u.role)}`.toLowerCase().includes(search.toLowerCase()));
  const complete = () => {
    void users.refetch(); void invitations.refetch(); void requests.refetch(); void orgs.refetch();
    void qc.invalidateQueries({ queryKey: getListAdminPrivilegeRequestsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminAuditQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetAdminSystemOverviewQueryKey() });
  };
  const sendInvite = (e: FormEvent) => {
    e.preventDefault(); setFormError('');
    if (role === 'administrator') {
      request.mutate({ data: { operationId: newOperationId(), requestType: 'invite_administrator', email: email.trim(), organizationId: orgId || null } }, {
        onSuccess: () => { setCreating(false); setEmail(''); done('Solicitud de invitación administrativa enviada para aprobación independiente.', 'success'); complete(); },
        onError: err => setFormError(explainMutation(err, 'No se pudo crear la solicitud.')),
      }); return;
    }
    invite.mutate({ data: { email: email.trim(), role, ...(orgId ? { organizationId: orgId } : {}) } }, {
      onSuccess: result => { setCreating(false); setEmail(''); setIssued(result); setCopied(false); done('Invitación creada. El enlace está disponible solo en esta ventana.', 'success'); complete(); },
      onError: err => setFormError(explainMutation(err, 'No se pudo crear la invitación.')),
    });
  };
  return <div className="ac-stack">
    <Panel title="Cuentas registradas" note="La propia cuenta no puede ser desactivada ni cambiar de rol." action={<button className="ac-button ac-primary" onClick={() => { setFormError(''); setCreating(true); }}><MailPlus size={15} /> Nueva invitación</button>}>
      <div className="ac-toolbar"><label className="ac-search"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nombre, correo o rol" aria-label="Buscar usuarios" /></label><span>{users.data?.length ?? '—'} cuentas</span></div>
      <LoadState loading={users.isLoading} error={users.isError} retry={() => void users.refetch()} />
      {users.data && <AdminTable min={900}><thead><tr><th>Persona</th><th>Rol</th><th>Organización</th><th>Estado</th><th>MFA</th><th>Alta</th><th></th></tr></thead><tbody>{rows.map(u => {
        const promotionPending = requests.data?.some(r => r.requestType === 'promote_user' && r.targetUserId === u.id && r.status === 'pending');
        const deactivationPending = requests.data?.some(r => r.requestType === 'deactivate_administrator' && r.targetUserId === u.id && r.status === 'pending');
        return <tr key={u.id}><td><b>{u.displayName}{u.id === identity.id && <em className="ac-you">Tú</em>}</b><small className="ac-sub">{u.email}</small></td><td>{accessRoleLabel(u.role)}</td><td>{orgs.data?.organizations.find(o => o.id === u.organizationId)?.name ?? 'Sin organización'}</td><td><Badge tone={u.isActive ? 'good' : 'warn'}>{u.isActive ? 'Activa' : 'Desactivada'}</Badge></td><td><Badge tone={u.mfaEnabled ? 'good' : u.role === 'administrator' ? 'warn' : 'neutral'}>{u.mfaEnabled ? 'Activado' : u.role === 'administrator' ? 'Pendiente' : 'No requerido'}</Badge></td><td>{dateTime(u.createdAt)}</td><td><div className="ac-actions"><button className="ac-mini" onClick={() => setEditing(u)}><UserCog size={14} /> Editar</button>{u.role !== 'administrator' && <button className="ac-text-link" disabled={promotionPending || u.id === identity.id} title={u.id === identity.id ? 'No puedes solicitar tu propia promoción' : promotionPending ? 'Ya hay una solicitud pendiente' : 'Solicitar revisión por otra persona administradora'} onClick={() => { if (u.id !== identity.id && !promotionPending && window.confirm(`¿Solicitar promoción de ${u.displayName} a administración? Otra persona administradora deberá aprobarla.`)) request.mutate({ data: { operationId: newOperationId(), requestType: 'promote_user', targetUserId: u.id } }, { onSuccess: () => { done('Solicitud de promoción creada; requiere aprobación de otra persona administradora.', 'success'); complete(); }, onError: e => done(explainMutation(e, 'No se pudo crear la solicitud.'), 'error') }); }}>{promotionPending ? 'Pendiente' : 'Solicitar promoción'}</button>}{u.role === 'administrator' && u.id !== identity.id && <button className="ac-text-danger" disabled={deactivationPending} title={deactivationPending ? 'Ya hay una solicitud pendiente' : 'Solicitar baja con aprobación independiente'} onClick={() => { if (!deactivationPending && window.confirm(`¿Solicitar la baja de administración de ${u.displayName}? Otra persona administradora deberá aprobarla.`)) request.mutate({ data: { operationId: newOperationId(), requestType: 'deactivate_administrator', targetUserId: u.id } }, { onSuccess: () => { done('Solicitud de baja creada; requiere aprobación de otra persona administradora.', 'success'); complete(); }, onError: e => done(explainMutation(e, 'No se pudo crear la solicitud.'), 'error') }); }}>{deactivationPending ? 'Baja pendiente' : 'Solicitar baja admin.'}</button>}</div></td></tr>;
      })}{!rows.length && <tr><td colSpan={7}><div className="ac-empty"><b>{search ? 'Sin coincidencias' : 'Sin usuarios'}</b><p>Prueba otra búsqueda o crea una invitación.</p></div></td></tr>}</tbody></AdminTable>}
    </Panel>
     <Panel title="Solicitudes de privilegio" note="Las altas, bajas e invitaciones administrativas requieren a otra persona administradora.">
      <LoadState loading={requests.isLoading} error={requests.isError} retry={() => void requests.refetch()} empty={!!requests.data && !requests.data.length} />
       {requests.data?.length ? <AdminTable min={760}><thead><tr><th>Solicitud</th><th>Solicitante</th><th>Estado</th><th>Fecha</th><th>Decisión</th></tr></thead><tbody>{requests.data.map(r => <tr key={r.id}><td><b>{privilegeLabel(r.requestType)}</b><small className="ac-sub">{r.email ?? r.targetUserId ?? 'Cuenta existente'}</small></td><td>{r.requestedByUserId === identity.id ? 'Tú' : r.requestedByUserId.slice(0, 8)}</td><td><Badge tone={r.status === 'approved' ? 'good' : r.status === 'rejected' ? 'bad' : 'warn'}>{readable(r.status)}</Badge></td><td>{dateTime(r.createdAt)}</td><td>{r.status === 'pending' ? r.requestedByUserId === identity.id ? <span className="ac-pending-note">Bloqueada para aprobación propia</span> : <div className="ac-actions"><button className="ac-text-link" onClick={() => setDecision({ id: r.id, action: 'approve' })}>Aprobar</button><button className="ac-text-danger" onClick={() => setDecision({ id: r.id, action: 'reject' })}>Rechazar</button></div> : r.decisionNote || '—'}</td></tr>)}</tbody></AdminTable> : null}
    </Panel>
    <Panel title="Invitaciones recientes" note="El estado se actualiza tras aceptar, rechazar, revocar o caducar.">
      <LoadState loading={invitations.isLoading} error={invitations.isError} retry={() => void invitations.refetch()} empty={!!invitations.data && !invitations.data.length} />
      {invitations.data?.length ? <AdminTable min={700}><thead><tr><th>Correo</th><th>Rol</th><th>Estado</th><th>Caducidad</th><th></th></tr></thead><tbody>{invitations.data.map(inv => <tr key={inv.id}><td><b>{inv.email}</b></td><td>{accessRoleLabel(inv.role)}</td><td><Badge tone={inv.status === 'accepted' ? 'good' : inv.status === 'pending' ? 'warn' : inv.status === 'rejected' ? 'bad' : 'neutral'}>{readable(inv.status)}</Badge></td><td>{dateTime(inv.expiresAt)}</td><td>{inv.status === 'pending' && <button className="ac-text-danger" onClick={() => { if (window.confirm(`¿Revocar la invitación a ${inv.email}?`)) revoke.mutate({ id: inv.id }, { onSuccess: () => { done('Invitación revocada.', 'success'); complete(); }, onError: e => done(explainMutation(e, 'No se pudo revocar la invitación.'), 'error') }); }}>Revocar</button>}</td></tr>)}</tbody></AdminTable> : null}
    </Panel>
    {creating && <Modal title="Nueva invitación" close={() => setCreating(false)}><form className="ac-form" onSubmit={sendInvite}><p>Las cuentas administrativas quedan en espera de aprobación por una persona distinta.</p><label>Correo electrónico<input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="persona@centro.edu" /></label><label>Rol<select value={role} onChange={e => setRole(e.target.value as AccessRole)}>{ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label><label>Organización<select value={orgId} onChange={e => setOrgId(e.target.value)}><option value="">Sin organización asignada</option>{orgs.data?.organizations.filter(o => o.isActive).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>{role === 'administrator' && <Notice kind="info">No se enviará una invitación directa. Se creará una solicitud para aprobación independiente.</Notice>}{formError && <Notice kind="error">{formError}</Notice>}<div className="ac-form-actions"><button type="button" className="ac-button" onClick={() => setCreating(false)}>Cancelar</button><button className="ac-button ac-primary" disabled={invite.isPending || request.isPending}>{invite.isPending || request.isPending ? 'Procesando…' : role === 'administrator' ? 'Solicitar aprobación' : 'Crear invitación'}</button></div></form></Modal>}
    {issued && <Modal title="Enlace de invitación" close={() => setIssued(null)}><div className="ac-form"><Notice kind="info">No se ha enviado un correo. Copia y comparte este enlace ahora mediante un canal seguro; solo se muestra una vez.</Notice><p><b>{issued.invitation.email}</b> · {accessRoleLabel(issued.invitation.role)} · caduca {dateTime(issued.invitation.expiresAt)}</p><div className="ac-invite-link"><input readOnly aria-label="Enlace de invitación" value={`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation#token=${encodeURIComponent(issued.token)}`} onFocus={e => e.currentTarget.select()} /><button className="ac-button ac-primary" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation#token=${encodeURIComponent(issued.token)}`); setCopied(true); } catch { setCopied(false); } }}>{copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}{copied ? 'Copiado' : 'Copiar enlace'}</button></div><div className="ac-form-actions"><button className="ac-button ac-primary" onClick={() => setIssued(null)}>He guardado el enlace</button></div></div></Modal>}
    {editing && <UserEdit user={editing} self={editing.id === identity.id} orgs={orgs.data?.organizations ?? []} onClose={() => setEditing(null)} onSave={data => update.mutate({ id: editing.id, data }, { onSuccess: () => { setEditing(null); done('Cuenta actualizada.', 'success'); complete(); }, onError: e => done(explainMutation(e, 'No se pudieron guardar los cambios.'), 'error') })} />}
    {decision && <Modal title={decision.action === 'approve' ? 'Aprobar solicitud' : 'Rechazar solicitud'} close={() => setDecision(null)}><div className="ac-form"><Notice kind="info">La API valida que la persona que decide sea distinta de quien solicitó el privilegio.</Notice><label>Nota de decisión<input id="privilege-note" minLength={5} maxLength={300} required defaultValue="" /></label><div className="ac-form-actions"><button className="ac-button" onClick={() => setDecision(null)}>Cancelar</button><button className={`ac-button ${decision.action === 'approve' ? 'ac-primary' : 'ac-danger'}`} disabled={decide.isPending} onClick={() => { const note = (document.getElementById('privilege-note') as HTMLInputElement).value; if (note.length < 5) return; decide.mutate({ id: decision.id, data: { operationId: newOperationId(), action: decision.action, note } }, { onSuccess: result => { setDecision(null); if (result.invitationToken) { setAdminInviteToken(result.invitationToken); setAdminInviteCopied(false); } done('Decisión registrada en auditoría.', 'success'); complete(); }, onError: e => { setDecision(null); done(explainMutation(e, 'No se pudo registrar la decisión.'), 'error'); } }); }}>{decide.isPending ? 'Guardando…' : 'Registrar decisión'}</button></div></div></Modal>}
    {adminInviteToken && <Modal title="Invitación administrativa aprobada" close={() => setAdminInviteToken(null)}><div className="ac-form"><Notice kind="info">La invitación no se ha enviado por correo. Comparte este enlace por un canal seguro; no estará disponible después de cerrar esta ventana.</Notice><div className="ac-invite-link"><input readOnly aria-label="Enlace de invitación de administración" value={`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation#token=${encodeURIComponent(adminInviteToken)}`} onFocus={e => e.currentTarget.select()} /><button className="ac-button ac-primary" onClick={async () => { try { await navigator.clipboard.writeText(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation#token=${encodeURIComponent(adminInviteToken)}`); setAdminInviteCopied(true); } catch { setAdminInviteCopied(false); } }}>{adminInviteCopied ? <CheckCircle2 size={14} /> : <Copy size={14} />}{adminInviteCopied ? 'Copiado' : 'Copiar enlace'}</button></div><div className="ac-form-actions"><button className="ac-button ac-primary" onClick={() => setAdminInviteToken(null)}>He guardado el enlace</button></div></div></Modal>}
  </div>;
}
function UserEdit({ user, self, orgs, onClose, onSave }: { user: ManagedUser; self: boolean; orgs: { id: string; name: string; isActive: boolean }[]; onClose: () => void; onSave: (data: { role?: AccessRole; isActive?: boolean; organizationId?: string | null }) => void }) {
  const [role, setRole] = useState(user.role), [active, setActive] = useState(user.isActive), [org, setOrg] = useState(user.organizationId ?? '');
   return <Modal title={`Editar ${user.displayName}`} close={onClose}><form className="ac-form" onSubmit={e => { e.preventDefault(); const data: { role?: AccessRole; isActive?: boolean; organizationId?: string | null } = {}; if (!self && role !== user.role) data.role = role; if (!self && active !== user.isActive) data.isActive = active; if (org !== (user.organizationId ?? '')) data.organizationId = org || null; onSave(data); }}><p>{user.email}</p>{self && <Notice kind="info">Tu propio rol y estado no se pueden modificar.</Notice>}{user.role === 'administrator' && <Notice kind="info">El cambio de rol o la baja de otra cuenta administradora requiere una solicitud aprobada por una persona distinta.</Notice>}<label>Rol<select value={role} disabled={self || user.role === 'administrator'} onChange={e => setRole(e.target.value as AccessRole)}>{ROLE_OPTIONS.map(r => <option key={r.value} value={r.value} disabled={r.value === 'administrator' && user.role !== 'administrator'}>{r.label}{r.value === 'administrator' && user.role !== 'administrator' ? ' · requiere solicitud' : ''}</option>)}</select></label>{user.role !== 'administrator' && <p>La promoción a administración se solicita desde la lista de cuentas y requiere una aprobación independiente.</p>}<label>Organización<select value={org} onChange={e => setOrg(e.target.value)}><option value="">Sin organización</option>{orgs.filter(o => o.isActive || o.id === user.organizationId).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label><label className="ac-check"><input type="checkbox" checked={active} disabled={self || user.role === 'administrator'} onChange={e => setActive(e.target.checked)} />Cuenta activa</label><div className="ac-form-actions"><button type="button" className="ac-button" onClick={onClose}>Cancelar</button><button className="ac-button ac-primary">Guardar cambios</button></div></form></Modal>;
}

function PoliciesView({ data }: { data: AdminSystemOverview }) {
  const evaluate = useEvaluateAdminPolicy();
  const [role, setRole] = useState<AccessRole>('teacher'), [permission, setPermission] = useState<AdminPolicyPermission>('manage_center_accounts');
  const run = (e: FormEvent) => { e.preventDefault(); evaluate.mutate({ data: { role, permission } }); };
  return <div className="ac-stack"><div className="ac-callout"><Shield size={16} /><p>Esta matriz es una referencia de lectura. La evaluación no cambia permisos ni autorización en vivo.</p></div>
    <Panel title="Matriz de acceso" note="Permisos declarados por rol; etiquetas explícitas para revisar su alcance."><AdminTable min={790}><thead><tr><th>Rol</th>{Object.entries(permissionLabels).map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{data.policyMatrix.map(row => <tr key={row.role}><td><b>{row.label || accessRoleLabel(row.role)}</b></td>{Object.keys(permissionLabels).map(key => <td key={key}>{row.permissions.includes(key as AdminPolicyPermission) ? <Badge tone="good">Permitido</Badge> : <span className="ac-denied-label">No concedido</span>}</td>)}</tr>)}</tbody></AdminTable></Panel>
    <Panel title="Evaluación de política" note="Consulta explicativa no vinculante."><form className="ac-evaluate" onSubmit={run}><label>Rol<select value={role} onChange={e => setRole(e.target.value as AccessRole)}>{ROLE_OPTIONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label><label>Permiso<select value={permission} onChange={e => setPermission(e.target.value as AdminPolicyPermission)}>{Object.entries(permissionLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><button className="ac-button ac-primary" disabled={evaluate.isPending}>{evaluate.isPending ? 'Evaluando…' : 'Evaluar permiso'}</button></form>{evaluate.isError && <Notice kind="error">No se pudo evaluar. Comprueba los datos e inténtalo de nuevo.</Notice>}{evaluate.data && <div className={`ac-eval-result ${evaluate.data.allowed ? 'allowed' : ''}`}><Badge tone={evaluate.data.allowed ? 'good' : 'bad'}>{evaluate.data.allowed ? 'Permitido en evaluación' : 'No permitido en evaluación'}</Badge><div><b>Ámbito: {evaluate.data.scope}</b><p>{evaluate.data.explanation}</p></div><small>Solo lectura · No cambia autorización</small></div>}</Panel>
  </div>;
}

function ScenarioView({ data, done }: { data: AdminSystemOverview; done: (t: string, k: 'success' | 'error') => void }) {
  const create = useCreateAdminScenarioVersion();
  const latest = data.scenarioVersions[0];
  const [academicPeriod, setAcademicPeriod] = useState(latest?.settings.academicPeriod ?? '2025-2026'), [simulatedDate, setSimulatedDate] = useState(latest?.settings.simulatedDate?.slice(0, 10) ?? ''), [catalogVersion, setCatalogVersion] = useState(latest?.settings.catalogVersion ?? 'base-1'), [retention, setRetention] = useState(String(latest?.settings.documentRetentionDays ?? 365));
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: { operationId: newOperationId(), validFrom: new Date().toISOString(), settings: { academicPeriod: academicPeriod.trim(), simulatedDate: new Date(`${simulatedDate || new Date().toISOString().slice(0, 10)}T12:00:00`).toISOString(), catalogVersion: catalogVersion.trim(), documentRetentionDays: Number(retention) } } }, { onSuccess: () => done('Nueva versión de escenario registrada. Las versiones previas permanecen sin cambios.', 'success'), onError: e => done(explainMutation(e, 'No se pudo crear la versión.'), 'error') }); };
  return <div className="ac-stack"><div className="ac-callout"><Layers3 size={16} /><p><b>Versionado append-only.</b> Crear una versión nueva no reescribe ni altera operaciones históricas.</p></div>
    <Panel title="Parámetros propuestos" note="Al guardar se añade una versión nueva al historial."><form className="ac-scenario-form" onSubmit={submit}><label>Periodo académico<input required minLength={4} maxLength={30} value={academicPeriod} onChange={e => setAcademicPeriod(e.target.value)} /></label><label>Fecha simulada<input required type="date" value={simulatedDate} onChange={e => setSimulatedDate(e.target.value)} /></label><label>Versión de catálogo<input required maxLength={40} value={catalogVersion} onChange={e => setCatalogVersion(e.target.value)} /></label><label>Retención documental (días)<input type="number" min={30} max={3650} required value={retention} onChange={e => setRetention(e.target.value)} /></label><div className="ac-form-actions"><button className="ac-button ac-primary" disabled={create.isPending}>{create.isPending ? 'Registrando…' : 'Añadir versión'}</button></div></form></Panel>
    <Panel title="Historial de versiones" note="Cada registro es una instantánea inmutable de configuración."><LoadState loading={false} error={false} empty={!data.scenarioVersions.length} /><AdminTable min={760}><thead><tr><th>Versión</th><th>Vigente desde</th><th>Periodo</th><th>Fecha simulada</th><th>Catálogo</th><th>Retención</th></tr></thead><tbody>{data.scenarioVersions.map(v => <tr key={v.id}><td><b>v{v.version}</b></td><td>{dateTime(v.validFrom)}</td><td>{v.settings.academicPeriod}</td><td>{dateTime(v.settings.simulatedDate)}</td><td>{v.settings.catalogVersion}</td><td>{v.settings.documentRetentionDays} días</td></tr>)}</tbody></AdminTable></Panel>
  </div>;
}

function SecurityView({ identity }: { identity: AuthIdentity }) {
  const audit = useListAdminAudit(), requests = useListAdminPrivilegeRequests();
  return <div className="ac-stack"><div className="ac-metrics-grid ac-metrics-three"><Metric label="Eventos recientes" value={audit.data?.length ?? '—'} note="Accesos y cambios registrados" icon={History} /><Metric label="Solicitudes pendientes" value={requests.data?.filter(r => r.status === 'pending').length ?? '—'} note="Requieren revisión independiente" icon={KeyRound} /><Metric label="Protección de cuenta propia" value="Activa" note="No se permite autoelevarse" icon={Lock} /></div>
     <div className="ac-callout"><ShieldAlert size={16} /><p>Las cuentas administradoras requieren TOTP. Guarda los códigos de recuperación durante la inscripción: cada uno puede usarse una sola vez.</p></div>
     <Panel title="Registro de auditoría" note="Eventos recientes de cuentas, organizaciones, invitaciones y permisos." action={<button className="ac-refresh" onClick={() => void audit.refetch()}><RefreshCw size={14} /> Actualizar</button>}>
      <LoadState loading={audit.isLoading} error={audit.isError} retry={() => void audit.refetch()} empty={!!audit.data && !audit.data.length} />
       {audit.data?.length ? <ol className="ac-audit-list">{audit.data.map(event => <li key={event.id}><span className="ac-audit-mark"><History size={14} /></span><div><b>{auditLabel(event.action)}</b><small>Entidad <code>{event.entityId.slice(0, 8)}</code> · {event.actorUserId === identity.id ? 'por ti' : event.actorUserId ? `por ${event.actorUserId.slice(0, 8)}` : event.action === 'invitation.rejected' ? 'por la persona invitada sin cuenta' : 'sistema'}</small></div><time>{dateTime(event.createdAt)}</time></li>)}</ol> : null}
    </Panel>
     <Panel title="Revisión de privilegios" note="Altas, bajas e invitaciones administrativas requieren aprobación independiente."><LoadState loading={requests.isLoading} error={requests.isError} retry={() => void requests.refetch()} empty={!!requests.data && !requests.data.length} />{requests.data?.length ? <AdminTable min={700}><thead><tr><th>Tipo</th><th>Cuenta / correo</th><th>Estado</th><th>Solicitada</th><th>Resuelta</th></tr></thead><tbody>{requests.data.map(r => <tr key={r.id}><td>{privilegeLabel(r.requestType)}</td><td>{r.email ?? r.targetUserId ?? '—'}</td><td><Badge tone={r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'good' : 'bad'}>{readable(r.status)}</Badge><small className="ac-sub">{r.decisionNote}</small></td><td>{dateTime(r.createdAt)}</td><td>{r.decidedAt ? dateTime(r.decidedAt) : 'Pendiente'}</td></tr>)}</tbody></AdminTable> : null}</Panel>
  </div>;
}

function RecoveryView({ data, done }: { data: AdminSystemOverview; done: (t: string, k: 'success' | 'error') => void }) {
  const create = useCreateAdminBackupExercise(), [label, setLabel] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: { operationId: newOperationId(), label: label.trim() } }, { onSuccess: () => { setLabel(''); done('Ensayo de recuento registrado. No se ha creado ni restaurado una copia de seguridad.', 'success'); }, onError: e => done(explainMutation(e, 'No se pudo registrar el ensayo.'), 'error') }); };
  return <div className="ac-stack"><div className="ac-simulation ac-warning"><Database size={16} /><span><b>Ensayo de recuentos, no copia de seguridad.</b> No se exporta, guarda ni restaura una base de datos.</span></div>
    <div className="ac-metrics-grid ac-metrics-four"><Metric label="Ensayos registrados" value={data.counts.backupExercises} note="Historial de preparación" icon={Database} /><Metric label="Organizaciones" value={data.counts.organizations} note="Recuento del conjunto" icon={Building2} /><Metric label="Usuarios" value={data.counts.users} note="Recuento del conjunto" icon={Users} /><Metric label="Eventos auditados" value={data.counts.auditEvents} note="Disponible para revisión" icon={History} /></div>
    <Panel title="Registrar ensayo de preparación" note="Solo quedan registrados los recuentos informados."><form className="ac-inline-form" onSubmit={submit}><label>Etiqueta del ensayo<input required minLength={5} maxLength={120} value={label} onChange={e => setLabel(e.target.value)} placeholder="Ej. Revisión de cierre de trimestre" /></label><button className="ac-button ac-primary" disabled={create.isPending}>{create.isPending ? 'Registrando…' : 'Registrar ensayo'}</button></form><p className="ac-quiet-note"><ShieldAlert size={13} /> No hay controles de copia real ni restauración en esta consola.</p></Panel>
    <Panel title="Historial de ensayos" note="Recuento informativo por conjunto de datos."><LoadState loading={false} error={false} empty={!data.backupExercises.length} />{data.backupExercises.length ? <AdminTable min={760}><thead><tr><th>Ensayo</th><th>Estado</th><th>Organizaciones</th><th>Usuarios</th><th>Documentos</th><th>Campañas</th><th>Registrado</th></tr></thead><tbody>{data.backupExercises.map(x => <tr key={x.id}><td><b>{x.label}</b><small className="ac-sub">Ref. {x.operationId.slice(0, 8)}</small></td><td><Badge tone={x.status === 'verified' ? 'good' : 'warn'}>{readable(x.status)}</Badge></td><td>{x.datasetCounts.organizations}</td><td>{x.datasetCounts.users}</td><td>{x.datasetCounts.documents}</td><td>{x.datasetCounts.simulationCampaigns}</td><td>{dateTime(x.createdAt)}</td></tr>)}</tbody></AdminTable> : null}</Panel>
  </div>;
}

function IntegrationsView({ data, done }: { data: AdminSystemOverview; done: (t: string, k: 'success' | 'error') => void }) {
  const qc = useQueryClient();
  const check = useCheckAdminIntegration();
  const saveAi = useUpdateAdminAiCoordinatorSettings();
  const testAi = useTestAdminAiCoordinatorConnection();
  const groqModels = useListAdminGroqAiModels({ query: { enabled: false, retry: false } });
  const [aiEnabled, setAiEnabled] = useState(data.aiCoordinator.enabled);
  const [aiProvider, setAiProvider] = useState(data.aiCoordinator.provider);
  const [aiModel, setAiModel] = useState(data.aiCoordinator.model);
  const [groqDataAcknowledged, setGroqDataAcknowledged] = useState(false);
  const saveCoordinator = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    saveAi.mutate({
      data: {
        operationId: newOperationId(),
        enabled: aiEnabled,
        provider: aiProvider,
        baseUrl: aiProvider === 'local'
          ? String(form.get('localAiBaseUrl') ?? '')
          : data.aiCoordinator.baseUrl,
        model: aiModel,
        externalDataTransferAcknowledged: groqDataAcknowledged,
      },
    }, {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getGetAdminSystemOverviewQueryKey() });
        done('Configuración del coordinador guardada.', 'success');
      },
      onError: (error) => done(explainMutation(error, 'No se pudo guardar la configuración del proveedor.'), 'error'),
    });
  };
  return <div className="ac-stack">
    <AdminAiDelegations data={data} done={done} />
    <Panel title="Coordinador económico con IA" note="Las campañas requieren revisión; solo las empresas delegadas permiten operaciones didácticas automáticas.">
      <form className="ac-ai-config" onSubmit={saveCoordinator}>
        <div className="ac-ai-config-grid">
          <label>Proveedor de IA
            <select value={aiProvider} onChange={event => {
              const provider: 'local' | 'groqcloud' = event.target.value === 'groqcloud' ? 'groqcloud' : 'local';
              setAiProvider(provider);
              setAiModel('');
              setGroqDataAcknowledged(false);
            }}>
              <option value="local">Endpoint local o privado</option>
              <option value="groqcloud">GroqCloud API</option>
            </select>
          </label>
          {aiProvider === 'local' && <label>URL base local
            <input name="localAiBaseUrl" type="url" required={aiEnabled} maxLength={512}
              defaultValue={data.aiCoordinator.baseUrl} placeholder="http://127.0.0.1:11434/v1" />
          </label>}
          {aiProvider === 'groqcloud' ? <label>Modelo de GroqCloud
            <select required={aiEnabled} value={aiModel} onChange={event => setAiModel(event.target.value)}>
              <option value="">Selecciona un modelo</option>
              {aiModel && !groqModels.data?.models.includes(aiModel) && <option value={aiModel}>{aiModel} · guardado</option>}
              {groqModels.data?.models.map(model => <option key={model} value={model}>{model}</option>)}
            </select>
          </label> : <label>Modelo local
            <input name="localAiModel" required={aiEnabled} maxLength={120}
              value={aiModel} onChange={event => setAiModel(event.target.value)}
              placeholder="Nombre exacto del modelo" />
          </label>}
        </div>
        <label className="ac-ai-toggle"><input type="checkbox" checked={aiEnabled} onChange={event => setAiEnabled(event.target.checked)} />
          Activar generación supervisada de propuestas</label>
        {aiProvider === 'groqcloud' && <>
          <p className="ac-ai-note">
            Endpoint oficial fijo: https://api.groq.com/openai/v1.
          </p>
          <p className="ac-ai-note">
            Clave GROQ_API_KEY: {data.aiCoordinator.groqApiKeyConfigured ? 'configurada en el servidor' : 'no configurada en Secretos'}.
            No se guarda en la base de datos ni se muestra en esta consola.
          </p>
          <div className="ac-ai-config-actions">
            <button className="ac-button" type="button"
              disabled={groqModels.isFetching || !data.aiCoordinator.groqApiKeyConfigured}
              onClick={() => void groqModels.refetch()}>
              <RefreshCw size={14} /> {groqModels.isFetching ? 'Consultando…' : groqModels.data ? 'Actualizar modelos' : 'Consultar modelos'}
            </button>
            {!data.aiCoordinator.groqApiKeyConfigured && <span className="ac-ai-note">Configura GROQ_API_KEY en Secretos para consultar los modelos.</span>}
            {groqModels.isError && <span className="ac-ai-note" role="alert">{explainApiMessage(groqModels.error, 'No se pudo consultar el catálogo de GroqCloud. Inténtalo de nuevo más tarde.')}</span>}
            {groqModels.isSuccess && <span className="ac-ai-note" role="status">
              {groqModels.data.models.length ? `${groqModels.data.models.length} modelos disponibles.` : 'GroqCloud no devolvió modelos disponibles.'}
            </span>}
          </div>
          {aiEnabled && <label className="ac-ai-toggle">
            <input type="checkbox" checked={groqDataAcknowledged}
              onChange={event => setGroqDataAcknowledged(event.target.checked)} />
            Confirmo que GroqCloud recibirá el objetivo, el resumen económico simulado y el historial de operaciones de la red. No incluiré datos personales en el objetivo.
          </label>}
        </>}
        <div className="ac-ai-config-actions">
          <button className="ac-button ac-primary" type="submit" disabled={saveAi.isPending ||
            (aiProvider === 'groqcloud' && aiEnabled && (!data.aiCoordinator.groqApiKeyConfigured || !groqDataAcknowledged))}>
            {saveAi.isPending ? 'Guardando…' : 'Guardar configuración'}
          </button>
          <button className="ac-button" type="button" disabled={testAi.isPending || !data.aiCoordinator.enabled}
            onClick={() => testAi.mutate({ data: { operationId: newOperationId() } }, {
              onSuccess: result => done(`${result.message} Modelo: ${result.model}.`, 'success'),
              onError: error => done(explainMutation(error, 'No se pudo conectar con el proveedor de IA.'), 'error'),
            })}>
            <RefreshCw size={14} /> {testAi.isPending ? 'Comprobando…' : 'Probar conexión guardada'}
          </button>
          <Badge tone={data.aiCoordinator.enabled ? 'good' : 'neutral'}>{data.aiCoordinator.enabled ? 'Activada' : 'Desactivada'}</Badge>
        </div>
        <p className="ac-ai-note">
          Compatible con endpoints locales OpenAI, como Ollama o LM Studio. GroqCloud recibe el objetivo y el contexto económico simulado con nombres de empresas y centros sustituidos por etiquetas; no se envían contactos ni descripciones libres del historial.
        </p>
      </form>
    </Panel>
    <div className="ac-simulation"><Network size={16} /><span><b>Integraciones empresariales simuladas.</b> GroqCloud solo se contacta cuando el administrador lo selecciona y activa expresamente.</span><span className="ac-sim-tag">IA OPTATIVA</span></div>
    <Panel title="Integraciones previstas" note="Las comprobaciones solo actualizan el estado de demostración."><div className="ac-integrations">{data.integrations.map(item => <article key={item.id} className="ac-integration-card"><div className="ac-integration-top"><span className="ac-service-icon"><Network size={17} /></span><Badge tone={item.status === 'simulation_only' ? 'blue' : 'neutral'}>{readable(item.status)}</Badge></div><h3>{item.name}</h3><p>{item.description}</p><div className="ac-integration-meta"><span>{item.simulationOnly ? 'Sin llamadas externas' : 'Estado de catálogo'}</span><small>{item.checkedAt ? `Última comprobación: ${dateTime(item.checkedAt)}` : 'Sin comprobación registrada'}</small></div><button className="ac-button" disabled={check.isPending || !item.simulationOnly} onClick={() => check.mutate({ integrationId: item.id, data: { operationId: newOperationId() } }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetAdminSystemOverviewQueryKey() }); done(`Comprobación simulada registrada para ${item.name}.`, 'success'); }, onError: e => done(explainMutation(e, 'No se pudo registrar la comprobación.'), 'error') })}><RefreshCw size={14} /> Comprobar estado simulado</button></article>)}{!data.integrations.length && <div className="ac-empty"><b>No hay integraciones en catálogo</b><p>Las capacidades incorporadas aparecerán aquí.</p></div>}</div></Panel>
     <Panel title="Preparación de despliegue" note="La consola no gestiona infraestructura ni despliegues."><div className="ac-deploy-row"><span className="ac-service-icon"><Server size={17} /></span><div><b>Modo de operación</b><small>Desarrollo funcional · datos y procesos de formación</small></div><Badge tone="blue">Solo entorno educativo</Badge></div><div className="ac-callout"><Lock size={15} /><p>Las claves API se guardan en Secretos del proyecto, nunca en esta consola ni en la base de datos.</p></div></Panel>
  </div>;
}

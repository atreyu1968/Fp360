import { type FormEvent, type ReactNode, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, CircleAlert, Copy, History, Lock, MailPlus, RefreshCw, Search, ShieldAlert, ShieldCheck, UserCog, Users, X,
} from 'lucide-react';
import {
  getGetCurrentIdentityQueryKey, getListAdminAuditQueryKey, getListAdminInvitationsQueryKey, getListAdminUsersQueryKey,
  useCreateAdminInvitation, useListAdminAudit, useListAdminInvitations, useListAdminUsers, useListFp360Organizations,
  useRevokeAdminInvitation, useUpdateAdminUser,
} from '@workspace/api-client-react';
import type { AccessRole, AuthIdentity, IssuedInvitation, ManagedUser, UserInvitation } from '@workspace/api-client-react';
import { ROLE_OPTIONS, accessRoleLabel, dateTime, httpStatus } from './admin-shared';

type Tab = 'users' | 'invitations' | 'audit';

const inviteStatus: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'status status-amber' },
  accepted: { label: 'Aceptada', cls: 'status status-green' },
  revoked: { label: 'Revocada', cls: 'status admin-status-muted' },
  expired: { label: 'Caducada', cls: 'status admin-status-muted' },
};
const auditLabels: Record<string, string> = {
  'invitation.created': 'Invitación creada',
  'invitation.revoked': 'Invitación revocada',
  'invitation.accepted': 'Invitación aceptada',
  'user.updated': 'Usuario actualizado',
};

function mutationError(error: unknown, fallback: string) {
  const s = httpStatus(error);
  if (s === 403) return 'No tienes permiso para realizar esta acción.';
  if (s === 409) return 'Ya existe una cuenta o invitación pendiente para ese correo.';
  if (s === 400 || s === 422) return 'Los datos no son válidos. Revísalos e inténtalo de nuevo.';
  if (s === 404) return 'El elemento ya no existe. Actualiza la lista.';
  return fallback;
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="admin-modal-title">
      <div className="modal-head"><h2 id="admin-modal-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label="Cerrar" data-testid="button-close-dialog"><X size={18} /></button></div>
      {children}
    </section>
  </div>;
}

function ListState({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <div className="skeleton-list" aria-label="Cargando"><span /><span /><span /></div>;
  if (error) return <div className="inline-error" role="alert"><ShieldAlert size={18} /><span>No se han podido cargar estos datos.</span><button className="text-button" onClick={retry}>Reintentar</button></div>;
  return null;
}

function Empty({ title, detail, icon: Icon }: { title: string; detail: string; icon: typeof Users }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={20} /></div><strong>{title}</strong><p>{detail}</p></div>;
}

export function AdminAccessDenied() {
  return <main className="page-content">
    <div className="admin-denied page-enter" role="alert" data-testid="status-admin-denied">
      <span className="admin-denied-mark"><Lock size={22} /></span>
      <h1>Acceso restringido</h1>
      <p>La administración de usuarios solo está disponible para perfiles de administración. Si necesitas cambios en tu cuenta, contacta con la persona responsable del centro.</p>
    </div>
  </main>;
}

export function AdminPage({ identity }: { identity: AuthIdentity }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('users');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const users = useListAdminUsers();
  const invitations = useListAdminInvitations();
  const audit = useListAdminAudit();
  const orgs = useListFp360Organizations();

  const refresh = (keys: ('users' | 'invitations')[]) => {
    if (keys.includes('users')) void qc.invalidateQueries({ queryKey: getListAdminUsersQueryKey() });
    if (keys.includes('invitations')) void qc.invalidateQueries({ queryKey: getListAdminInvitationsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListAdminAuditQueryKey() });
  };
  const orgName = (id?: string | null) => (id ? orgs.data?.find((o) => o.id === id)?.name ?? 'Organización desconocida' : 'Sin organización');
  const pending = (invitations.data ?? []).filter((i) => i.status === 'pending').length;

  return <main className="page-content">
    <div className="page-heading page-enter"><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>ADMINISTRACIÓN · ACCESOS</span></div>
      <div className="heading-row"><div><h1>Usuarios y accesos</h1><p>Gestiona cuentas, roles e invitaciones del espacio. Primera parte del módulo de administración del sistema.</p></div></div>
    </div>
    <div className="sub-metrics">
      <div><span>Cuentas</span><b data-testid="text-user-count">{users.data?.length ?? '—'}</b><small>{users.data ? `${users.data.filter((u) => u.isActive).length} activas` : 'Cargando'}</small></div>
      <div><span>Invitaciones pendientes</span><b>{invitations.data ? pending : '—'}</b><small>Caducan a las 72 horas</small></div>
      <div><span>Eventos registrados</span><b>{audit.data?.length ?? '—'}</b><small>Auditoría de accesos</small></div>
    </div>
    {notice && <div className={notice.kind === 'ok' ? 'admin-notice' : 'admin-notice admin-notice-error'} role={notice.kind === 'ok' ? 'status' : 'alert'} data-testid="status-admin-notice">
      {notice.kind === 'ok' ? <CheckCircle2 size={16} /> : <CircleAlert size={16} />}<span>{notice.text}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label="Cerrar aviso"><X size={15} /></button>
    </div>}
    <section className="panel">
      <div className="list-toolbar">
        <div className="tabs" role="tablist" aria-label="Secciones de administración">
          <button role="tab" aria-selected={tab === 'users'} className={tab === 'users' ? 'tab-active' : ''} onClick={() => setTab('users')} data-testid="tab-users"><Users size={15} /> Usuarios</button>
          <button role="tab" aria-selected={tab === 'invitations'} className={tab === 'invitations' ? 'tab-active' : ''} onClick={() => setTab('invitations')} data-testid="tab-invitations"><MailPlus size={15} /> Invitaciones</button>
          <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'tab-active' : ''} onClick={() => setTab('audit')} data-testid="tab-audit"><History size={15} /> Auditoría</button>
        </div>
      </div>
      {tab === 'users' && <UsersTab identity={identity} users={users.data} loading={users.isLoading} error={users.isError} retry={() => void users.refetch()} orgs={orgs.data ?? []} orgName={orgName}
        onDone={(text, kind, self) => { setNotice({ kind, text }); if (kind === 'ok') { refresh(['users']); if (self) void qc.invalidateQueries({ queryKey: getGetCurrentIdentityQueryKey() }); } }} />}
      {tab === 'invitations' && <InvitationsTab invitations={invitations.data} loading={invitations.isLoading} error={invitations.isError} retry={() => void invitations.refetch()} orgs={orgs.data ?? []} orgName={orgName}
        onDone={(text, kind) => { setNotice({ kind, text }); if (kind === 'ok') refresh(['invitations']); }} />}
      {tab === 'audit' && <>
        <ListState loading={audit.isLoading} error={audit.isError} retry={() => void audit.refetch()} />
        {audit.data && (audit.data.length ? <ol className="admin-audit">
          {audit.data.map((ev) => <li key={ev.id} data-testid={`row-audit-${ev.id}`}>
            <span className="admin-audit-dot" aria-hidden="true" />
            <div><b>{auditLabels[ev.action] ?? ev.action}</b><small className="mono">Entidad {ev.entityId.slice(0, 8)} · {ev.actorUserId ? (ev.actorUserId === identity.id ? 'por ti' : `por ${users.data?.find((u) => u.id === ev.actorUserId)?.displayName ?? ev.actorUserId.slice(0, 8)}`) : 'sistema'}</small></div>
            <time dateTime={ev.createdAt}>{dateTime(ev.createdAt)}</time>
          </li>)}
        </ol> : <Empty title="Sin eventos todavía" detail="Las invitaciones y cambios de usuarios quedarán registrados aquí." icon={History} />)}
        <div className="table-footer"><span>Eventos recientes</span><button className="icon-button" aria-label="Actualizar auditoría" onClick={() => void audit.refetch()}><RefreshCw size={15} /></button></div>
      </>}
    </section>
  </main>;
}

function UsersTab({ identity, users, loading, error, retry, orgs, orgName, onDone }: {
  identity: AuthIdentity; users?: ManagedUser[]; loading: boolean; error: boolean; retry: () => void;
  orgs: { id: string; name: string; isActive: boolean }[]; orgName: (id?: string | null) => string;
  onDone: (text: string, kind: 'ok' | 'error', self?: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const rows = (users ?? []).filter((u) => `${u.displayName} ${u.email} ${accessRoleLabel(u.role)}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="admin-subbar"><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, correo o rol" aria-label="Buscar usuarios" data-testid="input-user-search" /></label></div>
    <ListState loading={loading} error={error} retry={retry} />
    {users && <div className="table-scroll redfp-scroll"><table style={{ minWidth: 760 }}><thead><tr><th>Persona</th><th>Rol</th><th>Organización</th><th>Estado</th><th>Alta</th><th></th></tr></thead><tbody>
      {rows.map((u) => { const self = u.id === identity.id; return <tr key={u.id} data-testid={`row-user-${u.id}`}>
        <td><div className="org-cell"><span className="org-avatar">{u.displayName.slice(0, 2).toUpperCase()}</span><span className="admin-person"><b>{u.displayName}{self && <em className="admin-you">Tú</em>}</b><small>{u.email}</small></span></div></td>
        <td><span className="role-pill">{accessRoleLabel(u.role)}</span></td>
        <td>{orgName(u.organizationId)}</td>
        <td>{u.isActive ? <span className="status status-green"><span className="status-dot" />Activa</span> : <span className="status admin-status-muted"><span className="status-dot" />Desactivada</span>}</td>
        <td>{dateTime(u.createdAt)}</td>
        <td><button className="mini-button" onClick={() => setEditing(u)} data-testid={`button-edit-user-${u.id}`}><UserCog size={14} /> Editar</button></td>
      </tr>; })}
      {!rows.length && <tr><td colSpan={6}><Empty title={search ? 'Sin coincidencias' : 'No hay usuarios'} detail={search ? 'Prueba con otro nombre o correo.' : 'Invita a la primera persona desde la pestaña Invitaciones.'} icon={Users} /></td></tr>}
    </tbody></table></div>}
    {editing && <EditUserDialog user={editing} self={editing.id === identity.id} orgs={orgs} onClose={() => setEditing(null)} onDone={(t, k) => { if (k === 'ok') setEditing(null); onDone(t, k, editing.id === identity.id); }} />}
  </>;
}

function EditUserDialog({ user, self, orgs, onClose, onDone }: { user: ManagedUser; self: boolean; orgs: { id: string; name: string; isActive: boolean }[]; onClose: () => void; onDone: (t: string, k: 'ok' | 'error') => void }) {
  const update = useUpdateAdminUser();
  const [role, setRole] = useState<AccessRole>(user.role);
  const [active, setActive] = useState(user.isActive);
  const [org, setOrg] = useState(user.organizationId ?? '');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data: { role?: AccessRole; isActive?: boolean; organizationId?: string | null } = {};
    if (!self && role !== user.role) data.role = role;
    if (!self && active !== user.isActive) data.isActive = active;
    if (org !== (user.organizationId ?? '')) data.organizationId = org || null;
    if (!Object.keys(data).length) { onClose(); return; }
    update.mutate({ id: user.id, data }, {
      onSuccess: (u) => onDone(`Cambios guardados para ${u.displayName}.`, 'ok'),
      onError: (err) => onDone(mutationError(err, 'No se pudieron guardar los cambios.'), 'error'),
    });
  };
  return <Dialog title={`Editar ${user.displayName}`} onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <p className="form-intro">{user.email}</p>
      {self && <div className="admin-hint"><Lock size={15} /><span>No puedes cambiar el rol ni desactivar tu propia cuenta.</span></div>}
      <label>Rol<select value={role} disabled={self} onChange={(e) => setRole(e.target.value as AccessRole)} data-testid="select-user-role">{ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
      <label>Organización<select value={org} onChange={(e) => setOrg(e.target.value)} data-testid="select-user-org"><option value="">Sin organización asignada</option>{orgs.filter((o) => o.isActive || o.id === user.organizationId).map((o) => <option key={o.id} value={o.id}>{o.name}{o.isActive ? '' : ' (archivada)'}</option>)}</select></label>
      <label className="admin-check"><input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} data-testid="checkbox-user-active" /><span>Cuenta activa<small>Las cuentas desactivadas no pueden iniciar sesión.</small></span></label>
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={update.isPending} data-testid="button-save-user">{update.isPending ? 'Guardando…' : 'Guardar cambios'}</button></div>
    </form>
  </Dialog>;
}

function InvitationsTab({ invitations, loading, error, retry, orgs, orgName, onDone }: {
  invitations?: UserInvitation[]; loading: boolean; error: boolean; retry: () => void;
  orgs: { id: string; name: string; isActive: boolean }[]; orgName: (id?: string | null) => string; onDone: (t: string, k: 'ok' | 'error') => void;
}) {
  const create = useCreateAdminInvitation();
  const revoke = useRevokeAdminInvitation();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<IssuedInvitation | null>(null);
  const [revoking, setRevoking] = useState<UserInvitation | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AccessRole>('student');
  const [org, setOrg] = useState('');
  const [formError, setFormError] = useState('');
  const [copied, setCopied] = useState(false);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setFormError('');
    create.mutate({ data: { email: email.trim(), role, ...(org ? { organizationId: org } : {}) } }, {
      onSuccess: (res) => { setCreating(false); setEmail(''); setRole('student'); setOrg(''); setCopied(false); setIssued(res); onDone(`Invitación creada para ${res.invitation.email}.`, 'ok'); },
      onError: (err) => setFormError(mutationError(err, 'No se pudo crear la invitación.')),
    });
  };
  const link = issued ? `${window.location.origin}${import.meta.env.BASE_URL}accept-invitation#token=${encodeURIComponent(issued.token)}` : '';
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } };

  return <>
    <div className="admin-subbar"><p>Las invitaciones crean <b>cuentas nuevas</b> y caducan a las 72 horas.</p><button className="button button-primary" onClick={() => { setFormError(''); setCreating(true); }} data-testid="button-new-invitation"><MailPlus size={16} /> Nueva invitación</button></div>
    <ListState loading={loading} error={error} retry={retry} />
    {invitations && <div className="table-scroll redfp-scroll"><table style={{ minWidth: 720 }}><thead><tr><th>Correo</th><th>Rol</th><th>Organización</th><th>Estado</th><th>Caduca</th><th></th></tr></thead><tbody>
      {invitations.map((inv) => { const st = inviteStatus[inv.status] ?? { label: inv.status, cls: 'status' }; return <tr key={inv.id} data-testid={`row-invitation-${inv.id}`}>
        <td><b>{inv.email}</b></td><td><span className="role-pill">{accessRoleLabel(inv.role)}</span></td><td>{orgName(inv.organizationId)}</td>
        <td><span className={st.cls}><span className="status-dot" />{st.label}</span></td><td>{dateTime(inv.expiresAt)}</td>
        <td>{inv.status === 'pending' && <button className="mini-button admin-danger" onClick={() => setRevoking(inv)} data-testid={`button-revoke-${inv.id}`}>Revocar</button>}</td>
      </tr>; })}
      {!invitations.length && <tr><td colSpan={6}><Empty title="Sin invitaciones" detail="Crea una invitación y comparte el enlace de forma segura." icon={MailPlus} /></td></tr>}
    </tbody></table></div>}

    {creating && <Dialog title="Nueva invitación" onClose={() => setCreating(false)}>
      <form className="form-stack" onSubmit={submit}>
        <p className="form-intro">Solo para personas sin cuenta. Se generará un enlace de un solo uso válido durante 72 horas.</p>
        <label>Correo electrónico<input type="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@centro.edu" data-testid="input-invite-email" /></label>
        <label>Rol<select value={role} onChange={(e) => setRole(e.target.value as AccessRole)} data-testid="select-invite-role">{ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
        <label>Organización (opcional)<select value={org} onChange={(e) => setOrg(e.target.value)} data-testid="select-invite-org"><option value="">Sin organización</option>{orgs.filter((o) => o.isActive).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        {formError && <div className="auth-error" role="alert"><CircleAlert size={16} /><span>{formError}</span></div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setCreating(false)}>Cancelar</button><button className="button button-primary" disabled={create.isPending} data-testid="button-submit-invitation">{create.isPending ? 'Creando…' : 'Crear invitación'}</button></div>
      </form>
    </Dialog>}

    {issued && <Dialog title="Enlace de invitación" onClose={() => setIssued(null)}>
      <div className="form-stack">
        <div className="auth-disabled" role="alert"><ShieldAlert size={18} /><div><strong>No se ha enviado ningún correo</strong><p>Copia y comparte este enlace por un canal seguro. Solo se muestra ahora: al cerrar esta ventana no podrás recuperarlo.</p></div></div>
        <p className="form-intro">Para <b>{issued.invitation.email}</b> · {accessRoleLabel(issued.invitation.role)} · caduca {dateTime(issued.invitation.expiresAt)}</p>
        <div className="admin-link"><input readOnly value={link} aria-label="Enlace de invitación" onFocus={(e) => e.currentTarget.select()} data-testid="input-invite-link" /><button className="button button-secondary" onClick={() => void copy()} data-testid="button-copy-link">{copied ? <><CheckCircle2 size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}</button></div>
        <div className="modal-actions"><button className="button button-primary" onClick={() => setIssued(null)} data-testid="button-close-link">He guardado el enlace</button></div>
      </div>
    </Dialog>}

    {revoking && <Dialog title="Revocar invitación" onClose={() => setRevoking(null)}>
      <div className="form-stack">
        <p className="form-intro">El enlace enviado a <b>{revoking.email}</b> dejará de funcionar de inmediato. Esta acción no se puede deshacer.</p>
        <div className="modal-actions"><button className="button button-quiet" onClick={() => setRevoking(null)}>Cancelar</button>
          <button className="button admin-danger-button" disabled={revoke.isPending} data-testid="button-confirm-revoke" onClick={() => revoke.mutate({ id: revoking.id }, {
            onSuccess: () => { onDone(`Invitación para ${revoking.email} revocada.`, 'ok'); setRevoking(null); },
            onError: (err) => { onDone(mutationError(err, 'No se pudo revocar la invitación.'), 'error'); setRevoking(null); },
          })}>{revoke.isPending ? 'Revocando…' : 'Revocar'}</button></div>
      </div>
    </Dialog>}
    <div className="table-footer"><span>{invitations?.length ?? 0} invitaciones</span><span className="footer-simulation"><ShieldCheck size={13} /> Los enlaces nunca se almacenan en el navegador</span></div>
  </>;
}

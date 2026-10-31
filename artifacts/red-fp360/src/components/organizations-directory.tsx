import { type FormEvent, useState } from 'react';
import { Archive, ArchiveRestore, Building2, CircleHelp, Filter, Pencil, Plus, Search, ShieldAlert } from 'lucide-react';
import {
  useCreateFp360Organization, useGetCurrentIdentity, useListFp360Orders, useListFp360Organizations, useUpdateFp360Organization,
} from '@workspace/api-client-react';
import type { Fp360Organization, Fp360OrganizationInputIsland, Fp360OrganizationInputRole, Fp360OrganizationUpdate } from '@workspace/api-client-react';
import { FormError, ISLANDS, MasterDialog, ReadOnlyBanner, WRITE_ROLES, apiErrorMessage, useRefreshMaster } from './master-shared';

const roleLabel = (r: string) => (r === 'both' ? 'Compra y vende' : r === 'seller' ? 'Vende' : 'Compra');

export function OrganizationsDirectory({ onNotice }: { onNotice: (m: string) => void }) {
  const identity = useGetCurrentIdentity();
  const canWrite = WRITE_ROLES.includes(identity.data?.role ?? '');
  const orgs = useListFp360Organizations();
  const orders = useListFp360Orders();
  const update = useUpdateFp360Organization();
  const refresh = useRefreshMaster();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [editing, setEditing] = useState<Fp360Organization | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Fp360Organization | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const all = orgs.data ?? [];
  const q = search.trim().toLowerCase();
  const rows = all.filter((o) => `${o.name} ${o.center} ${o.island}`.toLowerCase().includes(q) && (role === 'all' || o.role === role) && (status === 'all' || (status === 'active' ? o.isActive : !o.isActive)));
  const orderCount = (id: string) => (orders.data ?? []).filter((o) => o.buyerOrganizationId === id).length;

  const toggle = () => {
    if (!confirm) return;
    setConfirmError('');
    update.mutate({ id: confirm.id, data: { isActive: !confirm.isActive } }, {
      onSuccess: (o) => { refresh(); setConfirm(null); onNotice(o.isActive ? `${o.name} restaurada en el directorio.` : `${o.name} archivada. Su historial de pedidos se conserva.`); },
      onError: (err) => setConfirmError(apiErrorMessage(err, 'No se pudo completar la acción.')),
    });
  };

  return <main className="page-content">
    <div className="page-heading page-enter"><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>EMPRESAS SIMULADAS</span></div>
      <div className="heading-row"><div><h1>Directorio de organizaciones</h1><p>Empresas simuladas de los centros de FP de Canarias. Sin datos de contacto reales ni de personas.</p></div>
        {canWrite && <button className="button button-primary" onClick={() => setEditing('new')} data-testid="button-new-org"><Plus size={16} /> Nueva empresa</button>}</div>
    </div>
    {!canWrite && identity.data && <ReadOnlyBanner text="Tu perfil permite consultar el directorio y su historial, pero no modificarlo." />}
    <div className="md-strip">
      <div><span>Activas</span><b>{orgs.data ? all.filter((o) => o.isActive).length : '—'}</b></div>
      <div className="md-strip-ok"><span>Islas representadas</span><b>{orgs.data ? new Set(all.filter((o) => o.isActive).map((o) => o.island)).size : '—'}</b></div>
      <div className="md-strip-warn"><span>Archivadas</span><b>{orgs.data ? all.filter((o) => !o.isActive).length : '—'}</b></div>
      <div className="md-strip-low"><span>Pedidos históricos</span><b>{orders.data?.length ?? '—'}</b></div>
    </div>
    <section className="panel">
      <div className="list-toolbar">
        <div className="tabs" role="tablist" aria-label="Estado">{(['active', 'archived', 'all'] as const).map((s) => <button key={s} role="tab" aria-selected={status === s} className={status === s ? 'tab-active' : ''} onClick={() => setStatus(s)} data-testid={`tab-org-${s}`}>{{ active: 'Activas', archived: 'Archivadas', all: 'Todas' }[s]}</button>)}</div>
        <div className="filter-tools"><label className="search-field"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar empresa, centro o isla" aria-label="Buscar organizaciones" data-testid="input-org-search" /></label>
          <label className="select-filter"><Filter size={14} /><select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filtrar por participación" data-testid="select-org-role-filter"><option value="all">Todas</option><option value="seller">Vendedoras</option><option value="buyer">Compradoras</option><option value="both">Ambas</option></select></label></div>
      </div>
      {orgs.isLoading && <div className="skeleton-list" aria-label="Cargando"><span /><span /><span /></div>}
      {orgs.isError && <div className="inline-error" role="alert"><ShieldAlert size={18} /><span>No se ha podido cargar el directorio.</span><button className="text-button" onClick={() => void orgs.refetch()}>Reintentar</button></div>}
      {orgs.data && <div className="table-scroll redfp-scroll"><table style={{ minWidth: 820 }}><thead><tr><th>Organización</th><th>Centro</th><th>Isla</th><th>Rol en red</th><th>Pedidos históricos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
        {rows.map((o) => <tr key={o.id} className={o.isActive ? '' : 'md-row-archived'} data-testid={`row-org-${o.id}`}>
          <td><div className="org-cell"><span className="org-avatar">{o.name.slice(0, 2).toUpperCase()}</span><span><b>{o.name}</b><small>Empresa simulada</small></span></div></td>
          <td>{o.center}</td><td><span className="island-label">{o.island}</span></td><td><span className="role-pill">{roleLabel(o.role)}</span></td>
          <td className="numeric">{orders.isLoading ? '…' : orderCount(o.id)}</td>
          <td>{o.isActive ? <span className="status status-green"><span className="status-dot" />Activa</span> : <span className="status md-muted"><span className="status-dot" />Archivada</span>}</td>
          <td><div className="row-actions md-actions">{canWrite ? <>
            {o.isActive && <button className="mini-button" onClick={() => setEditing(o)} data-testid={`button-edit-org-${o.id}`}><Pencil size={13} /> Editar</button>}
            {o.isActive ? <button className="mini-button admin-danger" onClick={() => { setConfirmError(''); setConfirm(o); }} data-testid={`button-archive-org-${o.id}`}><Archive size={13} /> Archivar</button>
              : <button className="mini-button" onClick={() => { setConfirmError(''); setConfirm(o); }} data-testid={`button-restore-org-${o.id}`}><ArchiveRestore size={13} /> Restaurar</button>}
          </> : <span className="text-muted">Solo lectura</span>}</div></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><Building2 size={20} /></div><strong>{all.length ? 'Sin coincidencias' : 'Aún no hay empresas'}</strong><p>{all.length ? 'Cambia el filtro o la búsqueda.' : 'Crea la primera empresa simulada de la red.'}</p></div></td></tr>}
      </tbody></table></div>}
      <div className="table-footer"><span>{rows.length} organizaciones</span><span className="footer-simulation"><ShieldAlert size={13} /> Datos ficticios · sin contactos de menores</span></div>
    </section>
    <div className="learning-note"><CircleHelp size={17} /><div><b>Archivar no borra</b><p>Las empresas archivadas no aparecen en el mercado ni en pedidos nuevos, pero conservan sus pedidos y facturas. No se puede archivar una empresa asignada a cuentas activas.</p></div></div>
    {editing && <OrgForm org={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); refresh(); onNotice(m); }} />}
    {confirm && <MasterDialog title={confirm.isActive ? 'Archivar organización' : 'Restaurar organización'} onClose={() => setConfirm(null)}>
      <div className="form-stack">
        <p className="form-intro"><b>{confirm.name}</b> · {confirm.center}</p>
        <p className="form-intro">{confirm.isActive ? `Dejará de aparecer en el mercado y en pedidos nuevos. Sus ${orderCount(confirm.id)} pedidos históricos se conservan.` : 'Volverá a estar disponible en el mercado y para pedidos nuevos.'}</p>
        <FormError text={confirmError} />
        <div className="modal-actions"><button className="button button-quiet" onClick={() => setConfirm(null)}>Cancelar</button><button className={confirm.isActive ? 'button admin-danger-button' : 'button button-primary'} disabled={update.isPending} onClick={toggle} data-testid="button-confirm-org-action">{update.isPending ? 'Guardando…' : 'Confirmar'}</button></div>
      </div>
    </MasterDialog>}
  </main>;
}

function OrgForm({ org, onClose, onSaved }: { org: Fp360Organization | null; onClose: () => void; onSaved: (m: string) => void }) {
  const create = useCreateFp360Organization();
  const update = useUpdateFp360Organization();
  const [name, setName] = useState(org?.name ?? '');
  const [center, setCenter] = useState(org?.center ?? '');
  const [island, setIsland] = useState<string>(org?.island ?? 'Tenerife');
  const [role, setRole] = useState<string>(org?.role ?? 'both');
  const [error, setError] = useState('');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    const n = name.trim(); const c = center.trim();
    if (!n || !c) return setError('Nombre y centro no pueden quedar vacíos.');
    const isl = island as Fp360OrganizationInputIsland; const r = role as Fp360OrganizationInputRole;
    if (!org) {
      create.mutate({ data: { name: n, center: c, island: isl, role: r } }, {
        onSuccess: (o) => onSaved(`${o.name} añadida al directorio.`),
        onError: (err) => setError(apiErrorMessage(err, 'No se pudo crear la organización.')),
      });
    } else {
      const data: Fp360OrganizationUpdate = {};
      if (n !== org.name) data.name = n;
      if (c !== org.center) data.center = c;
      if (isl !== org.island) data.island = isl;
      if (r !== org.role) data.role = r;
      if (!Object.keys(data).length) return onClose();
      update.mutate({ id: org.id, data }, {
        onSuccess: (o) => onSaved(`Cambios guardados en ${o.name}.`),
        onError: (err) => setError(apiErrorMessage(err, 'No se pudieron guardar los cambios.')),
      });
    }
  };
  const pending = create.isPending || update.isPending;
  return <MasterDialog title={org ? `Editar ${org.name}` : 'Nueva empresa simulada'} onClose={onClose}>
    <form className="form-stack" onSubmit={submit} noValidate>
      <p className="form-intro">Empresa ficticia de prácticas. No introduzcas datos personales ni de contacto reales.</p>
      <label>Nombre comercial<input required maxLength={150} value={name} onChange={(e) => setName(e.target.value)} data-testid="input-org-name" /></label>
      <label>Centro educativo<input required maxLength={150} value={center} onChange={(e) => setCenter(e.target.value)} data-testid="input-org-center" /></label>
      <label>Isla<select value={island} onChange={(e) => setIsland(e.target.value)} data-testid="select-org-island">{ISLANDS.map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
      <label>Participación en la red<select value={role} onChange={(e) => setRole(e.target.value)} data-testid="select-org-role"><option value="seller">Vende</option><option value="buyer">Compra</option><option value="both">Compra y vende</option></select></label>
      <FormError text={error} />
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={pending} data-testid="button-save-org">{pending ? 'Guardando…' : org ? 'Guardar cambios' : 'Crear empresa'}</button></div>
    </form>
  </MasterDialog>;
}

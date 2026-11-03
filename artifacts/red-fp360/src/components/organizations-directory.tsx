import { type FormEvent, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Building2, CircleHelp, Filter, Pencil, Plus, Search, ShieldAlert } from 'lucide-react';
import {
  useCreateFp360Organization, useGenerateFp360OrganizationAiProfileProposal, useGetCurrentIdentity, useListFp360OrganizationNetworks, useListFp360Orders, useListFp360Organizations, useUpdateFp360Organization,
} from '@workspace/api-client-react';
import type { Fp360Organization, Fp360OrganizationAiProfileProposal, Fp360OrganizationInput, Fp360OrganizationInputIsland, Fp360OrganizationInputRole, Fp360OrganizationNetwork, Fp360OrganizationUpdate } from '@workspace/api-client-react';
import { FormError, ISLANDS, MasterDialog, ReadOnlyBanner, WRITE_ROLES, apiErrorMessage, useRefreshMaster } from './master-shared';

const roleLabel = (r: string) => (r === 'both' ? 'Compra y vende' : r === 'seller' ? 'Vende' : 'Compra');
const organizationActivities = [
  ['commerce', 'Comercio'],
  ['services', 'Servicios'],
  ['manufacturing', 'Industria y fabricación'],
  ['hospitality', 'Hostelería'],
  ['agriculture', 'Agricultura'],
  ['fishing', 'Pesca y actividad marítima'],
  ['other', 'Otra actividad'],
] as const;
const activityRegime = (activity: string) => activity === 'agriculture'
  ? 'Sistema Especial Agrario (simulado)'
  : activity === 'fishing'
    ? 'Régimen Especial del Mar (simulado)'
    : 'Régimen General (simulado)';

export function OrganizationsDirectory({ onNotice }: { onNotice: (m: string) => void }) {
  const identity = useGetCurrentIdentity();
  const canWrite = WRITE_ROLES.includes(identity.data?.role ?? '');
  const isNetworkSupervisor = identity.data?.role === 'administrator' ||
    (identity.data?.role === 'teacher' && !identity.data.organizationId);
  const canCreateOrganization = canWrite && isNetworkSupervisor;
  const canContinueOrganization = canCreateOrganization && !identity.data?.organizationId;
  const canManageOrganization = (org: Fp360Organization) => canWrite &&
    (isNetworkSupervisor || org.id === identity.data?.organizationId);
  const canArchiveOrganization = canWrite && isNetworkSupervisor;
  const orgs = useListFp360Organizations();
  const networks = useListFp360OrganizationNetworks();
  const orders = useListFp360Orders();
  const update = useUpdateFp360Organization();
  const refresh = useRefreshMaster();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active');
  const [editing, setEditing] = useState<Fp360Organization | 'new' | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [continueId, setContinueId] = useState('');
  const [confirm, setConfirm] = useState<Fp360Organization | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const all = orgs.data ?? [];
  const activeOrganizations = all.filter((organization) => organization.isActive);
  const q = search.trim().toLowerCase();
  const rows = all.filter((o) => `${o.name} ${o.commercialName} ${o.center} ${o.island} ${o.activity}`.toLowerCase().includes(q) && (role === 'all' || o.role === role) && (status === 'all' || (status === 'active' ? o.isActive : !o.isActive)));
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
        {canCreateOrganization && <div className="heading-actions">
          {canContinueOrganization && activeOrganizations.length > 0 && <button className="button button-quiet" onClick={() => { setContinueId(''); setContinuing(true); }} data-testid="button-continue-org"><Building2 size={16} /> Continuar empresa</button>}
          <button className="button button-primary" onClick={() => setEditing('new')} data-testid="button-new-org"><Plus size={16} /> Nueva empresa</button>
        </div>}</div>
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
          <td><div className="org-cell"><OrganizationLogo key={o.logoUrl ?? o.id} organization={o} /><span><b>{o.name}</b><small>{o.commercialName || 'Empresa simulada'}</small></span></div></td>
          <td>{o.center}</td><td><span className="island-label">{o.island}</span></td><td><span className="role-pill">{roleLabel(o.role)}</span></td>
          <td className="numeric">{orders.isLoading ? '…' : orderCount(o.id)}</td>
          <td>{o.isActive ? <span className="status status-green"><span className="status-dot" />Activa</span> : <span className="status md-muted"><span className="status-dot" />Archivada</span>}</td>
          <td><div className="row-actions md-actions">{canManageOrganization(o) ? <>
            {o.isActive && <button className="mini-button" onClick={() => setEditing(o)} data-testid={`button-edit-org-${o.id}`}><Pencil size={13} /> Editar</button>}
            {canArchiveOrganization && (o.isActive
              ? <button className="mini-button admin-danger" onClick={() => { setConfirmError(''); setConfirm(o); }} data-testid={`button-archive-org-${o.id}`}><Archive size={13} /> Archivar</button>
              : <button className="mini-button" onClick={() => { setConfirmError(''); setConfirm(o); }} data-testid={`button-restore-org-${o.id}`}><ArchiveRestore size={13} /> Restaurar</button>)}
          </> : <span className="text-muted">Solo lectura</span>}</div></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={7}><div className="empty-state"><div className="empty-icon"><Building2 size={20} /></div><strong>{all.length ? 'Sin coincidencias' : 'Aún no hay empresas'}</strong><p>{all.length ? 'Cambia el filtro o la búsqueda.' : 'Crea la primera empresa simulada de la red.'}</p></div></td></tr>}
      </tbody></table></div>}
      <div className="table-footer"><span>{rows.length} organizaciones</span><span className="footer-simulation"><ShieldAlert size={13} /> Datos ficticios · sin contactos de menores</span></div>
    </section>
    <div className="learning-note"><CircleHelp size={17} /><div><b>Archivar no borra</b><p>Las empresas archivadas no aparecen en el mercado ni en pedidos nuevos, pero conservan sus pedidos y facturas. No se puede archivar una empresa asignada a cuentas activas.</p></div></div>
    {editing && <OrgForm org={editing === 'new' ? null : editing} canEditNetworkFields={isNetworkSupervisor}
      networks={networks.data ?? []} networkError={networks.isError}
      onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); refresh(); onNotice(m); }} />}
    {continuing && <MasterDialog title="Continuar una empresa existente" onClose={() => setContinuing(false)}>
      <div className="form-stack">
        <p className="form-intro">Selecciona una empresa activa para continuar su actividad. No se creará una copia ni se alterará su historial.</p>
        <label>Empresa<select value={continueId} onChange={(event) => setContinueId(event.target.value)} data-testid="select-continue-org">
          <option value="">Selecciona una empresa</option>
          {all.filter((organization) => organization.isActive).map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.center}</option>)}
        </select></label>
        <div className="modal-actions">
          <button className="button button-quiet" onClick={() => setContinuing(false)}>Cancelar</button>
          <button className="button button-primary" disabled={!continueId || !identity.data?.tenantId || !identity.data?.id}
            onClick={() => {
              if (!continueId || !identity.data?.tenantId || !identity.data?.id) return;
              try {
                window.localStorage.setItem(`redfp360:active-organization:${identity.data.tenantId}:${identity.data.id}`, continueId);
                window.location.assign('/');
              } catch {
                onNotice('No se pudo guardar la empresa activa en este navegador.');
              }
            }} data-testid="button-open-existing-org">Continuar empresa</button>
        </div>
      </div>
    </MasterDialog>}
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

function OrganizationLogo({ organization }: { organization: Fp360Organization }) {
  const [failed, setFailed] = useState(false);
  const showLogo = Boolean(organization.logoUrl) && !failed;
  return <span className={`org-avatar${showLogo ? ' org-avatar-with-logo' : ''}`}>
    {showLogo
      ? <img src={organization.logoUrl!} alt={`Logotipo de ${organization.name}`} onError={() => setFailed(true)} />
      : organization.name.slice(0, 2).toUpperCase()}
  </span>;
}

function OrgForm({ org, canEditNetworkFields, networks, networkError, onClose, onSaved }: {
  org: Fp360Organization | null; canEditNetworkFields: boolean;
  networks: Fp360OrganizationNetwork[]; networkError: boolean;
  onClose: () => void; onSaved: (m: string) => void;
}) {
  const create = useCreateFp360Organization();
  const generateProposal = useGenerateFp360OrganizationAiProfileProposal();
  const update = useUpdateFp360Organization();
  const [name, setName] = useState(org?.name ?? '');
  const [center, setCenter] = useState(org?.center ?? '');
  const [island, setIsland] = useState<string>(org?.island ?? 'Tenerife');
  const [role, setRole] = useState<string>(org?.role ?? 'both');
  const [activity, setActivity] = useState<Fp360OrganizationInput['activity']>(org?.activity ?? 'commerce');
  const [initialDataMode, setInitialDataMode] = useState<'blank' | 'ai'>('blank');
  const [simulationNetworkId, setSimulationNetworkId] = useState(org?.simulationNetworkId ?? networks[0]?.id ?? '');
  const [proposal, setProposal] = useState<Fp360OrganizationAiProfileProposal | null>(null);
  const [proposalReviewed, setProposalReviewed] = useState(false);
  const [commercialName, setCommercialName] = useState(org?.commercialName ?? '');
  const [address, setAddress] = useState(org?.address ?? '');
  const [municipality, setMunicipality] = useState(org?.municipality ?? '');
  const [postalCode, setPostalCode] = useState(org?.postalCode ?? '');
  const [businessEmail, setBusinessEmail] = useState(org?.businessEmail ?? '');
  const [businessPhone, setBusinessPhone] = useState(org?.businessPhone ?? '');
  const [calendarMode, setCalendarMode] = useState<Fp360OrganizationInput['simulationCalendarMode']>(
    org?.simulationCalendarMode ?? networks[0]?.calendarMode ?? 'ordinary',
  );
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(
    org?.fiscalYearStartMonth ?? networks[0]?.fiscalYearStartMonth ?? 1,
  );
  const [academicPeriod, setAcademicPeriod] = useState(org?.academicPeriod ?? '2027-2028');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(org?.logoUrl ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const invalidateProposalContext = () => {
    setProposal(null);
    setProposalReviewed(false);
  };
  const markProposalNeedsReview = () => setProposalReviewed(false);
  const requestProposal = async () => {
    setError('');
    if (!simulationNetworkId || !center.trim()) {
      setError('Selecciona una red económica e indica el centro antes de generar la propuesta.');
      return;
    }
    try {
      const generated = await generateProposal.mutateAsync({ data: {
        simulationNetworkId, center: center.trim(), island: island as Fp360OrganizationInputIsland, activity,
      } });
      setProposal(generated);
      setProposalReviewed(false);
      setName(generated.name);
      setCommercialName(generated.commercialName);
      setAddress(generated.address);
      setMunicipality(generated.municipality);
      setPostalCode(generated.postalCode);
      setError('');
    } catch (proposalError) {
      setProposal(null);
      setProposalReviewed(false);
      setError(apiErrorMessage(proposalError, 'No se pudo generar una propuesta ficticia. Comprueba la configuración de IA.'));
    }
  };
  useEffect(() => {
    if (!logoPreview?.startsWith('blob:')) return;
    return () => URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);
  useEffect(() => {
    if (!org && !simulationNetworkId && networks.length) setSimulationNetworkId(networks[0].id);
  }, [networks, org, simulationNetworkId]);
  const selectedNetwork = networks.find((network) => network.id === simulationNetworkId);
  useEffect(() => {
    if (!org && selectedNetwork) {
      setCalendarMode(selectedNetwork.calendarMode);
      setFiscalYearStartMonth(selectedNetwork.fiscalYearStartMonth);
    }
  }, [org, selectedNetwork?.id, selectedNetwork?.calendarMode, selectedNetwork?.fiscalYearStartMonth]);

  const selectLogo = (file: File | null) => {
    setError('');
    if (!file) {
      setLogoFile(null);
      setLogoPreview(org?.logoUrl ?? null);
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setLogoFile(null);
      setLogoPreview(org?.logoUrl ?? null);
      setError('El logo debe ser PNG, JPG o WebP y no superar 2 MB.');
      return;
    }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    const n = name.trim(); const c = center.trim();
    if (!n || !c) return setError('Nombre y centro no pueden quedar vacíos.');
    const academicYears = /^(\d{4})-(\d{4})$/.exec(academicPeriod.trim());
    if (!academicYears || Number(academicYears[2]) !== Number(academicYears[1]) + 1) {
      return setError('Indica un curso escolar consecutivo con el formato 2027-2028.');
    }
    const isl = island as Fp360OrganizationInputIsland; const r = role as Fp360OrganizationInputRole;
    const profile = {
      name: n,
      center: c,
      island: isl,
      role: r,
      activity,
      commercialName: commercialName.trim(),
      address: address.trim(),
      municipality: municipality.trim(),
      postalCode: postalCode.trim(),
      businessEmail: businessEmail.trim(),
      businessPhone: businessPhone.trim(),
      simulationCalendarMode: calendarMode ?? 'ordinary',
      fiscalYearStartMonth,
      academicPeriod: academicPeriod.trim(),
    };
    setSaving(true);
    try {
      let saved: Fp360Organization;
      if (!org) {
        if (initialDataMode === 'ai' && (!proposal || proposal.simulationNetworkId !== simulationNetworkId || !proposalReviewed)) {
          setSaving(false);
          setError('Genera y revisa la propuesta ficticia antes de activar la empresa.');
          return;
        }
        saved = await create.mutateAsync({ data: {
          ...profile,
          simulationNetworkId,
          creationMode: initialDataMode === 'ai' ? 'ai_reviewed' : 'blank',
          ...(initialDataMode === 'ai' ? { proposalReviewAcknowledged: true, proposalToken: proposal!.proposalToken } : {}),
        } });
      } else {
        const data: Fp360OrganizationUpdate = {};
        if (n !== org.name) data.name = n;
        if (canEditNetworkFields && c !== org.center) data.center = c;
        if (canEditNetworkFields && isl !== org.island) data.island = isl;
        if (canEditNetworkFields && r !== org.role) data.role = r;
        if (canEditNetworkFields && profile.simulationCalendarMode !== org.simulationCalendarMode) data.simulationCalendarMode = profile.simulationCalendarMode;
        if (canEditNetworkFields && fiscalYearStartMonth !== org.fiscalYearStartMonth) data.fiscalYearStartMonth = fiscalYearStartMonth;
        if (canEditNetworkFields && profile.academicPeriod !== org.academicPeriod) data.academicPeriod = profile.academicPeriod;
        if (activity !== org.activity) data.activity = activity;
        if (profile.commercialName !== org.commercialName) data.commercialName = profile.commercialName;
        if (profile.address !== org.address) data.address = profile.address;
        if (profile.municipality !== org.municipality) data.municipality = profile.municipality;
        if (profile.postalCode !== org.postalCode) data.postalCode = profile.postalCode;
        if (profile.businessEmail !== org.businessEmail) data.businessEmail = profile.businessEmail;
        if (profile.businessPhone !== org.businessPhone) data.businessPhone = profile.businessPhone;
        if (Object.keys(data).length || logoFile) {
          saved = Object.keys(data).length
            ? await update.mutateAsync({ id: org.id, data })
            : org;
        } else {
          onClose();
          return;
        }
      }
      if (logoFile) {
        try {
          await uploadOrganizationLogo(saved.id, logoFile);
        } catch (uploadError) {
          onSaved(`${saved.name} se guardó, pero no se pudo cargar el logo. Edita la empresa para volver a intentarlo.`);
          return;
        }
      }
      onSaved(org ? `Cambios guardados en ${saved.name}.` : `${saved.name} añadida a ${saved.simulationNetworkName} sin operaciones iniciales.`);
    } catch (saveError) {
      setError(apiErrorMessage(saveError, org ? 'No se pudieron guardar los cambios.' : 'No se pudo crear la organización.'));
    } finally {
      setSaving(false);
    }
  };
  const pending = saving || create.isPending || update.isPending || generateProposal.isPending;
  return <MasterDialog title={org ? `Editar ${org.name}` : 'Nueva empresa simulada'} onClose={onClose}>
    <form className="form-stack" onSubmit={submit} noValidate>
      <p className="form-intro">Ficha de empresa simulada. Usa datos de práctica, nunca identificadores ni datos de contacto reales.</p>
      {!org && <>
        <fieldset className="org-onboarding-options">
          <legend>Cómo quieres empezar</legend>
          <button type="button" className={initialDataMode === 'blank' ? 'org-onboarding-choice active' : 'org-onboarding-choice'}
            aria-pressed={initialDataMode === 'blank'} onClick={() => { setInitialDataMode('blank'); setProposal(null); setProposalReviewed(false); }}>
            <b>Empezar en blanco</b><small>Completa tú la ficha. No se crean operaciones.</small>
          </button>
          <button type="button" className={initialDataMode === 'ai' ? 'org-onboarding-choice active' : 'org-onboarding-choice'}
            aria-pressed={initialDataMode === 'ai'} onClick={() => { setInitialDataMode('ai'); setProposalReviewed(false); }}>
            <b>Generar datos ficticios con IA</b><small>Revisa y edita una propuesta antes de crear la empresa.</small>
          </button>
        </fieldset>
        <label>Red económica<select required value={simulationNetworkId}
          onChange={(event) => { setSimulationNetworkId(event.target.value); invalidateProposalContext(); }} data-testid="select-org-economic-network">
          <option value="">Selecciona una red</option>
          {networks.map((network) => <option key={network.id} value={network.id}>{network.name} · {network.calendarMode === 'accelerated' ? 'calendario acelerado' : 'calendario ordinario'}</option>)}
        </select></label>
        {networkError && <p className="field-error" role="alert">No se pudieron consultar las redes económicas. Cierra el formulario y vuelve a intentarlo.</p>}
        {!networkError && !networks.length && <p className="field-error" role="alert">No hay redes económicas activas disponibles para esta empresa.</p>}
        {initialDataMode === 'ai' && <div className="org-ai-proposal-box">
          <div><b>Propuesta de ficha, sin operaciones</b><p>La IA solo sugerirá datos ficticios de empresa. Revisa o edita los campos y confirma la revisión para crear la empresa. No crea productos, pedidos, facturas, empleados ni movimientos.</p></div>
          <button type="button" className="button button-quiet" onClick={() => void requestProposal()}
          disabled={generateProposal.isPending || !simulationNetworkId || !center.trim() || networkError} data-testid="button-generate-org-profile">
            {generateProposal.isPending ? 'Generando…' : proposal ? 'Generar otra propuesta' : 'Generar propuesta'}
          </button>
          {proposal && <p className="org-ai-network-note">Propuesta asociada a {proposal.simulationNetworkName}. {proposal.description} Se mantiene como borrador hasta que una persona la revise y cree la empresa.</p>}
        </div>}
      </>}
      <div className="org-profile-grid">
        <label>Razón social / nombre<input required maxLength={150} value={name} onChange={(e) => { setName(e.target.value); markProposalNeedsReview(); }} data-testid="input-org-name" /></label>
        <label>Nombre comercial<input maxLength={150} value={commercialName} onChange={(e) => { setCommercialName(e.target.value); markProposalNeedsReview(); }} data-testid="input-org-commercial-name" /></label>
        <label>Actividad<select value={activity} onChange={(e) => { setActivity(e.target.value as Fp360OrganizationInput['activity']); invalidateProposalContext(); }} data-testid="select-org-activity">{organizationActivities.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Régimen de Seguridad Social · simulación<input readOnly value={activityRegime(activity)} /></label>
        <label>Centro educativo<input required maxLength={150} value={center} onChange={(e) => { setCenter(e.target.value); invalidateProposalContext(); }} disabled={!canEditNetworkFields} data-testid="input-org-center" /></label>
        <label>Isla<select value={island} onChange={(e) => { setIsland(e.target.value); invalidateProposalContext(); }} disabled={!canEditNetworkFields} data-testid="select-org-island">{ISLANDS.map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
        <label>Participación en la red<select value={role} onChange={(e) => setRole(e.target.value)} disabled={!canEditNetworkFields} data-testid="select-org-role"><option value="seller">Vende</option><option value="buyer">Compra</option><option value="both">Compra y vende</option></select></label>
        <label>Calendario económico<select value={calendarMode ?? 'ordinary'} onChange={(e) => setCalendarMode(e.target.value as Fp360OrganizationInput['simulationCalendarMode'])} disabled={!org || !canEditNetworkFields} data-testid="select-org-calendar-mode"><option value="ordinary">Ordinario · ejercicio continuo</option><option value="accelerated">Acelerado · 12 meses por curso</option></select></label>
        <label>Inicio del ejercicio fiscal<select value={fiscalYearStartMonth} onChange={(e) => setFiscalYearStartMonth(Number(e.target.value))} disabled={!org || !canEditNetworkFields} data-testid="select-org-fiscal-start-month">{Array.from({ length: 12 }, (_, i) => i + 1).map((month) => <option key={month} value={month}>{new Intl.DateTimeFormat('es', { month: 'long' }).format(new Date(2020, month - 1, 1))}</option>)}</select></label>
        <label>Curso escolar independiente<input required maxLength={9} pattern="[0-9]{4}-[0-9]{4}" value={academicPeriod} onChange={(e) => setAcademicPeriod(e.target.value)} disabled={!canEditNetworkFields} placeholder="2027-2028" data-testid="input-org-academic-period" /></label>
        <label>Dirección simulada<input maxLength={200} value={address} onChange={(e) => { setAddress(e.target.value); markProposalNeedsReview(); }} data-testid="input-org-address" /></label>
        <label>Municipio<input maxLength={100} value={municipality} onChange={(e) => { setMunicipality(e.target.value); markProposalNeedsReview(); }} data-testid="input-org-municipality" /></label>
        <label>Código postal<input maxLength={12} value={postalCode} onChange={(e) => { setPostalCode(e.target.value); markProposalNeedsReview(); }} data-testid="input-org-postal-code" /></label>
        <label>Correo de empresa simulado<input maxLength={150} value={businessEmail} onChange={(e) => setBusinessEmail(e.target.value)} data-testid="input-org-email" /></label>
        <label>Teléfono de empresa simulado<input maxLength={40} value={businessPhone} onChange={(e) => setBusinessPhone(e.target.value)} data-testid="input-org-phone" /></label>
      </div>
      {!org && initialDataMode === 'ai' && proposal && <label className="org-ai-review-check">
        <input type="checkbox" checked={proposalReviewed} onChange={(event) => setProposalReviewed(event.target.checked)} data-testid="checkbox-review-org-proposal" />
        He revisado los datos ficticios y autorizo crear la ficha en {proposal.simulationNetworkName}.
      </label>}
      <div className="org-profile-readonly" aria-label="Identificadores de práctica">
        <label>CIF ficticio<input readOnly value={org?.cif ?? 'Se genera al crear la empresa'} /></label>
        <label>Número de Seguridad Social ficticio<input readOnly value={org?.socialSecurityNumber ?? 'Se genera al crear la empresa'} /></label>
      </div>
      <div className="org-logo-row">
        <div className="org-logo-preview">{logoPreview ? <img src={logoPreview} alt="Vista previa del logo de la empresa" /> : <Building2 size={21} />}</div>
        <label className="org-logo-field">Logo de empresa (PNG, JPG o WebP · máx. 2 MB)
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const input = e.currentTarget; const file = input.files?.[0] ?? null; if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024)) input.value = ''; selectLogo(file); }} data-testid="input-org-logo" />
        </label>
      </div>
      <FormError text={error} />
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={pending || (!org && (!simulationNetworkId || networkError || !networks.length || (initialDataMode === 'ai' && (!proposal || !proposalReviewed))))} data-testid="button-save-org">{pending ? 'Guardando…' : org ? 'Guardar cambios' : 'Crear empresa'}</button></div>
    </form>
  </MasterDialog>;
}

async function uploadOrganizationLogo(organizationId: string, file: File): Promise<void> {
  const url = `/api/redfp360/organizations/${encodeURIComponent(organizationId)}`;
  const uploadRequest = await fetch(`${url}/logo-upload`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  });
  const uploadResult = await uploadRequest.json().catch(() => null) as { uploadURL?: string; error?: string } | null;
  if (!uploadRequest.ok || !uploadResult?.uploadURL) {
    throw new Error(uploadResult?.error || 'No se pudo preparar la carga del logo.');
  }
  const uploaded = await fetch(uploadResult.uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!uploaded.ok) throw new Error('No se pudo transferir el archivo del logo.');
  const completed = await fetch(`${url}/logo-complete`, { method: 'POST', credentials: 'same-origin' });
  if (!completed.ok) {
    const result = await completed.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error || 'No se pudo guardar el logo.');
  }
}

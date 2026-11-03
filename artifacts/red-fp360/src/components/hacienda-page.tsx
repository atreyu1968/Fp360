import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BadgeCheck, CalendarDays, Check,
  CircleAlert, ClipboardCheck, Clock3, ExternalLink, FileCheck2, FilePlus2, FileText,
  History, Landmark, LockKeyhole, RefreshCw, ShieldAlert, Wallet, X,
} from 'lucide-react';
import {
  getGetFp360TaxOverviewQueryKey, useActOnFp360TaxDeclaration,
  useActOnFp360TaxRequirement, useCreateFp360TaxDeclaration,
  useCreateFp360TaxRequirement, useGetFp360TaxOverview, useUpdateFp360TaxProfile,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360Organization, Fp360TaxDeclaration, Fp360TaxOverview,
  Fp360TaxModelTemplate,
} from '@workspace/api-client-react';
import './hacienda-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'calendar' | 'igic' | 'retentions' | 'draft' | 'requirements' | 'payments' | 'history';
type Agency = 'atc' | 'aeat';
const agencyModels: Record<Agency, string[]> = {
  atc: ['400', '415', '420', '421', '425'],
  aeat: ['036', '111', '190', '115', '180', '200', '130', '131', '100', '347'],
};
const agencyNames: Record<Agency, string> = { aeat: 'Hacienda estatal · AEAT', atc: 'Hacienda Canaria · ATC' };
const payrollMonthNames = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const payrollCoverageFor = (periodKeys: string[]) => {
  const monthNumbers = new Set(periodKeys.map((periodKey) => Number(periodKey.slice(-2))));
  const includedMonths = payrollMonthNames.filter((_, index) => monthNumbers.has(index + 1));
  const missingMonths = payrollMonthNames.filter((_, index) => !monthNumbers.has(index + 1));
  return { includedMonths, missingMonths };
};
const payrollCoverageFields = new Set([
  'payrollCoverage', 'payrollIncludedMonths', 'payrollMissingMonths',
]);
const tabs: Array<{ id: View; label: string; icon: typeof CalendarDays }> = [
  { id: 'calendar', label: 'Calendario fiscal', icon: CalendarDays },
  { id: 'igic', label: 'IGIC', icon: ArrowRight },
  { id: 'retentions', label: 'Retenciones', icon: FileText },
  { id: 'draft', label: 'Modelos', icon: FilePlus2 },
  { id: 'requirements', label: 'Requerimientos', icon: ClipboardCheck },
  { id: 'payments', label: 'Pagos y devoluciones', icon: Wallet },
  { id: 'history', label: 'Historial', icon: History },
];
const statuses: Record<string, string> = {
  scheduled: 'Programado', draft: 'Borrador', pending_review: 'Pendiente de revisión',
  validated: 'Validado', presented: 'Presentado', payment_pending: 'Pago solicitado',
  paid: 'Pagado · Banco FP360', refund_pending: 'Devolución pendiente', closed: 'Cerrado',
  observed: 'Con observaciones', rectified: 'Rectificado', overdue: 'Vencimiento superado',
  open: 'Abierto', answered: 'Respondido', resolved: 'Resuelto',
};
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
};
const euro = (cents?: number | null) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);
const operationId = () => crypto.randomUUID();
const readOnlyRole = (role: AuthIdentity['role']) => ['promoter', 'mentor'].includes(role);
function Status({ value }: { value?: string | null }) {
  const tone = ['paid', 'validated', 'presented', 'closed', 'resolved'].includes(value ?? '') ? 'good' :
    ['overdue', 'observed', 'open'].includes(value ?? '') ? 'warn' : 'neutral';
  return <span className={`hacienda-status ${tone}`} data-testid={`status-hacienda-${value ?? 'none'}`}><i />{statuses[value ?? ''] ?? value ?? 'Sin estado'}</span>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="hacienda-empty"><span><FileCheck2 size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Skeleton() {
  return <div className="hacienda-skeleton" role="status" aria-label="Cargando información fiscal"><span /><span /><span /><span /></div>;
}
function ErrorNotice({ retry, message }: { retry: () => void; message?: string }) {
  return <div className="hacienda-error" role="alert"><CircleAlert size={17} /><span>{message || 'No se ha podido cargar la información fiscal.'}</span><button type="button" onClick={retry}>Reintentar</button></div>;
}
function Metric({ label, value, note, icon: Icon, tone = '' }: { label: string; value: string; note: string; icon: typeof Wallet; tone?: string }) {
  return <article className={`hacienda-metric ${tone}`}><span><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{note}</em></article>;
}
function SectionHead({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="hacienda-section-head"><div><span className="hacienda-overline">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</header>;
}
const modelTitle = (model?: Fp360TaxModelTemplate) => model?.label ?? `Modelo ${model?.modelCode ?? ''}`;
const applicabilityLabel = (model: Fp360TaxModelTemplate) => model.applicabilityStatus === 'applies'
  ? 'APLICA AL PERFIL GUARDADO'
  : model.applicabilityStatus === 'review_required' ? 'REVISIÓN DE OBLIGACIÓN NECESARIA' : 'NO APLICA AL PERFIL GUARDADO';

export function HaciendaPage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const [view, setView] = useState<View>('calendar');
  const [agency, setAgency] = useState<Agency>('atc');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(identity.organizationId ?? organizations[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [requirementTarget, setRequirementTarget] = useState<Fp360TaxDeclaration | null>(null);
  const [selectedModelCode, setSelectedModelCode] = useState('');
  const [payrollQuarter, setPayrollQuarter] = useState('2027-Q3');
  const organizationId = identity.organizationId ?? selectedOrganizationId;
  const organizationLabel = organizations.find((org) => org.id === organizationId)?.name ?? organizationId;
  const canChooseOrganization = !identity.organizationId && ['teacher', 'administrator'].includes(identity.role);
  const readOnly = readOnlyRole(identity.role);
  const canTeach = ['teacher', 'administrator'].includes(identity.role);
  useEffect(() => {
    if (!identity.organizationId && !selectedOrganizationId && organizations[0]) setSelectedOrganizationId(organizations[0].id);
  }, [identity.organizationId, organizations, selectedOrganizationId]);

  const queryKey = getGetFp360TaxOverviewQueryKey({ organizationId });
  const overviewQuery = useGetFp360TaxOverview({ organizationId }, { query: { enabled: !!organizationId, queryKey } });
  const createDeclaration = useCreateFp360TaxDeclaration();
  const actDeclaration = useActOnFp360TaxDeclaration();
  const createRequirement = useCreateFp360TaxRequirement();
  const actRequirement = useActOnFp360TaxRequirement();
  const updateProfile = useUpdateFp360TaxProfile();
  const data = overviewQuery.data as Fp360TaxOverview | undefined;
  const modelCatalog = data?.modelCatalog ?? [];
  const models = useMemo(() => modelCatalog.filter((model) => model.agency === agency && agencyModels[agency].includes(model.modelCode)), [modelCatalog, agency]);
  const selectedModel = models.find((item) => item.modelCode === selectedModelCode) ?? models[0];
  const agencyCodes = new Set(models.map((item) => item.modelCode));
  const declarations = useMemo(() => (data?.declarations ?? []).filter((item) => agencyCodes.has(item.modelCode)), [data?.declarations, agencyCodes]);
  const declarationIds = useMemo(() => new Set(declarations.map((item) => item.id)), [declarations]);
  const obligations = useMemo(() => (data?.obligations ?? []).filter((item) => item.agency === agency && agencyCodes.has(item.modelCode)), [data?.obligations, agency, agencyCodes]);
  const requirements = useMemo(() => (data?.requirements ?? []).filter((item) => declarationIds.has(item.declarationId)), [data?.requirements, declarationIds]);
  const requirementIds = useMemo(() => new Set(requirements.map((item) => item.id)), [requirements]);
  const events = useMemo(() => (data?.events ?? []).filter((item) =>
    (item.declarationId !== null && declarationIds.has(item.declarationId)) ||
    (item.requirementId !== null && requirementIds.has(item.requirementId)) ||
    (item.declarationId === null && item.requirementId === null && models.some((m) => item.description.includes(m.modelCode))),
  ), [data?.events, declarationIds, requirementIds, models]);
  const sources = data?.sourceDocuments ?? [];
  const payrollSources = data?.payrollSources ?? [];
  const latestPayrollSources = useMemo(() => {
    const latest = new Map<string, (typeof payrollSources)[number]>();
    for (const source of payrollSources) {
      const previous = latest.get(source.periodKey);
      if (!previous || source.version > previous.version) latest.set(source.periodKey, source);
    }
    return [...latest.values()];
  }, [payrollSources]);
  const payrollSourceById = useMemo(() => new Map(payrollSources.map((source) => [source.id, source])), [payrollSources]);
  const term = search.trim().toLocaleLowerCase('es');
  const filteredSources = useMemo(() => sources.filter((item) =>
    `${item.reference} ${item.counterparty} ${item.status}`.toLocaleLowerCase('es').includes(term)), [sources, term]);
  const filteredDeclarations = useMemo(() => declarations.filter((item) =>
    `${item.modelCode} ${item.periodKey} ${item.status} ${item.receiptReference ?? ''}`.toLocaleLowerCase('es').includes(term)), [declarations, term]);
  const retry = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const invalidate = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
  const declarationsFor = (modelCode: string) => declarations.filter((entry) => entry.modelCode === modelCode);
  const availableTabs = tabs.filter(({ id }) => !(agency === 'atc' && id === 'retentions') && !(agency === 'aeat' && id === 'igic'));
  const switchAgency = (next: Agency) => {
    setAgency(next);
    setView('calendar');
    setFormError('');
    setActionError('');
    setSearch('');
    setSelectedModelCode('');
  };
  const actOnDeclaration = (item: Fp360TaxDeclaration, action: 'recalculate' | 'validate' | 'present' | 'request_payment' | 'rectify' | 'close' | 'observe') => {
    setBusyId(item.id); setActionError('');
    actDeclaration.mutate({ id: item.id, data: { action, operationId: operationId(), ...(action === 'observe' ? { reason: 'Revisión docente del escenario educativo.' } : {}) } }, {
      onSuccess: () => {
        invalidate(); setBusyId('');
        const messages: Record<string, string> = {
          recalculate: 'Borrador recalculado desde los documentos de origen.',
          validate: 'Validación del borrador registrada.',
          present: 'Presentación simulada registrada con su justificante.',
          request_payment: 'Solicitud educativa registrada. El pago queda pendiente de confirmación en Banco FP360.',
          rectify: 'Solicitud de rectificación registrada como nueva versión didáctica.',
          close: 'Modelo cerrado en el escenario educativo.',
          observe: 'Observación docente registrada.',
        };
        onNotice(messages[action]);
      },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo aplicar la acción fiscal.')); },
    });
  };
  const actOnRequirement = (id: string, action: 'respond' | 'resolve', response?: string) => {
    setBusyId(id); setActionError('');
    actRequirement.mutate({ id, data: { action, operationId: operationId(), ...(response !== undefined ? { response } : {}) } }, {
      onSuccess: () => { invalidate(); setBusyId(''); onNotice(action === 'respond' ? 'Respuesta al requerimiento registrada.' : 'Requerimiento resuelto en el escenario educativo.'); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo actualizar el requerimiento.')); },
    });
  };
  const submitDeclaration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    if (!organizationId) { setFormError('Selecciona una empresa antes de preparar un modelo.'); return; }
    if (readOnly) { setFormError('Tu perfil tiene acceso de solo lectura.'); return; }
    if (!data?.taxProfile) { setFormError('El equipo docente debe configurar el perfil fiscal antes de crear modelos.'); return; }
    if (!selectedModel) { setFormError('No hay modelos disponibles para esta sección.'); return; }
    if (selectedModel.applicabilityStatus !== 'applies' && !canTeach) {
      setFormError(selectedModel.applicabilityStatus === 'review_required'
        ? 'La obligación debe revisarse con el organismo competente antes de preparar este modelo.'
        : 'Este modelo no aplica al perfil fiscal guardado. Solicita revisión docente.');
      return;
    }
    const fd = new FormData(event.currentTarget);
    const periodKey = String(fd.get('periodKey') ?? '').trim();
    if (!/^\d{4}(-Q[1-4])?$/.test(periodKey)) { setFormError('Usa un ejercicio (2027) o un trimestre (2027-Q3).'); return; }
    const formData: Record<string, string> = {};
    selectedModel.formFields.forEach((field) => {
      const value = fd.get(field.key);
      formData[field.key] = field.kind === 'checkbox' ? (value === 'on' ? 'true' : 'false') : String(value ?? '').trim();
    });
    const emptyRequired = selectedModel.formFields.find((field) => field.required && !formData[field.key]);
    if (emptyRequired) { setFormError(`Completa el campo requerido: ${emptyRequired.label}.`); return; }
    createDeclaration.mutate({ data: {
      organizationId, taxType: selectedModel.taxType, modelCode: selectedModel.modelCode as never,
      periodKey, formData, operationId: operationId(),
    } }, {
      onSuccess: () => { invalidate(); onNotice('Borrador fiscal educativo creado. No tiene validez oficial.'); setView('draft'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo crear el borrador.')),
    });
  };
  const importPayrollDraft = (modelCode: '111' | '190', periodKey: string) => {
    const start = periodKey === '2027'
      ? '2027-01-01'
      : `${periodKey.slice(0, 4)}-${String((Number(periodKey.slice(-1)) - 1) * 3 + 1).padStart(2, '0')}-01`;
    const end = periodKey === '2027'
      ? '2027-12'
      : `${periodKey.slice(0, 4)}-${String(Number(periodKey.slice(-1)) * 3).padStart(2, '0')}`;
    const eligibleSources = latestPayrollSources.filter((source) =>
      ['closed', 'issued', 'payment_prepared', 'paid_simulated'].includes(source.status)
      && source.periodKey >= start.slice(0, 7)
      && source.periodKey <= end);
    if (!organizationId || eligibleSources.length === 0) {
      setActionError('No hay nóminas cerradas disponibles para ese periodo.');
      return;
    }
    setActionError('');
    setBusyId(`payroll-${modelCode}-${periodKey}`);
    createDeclaration.mutate({ data: {
      organizationId, taxType: 'withholding', modelCode, periodKey,
      sourcePayrollRunIds: eligibleSources.map((source) => source.id),
      operationId: operationId(),
    } }, {
      onSuccess: () => {
        invalidate();
        setBusyId('');
        setSelectedModelCode(modelCode);
        setView('draft');
        onNotice(`Borrador AEAT ${modelCode} creado desde ${eligibleSources.length} nómina(s) cerrada(s). Revisa los periodos y los importes antes de continuar.`);
      },
      onError: (error) => {
        setBusyId('');
        setActionError(errorText(error, 'No se pudo crear el borrador desde nóminas.'));
      },
    });
  };
  const submitProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    if (!organizationId || !canTeach) return;
    const fd = new FormData(event.currentTarget);
    const entityType = String(fd.get('entityType') ?? '');
    const igicRegime = String(fd.get('igicRegime') ?? '');
    const incomeTaxMethod = entityType === 'sociedad' ? 'not_applicable' : String(fd.get('incomeTaxMethod') ?? '');
    const boolField = (name: string) => String(fd.get(name)) === 'true';
    if (!entityType || !igicRegime || (entityType === 'autonomo' && !incomeTaxMethod)) {
      setFormError('Completa el tipo legal, el régimen IGIC y el método IRPF cuando corresponda.'); return;
    }
    if (['hasEmployees', 'withholdsProfessionals', 'paysBusinessRent'].some((key) => !['true', 'false'].includes(String(fd.get(key))))) {
      setFormError('Indica Sí o No para cada circunstancia de actividad.'); return;
    }
    updateProfile.mutate({ data: {
      organizationId,
      entityType: entityType as 'autonomo' | 'sociedad',
      igicRegime: igicRegime as 'general' | 'simplified',
      incomeTaxMethod: incomeTaxMethod as 'direct' | 'objective' | 'not_applicable',
      hasEmployees: boolField('hasEmployees'),
      withholdsProfessionals: boolField('withholdsProfessionals'),
      paysBusinessRent: boolField('paysBusinessRent'),
      operationId: operationId(),
    } }, {
      onSuccess: () => { invalidate(); setFormError(''); onNotice('Perfil fiscal de la organización guardado.'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo guardar el perfil fiscal.')),
    });
  };
  const submitRequirement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!requirementTarget) return;
    const fd = new FormData(event.currentTarget);
    const title = String(fd.get('title') ?? '').trim();
    const detail = String(fd.get('detail') ?? '').trim();
    if (title.length < 3 || detail.length < 5) { setFormError('Completa un título y un detalle para el requerimiento.'); return; }
    setFormError('');
    createRequirement.mutate({ data: { declarationId: requirementTarget.id, title, detail, operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setRequirementTarget(null); setFormError(''); onNotice('Requerimiento docente creado y vinculado al modelo.'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo crear el requerimiento.')),
    });
  };
  const canPresent = (item: Fp360TaxDeclaration) => ['draft', 'validated', 'observed', 'rectified'].includes(item.status);
  const actionButtons = (item: Fp360TaxDeclaration) => <div className="hacienda-actions">
    {!['closed', 'payment_pending', 'paid'].includes(item.status) && <button type="button" onClick={() => actOnDeclaration(item, 'recalculate')} disabled={readOnly || busyId === item.id}><RefreshCw size={13} /> Recalcular</button>}
    {item.status === 'draft' && <button type="button" onClick={() => actOnDeclaration(item, 'validate')} disabled={readOnly || busyId === item.id}><Check size={13} /> Validar</button>}
    {canPresent(item) && <button type="button" className="primary" onClick={() => actOnDeclaration(item, 'present')} disabled={readOnly || busyId === item.id}><BadgeCheck size={13} /> Presentar simulación</button>}
    {item.status === 'presented' && <button type="button" className="primary" onClick={() => actOnDeclaration(item, 'request_payment')} disabled={readOnly || busyId === item.id}>{item.resultCents < 0 ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{item.resultCents < 0 ? 'Solicitar devolución' : 'Solicitar pago'}</button>}
    {['presented', 'observed', 'rectified'].includes(item.status) && <button type="button" onClick={() => actOnDeclaration(item, 'rectify')} disabled={readOnly || busyId === item.id}>Nueva rectificación</button>}
    {!['closed', 'paid'].includes(item.status) && <button type="button" onClick={() => actOnDeclaration(item, 'close')} disabled={readOnly || busyId === item.id}>Cerrar</button>}
    {canTeach && item.status === 'presented' && <button type="button" onClick={() => { setFormError(''); setRequirementTarget(item); }} disabled={busyId === item.id}>Crear requerimiento</button>}
  </div>;
  const requirementResponse = (event: FormEvent<HTMLFormElement>, id: string) => {
    event.preventDefault();
    const response = String(new FormData(event.currentTarget).get('response') ?? '').trim();
    if (response.length < 5) { setActionError('La respuesta debe contener al menos 5 caracteres.'); return; }
    actOnRequirement(id, 'respond', response);
  };
  const renderModelField = (model: Fp360TaxModelTemplate, field: Fp360TaxModelTemplate['formFields'][number]) => {
    const label = <>{field.label}{field.required && <span aria-label="obligatorio"> · requerido</span>}</>;
    const fictionalNotice = /nif|dni|emplead|persona|contacto|tel[eé]fono|email|correo/i.test(`${field.key} ${field.label}`)
      ? 'Dato de ejemplo únicamente. No introduzcas NIF real, datos de empleados ni canales personales.'
      : field.note;
    if (field.kind === 'checkbox') return <label className="hacienda-check-field" key={field.key}><input name={field.key} type="checkbox" /> <span>{label}</span>{fictionalNotice && <small>{fictionalNotice}</small>}</label>;
    return <label key={field.key}>{label}{field.kind === 'select' ?
      <select name={field.key} required={field.required} defaultValue=""><option value="">Selecciona</option>{(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}</select> :
      <input name={field.key} type={field.kind === 'number' ? 'number' : field.kind === 'date' ? 'date' : 'text'} required={field.required} inputMode={field.kind === 'number' ? 'decimal' : undefined} placeholder={/nif|dni/i.test(`${field.key} ${field.label}`) ? 'Identificador ficticio' : undefined} />}
      {fictionalNotice && <small>{fictionalNotice}</small>}</label>;
  };
  const renderProfileForm = () => {
    const profile = data?.taxProfile;
    return <section className="hacienda-panel hacienda-profile-panel">
      <SectionHead eyebrow="CONFIGURACIÓN DOCENTE · ORGANIZACIÓN" title="Perfil fiscal de la empresa" description="Define únicamente las circunstancias educativas necesarias para determinar la aplicabilidad de modelos." />
      {!canTeach ? <div className="hacienda-profile-missing"><LockKeyhole size={16} /><span>El perfil fiscal aún no está configurado. Solicita a un docente o administrador que lo complete antes de crear modelos.</span></div> :
        <form className="hacienda-profile-form" onSubmit={submitProfile}>
          <label>Tipo legal<select name="entityType" required defaultValue={profile?.entityType ?? ''}><option value="">Selecciona</option><option value="autonomo">Autónomo</option><option value="sociedad">Sociedad</option></select></label>
          <label>Régimen IGIC<select name="igicRegime" required defaultValue={profile?.igicRegime ?? ''}><option value="">Selecciona</option><option value="general">General</option><option value="simplified">Simplificado</option></select></label>
          <label>Método IRPF · solo autónomo<select name="incomeTaxMethod" defaultValue={profile?.entityType === 'autonomo' ? profile.incomeTaxMethod : ''}><option value="">Selecciona si autónomo</option><option value="direct">Estimación directa</option><option value="objective">Estimación objetiva</option><option value="not_applicable" disabled>No aplicable a sociedades</option></select></label>
          {([
            ['hasEmployees', '¿Tiene personal contratado?', profile?.hasEmployees],
            ['withholdsProfessionals', '¿Practica retenciones a profesionales?', profile?.withholdsProfessionals],
            ['paysBusinessRent', '¿Paga alquiler de local o negocio?', profile?.paysBusinessRent],
          ] as Array<[string, string, boolean | undefined]>).map(([key, title, current]) => <label key={key}>{title}<select name={key} required defaultValue={current === undefined ? '' : String(current)}><option value="">Selecciona</option><option value="true">Sí</option><option value="false">No</option></select></label>)}
          {formError && <p className="hacienda-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}
          <button className="hacienda-button primary" type="submit" disabled={updateProfile.isPending}>{updateProfile.isPending ? 'Guardando perfil…' : 'Guardar perfil fiscal'}</button>
        </form>}
      {profile && <p className="hacienda-profile-summary"><b>Perfil guardado:</b> {profile.entityType === 'autonomo' ? 'Autónomo' : 'Sociedad'} · IGIC {profile.igicRegime === 'general' ? 'general' : 'simplificado'} · IRPF {profile.incomeTaxMethod === 'not_applicable' ? 'no aplicable' : profile.incomeTaxMethod === 'direct' ? 'estimación directa' : 'estimación objetiva'} · personal {profile.hasEmployees ? 'sí' : 'no'} · retención profesionales {profile.withholdsProfessionals ? 'sí' : 'no'} · alquiler {profile.paysBusinessRent ? 'sí' : 'no'}.</p>}
    </section>;
  };

  return <main className="page-content hacienda-page">
    <header className="hacienda-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>FISCALIDAD · TRAZABILIDAD</span></div><h1>Hacienda FP360</h1><p>Dos administraciones, un expediente educativo trazable. Sin presentaciones ni pagos reales.</p></div>
      <div className="hacienda-tools">
        {canChooseOrganization && <label className="hacienda-org-select">Empresa<select value={organizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)} data-testid="select-hacienda-organization"><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <span className="hacienda-date"><CalendarDays size={14} /> Escenario · 15 sep 2027</span>
      </div>
    </header>
    <div className="hacienda-legal"><ShieldAlert size={17} /><div><strong>SIN VALIDEZ OFICIAL</strong><span>Simulación educativa: no hay cálculos legales, presentación real ni pago. Los enlaces oficiales salen de RED FP360. No envíes datos ni documentación de simulación a la agencia.</span></div><b>NO PRESENTA A ORGANISMOS</b></div>
    {!organizationId && <section className="hacienda-unselected"><Landmark size={24} /><span className="hacienda-overline">ÁMBITO DE TRABAJO</span><h2>Selecciona una organización</h2><p>Calendario, documentos origen, modelos y eventos se consultan para una sola empresa cada vez.</p>{canChooseOrganization ? <label>Organización<select value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)}><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label> : <p>Tu perfil no tiene una empresa asignada. Solicita al equipo docente que configure el acceso.</p>}</section>}
    {organizationId && <>
      <nav className="hacienda-agency-switch" role="tablist" aria-label="Administración tributaria">
        {(['atc', 'aeat'] as Agency[]).map((item) => <button type="button" key={item} role="tab" aria-selected={agency === item} className={agency === item ? 'active' : ''} onClick={() => switchAgency(item)} data-testid={`tab-hacienda-agency-${item}`}><span>{item === 'atc' ? 'CANARIAS' : 'ESTATAL'}</span><b>{agencyNames[item]}</b><small>{item === 'atc' ? 'IGIC · modelos 400, 415, 420, 421 y 425' : 'AEAT · modelos 036, 111, 190, 115, 180, 200, 130, 131, 100 y 347'}</small></button>)}
      </nav>
      <section className={`hacienda-agency-section ${agency}`} aria-labelledby="hacienda-agency-title">
        <header className="hacienda-agency-heading"><div><span className="hacienda-overline">{agency === 'atc' ? 'AGENCIA TRIBUTARIA CANARIA' : 'AGENCIA ESTATAL DE ADMINISTRACIÓN TRIBUTARIA'}</span><h2 id="hacienda-agency-title">{agencyNames[agency]}</h2><p>Ámbito separado · obligaciones, modelos, requerimientos e historial filtrados por organismo.</p></div><span className="hacienda-agency-code">{agency.toUpperCase()}</span></header>
        <nav className="hacienda-tabs" role="tablist" aria-label={`Tareas de ${agencyNames[agency]}`}>{availableTabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setActionError(''); setFormError(''); }} data-testid={`tab-hacienda-${id}`}><Icon size={14} />{label}</button>)}</nav>
      </section>
      <div className="hacienda-topline"><span><i /> Organización · datos trazables</span><span>Fecha simulada fija · 15/09/2027</span></div>
      {overviewQuery.isLoading ? <Skeleton /> : overviewQuery.isError ? <ErrorNotice retry={retry} message={errorText(overviewQuery.error, 'No se ha podido cargar la información fiscal.')} /> : data && <>
        {canTeach && renderProfileForm()}
        {!data.taxProfile && <div className="hacienda-profile-missing" role="note"><LockKeyhole size={16} /><span>El perfil fiscal no está configurado. Debe configurarse antes de crear modelos; no se aplican valores predeterminados.</span></div>}
        <section className="hacienda-metrics">
          <Metric label="Modelos pendientes" value={String(declarations.filter((item) => !['presented', 'closed', 'paid'].includes(item.status)).length)} note={`${declarations.filter((item) => item.status === 'presented').length} presentados en este organismo`} icon={FileText} tone="blue" />
          <Metric label={agency === 'atc' ? 'IGIC repercutido' : 'Modelos del catálogo'} value={agency === 'atc' ? euro(data.summary.outputIgicCents) : String(models.length)} note={agency === 'atc' ? 'Derivado del escenario, no cálculo legal' : 'Estructuras educativas disponibles'} icon={ArrowUpRight} tone="teal" />
          <Metric label="Requerimientos abiertos" value={String(requirements.filter((item) => item.status === 'open').length)} note="Vinculados a modelos de esta sección" icon={ClipboardCheck} tone="amber" />
          <Metric label="Actividad registrada" value={String(events.length)} note="Historial del organismo seleccionado" icon={Activity} tone="violet" />
        </section>
        {actionError && <div className="hacienda-inline-error" role="alert"><CircleAlert size={15} />{actionError}<button type="button" onClick={() => setActionError('')} aria-label="Cerrar error"><X size={14} /></button></div>}
        <div className="hacienda-view page-enter">
          {view === 'calendar' && <div className="hacienda-calendar-grid">
            <section className="hacienda-panel"><SectionHead eyebrow="VENCIMIENTOS DEL ESCENARIO" title="Calendario fiscal" description="Fechas educativas por obligación. No son plazos oficiales." />
              {obligations.length ? <div className="hacienda-obligation-list">{obligations.map((item) => {
                const decl = declarations.find((entry) => entry.id === item.declarationId);
                return <article key={item.id} className="hacienda-obligation" data-testid={`row-hacienda-obligation-${item.id}`}><span className="hacienda-calendar-mark"><b>{item.simulatedDueDate.slice(8, 10)}</b><small>{dateLabel(item.simulatedDueDate).split(' ')[1]}</small></span><div className="hacienda-obligation-copy"><small>{agency.toUpperCase()} · MODELO {item.modelCode} · {item.periodKey}</small><b>{modelTitle(models.find((model) => model.modelCode === item.modelCode))}</b><span>Vencimiento simulado · {dateLabel(item.simulatedDueDate)}</span></div><Status value={item.status} />{decl && <button type="button" className="hacienda-row-link" onClick={() => setView('draft')}>Ver modelo <ArrowRight size={13} /></button>}</article>;
              })}</div> : <Empty title="Sin obligaciones de este organismo" detail="No hay obligaciones fiscales para la administración seleccionada en el escenario." />}
            </section>
            <aside className="hacienda-side-stack"><section className="hacienda-panel hacienda-focus"><span className="hacienda-overline">FOCO DE APRENDIZAJE</span><h3>Lee el modelo antes de completar el expediente.</h3><p>Revisa la estructura educativa, la aplicabilidad del perfil y los documentos de origen. Toda acción queda en simulación.</p><button type="button" onClick={() => setView('draft')}>Explorar modelos <ArrowRight size={14} /></button><div className="hacienda-focus-mark"><FileCheck2 size={22} /></div></section>
               <section className="hacienda-panel hacienda-quick"><SectionHead eyebrow="SEGUIMIENTO" title="Este organismo" /><div><span>Modelos disponibles</span><b>{models.length}</b></div><div><span>{agency === 'atc' ? 'Facturas con IGIC' : 'Periodos de nómina'}</span><b>{agency === 'atc' ? sources.length : payrollSources.filter((source) => ['closed', 'issued', 'payment_prepared', 'paid_simulated'].includes(source.status)).length}</b></div><div><span>Actividad registrada</span><b>{events.length}</b></div><p>Cifras del escenario educativo, sin efectos tributarios.</p></section>
            </aside>
          </div>}
          {view === 'igic' && <section className="hacienda-panel">
            <SectionHead eyebrow="FACTURAS CON IGIC" title="Documentos de origen ATC" description="Solo se muestran facturas del escenario con IGIC devengado o soportado; estos registros alimentan la práctica de modelos ATC." />
            <label className="hacienda-search"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Referencia, contraparte o estado" aria-label="Buscar documentos con IGIC" data-testid="input-hacienda-source-search" /></label>
            <div className="hacienda-table-scroll"><table className="hacienda-table"><thead><tr><th>Documento</th><th>Tipo</th><th>Fecha</th><th>Contraparte ficticia</th><th>Base</th><th>IGIC</th><th>Estado origen</th></tr></thead><tbody>{filteredSources.map((item) => <tr key={item.id} data-testid={`row-hacienda-source-${item.id}`}><td><b className="mono">{item.reference}</b></td><td>{item.sourceType === 'sales_invoice' ? 'Factura emitida' : 'Factura recibida'}</td><td>{dateLabel(item.date)}</td><td>{item.counterparty}</td><td>{euro(item.baseCents)}</td><td>{euro(item.taxCents)}</td><td><Status value={item.status} /></td></tr>)}{!filteredSources.length && <tr><td colSpan={7}><Empty title={term ? 'Sin coincidencias' : 'No hay facturas con IGIC'} detail={term ? 'Prueba con otra referencia o contraparte.' : 'No hay registros de IGIC disponibles para esta organización.'} /></td></tr>}</tbody></table></div>
          </section>}
          {view === 'retentions' && <section className="hacienda-panel">
            <SectionHead eyebrow="AEAT · RETENCIONES" title="Obligaciones estatales de retención" description="111/190 corresponden a trabajo y actividades económicas; 115/180 a arrendamientos urbanos. Ninguna se calcula a partir del IGIC." />
            <div className="hacienda-manual-note"><ShieldAlert size={15} /><span>Las nóminas cerradas alimentan borradores revisables de los modelos 111 y 190. El resto de retenciones estatales se mantiene separado; no se muestran aquí facturas ni cuotas de IGIC y nunca se presenta una declaración automáticamente.</span></div>
            <div className="hacienda-retention-grid">{models.filter((model) => ['111', '190', '115', '180'].includes(model.modelCode)).map((model) => {
              const records = declarationsFor(model.modelCode);
              const canOpen = model.applicabilityStatus === 'applies' || canTeach;
              const payrollPeriod = model.modelCode === '111' ? payrollQuarter : '2027';
              const periodStart = model.modelCode === '111'
                ? `${payrollQuarter.slice(0, 4)}-${String((Number(payrollQuarter.slice(-1)) - 1) * 3 + 1).padStart(2, '0')}`
                : '2027-01';
              const periodEnd = model.modelCode === '111'
                ? `${payrollQuarter.slice(0, 4)}-${String(Number(payrollQuarter.slice(-1)) * 3).padStart(2, '0')}`
                : '2027-12';
              const payrollInputs = model.modelCode === '111' || model.modelCode === '190'
                ? latestPayrollSources.filter((source) =>
                  ['closed', 'issued', 'payment_prepared', 'paid_simulated'].includes(source.status)
                  && source.periodKey >= periodStart && source.periodKey <= periodEnd)
                : [];
              const payrollGross = payrollInputs.reduce((sum, source) => sum + source.grossTotalCents, 0);
              const payrollWithholding = payrollInputs.reduce((sum, source) => sum + source.withholdingCents, 0);
              const annualPayrollCoverage = payrollCoverageFor(payrollInputs.map((source) => source.periodKey));
              return <article className="hacienda-retention-card" key={model.modelCode}>
                <div className="hacienda-retention-title"><span>AEAT · {model.modelCode}</span><b>{model.label}</b></div>
                <span className={`hacienda-applicability compact ${model.applicabilityStatus === 'applies' ? 'applies' : model.applicabilityStatus === 'review_required' ? 'review-required' : 'does-not-apply'}`}><span>{applicabilityLabel(model)}</span><p>{model.applicabilityNote}</p></span>
                <small>{records.length ? `${records.length} expediente(s) educativo(s)` : model.periodicity === 'annual' ? 'Resumen anual informativo' : 'Autoliquidación trimestral'}</small>
                {model.modelCode === '111' && <label className="hacienda-payroll-period">Trimestre<select value={payrollQuarter} onChange={(event) => setPayrollQuarter(event.target.value)}><option value="2027-Q1">2027 · 1.er trimestre</option><option value="2027-Q2">2027 · 2.º trimestre</option><option value="2027-Q3">2027 · 3.er trimestre</option><option value="2027-Q4">2027 · 4.º trimestre</option></select></label>}
                {(model.modelCode === '111' || model.modelCode === '190') && <div className="hacienda-payroll-preview">
                  <b>{payrollInputs.length} periodo(s) cerrado(s) · {euro(payrollGross)} bruto · {euro(payrollWithholding)} retenido</b>
                  {model.modelCode === '190' ? <>
                    <strong className={annualPayrollCoverage.missingMonths.length ? 'partial' : 'complete'}>
                      {annualPayrollCoverage.missingMonths.length
                        ? `Cobertura parcial · ${annualPayrollCoverage.includedMonths.length}/12 meses`
                        : 'Cobertura completa · 12/12 meses'}
                    </strong>
                    <small>Meses incluidos: {annualPayrollCoverage.includedMonths.join(', ') || 'ninguno'}.</small>
                    <small>Meses faltantes: {annualPayrollCoverage.missingMonths.join(', ') || 'ninguno'}.</small>
                  </> : <small>Referencias del mismo trimestre y empresa.</small>}
                  <button type="button" className="hacienda-button small" onClick={() => importPayrollDraft(model.modelCode as '111' | '190', payrollPeriod)} disabled={!canOpen || readOnly || !payrollInputs.length || busyId === `payroll-${model.modelCode}-${payrollPeriod}`}>
                    {busyId === `payroll-${model.modelCode}-${payrollPeriod}` ? 'Creando borrador…' : `Crear borrador ${model.modelCode} desde nóminas`}
                  </button>
                </div>}
                <button type="button" className="hacienda-button small" onClick={() => { setSelectedModelCode(model.modelCode); setView('draft'); }} disabled={!canOpen || readOnly}>Abrir modelo estatal</button>
              </article>;
            })}</div>
          </section>}
          {view === 'draft' && <div className="hacienda-draft-layout">
            <section className="hacienda-panel"><SectionHead eyebrow="PREPARACIÓN EDUCATIVA" title="Crear un borrador" description="Campos según la estructura de referencia del catálogo oficial, con datos ficticios únicamente." />
              {!data.taxProfile ? <Empty title="Perfil fiscal pendiente" detail="El equipo docente debe guardar el perfil de la organización antes de habilitar la creación de modelos." /> :
              <form className="hacienda-form" onSubmit={submitDeclaration}>
                {!models.length && <Empty title="Catálogo no disponible" detail={`La API no ha devuelto modelos educativos para ${agencyNames[agency]}. No se pueden crear modelos sin su estructura oficial de referencia.`} />}
                <label>Modelo<select value={selectedModel?.modelCode ?? ''} onChange={(event) => { setSelectedModelCode(event.target.value); setFormError(''); }} required data-testid="select-hacienda-model">{models.map((model) => <option key={model.modelCode} value={model.modelCode}>{model.modelCode} · {model.label}</option>)}</select></label>
                {selectedModel && <>
                   <div className={`hacienda-applicability ${selectedModel.applicabilityStatus === 'applies' ? 'applies' : selectedModel.applicabilityStatus === 'review_required' ? 'review-required' : 'does-not-apply'}`}><span>{applicabilityLabel(selectedModel)}</span><p>{selectedModel.applicabilityNote}</p></div>
                  <div className="hacienda-model-meta"><span>{selectedModel.periodicity === 'quarterly' ? 'Periodicidad trimestral' : selectedModel.periodicity === 'annual' ? 'Periodicidad anual' : 'Modelo censal'}</span><span>Referencia {selectedModel.referenceVersion}</span></div>
                  <div className="hacienda-official-warning"><ShieldAlert size={14} /><span>Enlace externo a RED FP360. No presentes datos de simulación ante la agencia.</span><a href={selectedModel.officialUrl} target="_blank" rel="noreferrer">Fuente oficial <ExternalLink size={12} /></a></div>
                  <label>Periodo<select name="periodKey" defaultValue={selectedModel.periodicity === 'quarterly' ? '2027-Q3' : '2027'}>{selectedModel.periodicity === 'quarterly' && <><option value="2027-Q1">2027 · 1.er trimestre</option><option value="2027-Q2">2027 · 2.º trimestre</option><option value="2027-Q3">2027 · 3.er trimestre</option><option value="2027-Q4">2027 · 4.º trimestre</option></>}<option value="2027">Ejercicio 2027</option></select></label>
                  <div className="hacienda-fields-title"><b>Estructura educativa del modelo {selectedModel.modelCode}</b><small>Referencia publicada hasta 01/11/2026 · campos sin validez oficial</small></div>
                  {selectedModel.formFields.map((field) => renderModelField(selectedModel, field))}
                  {!selectedModel.applicable && canTeach && <p className="hacienda-form-hint"><ShieldAlert size={14} /> Uso docente de práctica permitido; se distinguirá como no aplicable al perfil guardado.</p>}
                   {!selectedModel.applicable && !canTeach && <p className="hacienda-form-error"><LockKeyhole size={14} /> El alumnado no puede crear modelos no aplicables o con obligación pendiente de revisión.</p>}
                </>}
                {formError && <p className="hacienda-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}
                {readOnly && <p className="hacienda-form-error"><LockKeyhole size={14} />Perfil de solo lectura: no puedes crear modelos.</p>}
                <button className="hacienda-button primary" type="submit" disabled={readOnly || !selectedModel || (!selectedModel.applicable && !canTeach) || createDeclaration.isPending}>{createDeclaration.isPending ? 'Preparando borrador…' : <><FilePlus2 size={14} /> Crear borrador educativo</>}</button>
              </form>}
            </section>
            <section className="hacienda-panel"><SectionHead eyebrow="BORRADORES Y VERSIONES" title="Modelos registrados" description="Recalcular y validar no presenta documentos. Cada presentación es simulada." />
              <label className="hacienda-search"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Modelo, periodo o estado" aria-label="Buscar modelos" data-testid="input-hacienda-declaration-search" /></label>
              {!filteredDeclarations.length ? <Empty title={term ? 'Sin coincidencias' : 'Aún no hay declaraciones'} detail={term ? 'Prueba con otro modelo o periodo.' : 'Crea un borrador educativo para comenzar.'} /> : <div className="hacienda-declaration-list">{filteredDeclarations.map((item) => {
                const model = models.find((entry) => entry.modelCode === item.modelCode);
                const payrollFormData = item.formData ?? {};
                return <article className="hacienda-declaration" key={item.id} data-testid={`card-hacienda-declaration-${item.id}`}>
                  <div className="hacienda-declaration-top"><span className="hacienda-model-icon"><FileText size={17} /></span><div><small>{agency.toUpperCase()} · MODELO {item.modelCode} · {item.periodKey} · VERSIÓN {item.version}</small><b>{modelTitle(model)}</b></div><Status value={item.status} /></div>
                   {model && <div className={`hacienda-applicability compact ${model.applicabilityStatus === 'applies' ? 'applies' : model.applicabilityStatus === 'review_required' ? 'review-required' : 'does-not-apply'}`}><span>{applicabilityLabel(model)}</span><p>{model.applicabilityNote}</p></div>}
                  {item.formData && Object.entries(item.formData).some(([key]) => !payrollCoverageFields.has(key)) && <details className="hacienda-formdata"><summary>Campos educativos cumplimentados</summary><dl>{Object.entries(item.formData).filter(([key]) => !payrollCoverageFields.has(key)).map(([key, value]) => <div key={key}><dt>{model?.formFields.find((field) => field.key === key)?.label ?? key}</dt><dd>{value || '—'}</dd></div>)}</dl></details>}
                  {item.sourcePayrollRunIds.length > 0 && <div className="hacienda-payroll-links"><b>Fuentes de nómina · {organizationLabel} · {item.sourcePayrollRunIds.length} periodo(s)</b><span>{item.sourcePayrollRunIds.map((id) => {
                    const source = payrollSourceById.get(id);
                    return source ? `${source.periodKey} · v${source.version}` : `Referencia ${id}`;
                  }).join(' · ')}</span><small>Datos de nómina cerrados; estado fiscal independiente y pendiente de revisión.</small></div>}
                  {item.modelCode === '190' && item.sourcePayrollRunIds.length > 0 && <div className={`hacienda-payroll-coverage ${payrollFormData.payrollCoverage === 'partial' ? 'partial' : 'complete'}`} role="status">
                    <b>{payrollFormData.payrollCoverage === 'partial' ? 'Cobertura anual parcial' : 'Cobertura anual completa'}</b>
                    <span>Meses incluidos: {payrollFormData.payrollIncludedMonths || 'sin datos'}.</span>
                    <span>Meses faltantes: {payrollFormData.payrollMissingMonths || 'ninguno'}.</span>
                  </div>}
                  <div className="hacienda-declaration-values"><span>Base imponible <b>{euro(item.taxableBaseCents)}</b></span><span>IGIC repercutido <b>{euro(item.outputIgicCents)}</b></span><span>IGIC soportado <b>{euro(item.inputIgicCents)}</b></span><span>Retenciones <b>{euro(item.withholdingCents)}</b></span><span>Resultado provisional <b className={item.resultCents < 0 ? 'hacienda-negative' : ''}>{euro(item.resultCents)}</b></span></div>
                  <div className="hacienda-declaration-foot"><span><Clock3 size={13} /> Vencimiento educativo · {dateLabel(item.simulatedDueDate)}</span><span>Pago · {statuses[item.paymentStatus] ?? item.paymentStatus}</span></div>
                  {item.receiptReference && <div className="hacienda-receipt"><BadgeCheck size={14} /><span>Justificante simulado <b className="mono">{item.receiptReference}</b></span><small>No es un justificante oficial</small></div>}
                  {item.supersedesId && <div className="hacienda-version-note">Rectifica versión anterior · <span className="mono">{item.supersedesId}</span></div>}
                  {actionButtons(item)}
                </article>;
              })}</div>}
            </section>
          </div>}
          {view === 'requirements' && <section className="hacienda-panel">
            <SectionHead eyebrow="COMUNICACIONES DEL ESCENARIO" title="Requerimientos y respuestas" description="Solo aparecen solicitudes asociadas a modelos de esta administración." />
            {!requirements.length ? <Empty title="Sin requerimientos" detail="No hay requerimientos creados para esta organización y organismo." /> : <div className="hacienda-requirement-list">{requirements.map((item) => <article className="hacienda-requirement" key={item.id} data-testid={`card-hacienda-requirement-${item.id}`}><div className="hacienda-req-top"><span><ClipboardCheck size={16} /></span><div><small className="mono">{item.reference} · MODELO {declarations.find((d) => d.id === item.declarationId)?.modelCode ?? '—'}</small><b>{item.title}</b></div><Status value={item.status} /></div><p>{item.detail}</p><div className="hacienda-req-meta"><span>Creado por {item.createdByName}</span><span>{dateLabel(item.createdAt)}</span></div>{item.response && <blockquote><b>Respuesta · {item.respondedByName ?? 'equipo'}</b>{item.response}</blockquote>}
              {item.status === 'open' && !readOnly && <form className="hacienda-response-form" onSubmit={(event) => requirementResponse(event, item.id)}><label>Respuesta educativa<textarea name="response" minLength={5} maxLength={2000} required placeholder="Describe la respuesta ficticia para la práctica…" /></label><button className="hacienda-button primary" type="submit" disabled={busyId === item.id}>Enviar respuesta</button></form>}
              {canTeach && item.status === 'answered' && <button className="hacienda-button" type="button" onClick={() => actOnRequirement(item.id, 'resolve')} disabled={busyId === item.id}><Check size={14} /> Marcar resuelto</button>}
            </article>)}</div>}
          </section>}
          {view === 'payments' && <div className="hacienda-payment-view">
            <div className="hacienda-payment-banner"><div><span className="hacienda-overline">SOLICITUD EDUCATIVA · SIN CARGO NI ABONO</span><h2>Pagos y devoluciones</h2><p>El estado pagado solo puede venir de una confirmación del flujo Banco FP360. Ningún importe sale de esta simulación.</p></div><span className="hacienda-payment-mark"><Landmark size={21} /></span></div>
            <section className="hacienda-panel"><SectionHead eyebrow="MODELOS PRESENTADOS" title="Situación de liquidación" description="Crea una solicitud desde un modelo presentado. No se marca como pagado desde Hacienda." />
              {declarations.filter((item) => ['presented', 'payment_pending', 'refund_pending', 'closed', 'paid'].includes(item.status)).length ? <div className="hacienda-table-scroll"><table className="hacienda-table"><thead><tr><th>Modelo / periodo</th><th>Resultado</th><th>Estado del modelo</th><th>Estado de pago</th><th>Justificante</th><th>Solicitud</th></tr></thead><tbody>{declarations.filter((item) => ['presented', 'payment_pending', 'refund_pending', 'closed', 'paid'].includes(item.status)).map((item) => <tr key={item.id}><td><b>Modelo {item.modelCode}</b><small>{item.periodKey} · v{item.version}</small></td><td className={item.resultCents < 0 ? 'hacienda-negative' : ''}>{euro(item.resultCents)}</td><td><Status value={item.status} /></td><td><Status value={item.paymentStatus} /></td><td className="mono">{item.receiptReference ?? '—'}</td><td>{item.status === 'presented' ? <button className="hacienda-button primary small" type="button" onClick={() => actOnDeclaration(item, 'request_payment')} disabled={readOnly || busyId === item.id}>{item.resultCents < 0 ? 'Solicitar devolución' : 'Solicitar pago'}</button> : item.paymentStatus === 'paid' ? <span className="hacienda-confirmed"><BadgeCheck size={13} /> Confirmado por Banco FP360</span> : <span className="hacienda-pending">Pendiente de confirmación bancaria</span>}</td></tr>)}</tbody></table></div> : <Empty title="No hay liquidaciones simuladas" detail="Al presentar un borrador educativo aparecerá aquí la solicitud correspondiente." />}
              <div className="hacienda-panel-foot"><span><ShieldAlert size={13} /> No se ejecutan transferencias ni devoluciones desde este módulo.</span><span>Pago confirmado solo en Banco FP360</span></div>
            </section>
          </div>}
          {view === 'history' && <section className="hacienda-panel"><SectionHead eyebrow="TRAZABILIDAD" title="Historial de actividad" description="Acciones registradas para esta empresa, administración y fecha educativa." />
            {!events.length ? <Empty title="Sin actividad registrada" detail="La actividad aparecerá cuando se creen o revisen modelos o requerimientos de este organismo." /> : <div className="hacienda-event-list">{[...events].sort((a, b) => b.simulatedDate.localeCompare(a.simulatedDate)).map((event) => <article key={event.id} data-testid={`row-hacienda-event-${event.id}`}><span><Activity size={14} /></span><div><b>{event.description}</b><small>{event.actorName} · {dateLabel(event.simulatedDate)}</small></div><small className="hacienda-event-type">{event.eventType.replaceAll('_', ' ')}</small></article>)}</div>}
          </section>}
        </div>
      </>}
    </>}
    {requirementTarget && <div className="hacienda-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !createRequirement.isPending) setRequirementTarget(null); }}><section className="hacienda-modal" role="dialog" aria-modal="true" aria-labelledby="hacienda-requirement-title">
      <header><div><span className="hacienda-overline">SOLICITUD DOCENTE · MODELO {requirementTarget.modelCode}</span><h2 id="hacienda-requirement-title">Crear requerimiento</h2></div><button type="button" onClick={() => setRequirementTarget(null)} aria-label="Cerrar formulario"><X size={17} /></button></header>
      <p>Se vinculará al modelo educativo del periodo {requirementTarget.periodKey}.</p>
      <form onSubmit={submitRequirement}><label>Título<input name="title" required minLength={3} maxLength={160} placeholder="Aclaración de un dato ficticio" /></label><label>Detalle<textarea name="detail" required minLength={5} maxLength={1000} placeholder="Describe la actividad de revisión educativa…" /></label>{formError && <p className="hacienda-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}<footer><button type="button" className="hacienda-button" onClick={() => setRequirementTarget(null)} disabled={createRequirement.isPending}>Cancelar</button><button type="submit" className="hacienda-button primary" disabled={createRequirement.isPending}>{createRequirement.isPending ? 'Creando…' : 'Crear requerimiento'}</button></footer></form>
    </section></div>}
  </main>;
}

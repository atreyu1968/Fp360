import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  Activity, ArrowRight, BadgeCheck, BriefcaseBusiness, CalendarDays, Check, ChevronRight, CircleAlert,
  ClipboardCheck, FileCheck2, FileText, Inbox, LockKeyhole, Plus, Send, ShieldAlert, Users,
} from 'lucide-react';
import {
  getGetFp360EmploymentCommunicationsQueryKey, getGetFp360HrOverviewQueryKey, useCreateFp360EmploymentCertificate,
  useCreateFp360EmploymentCommunication, useCreateFp360HrCandidate, useCreateFp360HrContract,
  useCreateFp360HrEmployee, useCreateFp360HrTermination, useCreateFp360HrVacancy,
  useDecideFp360HrCandidate, useGetFp360EmploymentCommunications, useGetFp360HrOverview,
  useResubmitFp360EmploymentCommunication, useReviewFp360HrContract, useReviewFp360HrTermination,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360EmploymentCertificate, Fp360EmploymentCommunication, Fp360HrContract, Fp360HrContractInput,
  Fp360HrLifecycleChange, Fp360HrOverview, Fp360HrVacancyInput, Fp360Organization,
} from '@workspace/api-client-react';
import { Form } from '@/components/ui/form';
import './employment-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'offers' | 'candidates' | 'communications' | 'changes' | 'closure' | 'inbox';
const views: Array<{ id: View; label: string; icon: typeof BriefcaseBusiness }> = [
  { id: 'offers', label: 'Ofertas y selección', icon: BriefcaseBusiness },
  { id: 'candidates', label: 'Candidaturas', icon: Users },
  { id: 'communications', label: 'Comunicaciones', icon: Send },
  { id: 'changes', label: 'Extensiones y cambios', icon: FileText },
  { id: 'closure', label: 'Finalización', icon: FileCheck2 },
  { id: 'inbox', label: 'Bandeja administrativa', icon: Inbox },
];
const contractNames: Record<string, string> = { indefinite: 'Indefinido', temporary: 'Temporal', part_time: 'Tiempo parcial', training: 'Formativo' };
const statusNames: Record<string, string> = {
  open: 'Abierta', filled: 'Cubierta', closed: 'Cerrada', received: 'Recibida', selected: 'Seleccionada',
  rejected: 'No seleccionada', pending_review: 'Pendiente de revisión', confirmed: 'Confirmado',
  observed: 'Observado', approved: 'Revisado', acknowledged: 'Acuse simulado',
};
const operationId = () => crypto.randomUUID();
const isReviewer = (role: AuthIdentity['role']) => role === 'teacher' || role === 'administrator';
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
function Status({ value, testId }: { value: string; testId: string }) {
  const tone = ['confirmed', 'approved', 'selected', 'acknowledged'].includes(value) ? 'good' : ['pending_review', 'received', 'open', 'observed'].includes(value) ? 'waiting' : 'quiet';
  return <span className={`emp-status ${tone}`} data-testid={testId}><i />{statusNames[value] ?? value}</span>;
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="emp-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="emp-empty" data-testid="empty-state"><span><ClipboardCheck size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function CardHead({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <header className="emp-card-head"><div><small>{eyebrow}</small><h2>{title}</h2><p>{detail}</p></div>{action}</header>;
}
function ErrorLine({ message, clear }: { message: string; clear: () => void }) {
  if (!message) return null;
  return <p className="emp-error" role="alert" data-testid="employment-action-error"><CircleAlert size={15} />{message}<button type="button" onClick={clear} aria-label="Cerrar error" data-testid="button-dismiss-employment-error">×</button></p>;
}

export function EmploymentPage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const canReview = isReviewer(identity.role);
  const [selectedOrg, setSelectedOrg] = useState(identity.organizationId ?? '');
  const organizationId = identity.organizationId ?? selectedOrg;
  const [view, setView] = useState<View>('offers');
  const [vacancyFormOpen, setVacancyFormOpen] = useState(false);
  const [candidateFormOpen, setCandidateFormOpen] = useState(false);
  const [employeeFormOpen, setEmployeeFormOpen] = useState(false);
  const [contractFormOpen, setContractFormOpen] = useState(false);
  const [terminationFormOpen, setTerminationFormOpen] = useState(false);
  const [selectedVacancy, setSelectedVacancy] = useState('');
  const [certificate, setCertificate] = useState<Fp360EmploymentCertificate | null>(null);
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const vacancyForm = useForm<{ jobTitle: string; department: string; contractType: string; description: string }>({
    defaultValues: { jobTitle: '', department: '', contractType: 'indefinite', description: '' },
  });
  useEffect(() => {
    if (!identity.organizationId && !selectedOrg && organizations[0]) setSelectedOrg(organizations[0].id);
  }, [identity.organizationId, organizations, selectedOrg]);

  const overviewKey = getGetFp360HrOverviewQueryKey({ organizationId });
  const communicationsKey = getGetFp360EmploymentCommunicationsQueryKey({ organizationId });
  const overviewQuery = useGetFp360HrOverview({ organizationId }, { query: { enabled: Boolean(organizationId), queryKey: overviewKey } });
  const communicationsQuery = useGetFp360EmploymentCommunications({ organizationId }, { query: { enabled: Boolean(organizationId), queryKey: communicationsKey } });
  const createVacancy = useCreateFp360HrVacancy();
  const createCandidate = useCreateFp360HrCandidate();
  const decideCandidate = useDecideFp360HrCandidate();
  const createEmployee = useCreateFp360HrEmployee();
  const createContract = useCreateFp360HrContract();
  const reviewContract = useReviewFp360HrContract();
  const createTermination = useCreateFp360HrTermination();
  const reviewTermination = useReviewFp360HrTermination();
  const createCommunication = useCreateFp360EmploymentCommunication();
  const resubmitCommunication = useResubmitFp360EmploymentCommunication();
  const createCertificate = useCreateFp360EmploymentCertificate();
  const data = overviewQuery.data as Fp360HrOverview | undefined;
  const vacancies = useMemo(() => data?.vacancies ?? [], [data?.vacancies]);
  const candidates = useMemo(() => data?.candidates ?? [], [data?.candidates]);
  const employees = useMemo(() => data?.employees ?? [], [data?.employees]);
  const contracts = useMemo(() => data?.contracts ?? [], [data?.contracts]);
  const lifecycle = useMemo(() => data?.lifecycleChanges ?? [], [data?.lifecycleChanges]);
  const communications = useMemo(() => communicationsQuery.data?.communications ?? [], [communicationsQuery.data?.communications]);
  const pendingContracts = contracts.filter((item) => item.status === 'pending_review');
  const pendingLifecycle = lifecycle.filter((item) => item.status === 'pending_review');
  const pendingCommunications = communications.filter((communication) => communication.status === 'observed');
  const pendingReviews = pendingContracts.length + pendingLifecycle.length + pendingCommunications.length;
  const contractEmployee = (contract: Fp360HrContract) => employees.find((employee) => employee.id === contract.employeeId);
  const retry = () => {
    void client.invalidateQueries({ queryKey: overviewKey });
    void client.invalidateQueries({ queryKey: communicationsKey });
  };
  const invalidate = () => {
    if (!organizationId) return;
    void client.invalidateQueries({ queryKey: getGetFp360HrOverviewQueryKey({ organizationId }) });
    void client.invalidateQueries({ queryKey: getGetFp360EmploymentCommunicationsQueryKey({ organizationId }) });
  };
  const fail = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
  const candidateDecision = (candidateId: string, action: 'select' | 'reject') => {
    if (!canReview || !window.confirm('¿Registrar esta decisión en la práctica educativa?')) return;
    setBusyId(candidateId); setActionError('');
    decideCandidate.mutate({ candidateId, data: { action, operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setBusyId(''); onNotice('Decisión de candidatura registrada en la simulación.'); },
      onError: (error) => { setBusyId(''); setActionError(fail(error, 'No se pudo guardar la decisión.')); },
    });
  };
  const submitVacancy = vacancyForm.handleSubmit((values) => {
    if (!organizationId) { setFormError('Selecciona una empresa para continuar.'); return; }
    createVacancy.mutate({ data: { organizationId, jobTitle: values.jobTitle.trim(), department: values.department.trim(), contractType: values.contractType as Fp360HrVacancyInput['contractType'], description: values.description.trim(), operationId: operationId() } }, {
      onSuccess: () => { invalidate(); vacancyForm.reset(); setVacancyFormOpen(false); setFormError(''); onNotice('Oferta educativa creada. La referencia se asigna desde el servidor.'); },
      onError: (error) => setFormError(fail(error, 'No se pudo crear la oferta.')),
    });
  });
  const submitCandidate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget); const vacancyId = String(fd.get('vacancyId'));
    const scores = ['trainingScore', 'skillsScore', 'availabilityScore'].map((name) => Number(fd.get(name)));
    if (!vacancyId || scores.some((score) => !Number.isInteger(score) || score < 0 || score > 5)) { setFormError('Selecciona oferta y criterios entre 0 y 5.'); return; }
    createCandidate.mutate({ vacancyId, data: { trainingScore: scores[0], skillsScore: scores[1], availabilityScore: scores[2], operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setCandidateFormOpen(false); setFormError(''); onNotice('Candidatura con referencia ficticia registrada.'); },
      onError: (error) => setFormError(fail(error, 'No se pudo registrar la candidatura.')),
    });
  };
  const submitEmployee = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget);
    const weeklyHours = Number(fd.get('weeklyHours')); const contributionGroup = Number(fd.get('contributionGroup')); const salary = Number(fd.get('annualSalary'));
    const startDate = String(fd.get('startDate')); const endDate = String(fd.get('endDate') || '') || null;
    if (!organizationId || weeklyHours < 1 || weeklyHours > 40 || contributionGroup < 1 || contributionGroup > 11 || !Number.isFinite(salary) || salary < 0 || !startDate || (endDate && endDate < startDate)) { setFormError('Revisa candidatura, horas, grupo, importe y fechas.'); return; }
    createEmployee.mutate({ data: { organizationId, candidateId: String(fd.get('candidateId')), weeklyHours, contributionGroup, annualSalaryCents: Math.round(salary * 100), conventionName: String(fd.get('conventionName')).trim(), startDate, endDate, operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setEmployeeFormOpen(false); setFormError(''); onNotice('Expediente ficticio creado desde la candidatura.'); },
      onError: (error) => setFormError(fail(error, 'No se pudo crear el expediente.')),
    });
  };
  const submitContract = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget); const employeeId = String(fd.get('employeeId'));
    const weeklyHours = Number(fd.get('weeklyHours')); const contributionGroup = Number(fd.get('contributionGroup')); const salary = Number(fd.get('annualSalary'));
    const effectiveDate = String(fd.get('effectiveDate')); const endDate = String(fd.get('endDate') || '') || null;
    if (!employeeId || weeklyHours < 1 || weeklyHours > 40 || contributionGroup < 1 || contributionGroup > 11 || salary < 0 || !effectiveDate || (endDate && endDate < effectiveDate)) { setFormError('Completa el resumen con valores válidos.'); return; }
    createContract.mutate({ employeeId, data: { effectiveDate, endDate, contractType: String(fd.get('contractType')) as Fp360HrContractInput['contractType'], weeklyHours, annualSalaryCents: Math.round(salary * 100), contributionGroup, conventionName: String(fd.get('conventionName')).trim(), operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setContractFormOpen(false); setFormError(''); onNotice('Resumen contractual educativo enviado a revisión.'); },
      onError: (error) => setFormError(fail(error, 'No se pudo crear el resumen contractual.')),
    });
  };
  const submitTermination = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const fd = new FormData(event.currentTarget); const employeeId = String(fd.get('employeeId')); const effectiveDate = String(fd.get('effectiveDate'));
    if (!employeeId || !effectiveDate || !window.confirm('¿Registrar esta finalización solo en el escenario educativo?')) return;
    createTermination.mutate({ employeeId, data: { effectiveDate, operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setTerminationFormOpen(false); setFormError(''); onNotice('Finalización educativa registrada para revisión.'); },
      onError: (error) => setFormError(fail(error, 'No se pudo registrar la finalización.')),
    });
  };
  const submitCommunication = (event: FormEvent<HTMLFormElement>, target: Fp360HrContract | Fp360HrLifecycleChange, type: 'initial_contract' | 'amendment' | 'termination') => {
    event.preventDefault(); const fd = new FormData(event.currentTarget);
    createCommunication.mutate({ data: {
      organizationId, communicationType: type,
      contractId: type === 'termination' ? null : target.id,
      lifecycleChangeId: type === 'termination' ? target.id : null,
      simulatedDate: String(fd.get('simulatedDate')),
      scenarioOutcome: String(fd.get('scenarioOutcome')) as 'acknowledged' | 'observed',
      responseMessage: String(fd.get('responseMessage') || '').trim() || null,
      operationId: operationId(),
    } }, {
      onSuccess: (communication) => { invalidate(); setFormError(''); onNotice(`Comunicación ${communication.communicationRef}: ${communication.status === 'observed' ? 'observación simulada' : 'acuse simulado'} registrado.`); },
      onError: (error) => setFormError(fail(error, 'No se pudo registrar la comunicación educativa.')),
    });
  };
  const review = (kind: 'contract' | 'termination', id: string, action: 'confirm' | 'observe' | 'approve') => {
    if (!canReview || !window.confirm('¿Confirmas esta revisión exclusivamente educativa?')) return;
    setBusyId(id); setActionError('');
    const onSuccess = () => { invalidate(); setBusyId(''); onNotice('Revisión administrativa educativa registrada.'); };
    const onError = (error: unknown) => { setBusyId(''); setActionError(fail(error, 'No se pudo guardar la revisión.')); };
    if (kind === 'contract') reviewContract.mutate({ contractId: id, data: { action: action as 'confirm' | 'observe', operationId: operationId() } }, { onSuccess, onError });
    else reviewTermination.mutate({ changeId: id, data: { action: action === 'approve' ? 'approve' : 'observe', operationId: operationId() } }, { onSuccess, onError });
  };
  const retryCommunication = (communication: Fp360EmploymentCommunication) => {
    const scenarioDate = data?.simulatedDate ?? '2027-09-15';
    const simulatedDate = scenarioDate >= communication.simulatedDate ? scenarioDate : communication.simulatedDate;
    resubmitCommunication.mutate({ communicationId: communication.id, data: { simulatedDate, operationId: operationId() } }, {
      onSuccess: (result) => { invalidate(); onNotice(`Nueva simulación ${result.communicationRef}: ${result.status === 'observed' ? 'observada' : 'acuse recibido'}.`); },
      onError: (error) => setActionError(fail(error, 'No se pudo repetir la simulación.')),
    });
  };
  const issueCertificate = (changeId: string) => {
    if (!canReview) return;
    setActionError('');
    createCertificate.mutate({ changeId, data: { operationId: operationId() } }, {
      onSuccess: (result) => { invalidate(); setCertificate(result); onNotice(`Constancia educativa ${result.certificateRef} emitida.`); },
      onError: (error) => setActionError(fail(error, 'No se pudo emitir la constancia educativa.')),
    });
  };
  const renderCommunicationForm = (target: Fp360HrContract | Fp360HrLifecycleChange, type: 'initial_contract' | 'amendment' | 'termination', testId: string) => {
    if (communicationsQuery.isLoading) return <p className="emp-linked-wait" role="status" data-testid={`text-loading-communication-${testId}`}>Comprobando comunicaciones existentes…</p>;
    if (communicationsQuery.isError) return <p className="emp-linked-wait" data-testid={`text-error-communication-${testId}`}>No se puede crear una comunicación hasta cargar su historial.</p>;
    const isTermination = type === 'termination';
    const existing = communications.find((item) => isTermination ? item.lifecycleChangeId === target.id : item.contractId === target.id);
    const ready = isTermination
      ? (target as Fp360HrLifecycleChange).status === 'approved'
      : (target as Fp360HrContract).status === 'confirmed';
    return <div className="emp-linked-actions" data-testid={`linked-actions-${testId}`}>
      {existing ? <div className="emp-linked-state"><Status value={existing.status} testId={`status-linked-communication-${testId}`} /><span>{existing.acknowledgmentRef ? `Acuse · ${existing.acknowledgmentRef}` : existing.responseMessage ?? 'Comunicación observada.'}</span>{existing.status === 'observed' && <button type="button" className="emp-text-action" onClick={() => setView('communications')} data-testid={`button-open-subsanation-${testId}`}>Abrir subsanación</button>}</div>
        : ready ? <form className="emp-communication-form" onSubmit={(event) => submitCommunication(event, target, type)} data-testid={`form-${testId}`}>
          <Field label="Fecha simulada"><input name="simulatedDate" type="date" min="2027-01-01" max="2027-12-31" defaultValue={data?.simulatedDate ?? '2027-09-15'} required data-testid={`input-date-${testId}`} /></Field>
          <Field label="Resultado del portal educativo"><select name="scenarioOutcome" defaultValue="acknowledged" data-testid={`select-outcome-${testId}`}><option value="acknowledged">Acuse simulado</option><option value="observed">Con observación simulada</option></select></Field>
          <Field label="Mensaje de respuesta simulado"><input name="responseMessage" maxLength={500} placeholder="Nota educativa opcional" data-testid={`input-response-${testId}`} /></Field>
          <button className="emp-button primary" disabled={createCommunication.isPending} data-testid={`button-send-${testId}`}><Send size={14} />{createCommunication.isPending ? 'Registrando…' : 'Simular comunicación'}</button>
        </form> : <p className="emp-linked-wait" data-testid={`text-wait-${testId}`}>{isTermination ? 'Disponible tras aprobar la finalización.' : 'Disponible tras confirmar la versión contractual.'}</p>}
      {isTermination && ready && canReview && <button type="button" className="emp-button secondary" onClick={() => issueCertificate(target.id)} disabled={createCertificate.isPending} data-testid={`button-issue-certificate-${target.id}`}><FileCheck2 size={14} />Emitir constancia educativa</button>}
    </div>;
  };
  const employeeSelect = (name: string, activeOnly = false) => <select name={name} defaultValue="" required data-testid={`select-${name}`}><option value="">Selecciona una referencia</option>{employees.filter((employee) => !activeOnly || employee.status === 'active').map((employee) => <option key={employee.id} value={employee.id}>{employee.workerRef} · {employee.jobTitle}</option>)}</select>;
  const showDataState = overviewQuery.isLoading
    ? <div className="emp-skeleton" role="status" aria-label="Cargando expediente"><span /><span /><span /><span /></div>
    : overviewQuery.isError ? <div className="emp-data-error" role="alert" data-testid="employment-load-error"><CircleAlert size={17} /><span>No se pudo cargar el expediente laboral.</span><button type="button" onClick={retry} data-testid="button-retry-employment">Reintentar</button></div> : null;

  return <main className="page-content employment-page">
    <header className="emp-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>APLICACIÓN 19 · CICLO LABORAL</span></div><span className="emp-kicker">EMPLEO FP360 · ENTORNO DE APRENDIZAJE</span><h1>Empleo FP360</h1><p>Practica el recorrido completo: oferta, candidatura, comunicación, cambios y cierre. Cada paso deja una huella educativa.</p></div>
      <div className="emp-heading-tools">{!identity.organizationId && canReview && <label className="emp-org-select">Empresa activa<select value={organizationId} onChange={(event) => setSelectedOrg(event.target.value)} data-testid="select-employment-organization"><option value="">Selecciona empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}<span className="emp-date"><CalendarDays size={14} /> Escenario · 2027</span></div>
    </header>
    <aside className="emp-sim-notice" data-testid="notice-educational-simulation"><ShieldAlert size={18} /><div><b>SIMULACIÓN EDUCATIVA · SIN VALIDEZ OFICIAL</b><span>Solo referencias ficticias y registros laborales existentes. No se contacta con organismos públicos ni se presentan trámites. No introduzcas datos personales.</span></div><strong>NO OFICIAL</strong></aside>
    {!organizationId ? <section className="emp-no-org"><Users size={26} /><small>ÁMBITO DE TRABAJO</small><h2>Selecciona una empresa simulada</h2><p>Las ofertas, expedientes y comunicaciones se consultan para una organización cada vez.</p>{canReview ? <select value={selectedOrg} onChange={(event) => setSelectedOrg(event.target.value)} data-testid="select-employment-empty-organization"><option value="">Selecciona empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select> : <p>Tu perfil no tiene una empresa asignada. Solicita al equipo docente que configure el acceso.</p>}</section> : <>
      <section className="emp-metrics" aria-label="Resumen del escenario">
        <article data-testid="metric-vacancies"><span className="blue"><BriefcaseBusiness size={17} /></span><small>Ofertas publicadas</small><b>{overviewQuery.isSuccess ? vacancies.length : '—'}</b><em>Procesos ficticios activos</em></article>
        <article data-testid="metric-candidates"><span className="green"><Users size={17} /></span><small>Candidaturas</small><b>{overviewQuery.isSuccess ? candidates.length : '—'}</b><em>Referencias anónimas</em></article>
        <article data-testid="metric-contracts"><span className="amber"><FileText size={17} /></span><small>Resúmenes preparados</small><b>{overviewQuery.isSuccess ? contracts.length : '—'}</b><em>{pendingContracts.length} pendientes de revisión</em></article>
        <article data-testid="metric-communications"><span className="violet"><Send size={17} /></span><small>Comunicaciones simuladas</small><b>{communicationsQuery.isSuccess ? communications.length : '—'}</b><em>Con resultado visible</em></article>
      </section>
      <div className="emp-summary"><span><i /> Empresa activa · datos trazables</span><span>Fecha del escenario · {dateLabel(data?.simulatedDate ?? '2027-09-15')}</span></div>
      <nav className="emp-tabs" role="tablist" aria-label="Vistas de Empleo FP360">{views.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} key={id} onClick={() => { setView(id); setFormError(''); setActionError(''); }} data-testid={`tab-employment-${id}`}><Icon size={15} />{label}{id === 'inbox' && pendingReviews > 0 && <span className="emp-tab-count" data-testid="badge-pending-reviews">{pendingReviews}</span>}</button>)}</nav>
      {!canReview && <div className="emp-permission"><LockKeyhole size={15} /> Tu perfil puede registrar prácticas. La selección, confirmación y revisión requieren rol docente o administración.</div>}
      {actionError && <ErrorLine message={actionError} clear={() => setActionError('')} />}
      {showDataState}
      {communicationsQuery.isError && <div className="emp-data-error" role="alert" data-testid="communications-load-error"><CircleAlert size={17} /><span>No se pudieron cargar las comunicaciones simuladas.</span><button type="button" onClick={retry} data-testid="button-retry-communications">Reintentar</button></div>}
      {overviewQuery.isSuccess && data && <div className="emp-view page-enter">
        {view === 'offers' && <div className="emp-columns"><section className="emp-card">
          <CardHead eyebrow="PROCESO DE SELECCIÓN" title="Ofertas y selección" detail="Publica necesidades ficticias y decide únicamente por criterios formativos." action={<button className="emp-button primary" type="button" onClick={() => { setVacancyFormOpen((open) => !open); setFormError(''); }} data-testid="button-new-vacancy"><Plus size={14} /> Nueva oferta</button>} />
          {vacancyFormOpen && <Form {...vacancyForm}><form className="emp-form" onSubmit={submitVacancy} data-testid="form-new-vacancy"><Field label="Puesto"><input {...vacancyForm.register('jobTitle', { required: true, minLength: 2 })} maxLength={120} placeholder="Puesto simulado" data-testid="input-vacancy-title" /></Field><Field label="Departamento"><input {...vacancyForm.register('department', { required: true, minLength: 2 })} maxLength={100} placeholder="Área educativa" data-testid="input-vacancy-department" /></Field><Field label="Modalidad"><select {...vacancyForm.register('contractType')} data-testid="select-vacancy-type"><option value="indefinite">Indefinido</option><option value="temporary">Temporal</option><option value="part_time">Tiempo parcial</option><option value="training">Formativo</option></select></Field><Field label="Descripción didáctica"><textarea {...vacancyForm.register('description', { required: true, minLength: 5 })} maxLength={2000} placeholder="Responsabilidades y contexto simulado" data-testid="input-vacancy-description" /></Field><ErrorLine message={formError} clear={() => setFormError('')} /><div className="emp-form-actions"><button className="emp-button secondary" type="button" onClick={() => setVacancyFormOpen(false)} data-testid="button-cancel-vacancy">Cancelar</button><button className="emp-button primary" disabled={createVacancy.isPending} data-testid="button-submit-vacancy"><Plus size={14} /> Crear oferta</button></div></form></Form>}
          <div className="emp-vacancy-grid">{vacancies.map((vacancy) => <button type="button" key={vacancy.id} onClick={() => { setSelectedVacancy(vacancy.id); setView('candidates'); }} className={`emp-vacancy ${selectedVacancy === vacancy.id ? 'selected' : ''}`} data-testid={`card-vacancy-${vacancy.id}`}><span className="emp-icon blue"><BriefcaseBusiness size={16} /></span><span className="emp-vacancy-copy"><b>{vacancy.jobTitle}</b><small>{vacancy.department} · {contractNames[vacancy.contractType] ?? vacancy.contractType}</small><em>{vacancy.description}</em></span><span className="emp-vacancy-meta"><Status value={vacancy.status} testId={`status-vacancy-${vacancy.id}`} /><small>{candidates.filter((candidate) => candidate.vacancyId === vacancy.id).length} candidaturas</small></span><ChevronRight size={15} /></button>)}
          {!vacancies.length && <Empty title="Aún no hay ofertas" detail="Crea una oferta ficticia para abrir el ciclo de candidaturas." />}</div>
        </section><aside className="emp-card emp-guidance"><small>TRAZABILIDAD DE APRENDIZAJE</small><h3>De la oferta a una decisión explicable.</h3><p>Las candidaturas solo guardan referencias y valoraciones numéricas. Nada de nombres, documentos o datos de contacto.</p><ol>{['Oferta ficticia', 'Referencia de candidatura', 'Valoración por criterios', 'Decisión docente', 'Expediente existente'].map((item, index) => <li key={item}><i>{String(index + 1).padStart(2, '0')}</i>{item}</li>)}</ol><span><Activity size={14} />Cada avance queda en el historial laboral.</span><div className="emp-recent-activity"><b>Actividad reciente</b>{data.events.slice(0, 3).map((item) => <div key={item.id} data-testid={`employment-event-${item.id}`}><i /><span>{item.description}<small>{item.actorName} · {dateLabel(item.createdAt)}</small></span></div>)}{!data.events.length && <small>No hay movimientos registrados todavía.</small>}</div></aside></div>}
        {view === 'candidates' && <section className="emp-card">
          <CardHead eyebrow="REFERENCIAS ANÓNIMAS" title="Candidaturas" detail="Compara formación, competencias y disponibilidad sin datos identificativos." action={<div className="emp-card-actions"><button className="emp-button secondary" type="button" onClick={() => { setEmployeeFormOpen((open) => !open); setFormError(''); }} disabled={!candidates.some((candidate) => candidate.status === 'selected' && !employees.some((employee) => employee.candidateId === candidate.id))} data-testid="button-new-employee"><Plus size={14} /> Crear expediente</button><button className="emp-button primary" type="button" onClick={() => { setCandidateFormOpen((open) => !open); setFormError(''); }} data-testid="button-new-candidate"><Plus size={14} /> Registrar candidatura</button></div>} />
          {candidateFormOpen && <form className="emp-form" onSubmit={submitCandidate} data-testid="form-new-candidate"><Field label="Oferta"><select name="vacancyId" defaultValue={selectedVacancy} required data-testid="select-candidate-vacancy"><option value="">Selecciona una oferta abierta</option>{vacancies.filter((vacancy) => vacancy.status === 'open').map((vacancy) => <option key={vacancy.id} value={vacancy.id}>{vacancy.jobTitle} · {vacancy.department}</option>)}</select></Field>{[['trainingScore','Formación'],['skillsScore','Competencias'],['availabilityScore','Disponibilidad']].map(([name,label]) => <Field key={name} label={`${label} · 0–5`}><select name={name} defaultValue="3" data-testid={`select-${name}`}>{[0,1,2,3,4,5].map((score) => <option key={score} value={score}>{score}</option>)}</select></Field>)}<p className="emp-form-note">La referencia se genera en servidor. No escribas nombres ni datos personales.</p><ErrorLine message={formError} clear={() => setFormError('')} /><div className="emp-form-actions"><button className="emp-button secondary" type="button" onClick={() => setCandidateFormOpen(false)} data-testid="button-cancel-candidate">Cancelar</button><button className="emp-button primary" disabled={createCandidate.isPending} data-testid="button-submit-candidate"><Plus size={14} /> Registrar referencia</button></div></form>}
          <div className="emp-candidate-grid">{candidates.map((candidate) => {
            const vacancy = vacancies.find((item) => item.id === candidate.vacancyId);
            return <article className="emp-candidate" key={candidate.id} data-testid={`card-candidate-${candidate.id}`}><div className="emp-candidate-head"><span className="emp-ref-mark">{candidate.candidateRef.slice(-2)}</span><div><b data-testid={`text-candidate-reference-${candidate.id}`}>{candidate.candidateRef}</b><small>{vacancy?.jobTitle ?? 'Oferta vinculada'} · {vacancy?.department ?? '—'}</small></div><Status value={candidate.status} testId={`status-candidate-${candidate.id}`} /></div><div className="emp-score-row">{[['Formación', candidate.trainingScore],['Competencias', candidate.skillsScore],['Disponibilidad', candidate.availabilityScore]].map(([label,score]) => <div key={label as string} data-testid={`score-${String(label).toLowerCase()}-${candidate.id}`}><span>{label}</span><b>{score}/5</b><i><em style={{ transform: `scaleX(${Number(score) / 5})` }} /></i></div>)}</div>{canReview && candidate.status === 'received' && <div className="emp-actions"><button type="button" onClick={() => candidateDecision(candidate.id, 'select')} disabled={busyId === candidate.id} data-testid={`button-select-candidate-${candidate.id}`}><Check size={13} /> Seleccionar</button><button type="button" onClick={() => candidateDecision(candidate.id, 'reject')} disabled={busyId === candidate.id} data-testid={`button-reject-candidate-${candidate.id}`}>No seleccionar</button></div>}</article>;
           })}{!candidates.length && <Empty title="Sin candidaturas registradas" detail="Al crear una candidatura solo se almacena una referencia ficticia y sus criterios." />}</div>
           {employeeFormOpen && <form className="emp-form" onSubmit={submitEmployee} data-testid="form-create-employee"><p className="emp-form-note">Solo las candidaturas seleccionadas pueden convertirse en expedientes ficticios. Se generará una versión inicial pendiente de revisión.</p><Field label="Candidatura seleccionada"><select name="candidateId" defaultValue="" required data-testid="select-employee-candidate"><option value="">Selecciona una referencia seleccionada</option>{candidates.filter((candidate) => candidate.status === 'selected' && !employees.some((employee) => employee.candidateId === candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.candidateRef}</option>)}</select></Field><Field label="Horas semanales"><input name="weeklyHours" type="number" min="1" max="40" defaultValue="40" required data-testid="input-employee-hours" /></Field><Field label="Grupo didáctico"><input name="contributionGroup" type="number" min="1" max="11" defaultValue="1" required data-testid="input-employee-group" /></Field><Field label="Salario anual educativo (€)"><input name="annualSalary" type="number" min="0" step=".01" required data-testid="input-employee-salary" /></Field><Field label="Convenio ficticio de referencia"><input name="conventionName" minLength={3} maxLength={120} required data-testid="input-employee-convention" /></Field><Field label="Inicio simulado"><input name="startDate" type="date" min="2027-01-01" max="2027-12-31" defaultValue={data?.simulatedDate ?? '2027-09-15'} required data-testid="input-employee-start-date" /></Field><Field label="Fin previsto · opcional"><input name="endDate" type="date" min="2027-01-01" max="2027-12-31" data-testid="input-employee-end-date" /></Field><ErrorLine message={formError} clear={() => setFormError('')} /><div className="emp-form-actions"><button type="button" className="emp-button secondary" onClick={() => setEmployeeFormOpen(false)} data-testid="button-cancel-employee">Cancelar</button><button className="emp-button primary" disabled={createEmployee.isPending} data-testid="button-submit-employee"><Plus size={14} /> Crear expediente y contrato inicial</button></div></form>}
        </section>}
        {view === 'communications' && <div className="emp-columns"><section className="emp-card"><CardHead eyebrow="COMUNICACIÓN DE CONTRATO" title="Portal educativo simulado" detail="Elige un resumen contractual y observa el acuse o la subsanación simulada." />
          {contracts.length ? <div className="emp-record-stack">{contracts.map((contract) => <article className="emp-record" key={contract.id} data-testid={`record-communication-contract-${contract.id}`}><div className="emp-record-top"><span className="emp-icon blue"><FileText size={16} /></span><div><b>{contractEmployee(contract)?.workerRef ?? 'Referencia laboral'}</b><small>{contract.documentType === 'amendment' ? 'Cambio contractual' : 'Contrato inicial'} · v{contract.version} · {dateLabel(contract.effectiveDate)}</small></div><Status value={contract.status} testId={`status-communication-contract-${contract.id}`} /></div>{renderCommunicationForm(contract, contract.documentType === 'amendment' ? 'amendment' : 'initial_contract', `contract-${contract.id}`)}</article>)}</div> : <Empty title="No hay resúmenes contractuales" detail="Los resúmenes se crean desde Extensiones y cambios tras tener un expediente laboral." />}</section>
          <aside className="emp-card emp-portal-note"><div className="emp-icon violet"><BadgeCheck size={18} /></div><small>RESPUESTA DEL PORTAL VIRTUAL</small><h3>Un resultado visible, sin salida al exterior.</h3><p>La respuesta elegida se almacena junto a la comunicación del expediente. No se conecta con organismos ni se presenta documentación.</p><span><ShieldAlert size={14} /> Referencias educativas, no oficiales.</span></aside></div>}
        {view === 'changes' && <div className="emp-columns"><section className="emp-card"><CardHead eyebrow="VERSIÓN CONTRACTUAL" title="Extensiones y modificaciones" detail="Genera un nuevo resumen de condiciones. Las modificaciones requieren revisión docente." action={<button className="emp-button primary" type="button" onClick={() => { setContractFormOpen((open) => !open); setFormError(''); }} data-testid="button-new-amendment"><Plus size={14} /> Nuevo cambio</button>} />
          {contractFormOpen && <form className="emp-form" onSubmit={submitContract} data-testid="form-new-amendment"><Field label="Expediente"><select name="employeeId" defaultValue="" required data-testid="select-contract-employee"><option value="">Selecciona una referencia activa</option>{employees.filter((employee) => employee.status === 'active').map((employee) => <option key={employee.id} value={employee.id}>{employee.workerRef} · {employee.jobTitle}</option>)}</select></Field><Field label="Tipo contractual"><select name="contractType" defaultValue="temporary" data-testid="select-contract-type">{Object.entries(contractNames).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Fecha efectiva"><input name="effectiveDate" type="date" min="2027-01-01" max="2027-12-31" required data-testid="input-contract-effective-date" /></Field><Field label="Fin previsto · opcional"><input name="endDate" type="date" min="2027-01-01" max="2027-12-31" data-testid="input-contract-end-date" /></Field><Field label="Horas semanales"><input name="weeklyHours" type="number" min="1" max="40" defaultValue="40" required data-testid="input-contract-hours" /></Field><Field label="Grupo didáctico"><input name="contributionGroup" type="number" min="1" max="11" defaultValue="1" required data-testid="input-contract-group" /></Field><Field label="Salario anual educativo (€)"><input name="annualSalary" type="number" min="0" step=".01" required data-testid="input-contract-salary" /></Field><Field label="Convenio de referencia"><input name="conventionName" minLength={3} maxLength={120} required data-testid="input-contract-convention" /></Field><ErrorLine message={formError} clear={() => setFormError('')} /><div className="emp-form-actions"><button type="button" className="emp-button secondary" onClick={() => setContractFormOpen(false)} data-testid="button-cancel-amendment">Cancelar</button><button className="emp-button primary" disabled={createContract.isPending} data-testid="button-submit-amendment"><Plus size={14} /> Enviar a revisión</button></div></form>}
          <div className="emp-record-stack">{contracts.map((contract) => <article className="emp-contract-row" key={contract.id} data-testid={`record-contract-${contract.id}`}><div><span className="emp-icon amber"><FileText size={15} /></span><span><b>{contractEmployee(contract)?.workerRef ?? 'Referencia laboral'} · v{contract.version}</b><small>{contract.documentType === 'amendment' ? 'Modificación' : 'Resumen inicial'} · {contractNames[contract.contractType] ?? contract.contractType} · {contract.weeklyHours} h/sem.</small></span></div><Status value={contract.status} testId={`status-contract-${contract.id}`} /><small>{dateLabel(contract.effectiveDate)} — {dateLabel(contract.endDate)}</small></article>)}{!contracts.length && !contractFormOpen && <Empty title="Aún no hay versiones" detail="Crea un resumen a partir de un expediente activo." />}</div>
        </section><aside className="emp-card emp-guidance compact"><small>REVISIÓN · DOCUMENTACIÓN EDUCATIVA</small><h3>Revisa los cambios antes de comunicar.</h3><p>El historial conserva versiones previas y distingue claramente una modificación de un contrato inicial.</p><button type="button" className="emp-text-action" onClick={() => setView('inbox')} data-testid="button-go-inbox">Abrir bandeja administrativa <ArrowRight size={14} /></button></aside></div>}
        {view === 'closure' && <div className="emp-columns"><section className="emp-card"><CardHead eyebrow="CIERRE DEL EXPEDIENTE" title="Finalización y certificados" detail="Registra una fecha de cierre para revisión y practica su comunicación simulada." action={<button className="emp-button primary" type="button" onClick={() => { setTerminationFormOpen((open) => !open); setFormError(''); }} data-testid="button-new-termination"><Plus size={14} /> Registrar finalización</button>} />
          {terminationFormOpen && <form className="emp-form" onSubmit={submitTermination} data-testid="form-new-termination"><Field label="Expediente activo">{employeeSelect('employeeId', true)}</Field><Field label="Fecha efectiva de finalización"><input name="effectiveDate" type="date" min="2027-01-01" max="2027-12-31" required data-testid="input-termination-date" /></Field><p className="emp-form-note">Registro ficticio para evaluación interna; no comunica una baja real.</p><ErrorLine message={formError} clear={() => setFormError('')} /><div className="emp-form-actions"><button type="button" className="emp-button secondary" onClick={() => setTerminationFormOpen(false)} data-testid="button-cancel-termination">Cancelar</button><button className="emp-button primary" disabled={createTermination.isPending} data-testid="button-submit-termination"><Plus size={14} /> Registrar cierre</button></div></form>}
          <div className="emp-record-stack">{lifecycle.map((change) => <article className="emp-record" key={change.id} data-testid={`record-lifecycle-${change.id}`}><div className="emp-record-top"><span className="emp-icon coral"><FileCheck2 size={16} /></span><div><b>{change.workerRef} · Finalización</b><small>Fecha efectiva · {dateLabel(change.effectiveDate)}</small></div><Status value={change.status} testId={`status-lifecycle-${change.id}`} /></div><div className="emp-record-bottom"><span>Revisión: {change.reviewedByName ?? 'Pendiente de revisión'}</span>{renderCommunicationForm(change, 'termination', `termination-${change.id}`)}</div></article>)}{!lifecycle.length && !terminationFormOpen && <Empty title="No hay finalizaciones registradas" detail="Los cambios de ciclo existentes aparecerán aquí con su estado de revisión." />}</div>
        </section><aside className="emp-card emp-guidance compact"><small>CONSTANCIA DE PRÁCTICA</small><h3>El certificado pertenece al escenario.</h3><p>Se utiliza la trazabilidad de expedientes ya existentes. No se emiten certificados oficiales ni se crean entidades adicionales.</p><span><BadgeCheck size={15} />Cierre rastreable dentro de Empleo FP360</span></aside></div>}
        {view === 'inbox' && <div className="emp-columns"><section className="emp-card"><CardHead eyebrow="REVISIÓN INTERNA" title="Bandeja administrativa" detail="Pendientes reales del expediente laboral, visibles para docentes y administración." />
          {!canReview && <div className="emp-permission inline"><LockKeyhole size={15} /> Solo docentes y administración pueden confirmar, observar o aprobar registros.</div>}
          <div className="emp-record-stack">{pendingContracts.map((contract) => <article className="emp-inbox-item" key={contract.id} data-testid={`inbox-contract-${contract.id}`}><span className="emp-icon blue"><FileText size={16} /></span><div><b>Resumen contractual · {contractEmployee(contract)?.workerRef ?? 'Referencia laboral'} · v{contract.version}</b><small>{contract.documentType === 'amendment' ? 'Modificación' : 'Contrato inicial'} · {contractNames[contract.contractType]} · {dateLabel(contract.effectiveDate)}</small><Status value={contract.status} testId={`status-inbox-contract-${contract.id}`} /></div>{canReview && <div className="emp-actions"><button type="button" onClick={() => review('contract', contract.id, 'confirm')} disabled={busyId === contract.id} data-testid={`button-confirm-contract-${contract.id}`}><Check size={13} /> Confirmar</button><button type="button" onClick={() => review('contract', contract.id, 'observe')} disabled={busyId === contract.id} data-testid={`button-observe-contract-${contract.id}`}>Observar</button></div>}</article>)}
            {pendingLifecycle.map((change) => <article className="emp-inbox-item" key={change.id} data-testid={`inbox-lifecycle-${change.id}`}><span className="emp-icon coral"><FileCheck2 size={16} /></span><div><b>Finalización · {change.workerRef}</b><small>Fecha efectiva · {dateLabel(change.effectiveDate)}</small><Status value={change.status} testId={`status-inbox-lifecycle-${change.id}`} /></div>{canReview && <div className="emp-actions"><button type="button" onClick={() => review('termination', change.id, 'approve')} disabled={busyId === change.id} data-testid={`button-approve-lifecycle-${change.id}`}><Check size={13} /> Aprobar</button><button type="button" onClick={() => review('termination', change.id, 'observe')} disabled={busyId === change.id} data-testid={`button-observe-lifecycle-${change.id}`}>Observar</button></div>}</article>)}
            {pendingCommunications.map((communication) => <article className="emp-inbox-item" key={communication.id} data-testid={`inbox-communication-${communication.id}`}><span className="emp-icon amber"><Send size={15} /></span><div><b>Subsanación · {communication.communicationRef}</b><small>{dateLabel(communication.simulatedDate)} · {communication.responseMessage ?? 'Comunicación observada'}</small><Status value={communication.status} testId={`status-inbox-communication-${communication.id}`} /></div><button type="button" className="emp-button secondary" onClick={() => retryCommunication(communication)} disabled={resubmitCommunication.isPending} data-testid={`button-inbox-resubmit-${communication.id}`}>Reenviar simulado</button></article>)}
            {pendingReviews === 0 && <Empty title="Bandeja al día" detail="No hay revisiones pendientes en los registros laborales de esta organización." />}</div>
        </section><aside className="emp-card"><CardHead eyebrow="HISTORIAL DE COMUNICACIONES" title="Respuestas del portal simulado" detail="Acuses, observaciones y reintentos conservan la referencia del servidor." />
          {communicationsQuery.isLoading ? <div className="emp-skeleton small" role="status" aria-label="Cargando comunicaciones"><span /><span /><span /></div> : communications.length ? <div className="emp-communication-list">{[...communications].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map((communication) => <article className="emp-communication-item" key={communication.id} data-testid={`communication-${communication.id}`}><div><b data-testid={`text-communication-reference-${communication.id}`}>{communication.communicationRef}</b><Status value={communication.status} testId={`status-communication-${communication.id}`} /></div><p>{communication.communicationType === 'initial_contract' ? 'Contrato inicial' : communication.communicationType === 'amendment' ? 'Modificación' : 'Finalización'} · {dateLabel(communication.simulatedDate)}</p><small>{communication.acknowledgmentRef ? `Acuse: ${communication.acknowledgmentRef}` : 'Sin acuse simulado'}{communication.resubmittedAt ? ` · Reintentado ${dateLabel(communication.resubmittedAt)}` : ''}</small>{communication.responseMessage && <blockquote data-testid={`text-communication-response-${communication.id}`}>{communication.responseMessage}</blockquote>}{communication.status === 'observed' && <button type="button" className="emp-retry" onClick={() => retryCommunication(communication)} disabled={resubmitCommunication.isPending} data-testid={`button-resubmit-communication-${communication.id}`}><Activity size={13} /> Repetir subsanación simulada</button>}</article>)}</div> : <Empty title="Aún no hay comunicaciones" detail="Los resultados simulados aparecerán aquí después de comunicar un resumen o una finalización." />}</aside></div>}
      </div>}
      {certificate && <div className="emp-certificate-overlay" role="dialog" aria-modal="true" aria-labelledby="employment-certificate-title" data-testid="employment-certificate-preview"><section className="emp-certificate"><header><span className="emp-certificate-mark">R</span><div><b>RED FP360</b><small>Constancia educativa de finalización</small></div><button type="button" onClick={() => setCertificate(null)} aria-label="Cerrar constancia" data-testid="button-close-certificate">×</button></header><span className="emp-certificate-stamp">DOCUMENTO SINTÉTICO · NO OFICIAL</span><h2 id="employment-certificate-title">Constancia de práctica</h2><p>Se deja constancia, únicamente a efectos didácticos, del cierre del expediente laboral ficticio indicado a continuación.</p><dl><div><dt>Referencia documental</dt><dd data-testid="certificate-reference">{certificate.certificateRef}</dd></div><div><dt>Referencia laboral</dt><dd>{certificate.workerRef}</dd></div><div><dt>Puesto simulado</dt><dd>{certificate.jobTitle} · {certificate.department}</dd></div><div><dt>Fecha efectiva</dt><dd>{dateLabel(certificate.effectiveDate)}</dd></div><div><dt>Fecha del escenario</dt><dd>{dateLabel(certificate.simulatedDate)}</dd></div><div><dt>Emitida en el sistema</dt><dd>{dateLabel(certificate.issuedAt)}</dd></div></dl><blockquote>{certificate.disclaimer}</blockquote><footer><button type="button" className="emp-button secondary" onClick={() => setCertificate(null)} data-testid="button-dismiss-certificate">Cerrar</button><button type="button" className="emp-button primary" onClick={() => window.print()} data-testid="button-print-certificate"><FileText size={14} /> Imprimir o guardar como PDF</button></footer></section></div>}
      <footer className="emp-footer"><ShieldAlert size={15} /><span>Empleo FP360 es un entorno de práctica. Las decisiones y respuestas no tienen efectos laborales reales.</span><span>Curso didáctico · 2027–2028</span></footer>
    </>}
  </main>;
}

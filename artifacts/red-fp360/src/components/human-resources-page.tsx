import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowRight, BadgeCheck, BriefcaseBusiness, CalendarDays, Check, CircleAlert,
  ClipboardList, Clock3, Download, FileText, Filter, LockKeyhole, Plus, Search, ShieldAlert,
  UserRound, Users, X,
} from 'lucide-react';
import {
  getGetFp360HrOverviewQueryKey, useCreateFp360HrAbsence, useCreateFp360HrCandidate,
  useCreateFp360HrContract, useCreateFp360HrEmployee, useCreateFp360HrTermination,
  useCreateFp360HrVacancy, useDecideFp360HrCandidate, useGetFp360HrOverview,
  useReviewFp360HrAbsence, useReviewFp360HrContract, useReviewFp360HrTermination,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360HrAbsence, Fp360HrContract, Fp360HrEmployee,
  Fp360HrLifecycleChange, Fp360HrOverview, Fp360HrVacancy, Fp360Organization,
} from '@workspace/api-client-react';
import './human-resources-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'staff' | 'profile' | 'selection' | 'contracts' | 'attendance' | 'lifecycle' | 'reports';
const tabs: Array<{ id: View; label: string; icon: typeof Users }> = [
  { id: 'staff', label: 'Plantilla', icon: Users }, { id: 'profile', label: 'Ficha de personal', icon: UserRound },
  { id: 'selection', label: 'Selección', icon: BriefcaseBusiness }, { id: 'contracts', label: 'Contratos', icon: FileText },
  { id: 'attendance', label: 'Jornada y ausencias', icon: CalendarDays }, { id: 'lifecycle', label: 'Altas y bajas', icon: Activity },
  { id: 'reports', label: 'Informes de personal', icon: ClipboardList },
];
const contractNames: Record<string, string> = { indefinite: 'Indefinido', temporary: 'Temporal', part_time: 'Tiempo parcial', training: 'Formación' };
const statusNames: Record<string, string> = {
  active: 'Activo', pending: 'Pendiente', inactive: 'Inactivo', open: 'Abierta', filled: 'Cubierta', closed: 'Cerrada',
  received: 'Recibida', selected: 'Seleccionada', rejected: 'Descartada', pending_review: 'Pendiente de revisión',
  confirmed: 'Confirmado', observed: 'Observado', approved: 'Aprobada',
};
const euro = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const operationId = () => crypto.randomUUID();
const canReviewRole = (role: AuthIdentity['role']) => role === 'teacher' || role === 'administrator';
function Status({ value }: { value: string }) {
  const tone = ['active', 'confirmed', 'approved', 'selected'].includes(value) ? 'good' : ['pending', 'pending_review', 'received', 'open'].includes(value) ? 'waiting' : 'quiet';
  return <span className={`hr-status ${tone}`}><i />{statusNames[value] ?? value}</span>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="hr-empty"><span><ClipboardList size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="hr-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function HumanResourcesPage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const canReview = canReviewRole(identity.role);
  const [selectedOrg, setSelectedOrg] = useState(identity.organizationId ?? '');
  const organizationId = identity.organizationId ?? selectedOrg;
  const [view, setView] = useState<View>('staff');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [selectedVacancyId, setSelectedVacancyId] = useState('');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [showVacancyForm, setShowVacancyForm] = useState(false);
  const [showCandidateForm, setShowCandidateForm] = useState(false);
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [showContractForm, setShowContractForm] = useState(false);
  const [showAbsenceForm, setShowAbsenceForm] = useState(false);
  const [showTerminationForm, setShowTerminationForm] = useState(false);

  useEffect(() => {
    if (!identity.organizationId && !selectedOrg && organizations[0]) setSelectedOrg(organizations[0].id);
  }, [identity.organizationId, organizations, selectedOrg]);

  const queryKey = getGetFp360HrOverviewQueryKey({ organizationId });
  const overviewQuery = useGetFp360HrOverview({ organizationId }, { query: { enabled: Boolean(organizationId) } });
  const createVacancy = useCreateFp360HrVacancy();
  const createCandidate = useCreateFp360HrCandidate();
  const decideCandidate = useDecideFp360HrCandidate();
  const createEmployee = useCreateFp360HrEmployee();
  const createContract = useCreateFp360HrContract();
  const reviewContract = useReviewFp360HrContract();
  const createAbsence = useCreateFp360HrAbsence();
  const reviewAbsence = useReviewFp360HrAbsence();
  const createTermination = useCreateFp360HrTermination();
  const reviewTermination = useReviewFp360HrTermination();
  const data = overviewQuery.data as Fp360HrOverview | undefined;
  const employees = useMemo(() => data?.employees ?? [], [data?.employees]);
  const vacancies = useMemo(() => data?.vacancies ?? [], [data?.vacancies]);
  const candidates = useMemo(() => data?.candidates ?? [], [data?.candidates]);
  const contracts = useMemo(() => data?.contracts ?? [], [data?.contracts]);
  const absences = useMemo(() => data?.absences ?? [], [data?.absences]);
  const lifecycle = useMemo(() => data?.lifecycleChanges ?? [], [data?.lifecycleChanges]);
  const invalidate = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const fail = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
  const term = search.trim().toLocaleLowerCase('es');
  const departments = useMemo(() => [...new Set(employees.map((item) => item.department))].sort(), [employees]);
  const visibleEmployees = employees.filter((item) =>
    `${item.workerRef} ${item.jobTitle} ${item.department} ${item.status}`.toLocaleLowerCase('es').includes(term) &&
    (statusFilter === 'all' || item.status === statusFilter) && (departmentFilter === 'all' || item.department === departmentFilter));
  const selectedEmployee = employees.find((item) => item.id === selectedEmployeeId) ?? employees[0];
  const selectedVacancy = vacancies.find((item) => item.id === selectedVacancyId) ?? vacancies.find((item) => item.status === 'open');
  const candidateEmployee = (candidateId: string) => employees.find((item) => item.candidateId === candidateId);
  const retry = () => invalidate();
  const notifySaved = (message: string, form: HTMLFormElement) => {
    invalidate(); form.reset(); setFormError(''); onNotice(message);
  };
  const submitVacancy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form);
    if (!organizationId) { setFormError('Selecciona una empresa antes de continuar.'); return; }
    createVacancy.mutate({ data: {
      organizationId, jobTitle: String(fd.get('jobTitle')).trim(), department: String(fd.get('department')).trim(),
      contractType: String(fd.get('contractType')) as never, description: String(fd.get('description')).trim(), operationId: operationId(),
    } }, { onSuccess: () => { notifySaved('Vacante educativa creada; la referencia se asignará en el servidor.', form); setShowVacancyForm(false); }, onError: (e) => setFormError(fail(e, 'No se pudo crear la vacante.')) });
  };
  const submitCandidate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form);
    const vacancyId = String(fd.get('vacancyId')); const scores = ['trainingScore', 'skillsScore', 'availabilityScore'].map((key) => Number(fd.get(key)));
    if (!vacancyId || scores.some((score) => !Number.isInteger(score) || score < 0 || score > 5)) { setFormError('Elige una vacante y puntuaciones de 0 a 5.'); return; }
    createCandidate.mutate({ vacancyId, data: { trainingScore: scores[0], skillsScore: scores[1], availabilityScore: scores[2], operationId: operationId() } }, {
      onSuccess: () => { notifySaved('Candidatura anonimizada registrada.', form); setShowCandidateForm(false); },
      onError: (e) => setFormError(fail(e, 'No se pudo registrar la candidatura.')),
    });
  };
  const candidateDecision = (candidateId: string, action: 'select' | 'reject') => {
    if (!canReview || !window.confirm(`¿Confirmas ${action === 'select' ? 'la selección' : 'el descarte'} de esta referencia anónima?`)) return;
    setBusyId(candidateId); setActionError('');
    decideCandidate.mutate({ candidateId, data: { action, operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setBusyId(''); onNotice(action === 'select' ? 'Candidatura seleccionada en la simulación.' : 'Candidatura descartada en la simulación.'); },
      onError: (e) => { setBusyId(''); setActionError(fail(e, 'No se pudo revisar la candidatura.')); },
    });
  };
  const submitEmployee = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form);
    const candidateId = String(fd.get('candidateId')); const weeklyHours = Number(fd.get('weeklyHours'));
    const group = Number(fd.get('contributionGroup')); const salary = Number(fd.get('annualSalary'));
    const startDate = String(fd.get('startDate')); const endDate = String(fd.get('endDate') ?? '') || null;
    if (!organizationId || !candidateId || weeklyHours < 1 || weeklyHours > 40 || group < 1 || group > 11 || !Number.isFinite(salary) || salary < 0 || !startDate.startsWith('2027') || (endDate && (!endDate.startsWith('2027') || endDate < startDate))) { setFormError('Revisa la referencia, horas (1–40), grupo (1–11), importe y fechas de 2027.'); return; }
    createEmployee.mutate({ data: {
      organizationId, candidateId, weeklyHours, contributionGroup: group, annualSalaryCents: Math.round(salary * 100),
      conventionName: String(fd.get('conventionName')).trim(), startDate, endDate, operationId: operationId(),
    } }, { onSuccess: () => { notifySaved('Alta ficticia creada. Las referencias laborales y virtuales son generadas por el servidor.', form); setShowEmployeeForm(false); }, onError: (e) => setFormError(fail(e, 'No se pudo crear el alta.')) });
  };
  const submitContract = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const employeeId = String(fd.get('employeeId'));
    const hours = Number(fd.get('weeklyHours')); const group = Number(fd.get('contributionGroup')); const salary = Number(fd.get('annualSalary'));
    const effectiveDate = String(fd.get('effectiveDate')); const endDate = String(fd.get('endDate') ?? '') || null;
    if (!employeeId || hours < 1 || hours > 40 || group < 1 || group > 11 || !effectiveDate.startsWith('2027') || (endDate && (!endDate.startsWith('2027') || endDate < effectiveDate))) { setFormError('Completa los campos con horas/grupo válidos y fechas de 2027.'); return; }
    createContract.mutate({ employeeId, data: { effectiveDate, endDate, contractType: String(fd.get('contractType')) as never, weeklyHours: hours, annualSalaryCents: Math.round(salary * 100), contributionGroup: group, conventionName: String(fd.get('conventionName')).trim(), operationId: operationId() } }, {
      onSuccess: () => { notifySaved('Resumen contractual educativo enviado a revisión.', form); setShowContractForm(false); },
      onError: (e) => setFormError(fail(e, 'No se pudo crear el resumen contractual.')),
    });
  };
  const submitAbsence = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const employeeId = String(fd.get('employeeId'));
    const startDate = String(fd.get('startDate')); const endDate = String(fd.get('endDate'));
    if (!employeeId || !startDate.startsWith('2027') || !endDate.startsWith('2027') || endDate < startDate) { setFormError('Elige una persona y un intervalo válido dentro de 2027.'); return; }
    createAbsence.mutate({ employeeId, data: { absenceType: String(fd.get('absenceType')) as never, startDate, endDate, operationId: operationId() } }, {
      onSuccess: () => { notifySaved('Ausencia ficticia registrada para revisión.', form); setShowAbsenceForm(false); },
      onError: (e) => setFormError(fail(e, 'No se pudo registrar la ausencia.')),
    });
  };
  const submitTermination = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const employeeId = String(fd.get('employeeId')); const effectiveDate = String(fd.get('effectiveDate'));
    if (!employeeId || !effectiveDate.startsWith('2027') || !window.confirm('¿Registrar esta baja únicamente en el escenario educativo? No se comunicará a organismos externos.')) { return; }
    createTermination.mutate({ employeeId, data: { effectiveDate, operationId: operationId() } }, {
      onSuccess: () => { notifySaved('Baja educativa registrada y pendiente de revisión.', form); setShowTerminationForm(false); },
      onError: (e) => setFormError(fail(e, 'No se pudo registrar la baja.')),
    });
  };
  const review = (kind: 'contract' | 'absence' | 'termination', id: string, action: 'confirm' | 'approve' | 'observe') => {
    if (!canReview || !window.confirm('¿Confirmas esta decisión dentro de la simulación educativa?')) return;
    setBusyId(id); setActionError('');
    const onSuccess = (message: string) => { invalidate(); setBusyId(''); onNotice(message); };
    const onError = (e: unknown) => { setBusyId(''); setActionError(fail(e, 'No se pudo guardar la revisión.')); };
    if (kind === 'contract') reviewContract.mutate({ contractId: id, data: { action: action as 'confirm' | 'observe', operationId: operationId() } }, { onSuccess: () => onSuccess('Revisión contractual educativa registrada.'), onError });
    if (kind === 'absence') reviewAbsence.mutate({ absenceId: id, data: { action: action === 'approve' ? 'approve' : 'observe', operationId: operationId() } }, { onSuccess: () => onSuccess('Revisión de ausencia educativa registrada.'), onError });
    if (kind === 'termination') reviewTermination.mutate({ changeId: id, data: { action: action === 'approve' ? 'approve' : 'observe', operationId: operationId() } }, { onSuccess: () => onSuccess('Revisión de baja educativa registrada.'), onError });
  };
  const exportCsv = (dataset?: 'employees' | 'contracts' | 'absences') => {
    const target = dataset ?? (view === 'contracts' ? 'contracts' : view === 'attendance' ? 'absences' : 'employees');
    const rows = target === 'employees' ? employees.map((e) => [e.workerRef, e.jobTitle, e.department, contractNames[e.contractType], e.weeklyHours, e.contributionGroup, e.annualSalaryCents, e.startDate, e.endDate ?? '', e.status]) :
      target === 'contracts' ? contracts.map((c) => [employees.find((e) => e.id === c.employeeId)?.workerRef ?? '', `v${c.version}`, c.documentType, c.effectiveDate, c.contractType, c.weeklyHours, c.annualSalaryCents, c.contributionGroup, c.status]) :
      absences.map((a) => [a.workerRef, a.absenceType, a.startDate, a.endDate, a.status]);
    const headers = target === 'employees' ? ['Referencia', 'Puesto', 'Departamento', 'Contrato', 'Horas semanales', 'Grupo', 'Salario anual (céntimos)', 'Inicio', 'Fin', 'Estado'] : target === 'contracts' ? ['Referencia', 'Versión', 'Tipo documento', 'Vigencia', 'Contrato', 'Horas', 'Salario anual (céntimos)', 'Grupo', 'Estado'] : ['Referencia', 'Tipo', 'Inicio', 'Fin', 'Estado'];
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `red-fp360-personal-2027-${target}.csv`; link.click(); URL.revokeObjectURL(url);
    onNotice('Informe CSV exportado con los datos cargados en esta vista.');
  };

  const renderError = (message: string, clear: () => void) => <p className="hr-form-error" role="alert"><CircleAlert size={14} />{message}<button type="button" onClick={clear} aria-label="Cerrar error"><X size={13} /></button></p>;
  const formActions = (pending: boolean, text: string, close: () => void) => <div className="hr-form-actions"><button type="button" className="hr-button secondary" onClick={close}>Cancelar</button><button className="hr-button primary" type="submit" disabled={pending}><Plus size={14} />{pending ? 'Guardando…' : text}</button></div>;
  const employeeSelect = (name = 'employeeId', filter: (employee: Fp360HrEmployee) => boolean = () => true) => <select name={name} defaultValue="" required><option value="">Selecciona una referencia</option>{employees.filter(filter).map((employee) => <option key={employee.id} value={employee.id}>{employee.workerRef} · {employee.jobTitle}</option>)}</select>;
  const contractReviewButtons = (contract: Fp360HrContract) => canReview && contract.status === 'pending_review' && <div className="hr-actions"><button type="button" onClick={() => review('contract', contract.id, 'confirm')} disabled={busyId === contract.id}><Check size={13} /> Confirmar</button><button type="button" onClick={() => review('contract', contract.id, 'observe')} disabled={busyId === contract.id}>Observar</button></div>;
  const decisionButtons = (item: Fp360HrAbsence | Fp360HrLifecycleChange, kind: 'absence' | 'termination') => canReview && item.status === 'pending_review' && <div className="hr-actions"><button type="button" onClick={() => review(kind, item.id, 'approve')} disabled={busyId === item.id}><Check size={13} /> Aprobar</button><button type="button" onClick={() => review(kind, item.id, 'observe')} disabled={busyId === item.id}>Observar</button></div>;

  return <main className="page-content hr-page">
    <header className="hr-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>PERSONAS · CICLO LABORAL</span></div><span className="hr-greeting">CURSO 2027–2028 · EMPRESAS FICTICIAS DE CANARIAS</span><h1>Recursos humanos</h1><p>Un expediente claro, desde la vacante hasta la baja. Referencias anónimas y decisiones trazables.</p></div>
      <div className="hr-heading-tools">{!identity.organizationId && canReview && <label className="hr-org-select">Empresa<select value={organizationId} onChange={(e) => setSelectedOrg(e.target.value)}><option value="">Selecciona empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}<span className="hr-date"><CalendarDays size={14} /> Escenario · 2027</span></div>
    </header>
    <aside className="hr-legal"><ShieldAlert size={18} /><div><b>SIMULACIÓN EDUCATIVA · SIN VALIDEZ LEGAL</b><span>No se realizan comunicaciones a Seguridad Social, Empleo ni Banco. No introduzcas nombres, documentos, contactos, información médica o IBAN. Los contratos son resúmenes educativos, no documentos oficiales ni firmas.</span></div><strong>NO OFICIAL</strong></aside>
    {!organizationId ? <section className="hr-unselected"><Users size={25} /><span className="hr-overline">ÁMBITO DE TRABAJO</span><h2>Selecciona una empresa</h2><p>La plantilla y sus expedientes se consultan para una organización cada vez.</p>{canReview ? <select aria-label="Empresa" value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select> : <p>Tu perfil no tiene una empresa asignada. Solicita al equipo docente que configure el acceso.</p>}</section> : <>
      <div className="hr-summary-strip"><span><i /> Empresa activa · datos trazables</span><span>Fecha del escenario · {dateLabel(data?.simulatedDate ?? '2027-09-15')}</span></div>
      <nav className="hr-tabs" role="tablist" aria-label="Vistas de Recursos humanos">{tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} key={id} onClick={() => { setView(id); setFormError(''); setActionError(''); }}><Icon size={15} />{label}</button>)}</nav>
      {overviewQuery.isLoading ? <div className="hr-skeleton" role="status" aria-label="Cargando personal"><span /><span /><span /><span /><span /></div> : overviewQuery.isError ? <div className="hr-error" role="alert"><CircleAlert size={17} /><span>No se ha podido cargar el expediente laboral.</span><button type="button" onClick={retry}>Reintentar</button></div> : data && <>
        <section className="hr-metrics">
          <article><span className="teal"><Users size={17} /></span><small>Personal activo</small><b>{data.summary.activeEmployees}</b><em>Referencias laborales ficticias</em></article>
          <article><span className="blue"><BriefcaseBusiness size={17} /></span><small>Vacantes abiertas</small><b>{data.summary.openVacancies}</b><em>{vacancies.length} procesos en el escenario</em></article>
          <article><span className="amber"><FileText size={17} /></span><small>Contratos por revisar</small><b>{data.summary.pendingContracts}</b><em>{data.summary.contractsExpiringSoon} con vencimiento próximo</em></article>
          <article><span className="coral"><CalendarDays size={17} /></span><small>Ausencias pendientes</small><b>{data.summary.pendingAbsences}</b><em>Revisión dentro de FP360</em></article>
        </section>
        {!canReview && <div className="hr-permission"><LockKeyhole size={15} /> Tu perfil puede consultar y registrar expedientes; las decisiones de selección, confirmación y aprobación requieren rol docente o administración.</div>}
        {actionError && renderError(actionError, () => setActionError(''))}
        <div className="hr-view page-enter">
          {view === 'staff' && <section className="hr-panel">
            <header className="hr-section-head"><div><span className="hr-overline">DIRECTORIO ANONIMIZADO</span><h2>Plantilla</h2><p>Solo referencias y atributos de trabajo. El servidor genera FP-EMP y VB.</p></div><button className="hr-button primary" type="button" onClick={() => { setView('profile'); setShowEmployeeForm(true); }}><Plus size={14} /> Nuevo expediente</button></header>
            <div className="hr-toolbar"><label className="hr-search"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar referencia, puesto o departamento" aria-label="Buscar plantilla" /></label><label className="hr-filter"><Filter size={14} /><select aria-label="Filtrar por departamento" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}><option value="all">Todos los departamentos</option>{departments.map((d) => <option key={d}>{d}</option>)}</select></label><select aria-label="Filtrar por estado" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos los estados</option><option value="active">Activo</option><option value="pending">Pendiente</option><option value="inactive">Inactivo</option></select></div>
            <div className="hr-staff-layout"><div className="hr-table-scroll"><table><thead><tr><th>Referencia</th><th>Puesto</th><th>Departamento</th><th>Jornada</th><th>Contrato</th><th>Alta</th><th>Estado</th></tr></thead><tbody>{visibleEmployees.map((employee) => <tr key={employee.id} className={selectedEmployee?.id === employee.id ? 'selected' : ''}><td><button className="hr-row-select" type="button" onClick={() => setSelectedEmployeeId(employee.id)}><b>{employee.workerRef}</b></button></td><td>{employee.jobTitle}</td><td>{employee.department}</td><td>{employee.weeklyHours} h/sem.</td><td>{contractNames[employee.contractType]}</td><td>{dateLabel(employee.startDate)}</td><td><Status value={employee.status} /></td></tr>)}{!visibleEmployees.length && <tr><td colSpan={7}><Empty title="Sin expedientes coincidentes" detail="Ajusta los filtros o inicia un expediente desde una candidatura seleccionada." /></td></tr>}</tbody></table></div>
              {selectedEmployee ? <aside className="hr-detail"><div className="hr-detail-top"><span className="hr-avatar"><UserRound size={19} /></span><div><small>EXPEDIENTE DE PERSONAL</small><h3>{selectedEmployee.workerRef}</h3><span>{selectedEmployee.jobTitle} · {selectedEmployee.department}</span></div><Status value={selectedEmployee.status} /></div><dl><div><dt>Tipo de contrato</dt><dd>{contractNames[selectedEmployee.contractType]}</dd></div><div><dt>Jornada semanal</dt><dd>{selectedEmployee.weeklyHours} horas</dd></div><div><dt>Grupo</dt><dd>{selectedEmployee.contributionGroup}</dd></div><div><dt>Salario anual educativo</dt><dd>{euro(selectedEmployee.annualSalaryCents)}</dd></div><div><dt>Convenio de referencia</dt><dd>{selectedEmployee.conventionName}</dd></div><div><dt>Cuenta virtual</dt><dd className="mono">{selectedEmployee.virtualBankRef}</dd></div><div><dt>Periodo</dt><dd>{dateLabel(selectedEmployee.startDate)} – {dateLabel(selectedEmployee.endDate)}</dd></div></dl><div className="hr-detail-actions"><button type="button" onClick={() => { setView('contracts'); setShowContractForm(true); }} disabled={selectedEmployee.status !== 'active'}><FileText size={13} /> Resumen contractual</button><button type="button" onClick={() => { setView('lifecycle'); setShowTerminationForm(true); }} disabled={selectedEmployee.status !== 'active'}>Registrar baja</button></div>{selectedEmployee.status !== 'active' && <small className="hr-lock-note">Expediente no activo: las acciones están bloqueadas.</small>}</aside> : <aside className="hr-detail"><Empty title="Aún no hay personal" detail="Los expedientes aparecen tras seleccionar una candidatura y tramitar un alta ficticia." /></aside>}</div>
          </section>}

          {view === 'profile' && <div className="hr-two-col"><section className="hr-panel"><header className="hr-section-head"><div><span className="hr-overline">EXPEDIENTE ANONIMIZADO</span><h2>{showEmployeeForm ? 'Crear ficha de personal' : selectedEmployee ? selectedEmployee.workerRef : 'Ficha de personal'}</h2><p>Solo referencias educativas. Nunca se solicitan datos identificativos.</p></div>{!showEmployeeForm && <button className="hr-button primary" type="button" onClick={() => setShowEmployeeForm(true)}><Plus size={14} /> Nueva ficha</button>}</header>{showEmployeeForm ? <form className="hr-form" onSubmit={submitEmployee}><Field label="Referencia de candidatura"><select name="candidateId" defaultValue="" required><option value="">Selecciona candidatura seleccionada</option>{candidates.filter((c) => c.status === 'selected' && !candidateEmployee(c.id)).map((c) => <option key={c.id} value={c.id}>{c.candidateRef} · {vacancies.find((v) => v.id === c.vacancyId)?.jobTitle ?? 'Vacante'}</option>)}</select></Field><Field label="Horas semanales"><input name="weeklyHours" type="number" min="1" max="40" defaultValue="40" required /></Field><Field label="Grupo de cotización didáctico"><select name="contributionGroup" defaultValue="1">{Array.from({ length: 11 }, (_, i) => <option key={i + 1} value={i + 1}>Grupo {i + 1}</option>)}</select></Field><Field label="Salario anual educativo (€)"><input name="annualSalary" type="number" min="0" step="0.01" required /></Field><Field label="Convenio de referencia"><input name="conventionName" minLength={3} maxLength={120} required placeholder="Referencia educativa" /></Field><Field label="Fecha de alta · 2027"><input name="startDate" type="date" min="2027-01-01" max="2027-12-31" required /></Field><Field label="Fecha de fin · opcional"><input name="endDate" type="date" min="2027-01-01" max="2027-12-31" /></Field>{formError && renderError(formError, () => setFormError(''))}{formActions(createEmployee.isPending, 'Crear ficha ficticia', () => { setShowEmployeeForm(false); setFormError(''); })}</form> : selectedEmployee ? <div className="hr-profile-detail"><span className="hr-avatar"><UserRound size={20} /></span><Status value={selectedEmployee.status} /><dl><div><dt>Referencia</dt><dd className="mono">{selectedEmployee.workerRef}</dd></div><div><dt>Puesto</dt><dd>{selectedEmployee.jobTitle}</dd></div><div><dt>Departamento</dt><dd>{selectedEmployee.department}</dd></div><div><dt>Contrato</dt><dd>{contractNames[selectedEmployee.contractType]}</dd></div><div><dt>Jornada semanal</dt><dd>{selectedEmployee.weeklyHours} horas</dd></div><div><dt>Salario anual educativo</dt><dd>{euro(selectedEmployee.annualSalaryCents)}</dd></div><div><dt>Grupo</dt><dd>{selectedEmployee.contributionGroup}</dd></div><div><dt>Convenio</dt><dd>{selectedEmployee.conventionName}</dd></div><div><dt>Cuenta virtual</dt><dd className="mono">{selectedEmployee.virtualBankRef}</dd></div><div><dt>Inicio / fin</dt><dd>{dateLabel(selectedEmployee.startDate)} / {dateLabel(selectedEmployee.endDate)}</dd></div></dl></div> : <Empty title="Aún no hay fichas de personal" detail="Crea una ficha únicamente desde una candidatura seleccionada. Las referencias se generan automáticamente." />}</section><section className="hr-panel"><header className="hr-section-head"><div><span className="hr-overline">CICLO LABORAL</span><h2>Del proceso al expediente</h2><p>Las etapas se completan con referencias generadas por el servidor.</p></div></header><ol className="hr-stage-list">{['Vacante educativa', 'Candidatura sin identidad', 'Valoración por criterios', 'Selección docente', 'Alta ficticia', 'Resumen contractual', 'Jornada y ausencias', 'Cambio de ciclo', 'Informe trazable'].map((stage, index) => <li key={stage}><span>{String(index + 1).padStart(2, '0')}</span><b>{stage}</b></li>)}</ol></section></div>}

          {view === 'selection' && <div className="hr-two-col"><section className="hr-panel"><header className="hr-section-head"><div><span className="hr-overline">PROCESOS ABIERTOS</span><h2>Vacantes y candidaturas</h2><p>La valoración solo utiliza formación, competencias y disponibilidad.</p></div><button type="button" className="hr-button primary" onClick={() => setShowVacancyForm((v) => !v)}><Plus size={14} /> Crear vacante</button></header>
            {showVacancyForm && <form className="hr-inline-form" onSubmit={submitVacancy}><Field label="Puesto"><input name="jobTitle" minLength={2} maxLength={120} required /></Field><Field label="Departamento"><input name="department" minLength={2} maxLength={80} required /></Field><Field label="Contrato"><select name="contractType"><option value="indefinite">Indefinido</option><option value="temporary">Temporal</option><option value="part_time">Tiempo parcial</option><option value="training">Formación</option></select></Field><Field label="Descripción educativa"><textarea name="description" minLength={8} maxLength={600} required /></Field>{formError && renderError(formError, () => setFormError(''))}{formActions(createVacancy.isPending, 'Publicar vacante', () => setShowVacancyForm(false))}</form>}
            <div className="hr-vacancy-list">{vacancies.map((vacancy) => <button className={`hr-vacancy ${selectedVacancy?.id === vacancy.id ? 'chosen' : ''}`} type="button" key={vacancy.id} onClick={() => setSelectedVacancyId(vacancy.id)}><span className="hr-vacancy-icon"><BriefcaseBusiness size={16} /></span><span><b>{vacancy.jobTitle}</b><small>{vacancy.department} · {contractNames[vacancy.contractType]}</small></span><Status value={vacancy.status} /><em>{candidates.filter((item) => item.vacancyId === vacancy.id).length} candidaturas</em></button>)}{!vacancies.length && <Empty title="Sin vacantes todavía" detail="Crea una vacante para abrir un proceso educativo. No se publica fuera de FP360." />}</div>
            {selectedVacancy?.status === 'open' && <button type="button" className="hr-button secondary" onClick={() => { setShowCandidateForm((v) => !v); setFormError(''); }}><Plus size={14} /> Registrar candidatura anónima</button>}
            {showCandidateForm && selectedVacancy && <form className="hr-inline-form hr-score-form" onSubmit={submitCandidate}><input type="hidden" name="vacancyId" value={selectedVacancy.id} /><span className="hr-form-title">Puntuación educativa · 0 a 5</span><Field label="Formación"><input type="number" name="trainingScore" min="0" max="5" required /></Field><Field label="Competencias"><input type="number" name="skillsScore" min="0" max="5" required /></Field><Field label="Disponibilidad"><input type="number" name="availabilityScore" min="0" max="5" required /></Field>{formError && renderError(formError, () => setFormError(''))}{formActions(createCandidate.isPending, 'Guardar candidatura', () => setShowCandidateForm(false))}</form>}
          </section><section className="hr-panel"><header className="hr-section-head"><div><span className="hr-overline">REFERENCIAS CAND-</span><h2>Evaluación anónima</h2><p>Sin nombre, DNI/NIE, contacto ni notas libres.</p></div></header><div className="hr-candidate-list">{candidates.filter((c) => !selectedVacancy || c.vacancyId === selectedVacancy.id).map((c) => <article className="hr-candidate" key={c.id}><div className="hr-candidate-head"><span className="hr-avatar candidate">C</span><div><b>{c.candidateRef}</b><small>{vacancies.find((v) => v.id === c.vacancyId)?.jobTitle ?? 'Vacante'}</small></div><Status value={c.status} /></div><div className="hr-score-bars">{[['Formación', c.trainingScore], ['Competencias', c.skillsScore], ['Disponibilidad', c.availabilityScore]].map(([label, value]) => <div key={label as string}><span>{label}</span><b>{value}/5</b><i><em style={{ transform: `scaleX(${Number(value) / 5})` }} /></i></div>)}</div>{canReview && c.status === 'received' && <div className="hr-actions"><button type="button" onClick={() => candidateDecision(c.id, 'select')} disabled={busyId === c.id}><Check size={13} /> Seleccionar</button><button type="button" onClick={() => candidateDecision(c.id, 'reject')} disabled={busyId === c.id}>Descartar</button></div>}{c.status === 'selected' && !candidateEmployee(c.id) && <button className="hr-button secondary" type="button" onClick={() => { setView('profile'); setShowEmployeeForm(true); }}>Continuar con alta <ArrowRight size={13} /></button>}</article>)}{!candidates.length && <Empty title="Proceso aún vacío" detail="Las candidaturas se registran sin identificar a personas." />}</div></section></div>}

            {view === 'contracts' && <section className="hr-panel"><header className="hr-section-head"><div><span className="hr-overline">RESÚMENES DE APRENDIZAJE</span><h2>Contratos</h2><p>Sin plantillas oficiales, firmas ni validez legal. Revisiones cerradas no se pueden modificar.</p></div><div className="hr-header-actions"><button type="button" className="hr-button secondary" onClick={() => exportCsv('contracts')} disabled={!contracts.length}><Download size={13} /> CSV</button><button type="button" className="hr-button primary" onClick={() => { setShowContractForm((v) => !v); setFormError(''); }}><Plus size={14} /> Nuevo resumen</button></div></header>{showContractForm && <form className="hr-inline-form hr-form-grid" onSubmit={submitContract}><Field label="Expediente activo o pendiente">{employeeSelect('employeeId', (e) => e.status !== 'inactive')}</Field><Field label="Fecha efectiva · 2027"><input name="effectiveDate" type="date" min="2027-01-01" max="2027-12-31" required /></Field><Field label="Fin · opcional"><input name="endDate" type="date" min="2027-01-01" max="2027-12-31" /></Field><Field label="Tipo de contrato"><select name="contractType">{Object.entries(contractNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="Horas semanales"><input name="weeklyHours" type="number" min="1" max="40" required /></Field><Field label="Salario anual educativo (€)"><input name="annualSalary" type="number" min="0" step="0.01" required /></Field><Field label="Grupo"><select name="contributionGroup">{Array.from({ length: 11 }, (_, i) => <option key={i + 1} value={i + 1}>Grupo {i + 1}</option>)}</select></Field><Field label="Convenio de referencia"><input name="conventionName" minLength={3} maxLength={120} required /></Field>{formError && renderError(formError, () => setFormError(''))}{formActions(createContract.isPending, 'Crear resumen', () => setShowContractForm(false))}</form>}<div className="hr-record-list">{contracts.map((c) => <article className="hr-record" key={c.id}><span className="hr-record-icon"><FileText size={16} /></span><div className="hr-record-main"><div><b>{employees.find((e) => e.id === c.employeeId)?.workerRef ?? 'Expediente'} · versión {c.version}</b><Status value={c.status} /></div><small>{c.documentType === 'initial' ? 'Resumen inicial' : 'Modificación educativa'} · efectivo {dateLabel(c.effectiveDate)}{c.endDate ? ` · fin ${dateLabel(c.endDate)}` : ''}</small><span>{contractNames[c.contractType]} · {c.weeklyHours} h/sem. · {euro(c.annualSalaryCents)} al año · Grupo {c.contributionGroup}</span>{c.reviewAction && <small>Revisión registrada · {c.reviewAction === 'confirm' ? 'confirmado' : 'observado'}</small>}{contractReviewButtons(c)}</div></article>)}{!contracts.length && <Empty title="Sin resúmenes contractuales" detail="Crea un resumen educativo asociado a un expediente activo. No equivale a un contrato oficial." />}</div></section>}

          {view === 'attendance' && <div className="hr-two-col"><section className="hr-panel"><header className="hr-section-head"><div><span className="hr-overline">CALENDARIO LABORAL SIMULADO</span><h2>Jornada y ausencias</h2><p>Tipos admitidos: vacaciones, permiso u otro. No se recogen motivos médicos.</p></div><div className="hr-header-actions"><button type="button" className="hr-button secondary" onClick={() => exportCsv('absences')} disabled={!absences.length}><Download size={13} /> CSV</button><button className="hr-button primary" type="button" onClick={() => { setShowAbsenceForm((v) => !v); setFormError(''); }}><Plus size={14} /> Registrar ausencia</button></div></header>{showAbsenceForm && <form className="hr-inline-form" onSubmit={submitAbsence}><Field label="Expediente">{employeeSelect('employeeId', (e) => e.status === 'active')}</Field><Field label="Tipo de ausencia"><select name="absenceType"><option value="vacation">Vacaciones</option><option value="permission">Permiso</option><option value="other">Otro</option></select></Field><Field label="Desde · 2027"><input name="startDate" type="date" min="2027-01-01" max="2027-12-31" required /></Field><Field label="Hasta · 2027"><input name="endDate" type="date" min="2027-01-01" max="2027-12-31" required /></Field>{formError && renderError(formError, () => setFormError(''))}{formActions(createAbsence.isPending, 'Enviar a revisión', () => setShowAbsenceForm(false))}</form>}<div className="hr-record-list">{absences.map((a) => <article className="hr-record" key={a.id}><span className="hr-record-icon calendar"><CalendarDays size={16} /></span><div className="hr-record-main"><div><b>{a.workerRef}</b><Status value={a.status} /></div><small>{a.absenceType === 'vacation' ? 'Vacaciones' : a.absenceType === 'permission' ? 'Permiso' : 'Otro'} · {dateLabel(a.startDate)} – {dateLabel(a.endDate)}</small>{a.reviewAction && <small>Revisión registrada · {a.reviewAction === 'approve' ? 'aprobada' : 'observada'}</small>}{decisionButtons(a, 'absence')}</div></article>)}{!absences.length && <Empty title="Sin ausencias registradas" detail="Registra únicamente el tipo permitido y las fechas del escenario." />}</div></section><aside className="hr-panel hr-guidance"><span className="hr-overline">PRIVACIDAD POR DISEÑO</span><h3>Lo necesario para aprender, nada más.</h3><p>Este módulo no pregunta ni almacena nombres, identificadores oficiales, contactos, diagnósticos ni cuentas bancarias reales. Las cuentas VB son referencias virtuales.</p><div><Clock3 size={15} />Jornada semanal del expediente</div><div><CalendarDays size={15} />Intervalos limitados al año 2027</div></aside></div>}

          {view === 'lifecycle' && <div className="hr-two-col"><section className="hr-panel"><header className="hr-section-head"><div><span className="hr-overline">MOVIMIENTOS DEL EXPEDIENTE</span><h2>Altas y bajas</h2><p>Las altas comienzan tras la selección; las bajas requieren aprobación docente.</p></div><button className="hr-button primary" type="button" onClick={() => { setShowTerminationForm((v) => !v); setFormError(''); }}><Plus size={14} /> Registrar baja</button></header>{showTerminationForm && <form className="hr-inline-form" onSubmit={submitTermination}><Field label="Expediente activo">{employeeSelect('employeeId', (e) => e.status === 'active')}</Field><Field label="Fecha efectiva · 2027"><input name="effectiveDate" type="date" min="2027-01-01" max="2027-12-31" required /></Field>{formError && renderError(formError, () => setFormError(''))}<p className="hr-form-note"><ShieldAlert size={14} />No hay comunicación a organismos ni entidades financieras.</p>{formActions(createTermination.isPending, 'Enviar baja a revisión', () => setShowTerminationForm(false))}</form>}<div className="hr-record-list">{employees.map((e) => <article className="hr-record" key={e.id}><span className={`hr-record-icon ${e.status === 'active' ? 'calendar' : ''}`}><UserRound size={16} /></span><div className="hr-record-main"><div><b>{e.workerRef} · {e.jobTitle}</b><Status value={e.status} /></div><small>Alta · {dateLabel(e.startDate)}{e.endDate ? ` · fin ${dateLabel(e.endDate)}` : ''} · {e.department}</small></div></article>)}{lifecycle.map((change) => <article className="hr-record" key={change.id}><span className="hr-record-icon exit"><Activity size={16} /></span><div className="hr-record-main"><div><b>{change.workerRef} · Baja educativa</b><Status value={change.status} /></div><small>Efectiva {dateLabel(change.effectiveDate)}</small>{change.reviewAction && <small>Revisión registrada · {change.reviewAction === 'approve' ? 'aprobada' : 'observada'}</small>}{decisionButtons(change, 'termination')}</div></article>)}{!employees.length && !lifecycle.length && <Empty title="Sin movimientos laborales" detail="Las altas y bajas educativas aparecerán vinculadas a referencias de personal." />}</div></section><aside className="hr-panel hr-guidance"><span className="hr-overline">CICLO CERRADO CON TRAZABILIDAD</span><h3>Una baja no es una comunicación.</h3><p>La decisión cambia únicamente el estado dentro del escenario de aprendizaje. No se remiten datos a la Seguridad Social, empleo ni Banco.</p></aside></div>}

            {view === 'reports' && <div className="hr-report-view"><section className="hr-panel"><header className="hr-section-head"><div><span className="hr-overline">DATOS DEL EXPEDIENTE CARGADO</span><h2>Informes de personal</h2><p>Exporta CSV localmente. La descarga incluye referencias y condiciones laborales simuladas, nunca información personal.</p></div><button className="hr-button primary" type="button" onClick={() => exportCsv('employees')} disabled={!employees.length}><Download size={14} /> Exportar plantilla CSV</button></header><div className="hr-report-grid"><article><small>Personal activo</small><b>{employees.filter((e) => e.status === 'active').length}</b><span>Sobre {employees.length} expedientes</span></article><article><small>Horas semanales</small><b>{employees.reduce((sum, e) => sum + e.weeklyHours, 0)}</b><span>Total asignado</span></article><article><small>Coste anual educativo</small><b>{euro(employees.reduce((sum, e) => sum + e.annualSalaryCents, 0))}</b><span>No es cálculo de nómina</span></article><article><small>Contratos con vencimiento</small><b>{data.summary.contractsExpiringSoon}</b><span>Según resumen del servidor</span></article></div><div className="hr-report-actions"><button type="button" onClick={() => { setView('contracts'); }}><FileText size={15} /><span><b>Resúmenes contractuales</b><small>{contracts.length} registros · CSV disponible</small></span><Download size={14} /></button><button type="button" onClick={() => { setView('attendance'); }}><CalendarDays size={15} /><span><b>Jornada y ausencias</b><small>{absences.length} registros · CSV disponible</small></span><Download size={14} /></button><button type="button" onClick={() => { setView('lifecycle'); }}><Activity size={15} /><span><b>Movimientos del ciclo</b><small>{lifecycle.length} bajas registradas</small></span><ArrowRight size={14} /></button></div><div className="hr-header-actions"><button className="hr-button secondary" type="button" onClick={() => exportCsv('contracts')} disabled={!contracts.length}><Download size={13} /> Exportar contratos CSV</button><button className="hr-button secondary" type="button" onClick={() => exportCsv('absences')} disabled={!absences.length}><Download size={13} /> Exportar ausencias CSV</button></div>{!employees.length && <Empty title="Sin datos para informar" detail="Los indicadores se calculan únicamente cuando el servidor devuelve expedientes." />}</section><aside className="hr-panel hr-report-note"><span className="hr-overline">LECTURA RESPONSABLE</span><h3>Una vista de aprendizaje, no una nómina.</h3><p>Los importes no son cálculos retributivos ni previsiones legales. No descargues datos reales de personas; el módulo solo utiliza los registros ficticios de esta empresa.</p><button type="button" onClick={() => setView('staff')}>Volver a plantilla <ArrowRight size={14} /></button></aside></div>}
        </div>
      </>}
    </>}
    <footer className="hr-footer"><ShieldAlert size={14} /><span>RED FP360 · simulación educativa sin validez legal, contratos oficiales ni comunicaciones reales.</span><span>Curso 2027–2028</span></footer>
  </main>;
}

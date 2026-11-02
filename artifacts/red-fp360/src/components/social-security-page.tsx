import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, BadgeCheck, CalendarDays, Check, CircleAlert, Clock3, ExternalLink, FilePlus2,
  History, Landmark, LockKeyhole, Plus, RefreshCw, ShieldAlert, Users, Wallet,
} from 'lucide-react';
import {
  getGetFp360SocialSecurityOverviewQueryKey, useCreateFp360SocialSecurityMovement,
  useCreateFp360SocialSecuritySettlement, useCreateFp360SocialSecurityWorker,
  useGetFp360SocialSecurityOverview, useReviewFp360SocialSecurityMovement,
  useReviewFp360SocialSecuritySettlement,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360Organization, Fp360SocialSecurityMovement,
  Fp360SocialSecuritySettlement, Fp360SocialSecurityWorker,
} from '@workspace/api-client-react';
import './social-security-page.css';

type Props = {
  identity: AuthIdentity;
  organizations?: Fp360Organization[];
  onNotice: (message: string) => void;
};
type View = 'overview' | 'workers' | 'settlements' | 'history';
type Contract = 'indefinite' | 'temporary' | 'part_time' | 'training';
const contractLabels: Record<Contract, string> = {
  indefinite: 'Indefinido', temporary: 'Temporal', part_time: 'Tiempo parcial', training: 'Formación',
};
const movementLabels = { alta: 'Alta', variacion: 'Variación', baja: 'Baja' };
const statusLabels: Record<string, string> = {
  pending: 'Pendiente', active: 'Activo', inactive: 'Inactivo',
  pending_review: 'Pendiente de revisión', approved: 'Aprobado', observed: 'Observado',
  draft: 'Borrador', reviewed: 'Revisado', closed_simulated: 'Cerrado en simulación',
};
const euro = (cents?: number | null) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const operationId = () => crypto.randomUUID();
const centsFromInput = (value: FormDataEntryValue | null) => Math.round(Number(value) * 100);
const isTeachingRole = (role: AuthIdentity['role']) => role === 'teacher' || role === 'administrator';

function Status({ value }: { value: string }) {
  const tone = ['active', 'approved', 'reviewed', 'closed_simulated'].includes(value) ? 'good' :
    ['pending', 'pending_review', 'draft', 'observed'].includes(value) ? 'warn' : 'quiet';
  return <span className={`ss-status ${tone}`}><i />{statusLabels[value] ?? value}</span>;
}

function Metric({ icon: Icon, label, value, note, tone }: { icon: typeof Users; label: string; value: string; note: string; tone: string }) {
  return <article className={`ss-metric ${tone}`}><span className="ss-metric-icon"><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{note}</em></article>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="ss-empty"><span><FilePlus2 size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}

function Skeleton() {
  return <div className="ss-skeleton" role="status" aria-label="Cargando información"><span /><span /><span /><span /></div>;
}

function MoneyFields({ prefix = '', optional = false, includeBase = true }: { prefix?: string; optional?: boolean; includeBase?: boolean }) {
  return <>
    {includeBase && <label>{prefix}Base mensual introducida (EUR)<input name="monthlyContributionBase" type="number" min="0" step="0.01" required={!optional} placeholder={optional ? 'Sin cambio' : '0,00'} /></label>}
    <label>{prefix}Importe empresa introducido (EUR)<input name="employerContribution" type="number" min="0" step="0.01" required={!optional} placeholder={optional ? 'Sin cambio' : '0,00'} /></label>
    <label>{prefix}Importe trabajador introducido (EUR)<input name="workerContribution" type="number" min="0" step="0.01" required={!optional} placeholder={optional ? 'Sin cambio' : '0,00'} /></label>
  </>;
}

export function SocialSecurityPage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const canTeach = isTeachingRole(identity.role);
  const readOnly = identity.role === 'promoter' || identity.role === 'mentor';
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(identity.organizationId ?? '');
  const [view, setView] = useState<View>('overview');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [selectedHrEmployeeId, setSelectedHrEmployeeId] = useState('');
  const [selectedPayrollRunId, setSelectedPayrollRunId] = useState('');
  const [settlementPeriod, setSettlementPeriod] = useState('');
  const organizationId = identity.organizationId ?? selectedOrganizationId;
  const canChooseOrganization = !identity.organizationId && canTeach;
  const queryKey = getGetFp360SocialSecurityOverviewQueryKey({ organizationId });
  const overviewQuery = useGetFp360SocialSecurityOverview({ organizationId }, { query: { enabled: Boolean(organizationId), queryKey } });
  const createWorker = useCreateFp360SocialSecurityWorker();
  const createMovement = useCreateFp360SocialSecurityMovement();
  const reviewMovement = useReviewFp360SocialSecurityMovement();
  const createSettlement = useCreateFp360SocialSecuritySettlement();
  const reviewSettlement = useReviewFp360SocialSecuritySettlement();
  const overview = overviewQuery.data;
  const workers = useMemo(() => overview?.workers ?? [], [overview?.workers]);
  const movements = useMemo(() => overview?.movements ?? [], [overview?.movements]);
  const settlements = useMemo(() => overview?.settlements ?? [], [overview?.settlements]);
  const availableHrEmployees = overview?.availableHrEmployees ?? [];
  const availablePayrollRuns = overview?.availablePayrollRuns ?? [];
  const selectedHrEmployee = availableHrEmployees.find((employee) => employee.id === selectedHrEmployeeId);
  const selectedPayrollRun = availablePayrollRuns.find((run) => run.id === selectedPayrollRunId);
  const events = useMemo(() => [...(overview?.events ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [overview?.events]);
  const invalidate = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const retry = () => invalidate();
  const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

  useEffect(() => {
    if (!identity.organizationId && !selectedOrganizationId && organizations[0]) setSelectedOrganizationId(organizations[0].id);
  }, [identity.organizationId, organizations, selectedOrganizationId]);

  const submitWorker = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId || readOnly) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const hrEmployee = availableHrEmployees.find((employee) => employee.id === selectedHrEmployeeId);
    const group = hrEmployee?.contributionGroup ?? Number(data.get('contributionGroup'));
    const startDate = hrEmployee?.startDate ?? String(data.get('startDate') ?? '');
    const amounts = [
      hrEmployee ? 0 : Number(data.get('monthlyContributionBase')),
      Number(data.get('employerContribution')),
      Number(data.get('workerContribution')),
    ];
    if (!Number.isInteger(group) || group < 1 || group > 11 || !startDate.startsWith('2027') || amounts.some((amount) => !Number.isFinite(amount) || amount < 0)) {
      setFormError('Revisa el grupo (1–11), la fecha de 2027 y los importes didácticos.');
      return;
    }
    setFormError('');
    createWorker.mutate({ data: {
      organizationId, ...(hrEmployee ? { hrEmployeeId: hrEmployee.id } : {}),
      contributionGroup: group,
      contractType: hrEmployee?.contractType ?? String(data.get('contractType')) as Contract,
      startDate,
      monthlyContributionBaseCents: hrEmployee ? Math.round(hrEmployee.annualSalaryCents / 12) : centsFromInput(data.get('monthlyContributionBase')),
      employerContributionCents: centsFromInput(data.get('employerContribution')),
      workerContributionCents: centsFromInput(data.get('workerContribution')), operationId: operationId(),
    } }, {
      onSuccess: () => { invalidate(); form.reset(); setSelectedHrEmployeeId(''); setFormError(''); onNotice('Registro ficticio vinculado a Recursos Humanos; las cuotas siguen siendo datos educativos.'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo crear el registro ficticio.')),
    });
  };

  const submitMovement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const workerId = String(data.get('workerId') ?? '');
    const operationType = String(data.get('operationType')) as keyof typeof movementLabels;
    const effectiveDate = String(data.get('effectiveDate') ?? '');
    if (!workerId || !movementLabels[operationType] || !effectiveDate.startsWith('2027')) {
      setFormError('Selecciona un registro, un tipo de movimiento y una fecha de 2027.');
      return;
    }
    const payload: Record<string, string | number> = { operationType, effectiveDate, operationId: operationId() };
    const optionalGroup = String(data.get('contributionGroup') ?? '');
    const optionalContract = String(data.get('contractType') ?? '');
    if (optionalGroup) payload.contributionGroup = Number(optionalGroup);
    if (optionalContract) payload.contractType = optionalContract;
    (['monthlyContributionBase', 'employerContribution', 'workerContribution'] as const).forEach((key) => {
      const raw = String(data.get(key) ?? '');
      if (raw !== '') payload[`${key}Cents`] = centsFromInput(raw);
    });
    setFormError('');
    createMovement.mutate({ workerId, data: payload as never }, {
      onSuccess: () => { invalidate(); form.reset(); setFormError(''); onNotice('Movimiento enviado a revisión docente.'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo crear el movimiento.')),
    });
  };

  const reviewMovementAction = (movement: Fp360SocialSecurityMovement, action: 'approve' | 'observe') => {
    const label = action === 'approve' ? 'aprobar' : 'observar';
    if (!window.confirm(`¿Confirmas ${label} el movimiento ${movement.workerRef} · ${movementLabels[movement.operationType]}?`)) return;
    setBusyId(movement.id); setActionError('');
    reviewMovement.mutate({ movementId: movement.id, data: { action, operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setBusyId(''); onNotice(action === 'approve' ? 'Movimiento aprobado en la simulación.' : 'Observación registrada para el movimiento.'); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo revisar el movimiento.')); },
    });
  };

  const submitSettlement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId || readOnly) return;
    const form = event.currentTarget;
    const periodKey = settlementPeriod;
    if (!/^2027-(0[1-9]|1[0-2])$/.test(periodKey)) { setFormError('Elige un mes del escenario 2027.'); return; }
    setFormError('');
    createSettlement.mutate({ data: { organizationId, periodKey, ...(selectedPayrollRunId ? { payrollRunId: selectedPayrollRunId } : {}), operationId: operationId() } }, {
      onSuccess: () => { invalidate(); form.reset(); setSelectedPayrollRunId(''); setSettlementPeriod(''); setFormError(''); onNotice(selectedPayrollRunId ? 'Nómina cerrada importada a un borrador de cotización educativa para su revisión.' : 'Resumen mensual educativo creado con datos introducidos.'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo crear el resumen mensual.')),
    });
  };

  const reviewSettlementAction = (settlement: Fp360SocialSecuritySettlement, action: 'review' | 'close') => {
    const prompt = action === 'close' ? '¿Cerrar este resumen únicamente en la simulación?' : '¿Marcar este resumen educativo como revisado?';
    if (!window.confirm(prompt)) return;
    setBusyId(settlement.id); setActionError('');
    reviewSettlement.mutate({ settlementId: settlement.id, data: { action, operationId: operationId() } }, {
      onSuccess: () => { invalidate(); setBusyId(''); onNotice(action === 'close' ? 'Resumen cerrado en simulación; no equivale a un cierre oficial.' : 'Revisión docente registrada.'); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo actualizar el resumen.')); },
    });
  };

  const tabs: Array<{ id: View; label: string; icon: typeof Users }> = [
    { id: 'overview', label: 'Panel', icon: Landmark },
    { id: 'workers', label: 'Registros y movimientos', icon: Users },
    { id: 'settlements', label: 'Resúmenes mensuales', icon: Wallet },
    { id: 'history', label: 'Trazabilidad', icon: History },
  ];
  const monthly = overview?.summary;
  const yearMonths = Array.from({ length: 12 }, (_, index) => `2027-${String(index + 1).padStart(2, '0')}`);

  return <main className="page-content ss-page">
    <header className="ss-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>AFILIACIÓN · COTIZACIÓN SIMULADAS</span></div>
        <h1>Seguridad Social FP360</h1><p>Registros laborales ficticios, revisión docente y resúmenes mensuales del curso 2027–2028.</p></div>
      <div className="ss-heading-tools">
        {canChooseOrganization && <label>Empresa<select value={organizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)} data-testid="select-social-organization"><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <span className="ss-scenario"><CalendarDays size={14} /> Escenario · 2027</span>
      </div>
    </header>
    <aside className="ss-legal" aria-label="Aviso de simulación">
      <ShieldAlert size={19} /><div><b>SIMULACIÓN EDUCATIVA · SIN VALIDEZ OFICIAL</b><span>No hay conexión con la Seguridad Social, presentación de trámites ni pagos reales. Los importes son introducidos por el usuario; no se calculan cuotas ni porcentajes. No introduzcas datos personales.</span></div>
      <strong>NO OFICIAL</strong>
    </aside>
    {!organizationId ? <section className="ss-unselected"><Landmark size={25} /><span className="ss-eyebrow">ÁMBITO DE TRABAJO</span><h2>Selecciona una empresa</h2><p>La actividad laboral simulada se consulta para una organización cada vez.</p>{canChooseOrganization ? <label>Organización<select value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)}><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label> : <p>Tu perfil no tiene empresa asignada. Solicita al equipo docente que configure el acceso.</p>}</section> : <>
      <div className="ss-topline"><span><i /> Curso 2027–2028 · datos trazables</span><span>{overview?.simulatedDate ? `Fecha del escenario · ${dateLabel(overview.simulatedDate)}` : 'Periodos habilitados: enero–diciembre 2027'}</span></div>
      <nav className="ss-tabs" role="tablist" aria-label="Secciones de Seguridad Social FP360">{tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} key={id} onClick={() => { setView(id); setFormError(''); setActionError(''); }}><Icon size={15} />{label}</button>)}</nav>
      {overviewQuery.isLoading ? <Skeleton /> : overviewQuery.isError ? <div className="ss-error" role="alert"><CircleAlert size={17} /><span>{errorText(overviewQuery.error, 'No se pudo cargar la información laboral.')}</span><button type="button" onClick={retry}><RefreshCw size={13} /> Reintentar</button></div> : overview && <>
        <section className="ss-metrics">
          <Metric icon={Users} label="Registros activos" value={String(monthly?.activeWorkers ?? 0)} note="Referencias ficticias" tone="teal" />
          <Metric icon={Clock3} label="Movimientos pendientes" value={String(monthly?.pendingMovements ?? 0)} note="A la espera de revisión" tone="amber" />
          <Metric icon={FilePlus2} label="Resúmenes abiertos" value={String(monthly?.openSettlements ?? 0)} note="Borradores educativos" tone="blue" />
          <Metric icon={Wallet} label="Importes mensuales introducidos" value={euro((monthly?.monthlyEmployerContributionCents ?? 0) + (monthly?.monthlyWorkerContributionCents ?? 0))} note="No calculados por el sistema" tone="violet" />
        </section>
        {readOnly && <div className="ss-permission"><LockKeyhole size={15} /> Perfil de consulta: no puedes crear ni revisar operaciones.</div>}
        {actionError && <div className="ss-error inline" role="alert"><CircleAlert size={16} />{actionError}<button type="button" onClick={() => setActionError('')}>Cerrar</button></div>}
        <div className="ss-view page-enter">
          {view === 'overview' && <div className="ss-overview-grid">
            <section className="ss-panel"><header className="ss-section-head"><div><span className="ss-eyebrow">OPERATIVA DEL ESCENARIO</span><h2>Actividad reciente</h2><p>Movimientos en orden de registro, con revisión y trazabilidad docente.</p></div><button className="ss-inline-link" type="button" onClick={() => setView('history')}>Ver historial <History size={14} /></button></header>
              {movements.length ? <div className="ss-movement-list">{[...movements].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map((movement) => <MovementCard key={movement.id} movement={movement} canTeach={canTeach} busy={busyId === movement.id} onReview={reviewMovementAction} />)}</div> : <Empty title="Aún no hay movimientos" detail="Crea un registro ficticio y añade su movimiento para iniciar el ejercicio." />}
            </section>
            <aside className="ss-side-stack"><section className="ss-learning-card"><span className="ss-eyebrow">LÍMITE DEL MÓDULO</span><h3>Practicar el proceso sin simular una presentación oficial.</h3><p>Los resúmenes son educativos y no son RNT ni RLC oficiales. Importes aportados manualmente, sin reglas legales ni cálculos de cotización.</p><button type="button" onClick={() => setView('workers')}>Ir a registros <Plus size={14} /></button><div className="ss-orbit" aria-hidden="true" /></section>
              <section className="ss-panel ss-source-panel"><span className="ss-eyebrow">FUENTES INFORMATIVAS OFICIALES</span><h3>Consulta fuera de FP360</h3><a href="https://www.seg-social.es/wps/portal/wss/internet/InformacionUtil/5300/1889/7019/7872/8061" target="_blank" rel="noreferrer">Sistema RED <ExternalLink size={13} /></a><a href="https://www.seg-social.es/wps/portal/wss/internet/InformacionUtil/5300/1889/7019/39263/7020" target="_blank" rel="noreferrer">Información sobre cotización <ExternalLink size={13} /></a></section>
            </aside>
          </div>}
          {view === 'workers' && <div className="ss-work-grid">
            <section className="ss-panel"><header className="ss-section-head"><div><span className="ss-eyebrow">REGISTROS FICTICIOS</span><h2>Crear registro laboral</h2><p>El servidor asignará automáticamente una referencia FPSS. No uses nombres ni identificadores personales.</p></div></header>
              <form className="ss-form" onSubmit={submitWorker}>
                <label>Vincular desde Recursos Humanos<select value={selectedHrEmployeeId} onChange={(event) => setSelectedHrEmployeeId(event.target.value)}><option value="">Registro manual sin vínculo</option>{availableHrEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.workerRef} · grupo {employee.contributionGroup}</option>)}</select></label>
                {selectedHrEmployee ? <>
                  <p className="ss-form-note">Se tomarán del expediente laboral la referencia, el grupo, el contrato, la fecha y la base mensual educativa. Las cuotas siguen siendo importes didácticos manuales.</p>
                  <input type="hidden" name="contributionGroup" value={selectedHrEmployee.contributionGroup} />
                  <input type="hidden" name="contractType" value={selectedHrEmployee.contractType} />
                  <input type="hidden" name="startDate" value={selectedHrEmployee.startDate} />
                  <MoneyFields includeBase={false} />
                </> : <>
                  <label>Grupo de cotización<select name="contributionGroup" defaultValue="1" required>{Array.from({ length: 11 }, (_, i) => <option key={i + 1} value={i + 1}>Grupo {i + 1}</option>)}</select></label>
                  <label>Tipo de contrato<select name="contractType" defaultValue="indefinite" required>{Object.entries(contractLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <label>Fecha de inicio<input name="startDate" type="date" min="2027-01-01" max="2027-12-31" required /></label>
                  <MoneyFields />
                </>}
                {formError && <p className="ss-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}
                <p className="ss-form-note"><ShieldAlert size={14} />Importes de uso didáctico introducidos manualmente. El sistema no calcula tipos, cuotas ni porcentajes.</p>
                <button className="ss-button primary" type="submit" disabled={readOnly || createWorker.isPending}><Plus size={15} />{createWorker.isPending ? 'Creando registro…' : selectedHrEmployee ? 'Vincular persona de RR. HH.' : 'Crear registro ficticio'}</button>
              </form>
            </section>
            <section className="ss-panel"><header className="ss-section-head"><div><span className="ss-eyebrow">PERSONAS SIMULADAS · SIN DATOS PERSONALES</span><h2>Registros laborales</h2><p>Identificados únicamente por la referencia generada por el servidor.</p></div><span className="ss-count">{workers.length} registros</span></header>
              {workers.length ? <div className="ss-worker-list">{workers.map((worker) => <WorkerCard key={worker.id} worker={worker} />)}</div> : <Empty title="Sin registros laborales" detail="El formulario permite crear referencias ficticias sin almacenar nombres, NAF/NSS o documentación personal." />}
              <div className="ss-divider" />
              <header className="ss-section-head"><div><span className="ss-eyebrow">CAMBIOS DEL REGISTRO</span><h2>Nuevo movimiento</h2><p>Las altas, variaciones y bajas quedan pendientes de revisión.</p></div></header>
              <form className="ss-form ss-movement-form" onSubmit={submitMovement}>
                <label>Registro ficticio<select name="workerId" required defaultValue=""><option value="">Selecciona una referencia</option>{workers.map((worker) => <option key={worker.id} value={worker.id}>{worker.workerRef}</option>)}</select></label>
                <label>Tipo de movimiento<select name="operationType" defaultValue="alta" required>{Object.entries(movementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <label>Fecha efectiva<input name="effectiveDate" type="date" min="2027-01-01" max="2027-12-31" required /></label>
                <label>Grupo (opcional)<select name="contributionGroup" defaultValue=""><option value="">Sin cambio</option>{Array.from({ length: 11 }, (_, i) => <option key={i + 1} value={i + 1}>Grupo {i + 1}</option>)}</select></label>
                <label>Contrato (opcional)<select name="contractType" defaultValue=""><option value="">Sin cambio</option>{Object.entries(contractLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                <MoneyFields prefix="Nuevo " optional />
                {formError && <p className="ss-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}
                <p className="ss-form-note"><ShieldAlert size={14} />Los campos opcionales vacíos no se envían como cambios. Solo fechas del escenario 2027.</p>
                <button className="ss-button primary" type="submit" disabled={readOnly || !workers.length || createMovement.isPending}><Plus size={15} />{createMovement.isPending ? 'Enviando…' : 'Crear movimiento'}</button>
              </form>
            </section>
          </div>}
          {view === 'settlements' && <div className="ss-settlement-grid">
            <section className="ss-panel ss-settlement-create"><header className="ss-section-head"><div><span className="ss-eyebrow">PERIODO LIMITADO AL ESCENARIO</span><h2>Preparar resumen mensual</h2><p>Resumen educativo agregado; no es un documento RNT/RLC oficial.</p></div></header>
              <form className="ss-form" onSubmit={submitSettlement}>
                <label>Nómina cerrada (opcional)<select value={selectedPayrollRunId} onChange={(event) => {
                  const runId = event.target.value;
                  setSelectedPayrollRunId(runId);
                  const run = availablePayrollRuns.find((item) => item.id === runId);
                  if (run) setSettlementPeriod(run.periodKey);
                }}><option value="">Introducir importes desde registros</option>{availablePayrollRuns.map((run) => <option key={run.id} value={run.id}>{run.periodKey} · v{run.version} · {run.employeeCount} personas</option>)}</select></label>
                {selectedPayrollRun && <p className="ss-form-note">Los importes se obtendrán de la nómina cerrada. Deben existir registros activos vinculados para todas sus personas. La importación crea un borrador, no un envío ni un pago.</p>}
                <label>Mes de 2027<select name="periodKey" value={settlementPeriod} disabled={Boolean(selectedPayrollRunId)} onChange={(event) => setSettlementPeriod(event.target.value)} required><option value="">Selecciona un periodo</option>{yearMonths.map((month) => <option key={month} value={month}>{new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))} 2027</option>)}</select></label>
                {formError && <p className="ss-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}
                <p className="ss-form-note"><ShieldAlert size={14} />Importes introducidos por el usuario; no se calculan ni verifican cuotas, porcentajes o prorrateos.</p>
                <button className="ss-button primary" type="submit" disabled={readOnly || createSettlement.isPending}><FilePlus2 size={15} />{createSettlement.isPending ? 'Preparando…' : 'Crear resumen educativo'}</button>
              </form>
            </section>
            <section className="ss-panel"><header className="ss-section-head"><div><span className="ss-eyebrow">HISTORIAL DE PERIODOS</span><h2>Resúmenes mensuales</h2><p>Revisión y cierre exclusivamente en simulación.</p></div><span className="ss-count">{settlements.length} periodos</span></header>
              {settlements.length ? <div className="ss-settlement-list">{[...settlements].sort((a, b) => b.periodKey.localeCompare(a.periodKey)).map((item) => <SettlementCard key={item.id} settlement={item} canTeach={canTeach} busy={busyId === item.id} onAction={reviewSettlementAction} />)}</div> : <Empty title="No hay resúmenes mensuales" detail="Crea un resumen para un mes del escenario 2027. Los periodos 2028 no están habilitados." />}
            </section>
          </div>}
          {view === 'history' && <section className="ss-panel"><header className="ss-section-head"><div><span className="ss-eyebrow">REGISTRO DE ACTIVIDAD</span><h2>Historial y trazabilidad</h2><p>Eventos registrados por el sistema para esta organización.</p></div><span className="ss-count">{events.length} eventos</span></header>
            {events.length ? <div className="ss-event-list">{events.map((event) => <article key={event.id}><span><Activity size={15} /></span><div><b>{event.description}</b><small>{event.actorName} · {dateLabel(event.createdAt)}</small></div><em>{event.eventType}</em></article>)}</div> : <Empty title="Historial aún vacío" detail="Las acciones registradas aparecerán aquí con su actor y fecha." />}
          </section>}
        </div>
      </>}
    </>}
    <footer className="ss-footer"><ShieldAlert size={14} /><span>RED FP360 es una simulación educativa. Sin conexión, presentación ni pagos reales. Sin validez oficial.</span><a href="https://www.seg-social.es/wps/portal/wss/internet/InformacionUtil/5300/1889/7019/7872/8061" target="_blank" rel="noreferrer">Fuentes oficiales informativas <ExternalLink size={12} /></a></footer>
  </main>;
}

function WorkerCard({ worker }: { worker: Fp360SocialSecurityWorker }) {
  return <article className="ss-worker-card"><span className="ss-worker-symbol"><Users size={16} /></span><div className="ss-card-main"><b className="ss-ref">{worker.workerRef}</b><small>Grupo {worker.contributionGroup} · {contractLabels[worker.contractType]} · Alta {dateLabel(worker.startDate)}</small><span className="ss-card-amounts">Base {euro(worker.monthlyContributionBaseCents)} <i /> Empresa {euro(worker.employerContributionCents)} <i /> Trabajador {euro(worker.workerContributionCents)}</span></div><Status value={worker.status} /></article>;
}

function MovementCard({ movement, canTeach, busy, onReview }: { movement: Fp360SocialSecurityMovement; canTeach: boolean; busy: boolean; onReview: (movement: Fp360SocialSecurityMovement, action: 'approve' | 'observe') => void }) {
  return <article className="ss-movement-card"><span className={`ss-movement-mark ${movement.operationType}`}>{movement.operationType === 'baja' ? 'B' : movement.operationType === 'alta' ? 'A' : 'V'}</span><div className="ss-card-main"><div className="ss-card-title"><b>{movement.workerRef}</b><Status value={movement.status} /></div><small>{movementLabels[movement.operationType]} · efectiva {dateLabel(movement.effectiveDate)} · registrada por {movement.createdByName}</small>{movement.reviewedByName && <small>Revisada por {movement.reviewedByName} · {movement.reviewAction === 'approve' ? 'aprobada' : 'observada'}</small>}</div>
    {canTeach && movement.status === 'pending_review' && <div className="ss-card-actions"><button type="button" onClick={() => onReview(movement, 'approve')} disabled={busy}><Check size={13} /> Aprobar</button><button type="button" onClick={() => onReview(movement, 'observe')} disabled={busy}>Observar</button></div>}
  </article>;
}

function SettlementCard({ settlement, canTeach, busy, onAction }: { settlement: Fp360SocialSecuritySettlement; canTeach: boolean; busy: boolean; onAction: (settlement: Fp360SocialSecuritySettlement, action: 'review' | 'close') => void }) {
  return <article className="ss-settlement-card"><div className="ss-settlement-head"><div><small>PERIODO EDUCATIVO</small><b>{settlement.periodKey}</b></div><Status value={settlement.status} /></div>
    <div className="ss-settlement-values"><span>Registros<strong>{settlement.workerCount}</strong></span><span>Base introducida<strong>{euro(settlement.contributionBaseCents)}</strong></span><span>Importe empresa<strong>{euro(settlement.employerContributionCents)}</strong></span><span>Importe trabajador<strong>{euro(settlement.workerContributionCents)}</strong></span><span className="total">Total informado<strong>{euro(settlement.totalContributionCents)}</strong></span></div>
    <div className="ss-settlement-foot"><span>{settlement.sourcePayrollRunId ? 'Importado desde nómina cerrada · ' : ''}Creado por {settlement.createdByName}{settlement.reviewedByName ? ` · Revisado por ${settlement.reviewedByName}` : ''}</span><time>{dateLabel(settlement.updatedAt)}</time></div>
    {canTeach && settlement.status !== 'closed_simulated' && <div className="ss-card-actions">{settlement.status === 'draft' && <button type="button" onClick={() => onAction(settlement, 'review')} disabled={busy}><BadgeCheck size={13} /> Revisar</button>}{settlement.status === 'reviewed' && <button type="button" className="emphasis" onClick={() => onAction(settlement, 'close')} disabled={busy}>Cerrar en simulación</button>}</div>}
  </article>;
}

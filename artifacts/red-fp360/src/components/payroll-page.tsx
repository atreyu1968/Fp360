import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, ArrowDownToLine, ArrowRight, BadgeCheck, CalendarDays, Check, CircleAlert,
  ClipboardList, Clock3, FileCheck2, FileText, LockKeyhole, ReceiptText, RefreshCw,
  Settings2, ShieldAlert, Users, Wallet,
} from 'lucide-react';
import {
  getGetFp360PayrollOverviewQueryKey, useActOnFp360PayrollRun,
  useActivateFp360PayrollPolicy, useCreateFp360PayrollPolicy,
  useCreateFp360PayrollRun, useGetFp360PayrollOverview,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360Organization, Fp360PayrollEmployeeInput, Fp360PayrollOverview,
  Fp360PayrollPolicy, Fp360PayrollRun,
} from '@workspace/api-client-react';
import './payroll-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'overview' | 'runs' | 'receipt' | 'concepts' | 'variables' | 'policy' | 'payment';
type VariableRow = Omit<Fp360PayrollEmployeeInput, 'employeeId'>;
const euro = (cents?: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const opId = () => crypto.randomUUID();
const monthLabel = (period: string) => {
  const [year, month] = period.split('-').map(Number);
  return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
};
const stages = [
  ['draft', 'Cálculo'], ['reviewed', 'Revisión'], ['closed', 'Cierre'],
  ['issued', 'Emisión'], ['payment_prepared', 'Preparar transferencia'], ['paid_simulated', 'Pago simulado'],
] as const;
const statusLabel: Record<string, string> = {
  draft: 'Borrador · calculado', reviewed: 'Revisado', closed: 'Cerrado', issued: 'Emitido',
  payment_prepared: 'Transferencia preparada', paid_simulated: 'Pago simulado',
  active: 'Activo', archived: 'Archivado',
};
const tabs: Array<{ id: View; label: string; icon: typeof Users }> = [
  { id: 'overview', label: 'Resumen', icon: Activity }, { id: 'runs', label: 'Nóminas del mes', icon: ClipboardList },
  { id: 'receipt', label: 'Editor de recibo', icon: ReceiptText }, { id: 'concepts', label: 'Conceptos salariales', icon: Settings2 },
  { id: 'variables', label: 'Incidencias y variables', icon: CalendarDays },
  { id: 'policy', label: 'Seguridad Social y retenciones', icon: FileCheck2 },
  { id: 'payment', label: 'Emisión y pago', icon: Wallet },
];
const canTeachRole = (role: AuthIdentity['role']) => role === 'teacher' || role === 'administrator';

function Status({ value }: { value: string }) {
  const positive = ['active', 'reviewed', 'closed', 'issued', 'paid_simulated'].includes(value);
  return <span className={`pay-status ${positive ? 'good' : value === 'draft' ? 'waiting' : 'quiet'}`}><i />{statusLabel[value] ?? value}</span>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="pay-empty"><span><FileText size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function ErrorNotice({ retry, message }: { retry: () => void; message: string }) {
  return <div className="pay-error" role="alert"><CircleAlert size={17} /><span>{message}</span><button type="button" onClick={retry}>Reintentar</button></div>;
}
function Skeleton() {
  return <div className="pay-skeleton" role="status" aria-label="Cargando nóminas"><span /><span /><span /><span /></div>;
}

export function PayrollPage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const canTeach = canTeachRole(identity.role);
  const [selectedOrg, setSelectedOrg] = useState(identity.organizationId ?? '');
  const organizationId = identity.organizationId ?? selectedOrg;
  const [view, setView] = useState<View>('overview');
  const [period, setPeriod] = useState('2027-10');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [variables, setVariables] = useState<Record<string, VariableRow>>({});
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [policyForm, setPolicyForm] = useState({ worker: '0', employer: '0', withholding: '0' });
  const [policyDraftId, setPolicyDraftId] = useState('');
  const queryKey = getGetFp360PayrollOverviewQueryKey({ organizationId });
  const overviewQuery = useGetFp360PayrollOverview({ organizationId }, { query: { enabled: Boolean(organizationId) } });
  const createPolicy = useCreateFp360PayrollPolicy();
  const activatePolicy = useActivateFp360PayrollPolicy();
  const createRun = useCreateFp360PayrollRun();
  const actRun = useActOnFp360PayrollRun();
  const data = overviewQuery.data as Fp360PayrollOverview | undefined;
  const employees = useMemo(() => data?.employees ?? [], [data?.employees]);
  const policies = useMemo(() => data?.policies ?? [], [data?.policies]);
  const runs = useMemo(() => [...(data?.runs ?? [])].sort((a, b) => b.periodKey.localeCompare(a.periodKey) || b.updatedAt.localeCompare(a.updatedAt)), [data?.runs]);
  const activePolicy = policies.find((item) => item.status === 'active');
  const selectedRun = runs.find((item) => item.id === selectedRunId) ?? runs[0];
  const selectedLine = selectedRun?.receiptLines.find((line) => line.employeeId === selectedEmployeeId) ?? selectedRun?.receiptLines[0];
  const monthBounds = useMemo(() => {
    const [year, month] = period.split('-').map(Number);
    return { start: `${year}-${String(month).padStart(2, '0')}-01`, end: `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}` };
  }, [period]);
  const eligibleEmployees = useMemo(() => employees.filter((employee) =>
    employee.startDate <= monthBounds.end && (!employee.endDate || employee.endDate >= monthBounds.start) &&
    employee.status !== 'inactive' && employee.status !== 'pending'), [employees, monthBounds]);
  const periodRuns = runs.filter((run) => run.periodKey === period);
  const retry = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const invalidate = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

  useEffect(() => {
    if (!identity.organizationId && !selectedOrg && organizations[0]) setSelectedOrg(organizations[0].id);
  }, [identity.organizationId, organizations, selectedOrg]);
  useEffect(() => {
    setVariables((current) => {
      const next: Record<string, VariableRow> = {};
      eligibleEmployees.forEach((employee) => {
        next[employee.id] = current[employee.id] ?? { complementCents: 0, absenceAdjustmentCents: 0, advancesCents: 0, otherDeductionsCents: 0 };
      });
      return next;
    });
  }, [eligibleEmployees]);
  useEffect(() => {
    if (selectedRun && !selectedRunId) setSelectedRunId(selectedRun.id);
  }, [selectedRun, selectedRunId]);

  const savePolicy = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    if (!canTeach) { setFormError('Solo docente o administración puede configurar parámetros didácticos.'); return; }
    const values = [policyForm.worker, policyForm.employer, policyForm.withholding].map(Number);
    if (!organizationId || values.some((v) => !Number.isInteger(v) || v < 0 || v > 10000)) { setFormError('Introduce puntos básicos enteros entre 0 y 10.000.'); return; }
    createPolicy.mutate({ data: { organizationId, workerSocialSecurityBps: values[0], employerSocialSecurityBps: values[1], incomeWithholdingBps: values[2], operationId: opId() } }, {
      onSuccess: (created) => { invalidate(); setPolicyDraftId(created.id); onNotice('Parámetros educativos guardados como borrador.'); },
      onError: (error) => setFormError(errorText(error, 'No se pudieron guardar los parámetros.')),
    });
  };
  const activate = (policy: Fp360PayrollPolicy) => {
    if (!canTeach || !window.confirm('¿Activar estos parámetros didácticos para próximos cálculos? No representan normativa vigente.')) return;
    setBusyId(policy.id); setActionError('');
    activatePolicy.mutate({ policyId: policy.id, data: { operationId: opId() } }, {
      onSuccess: () => { invalidate(); setBusyId(''); onNotice('Parámetros educativos activados.'); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo activar el parámetro.')); },
    });
  };
  const createCalculation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    if (!organizationId || !activePolicy) { setFormError('Activa una configuración educativa antes de calcular.'); return; }
    if (eligibleEmployees.length === 0) { setFormError('No hay empleados ficticios vigentes en este periodo.'); return; }
    const employeeInputs = eligibleEmployees.map((employee) => ({ employeeId: employee.id, ...variables[employee.id] }));
    if (employeeInputs.some((row) => !row || Object.values(row).some((value) => !Number.isInteger(value)))) { setFormError('Revisa todas las variables numéricas.'); return; }
    createRun.mutate({ data: { organizationId, periodKey: period, policyId: activePolicy.id, employeeInputs, operationId: opId() } }, {
      onSuccess: (run) => { invalidate(); setSelectedRunId(run.id); setView('runs'); onNotice('Cálculo educativo creado con resultados devueltos por el API.'); },
      onError: (error) => setFormError(errorText(error, 'No se pudo calcular el periodo.')),
    });
  };
  const act = (run: Fp360PayrollRun, action: 'review' | 'close' | 'issue' | 'prepare_payment' | 'mark_paid_simulated') => {
    const prompts = {
      review: '¿Enviar este cálculo a revisión docente?', close: '¿Cerrar el cálculo revisado en el escenario?',
      issue: '¿Emitir los recibos educativos? No tienen validez oficial.',
      prepare_payment: '¿Preparar una transferencia solo como etapa educativa? No se enviará a ningún banco.',
      mark_paid_simulated: '¿Marcar como pago simulado? Esta acción no mueve dinero.',
    };
    if (action === 'mark_paid_simulated' && !canTeach) return;
    if ((action === 'review' || action === 'close') && !canTeach) return;
    if (!window.confirm(prompts[action])) return;
    setBusyId(run.id); setActionError('');
    actRun.mutate({ runId: run.id, data: { action, operationId: opId() } }, {
      onSuccess: () => { invalidate(); setBusyId(''); onNotice(`Etapa registrada: ${statusLabel[action === 'review' ? 'reviewed' : action === 'close' ? 'closed' : action === 'issue' ? 'issued' : action === 'prepare_payment' ? 'payment_prepared' : 'paid_simulated']}.`); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo actualizar la nómina educativa.')); },
    });
  };
  const exportCsv = (run: Fp360PayrollRun) => {
    const header = ['AVISO: RESUMEN EDUCATIVO SIN VALIDEZ OFICIAL', 'Referencia ficticia', 'Periodo educativo', 'Bruto educativo (céntimos)', 'Cuota didáctica trabajador (céntimos)', 'Retención didáctica (céntimos)', 'Líquido educativo (céntimos)', 'Coste educativo empresa (céntimos)'];
    const rows = run.receiptLines.map((line) => [line.workerRef, run.periodKey, line.grossCents, line.workerContributionCents, line.withholdingCents, line.netCents, line.employerCostCents]);
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `red-fp360-resumen-educativo-${run.periodKey}.csv`; link.click(); URL.revokeObjectURL(url);
    onNotice('CSV educativo exportado; no es una nómina oficial.');
  };
  const variableValue = (employeeId: string, key: keyof VariableRow) => variables[employeeId]?.[key] ?? 0;
  const changeVariable = (employeeId: string, key: keyof VariableRow, value: string) =>
    setVariables((current) => ({ ...current, [employeeId]: { ...(current[employeeId] ?? { complementCents: 0, absenceAdjustmentCents: 0, advancesCents: 0, otherDeductionsCents: 0 }), [key]: Math.round(Number(value || 0) * 100) } }));
  const moneyField = (employeeId: string, key: keyof VariableRow, label: string, allowNegative = false) => <label className="pay-variable-field" key={key}><span>{label}</span><div><input type="number" min={allowNegative ? undefined : 0} step="0.01" value={(variableValue(employeeId, key) / 100).toFixed(2)} onChange={(event) => changeVariable(employeeId, key, event.target.value)} aria-label={`${label} ${employees.find((e) => e.id === employeeId)?.workerRef ?? ''}`} /><b>€</b></div></label>;

  return <main className="page-content payroll-page">
    <header className="pay-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>PERSONAL · APLICACIÓN 11</span></div><span className="pay-kicker">CURSO 2027–2028 · ESCENARIO CANARIAS</span><h1>Nóminas FP360</h1><p>Del cálculo didáctico al pago simulado, cada etapa queda separada y trazable.</p></div>
      <div className="pay-heading-tools">{!identity.organizationId && canTeach && <label>Empresa<select value={organizationId} onChange={(e) => setSelectedOrg(e.target.value)}><option value="">Selecciona empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}<span className="pay-period"><CalendarDays size={14} /> Periodos habilitados · 2027</span></div>
    </header>
    <aside className="pay-legal"><ShieldAlert size={19} /><div><b>SIMULACIÓN EDUCATIVA · SIN VALIDEZ OFICIAL</b><span>Los parámetros son didácticos y configurados por profesorado; no representan normativa actual. Recibos educativos sin validez oficial. No se envían retenciones, cotizaciones, asientos ni pagos a organismos, bancos o módulos externos. El pago simulado no mueve dinero.</span></div><strong>NO OFICIAL</strong></aside>
    {!organizationId ? <section className="pay-unselected"><Users size={25} /><span className="pay-eyebrow">ÁMBITO DE TRABAJO</span><h2>Selecciona una empresa ficticia</h2><p>La actividad de nóminas se consulta para una organización cada vez.</p>{canTeach ? <select aria-label="Empresa ficticia" value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}><option value="">Selecciona empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select> : <p>Tu perfil no tiene empresa asignada. Solicita acceso al equipo docente.</p>}</section> : <>
      <div className="pay-topline"><span><i /> Datos ficticios · referencias FP-EMP únicamente</span><span>Fecha del escenario · {dateLabel(data?.simulatedDate ?? '2027-09-15')}</span></div>
      <nav className="pay-tabs" role="tablist" aria-label="Vistas de Nóminas FP360">{tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} key={id} onClick={() => { setView(id); setFormError(''); setActionError(''); }}><Icon size={15} />{label}</button>)}</nav>
      {overviewQuery.isLoading ? <Skeleton /> : overviewQuery.isError ? <ErrorNotice retry={retry} message={errorText(overviewQuery.error, 'No se ha podido cargar el resumen de nóminas.')} /> : data && <>
        <section className="pay-metrics">
          <article><span className="teal"><Users size={17} /></span><small>Personal activo</small><strong>{data.summary.activeEmployees}</strong><em>Referencias FP-EMP ficticias</em></article>
          <article><span className="blue"><ReceiptText size={17} /></span><small>Bruto del último cálculo</small><strong>{euro(data.summary.latestGrossCents)}</strong><em>{data.summary.latestRunCount} cálculos educativos</em></article>
          <article><span className="violet"><Wallet size={17} /></span><small>Líquido educativo</small><strong>{euro(data.summary.latestNetCents)}</strong><em>No se transfiere dinero</em></article>
          <article><span className="amber"><Clock3 size={17} /></span><small>Revisiones pendientes</small><strong>{data.summary.pendingApprovals}</strong><em>Requieren docente o administración</em></article>
        </section>
        {!canTeach && <div className="pay-permission"><LockKeyhole size={15} /> Perfil de estudiante o consulta: puedes preparar cálculos y recibos educativos; activar parámetros, revisar, cerrar y marcar pago simulado requiere docente o administración.</div>}
        {actionError && <div className="pay-error inline" role="alert"><CircleAlert size={16} />{actionError}<button type="button" onClick={() => setActionError('')}>Cerrar</button></div>}
        <div className="pay-view page-enter">
          {view === 'overview' && <div className="pay-overview-grid">
            <section className="pay-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">ACTIVIDAD DE LA ORGANIZACIÓN</span><h2>Recibos y etapas recientes</h2><p>Un recorrido visible entre cálculo, revisión, cierre, emisión y transferencia simulada.</p></div><button type="button" className="pay-link" onClick={() => setView('runs')}>Ver periodos <ArrowRight size={14} /></button></header>
              {runs.slice(0, 4).length ? <div className="pay-run-list">{runs.slice(0, 4).map((run) => <button type="button" className="pay-run-row" key={run.id} onClick={() => { setSelectedRunId(run.id); setView('receipt'); }}><span className="pay-run-mark"><ReceiptText size={16} /></span><span className="pay-run-copy"><b>{monthLabel(run.periodKey)} · v{run.version}</b><small>{run.employeeCount} referencias · {run.createdByName} · actualizado {dateLabel(run.updatedAt)}</small></span><strong>{euro(run.netTotalCents)}</strong><Status value={run.status} /><ArrowRight size={14} /></button>)}</div> : <Empty title="Sin cálculos todavía" detail="Selecciona un periodo y prepara un cálculo a partir de personal vigente y parámetros educativos." />}
            </section>
            <aside className="pay-side-stack"><section className="pay-learning"><span className="pay-eyebrow">LÍMITE DEL MÓDULO</span><h3>Una práctica de proceso. Ningún trámite real.</h3><p>El backend calcula los importes. Aquí se muestran sus resultados sin aplicar reglas laborales ni porcentajes legales.</p><button type="button" onClick={() => setView('variables')}>Preparar variables <ArrowRight size={14} /></button><div className="pay-orbit" aria-hidden="true" /></section>
              <section className="pay-panel pay-event-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">TRAZABILIDAD</span><h2>Actividad reciente</h2></div></header>{data.events.length ? <div className="pay-event-list">{data.events.slice(0, 5).map((event) => <article key={event.id}><span><Activity size={14} /></span><div><b>{event.description}</b><small>{event.actorName} · {dateLabel(event.createdAt)}</small></div></article>)}</div> : <Empty title="Sin eventos" detail="Las decisiones sobre parámetros y recibos aparecerán aquí." />}</section></aside>
          </div>}
          {view === 'runs' && <section className="pay-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">HISTORIAL · SOLO PERIODOS DE 2027</span><h2>Nóminas del mes</h2><p>Los totales proceden del API y son resúmenes educativos, nunca nóminas oficiales.</p></div><label className="pay-month-select">Periodo<select value={period} onChange={(e) => setPeriod(e.target.value)}>{Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`).map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}</select></label></header>
            {periodRuns.length ? <div className="pay-table-scroll"><table><thead><tr><th>Periodo</th><th>Versión</th><th>Referencias</th><th>Bruto educativo</th><th>Líquido educativo</th><th>Coste empresa</th><th>Estado</th><th /></tr></thead><tbody>{periodRuns.map((run) => <tr key={run.id} className={selectedRun?.id === run.id ? 'selected' : ''}><td><b>{monthLabel(run.periodKey)}</b><small className="pay-subline">{dateLabel(run.updatedAt)}</small></td><td>v{run.version}</td><td>{run.employeeCount}</td><td>{euro(run.grossTotalCents)}</td><td className="pay-net">{euro(run.netTotalCents)}</td><td>{euro(run.employerCostTotalCents)}</td><td><Status value={run.status} /></td><td><button type="button" className="pay-small-button" onClick={() => { setSelectedRunId(run.id); setView('receipt'); }}>Ver recibo</button></td></tr>)}</tbody></table></div> : <Empty title="Este periodo no tiene cálculos" detail="Crea un cálculo desde Incidencias y variables. Solo se admiten meses de 2027." />}
          </section>}
          {view === 'receipt' && <div className="pay-receipt-layout"><section className="pay-panel pay-receipt">
            {selectedRun && selectedLine ? <>
              <div className="pay-receipt-top"><div className="pay-receipt-icon"><ReceiptText size={20} /></div><div><span className="pay-eyebrow">RECIBO EDUCATIVO · SIN VALIDEZ OFICIAL</span><h2>Resumen salarial · {selectedLine.workerRef}</h2><p>{monthLabel(selectedRun.periodKey)} · referencia ficticia FP-EMP</p></div><Status value={selectedRun.status} /></div>
              <label className="pay-line-select">Referencia<select value={selectedLine.employeeId} onChange={(e) => setSelectedEmployeeId(e.target.value)}>{selectedRun.receiptLines.map((line) => <option key={line.employeeId} value={line.employeeId}>{line.workerRef}</option>)}</select></label>
              <div className="pay-receipt-values"><div><span>Base mensual</span><b>{euro(selectedLine.monthlyBaseCents)}</b></div><div><span>Ausencias aprobadas · días</span><b>{selectedLine.absenceDays}</b></div><div><span>Complementos</span><b>{euro(selectedLine.complementCents)}</b></div><div><span>Ajuste manual de ausencia</span><b>{euro(selectedLine.absenceAdjustmentCents)}</b></div><div className="emphasis"><span>Total devengado · bruto</span><b>{euro(selectedLine.grossCents)}</b></div><div><span>Cuota educativa trabajador</span><b>− {euro(selectedLine.workerContributionCents)}</b></div><div><span>Retención didáctica</span><b>− {euro(selectedLine.withholdingCents)}</b></div><div><span>Anticipos y otras deducciones</span><b>− {euro(selectedLine.advancesCents + selectedLine.otherDeductionsCents)}</b></div><div className="net"><span>Líquido educativo</span><b>{euro(selectedLine.netCents)}</b></div><div><span>Coste educativo empresa</span><b>{euro(selectedLine.employerCostCents)}</b></div></div>
              <div className="pay-ref-note"><span>RECIBO {selectedLine.receiptRef}</span><span>Base educativa · {euro(selectedLine.contributionBaseCents)}</span></div>
            </> : <Empty title="Selecciona un cálculo" detail="El editor muestra exclusivamente líneas recibidas del API. Si no hay cálculos, prepara uno en Variables." />}
          </section><aside className="pay-side-stack"><section className="pay-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">FLUJO DE ESTADOS</span><h2>Etapa actual</h2></div></header>{selectedRun ? <><ol className="pay-stage-list">{stages.map(([key, label], index) => { const order = stages.findIndex(([stage]) => stage === selectedRun.status); return <li key={key} className={index < order ? 'done' : index === order ? 'current' : ''}><span>{index < order ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span><b>{label}</b>{index === order && <small>Actual</small>}</li>; })}</ol><button type="button" className="pay-button secondary full" onClick={() => exportCsv(selectedRun)}><ArrowDownToLine size={14} /> Exportar CSV educativo</button></> : <Empty title="No hay recibos" detail="Los recibos educativos aparecerán al calcular un periodo." />}</section>
            <section className="pay-panel pay-caution"><ShieldAlert size={17} /><div><b>Documento de aprendizaje</b><p>No es una nómina oficial, no acredita pagos ni se remite a terceros.</p></div></section></aside></div>}
          {view === 'concepts' && <div className="pay-two-col"><section className="pay-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">ESTRUCTURA DEL RECIBO</span><h2>Conceptos salariales</h2><p>El formulario permite introducir variables; el API realiza el cálculo de importes.</p></div></header><div className="pay-concept-list"><article><span className="concept-index">01</span><div><b>Base mensual educativa</b><small>Importe devuelto por el API a partir del salario anual ficticio.</small></div><strong>Informativa</strong></article><article><span className="concept-index">02</span><div><b>Complementos</b><small>Variable didáctica introducida por el alumno para el periodo.</small></div><strong>Editable</strong></article><article><span className="concept-index">03</span><div><b>Ajuste manual de ausencia</b><small>Importe que introduce el alumno; los días aprobados no inventan un prorrateo.</small></div><strong>Editable</strong></article><article><span className="concept-index">04</span><div><b>Cuota y retención didácticas</b><small>Resultados calculados por el servidor según parámetros docentes.</small></div><strong>Parámetros</strong></article><article><span className="concept-index">05</span><div><b>Anticipos y otras deducciones</b><small>Importes simulados introducidos por fila, sin conectores financieros.</small></div><strong>Editable</strong></article></div></section><aside className="pay-panel pay-formula"><span className="pay-eyebrow">DESGLOSE DE LA PRÁCTICA</span><h3>El servidor calcula. La interfaz explica.</h3><p>Base mensual = redondeo del salario anual / 12. Bruto = base + complemento + ajuste manual. La base educativa es el bruto.</p><div className="formula-rule">Cuota / retención = redondeo(base × puntos básicos / 10.000)</div><div className="formula-rule">Líquido = bruto − cuota trabajador − retención − anticipo − otras deducciones</div><div className="formula-rule">Coste educativo = bruto + cuota empresa</div><small>Fórmulas didácticas. Los parámetros no son porcentajes legales ni vigentes.</small></aside></div>}
          {view === 'variables' && <div className="pay-variable-layout"><section className="pay-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">ENTRADA · UN REGISTRO POR EMPLEADO VIGENTE</span><h2>Incidencias y variables</h2><p>Periodo {monthLabel(period)}. Ausencias aprobadas aportan días; el ajuste monetario lo introduce el alumno.</p></div><label className="pay-month-select">Mes<select value={period} onChange={(e) => setPeriod(e.target.value)}>{Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`).map((key) => <option key={key} value={key}>{monthLabel(key)}</option>)}</select></label></header>
            {!activePolicy && <div className="pay-inline-note"><LockKeyhole size={15} /> Hace falta una configuración activa. Revisa los parámetros educativos antes del cálculo.</div>}
            {eligibleEmployees.length ? <form onSubmit={createCalculation}><div className="pay-variable-table"><div className="pay-variable-head"><span>Referencia · puesto</span><span>Complemento</span><span>Ajuste ausencia</span><span>Anticipo</span><span>Otras deducciones</span></div>{eligibleEmployees.map((employee) => <article className="pay-variable-row" key={employee.id}><div className="pay-employee-ref"><b>{employee.workerRef}</b><small>{employee.jobTitle} · {employee.department}</small><small>Vigencia {dateLabel(employee.startDate)} – {dateLabel(employee.endDate)}</small></div>{moneyField(employee.id, 'complementCents', 'Complemento')}{moneyField(employee.id, 'absenceAdjustmentCents', 'Ajuste ausencias', true)}{moneyField(employee.id, 'advancesCents', 'Anticipo')}{moneyField(employee.id, 'otherDeductionsCents', 'Otras deducciones')}</article>)}</div>
              {formError && <p className="pay-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}<p className="pay-form-note"><ShieldAlert size={14} />Se enviará exactamente una fila por cada referencia vigente; no se solicitan nombres, identificadores, cuentas bancarias ni contactos.</p><button type="submit" className="pay-button primary" disabled={!activePolicy || createRun.isPending}><ReceiptText size={15} />{createRun.isPending ? 'Calculando…' : 'Calcular resumen educativo'}</button>
            </form> : <Empty title="Sin personal vigente en el mes" detail="No existen referencias ficticias con vigencia en este periodo. Elige otro mes de 2027 o revisa Recursos humanos." />}
          </section><aside className="pay-panel pay-variable-aside"><span className="pay-eyebrow">PARÁMETROS ACTIVOS</span><h3>{activePolicy ? `Versión ${activePolicy.version}` : 'Sin configuración activa'}</h3>{activePolicy ? <><div><span>Cuota trabajador · didáctica</span><b>{activePolicy.workerSocialSecurityBps} pb</b></div><div><span>Cuota empresa · didáctica</span><b>{activePolicy.employerSocialSecurityBps} pb</b></div><div><span>Retención · didáctica</span><b>{activePolicy.incomeWithholdingBps} pb</b></div></> : <p>Docencia puede crear y activar parámetros exclusivamente educativos.</p>}<button type="button" className="pay-link" onClick={() => setView('policy')}>Ver parámetros <ArrowRight size={14} /></button></aside></div>}
          {view === 'policy' && <div className="pay-two-col"><section className="pay-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">CONFIGURACIÓN DOCENTE · NO VIGENTE</span><h2>Seguridad Social y retenciones</h2><p>Los puntos básicos son parámetros de aula; no son tasas legales, oficiales ni actuales.</p></div></header><div className="pay-policy-warning"><ShieldAlert size={17} /><div><b>Esta política no representa normativa actual</b><p>Solo se usa para una simulación educativa. No se remiten cotizaciones ni retenciones a agencias, bancos o módulos externos.</p></div></div>
            <form className="pay-policy-form" onSubmit={savePolicy}><label>Cuota trabajador · puntos básicos<input type="number" min="0" max="10000" step="1" value={policyForm.worker} onChange={(e) => setPolicyForm((v) => ({ ...v, worker: e.target.value }))} disabled={!canTeach} required /></label><label>Cuota empresa · puntos básicos<input type="number" min="0" max="10000" step="1" value={policyForm.employer} onChange={(e) => setPolicyForm((v) => ({ ...v, employer: e.target.value }))} disabled={!canTeach} required /></label><label>Retención didáctica · puntos básicos<input type="number" min="0" max="10000" step="1" value={policyForm.withholding} onChange={(e) => setPolicyForm((v) => ({ ...v, withholding: e.target.value }))} disabled={!canTeach} required /></label>
              {formError && <p className="pay-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}{canTeach ? <button className="pay-button primary" type="submit" disabled={createPolicy.isPending}><Settings2 size={15} />{createPolicy.isPending ? 'Guardando…' : 'Crear versión de parámetros'}</button> : <p className="pay-permission"><LockKeyhole size={14} />Solo docente o administración puede crear y activar parámetros.</p>}</form>
            {policyDraftId && <p className="pay-success"><Check size={14} /> Borrador guardado. Actívalo desde el historial de versiones.</p>}
          </section><section className="pay-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">VERSIONADO Y TRAZABILIDAD</span><h2>Parámetros educativos</h2><p>Una nueva configuración no modifica cálculos ya registrados.</p></div><span className="pay-count">{policies.length} versiones</span></header>{policies.length ? <div className="pay-policy-list">{policies.map((policy) => <article key={policy.id}><div className="pay-policy-card-head"><div><small>POLÍTICA DIDÁCTICA · VERSIÓN {policy.version}</small><b>Creada por {policy.createdByName}</b></div><Status value={policy.status} /></div><div className="pay-policy-values"><span>Trabajador <b>{policy.workerSocialSecurityBps} pb</b></span><span>Empresa <b>{policy.employerSocialSecurityBps} pb</b></span><span>Retención <b>{policy.incomeWithholdingBps} pb</b></span></div><small>Creada {dateLabel(policy.createdAt)}{policy.activatedByName ? ` · Activada por ${policy.activatedByName}` : ''}</small>{policy.status === 'draft' && canTeach && <button type="button" className="pay-button secondary" onClick={() => activate(policy)} disabled={busyId === policy.id}><BadgeCheck size={14} />{busyId === policy.id ? 'Activando…' : 'Activar parámetros educativos'}</button>}</article>)}</div> : <Empty title="Sin versiones" detail="No hay parámetros educativos para esta empresa. Crea una versión para iniciar el ejercicio." />}</section></div>}
          {view === 'payment' && <section className="pay-panel"><header className="pay-section-head"><div><span className="pay-eyebrow">EMISIÓN · PREPARACIÓN · MARCADO</span><h2>Emisión y pago</h2><p>Cada etapa requiere su acción. Ninguna genera documentos oficiales o mueve dinero.</p></div></header>
            {runs.length ? <div className="pay-payment-list">{runs.map((run) => <article key={run.id}><div className="pay-payment-main"><span className="pay-run-mark"><FileCheck2 size={17} /></span><div><b>{monthLabel(run.periodKey)} · v{run.version}</b><small>{run.employeeCount} referencias FP-EMP · líquido educativo {euro(run.netTotalCents)}</small></div><Status value={run.status} /></div><ol className="pay-mini-stages">{stages.map(([key, label], index) => <li key={key} className={stages.findIndex(([s]) => s === run.status) >= index ? 'done' : ''}><i />{label}</li>)}</ol><div className="pay-action-row">
              {run.status === 'draft' && <button type="button" onClick={() => act(run, 'review')} disabled={!canTeach || busyId === run.id}><Check size={13} /> Revisar</button>}
              {run.status === 'reviewed' && <button type="button" onClick={() => act(run, 'close')} disabled={!canTeach || busyId === run.id}>Cerrar</button>}
              {run.status === 'closed' && <button type="button" onClick={() => act(run, 'issue')} disabled={busyId === run.id}><FileCheck2 size={13} /> Emitir recibos educativos</button>}
              {run.status === 'issued' && <button type="button" onClick={() => act(run, 'prepare_payment')} disabled={busyId === run.id}>Preparar transferencia educativa</button>}
              {run.status === 'payment_prepared' && <button type="button" onClick={() => act(run, 'mark_paid_simulated')} disabled={!canTeach || busyId === run.id}><Wallet size={13} /> Marcar pago simulado</button>}
              {run.status === 'paid_simulated' && <span className="pay-settled"><Check size={13} /> Finalizado en simulación</span>}
              {['draft', 'reviewed'].includes(run.status) && !canTeach && <small className="pay-lock"><LockKeyhole size={12} /> Revisión y cierre docentes</small>}
              {run.status === 'payment_prepared' && !canTeach && <small className="pay-lock"><LockKeyhole size={12} /> Marcado docente</small>}
              <button type="button" className="pay-text-button" onClick={() => { setSelectedRunId(run.id); setView('receipt'); }}>Ver recibo <ArrowRight size={13} /></button>
            </div></article>)}</div> : <Empty title="Sin emisiones preparadas" detail="Los cálculos aparecerán aquí y pasarán por revisión, cierre, emisión, preparación y pago simulado como fases distintas." />}
          </section>}
        </div>
      </>}
    </>}
    <footer className="pay-footer"><ShieldAlert size={14} /><span>RED FP360 · práctica educativa con referencias FP-EMP ficticias. Parámetros no vigentes. Sin validez oficial ni operaciones externas.</span></footer>
  </main>;
}

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Banknote, BarChart3, CalendarDays, CheckCircle2,
  CircleAlert, Clock3, FileBarChart2, FileCheck2, Landmark, RefreshCw, ShieldAlert,
  Wallet, ArrowRight, LockKeyhole,
} from 'lucide-react';
import {
  getGetFp360BankReconciliationQueryKey,
  getGetFp360AccountingOverviewQueryKey, getListFp360InvoicesQueryKey,
  getListPurchaseInvoicesQueryKey, useGetFp360AccountingOverview,
  useGetFp360BankReconciliation,
  useListFp360Invoices, useListPurchaseInvoices, useRecordFp360Payment,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360AccountingOverview, Fp360BankReconciliation, Fp360Invoice,
  Fp360Organization, PurchaseInvoice,
} from '@workspace/api-client-react';

type View = 'summary' | 'collections' | 'payments' | 'forecast' | 'reconciliation' | 'financing' | 'reports';
type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type ReconciliationRow = {
  statement: Fp360BankReconciliation['statementLines'][number];
  status: 'matched' | 'candidate' | 'ambiguous' | 'unmatched';
  ledger: Fp360BankReconciliation['ledgerLines'][number] | null;
  candidateCount: number;
};
const views: Array<{ id: View; label: string }> = [
  { id: 'summary', label: 'Resumen' },
  { id: 'collections', label: 'Cobros' },
  { id: 'payments', label: 'Pagos a proveedores' },
  { id: 'forecast', label: 'Previsión' },
  { id: 'reconciliation', label: 'Conciliación' },
  { id: 'financing', label: 'Financiación' },
  { id: 'reports', label: 'Informes' },
];
const SIMULATED_DATE = '2027-09-15';
const eur = (cents = 0) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const date = (value?: string | null) => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
};
const ledgerLineKey = (line: Fp360BankReconciliation['ledgerLines'][number]) => `${line.entryId}:${line.lineNumber}`;
const normalizedReference = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function dateDistanceDays(first: string, second: string) {
  return Math.abs(Date.parse(`${first}T00:00:00Z`) - Date.parse(`${second}T00:00:00Z`)) / 86_400_000;
}
function reconcileStatement(data?: Fp360BankReconciliation): ReconciliationRow[] {
  if (!data) return [];
  const matchedLedger = new Set<string>();
  return data.statementLines.map((statement): ReconciliationRow => {
    const amountMatches = data.ledgerLines.filter((line) =>
      !matchedLedger.has(ledgerLineKey(line)) && line.signedAmountCents === statement.signedAmountCents,
    );
    const reference = normalizedReference(statement.reference);
    const referenceMatches = reference.length >= 4
      ? amountMatches.filter((line) => normalizedReference(`${line.sourceReference ?? ''} ${line.concept} ${line.description}`).includes(reference))
      : [];
    if (referenceMatches.length === 1) {
      const ledger = referenceMatches[0];
      matchedLedger.add(ledgerLineKey(ledger));
      return { statement, status: 'matched', ledger, candidateCount: 1 };
    }
    if (referenceMatches.length > 1) {
      return { statement, status: 'ambiguous', ledger: referenceMatches[0], candidateCount: referenceMatches.length };
    }
    const nearby = amountMatches.filter((line) => dateDistanceDays(line.entryDate, statement.date) <= 3)
      .sort((first, second) => dateDistanceDays(first.entryDate, statement.date) - dateDistanceDays(second.entryDate, statement.date));
    if (nearby.length > 0) {
      const closestDays = dateDistanceDays(nearby[0].entryDate, statement.date);
      const closest = nearby.filter((line) => dateDistanceDays(line.entryDate, statement.date) === closestDays);
      return {
        statement,
        status: closest.length === 1 ? 'candidate' : 'ambiguous',
        ledger: closest[0],
        candidateCount: closest.length,
      };
    }
    return { statement, status: 'unmatched', ledger: null, candidateCount: 0 };
  });
}
const isReadOnlyRole = (role: AuthIdentity['role']) => ['promoter', 'mentor'].includes(role);
const operationKey = (invoiceId: string) => `redfp360:invoice-payment:${invoiceId}`;
type StoredPaymentAttempt = { operationId: string; amountCents: number; attempted: boolean };
function loadPaymentAttempt(key: string): StoredPaymentAttempt | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredPaymentAttempt>;
      if (typeof parsed.operationId === 'string') {
        return {
          operationId: parsed.operationId,
          amountCents: typeof parsed.amountCents === 'number' ? parsed.amountCents : 0,
          attempted: parsed.attempted === true,
        };
      }
    } catch { /* Older sessions stored only the operation ID. */ }
    return { operationId: raw, amountCents: 0, attempted: false };
  } catch { return null; }
}
function savePaymentAttempt(key: string, value: StoredPaymentAttempt | null) {
  try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* Session storage is optional; the active form retains its key. */ }
}
function StatusPill({ status }: { status: string }) {
  const label: Record<string, string> = { paid: 'Pagada', partial: 'Parcial', outstanding: 'Pendiente', pending_review: 'En revisión', conformed: 'Conformada', blocked: 'Bloqueada', correction_requested: 'Rectificación', rectified: 'Rectificada' };
  const style = status === 'paid' || status === 'conformed' ? 'good' : status === 'blocked' || status === 'correction_requested' ? 'warn' : 'neutral';
  return <span className={`treasury-status ${style}`} data-testid={`status-treasury-${status}`}><i />{label[status] ?? status}</span>;
}
function StateNotice({ loading, error, retry }: { loading: boolean; error: boolean; retry: () => void }) {
  if (loading) return <div className="treasury-loading" role="status"><span /><span /><span /></div>;
  if (error) return <div className="treasury-error"><CircleAlert size={17} /><span>No se han podido cargar los datos financieros.</span><button type="button" onClick={retry} data-testid="button-treasury-retry">Reintentar</button></div>;
  return null;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="treasury-empty"><span><FileCheck2 size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Metric({ label, value, hint, icon: Icon, tone = '' }: { label: string; value: string; hint: string; icon: typeof Wallet; tone?: string }) {
  return <article className={`treasury-metric ${tone}`} data-testid={`metric-treasury-${label.toLocaleLowerCase().replaceAll(' ', '-')}`}><span className="treasury-metric-icon"><Icon size={17} /></span><small>{label}</small><strong>{value}</strong><em>{hint}</em></article>;
}

export function TreasuryPage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const [view, setView] = useState<View>('summary');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(identity.organizationId ?? organizations[0]?.id ?? '');
  const [search, setSearch] = useState('');
  const [paymentInvoice, setPaymentInvoice] = useState<Fp360Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [operationId, setOperationId] = useState('');
  const [paymentAttempted, setPaymentAttempted] = useState(false);
  const [days, setDays] = useState(30);
  const [reconciliationMonth, setReconciliationMonth] = useState(SIMULATED_DATE.slice(0, 7));
  const [scenarioAmount, setScenarioAmount] = useState('');
  const [scenarioRate, setScenarioRate] = useState('6.2');
  const readOnly = isReadOnlyRole(identity.role);
  const canChooseOrganization = !identity.organizationId && ['teacher', 'administrator'].includes(identity.role);
  const organizationId = identity.organizationId ?? selectedOrganizationId;
  useEffect(() => {
    if (!identity.organizationId && !selectedOrganizationId && organizations[0]) setSelectedOrganizationId(organizations[0].id);
  }, [identity.organizationId, organizations, selectedOrganizationId]);
  const invoiceQuery = useListFp360Invoices({ query: { queryKey: getListFp360InvoicesQueryKey() } });
  const payableQuery = useListPurchaseInvoices({ query: { queryKey: getListPurchaseInvoicesQueryKey() } });
  const overviewQuery = useGetFp360AccountingOverview<Fp360AccountingOverview>(
    { organizationId },
    { query: { enabled: !!organizationId, queryKey: getGetFp360AccountingOverviewQueryKey({ organizationId }) } },
  );
  const selectedMonthEnd = new Date(`${reconciliationMonth}-01T00:00:00.000Z`);
  selectedMonthEnd.setUTCMonth(selectedMonthEnd.getUTCMonth() + 1, 0);
  const monthEnd = selectedMonthEnd.toISOString().slice(0, 10);
  const reconciliationParams = {
    organizationId,
    fromDate: `${reconciliationMonth}-01`,
    toDate: monthEnd > SIMULATED_DATE ? SIMULATED_DATE : monthEnd,
  };
  const reconciliationQuery = useGetFp360BankReconciliation<Fp360BankReconciliation>(
    reconciliationParams,
    { query: { enabled: !!organizationId && view === 'reconciliation', queryKey: getGetFp360BankReconciliationQueryKey(reconciliationParams) } },
  );
  const recordPayment = useRecordFp360Payment();
  const allInvoices = invoiceQuery.data ?? [];
  const invoices = organizationId ? allInvoices.filter((invoice) => invoice.issuerOrganizationId === organizationId) : [];
  const payables = ((payableQuery.data ?? []) as PurchaseInvoice[]).filter((invoice) => invoice.buyerOrganizationId === organizationId);
  const outstanding = invoices.filter((invoice) => invoice.balanceCents > 0);
  const duePayables = payables.filter((invoice) => invoice.status === 'conformed');
  const bankBalance = organizationId
    ? (overviewQuery.data?.balances ?? []).filter((balance) => balance.code.startsWith('572')).reduce((sum, balance) => sum + balance.balanceCents, 0)
    : 0;
  const overdue = outstanding.filter((invoice) => invoice.dueDate && invoice.dueDate < SIMULATED_DATE);
  const totalReceivable = outstanding.reduce((sum, invoice) => sum + invoice.balanceCents, 0);
  const totalPayable = duePayables.reduce((sum, invoice) => sum + invoice.totalCents, 0);
  const postedEntries = (overviewQuery.data?.entries ?? []).filter((entry) => entry.status !== 'draft').length;
  const pendingEntries = (overviewQuery.data?.entries ?? []).filter((entry) => entry.status === 'draft').length;
  const reconciliationRows = useMemo(() => reconcileStatement(reconciliationQuery.data), [reconciliationQuery.data]);
  const matchedLedgerKeys = useMemo(() => new Set(
    reconciliationRows.filter((row) => row.status === 'matched' && row.ledger).map((row) => ledgerLineKey(row.ledger!)),
  ), [reconciliationRows]);
  const unmatchedLedgerLines = useMemo(
    () => (reconciliationQuery.data?.ledgerLines ?? []).filter((line) => !matchedLedgerKeys.has(ledgerLineKey(line))),
    [reconciliationQuery.data, matchedLedgerKeys],
  );
  const statementNetCents = (reconciliationQuery.data?.statementLines ?? []).reduce((sum, line) => sum + line.signedAmountCents, 0);
  const ledgerNetCents = (reconciliationQuery.data?.ledgerLines ?? []).reduce((sum, line) => sum + line.signedAmountCents, 0);
  const exactMatches = reconciliationRows.filter((row) => row.status === 'matched').length;
  const suggestedMatches = reconciliationRows.filter((row) => row.status === 'candidate').length;
  const ambiguousMatches = reconciliationRows.filter((row) => row.status === 'ambiguous').length;
  const needle = search.trim().toLocaleLowerCase('es');
  const filteredInvoices = useMemo(() => outstanding.filter((invoice) => `${invoice.reference} ${invoice.buyerName} ${invoice.status}`.toLocaleLowerCase('es').includes(needle)), [outstanding, needle]);
  const filteredPayables = useMemo(() => payables.filter((invoice) => `${invoice.invoiceReference} ${invoice.supplierName} ${invoice.orderNumber}`.toLocaleLowerCase('es').includes(needle)), [payables, needle]);
  const retry = () => {
    void client.invalidateQueries({ queryKey: getListFp360InvoicesQueryKey() });
    void client.invalidateQueries({ queryKey: getListPurchaseInvoicesQueryKey() });
    if (organizationId) void client.invalidateQueries({ queryKey: getGetFp360AccountingOverviewQueryKey({ organizationId }) });
    if (organizationId) void client.invalidateQueries({ queryKey: getGetFp360BankReconciliationQueryKey(reconciliationParams) });
  };
  const openPayment = (invoice: Fp360Invoice) => {
    setPaymentInvoice(invoice);
    setPaymentError('');
    const key = operationKey(invoice.id);
    const retained = loadPaymentAttempt(key);
    const retainedAmount = retained?.amountCents || invoice.balanceCents;
    const retainedId = retained?.operationId || crypto.randomUUID();
    setPaymentAmount((retainedAmount / 100).toFixed(2));
    setOperationId(retainedId);
    setPaymentAttempted(retained?.attempted ?? false);
    savePaymentAttempt(key, { operationId: retainedId, amountCents: retainedAmount, attempted: retained?.attempted ?? false });
  };
  const closePayment = () => { setPaymentInvoice(null); setPaymentError(''); };
  const updatePaymentAmount = (value: string) => {
    if (paymentAttempted) return;
    setPaymentAmount(value);
    if (!paymentInvoice) return;
    const nextOperationId = crypto.randomUUID();
    const amountCents = Math.round(Number(value.replace(',', '.')) * 100);
    setOperationId(nextOperationId);
    savePaymentAttempt(operationKey(paymentInvoice.id), {
      operationId: nextOperationId,
      amountCents: Number.isFinite(amountCents) ? amountCents : 0,
      attempted: false,
    });
  };
  const submitPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!paymentInvoice || !operationId) return;
    const amountCents = Math.round(Number(paymentAmount.replace(',', '.')) * 100);
    if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > paymentInvoice.balanceCents) {
      setPaymentError('Introduce un importe positivo que no supere el saldo pendiente.');
      return;
    }
    setPaymentAttempted(true);
    savePaymentAttempt(operationKey(paymentInvoice.id), {
      operationId,
      amountCents,
      attempted: true,
    });
    recordPayment.mutate({ id: paymentInvoice.id, data: { amountCents, operationId } }, {
      onSuccess: () => {
        savePaymentAttempt(operationKey(paymentInvoice.id), null);
        setPaymentAttempted(false);
        setOperationId('');
        void client.invalidateQueries({ queryKey: getListFp360InvoicesQueryKey() });
        if (organizationId) void client.invalidateQueries({ queryKey: getGetFp360AccountingOverviewQueryKey({ organizationId }) });
        setPaymentInvoice(null);
        onNotice('Cobro simulado registrado. El saldo se actualizará desde la factura.');
      },
      onError: () => setPaymentError('No se pudo confirmar el cobro. Reintenta con el mismo importe e identificador de operación.'),
    });
  };
  const forecastNet = (start: number, horizon: number) => {
    const limit = new Date(`${SIMULATED_DATE}T00:00:00.000Z`);
    limit.setUTCDate(limit.getUTCDate() + horizon);
    const limitDate = limit.toISOString().slice(0, 10);
    const within = (value?: string | null) => Boolean(value && value.slice(0, 10) >= SIMULATED_DATE && value.slice(0, 10) <= limitDate);
    const incoming = outstanding.filter((invoice) => within(invoice.dueDate)).reduce((sum, invoice) => sum + invoice.balanceCents, 0);
    const outgoing = duePayables.filter((invoice) => within(invoice.dueDate)).reduce((sum, invoice) => sum + invoice.totalCents, 0);
    return { incoming, outgoing, projected: start + incoming - outgoing };
  };
  const forecast = forecastNet(bankBalance, days);
  const scenarioCents = Math.max(0, Math.round(Number(scenarioAmount.replace(',', '.')) * 100) || 0);
  const scenarioCost = Math.round(scenarioCents * (Number(scenarioRate) / 100) * 90 / 365);

  return <main className="page-content treasury-page">
    <div className="page-heading treasury-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>TESORERÍA · LIQUIDEZ</span></div><h1>Tesorería</h1><p>Conecta vencimientos, cobros y saldo contabilizado. Cada decisión se practica, no se liquida.</p></div>
      {canChooseOrganization && <label className="treasury-organization-select">Empresa<select value={organizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)} data-testid="select-treasury-organization"><option value="">Selecciona una empresa</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}</select></label>}
      <span className="treasury-environment"><span /> DATOS SIMULADOS</span>
    </div>
    <div className="treasury-notice"><ShieldAlert size={16} /><span><b>Entorno de aprendizaje.</b> Importes y fechas simulados; sin conexión bancaria ni movimientos de dinero real.</span></div>
    <div className="treasury-tabs" role="tablist" aria-label="Vistas de tesorería" data-testid="tabs-treasury">
      {views.map(({ id, label }) => <button key={id} type="button" className={view === id ? 'active' : ''} role="tab" aria-selected={view === id} onClick={() => setView(id)} data-testid={`tab-treasury-${id}`}>{label}</button>)}
    </div>
    <StateNotice loading={invoiceQuery.isLoading || payableQuery.isLoading || Boolean(organizationId && overviewQuery.isLoading)} error={invoiceQuery.isError || payableQuery.isError || Boolean(organizationId && overviewQuery.isError)} retry={retry} />
    {!invoiceQuery.isLoading && !payableQuery.isLoading && !invoiceQuery.isError && !payableQuery.isError && <>
      <div className="treasury-live-line"><span><i /> Vista de empresa</span><span>Última consulta {new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' }).format(new Date())}</span></div>
      {view === 'summary' && <div className="treasury-view page-enter">
        <section className="treasury-metrics">
          <Metric label="Saldo contabilizado" value={overviewQuery.isLoading ? '…' : organizationId ? eur(bankBalance) : '—'} hint={organizationId ? 'Cuenta 572 · mayor publicado' : 'No hay empresa asignada'} icon={Landmark} tone="accent" />
          <Metric label="Por cobrar" value={eur(totalReceivable)} hint={`${outstanding.length} facturas abiertas`} icon={ArrowDownLeft} />
          <Metric label="Vencido" value={eur(overdue.reduce((sum, invoice) => sum + invoice.balanceCents, 0))} hint={`${overdue.length} documentos fuera de plazo`} icon={Clock3} tone="warning" />
          <Metric label="Facturas proveedor" value={eur(totalPayable)} hint={`${duePayables.length} conformadas o rectificadas`} icon={ArrowUpRight} />
        </section>
        <div className="treasury-dashboard-grid">
          <section className="panel treasury-panel">
            <div className="treasury-section-head"><div><span className="treasury-overline">CICLO DE CAJA</span><h2>Próximos vencimientos</h2><p>Documentos abiertos ordenados por fecha de vencimiento.</p></div><button className="treasury-link-button" onClick={() => setView('forecast')} data-testid="button-open-forecast">Ver previsión <ArrowRight size={14} /></button></div>
            {outstanding.length ? <div className="treasury-due-list">{[...outstanding].sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')).slice(0, 5).map((invoice) => <div className="treasury-due-row" key={invoice.id} data-testid={`row-treasury-due-${invoice.id}`}><span className="treasury-date-block"><b>{invoice.dueDate ? invoice.dueDate.slice(8, 10) : '—'}</b><small>{invoice.dueDate ? date(invoice.dueDate).split(' ')[1] : 'SIN'}</small></span><span className="treasury-row-copy"><b>{invoice.buyerName}</b><small className="mono">{invoice.reference} · Vence {date(invoice.dueDate)}</small></span><strong>{eur(invoice.balanceCents)}</strong><StatusPill status={invoice.status} /></div>)}</div> : <Empty title="Sin cobros pendientes" detail="Las facturas emitidas aparecerán aquí cuando tengan un saldo por cobrar." />}
            <div className="treasury-panel-foot"><span><CalendarDays size={14} /> Saldo calculado desde documentos emitidos</span><button onClick={() => setView('collections')} data-testid="button-view-collections">Abrir cobros <ArrowRight size={13} /></button></div>
          </section>
          <aside className="treasury-side-stack">
            <section className="panel treasury-status-panel"><div className="treasury-section-head compact"><div><span className="treasury-overline">TRAZABILIDAD</span><h2>Estado contable</h2></div><span className="treasury-status-mark"><CheckCircle2 size={17} /></span></div>
              {!organizationId ? <p className="treasury-muted-copy">Selecciona una empresa para consultar el mayor.</p> : overviewQuery.isLoading ? <div className="treasury-inline-skeleton" /> : overviewQuery.isError ? <div className="treasury-small-error">El mayor no está disponible. <button onClick={retry}>Reintentar</button></div> : <div className="treasury-status-lines"><div><span>Asientos contabilizados</span><b data-testid="value-treasury-posted-entries">{postedEntries}</b></div><div><span>Borradores pendientes</span><b>{pendingEntries}</b></div><div><span>Control Debe / Haber</span><b className={overviewQuery.data?.totals.balanced ? 'text-good' : 'text-warning'}>{overviewQuery.data?.totals.balanced ? 'Cuadrado' : 'Revisar'}</b></div></div>}
              <p className="treasury-caption">El saldo bancario procede de las cuentas 572 contabilizadas. No se modifica en previsión.</p>
            </section>
            <section className="treasury-learning-card"><div><span className="treasury-overline">DECISIÓN DIDÁCTICA</span><h3>¿Qué fecha cambia la liquidez?</h3><p>Compara fecha de factura, vencimiento y cobro para anticipar semanas de tensión.</p><button onClick={() => setView('forecast')} data-testid="button-practice-forecast">Explorar previsión <ArrowRight size={14} /></button></div><div className="treasury-learning-mark"><BarChart3 size={24} /></div></section>
          </aside>
        </div>
      </div>}
      {view === 'collections' && <section className="panel treasury-panel page-enter">
        <div className="treasury-section-head"><div><span className="treasury-overline">FACTURAS DE VENTA</span><h2>Cobros pendientes</h2><p>Registra cobros parciales o totales con trazabilidad e idempotencia.</p></div><label className="treasury-search"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Referencia o cliente" aria-label="Buscar factura de cobro" data-testid="input-treasury-collections-search" /></label></div>
        <p className="treasury-inline-note"><ShieldAlert size={14} /> Solo el cobro de cliente está habilitado. El pago a proveedores no está conectado.</p>
        <div className="treasury-table-wrap"><table className="treasury-table"><thead><tr><th>Factura</th><th>Cliente</th><th>Emisión</th><th>Vencimiento</th><th>Importe</th><th>Abonado</th><th>Pendiente</th><th>Estado</th><th /></tr></thead><tbody>
          {filteredInvoices.map((invoice) => <tr key={invoice.id} data-testid={`row-treasury-collection-${invoice.id}`}><td><b className="mono">{invoice.reference}</b><small className="table-subline">{invoice.payments.length} cobros previos</small></td><td>{invoice.buyerName}</td><td>{date(invoice.simulatedDate)}</td><td>{date(invoice.dueDate)}</td><td>{eur(invoice.totalCents)}</td><td>{eur(invoice.paidCents)}</td><td className="treasury-amount-strong">{eur(invoice.balanceCents)}</td><td><StatusPill status={invoice.status} /></td><td><button className="treasury-action" disabled={readOnly || invoice.balanceCents <= 0} onClick={() => openPayment(invoice)} data-testid={`button-record-payment-${invoice.id}`}>{readOnly ? 'Solo lectura' : 'Registrar cobro'}</button></td></tr>)}
          {!filteredInvoices.length && <tr><td colSpan={9}><Empty title={needle ? 'Sin coincidencias' : 'No hay facturas por cobrar'} detail={needle ? 'Prueba con otra referencia o nombre de cliente.' : 'Cuando se emitan facturas con saldo pendiente, estarán disponibles en esta lista.'} /></td></tr>}
        </tbody></table></div>
        <div className="treasury-panel-foot"><span>{filteredInvoices.length} documentos · importe en euros</span><span>Los cobros anteriores conservan su fecha simulada</span></div>
      </section>}
      {view === 'payments' && <section className="panel treasury-panel page-enter">
        <div className="treasury-section-head"><div><span className="treasury-overline">FACTURAS RECIBIDAS</span><h2>Pagos a proveedores</h2><p>Consulta documentos recibidos y su estado de conformidad.</p></div><label className="treasury-search"><span>Buscar</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Proveedor, pedido o factura" aria-label="Buscar factura proveedor" data-testid="input-treasury-payables-search" /></label></div>
        <div className="treasury-pending-banner"><LockKeyhole size={17} /><div><b>Ejecución de pagos pendiente de integración</b><p>La API y el flujo Banco FP360 no están implementados. Esta vista no envía pagos ni modifica saldos.</p></div><span>PENDIENTE</span></div>
        <div className="treasury-table-wrap"><table className="treasury-table"><thead><tr><th>Factura proveedor</th><th>Proveedor</th><th>Pedido</th><th>Fecha factura</th><th>Vencimiento</th><th>Total</th><th>Conformidad</th><th>Acción</th></tr></thead><tbody>
          {filteredPayables.map((invoice) => <tr key={invoice.id} data-testid={`row-treasury-payable-${invoice.id}`}><td><b className="mono">{invoice.invoiceReference}</b></td><td>{invoice.supplierName}</td><td className="mono">{invoice.orderNumber}</td><td>{date(invoice.invoiceDate)}</td><td>{date(invoice.dueDate)}</td><td className="treasury-amount-strong">{eur(invoice.totalCents)}</td><td><StatusPill status={invoice.status} /></td><td><button className="treasury-action disabled-action" type="button" disabled data-testid={`button-payable-pending-${invoice.id}`}>No disponible</button></td></tr>)}
          {!filteredPayables.length && <tr><td colSpan={8}><Empty title={needle ? 'Sin coincidencias' : 'No hay facturas proveedor'} detail="Las facturas recibidas del circuito de Compras aparecerán aquí. No se crean documentos de ejemplo." /></td></tr>}
        </tbody></table></div>
        <div className="treasury-panel-foot"><span>{filteredPayables.length} facturas recibidas</span><span>El listado conserva estado de Compras</span></div>
      </section>}
      {view === 'forecast' && <div className="treasury-view page-enter">
        <section className="treasury-forecast-hero"><div><span className="treasury-overline">SIMULACIÓN LOCAL · NO CONTABILIZA</span><h2>Previsión de liquidez</h2><p>Parte del saldo 572 publicado y aplica vencimientos disponibles dentro del horizonte seleccionado.</p></div><label>Horizonte<select value={days} onChange={(event) => setDays(Number(event.target.value))} data-testid="select-treasury-horizon"><option value={30}>30 días</option><option value={60}>60 días</option><option value={90}>90 días</option></select></label></section>
        <section className="treasury-forecast-card"><div className="treasury-forecast-balance"><small>Saldo inicial contabilizado</small><strong data-testid="value-treasury-forecast-start">{organizationId ? eur(bankBalance) : '—'}</strong><span>Cuenta bancaria · hoy</span></div><div className="treasury-forecast-flow"><div><span><i className="inflow" /> Cobros con vencimiento dentro de {days} días</span><b>{eur(forecast.incoming)}</b></div><div><span><i className="outflow" /> Facturas conformadas con vencimiento</span><b>− {eur(forecast.outgoing)}</b></div><hr /><div className="projected"><span>Saldo proyectado orientativo</span><b data-testid="value-treasury-projected">{eur(forecast.projected)}</b></div></div></section>
        <div className="treasury-disclaimer"><CircleAlert size={16} /><span>Estimación basada solo en documentos consultados. No representa movimientos ejecutados ni un saldo futuro garantizado. Documentos sin vencimiento quedan fuera del cálculo.</span></div>
      </div>}
      {view === 'reconciliation' && <div className="treasury-reconciliation-view page-enter">
        <section className="treasury-forecast-hero">
          <div><span className="treasury-overline">EXTRACTO SINTÉTICO · MAYOR 572</span><h2>Comparación bancaria</h2><p>Compara movimientos y líneas contables de la empresa seleccionada, sin crear asientos ni modificar saldos.</p></div>
          <label>Mes<input type="month" value={reconciliationMonth} max={SIMULATED_DATE.slice(0, 7)} onChange={(event) => { if (event.target.value) setReconciliationMonth(event.target.value); }} data-testid="input-treasury-reconciliation-month" /></label>
        </section>
        {!organizationId && <div className="treasury-disclaimer"><CircleAlert size={16} /><span>Selecciona una empresa para consultar su extracto sintético y las líneas 572 publicadas.</span></div>}
        {organizationId && <StateNotice loading={reconciliationQuery.isLoading} error={reconciliationQuery.isError} retry={() => void reconciliationQuery.refetch()} />}
        {organizationId && !reconciliationQuery.isLoading && !reconciliationQuery.isError && reconciliationQuery.data && <>
          <section className="treasury-recon-metrics">
            <article><small>Movimientos del extracto</small><b>{reconciliationQuery.data.statementLines.length}</b></article>
            <article><small>Líneas contables 572</small><b>{reconciliationQuery.data.ledgerLines.length}</b></article>
            <article><small>Cruces por referencia e importe</small><b className="text-good">{exactMatches}</b></article>
            <article><small>Candidatos por importe y fecha</small><b>{suggestedMatches + ambiguousMatches}</b></article>
          </section>
          <section className="treasury-recon-totals">
            <div><span>Neto extracto</span><b>{eur(statementNetCents)}</b></div>
            <div><span>Neto mayor 572</span><b>{eur(ledgerNetCents)}</b></div>
            <div><span>Diferencia extracto − mayor</span><b className={statementNetCents === ledgerNetCents ? 'text-good' : 'text-warning'}>{eur(statementNetCents - ledgerNetCents)}</b></div>
          </section>
          <div className="treasury-disclaimer"><CircleAlert size={16} /><span>Solo se considera coincidencia automática cuando coinciden el importe, el sentido y la referencia. Los candidatos comparten importe y sentido y están a tres días o menos; requieren revisión y no se dan por conciliados.</span></div>
          <section className="panel treasury-panel treasury-recon-panel">
            <div className="treasury-section-head"><div><span className="treasury-overline">MOVIMIENTOS BANCARIOS</span><h2>Extracto del periodo</h2><p>{date(reconciliationParams.fromDate)} — {date(reconciliationParams.toDate)}</p></div></div>
            <div className="treasury-table-wrap"><table className="treasury-table"><thead><tr><th>Fecha / cuenta</th><th>Referencia / concepto</th><th>Importe</th><th>Resultado</th><th>Línea 572 relacionada</th></tr></thead><tbody>
              {reconciliationRows.map((row) => <tr key={row.statement.id} data-testid={`row-reconciliation-statement-${row.statement.id}`}>
                <td><b>{date(row.statement.date)}</b><small className="table-subline">{row.statement.accountName}</small></td>
                <td><b className="mono">{row.statement.reference}</b><small className="table-subline">{row.statement.description}</small></td>
                <td className="treasury-amount-strong">{eur(row.statement.signedAmountCents)}</td>
                <td><span className={`treasury-status ${row.status === 'matched' ? 'good' : row.status === 'unmatched' || row.status === 'ambiguous' ? 'warn' : ''}`} data-testid={`status-reconciliation-${row.status}`}>{row.status === 'matched' ? 'Cruce por referencia' : row.status === 'candidate' ? 'Candidato · revisar' : row.status === 'ambiguous' ? `Ambiguo · ${row.candidateCount}` : 'Sin cruce'}</span></td>
                <td>{row.ledger ? <><b>{row.ledger.sourceReference ?? row.ledger.concept}</b><small className="table-subline">{date(row.ledger.entryDate)} · {eur(row.ledger.signedAmountCents)} · {row.ledger.accountCode}</small></> : '—'}</td>
              </tr>)}
              {!reconciliationRows.length && <tr><td colSpan={5}><Empty title="No hay movimientos en este periodo" detail="El extracto sintético de esta empresa no contiene movimientos para el mes seleccionado." /></td></tr>}
            </tbody></table></div>
          </section>
          <section className="panel treasury-panel treasury-recon-panel">
            <div className="treasury-section-head"><div><span className="treasury-overline">PARTIDAS CONTABLES</span><h2>Líneas 572 sin cruce confirmado</h2><p>Incluye también los posibles candidatos para que puedas revisarlos.</p></div><span className="treasury-local-tag">{unmatchedLedgerLines.length} líneas</span></div>
            <div className="treasury-table-wrap"><table className="treasury-table"><thead><tr><th>Fecha / asiento</th><th>Referencia / concepto</th><th>Cuenta</th><th>Sentido e importe</th><th>Estado</th></tr></thead><tbody>
              {unmatchedLedgerLines.map((line) => <tr key={ledgerLineKey(line)} data-testid={`row-reconciliation-ledger-${ledgerLineKey(line)}`}>
                <td><b>{date(line.entryDate)}</b><small className="table-subline">{line.entryNumber ? `Asiento ${line.entryNumber}` : 'Sin numerar'}</small></td>
                <td><b>{line.sourceReference ?? line.concept}</b><small className="table-subline">{line.description}</small></td>
                <td>{line.accountCode} · {line.accountName}</td>
                <td className="treasury-amount-strong">{eur(line.signedAmountCents)}</td>
                <td><StatusPill status={line.status} /></td>
              </tr>)}
              {!unmatchedLedgerLines.length && <tr><td colSpan={5}><Empty title="Todas las líneas tienen cruce" detail="No quedan líneas 572 pendientes de revisión en este periodo." /></td></tr>}
            </tbody></table></div>
          </section>
        </>}
      </div>}
      {view === 'financing' && <div className="treasury-view page-enter">
        <section className="treasury-forecast-hero"><div><span className="treasury-overline">COMPARADOR DIDÁCTICO · CÁLCULO LOCAL</span><h2>Coste orientativo de financiación</h2><p>Introduce hipótesis propias para estudiar el efecto del plazo y el tipo anual. No son ofertas bancarias.</p></div><span className="treasury-local-tag">No modifica saldos</span></section>
        <section className="treasury-finance-layout"><div className="panel treasury-panel treasury-finance-form"><label>Principal (€)<input inputMode="decimal" value={scenarioAmount} onChange={(event) => setScenarioAmount(event.target.value)} placeholder="p. ej. 4.500,00" data-testid="input-treasury-finance-amount" /></label><label>Tipo anual hipotético (%)<input type="number" min="0" max="100" step="0.1" value={scenarioRate} onChange={(event) => setScenarioRate(event.target.value)} data-testid="input-treasury-finance-rate" /></label><label>Plazo didáctico<select defaultValue="90" disabled aria-label="Plazo del cálculo"><option value="90">90 días</option></select></label><p>Estimación simple de interés: principal × tipo anual × 90 / 365. Sin comisiones, impuestos ni condiciones comerciales.</p></div><div className="treasury-cost-card"><span className="treasury-overline">COSTE ESTIMADO PARA 90 DÍAS</span><strong data-testid="value-treasury-finance-cost">{eur(scenarioCost)}</strong><div><span>Principal hipotético</span><b>{eur(scenarioCents)}</b></div><div><span>Tipo anual introducido</span><b>{Number(scenarioRate || 0).toLocaleString('es-ES')}%</b></div><div><span>Saldo contabilizado actual</span><b>{organizationId ? eur(bankBalance) : '—'}</b></div><small>El resultado es educativo y no constituye recomendación ni oferta financiera.</small></div></section>
      </div>}
      {view === 'reports' && <section className="panel treasury-panel page-enter">
        <div className="treasury-section-head"><div><span className="treasury-overline">INFORME DE POSICIÓN</span><h2>Resumen de tesorería</h2><p>Lectura del escenario con datos documentales y saldo del mayor.</p></div><button className="treasury-action" onClick={() => window.print()} data-testid="button-print-treasury-report"><FileBarChart2 size={14} /> Imprimir / guardar PDF</button></div>
        <div className="treasury-report-grid"><article><span>Saldo bancario contabilizado</span><b>{organizationId && !overviewQuery.isLoading ? eur(bankBalance) : '—'}</b><small>Cuenta 572 · publicado</small></article><article><span>Saldo de facturas de venta</span><b>{eur(totalReceivable)}</b><small>{outstanding.length} documentos con saldo</small></article><article><span>Facturas proveedor conformadas</span><b>{eur(totalPayable)}</b><small>{duePayables.length} documentos · sin pagos ejecutables</small></article><article><span>Partidas en borrador contable</span><b>{organizationId ? pendingEntries : '—'}</b><small>Requieren revisión en Contabilidad</small></article></div>
        <div className="treasury-report-note"><RefreshCw size={15} /><span>El informe se actualiza al recargar desde las consultas de Tesorería. Previsiones y financiación quedan fuera de los libros.</span></div>
      </section>}
    </>}
    {paymentInvoice && <div className="treasury-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !recordPayment.isPending) closePayment(); }}><section className="treasury-modal" role="dialog" aria-modal="true" aria-labelledby="treasury-payment-title">
      <div className="treasury-modal-head"><div><span className="treasury-overline">COBRO SIMULADO</span><h2 id="treasury-payment-title">Registrar pago de cliente</h2></div><button type="button" onClick={closePayment} aria-label="Cerrar formulario" data-testid="button-close-treasury-payment">×</button></div>
      <div className="treasury-payment-context"><span><small>Factura</small><b className="mono">{paymentInvoice.reference}</b></span><span><small>Cliente</small><b>{paymentInvoice.buyerName}</b></span><span><small>Saldo pendiente</small><b>{eur(paymentInvoice.balanceCents)}</b></span></div>
      <form onSubmit={submitPayment}><label>Importe del cobro (€)<input required autoFocus inputMode="decimal" min="0.01" step="0.01" max={(paymentInvoice.balanceCents / 100).toFixed(2)} value={paymentAmount} onChange={(event) => updatePaymentAmount(event.target.value)} disabled={paymentAttempted || recordPayment.isPending} data-testid="input-treasury-payment-amount" /></label>
        {paymentAttempted && <small className="treasury-retry-lock" data-testid="text-treasury-retry-lock">Se conserva el importe enviado para que un reintento no genere un segundo cobro.</small>}
        <div className="treasury-operation"><span>Identificador seguro de reintento</span><code data-testid="value-treasury-operation-id">{operationId}</code><small>Se conserva en esta sesión hasta completar el cobro. Los reintentos usan el mismo identificador.</small></div>
        {paymentError && <div className="treasury-payment-error" role="alert" data-testid="error-treasury-payment"><CircleAlert size={15} />{paymentError}</div>}
        {readOnly && <div className="treasury-payment-error"><LockKeyhole size={15} />Tu perfil tiene acceso de solo lectura.</div>}
        <div className="treasury-modal-actions"><button type="button" className="treasury-secondary" onClick={closePayment} disabled={recordPayment.isPending}>Cancelar</button><button type="submit" className="treasury-action primary" disabled={readOnly || recordPayment.isPending} data-testid="button-submit-treasury-payment">{recordPayment.isPending ? 'Registrando…' : 'Confirmar cobro simulado'}</button></div>
      </form>
    </section></div>}
  </main>;
}

import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownLeft, ArrowUpRight, Banknote, Building2, CalendarDays, CheckCircle2, ChevronRight,
  CircleAlert, Clock3, CreditCard, FileCheck2, Landmark, Plus, ShieldAlert, Wallet,
} from 'lucide-react';
import {
  getGetFp360BankOverviewQueryKey, getListFp360InvoicesQueryKey,
  getListPurchaseInvoicesQueryKey,
  useActOnFp360BankFinancing, useActOnFp360BankTransfer, useCreateFp360BankAccount,
  useCreateFp360BankEffect, useCreateFp360BankFinancing, useCreateFp360BankSupplierPayment,
  useCreateFp360BankTransfer, useGetFp360BankOverview, useListFp360Invoices,
  useListPurchaseInvoices,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360BankFinancing, Fp360BankOverview,
  Fp360Organization,
} from '@workspace/api-client-react';
import './bank-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'summary' | 'movements' | 'transfers' | 'effects' | 'financing';
type FormKind = 'account' | 'transfer' | 'supplierPayment' | 'effect' | 'financing' | null;
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed);
};
const euro = (cents?: number | null) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format((cents ?? 0) / 100);
const labelMap: Record<string, string> = {
  active: 'Activa', blocked: 'Bloqueada', closed: 'Cerrada', draft: 'Borrador', pending_review: 'En revisión',
  authorized: 'Autorizada', scheduled: 'Programada', executed: 'Ejecutada', rejected: 'Rechazada', cancelled: 'Cancelada',
  presented: 'Presentado', discounted: 'Descontado', settled: 'Liquidado', offered: 'Oferta didáctica',
  loan: 'Préstamo', credit_line: 'Línea de crédito', discount: 'Descuento de efectos',
  paid: 'Pagada', pending: 'Pendiente', overdue: 'Vencida', low: 'Bajo', review: 'Revisión', elevated: 'Elevado',
};
const label = (value?: string | null) => value ? labelMap[value] ?? value.replaceAll('_', ' ') : '—';
const readOnly = (role: AuthIdentity['role']) => ['promoter', 'mentor'].includes(role);
const opId = () => crypto.randomUUID();

function Status({ value }: { value: string }) {
  const tone = ['active', 'executed', 'paid', 'settled'].includes(value) ? 'good' : ['overdue', 'rejected', 'blocked', 'elevated'].includes(value) ? 'warn' : 'neutral';
  return <span className={`bank-status ${tone}`}><i />{label(value)}</span>;
}
function Empty({ title, text }: { title: string; text: string }) {
  return <div className="bank-empty"><span><FileCheck2 size={19} /></span><b>{title}</b><p>{text}</p></div>;
}
function Skeleton() {
  return <div className="bank-skeleton" role="status" aria-label="Cargando datos bancarios"><span /><span /><span /><span /></div>;
}
function ErrorNotice({ retry }: { retry: () => void }) {
  return <div className="bank-error" role="alert"><CircleAlert size={17} /><span>No se pudo cargar la posición del Banco FP360.</span><button type="button" onClick={retry}>Reintentar</button></div>;
}
function AmountMetric({ title, amount, note, kind }: { title: string; amount: number; note: string; kind: string }) {
  const Icon = kind === 'available' ? Wallet : kind === 'reserved' ? Clock3 : kind === 'in' ? ArrowDownLeft : ArrowUpRight;
  return <article className={`bank-metric ${kind}`}><span className="bank-metric-icon"><Icon size={17} /></span><small>{title}</small><strong>{euro(amount)}</strong><em>{note}</em></article>;
}

export function BankPage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const deepLinkParams = new URLSearchParams(window.location.search);
  const deepLinkOrganizationId = deepLinkParams.get('organizationId');
  const deepLinkInstructionId = deepLinkParams.get('supplierPaymentInstruction');
  const hasInstructionDeepLink = deepLinkParams.has('organizationId') || deepLinkParams.has('supplierPaymentInstruction');
  const hasCompleteInstructionDeepLink = Boolean(deepLinkOrganizationId && deepLinkInstructionId);
  const [view, setView] = useState<View>('summary');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    identity.organizationId ?? (hasInstructionDeepLink ? '' : organizations[0]?.id ?? ''),
  );
  const [form, setForm] = useState<FormKind>(null);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  const [deepLinkedInstructionId, setDeepLinkedInstructionId] = useState('');
  const [deepLinkedInvoiceId, setDeepLinkedInvoiceId] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const organizationId = identity.organizationId ?? selectedOrganizationId;
  const canChooseOrganization = !identity.organizationId && ['teacher', 'administrator'].includes(identity.role);
  const locked = readOnly(identity.role);
  useEffect(() => {
    if (hasInstructionDeepLink || identity.organizationId || selectedOrganizationId || !organizations[0]) return;
    setSelectedOrganizationId(organizations[0].id);
  }, [hasInstructionDeepLink, identity.organizationId, organizations, selectedOrganizationId]);

  const queryKey = getGetFp360BankOverviewQueryKey({ organizationId });
  const overviewQuery = useGetFp360BankOverview<Fp360BankOverview>(
    { organizationId },
    { query: { enabled: !!organizationId, queryKey } },
  );
  const invoiceQuery = useListFp360Invoices({ query: { queryKey: getListFp360InvoicesQueryKey() } });
  const purchaseInvoiceQuery = useListPurchaseInvoices({ query: { queryKey: getListPurchaseInvoicesQueryKey() } });
  const linkedInvoice = (purchaseInvoiceQuery.data ?? []).find((invoice) =>
    invoice.buyerOrganizationId === deepLinkOrganizationId
    && invoice.supplierPaymentInstruction?.id === deepLinkInstructionId,
  );
  const canOpenDeepLink = hasCompleteInstructionDeepLink
    && Boolean(linkedInvoice)
    && (identity.organizationId
      ? identity.organizationId === deepLinkOrganizationId
      : canChooseOrganization && organizations.some((organization) => organization.id === deepLinkOrganizationId));
  const createAccount = useCreateFp360BankAccount();
  const createTransfer = useCreateFp360BankTransfer();
  const createSupplierPayment = useCreateFp360BankSupplierPayment();
  const actTransfer = useActOnFp360BankTransfer();
  const createEffect = useCreateFp360BankEffect();
  const createFinancing = useCreateFp360BankFinancing();
  const actFinancing = useActOnFp360BankFinancing();
  const data = overviewQuery.data;
  useEffect(() => {
    if (!canOpenDeepLink || !linkedInvoice || !deepLinkOrganizationId || !deepLinkInstructionId) return;
    setSelectedOrganizationId(deepLinkOrganizationId);
    setView('transfers');
    setSearch('');
    setDeepLinkedInstructionId(deepLinkInstructionId);
    setDeepLinkedInvoiceId(linkedInvoice.id);
  }, [canOpenDeepLink, deepLinkOrganizationId, deepLinkInstructionId, linkedInvoice]);
  const accounts = data?.accounts ?? [];
  const primary = accounts.find((account) => account.isPrimary) ?? accounts[0];
  const invoices = useMemo(() => (invoiceQuery.data ?? []).filter((invoice) => invoice.issuerOrganizationId === organizationId && invoice.balanceCents > 0), [invoiceQuery.data, organizationId]);
  const supplierInvoices = useMemo(
    () => (purchaseInvoiceQuery.data ?? []).filter((invoice) =>
      invoice.buyerOrganizationId === organizationId
      && invoice.status === 'conformed'
      && !(data?.transfers ?? []).some((transfer) => transfer.purchaseInvoiceId === invoice.id)),
    [purchaseInvoiceQuery.data, organizationId, data?.transfers],
  );
  const term = search.trim().toLocaleLowerCase('es');
  const movements = (data?.movements ?? []).filter((item) => `${item.counterpartyName} ${item.description} ${item.reference}`.toLocaleLowerCase('es').includes(term));
  const transfers = (data?.transfers ?? []).filter((item) => {
    if (deepLinkedInstructionId && (
      item.id !== deepLinkedInstructionId || item.purchaseInvoiceId !== deepLinkedInvoiceId
    )) return false;
    const invoice = (purchaseInvoiceQuery.data ?? []).find((candidate) => candidate.id === item.purchaseInvoiceId);
    return `${item.id} ${item.beneficiaryName} ${item.concept} ${invoice?.invoiceReference ?? ''} ${item.status}`.toLocaleLowerCase('es').includes(term);
  });
  const effects = (data?.effects ?? []).filter((item) => `${item.reference} ${item.invoiceReference} ${item.status}`.toLocaleLowerCase('es').includes(term));
  const financing = (data?.financing ?? []).filter((item) => `${item.productType} ${item.status} ${item.effectReference ?? ''}`.toLocaleLowerCase('es').includes(term));
  const invalidate = () => organizationId && void client.invalidateQueries({ queryKey: getGetFp360BankOverviewQueryKey({ organizationId }) });
  const retry = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const openForm = (kind: Exclude<FormKind, null>) => { setFormError(''); setForm(kind); };
  const closeForm = () => { if (formPending) return; setForm(null); setFormError(''); };
  const withMutationError = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

  const submitForm = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId) { setFormError('Selecciona una empresa antes de registrar una operación.'); return; }
    if (locked) { setFormError('Tu perfil tiene acceso de solo lectura.'); return; }
    const fd = new FormData(event.currentTarget);
    const amount = Math.round(Number(String(fd.get('amount') ?? '').replace(',', '.')) * 100);
    if (form !== 'supplierPayment' && (!Number.isInteger(amount) || (form === 'account' ? amount < 0 : amount <= 0))) { setFormError(form === 'account' ? 'Introduce un saldo inicial de 0 € o superior.' : 'Introduce un importe válido superior a 0 €.'); return; }
    setFormError('');
    if (form === 'account') {
      const name = String(fd.get('name') ?? '').trim();
      if (name.length < 2) { setFormError('El nombre de la cuenta debe tener al menos 2 caracteres.'); return; }
      createAccount.mutate({ data: { organizationId, name, initialBalanceCents: amount, operationId: opId() } }, {
        onSuccess: () => { invalidate(); setForm(null); onNotice('Cuenta sintética creada en el escenario educativo.'); },
        onError: (error) => setFormError(withMutationError(error, 'No se pudo crear la cuenta sintética.')),
      });
    } else if (form === 'transfer') {
      const sourceAccountId = String(fd.get('sourceAccountId') ?? '');
      const beneficiaryAccountId = String(fd.get('beneficiaryAccountId') ?? '');
      const concept = String(fd.get('concept') ?? '').trim();
      const scheduledDate = String(fd.get('scheduledDate') ?? '') || null;
      if (!sourceAccountId || !beneficiaryAccountId || sourceAccountId === beneficiaryAccountId || concept.length < 3) { setFormError('Revisa las cuentas seleccionadas y escribe un concepto de al menos 3 caracteres.'); return; }
      const sourceAccount = accounts.find((account) => account.id === sourceAccountId);
      if (sourceAccount && amount > sourceAccount.availableCents) { setFormError('El importe supera la disponibilidad educativa de la cuenta seleccionada.'); return; }
      createTransfer.mutate({ data: { organizationId, sourceAccountId, beneficiaryAccountId, amountCents: amount, concept, scheduledDate, operationId: opId() } }, {
        onSuccess: () => { invalidate(); setForm(null); onNotice('Transferencia educativa registrada. No se ha movido dinero real.'); },
        onError: (error) => setFormError(withMutationError(error, 'No se pudo registrar la transferencia simulada.')),
      });
    } else if (form === 'supplierPayment') {
      const invoiceId = String(fd.get('invoiceId') ?? '');
      if (!invoiceId || !primary || primary.status !== 'active') { setFormError('Selecciona una factura conformada y una cuenta activa.'); return; }
      createSupplierPayment.mutate({ data: { organizationId, sourceAccountId: primary.id, invoiceId, operationId: opId() } }, {
        onSuccess: () => {
          invalidate();
          void client.invalidateQueries({ queryKey: getListPurchaseInvoicesQueryKey() });
          setForm(null);
          onNotice('Instrucción de pago creada y vinculada a la factura. Pendiente de revisión; no se inicia ningún pago real.');
        },
        onError: (error) => setFormError(withMutationError(error, 'No se pudo preparar el pago simulado al proveedor.')),
      });
    } else if (form === 'effect') {
      const invoiceId = String(fd.get('invoiceId') ?? '');
      const maturityDate = String(fd.get('maturityDate') ?? '');
      if (!invoiceId || !maturityDate) { setFormError('Selecciona una factura pendiente y una fecha de vencimiento.'); return; }
      const invoice = invoices.find((item) => item.id === invoiceId);
      if (invoice && amount > invoice.balanceCents) { setFormError('El nominal no puede superar el saldo pendiente de la factura.'); return; }
      createEffect.mutate({ data: { organizationId, invoiceId, nominalCents: amount, maturityDate, operationId: opId() } }, {
        onSuccess: () => { invalidate(); setForm(null); onNotice('Efecto educativo presentado.'); },
        onError: (error) => setFormError(withMutationError(error, 'No se pudo presentar el efecto.')),
      });
    } else if (form === 'financing') {
      const accountId = String(fd.get('accountId') ?? '');
      const productType = String(fd.get('productType') ?? 'loan') as 'loan' | 'credit_line' | 'discount';
      const termMonths = Number(fd.get('termMonths') ?? 0);
      const annualRateBps = Math.round(Number(String(fd.get('rate') ?? '0').replace(',', '.')) * 100);
      const commissionBps = Math.round(Number(String(fd.get('commission') ?? '0').replace(',', '.')) * 100);
      const effectId = String(fd.get('effectId') ?? '') || null;
      if (!accountId || !Number.isFinite(annualRateBps) || !Number.isFinite(commissionBps) || termMonths < 0 || termMonths > 60) { setFormError('Revisa cuenta, plazo y condiciones didácticas.'); return; }
      createFinancing.mutate({ data: { organizationId, accountId, productType, requestedAmountCents: amount, termMonths, annualRateBps, commissionBps, effectId, operationId: opId() } }, {
        onSuccess: () => { invalidate(); setForm(null); onNotice('Solicitud didáctica de financiación registrada.'); },
        onError: (error) => setFormError(withMutationError(error, 'No se pudo registrar la solicitud de financiación.')),
      });
    }
  };

  const transferAction = (id: string, action: 'validate' | 'authorize' | 'execute' | 'reject' | 'cancel') => {
    setActionBusy(id); setActionError('');
    actTransfer.mutate({ id, data: { action, operationId: opId(), ...(action === 'reject' || action === 'cancel' ? { reason: 'Decisión del equipo en el escenario didáctico.' } : {}) } }, {
      onSuccess: () => {
        invalidate();
        void client.invalidateQueries({ queryKey: getListPurchaseInvoicesQueryKey() });
        setActionBusy('');
        onNotice(`Acción de transferencia aplicada: ${label(action)}. Solo en el escenario simulado.`);
      },
      onError: (error) => { setActionBusy(''); setActionError(withMutationError(error, 'No se pudo actualizar la transferencia.')); },
    });
  };
  const financingAction = (item: Fp360BankFinancing, action: 'offer' | 'reject' | 'accept' | 'draw' | 'repay' | 'pay_installment' | 'close') => {
    setActionBusy(item.id); setActionError('');
    const installment = data?.installments.find((entry) => entry.financingId === item.id && (entry.status === 'pending' || entry.status === 'overdue'));
    const amountCents = action === 'offer' ? item.requestedAmountCents : action === 'draw' ? (item.creditLimitCents ?? item.offeredAmountCents ?? item.requestedAmountCents) : action === 'repay' ? item.drawnCents : null;
    actFinancing.mutate({ id: item.id, data: {
      action, operationId: opId(), amountCents,
      annualRateBps: action === 'offer' ? item.annualRateBps : null,
      termMonths: action === 'offer' ? item.termMonths : null,
      installmentId: action === 'pay_installment' ? installment?.id ?? null : null,
      reason: action === 'reject' ? 'Solicitud no aprobada en el escenario didáctico.' : null,
    } }, {
      onSuccess: () => { invalidate(); setActionBusy(''); onNotice(`Acción de financiación aplicada: ${label(action)}. Sin desembolso real.`); },
      onError: (error) => { setActionBusy(''); setActionError(withMutationError(error, 'No se pudo actualizar la financiación.')); },
    });
  };

  const formPending = createAccount.isPending || createTransfer.isPending || createSupplierPayment.isPending || createEffect.isPending || createFinancing.isPending;
  const tabs: Array<{ id: View; title: string }> = [
    { id: 'summary', title: 'Resumen' }, { id: 'movements', title: 'Movimientos' },
    { id: 'transfers', title: 'Transferencias' }, { id: 'effects', title: 'Efectos' }, { id: 'financing', title: 'Financiación' },
  ];

  return <main className="page-content bank-page">
    <header className="bank-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>BANCO · LIQUIDEZ SIMULADA</span></div><h1>Banco FP360</h1><p>Practica la gestión de liquidez, pagos y financiación de tu empresa.</p></div>
      <div className="bank-heading-tools">
        {canChooseOrganization && <label className="bank-org-select">Empresa<select value={organizationId} onChange={(event) => { setDeepLinkedInstructionId(''); setDeepLinkedInvoiceId(''); setSelectedOrganizationId(event.target.value); }} data-testid="select-bank-organization"><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <span className="bank-date"><CalendarDays size={14} /> Escenario · 15 sep 2027</span>
      </div>
    </header>
    <div className="bank-notice"><ShieldAlert size={16} /><span><b>Banco sintético de aprendizaje.</b> Cuentas, referencias e importes son ficticios. No existe conexión bancaria ni se ejecuta dinero real.</span></div>
    {hasInstructionDeepLink && !canOpenDeepLink && <section className="bank-unselected" role="alert"><CircleAlert size={22} /><h2>No se puede abrir esta instrucción</h2><p>El enlace no identifica una factura e instrucción disponibles para tu empresa o red.</p></section>}
    {!hasInstructionDeepLink && !organizationId && <section className="bank-unselected"><Building2 size={22} /><h2>Selecciona una empresa para abrir su banco</h2><p>La posición, las cuentas y las operaciones corresponden a una única organización por consulta.</p>{canChooseOrganization ? <label>Empresa<select value={selectedOrganizationId} onChange={(event) => setSelectedOrganizationId(event.target.value)}><option value="">Selecciona una empresa</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label> : <p>Tu perfil no tiene una empresa asignada. Solicita al equipo docente que configure el acceso.</p>}</section>}
    {organizationId && (!hasInstructionDeepLink || canOpenDeepLink) && <>
      <nav className="bank-tabs" aria-label="Vistas de Banco FP360" role="tablist">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={view === tab.id} className={view === tab.id ? 'active' : ''} onClick={() => setView(tab.id)} data-testid={`tab-bank-${tab.id}`}>{tab.title}</button>)}</nav>
      <div className="bank-topline"><span><i /> Vista de empresa · datos sintéticos</span><span>Fecha simulada fija · 15/09/2027</span></div>
      {overviewQuery.isLoading ? <Skeleton /> : overviewQuery.isError ? <ErrorNotice retry={retry} /> : data && <>
        <section className="bank-metrics">
          <AmountMetric title="Saldo total sintético" amount={data.summary.accountBalanceCents} note={`${accounts.length} cuentas registradas`} kind="balance" />
          <AmountMetric title="Disponible" amount={data.summary.availableCents} note="Tras reservas didácticas" kind="available" />
          <AmountMetric title="Importe reservado" amount={data.summary.reservedCents} note={`${data.summary.pendingTransferCount} transferencias pendientes`} kind="reserved" />
          <AmountMetric title="Entradas del mes" amount={data.summary.monthlyInflowCents} note={`Salidas ${euro(data.summary.monthlyOutflowCents)}`} kind="in" />
        </section>
        {view === 'summary' && <div className="bank-overview-grid page-enter">
          <section className="bank-panel bank-accounts">
            <div className="bank-panel-head"><div><span className="bank-overline">POSICIÓN POR CUENTA</span><h2>Cuentas sintéticas</h2><p>Saldos disponibles y referencias ficticias del escenario.</p></div><button className="bank-button primary" type="button" disabled={locked} onClick={() => openForm('account')}><Plus size={14} /> Nueva cuenta</button></div>
            {!accounts.length ? <Empty title="Aún no hay cuentas" text="Crea una cuenta sintética para iniciar las prácticas de liquidez." /> : <div className="bank-account-list">{accounts.map((account) => <article key={account.id} className={`bank-account-card ${account.isPrimary ? 'primary-account' : ''}`} data-testid={`card-bank-account-${account.id}`}><div className="bank-account-symbol"><Landmark size={18} /></div><div className="bank-account-main"><div className="bank-account-name"><b>{account.name}</b>{account.isPrimary && <span>PRINCIPAL</span>}</div><code>{account.syntheticReference}</code><small>Referencia sintética · {account.accountType === 'company' ? 'Cuenta de empresa' : 'Compensación educativa'}</small></div><div className="bank-account-sums"><small>Disponible</small><b>{euro(account.availableCents)}</b><span>Saldo {euro(account.balanceCents)} · retenido {euro(account.reservedCents)}</span></div><Status value={account.status} /></article>)}</div>}
            <div className="bank-panel-foot"><span><ShieldAlert size={13} /> Toda referencia e importe es de uso educativo.</span><button type="button" onClick={() => setView('movements')}>Ver movimientos <ChevronRight size={13} /></button></div>
          </section>
          <aside className="bank-side-column">
            <section className="bank-panel bank-risk"><div className="bank-panel-head"><div><span className="bank-overline">INDICADOR DEL ESCENARIO</span><h2>Nivel de riesgo</h2></div><span className={`risk-stamp ${data.summary.riskLevel}`}><ShieldAlert size={17} /></span></div><div className="risk-reading"><b>{label(data.summary.riskLevel)}</b><span>Lectura didáctica de las obligaciones registradas</span></div><div className="risk-bars"><i className={data.summary.riskLevel === 'low' ? 'on' : ''} /><i className={data.summary.riskLevel !== 'low' ? 'on' : ''} /><i className={data.summary.riskLevel === 'elevated' ? 'on' : ''} /></div><div className="bank-risk-lines"><div><span>Solicitudes pendientes</span><b>{data.summary.pendingFinancingCount}</b></div><div><span>Cuotas vencidas</span><b className={data.summary.overdueInstallmentCount ? 'risk-alert' : ''}>{data.summary.overdueInstallmentCount}</b></div></div></section>
            <section className="bank-learning"><span className="bank-overline">SIMULACIÓN CON FECHA FIJA</span><h3>El saldo es una decisión, no solo una cifra.</h3><p>Compara reservas, vencimientos y efectivo disponible antes de registrar una nueva operación.</p><button type="button" onClick={() => setView('financing')}>Revisar financiación <ChevronRight size={14} /></button><div className="learning-mark"><Banknote size={24} /></div></section>
          </aside>
          <section className="bank-panel bank-recent"><div className="bank-panel-head"><div><span className="bank-overline">TRAZABILIDAD · 15 SEP 2027</span><h2>Actividad reciente</h2><p>Eventos registrados en esta empresa simulada.</p></div></div>{data.events.length ? <div className="bank-event-list">{data.events.slice(0, 5).map((event) => <article key={event.id}><span className="event-pin"><CheckCircle2 size={14} /></span><div><b>{event.description}</b><small>{event.actorName} · {dateLabel(event.createdAt)}</small></div><span className="event-type">{label(event.eventType)}</span></article>)}</div> : <Empty title="Sin actividad registrada" text="Los eventos aparecerán aquí cuando existan operaciones en el escenario." />}</section>
        </div>}
        {view === 'movements' && <section className="bank-panel page-enter"><div className="bank-panel-head"><div><span className="bank-overline">REGISTRO SIMULADO</span><h2>Movimientos de cuenta</h2><p>Abonos y cargos reflejados en el entorno educativo.</p></div><SearchBox value={search} onChange={setSearch} label="Buscar movimientos" placeholder="Concepto, referencia o contraparte" /></div><div className="bank-table-scroll"><table className="bank-table"><thead><tr><th>Fecha</th><th>Concepto / referencia</th><th>Contraparte</th><th>Cuenta sintética</th><th>Importe</th><th>Saldo tras apunte</th></tr></thead><tbody>{movements.map((item) => <tr key={item.id}><td>{dateLabel(item.simulatedDate)}</td><td><b>{item.description}</b><small>{item.reference}</small></td><td>{item.counterpartyName}</td><td>{item.accountName}</td><td className={item.direction === 'credit' ? 'positive' : 'negative'}>{item.direction === 'credit' ? '+' : '−'}{euro(item.amountCents)}</td><td>{euro(item.balanceAfterCents)}</td></tr>)}{!movements.length && <tr><td colSpan={6}><Empty title={term ? 'Sin resultados' : 'No hay movimientos'} text="No se han registrado apuntes sintéticos en esta vista." /></td></tr>}</tbody></table></div><div className="bank-panel-foot"><span>{movements.length} movimientos · importes sintéticos</span><span>Ordenados por fecha simulada</span></div></section>}
        {view === 'transfers' && <section className="bank-panel page-enter"><div className="bank-panel-head"><div><span className="bank-overline">ÓRDENES INTERNAS DE APRENDIZAJE</span><h2>Transferencias</h2><p>Altas, revisión y autorización dentro del banco ficticio.</p></div><div className="bank-panel-actions"><SearchBox value={search} onChange={setSearch} label="Buscar transferencias" placeholder="Beneficiario o concepto" /><button className="bank-button secondary" type="button" disabled={locked || !accounts.length || !supplierInvoices.length} onClick={() => openForm('supplierPayment')}><Plus size={14} /> Pagar factura proveedor</button><button className="bank-button primary" type="button" disabled={locked || !accounts.length || !data.beneficiaries.length} onClick={() => openForm('transfer')}><Plus size={14} /> Nueva transferencia</button></div></div>{purchaseInvoiceQuery.isError && <p className="bank-inline-error" role="alert">No se pudieron consultar las facturas de proveedor. <button type="button" onClick={() => void client.invalidateQueries({ queryKey: getListPurchaseInvoicesQueryKey() })}>Reintentar</button></p>}{actionError && <p className="bank-inline-error" role="alert">{actionError}</p>}<div className="bank-table-scroll"><table className="bank-table"><thead><tr><th>Beneficiario</th><th>Cuenta origen / destino</th><th>Concepto</th><th>Fecha simulada</th><th>Solicita</th><th>Importe</th><th>Estado / acción</th></tr></thead><tbody>{transfers.map((item) => { const invoice = (purchaseInvoiceQuery.data ?? []).find((candidate) => candidate.id === item.purchaseInvoiceId); return <tr key={item.id}><td><b>{item.beneficiaryName}</b><small className="mono">{item.beneficiaryReference}</small></td><td><small className="mono">{item.sourceReference}</small></td><td>{item.concept}{invoice && <small>Factura vinculada: {invoice.invoiceReference}</small>}</td><td>{dateLabel(item.scheduledDate)}</td><td>{item.createdByName}</td><td className="amount-cell">{euro(item.amountCents)}</td><td><Status value={item.status} /><TransferControls item={item} disabled={locked || actionBusy === item.id} busy={actionBusy === item.id} onAction={transferAction} /></td></tr>; })}{!transfers.length && <tr><td colSpan={7}><Empty title={term ? 'Sin coincidencias' : 'No hay transferencias'} text="Registra una operación didáctica para verla en este listado." /></td></tr>}</tbody></table></div><div className="bank-panel-foot"><span>{transfers.length} órdenes en el escenario</span><span>No se envían pagos a bancos o redes externas</span></div></section>}
        {view === 'effects' && <section className="bank-panel page-enter"><div className="bank-panel-head"><div><span className="bank-overline">FACTURAS · EFECTOS</span><h2>Efectos comerciales</h2><p>Relaciona una factura pendiente con su vencimiento sintético.</p></div><button className="bank-button primary" type="button" disabled={locked || !invoices.length || invoiceQuery.isLoading} onClick={() => openForm('effect')}><Plus size={14} /> Presentar efecto</button></div>{invoiceQuery.isError && <p className="bank-inline-error">No se han podido consultar las facturas para crear un efecto. <button type="button" onClick={() => void client.invalidateQueries({ queryKey: getListFp360InvoicesQueryKey() })}>Reintentar</button></p>}<div className="bank-table-scroll"><table className="bank-table"><thead><tr><th>Referencia del efecto</th><th>Factura vinculada</th><th>Saldo de factura</th><th>Nominal</th><th>Vencimiento</th><th>Estado</th><th>Presentado por</th></tr></thead><tbody>{effects.map((item) => <tr key={item.id}><td><b className="mono">{item.reference}</b></td><td>{item.invoiceReference}</td><td>{euro(item.invoiceBalanceCents)}</td><td className="amount-cell">{euro(item.nominalCents)}</td><td>{dateLabel(item.maturityDate)}</td><td><Status value={item.status} /></td><td>{item.createdByName}</td></tr>)}{!effects.length && <tr><td colSpan={7}><Empty title="No hay efectos presentados" text="Los efectos aparecerán vinculados a facturas reales del ERP cuando se registren." /></td></tr>}</tbody></table></div><div className="bank-panel-foot"><span>{effects.length} efectos · referencias sintéticas</span><span>Vinculación documental educativa</span></div></section>}
        {view === 'financing' && <div className="bank-finance-view page-enter"><section className="bank-finance-banner"><div><span className="bank-overline">PRODUCTOS DE FINANCIACIÓN DIDÁCTICOS</span><h2>Estudia el coste y el calendario</h2><p>Solicitudes y decisiones modifican únicamente el escenario Banco FP360; no son ofertas financieras.</p></div><button className="bank-button primary" type="button" disabled={locked || !accounts.length} onClick={() => openForm('financing')}><Plus size={14} /> Nueva solicitud</button></section><div className="bank-finance-grid"><section className="bank-panel"><div className="bank-panel-head"><div><span className="bank-overline">CARTERA DEL ESCENARIO</span><h2>Préstamos y líneas</h2></div><SearchBox value={search} onChange={setSearch} label="Buscar financiación" placeholder="Producto, efecto o estado" /></div>{actionError && <p className="bank-inline-error" role="alert">{actionError}</p>}{!financing.length ? <Empty title="Sin financiación registrada" text="Las solicitudes y decisiones del escenario aparecerán aquí." /> : <div className="bank-finance-list">{financing.map((item) => <FinanceCard key={item.id} item={item} installments={data.installments.filter((row) => row.financingId === item.id)} busy={actionBusy === item.id} disabled={locked} onAction={financingAction} />)}</div>}</section><aside className="bank-panel bank-installments"><div className="bank-panel-head"><div><span className="bank-overline">CALENDARIO</span><h2>Cuotas</h2><p>Capital e intereses según el registro simulado.</p></div></div>{data.installments.length ? <div className="installment-list">{data.installments.map((row) => <article key={row.id}><span className={`installment-date ${row.status}`}><b>{row.installmentNumber.toString().padStart(2, '0')}</b><small>{dateLabel(row.dueDate).split(' ')[1]}</small></span><div><b>Vencimiento {dateLabel(row.dueDate)}</b><small>Capital {euro(row.principalCents)} · interés {euro(row.interestCents)}</small></div><strong>{euro(row.totalCents)}</strong><Status value={row.status} /></article>)}</div> : <Empty title="Sin cuotas programadas" text="El calendario se completa con la financiación del escenario." />}</aside></div><div className="bank-panel-foot"><span><ShieldAlert size={13} /> Las decisiones son educativas y no constituyen una oferta.</span><span>Fecha simulada: 15/09/2027</span></div></div>}
      </>}
    </>}
    {form && <div className="bank-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeForm(); }}><section className="bank-modal" role="dialog" aria-modal="true" aria-labelledby="bank-modal-title"><header><div><span className="bank-overline">OPERACIÓN SINTÉTICA · SIN MOVIMIENTO REAL</span><h2 id="bank-modal-title">{form === 'account' ? 'Crear cuenta sintética' : form === 'transfer' ? 'Registrar transferencia' : form === 'supplierPayment' ? 'Preparar pago a proveedor' : form === 'effect' ? 'Presentar efecto' : 'Solicitar financiación'}</h2></div><button type="button" onClick={closeForm} aria-label="Cerrar formulario">×</button></header><form onSubmit={submitForm}>
      {form === 'account' && <><Field label="Nombre de la cuenta"><input name="name" required minLength={2} maxLength={100} placeholder="Cuenta operativa" /></Field><Field label="Saldo inicial educativo (€)"><input name="amount" required inputMode="decimal" placeholder="0,00" /></Field></>}
      {form === 'transfer' && <><Field label="Cuenta de origen"><select name="sourceAccountId" required defaultValue={primary?.id ?? ''}>{accounts.filter((account) => account.status === 'active').map((account) => <option key={account.id} value={account.id}>{account.name} · {account.syntheticReference} · disponible {euro(account.availableCents)}</option>)}</select></Field><Field label="Beneficiario sintético"><select name="beneficiaryAccountId" required defaultValue=""><option value="" disabled>Selecciona empresa beneficiaria</option>{data?.beneficiaries.map((beneficiary) => <option key={beneficiary.accountId} value={beneficiary.accountId}>{beneficiary.organizationName} · {beneficiary.center} · {beneficiary.syntheticReference}</option>)}</select></Field><Field label="Importe (€)"><input name="amount" required inputMode="decimal" placeholder="0,00" /></Field><Field label="Concepto"><input name="concept" required minLength={3} maxLength={200} placeholder="Concepto de práctica" /></Field><Field label="Fecha programada · opcional"><input name="scheduledDate" type="date" min="2027-09-15" /></Field></>}
      {form === 'supplierPayment' && <><Field label="Factura de proveedor conformada"><select name="invoiceId" required defaultValue=""><option value="" disabled>Selecciona factura</option>{supplierInvoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.invoiceReference} · {invoice.supplierName} · {euro(invoice.totalCents)}</option>)}</select></Field><Field label="Cuenta de origen"><input value={primary ? `${primary.name} · ${primary.syntheticReference}` : 'Sin cuenta activa'} readOnly /></Field><p className="bank-form-hint">El importe se toma de la factura y queda pendiente de revisión. La aprobación no se envía a ningún banco real.</p></>}
      {form === 'effect' && <><Field label="Factura pendiente"><select name="invoiceId" required defaultValue=""><option value="" disabled>Selecciona factura</option>{invoices.map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.reference} · {invoice.buyerName} · pendiente {euro(invoice.balanceCents)}</option>)}</select></Field><Field label="Nominal del efecto (€)"><input name="amount" required inputMode="decimal" placeholder="0,00" /></Field><Field label="Vencimiento"><input name="maturityDate" type="date" required min="2027-09-15" /></Field></>}
      {form === 'financing' && <><Field label="Cuenta sintética"><select name="accountId" required defaultValue={primary?.id ?? ''}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.syntheticReference}</option>)}</select></Field><Field label="Producto didáctico"><select name="productType"><option value="loan">Préstamo</option><option value="credit_line">Línea de crédito</option><option value="discount">Descuento de efectos</option></select></Field><Field label="Importe solicitado (€)"><input name="amount" required inputMode="decimal" placeholder="0,00" /></Field><div className="bank-modal-row"><Field label="Plazo (meses)"><input name="termMonths" type="number" min="0" max="60" defaultValue="12" required /></Field><Field label="Tipo anual hipotético (%)"><input name="rate" type="number" min="0" max="50" step="0.01" defaultValue="6.2" required /></Field></div><Field label="Comisión hipotética (%)"><input name="commission" type="number" min="0" max="10" step="0.01" defaultValue="0" required /></Field><Field label="Efecto vinculado · opcional"><select name="effectId" defaultValue=""><option value="">Sin efecto vinculado</option>{data?.effects.map((effect) => <option key={effect.id} value={effect.id}>{effect.reference} · {effect.invoiceReference}</option>)}</select></Field><p className="bank-form-hint">Las condiciones se registran como hipótesis del escenario y no representan una oferta bancaria.</p></>}
      {formError && <div className="bank-inline-error" role="alert"><CircleAlert size={15} />{formError}</div>}{locked && <div className="bank-inline-error"><ShieldAlert size={15} />Tu perfil tiene acceso de solo lectura.</div>}<footer><button type="button" className="bank-button secondary" onClick={closeForm} disabled={formPending}>Cancelar</button><button type="submit" className="bank-button primary" disabled={formPending || locked}>{formPending ? 'Guardando…' : 'Registrar operación educativa'}</button></footer>
    </form></section></div>}
  </main>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="bank-field"><span>{label}</span>{children}</label>;
}
function SearchBox({ value, onChange, label, placeholder }: { value: string; onChange: (value: string) => void; label: string; placeholder: string }) {
  return <label className="bank-search"><span>{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} aria-label={label} /></label>;
}
function TransferControls({ item, disabled, busy, onAction }: { item: Fp360BankOverview['transfers'][number]; disabled: boolean; busy: boolean; onAction: (id: string, action: 'validate' | 'authorize' | 'execute' | 'reject' | 'cancel') => void }) {
  const allowed: Array<'validate' | 'authorize' | 'execute' | 'reject' | 'cancel'> = item.status === 'draft' ? ['validate', 'cancel'] : item.status === 'pending_review' ? ['authorize', 'reject'] : item.status === 'authorized' ? ['execute', 'cancel'] : item.status === 'scheduled' ? ['execute', 'cancel'] : [];
  return allowed.length ? <div className="bank-row-actions">{allowed.map((action) => <button key={action} type="button" disabled={disabled} onClick={() => onAction(item.id, action)}>{busy ? '…' : ({ validate: 'Validar', authorize: 'Autorizar', execute: 'Simular ejecución', reject: 'Rechazar', cancel: 'Cancelar' }[action])}</button>)}</div> : null;
}
function FinanceCard({ item, installments, busy, disabled, onAction }: { item: Fp360BankFinancing; installments: Fp360BankOverview['installments']; busy: boolean; disabled: boolean; onAction: (item: Fp360BankFinancing, action: 'offer' | 'reject' | 'accept' | 'draw' | 'repay' | 'pay_installment' | 'close') => void }) {
  let actions: Array<'offer' | 'reject' | 'accept' | 'draw' | 'repay' | 'pay_installment' | 'close'> = [];
  if (item.status === 'pending_review') actions = ['offer', 'reject'];
  else if (item.status === 'offered') actions = ['accept', 'reject'];
  else if (item.status === 'active') {
    if (item.productType === 'credit_line' && (item.creditLimitCents ?? 0) > item.drawnCents) actions.push('draw');
    if (item.drawnCents > 0) actions.push('repay');
    if (installments.some((row) => row.status === 'pending' || row.status === 'overdue')) actions.push('pay_installment');
    actions.push('close');
  }
  return <article className="finance-card" data-testid={`card-bank-financing-${item.id}`}><div className="finance-card-top"><span className="finance-product-icon"><CreditCard size={17} /></span><div><b>{label(item.productType)}</b><small>{item.effectReference ? `Efecto ${item.effectReference}` : `Solicitud · ${dateLabel(item.createdAt)}`}</small></div><Status value={item.status} /></div><div className="finance-values"><div><small>Solicitado</small><b>{euro(item.requestedAmountCents)}</b></div><div><small>{item.status === 'active' ? 'Dispuesto' : 'Oferta registrada'}</small><b>{euro(item.drawnCents || item.offeredAmountCents)}</b></div><div><small>Tipo / plazo</small><b>{(item.annualRateBps / 100).toLocaleString('es-ES')}% · {item.termMonths} m</b></div></div><div className="finance-costs"><span>Neto estimado <b>{euro(item.netDisbursementCents)}</b></span><span>Coste total <b>{euro(item.totalCostCents)}</b></span><span>Cuota estimada <b>{euro(item.installmentCents)}</b></span></div>{item.decisionReason && <p className="finance-reason">{item.decisionReason}</p>}{actions.length > 0 && <div className="finance-actions">{actions.map((action) => <button type="button" key={action} disabled={disabled || busy} onClick={() => onAction(item, action)}>{busy ? '…' : ({ offer: 'Registrar oferta didáctica', reject: 'Rechazar', accept: 'Aceptar oferta didáctica', draw: 'Simular disposición', repay: 'Simular amortización', pay_installment: 'Simular pago de cuota', close: 'Cerrar producto' }[action])}</button>)}</div>}</article>;
}

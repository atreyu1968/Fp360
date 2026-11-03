import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetFp360AccountingOverviewQueryKey,
  getGetFp360AccountingYearEndSummaryQueryKey,
  useCloseFp360AccountingPeriod,
  useCreateFp360AccountingAccount,
  useCreateFp360AccountingEntry,
  useCreateFp360AccountingSourceDraft,
  useGetFp360AccountingOverview,
  useGetFp360AccountingYearEndSummary,
  usePostFp360AccountingEntry,
  useReopenFp360AccountingPeriod,
  useReverseFp360AccountingEntry,
} from '@workspace/api-client-react';
import type {
  AuthIdentity,
  Fp360AccountingAccount,
  Fp360AccountingEntry,
  Fp360AccountingOverview,
  Fp360AccountingPeriod,
  Fp360AccountingSource,
  Fp360AccountingSourceDraftInput,
  Fp360AccountingYearEndSummary,
  Fp360Organization,
} from '@workspace/api-client-react';

type Props = {
  identity: AuthIdentity;
  organizations?: Fp360Organization[];
  onNotice: (message: string) => void;
};
type View = 'summary' | 'journal' | 'chart' | 'ledger' | 'reports' | 'close';
type ExportBook = 'journal' | 'ledger';
type DraftLine = { accountId: string; description: string; debit: string; credit: string };
type Nature = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
type PayrollAccountMapping = NonNullable<Fp360AccountingSourceDraftInput['payrollAccounts']>;

const natureNames: Record<Nature, string> = {
  asset: 'Activo',
  liability: 'Pasivo',
  equity: 'Patrimonio neto',
  revenue: 'Ingresos',
  expense: 'Gastos',
};
const viewNames: Array<{ id: View; label: string }> = [
  { id: 'summary', label: 'Cuadro contable' },
  { id: 'journal', label: 'Libro diario' },
  { id: 'chart', label: 'Plan contable' },
  { id: 'ledger', label: 'Mayor' },
  { id: 'reports', label: 'Balances y resultados' },
  { id: 'close', label: 'Cierre contable' },
];
const payrollAccountFields: Array<{ key: keyof PayrollAccountMapping; label: string; nature: Nature[] }> = [
  { key: 'wagesExpenseAccountId', label: 'Salario bruto · gasto', nature: ['expense'] },
  { key: 'employerCostAccountId', label: 'Cuota de empresa · gasto', nature: ['expense'] },
  { key: 'netPayableAccountId', label: 'Líquido educativo pendiente', nature: ['liability'] },
  { key: 'workerContributionAccountId', label: 'Cuota educativa de persona trabajadora', nature: ['liability'] },
  { key: 'employerContributionAccountId', label: 'Cuota educativa de empresa pendiente', nature: ['liability'] },
  { key: 'withholdingAccountId', label: 'Retención didáctica pendiente', nature: ['liability'] },
  { key: 'advancesAccountId', label: 'Anticipos deducidos', nature: ['asset'] },
  { key: 'otherDeductionsAccountId', label: 'Otras deducciones', nature: ['asset', 'liability'] },
];
const formatMoney = (cents: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
const formatDate = (value: string) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
const operationId = () => crypto.randomUUID();
const centsFromInput = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);
const signedMoney = (cents: number) => `${cents < 0 ? '−' : ''}${formatMoney(Math.abs(cents))}`;

function initialLines(accounts: Fp360AccountingAccount[]): DraftLine[] {
  const debit = accounts.find((account) => account.normalBalance === 'debit');
  const credit = accounts.find((account) => account.normalBalance === 'credit');
  return [
    { accountId: debit?.id ?? '', description: '', debit: '', credit: '' },
    { accountId: credit?.id ?? '', description: '', debit: '', credit: '' },
  ];
}

export function AccountingPage({ identity, organizations = [], onNotice }: Props) {
  const queryClient = useQueryClient();
  const canChooseOrganization = !identity.organizationId && ['teacher', 'administrator'].includes(identity.role);
  const [organizationId, setOrganizationId] = useState(identity.organizationId ?? organizations[0]?.id ?? '');
  const [view, setView] = useState<View>('summary');
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [search, setSearch] = useState('');
  const [entryModal, setEntryModal] = useState(false);
  const [accountModal, setAccountModal] = useState(false);
  const [periodAction, setPeriodAction] = useState<{ type: 'close' | 'reopen'; period: Fp360AccountingPeriod } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [entryDate, setEntryDate] = useState('2027-09-15');
  const [concept, setConcept] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [accountCode, setAccountCode] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNature, setAccountNature] = useState<Nature>('asset');
  const [normalBalance, setNormalBalance] = useState<'debit' | 'credit'>('debit');
  const [parentCode, setParentCode] = useState('');
  const [sourceInProgress, setSourceInProgress] = useState('');
  const [pendingPayrollSource, setPendingPayrollSource] = useState<Fp360AccountingSource | null>(null);
  const [payrollAccounts, setPayrollAccounts] = useState<PayrollAccountMapping>({
    wagesExpenseAccountId: '',
    employerCostAccountId: '',
    netPayableAccountId: '',
    workerContributionAccountId: '',
    employerContributionAccountId: '',
    withholdingAccountId: '',
    advancesAccountId: '',
    otherDeductionsAccountId: '',
  });
  const [actionInProgress, setActionInProgress] = useState('');
  const [selectedFiscalYear, setSelectedFiscalYear] = useState(2027);
  const [exportingBook, setExportingBook] = useState<ExportBook | null>(null);

  const overviewQuery = useGetFp360AccountingOverview<Fp360AccountingOverview>(
    { organizationId },
    { query: { enabled: Boolean(organizationId) } },
  );
  const yearEndSummaryQuery = useGetFp360AccountingYearEndSummary<Fp360AccountingYearEndSummary>(
    { organizationId, fiscalYear: selectedFiscalYear },
    { query: { enabled: Boolean(organizationId) && view === 'close' } },
  );
  const overview = overviewQuery.data;
  const selectedOrganization = organizations.find((organization) => organization.id === organizationId);
  const accounts = overview?.accounts ?? [];
  const entries = overview?.entries ?? [];
  const balances = overview?.balances ?? [];
  const periods = overview?.periods ?? [];
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;
  const accountBalance = balances.find((balance) => balance.accountId === selectedAccountId);
  const createAccount = useCreateFp360AccountingAccount();
  const createEntry = useCreateFp360AccountingEntry();
  const postEntry = usePostFp360AccountingEntry();
  const reverseEntry = useReverseFp360AccountingEntry();
  const createSourceDraft = useCreateFp360AccountingSourceDraft();
  const closePeriod = useCloseFp360AccountingPeriod();
  const reopenPeriod = useReopenFp360AccountingPeriod();
  const readOnly = ['promoter', 'mentor'].includes(identity.role);
  const canManagePeriods = ['team_manager', 'teacher', 'administrator'].includes(identity.role);
  const canReverse = canManagePeriods;
  useEffect(() => {
    if (!selectedAccountId && accounts[0]) setSelectedAccountId(accounts[0].id);
  }, [accounts, selectedAccountId]);
  const visibleEntries = useMemo(() => entries.filter((entry) => {
    const needle = search.trim().toLocaleLowerCase('es');
    return !needle || [entry.concept, entry.sourceReference ?? '', String(entry.entryNumber ?? '')]
      .some((value) => value.toLocaleLowerCase('es').includes(needle));
  }), [entries, search]);
  const currentDraftLines = draftLines.length ? draftLines : initialLines(accounts);
  const debitDraft = currentDraftLines.reduce((sum, line) => sum + (Number.isFinite(centsFromInput(line.debit)) ? centsFromInput(line.debit) : 0), 0);
  const creditDraft = currentDraftLines.reduce((sum, line) => sum + (Number.isFinite(centsFromInput(line.credit)) ? centsFromInput(line.credit) : 0), 0);
  const resultCents = balances.filter((balance) => balance.nature === 'revenue').reduce((sum, balance) => sum + balance.balanceCents, 0)
    - balances.filter((balance) => balance.nature === 'expense').reduce((sum, balance) => sum + balance.balanceCents, 0);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getGetFp360AccountingOverviewQueryKey({ organizationId }) });
    void queryClient.invalidateQueries({
      queryKey: getGetFp360AccountingYearEndSummaryQueryKey({ organizationId, fiscalYear: selectedFiscalYear }),
    });
  };
  const exportBook = async (book: ExportBook) => {
    if (!organizationId || !overview || exportingBook) return;
    setExportingBook(book);
    try {
      const params = new URLSearchParams({
        organizationId,
        fiscalYear: String(selectedFiscalYear),
        book,
      });
      const basePath = import.meta.env.BASE_URL.replace(/\/+$/, '');
      const response = await fetch(`${basePath}/api/redfp360/accounting/export?${params.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'text/csv' },
      });
      if (!response.ok) throw new Error('No se pudo generar el archivo.');
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1]
        ?? `red-fp360-${book}-${selectedFiscalYear}.csv`;
      link.href = objectUrl;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      onNotice(`${book === 'journal' ? 'Libro diario' : 'Mayor'} descargado · ${selectedOrganization?.name ?? organizationId} · ejercicio ${selectedFiscalYear}.`);
    } catch {
      onNotice(`No se pudo descargar el ${book === 'journal' ? 'diario' : 'mayor'}. Revisa el acceso e inténtalo de nuevo.`);
    } finally {
      setExportingBook(null);
    }
  };

  const openEntryForm = () => {
    setEntryDate('2027-09-15');
    setConcept('');
    setDraftLines(initialLines(accounts));
    setEntryModal(true);
  };
  const changeLine = (index: number, key: keyof DraftLine, value: string) => {
    setDraftLines((current) => {
      const next = current.length ? [...current] : initialLines(accounts);
      next[index] = { ...next[index], [key]: value };
      if (key === 'debit' && value) next[index].credit = '';
      if (key === 'credit' && value) next[index].debit = '';
      return next;
    });
  };
  const saveEntry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const lines = currentDraftLines.map((line) => ({
      accountId: line.accountId,
      description: line.description.trim() || concept.trim(),
      debitCents: centsFromInput(line.debit || '0'),
      creditCents: centsFromInput(line.credit || '0'),
      thirdPartyOrganizationId: null,
    }));
    createEntry.mutate({ data: { organizationId, operationId: operationId(), entryDate, concept, lines } }, {
      onSuccess: (entry) => {
        setEntryModal(false);
        setSelectedEntryId(entry.id);
        refresh();
        onNotice('Borrador contable guardado. Revisa el equilibrio antes de contabilizarlo.');
      },
      onError: () => onNotice('No se pudo guardar el borrador. Revisa las cuentas, la fecha y los importes.'),
    });
  };
  const submitAccount = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createAccount.mutate({ data: {
      organizationId,
      code: accountCode.trim(),
      name: accountName.trim(),
      nature: accountNature,
      normalBalance,
      parentCode: parentCode || null,
    } }, {
      onSuccess: () => {
        setAccountModal(false);
        setAccountCode('');
        setAccountName('');
        setParentCode('');
        refresh();
        onNotice('Cuenta añadida al plan contable de la empresa.');
      },
      onError: () => onNotice('No se pudo añadir la cuenta. Comprueba el código y la estructura del plan.'),
    });
  };
  const post = (entry: Fp360AccountingEntry) => {
    setActionInProgress(entry.id);
    postEntry.mutate({ id: entry.id, data: { organizationId, operationId: operationId() } }, {
      onSuccess: () => { refresh(); onNotice(`Asiento contabilizado con el número asignado.`); },
      onError: () => onNotice(entry.sourceType === 'payroll_run'
        ? 'El borrador no se ha contabilizado. Comprueba el equilibrio, el periodo abierto y que no seas quien preparó o revisó la nómina.'
        : 'El asiento no se ha contabilizado. Comprueba que Debe y Haber coincidan y que el periodo esté abierto.'),
      onSettled: () => setActionInProgress(''),
    });
  };
  const reverse = (entry: Fp360AccountingEntry) => {
    const reason = window.prompt('Motivo del contrasiento:');
    if (!reason || reason.trim().length < 5) return;
    setActionInProgress(entry.id);
    reverseEntry.mutate({ id: entry.id, data: { organizationId, operationId: operationId(), reason: reason.trim() } }, {
      onSuccess: () => { refresh(); onNotice('Contrasiento registrado con trazabilidad; el asiento original se conserva.'); },
      onError: () => onNotice('No se pudo crear el contrasiento. Comprueba el permiso y el estado del periodo.'),
      onSettled: () => setActionInProgress(''),
    });
  };
  const importSource = (sourceType: 'sales_invoice' | 'purchase_invoice' | 'payment', sourceId: string) => {
    setSourceInProgress(sourceId);
    createSourceDraft.mutate({ sourceType, sourceId, data: { organizationId, operationId: operationId() } }, {
      onSuccess: (entry) => {
        setSelectedEntryId(entry.id);
        refresh();
        onNotice('Documento importado como borrador. Revisa y contabiliza el asiento.');
      },
      onError: () => onNotice('No se pudo importar el documento. Puede estar ya vinculado o no estar conformado.'),
      onSettled: () => setSourceInProgress(''),
    });
  };
  const beginPayrollImport = (source: Fp360AccountingSource) => {
    const idForCode = (code: string, nature: Nature) =>
      accounts.find((account) => account.code === code && account.active)?.id
      ?? accounts.find((account) => account.nature === nature && account.active)?.id
      ?? '';
    setPayrollAccounts({
      wagesExpenseAccountId: idForCode('6400', 'expense'),
      employerCostAccountId: idForCode('6420', 'expense'),
      netPayableAccountId: idForCode('4650', 'liability'),
      workerContributionAccountId: idForCode('4760', 'liability'),
      employerContributionAccountId: idForCode('4760', 'liability'),
      withholdingAccountId: idForCode('4751', 'liability'),
      advancesAccountId: idForCode('4600', 'asset'),
      otherDeductionsAccountId: idForCode('4651', 'liability'),
    });
    setPendingPayrollSource(source);
  };
  const submitPayrollImport = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingPayrollSource?.periodKey || !pendingPayrollSource.version) return;
    setSourceInProgress(pendingPayrollSource.id);
    createSourceDraft.mutate({
      sourceType: 'payroll_run',
      sourceId: pendingPayrollSource.id,
      data: {
        organizationId,
        operationId: operationId(),
        expectedPeriodKey: pendingPayrollSource.periodKey,
        expectedVersion: pendingPayrollSource.version,
        payrollAccounts,
      },
    }, {
      onSuccess: (entry) => {
        setPendingPayrollSource(null);
        setSelectedEntryId(entry.id);
        setView('journal');
        refresh();
        onNotice('Nómina importada como borrador. Una persona distinta debe revisarla antes de contabilizarla.');
      },
      onError: () => onNotice('No se pudo importar la nómina. Comprueba su empresa, periodo, versión y estado cerrado.'),
      onSettled: () => setSourceInProgress(''),
    });
  };
  const submitPeriodAction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!periodAction) return;
    const variables = {
      fiscalYear: periodAction.period.fiscalYear,
      period: periodAction.period.period,
      data: { organizationId, operationId: operationId(), reason: actionReason.trim() },
    };
    const callbacks = {
      onSuccess: () => {
        setPeriodAction(null);
        setActionReason('');
        refresh();
        onNotice(periodAction.type === 'close' ? 'Periodo cerrado y guardado en el historial.' : 'Periodo reabierto con autorización y trazabilidad.');
      },
      onError: () => onNotice('No se pudo completar la acción. Revisa los borradores, el saldo y los permisos.'),
      onSettled: () => setActionInProgress(''),
    };
    setActionInProgress(`${periodAction.type}-${periodAction.period.id}`);
    if (periodAction.type === 'close') closePeriod.mutate(variables, callbacks);
    else reopenPeriod.mutate(variables, callbacks);
  };

  const sourceForEntry = (entry: Fp360AccountingEntry) => entry.sourceReference
    ? `${entry.sourceType.replace('_', ' ')} · ${entry.sourceReference}`
    : entry.sourceType === 'manual' ? 'Asiento manual' : entry.sourceType;
  const accountMovements = selectedAccount ? entries
    .filter((entry) => entry.status !== 'draft')
    .flatMap((entry) => entry.lines.filter((line) => line.accountId === selectedAccount.id).map((line) => ({ entry, line })))
    .sort((a, b) => a.entry.entryDate.localeCompare(b.entry.entryDate) || (a.entry.entryNumber ?? 0) - (b.entry.entryNumber ?? 0)) : [];
  let runningBalance = 0;

  return <main className="page-content accounting-page">
    <div className="page-heading accounting-heading">
      <div><span className="page-kicker">CICLO ECONÓMICO · REGISTRO CONTABLE</span><h1>Contabilidad</h1><p>Diario, mayor y estados didácticos enlazados con documentos de origen.</p></div>
      <div className="accounting-heading-actions">
        {canChooseOrganization && <label className="accounting-org-select">Empresa<select value={organizationId} onChange={(event) => {
          setOrganizationId(event.target.value);
          setSelectedEntryId('');
          setSelectedAccountId('');
          setSearch('');
        }}><option value="">Selecciona una empresa</option>{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.center}</option>)}</select></label>}
        <button className="button button-primary" type="button" disabled={readOnly || !organizationId || !accounts.length} onClick={openEntryForm}>＋ Nuevo asiento</button>
      </div>
    </div>
    <div className="accounting-sim-note">Simulación educativa: estos asientos no constituyen contabilidad oficial ni generan obligaciones fiscales reales.</div>
    {organizationId && <div className="accounting-export-toolbar" data-testid="accounting-export-toolbar">
      <div className="accounting-export-scope"><small>DESCARGA CONTABLE · ÁMBITO VISIBLE</small><b>{selectedOrganization?.name ?? organizationId} · {selectedOrganization?.center ?? 'Centro no disponible'} · Ejercicio {selectedFiscalYear}</b></div>
      <label>Ejercicio<select value={selectedFiscalYear} onChange={(event) => setSelectedFiscalYear(Number(event.target.value))} data-testid="select-accounting-export-year">
        {[...new Set([selectedFiscalYear, ...periods.map((period) => period.fiscalYear)])].sort((a, b) => b - a).map((year) => <option key={year} value={year}>{year}</option>)}
      </select></label>
      <button className="button button-secondary" type="button" disabled={!overview || Boolean(exportingBook)} onClick={() => void exportBook('journal')} data-testid="button-export-journal-csv">
        {exportingBook === 'journal' ? 'Generando diario…' : 'Descargar diario CSV'}
      </button>
      <button className="button button-secondary" type="button" disabled={!overview || Boolean(exportingBook)} onClick={() => void exportBook('ledger')} data-testid="button-export-ledger-csv">
        {exportingBook === 'ledger' ? 'Generando mayor…' : 'Descargar mayor CSV'}
      </button>
    </div>}
    {!organizationId && <div className="accounting-empty">Selecciona una empresa para consultar sus cuentas y libros.</div>}
    {organizationId && overviewQuery.isLoading && <div className="accounting-empty">Cargando libros contables…</div>}
    {organizationId && overviewQuery.isError && <div className="accounting-empty accounting-error">No se pudo cargar la contabilidad. <button className="text-button" onClick={refresh}>Reintentar</button></div>}
    {overview && <>
      <div className="accounting-tabs" role="tablist" aria-label="Vistas de contabilidad">{viewNames.map((item) => <button type="button" key={item.id} className={view === item.id ? 'accounting-tab active' : 'accounting-tab'} role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}</div>
      <div className="accounting-kpis">
        <article><span>Saldo bancos</span><b>{formatMoney(balances.filter((balance) => balance.code.startsWith('572')).reduce((sum, balance) => sum + balance.balanceCents, 0))}</b><small>Cuenta 572 · saldo deudor</small></article>
        <article><span>Resultado didáctico</span><b className={resultCents >= 0 ? 'accounting-positive' : 'accounting-negative'}>{signedMoney(resultCents)}</b><small>Ingresos menos gastos contabilizados</small></article>
        <article><span>Asientos pendientes</span><b>{overview.totals.draftEntryCount}</b><small>Requieren revisión</small></article>
        <article><span>Periodo actual</span><b>{periods.find((period) => period.fiscalYear === 2027 && period.period === 9)?.status === 'closed' ? 'Cerrado' : 'Abierto'}</b><small>Septiembre de 2027 · escenario</small></article>
      </div>

      {view === 'summary' && <div className="accounting-view-grid">
        <section className="panel accounting-panel"><div className="accounting-section-head"><div><h2>Actividad del diario</h2><p>Últimos asientos de esta empresa y su estado.</p></div><button className="text-button" onClick={() => setView('journal')}>Abrir libro diario →</button></div>
          <EntryTable entries={entries.slice(0, 6)} onSelect={(entry) => { setSelectedEntryId(entry.id); setView('journal'); }} />
        </section>
        <section className="panel accounting-panel"><div className="accounting-section-head"><div><h2>Fuentes para importar</h2><p>Documentos confirmados y nóminas cerradas; siempre se crean como borrador.</p></div></div>
          {overview.sources.filter((source) => !source.imported).slice(0, 8).map((source) => {
            const isPayroll = source.sourceType === 'payroll_run';
            const label = isPayroll ? 'Nómina cerrada' : source.sourceType === 'sales_invoice' ? 'Venta' : source.sourceType === 'payment' ? 'Cobro' : 'Compra';
            const awaitingInvoice = source.status === 'awaiting_invoice';
            return <div className="accounting-source-row" key={`${source.sourceType}:${source.id}`}>
              <div><b>{source.reference}</b><small>{label} · {source.partnerName} · {formatDate(source.sourceDate)}{awaitingInvoice ? ' · Contabiliza antes la factura de venta' : ''}</small></div>
              <strong>{formatMoney(source.totalCents)}</strong>
              <button className="mini-button" disabled={readOnly || sourceInProgress === source.id || awaitingInvoice || (isPayroll && (!source.periodKey || !source.version))}
                onClick={() => isPayroll ? beginPayrollImport(source) : importSource(source.sourceType as 'sales_invoice' | 'purchase_invoice' | 'payment', source.id)}>
                {sourceInProgress === source.id ? 'Importando…' : awaitingInvoice ? 'Pendiente' : isPayroll ? 'Elegir cuentas' : 'Crear borrador'}
              </button>
            </div>;
          })}
          {!overview.sources.some((source) => !source.imported) && <div className="accounting-empty compact">No hay facturas, cobros ni nóminas cerradas pendientes de importar.</div>}
        </section>
      </div>}

      {view === 'journal' && <section className="panel accounting-panel">
        <div className="accounting-section-head"><div><h2>Libro diario</h2><p>Asientos numerados, documentos vinculados y validación Debe/Haber.</p></div><div className="accounting-toolbar"><input aria-label="Buscar asiento" placeholder="Buscar concepto o referencia" value={search} onChange={(event) => setSearch(event.target.value)} /><button className="button button-primary" disabled={readOnly} onClick={openEntryForm}>Nuevo asiento</button></div></div>
        <div className="accounting-journal-layout"><div className="accounting-table-scroll"><EntryTable entries={visibleEntries} onSelect={(entry) => setSelectedEntryId(entry.id)} selectedId={selectedEntryId} /></div>
          <EntryDetail entry={selectedEntry} readOnly={readOnly} canReverse={canReverse} onPost={post} onReverse={reverse} actionInProgress={actionInProgress} />
        </div>
      </section>}

      {view === 'chart' && <section className="panel accounting-panel">
        <div className="accounting-section-head"><div><h2>Plan contable</h2><p>Plan didáctico de la empresa; las cuentas usadas por asientos contabilizados se conservan.</p></div><button className="button button-primary" disabled={readOnly} onClick={() => setAccountModal(true)}>＋ Crear subcuenta</button></div>
        <div className="accounting-table-scroll"><table className="accounting-table"><thead><tr><th>Código</th><th>Cuenta</th><th>Naturaleza</th><th>Saldo habitual</th><th>Movimientos</th><th>Estado</th></tr></thead><tbody>
          {accounts.map((account) => {
            const balance = balances.find((item) => item.accountId === account.id);
            return <tr key={account.id}><td className="accounting-code">{account.code}</td><td><b>{account.name}</b>{account.isSystem && <small className="accounting-system-tag">Sistema</small>}</td><td>{natureNames[account.nature]}</td><td>{account.normalBalance === 'debit' ? 'Debe' : 'Haber'}</td><td>{formatMoney(balance?.balanceCents ?? 0)}</td><td><span className={account.active ? 'accounting-status active' : 'accounting-status'}>{account.active ? 'Activa' : 'Inactiva'}</span></td></tr>;
          })}
        </tbody></table></div>
      </section>}

      {view === 'ledger' && <section className="panel accounting-panel">
        <div className="accounting-section-head"><div><h2>Mayor</h2><p>Movimientos acumulados por cuenta, enlazados con su asiento.</p></div><label className="accounting-inline-select">Cuenta<select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}><option value="">Selecciona una cuenta</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label></div>
        {selectedAccount && <><div className="accounting-ledger-summary"><b>{selectedAccount.code} · {selectedAccount.name}</b><span>Debe {formatMoney(accountBalance?.debitCents ?? 0)}</span><span>Haber {formatMoney(accountBalance?.creditCents ?? 0)}</span><strong>Saldo {signedMoney(accountBalance?.balanceCents ?? 0)}</strong></div>
          <div className="accounting-table-scroll"><table className="accounting-table"><thead><tr><th>Fecha</th><th>Asiento</th><th>Concepto</th><th>Debe</th><th>Haber</th><th>Saldo acumulado</th></tr></thead><tbody>
            {accountMovements.map(({ entry, line }) => {
              runningBalance += selectedAccount.normalBalance === 'debit' ? line.debitCents - line.creditCents : line.creditCents - line.debitCents;
              return <tr key={`${entry.id}:${line.lineNumber}`}><td>{formatDate(entry.entryDate)}</td><td><button className="accounting-link" onClick={() => { setSelectedEntryId(entry.id); setView('journal'); }}>{entry.entryNumber ?? 'Borrador'}</button></td><td>{line.description}</td><td>{line.debitCents ? formatMoney(line.debitCents) : '—'}</td><td>{line.creditCents ? formatMoney(line.creditCents) : '—'}</td><td>{signedMoney(runningBalance)}</td></tr>;
            })}
            {!accountMovements.length && <tr><td colSpan={6} className="accounting-empty-cell">Esta cuenta aún no tiene movimientos contabilizados.</td></tr>}
          </tbody></table></div></>}
      </section>}

      {view === 'reports' && <section className="panel accounting-panel">
        <div className="accounting-section-head"><div><h2>Balances y resultados</h2><p>Sumas, saldos y resultado derivados exclusivamente del diario contabilizado.</p>{selectedOrganization && <p className="accounting-report-scope">Ámbito: {selectedOrganization.name} · {selectedOrganization.center}</p>}</div><button className="button button-secondary" onClick={() => window.print()}>Imprimir / guardar PDF</button></div>
        <div className="accounting-report-cards"><article><span>Total Debe</span><b>{formatMoney(overview.totals.debitCents)}</b></article><article><span>Total Haber</span><b>{formatMoney(overview.totals.creditCents)}</b></article><article><span>Resultado didáctico</span><b className={resultCents >= 0 ? 'accounting-positive' : 'accounting-negative'}>{signedMoney(resultCents)}</b></article><article><span>Control</span><b>{overview.totals.balanced ? 'Cuadrado' : 'Revisar'}</b></article></div>
        <div className="accounting-table-scroll"><table className="accounting-table"><thead><tr><th>Cuenta</th><th>Nombre</th><th>Naturaleza</th><th>Sumas Debe</th><th>Sumas Haber</th><th>Saldo natural</th></tr></thead><tbody>
          {balances.map((balance) => <tr key={balance.accountId}><td className="accounting-code">{balance.code}</td><td>{balance.name}</td><td>{natureNames[balance.nature]}</td><td>{formatMoney(balance.debitCents)}</td><td>{formatMoney(balance.creditCents)}</td><td>{signedMoney(balance.balanceCents)}</td></tr>)}
        </tbody></table></div>
      </section>}

      {view === 'close' && <section className="panel accounting-panel">
        <div className="accounting-section-head"><div><h2>Cierre contable</h2><p>Un periodo no se cierra si conserva borradores o saldos descuadrados. La reapertura queda auditada.</p></div><label className="accounting-inline-select">Ejercicio<select value={selectedFiscalYear} onChange={(event) => setSelectedFiscalYear(Number(event.target.value))}>{[...new Set(periods.map((period) => period.fiscalYear))].sort((a, b) => b - a).map((year) => <option key={year} value={year}>{year}</option>)}</select></label></div>
        <YearEndSummaryCard summary={yearEndSummaryQuery.data} loading={yearEndSummaryQuery.isLoading} error={yearEndSummaryQuery.isError} />
        <div className="accounting-period-grid">{periods.filter((period) => period.fiscalYear === selectedFiscalYear).sort((a, b) => a.period - b.period).map((period) => {
          const drafts = entries.filter((entry) => entry.fiscalYear === period.fiscalYear && entry.period === period.period && entry.status === 'draft').length;
          return <article key={period.id} className={period.status === 'closed' ? 'accounting-period closed' : 'accounting-period'}>
            <div><span>Periodo {String(period.period).padStart(2, '0')}</span><b>{new Intl.DateTimeFormat('es-ES', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(period.fiscalYear, period.period - 1, 1)))}</b></div>
            <span className={period.status === 'closed' ? 'accounting-status closed' : 'accounting-status active'}>{period.status === 'closed' ? 'Cerrado' : 'Abierto'}</span>
            <small>{drafts ? `${drafts} borrador(es) pendiente(s)` : 'Sin borradores pendientes'}</small>
            {period.status === 'closed'
              ? <button className="mini-button" disabled={!canManagePeriods} onClick={() => { setPeriodAction({ type: 'reopen', period }); setActionReason(''); }}>Reabrir</button>
              : <button className="mini-button" disabled={!canManagePeriods || drafts > 0 || !overview.totals.balanced} onClick={() => { setPeriodAction({ type: 'close', period }); setActionReason(''); }}>Validar y cerrar</button>}
          </article>;
        })}</div>
      </section>}
    </>}

    {entryModal && <div className="accounting-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEntryModal(false); }}><section className="accounting-modal" role="dialog" aria-modal="true" aria-labelledby="new-entry-title">
      <form onSubmit={saveEntry}><div className="accounting-modal-head"><div><span>LIBRO DIARIO</span><h2 id="new-entry-title">Nuevo asiento</h2></div><button type="button" className="accounting-close" aria-label="Cerrar" onClick={() => setEntryModal(false)}>×</button></div>
        <label>Fecha simulada<input type="date" min="2027-01-01" max="2027-09-15" required value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
        <label>Concepto<input required minLength={3} maxLength={250} value={concept} onChange={(event) => setConcept(event.target.value)} placeholder="Describe la operación contable" /></label>
        <div className="accounting-form-lines"><div className="accounting-form-line header"><span>Cuenta y concepto</span><span>Debe (€)</span><span>Haber (€)</span></div>
          {currentDraftLines.map((line, index) => <div className="accounting-form-line" key={index}>
            <div><select aria-label={`Cuenta línea ${index + 1}`} required value={line.accountId} onChange={(event) => changeLine(index, 'accountId', event.target.value)}><option value="">Selecciona cuenta</option>{accounts.filter((account) => account.active).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select><input aria-label={`Concepto línea ${index + 1}`} value={line.description} onChange={(event) => changeLine(index, 'description', event.target.value)} placeholder="Concepto de línea" /></div>
            <input aria-label={`Debe línea ${index + 1}`} inputMode="decimal" value={line.debit} onChange={(event) => changeLine(index, 'debit', event.target.value)} placeholder="0,00" />
            <input aria-label={`Haber línea ${index + 1}`} inputMode="decimal" value={line.credit} onChange={(event) => changeLine(index, 'credit', event.target.value)} placeholder="0,00" />
            {currentDraftLines.length > 2 && <button type="button" className="accounting-remove-line" aria-label={`Eliminar línea ${index + 1}`} onClick={() => setDraftLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>×</button>}
          </div>)}
        </div>
        <button type="button" className="text-button" onClick={() => setDraftLines((current) => [...(current.length ? current : initialLines(accounts)), { accountId: '', description: '', debit: '', credit: '' }])}>＋ Añadir línea</button>
        <div className={`accounting-draft-check ${debitDraft === creditDraft && debitDraft > 0 ? 'balanced' : 'unbalanced'}`}><span>Debe {formatMoney(debitDraft)}</span><span>Haber {formatMoney(creditDraft)}</span><b>{debitDraft === creditDraft && debitDraft > 0 ? 'Cuadrado' : 'Pendiente de revisión'}</b></div>
        <div className="accounting-modal-actions"><button type="button" className="button button-secondary" onClick={() => setEntryModal(false)}>Cancelar</button><button className="button button-primary" disabled={createEntry.isPending || readOnly}>{createEntry.isPending ? 'Guardando…' : 'Guardar borrador'}</button></div>
      </form>
    </section></div>}

    {pendingPayrollSource && <div className="accounting-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingPayrollSource(null); }}>
      <section className="accounting-modal" role="dialog" aria-modal="true" aria-labelledby="payroll-import-title">
        <form onSubmit={submitPayrollImport}>
          <div className="accounting-modal-head"><div><span>ORIGEN DE NÓMINA</span><h2 id="payroll-import-title">Preparar borrador contable</h2></div>
            <button type="button" className="accounting-close" aria-label="Cerrar" onClick={() => setPendingPayrollSource(null)}>×</button></div>
          <p className="accounting-modal-copy">{pendingPayrollSource.reference}. Elige cuentas del plan de esta empresa. Se conservará una línea por concepto y referencia ficticia; no se contabiliza ni se paga automáticamente.</p>
          <div className="accounting-entry-form-lines">
            {payrollAccountFields.map((field) => <label key={field.key}>{field.label}
              <select required value={payrollAccounts[field.key]} onChange={(event) => setPayrollAccounts((current) => ({ ...current, [field.key]: event.target.value }))}>
                <option value="">Selecciona una cuenta</option>
                {accounts.filter((account) => account.active && field.nature.includes(account.nature)).map((account) =>
                  <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}
              </select>
            </label>)}
          </div>
          <div className="accounting-modal-actions"><button type="button" className="button button-secondary" onClick={() => setPendingPayrollSource(null)}>Cancelar</button>
            <button className="button button-primary" disabled={createSourceDraft.isPending || readOnly}>{createSourceDraft.isPending ? 'Creando borrador…' : 'Importar como borrador'}</button></div>
        </form>
      </section>
    </div>}

    {accountModal && <div className="accounting-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAccountModal(false); }}><section className="accounting-modal accounting-modal-small" role="dialog" aria-modal="true" aria-labelledby="new-account-title">
      <form onSubmit={submitAccount}><div className="accounting-modal-head"><div><span>PLAN CONTABLE</span><h2 id="new-account-title">Crear subcuenta</h2></div><button type="button" className="accounting-close" aria-label="Cerrar" onClick={() => setAccountModal(false)}>×</button></div>
        <label>Código<input required minLength={3} maxLength={12} pattern="[0-9A-Za-z.]+" value={accountCode} onChange={(event) => setAccountCode(event.target.value)} placeholder="4300001" /></label>
        <label>Nombre<input required minLength={2} maxLength={120} value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Cliente de prácticas" /></label>
        <label>Naturaleza<select value={accountNature} onChange={(event) => setAccountNature(event.target.value as Nature)}>{Object.entries(natureNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
        <label>Saldo habitual<select value={normalBalance} onChange={(event) => setNormalBalance(event.target.value as 'debit' | 'credit')}><option value="debit">Debe</option><option value="credit">Haber</option></select></label>
        <label>Cuenta principal<select value={parentCode} onChange={(event) => setParentCode(event.target.value)}><option value="">Sin cuenta principal</option>{accounts.map((account) => <option key={account.id} value={account.code}>{account.code} · {account.name}</option>)}</select></label>
        <div className="accounting-modal-actions"><button type="button" className="button button-secondary" onClick={() => setAccountModal(false)}>Cancelar</button><button className="button button-primary" disabled={createAccount.isPending || readOnly}>{createAccount.isPending ? 'Guardando…' : 'Crear cuenta'}</button></div>
      </form>
    </section></div>}

    {periodAction && <div className="accounting-modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPeriodAction(null); }}><section className="accounting-modal accounting-modal-small" role="dialog" aria-modal="true" aria-labelledby="period-action-title">
      <form onSubmit={submitPeriodAction}><div className="accounting-modal-head"><div><span>CIERRE CONTABLE</span><h2 id="period-action-title">{periodAction.type === 'close' ? 'Validar y cerrar periodo' : 'Reabrir periodo'}</h2></div><button type="button" className="accounting-close" aria-label="Cerrar" onClick={() => setPeriodAction(null)}>×</button></div>
        <p className="accounting-modal-copy">Periodo {String(periodAction.period.period).padStart(2, '0')} de {periodAction.period.fiscalYear}. La acción quedará registrada con autor, fecha y motivo.</p>
        <label>Motivo<textarea required minLength={5} maxLength={500} value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></label>
        <div className="accounting-modal-actions"><button type="button" className="button button-secondary" onClick={() => setPeriodAction(null)}>Cancelar</button><button className="button button-primary" disabled={actionInProgress === `${periodAction.type}-${periodAction.period.id}`}>{actionInProgress ? 'Guardando…' : periodAction.type === 'close' ? 'Confirmar cierre' : 'Confirmar reapertura'}</button></div>
      </form>
    </section></div>}
  </main>;
}

function YearEndSummaryCard({ summary, loading, error }: {
  summary?: Fp360AccountingYearEndSummary;
  loading: boolean;
  error: boolean;
}) {
  const unsettledAccounts = summary?.profitAndLossAccounts.filter((account) => account.balanceCents !== 0) ?? [];

  return <section className="accounting-year-end" aria-labelledby="accounting-year-end-title">
    <div className="accounting-year-end-heading">
      <div><h3 id="accounting-year-end-title">Comprobación de cierre anual</h3><p>Resumen didáctico del ejercicio. Esta consulta no crea asientos ni modifica saldos.</p></div>
    </div>
    {loading && <p className="accounting-year-end-message">Calculando saldos del ejercicio…</p>}
    {error && <p className="accounting-year-end-message error">No se pudo cargar la comprobación del ejercicio.</p>}
    {summary && <>
      <div className="accounting-year-end-cards">
        <article><span>Ingresos contabilizados</span><b>{signedMoney(summary.revenueCents)}</b></article>
        <article><span>Gastos contabilizados</span><b>{signedMoney(summary.expenseCents)}</b></article>
        <article><span>Resultado didáctico</span><b className={summary.resultCents >= 0 ? 'accounting-positive' : 'accounting-negative'}>{signedMoney(summary.resultCents)}</b></article>
      </div>
      <div className="accounting-year-end-checks" aria-label="Controles del ejercicio">
        <YearEndCheck label="Periodos cerrados" value={`${summary.periodsClosed}/${summary.periodsExpected}`} passed={summary.periodsClosed === summary.periodsExpected} />
        <YearEndCheck label="Borradores pendientes" value={String(summary.draftEntries)} passed={summary.draftEntries === 0} />
        <YearEndCheck label="Libro diario" value={summary.journalBalanced ? 'Cuadrado' : 'Descuadrado'} passed={summary.journalBalanced} />
        <YearEndCheck label="Saldos de ingresos y gastos" value={summary.profitAndLossAccountsSettled ? 'A cero' : `${summary.unsettledProfitAndLossAccounts} pendientes`} passed={summary.profitAndLossAccountsSettled} />
      </div>
      {unsettledAccounts.length > 0
        ? <div className="accounting-table-scroll"><table className="accounting-table">
          <thead><tr><th>Cuenta</th><th>Nombre</th><th>Naturaleza</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead>
          <tbody>{unsettledAccounts.map((account) => <tr key={account.accountId}>
            <td className="accounting-code">{account.code}</td>
            <td>{account.name}</td>
            <td>{account.nature === 'revenue' ? 'Ingresos' : 'Gastos'}</td>
            <td>{formatMoney(account.debitCents)}</td>
            <td>{formatMoney(account.creditCents)}</td>
            <td>{signedMoney(account.balanceCents)}</td>
          </tr>)}</tbody>
        </table></div>
        : <p className="accounting-year-end-message">No hay saldos pendientes en cuentas de ingresos o gastos.</p>}
      <p className={`accounting-year-end-result ${summary.readyForAnnualClose ? 'passed' : ''}`}>
        {summary.readyForAnnualClose
          ? 'Los controles previos del ejercicio están completos. No se ha generado ningún asiento de cierre.'
          : 'El ejercicio aún no supera todos los controles previos al cierre.'}
      </p>
    </>}
  </section>;
}

function YearEndCheck({ label, value, passed }: { label: string; value: string; passed: boolean }) {
  return <div className={`accounting-year-end-check ${passed ? 'passed' : 'pending'}`}>
    <span>{label}</span><b>{value}</b>
  </div>;
}

function EntryTable({ entries, selectedId, onSelect }: {
  entries: Fp360AccountingEntry[];
  selectedId?: string;
  onSelect: (entry: Fp360AccountingEntry) => void;
}) {
  return <div className="accounting-table-scroll"><table className="accounting-table"><thead><tr><th>N.º / fecha</th><th>Concepto y origen</th><th>Debe</th><th>Haber</th><th>Estado</th></tr></thead><tbody>
    {entries.map((entry) => <tr key={entry.id} className={selectedId === entry.id ? 'accounting-row-selected' : ''} onClick={() => onSelect(entry)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(entry); }}>
      <td><b className="accounting-code">{entry.entryNumber ?? 'Borrador'}</b><small>{formatDate(entry.entryDate)}</small></td><td><b>{entry.concept}</b><small>{entry.sourceReference ? `${entry.sourceType.replace('_', ' ')} · ${entry.sourceReference}` : `Creado por ${entry.createdByName}`}</small></td><td>{formatMoney(entry.debitCents)}</td><td>{formatMoney(entry.creditCents)}</td><td><span className={`accounting-status ${entry.status}`}>{entry.status === 'draft' ? 'Borrador' : entry.status === 'reversed' ? 'Rectificado' : 'Contabilizado'}</span></td>
    </tr>)}
    {!entries.length && <tr><td colSpan={5} className="accounting-empty-cell">Todavía no hay asientos. Importa una factura confirmada o crea un borrador.</td></tr>}
  </tbody></table></div>;
}

function EntryDetail({ entry, readOnly, canReverse, actionInProgress, onPost, onReverse }: {
  entry: Fp360AccountingEntry | null;
  readOnly: boolean;
  canReverse: boolean;
  actionInProgress: string;
  onPost: (entry: Fp360AccountingEntry) => void;
  onReverse: (entry: Fp360AccountingEntry) => void;
}) {
  if (!entry) return <aside className="accounting-entry-detail"><div className="accounting-empty compact">Selecciona un asiento para revisar sus líneas y trazabilidad.</div></aside>;
  return <aside className="accounting-entry-detail">
    <div className="accounting-detail-head"><div><span>DETALLE DE ASIENTO</span><h3>{entry.entryNumber ? `N.º ${entry.entryNumber}` : 'Borrador'}</h3><p>{entry.concept}</p></div><span className={`accounting-status ${entry.status}`}>{entry.status === 'draft' ? 'Borrador' : entry.status === 'reversed' ? 'Rectificado' : 'Contabilizado'}</span></div>
    <div className="accounting-detail-meta"><span>Fecha <b>{formatDate(entry.entryDate)}</b></span><span>Origen <b>{entry.sourceReference ?? 'Manual'}</b></span><span>Autor <b>{entry.createdByName}</b></span></div>
    <div className="accounting-lines-list">{entry.lines.map((line) => <div key={line.lineNumber}><span className="accounting-code">{line.accountCode}</span><span>{line.accountName}<small>{line.description}</small></span><b>{line.debitCents ? formatMoney(line.debitCents) : '—'}</b><b>{line.creditCents ? formatMoney(line.creditCents) : '—'}</b></div>)}</div>
    <div className={`accounting-draft-check ${entry.debitCents === entry.creditCents ? 'balanced' : 'unbalanced'}`}><span>Debe {formatMoney(entry.debitCents)}</span><span>Haber {formatMoney(entry.creditCents)}</span><b>{entry.debitCents === entry.creditCents ? 'Cuadrado' : 'Descuadrado'}</b></div>
    {entry.status === 'draft' && <button className="button button-primary accounting-detail-action" disabled={readOnly || actionInProgress === entry.id || entry.debitCents <= 0 || entry.debitCents !== entry.creditCents} onClick={() => onPost(entry)}>Validar y contabilizar</button>}
    {entry.status === 'posted' && canReverse && <button className="button button-secondary accounting-detail-action" disabled={actionInProgress === entry.id} onClick={() => onReverse(entry)}>Crear contrasiento</button>}
    {entry.reversalOfEntryId && <p className="accounting-reversal-note">Contrasiento del asiento {entry.reversalOfEntryId.slice(0, 8)}. La operación original se conserva en el historial.</p>}
    <div className="accounting-events"><b>Historial y evidencias</b>{entry.events.map((event, index) => <div key={`${event.createdAt}-${index}`}><i /><span><strong>{event.eventType.replaceAll('_', ' ')}</strong><small>{event.description} · {event.actorName} · {formatDate(event.createdAt)}</small></span></div>)}</div>
  </aside>;
}

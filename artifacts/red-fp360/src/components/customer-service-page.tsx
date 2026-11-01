import { type FormEvent, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, BadgeCheck, Check, CircleAlert, ClipboardList,
  FileText, LockKeyhole, PackageCheck, Plus, RefreshCw, Search, ShieldAlert, Star,
} from 'lucide-react';
import {
  getGetFp360CustomerServiceOverviewQueryKey,
  useActOnFp360CustomerAgreement, useActOnFp360CustomerCase, useActOnFp360CustomerReturn,
  useCreateFp360CustomerAgreement, useCreateFp360CustomerCase, useCreateFp360CustomerReturn,
  useGetFp360CustomerServiceOverview,
} from '@workspace/api-client-react';
import type { AuthIdentity, Fp360CustomerServiceOverview, Fp360Organization } from '@workspace/api-client-react';
import './customer-service-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'inbox' | 'new' | 'detail' | 'returns' | 'agreements' | 'quality';
const tabs: Array<{ id: View; label: string; icon: typeof ClipboardList }> = [
  { id: 'inbox', label: 'Bandeja de casos', icon: ClipboardList },
  { id: 'new', label: 'Nuevo expediente', icon: Plus },
  { id: 'detail', label: 'Detalle de reclamación', icon: FileText },
  { id: 'returns', label: 'Devoluciones', icon: PackageCheck },
  { id: 'agreements', label: 'Garantías y acuerdos', icon: BadgeCheck },
  { id: 'quality', label: 'Análisis de calidad', icon: Activity },
];
const statusNames: Record<string, string> = {
  draft: 'Borrador', pending: 'Pendiente', assigned: 'Asignado', investigating: 'En investigación',
  solution_proposed: 'Solución propuesta', resolved: 'Resuelto', closed: 'Cerrado', rejected: 'Rechazado',
  requested: 'Solicitada', approved: 'Aprobada', received: 'Recibida',
  credit_note_requested: 'Rectificativa solicitada', active: 'Activo', archived: 'Archivado',
};
const categoryNames: Record<string, string> = {
  inquiry: 'Consulta', delivery: 'Entrega', product_quality: 'Calidad de producto', invoice: 'Factura',
  return: 'Devolución', warranty: 'Garantía', other: 'Otro',
};
const priorityNames: Record<string, string> = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica' };
const conditionNames: Record<string, string> = { damaged: 'Dañado', defective: 'Defectuoso', unopened: 'Sin abrir', incomplete: 'Incompleto', other: 'Otro' };
const dateLabel = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
};
const canTeachRole = (role: AuthIdentity['role']) => role === 'teacher' || role === 'administrator';
const opId = () => crypto.randomUUID();

function Badge({ value, kind = '' }: { value: string; kind?: string }) {
  const positive = ['resolved', 'closed', 'approved', 'received', 'active'].includes(value);
  return <span className={`cs-badge ${positive ? 'positive' : ['critical', 'rejected'].includes(value) ? 'danger' : 'waiting'} ${kind}`}><i />{statusNames[value] ?? priorityNames[value] ?? value}</span>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="cs-empty"><span><ClipboardList size={20} /></span><b>{title}</b><p>{detail}</p></div>;
}
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="cs-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function CustomerServicePage({ identity, organizations = [], onNotice }: Props) {
  const client = useQueryClient();
  const canTeach = canTeachRole(identity.role);
  const [selectedOrg, setSelectedOrg] = useState(identity.organizationId ?? '');
  const organizationId = identity.organizationId ?? selectedOrg;
  const [view, setView] = useState<View>('inbox');
  const [selectedCaseId, setSelectedCaseId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [formError, setFormError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [caseNotes, setCaseNotes] = useState({ description: '', reference: '', rootCause: '', satisfactionScore: '5' });
  const [returnDraft, setReturnDraft] = useState({ caseId: '', shipmentId: '', shipmentLineId: '', unitsReported: '1', condition: 'damaged', reason: '' });
  const queryKey = getGetFp360CustomerServiceOverviewQueryKey({ organizationId });
  const overview = useGetFp360CustomerServiceOverview({ organizationId }, { query: { enabled: Boolean(organizationId), queryKey } });
  const createCase = useCreateFp360CustomerCase();
  const actCase = useActOnFp360CustomerCase();
  const createReturn = useCreateFp360CustomerReturn();
  const actReturn = useActOnFp360CustomerReturn();
  const createAgreement = useCreateFp360CustomerAgreement();
  const actAgreement = useActOnFp360CustomerAgreement();
  const data = overview.data as Fp360CustomerServiceOverview | undefined;
  const cases = useMemo(() => data?.cases ?? [], [data?.cases]);
  const returns = useMemo(() => data?.returns ?? [], [data?.returns]);
  const agreements = useMemo(() => data?.agreements ?? [], [data?.agreements]);
  const term = search.trim().toLocaleLowerCase('es');
  const filteredCases = cases.filter((item) =>
    `${item.caseRef} ${item.customerOrganizationName} ${item.request} ${categoryNames[item.category]}`
      .toLocaleLowerCase('es').includes(term) && (statusFilter === 'all' || item.status === statusFilter));
  const selectedCase = cases.find((item) => item.id === selectedCaseId) ?? filteredCases[0] ?? cases[0];
  const retry = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const invalidate = () => { if (organizationId) void client.invalidateQueries({ queryKey }); };
  const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
  const notifyMutation = (message: string) => { invalidate(); onNotice(message); };
  const runCaseAction = (action: 'validate' | 'assign_to_me' | 'start_investigation' | 'request_evidence' | 'record_evidence' | 'draft_response' | 'propose_solution' | 'resolve' | 'close' | 'reject') => {
    if (!selectedCase) return;
    if ((action === 'resolve' || action === 'close' || action === 'reject') && !canTeach) return;
    if (action === 'close' && (!caseNotes.rootCause.trim() || !caseNotes.satisfactionScore)) {
      setActionError('Para cerrar el expediente, registra la causa raíz y una valoración de satisfacción.'); return;
    }
    if (action === 'reject' && !window.confirm('¿Rechazar el expediente dentro del escenario educativo?')) return;
    setActionError(''); setBusyId(selectedCase.id);
    actCase.mutate({ caseId: selectedCase.id, data: {
      action, ...(caseNotes.description.trim() ? { description: caseNotes.description.trim() } : {}),
      ...(caseNotes.reference.trim() ? { reference: caseNotes.reference.trim() } : {}),
      ...(action === 'close' ? { rootCause: caseNotes.rootCause.trim(), satisfactionScore: Number(caseNotes.satisfactionScore) } : {}),
      operationId: opId(),
    } }, {
      onSuccess: () => { setBusyId(''); notifyMutation('Etapa registrada en el expediente. No se ha enviado ninguna comunicación externa.'); setActionError(''); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo actualizar el expediente.')); },
    });
  };
  const submitCase = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    const form = event.currentTarget;
    const fd = new FormData(form);
    const customerOrganizationId = String(fd.get('customerOrganizationId'));
    const sourceType = String(fd.get('sourceType')) as 'order' | 'invoice' | 'shipment' | 'standalone';
    const request = String(fd.get('request')).trim();
    const sourceReference = String(fd.get('sourceReference')).trim();
    const standaloneReason = String(fd.get('standaloneReason')).trim();
    if (!organizationId || !customerOrganizationId || request.length < 10 || (sourceType === 'standalone' && standaloneReason.length < 5) || (sourceType !== 'standalone' && !sourceReference)) {
      setFormError('Completa la organización, motivo y referencia de origen; en un expediente independiente explica el contexto.'); return;
    }
    createCase.mutate({ data: {
      organizationId, customerOrganizationId, sourceType,
      ...(sourceType === 'standalone' ? { standaloneReason } : { sourceReference }),
      category: String(fd.get('category')) as never, priority: String(fd.get('priority')) as never, request, operationId: opId(),
    } }, {
      onSuccess: (created) => { notifyMutation('Expediente educativo registrado como borrador.'); setSelectedCaseId(created.id); setView('detail'); setFormError(''); form.reset(); },
      onError: (error) => setFormError(errorText(error, 'No se pudo crear el expediente. Revisa los datos y vuelve a intentarlo.')),
    });
  };
  const submitReturn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    const line = data?.returnSources.flatMap((source) => source.lines.map((item) => ({ ...item, source })))
      .find((item) => item.source.shipmentId === returnDraft.shipmentId && item.shipmentLineId === returnDraft.shipmentLineId);
    const units = Number(returnDraft.unitsReported);
    if (!returnDraft.caseId || !line || !Number.isInteger(units) || units < 1 || units > line.deliveredUnits - line.alreadyRequestedUnits || returnDraft.reason.trim().length < 10) {
      setFormError('Elige un caso y una línea entregada; las unidades deben estar dentro del saldo disponible y la razón debe tener al menos 10 caracteres.'); return;
    }
    createReturn.mutate({ data: { caseId: returnDraft.caseId, shipmentId: returnDraft.shipmentId, shipmentLineId: returnDraft.shipmentLineId, unitsReported: units, condition: returnDraft.condition as never, reason: returnDraft.reason.trim(), operationId: opId() } }, {
      onSuccess: () => { notifyMutation('Solicitud de devolución registrada. No modifica inventario ni documentos económicos.'); setFormError(''); setReturnDraft((v) => ({ ...v, reason: '' })); },
      onError: (error) => setFormError(errorText(error, 'No se pudo registrar la devolución.')),
    });
  };
  const returnAction = (returnId: string, action: 'approve' | 'reject' | 'record_receipt' | 'request_credit_note' | 'close', units?: number) => {
    if ((action === 'approve' || action === 'reject' || action === 'close') && !canTeach) return;
    if (action === 'approve' && !window.confirm('Aprobar solo registra el proceso; no cambia inventario, factura, contabilidad, cobros ni banco.')) return;
    setActionError(''); setBusyId(returnId);
    actReturn.mutate({ returnId, data: { action, ...(action === 'approve' ? { unitsApproved: units } : {}), ...(action === 'record_receipt' ? { unitsReceived: units } : {}), ...(action === 'request_credit_note' ? { description: 'Solicitud interna de rectificativa; emisión externa no realizada.' } : {}), operationId: opId() } }, {
      onSuccess: () => { setBusyId(''); notifyMutation(action === 'request_credit_note' ? 'Solicitud interna de rectificativa registrada; no se ha emitido ni enviado.' : 'Etapa de devolución registrada sin modificar inventario ni cuentas.'); setActionError(''); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo actualizar la devolución.')); },
    });
  };
  const submitAgreement = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setFormError('');
    const form = event.currentTarget;
    const fd = new FormData(form);
    const validFrom = String(fd.get('validFrom')); const validTo = String(fd.get('validTo'));
    const terms = String(fd.get('terms')).trim(); const productRef = String(fd.get('productRef')).trim();
    if (!organizationId || productRef.length < 1 || terms.length < 10 || !validFrom || !validTo || validTo < validFrom) { setFormError('Revisa la referencia, los términos educativos y el periodo de vigencia.'); return; }
    createAgreement.mutate({ data: { organizationId, productRef, terms, validFrom, validTo, replacementAllowed: fd.get('replacementAllowed') === 'on', compensationAllowed: fd.get('compensationAllowed') === 'on', operationId: opId() } }, {
      onSuccess: () => { notifyMutation('Nueva versión de acuerdo guardada como borrador educativo.'); setFormError(''); form.reset(); },
      onError: (error) => setFormError(errorText(error, 'No se pudo guardar el acuerdo.')),
    });
  };
  const agreementAction = (agreementId: string, action: 'activate' | 'archive') => {
    if (!canTeach || !window.confirm(action === 'activate' ? '¿Activar esta versión como acuerdo educativo? No define plazos ni obligaciones legales.' : '¿Archivar esta versión educativa?')) return;
    setBusyId(agreementId);
    actAgreement.mutate({ agreementId, data: { action, operationId: opId() } }, {
      onSuccess: () => { setBusyId(''); notifyMutation(action === 'activate' ? 'Versión educativa activada.' : 'Versión educativa archivada.'); },
      onError: (error) => { setBusyId(''); setActionError(errorText(error, 'No se pudo actualizar el acuerdo.')); },
    });
  };

  const sourceLines = data?.returnSources.flatMap((source) => source.lines.filter((line) => line.deliveredUnits > line.alreadyRequestedUnits).map((line) => ({ source, line }))) ?? [];
  const selectedReturnSource = data?.returnSources.find((source) => source.shipmentId === returnDraft.shipmentId);
  const allowedActions = selectedCase ? ({
    draft: ['validate', 'reject'], pending: ['validate', 'assign_to_me', 'reject'],
    assigned: ['start_investigation', 'request_evidence', 'reject'],
    investigating: ['record_evidence', 'draft_response', 'request_evidence', 'propose_solution', 'reject'],
    solution_proposed: ['draft_response', 'resolve', 'reject'], resolved: ['close'], closed: [], rejected: [],
  } as Record<string, Array<'validate' | 'assign_to_me' | 'start_investigation' | 'request_evidence' | 'record_evidence' | 'draft_response' | 'propose_solution' | 'resolve' | 'close' | 'reject'>>)[selectedCase.status] ?? [] : [];
  const actionLabel: Record<string, string> = {
    validate: 'Validar expediente', assign_to_me: 'Asignármelo', start_investigation: 'Iniciar investigación',
    request_evidence: 'Anotar solicitud de evidencia', record_evidence: 'Registrar evidencia', draft_response: 'Guardar borrador interno',
    propose_solution: 'Proponer solución', resolve: 'Resolver expediente', close: 'Cerrar expediente', reject: 'Rechazar expediente',
  };

  return <main className="page-content cs-page">
    <header className="cs-heading">
      <div><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>COMERCIAL · APLICACIÓN 12</span></div><span className="cs-kicker">CURSO 2027–2028 · ORGANIZACIONES FICTICIAS</span><h1>Atención al cliente</h1><p>Reclamaciones, devoluciones y acuerdos educativos. Cada etapa queda registrada, sin salir de FP360.</p></div>
      {!identity.organizationId && canTeach && <label className="cs-org-select">Organización<select value={organizationId} onChange={(e) => setSelectedOrg(e.target.value)}><option value="">Selecciona organización</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
    </header>
    <aside className="cs-safety"><ShieldAlert size={19} /><div><b>ENTORNO EDUCATIVO · SIN COMUNICACIONES EXTERNAS</b><span>No introduzcas teléfonos ni correos. Las respuestas, solicitudes de evidencia y notificaciones son borradores o notas internas. Aprobar una devolución no modifica inventario, factura, contabilidad, cobros ni banco; solo registra el proceso y, si procede, una solicitud interna de rectificativa.</span></div></aside>
    {!organizationId ? <section className="cs-unselected"><ClipboardList size={26} /><span className="cs-eyebrow">ÁMBITO DE TRABAJO</span><h2>Selecciona una organización</h2><p>Los expedientes pertenecen a una organización comercial cada vez.</p>{canTeach ? <select aria-label="Organización" value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)}><option value="">Selecciona organización</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select> : <p>Tu perfil no tiene una organización asignada. Solicita al equipo docente que configure el acceso.</p>}</section> : <>
      <div className="cs-topline"><span><i /> Actividad trazable · solo datos devueltos por el API</span><span>Fecha del escenario · {dateLabel(data?.simulatedDate)}</span></div>
      <nav className="cs-tabs" role="tablist" aria-label="Vistas de Atención al cliente">{tabs.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} key={id} onClick={() => { setView(id); setFormError(''); setActionError(''); }}><Icon size={15} />{label}</button>)}</nav>
      {overview.isLoading ? <div className="cs-skeleton" role="status" aria-label="Cargando expedientes"><span /><span /><span /><span /></div> : overview.isError ? <div className="cs-error" role="alert"><CircleAlert size={17} /><span>No se ha podido cargar Atención al cliente.</span><button type="button" onClick={retry}><RefreshCw size={14} /> Reintentar</button></div> : data && <>
        <section className="cs-metrics" aria-label="Indicadores de calidad del API">
          <article><span className="blue"><ClipboardList size={17} /></span><small>Casos abiertos</small><strong>{data.summary.openCases}</strong><em>{data.summary.highPriorityCases} de prioridad alta</em></article>
          <article><span className="green"><Check size={17} /></span><small>Resueltos este mes</small><strong>{data.summary.resolvedThisMonth}</strong><em>Expedientes del escenario</em></article>
          <article><span className="amber"><PackageCheck size={17} /></span><small>Devoluciones pendientes</small><strong>{data.summary.pendingReturns}</strong><em>Proceso interno</em></article>
          <article><span className="violet"><Star size={17} /></span><small>Satisfacción media</small><strong>{data.summary.averageSatisfaction.toLocaleString('es-ES', { maximumFractionDigits: 1 })}<small> / 5</small></strong><em>{data.summary.activeAgreements} acuerdos educativos activos</em></article>
        </section>
        {!canTeach && <div className="cs-permission"><LockKeyhole size={15} /> Puedes registrar y seguir casos. Resolver, cerrar o rechazar casos, aprobar devoluciones y activar o archivar acuerdos requiere rol docente o administración.</div>}
        {actionError && <div className="cs-error inline" role="alert"><CircleAlert size={16} />{actionError}<button type="button" onClick={() => setActionError('')}>Cerrar</button></div>}
        <div className="cs-content page-enter">
          {view === 'inbox' && <section className="cs-panel">
            <header className="cs-section-head"><div><span className="cs-eyebrow">RELACIONES COMERCIALES</span><h2>Bandeja de casos</h2><p>Selecciona un expediente para revisar su estado y trazabilidad.</p></div><button type="button" className="cs-button primary" onClick={() => setView('new')}><Plus size={15} /> Nuevo expediente</button></header>
            <div className="cs-toolbar"><label className="cs-search"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar referencia, empresa o motivo" aria-label="Buscar casos" /></label><select aria-label="Filtrar casos por estado" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">Todos los estados</option>{Object.entries(statusNames).slice(0, 8).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
            <div className="cs-table-wrap"><table><thead><tr><th>Expediente</th><th>Organización cliente</th><th>Motivo</th><th>Apertura</th><th>Prioridad</th><th>Estado</th></tr></thead><tbody>
              {filteredCases.map((item) => <tr key={item.id} className={selectedCase?.id === item.id ? 'selected' : ''} data-testid={`row-customer-case-${item.id}`}><td><button type="button" className="cs-row-select" onClick={() => { setSelectedCaseId(item.id); setView('detail'); }}><b className="mono">{item.caseRef}</b><small>{item.sourceReference ?? 'Origen independiente'}</small></button></td><td>{item.customerOrganizationName}</td><td>{categoryNames[item.category]}</td><td>{dateLabel(item.openedDate)}</td><td><Badge value={item.priority} /></td><td><Badge value={item.status} /></td></tr>)}
              {!filteredCases.length && <tr><td colSpan={6}><Empty title="No hay casos coincidentes" detail="Ajusta la búsqueda o crea un expediente para empezar." /></td></tr>}
            </tbody></table></div>
          </section>}
          {view === 'new' && <div className="cs-two-col"><section className="cs-panel"><header className="cs-section-head"><div><span className="cs-eyebrow">ALTA DE EXPEDIENTE</span><h2>Nuevo caso</h2><p>El servidor comprueba la referencia comercial seleccionada.</p></div></header>
            <form className="cs-form" onSubmit={submitCase}>
              <Field label="Organización cliente"><select name="customerOrganizationId" defaultValue="" required><option value="">Selecciona organización</option>{data.customerOrganizations.map((org) => <option key={org.id} value={org.id}>{org.name} · {org.center} · {org.island}</option>)}</select></Field>
              <div className="cs-form-grid"><Field label="Tipo de origen"><select name="sourceType" defaultValue="shipment"><option value="order">Pedido</option><option value="invoice">Factura</option><option value="shipment">Expedición</option><option value="standalone">Sin origen comercial</option></select></Field><Field label="Referencia de origen" hint="El backend valida que pedido, factura o expedición existan."><input name="sourceReference" maxLength={100} placeholder="Referencia registrada" /></Field></div>
              <Field label="Motivo"><select name="category" defaultValue="delivery">{Object.entries(categoryNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
              <Field label="Prioridad"><select name="priority" defaultValue="medium"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></Field>
              <Field label="Solicitud del expediente" hint="No incluyas datos personales, teléfonos ni correos."><textarea name="request" minLength={10} maxLength={3000} required placeholder="Describe el problema comercial con referencias ficticias y hechos verificables." /></Field>
              <Field label="Justificación si no hay origen" hint="Solo se requiere al elegir «Sin origen comercial»."><textarea name="standaloneReason" maxLength={500} placeholder="Contexto del expediente independiente" /></Field>
              {formError && <p className="cs-form-error" role="alert"><CircleAlert size={14} />{formError}</p>}
              <div className="cs-form-actions"><button type="button" className="cs-button secondary" onClick={() => { setView('inbox'); setFormError(''); }}>Cancelar</button><button className="cs-button primary" type="submit" disabled={createCase.isPending}><Plus size={14} />{createCase.isPending ? 'Guardando…' : 'Crear expediente'}</button></div>
            </form></section><aside className="cs-aside-callout"><ShieldAlert size={19} /><span className="cs-eyebrow">NOTA DE SEGURIDAD</span><h3>Validar no es comunicar.</h3><p>La validación solo registra una etapa interna. Las respuestas y solicitudes de evidencia son borradores; no se envían a ninguna organización.</p><div className="cs-callout-rule">No introduzcas teléfonos, correos ni datos personales.</div></aside></div>}
          {view === 'detail' && <div className="cs-two-col cs-detail-layout"><section className="cs-panel">
            {selectedCase ? <>
              <header className="cs-section-head"><div><span className="cs-eyebrow">EXPEDIENTE · {selectedCase.caseRef}</span><h2>{selectedCase.customerOrganizationName}</h2><p>{categoryNames[selectedCase.category]} · abierto {dateLabel(selectedCase.openedDate)}</p></div><Badge value={selectedCase.status} /></header>
              <div className="cs-case-summary"><div><small>Solicitud</small><p>{selectedCase.request}</p></div><dl><div><dt>Origen</dt><dd>{selectedCase.sourceType === 'standalone' ? 'Independiente' : selectedCase.sourceType}</dd></div><div><dt>Referencia</dt><dd className="mono">{selectedCase.sourceReference ?? '—'}</dd></div><div><dt>Responsable</dt><dd>{selectedCase.assignedToName ?? 'Sin asignar'}</dd></div><div><dt>Prioridad</dt><dd><Badge value={selectedCase.priority} /></dd></div><div><dt>Solución propuesta</dt><dd>{selectedCase.proposedSolution ?? 'Sin propuesta'}</dd></div><div><dt>Causa raíz</dt><dd>{selectedCase.rootCause ?? 'Pendiente'}</dd></div><div><dt>Satisfacción</dt><dd>{selectedCase.satisfactionScore ? `${selectedCase.satisfactionScore} / 5` : 'Pendiente'}</dd></div></dl></div>
              <div className="cs-note-box"><b>Notas de trabajo internas</b><p>Las evidencias, solicitudes y respuestas registradas aquí no se comunican externamente.</p><Field label="Descripción / borrador"><textarea value={caseNotes.description} onChange={(e) => setCaseNotes((v) => ({ ...v, description: e.target.value }))} maxLength={3000} placeholder="Nota interna, solicitud de evidencia o borrador de respuesta" /></Field><Field label="Referencia interna opcional"><input value={caseNotes.reference} onChange={(e) => setCaseNotes((v) => ({ ...v, reference: e.target.value }))} maxLength={160} placeholder="Referencia del documento en el sistema" /></Field>
                {selectedCase.status === 'resolved' && canTeach && <div className="cs-form-grid"><Field label="Causa raíz para cierre"><textarea value={caseNotes.rootCause} onChange={(e) => setCaseNotes((v) => ({ ...v, rootCause: e.target.value }))} maxLength={1000} /></Field><Field label="Satisfacción"><select value={caseNotes.satisfactionScore} onChange={(e) => setCaseNotes((v) => ({ ...v, satisfactionScore: e.target.value }))}>{[1, 2, 3, 4, 5].map((score) => <option key={score} value={score}>{score} / 5</option>)}</select></Field></div>}
                {formError && <p className="cs-form-error" role="alert">{formError}</p>}
                <div className="cs-action-row">{allowedActions.filter((action) => !['resolve', 'close', 'reject'].includes(action) || canTeach).map((action) => <button type="button" key={action} className={`cs-button ${['resolve', 'close'].includes(action) ? 'primary' : 'secondary'}`} disabled={busyId === selectedCase.id || actCase.isPending} onClick={() => runCaseAction(action)}>{actionLabel[action]}</button>)}</div>
              </div>
              <div className="cs-timeline"><h3>Historial del expediente</h3>{data.events.filter((event) => event.caseId === selectedCase.id).length ? data.events.filter((event) => event.caseId === selectedCase.id).map((event) => <article key={event.id}><span><Activity size={13} /></span><div><b>{event.description}</b><small>{event.actorName} · {dateLabel(event.simulatedDate)}{event.reference ? ` · ${event.reference}` : ''}</small></div></article>) : <Empty title="Sin eventos registrados" detail="Las actuaciones aparecerán en esta cronología." />}</div>
            </> : <Empty title="Selecciona un expediente" detail="El detalle muestra únicamente información recibida desde el API." />}
          </section><aside className="cs-stage-card"><span className="cs-eyebrow">CICLO DE ATENCIÓN</span><h3>Una etapa cada vez</h3><ol>{[['draft','Borrador'],['pending','Pendiente'],['assigned','Asignado'],['investigating','Investigación'],['solution_proposed','Solución'],['resolved','Resuelto'],['closed','Cerrado']].map(([key,label], index) => <li key={key} className={selectedCase?.status === key ? 'current' : ''}><span>{String(index + 1).padStart(2,'0')}</span><b>{label}</b>{selectedCase?.status === key && <i>Actual</i>}</li>)}</ol><p><LockKeyhole size={14} /> Cerrar requiere causa raíz y satisfacción. Rechazo, resolución y cierre: docente o administración.</p></aside></div>}
          {view === 'returns' && <div className="cs-two-col"><section className="cs-panel"><header className="cs-section-head"><div><span className="cs-eyebrow">EXPEDICIONES ENTREGADAS</span><h2>Registrar devolución</h2><p>Solo se admiten líneas entregadas con saldo disponible.</p></div></header>
            <form className="cs-form" onSubmit={submitReturn}><Field label="Caso relacionado"><select value={returnDraft.caseId} onChange={(e) => setReturnDraft((v) => ({ ...v, caseId: e.target.value }))} required><option value="">Selecciona caso</option>{cases.filter((item) => !['closed','rejected'].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.caseRef} · {item.customerOrganizationName}</option>)}</select></Field>
              <Field label="Línea de expedición entregada"><select value={`${returnDraft.shipmentId}|${returnDraft.shipmentLineId}`} onChange={(e) => { const [shipmentId, shipmentLineId] = e.target.value.split('|'); setReturnDraft((v) => ({ ...v, shipmentId, shipmentLineId })); }} required><option value="|">Selecciona una línea disponible</option>{sourceLines.map(({ source, line }) => <option key={`${source.shipmentId}-${line.shipmentLineId}`} value={`${source.shipmentId}|${line.shipmentLineId}`}>{source.shipmentReference} · {source.customerOrganizationName} · {line.productName} ({line.deliveredUnits - line.alreadyRequestedUnits} disponibles)</option>)}</select></Field>
              <div className="cs-form-grid"><Field label="Unidades comunicadas"><input type="number" min="1" max={selectedReturnSource?.lines.find((line) => line.shipmentLineId === returnDraft.shipmentLineId)?.deliveredUnits ?? 10000} value={returnDraft.unitsReported} onChange={(e) => setReturnDraft((v) => ({ ...v, unitsReported: e.target.value }))} required /></Field><Field label="Condición"><select value={returnDraft.condition} onChange={(e) => setReturnDraft((v) => ({ ...v, condition: e.target.value }))}>{Object.entries(conditionNames).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
              <Field label="Motivo"><textarea minLength={10} maxLength={1000} value={returnDraft.reason} onChange={(e) => setReturnDraft((v) => ({ ...v, reason: e.target.value }))} required /></Field>
              {formError && <p className="cs-form-error" role="alert">{formError}</p>}<button type="submit" className="cs-button primary" disabled={createReturn.isPending || !sourceLines.length}><Plus size={14} />{createReturn.isPending ? 'Registrando…' : 'Registrar solicitud'}</button>
              {!sourceLines.length && <p className="cs-inline-note">No hay líneas entregadas con unidades disponibles según los datos del API.</p>}
            </form></section><section className="cs-panel"><header className="cs-section-head"><div><span className="cs-eyebrow">SEGUIMIENTO</span><h2>Devoluciones registradas</h2></div></header>
            <div className="cs-return-list">{returns.length ? returns.map((item) => <article key={item.id}><div className="cs-return-top"><div><b className="mono">{item.caseRef}</b><small>{item.shipmentReference} · {item.productName}</small></div><Badge value={item.status} /></div><p>{item.reason}</p><div className="cs-return-stats"><span>Entregadas <b>{item.unitsDelivered}</b></span><span>Solicitadas <b>{item.unitsReported}</b></span><span>Aprobadas <b>{item.unitsApproved}</b></span><span>Recibidas <b>{item.unitsReceived}</b></span></div><small>Condición: {conditionNames[item.condition]}{item.creditNoteRequested ? ' · Rectificativa solicitada' : ''}</small><div className="cs-action-row">{canTeach && item.status === 'requested' && <><button type="button" className="cs-button secondary" disabled={busyId === item.id} onClick={() => returnAction(item.id,'approve',item.unitsReported)}>Aprobar proceso</button><button type="button" className="cs-button subtle" disabled={busyId === item.id} onClick={() => returnAction(item.id,'reject')}>Rechazar</button></>}{item.status === 'approved' && <button type="button" className="cs-button secondary" disabled={busyId === item.id} onClick={() => returnAction(item.id,'record_receipt',item.unitsApproved)}>Registrar recepción</button>}{['received','credit_note_requested'].includes(item.status) && !item.creditNoteRequested && <button type="button" className="cs-button secondary" disabled={busyId === item.id} onClick={() => returnAction(item.id,'request_credit_note')}>Solicitar rectificativa</button>}{canTeach && item.status === 'credit_note_requested' && <button type="button" className="cs-button secondary" disabled={busyId === item.id} onClick={() => returnAction(item.id,'close')}>Cerrar proceso</button>}</div></article>) : <Empty title="Sin devoluciones" detail="Las solicitudes registradas aparecerán aquí." />}</div>
            <div className="cs-caution"><AlertTriangle size={16} /><span>La aprobación y recepción solo registran el flujo. No se genera abono, asiento, movimiento de stock ni operación bancaria.</span></div>
          </section></div>}
          {view === 'agreements' && <div className="cs-two-col"><section className="cs-panel"><header className="cs-section-head"><div><span className="cs-eyebrow">VERSIONADO EDUCATIVO</span><h2>Garantías y acuerdos</h2><p>Los términos se acuerdan para practicar el proceso, no son plazos ni reglas legales.</p></div></header>
            <div className="cs-agreement-list">{agreements.length ? agreements.map((item) => <article key={item.id}><div className="cs-agreement-top"><div><span className="cs-eyebrow">{item.agreementRef} · {item.productRef}</span><h3>{item.status === 'active' ? 'Versión activa' : statusNames[item.status]}</h3></div><Badge value={item.status} /></div><p>{item.terms}</p><div className="cs-agreement-meta"><span>Vigencia educativa {dateLabel(item.validFrom)} – {dateLabel(item.validTo)}</span><span>{item.replacementAllowed ? 'Reposición prevista' : 'Sin reposición prevista'} · {item.compensationAllowed ? 'Compensación prevista' : 'Sin compensación prevista'}</span></div><small>Creado por {item.createdByName}{item.approvedByName ? ` · Activado por ${item.approvedByName}` : ''}</small>{canTeach && <div className="cs-action-row">{item.status === 'draft' && <button type="button" className="cs-button primary" disabled={busyId === item.id} onClick={() => agreementAction(item.id,'activate')}>Activar versión</button>}{item.status === 'active' && <button type="button" className="cs-button secondary" disabled={busyId === item.id} onClick={() => agreementAction(item.id,'archive')}>Archivar versión</button>}</div>}</article>) : <Empty title="Aún no hay acuerdos" detail="Crea una versión educativa para documentar los términos acordados." />}</div>
          </section><section className="cs-panel"><header className="cs-section-head"><div><span className="cs-eyebrow">NUEVA VERSIÓN</span><h2>Registrar acuerdo</h2><p>Las versiones se guardan como borrador y requieren activación docente.</p></div></header>
            <form className="cs-form" onSubmit={submitAgreement}><Field label="Producto o referencia"><select name="productRef" defaultValue="" required><option value="">Selecciona referencia del catálogo</option>{data.products.map((product) => <option key={product.sku} value={product.sku}>{product.sku} · {product.name}</option>)}</select></Field><Field label="Términos educativos"><textarea name="terms" minLength={10} maxLength={2000} required placeholder="Condiciones de práctica, alcance y criterios acordados" /></Field><div className="cs-form-grid"><Field label="Vigente desde"><input name="validFrom" type="date" required /></Field><Field label="Vigente hasta"><input name="validTo" type="date" required /></Field></div><label className="cs-check"><input name="replacementAllowed" type="checkbox" /> Se contempla reposición en el ejercicio</label><label className="cs-check"><input name="compensationAllowed" type="checkbox" /> Se contempla compensación en el ejercicio</label>{formError && <p className="cs-form-error" role="alert">{formError}</p>}<button type="submit" className="cs-button primary" disabled={createAgreement.isPending}><Plus size={14} />{createAgreement.isPending ? 'Guardando…' : 'Guardar versión educativa'}</button></form>
          </section></div>}
          {view === 'quality' && <div className="cs-two-col"><section className="cs-panel"><header className="cs-section-head"><div><span className="cs-eyebrow">INDICADORES DEL API</span><h2>Análisis de calidad</h2><p>Sin estimaciones locales: cifras procedentes del overview de Atención al cliente.</p></div></header><div className="cs-quality-grid"><article><small>Casos abiertos</small><strong>{data.summary.openCases}</strong></article><article><small>Casos con prioridad alta o crítica</small><strong>{data.summary.highPriorityCases}</strong></article><article><small>Resueltos este mes</small><strong>{data.summary.resolvedThisMonth}</strong></article><article><small>Satisfacción media registrada</small><strong>{data.summary.averageSatisfaction.toLocaleString('es-ES', { maximumFractionDigits: 1 })}<small> / 5</small></strong></article><article><small>Devoluciones pendientes</small><strong>{data.summary.pendingReturns}</strong></article><article><small>Acuerdos activos</small><strong>{data.summary.activeAgreements}</strong></article></div><div className="cs-quality-foot"><Star size={16} /><span>La satisfacción se recoge al cerrar expedientes. Los resultados solo resumen puntuaciones reales guardadas.</span></div></section><aside className="cs-panel"><header className="cs-section-head"><div><span className="cs-eyebrow">TRAZABILIDAD OPERATIVA</span><h2>Distribución de casos</h2></div></header><div className="cs-distribution">{Object.entries(statusNames).slice(0,8).map(([status,label]) => { const count = cases.filter((item) => item.status === status).length; return <div key={status}><span>{label}</span><b>{count}</b><i style={{ transform: `scaleX(${cases.length ? count / cases.length : 0})` }} /></div>})}</div><div className="cs-quality-foot"><Activity size={16} /><span>Las filas reflejan el estado actual de expedientes recibidos del servidor; no se generan datos de muestra.</span></div></aside></div>}
        </div>
      </>}
    </>}
  </main>;
}

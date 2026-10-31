import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPurchaseRequestQueryKey, getListPurchaseEventsQueryKey, getListPurchaseOffersQueryKey,
  getListPurchaseOrdersQueryKey, getListPurchaseRequestsQueryKey,
  getListFp360ProductsQueryKey, getListPurchaseReceiptsQueryKey, getListPurchaseInvoicesQueryKey,
  getListPurchaseSupplierAnalysisQueryKey, useListPurchaseReceipts, useRecordPurchaseReceipt,
  useListPurchaseInvoices, useCreatePurchaseInvoice, useDecidePurchaseInvoice,
  useListPurchaseSupplierAnalysis, useAwardPurchaseOrder, useCancelPurchaseRequest,
  useCreatePurchaseOffer, useCreatePurchaseRequest, useDecidePurchaseRequest,
  useGetCurrentIdentity, useGetPurchaseRequest, useListFp360Organizations,
  useListFp360Products, useListPurchaseEvents, useListPurchaseOffers,
  useListPurchaseOrders, useListPurchaseRequests, useReviewPurchaseRequest,
  useSubmitPurchaseRequest,
} from '@workspace/api-client-react';
import type {
  Fp360Organization, Fp360Product, PurchaseInvoice, PurchaseInvoiceInput,
  PurchaseOffer, PurchaseOrder, PurchaseReceipt, PurchaseReceiptInput,
  PurchaseRequest, PurchaseRequestSummary, PurchaseSupplierMetric,
} from '@workspace/api-client-react';
import {
  AlertTriangle, ArrowRight, BadgeCheck, Building2, Check, ChevronRight, CircleHelp,
  ClipboardList, Clock3, FileCheck2, FileText, History, Package, Plus, RefreshCw,
  ShieldAlert, ShoppingCart, SlidersHorizontal, Truck, X, ReceiptText, ChartNoAxesCombined,
  PackageCheck, CircleCheck,
} from 'lucide-react';
import { MasterDialog, ReadOnlyBanner, apiErrorMessage, eurosToCents, WRITE_ROLES } from './master-shared';
import './purchases.css';

type Section = 'requests' | 'comparison' | 'orders' | 'receipts' | 'invoices' | 'suppliers';
const statusText: Record<string, string> = {
  draft: 'Borrador', requested: 'Solicitada', pending_approval: 'Pendiente de aprobación',
  approved: 'Aprobada', rejected: 'Rechazada', ordered: 'Pedido emitido',
  partial: 'Parcialmente recibido', received: 'Recibido',
  cancelled: 'Cancelada', low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente',
};
const dateText = (v?: string | null) => v ? (Number.isNaN(new Date(v).getTime()) ? v : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(v))) : 'Sin fecha';
const money = (n: number) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n / 100);
const percent = (n: number) => `${(n / 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;
const opId = () => crypto.randomUUID();

export function PurchasesPage({ onNotice }: { onNotice: (message: string) => void }) {
  const qc = useQueryClient();
  const identity = useGetCurrentIdentity();
  const requestsQ = useListPurchaseRequests();
  const orgQ = useListFp360Organizations();
  const productsQ = useListFp360Products();
  const role = identity.data?.role ?? '';
  const canTeacher = role === 'teacher' || role === 'administrator';
  const currentOrganization = (orgQ.data ?? []).find((org) => org.id === identity.data?.organizationId);
  const isSellerOnly = Boolean(identity.data?.organizationId) && !canTeacher && currentOrganization?.role !== 'buyer' && currentOrganization?.role !== 'both';
  const canViewBuying = !isSellerOnly && (canTeacher || currentOrganization?.role === 'buyer' || currentOrganization?.role === 'both');
  const ordersQ = useListPurchaseOrders({ query: { queryKey: getListPurchaseOrdersQueryKey(), enabled: canViewBuying, refetchOnMount: 'always' } });
  const receiptsQ = useListPurchaseReceipts({ query: { queryKey: getListPurchaseReceiptsQueryKey(), enabled: canViewBuying, refetchOnMount: 'always' } });
  const invoicesQ = useListPurchaseInvoices({ query: { queryKey: getListPurchaseInvoicesQueryKey(), enabled: canViewBuying, refetchOnMount: 'always' } });
  const supplierAnalysisQ = useListPurchaseSupplierAnalysis({ query: { queryKey: getListPurchaseSupplierAnalysisQueryKey(), enabled: canViewBuying, refetchOnMount: 'always' } });
  const [section, setSection] = useState<Section>('requests');
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [newRequest, setNewRequest] = useState(false);
  const [marketPrefill, setMarketPrefill] = useState<{ productId?: string; supplierId?: string } | null>(null);
  const [quoteTarget, setQuoteTarget] = useState<PurchaseRequestSummary | null>(null);
  const [transition, setTransition] = useState<{ request: PurchaseRequestSummary; action: 'submit' | 'review' | 'decision' | 'cancel' | 'award'; offer?: PurchaseOffer } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!canViewBuying) return;
    if (section === 'receipts') { void ordersQ.refetch(); void receiptsQ.refetch(); }
    if (section === 'invoices') { void ordersQ.refetch(); void receiptsQ.refetch(); void invoicesQ.refetch(); }
    if (section === 'suppliers') void supplierAnalysisQ.refetch();
  }, [section, canViewBuying, ordersQ.refetch, receiptsQ.refetch, invoicesQ.refetch, supplierAnalysisQ.refetch]);
  const canCreate = WRITE_ROLES.includes(role) && Boolean(identity.data?.organizationId) && (currentOrganization?.role === 'buyer' || currentOrganization?.role === 'both');
  const readOnly = ['mentor', 'promoter'].includes(role) || !identity.data;
  useEffect(() => {
    if (!canCreate) return;
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('marketProduct') || undefined;
    const supplierId = params.get('marketSupplier') || undefined;
    if (!productId && !supplierId) return;
    setMarketPrefill({ productId, supplierId });
    setError('');
    setNewRequest(true);
    window.history.replaceState(window.history.state, '', window.location.pathname);
  }, [canCreate]);
  const requests = requestsQ.data ?? [];
  const filtered = requests.filter((r) => `${r.requestNumber} ${r.organizationName} ${r.department} ${statusText[r.status]}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  const selectedSummary = requests.find((r) => r.id === selectedId) ?? filtered[0] ?? requests[0];
  const reqQuery = useGetPurchaseRequest(selectedSummary?.id ?? '', { query: { queryKey: getGetPurchaseRequestQueryKey(selectedSummary?.id ?? ''), enabled: Boolean(selectedSummary?.id) } });
  const offersQ = useListPurchaseOffers(selectedSummary?.id ?? '', { query: { queryKey: getListPurchaseOffersQueryKey(selectedSummary?.id ?? ''), enabled: Boolean(selectedSummary?.id) } });
  const eventsQ = useListPurchaseEvents(selectedSummary?.id ?? '', { query: { queryKey: getListPurchaseEventsQueryKey(selectedSummary?.id ?? ''), enabled: Boolean(selectedSummary?.id) } });
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: getListPurchaseRequestsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListPurchaseOrdersQueryKey() });
    void qc.invalidateQueries({ queryKey: getListFp360ProductsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListPurchaseReceiptsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListPurchaseInvoicesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListPurchaseSupplierAnalysisQueryKey() });
    if (id) {
      void qc.invalidateQueries({ queryKey: getGetPurchaseRequestQueryKey(id) });
      void qc.invalidateQueries({ queryKey: getListPurchaseOffersQueryKey(id) });
      void qc.invalidateQueries({ queryKey: getListPurchaseEventsQueryKey(id) });
    }
  };
  const offers = offersQ.data ?? [];
  const selected = reqQuery.data;
  const visibleOffers = canViewBuying ? offers : offers.filter((offer) => offer.supplierOrganizationId === identity.data?.organizationId);
  const issueOrder = (offer: PurchaseOffer) => setTransition({ request: selectedSummary!, action: 'award', offer });
  const showDetail = (r: PurchaseRequestSummary) => { setSelectedId(r.id); setSection('comparison'); };
  const tabs: { id: Section; label: string; icon: typeof ClipboardList }[] = [
    { id: 'requests', label: 'Solicitudes', icon: ClipboardList },
    { id: 'comparison', label: 'Comparativa de ofertas', icon: SlidersHorizontal },
    ...(canViewBuying ? [{ id: 'orders' as const, label: 'Pedidos emitidos', icon: FileCheck2 }] : []),
    ...(canViewBuying ? [{ id: 'receipts' as const, label: 'Recepciones', icon: PackageCheck }] : []),
    ...(canViewBuying ? [{ id: 'invoices' as const, label: 'Facturas recibidas', icon: ReceiptText }] : []),
    ...(canViewBuying ? [{ id: 'suppliers' as const, label: 'Proveedores y análisis', icon: ChartNoAxesCombined }] : []),
  ];

  return <main className="page-content purchases-page page-enter">
    <div className="page-heading"><div className="breadcrumbs"><span>RED FP360</span><span className="crumb-slash">/</span><span>APROVISIONAMIENTO</span></div>
      <div className="heading-row"><div><h1>Compras y aprovisionamiento</h1><p>Solicita, compara y aprueba compras para la empresa simulada.</p></div>
        {canCreate && <button className="button button-primary" onClick={() => { setError(''); setMarketPrefill(null); setNewRequest(true); }} data-testid="button-new-purchase"><Plus size={15} /> Nueva solicitud</button>}
      </div>
    </div>
    <div className="purchase-disclaimer"><ShieldAlert size={16} /><span><b>Entorno educativo simulado.</b> No se contacta con proveedores, no hay transacciones financieras y emitir un pedido no modifica existencias.</span></div>
    {readOnly && identity.data && <ReadOnlyBanner text="Tu perfil puede consultar compras, pero no crear solicitudes ni avanzar el flujo." />}
    <div className="purchase-metrics">
      <div className="purchase-metric pm-red" data-testid="metric-open-purchase-requests"><span className="pm-icon"><ClipboardList size={17} /></span><small>Solicitudes abiertas</small><strong>{requestsQ.isLoading ? '…' : requests.filter((r) => ['requested', 'pending_approval'].includes(r.status)).length}</strong><span className="pm-caption">En revisión o esperando ofertas</span></div>
      <div className="purchase-metric pm-blue" data-testid="metric-purchase-offers"><span className="pm-icon"><ShoppingCart size={17} /></span><small>Ofertas recibidas</small><strong>{isSellerOnly ? '—' : requestsQ.isLoading ? '…' : requests.reduce((s, r) => s + r.offerCount, 0)}</strong><span className="pm-caption">{isSellerOnly ? 'El resto de propuestas es confidencial' : 'Propuestas de proveedores invitados'}</span></div>
      <div className="purchase-metric pm-teal" data-testid="metric-purchase-orders"><span className="pm-icon"><FileCheck2 size={17} /></span><small>Pedidos emitidos</small><strong>{canViewBuying ? ordersQ.isLoading ? '…' : ordersQ.data?.length ?? 0 : '—'}</strong><span className="pm-caption">Instantáneas inmutables de compra</span></div>
      <div className="purchase-metric pm-gold" data-testid="metric-committed-purchase-total"><span className="pm-icon"><BanknoteIcon /></span><small>Importe comprometido</small><strong>{canViewBuying ? ordersQ.isLoading ? '…' : money((ordersQ.data ?? []).reduce((s, o) => s + o.totalCents, 0)) : '—'}</strong><span className="pm-caption">Total simulado con IGIC y portes</span></div>
    </div>
    <section className="purchase-workspace">
      <div className="purchase-work-toolbar">
        <div className="purchase-tabs" role="tablist" aria-label="Secciones de compras">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={section === id ? 'active' : ''} role="tab" aria-selected={section === id} onClick={() => setSection(id)} data-testid={`tab-purchase-${id}`}><Icon size={15} />{label}{id === 'orders' && <span>{ordersQ.data?.length ?? 0}</span>}</button>)}</div>
        <label className="purchase-search"><span className="sr-only">Buscar solicitudes</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar solicitud, empresa…" data-testid="input-purchase-search" /><button aria-label="Actualizar compras" type="button" onClick={() => refresh(selectedSummary?.id)}><RefreshCw size={15} /></button></label>
      </div>
      {section === 'requests' && <section className="purchase-list-panel">
        <div className="purchase-section-heading"><div><h2>Solicitudes de compra</h2><p>Flujo de adquisición · trazabilidad por solicitud</p></div><span className="purchase-count">{filtered.length} registros</span></div>
        <PurchaseData loading={requestsQ.isLoading} error={requestsQ.isError} retry={() => void requestsQ.refetch()} title="solicitudes" />
        {!requestsQ.isLoading && !requestsQ.isError && <div className="purchase-table-wrap"><table className="purchase-table"><thead><tr><th>N.º solicitud</th><th>Departamento</th><th>Fecha límite</th><th>Ofertas</th><th>Presupuesto máx.</th><th>Estado</th><th /></tr></thead><tbody>
          {filtered.map((r) => <tr key={r.id} data-testid={`row-purchase-request-${r.id}`} onClick={() => showDetail(r)} className={selectedSummary?.id === r.id ? 'is-selected' : ''} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') showDetail(r); }}>
            <td><div className="purchase-ref"><span className="pr-icon"><FileText size={16} /></span><span><b>{r.requestNumber}</b><small>{r.organizationName}</small></span></div></td><td>{r.department}</td><td>{dateText(r.deadline)}</td><td>{isSellerOnly ? <span className="muted-inline">Privado</span> : <><b>{r.offerCount}</b><span className="muted-inline"> / 2 mín.</span></>}</td><td className="money-cell">{money(r.budgetCapCents)}</td><td><PurchaseStatus status={r.status} /></td><td><button className="purchase-row-arrow" aria-label={`Abrir ${r.requestNumber}`} onClick={(e) => { e.stopPropagation(); showDetail(r); }}><ChevronRight size={16} /></button></td>
          </tr>)}
          {!filtered.length && <tr><td colSpan={7}><PurchaseEmpty title={requests.length ? 'Sin solicitudes coincidentes' : 'Empieza con una necesidad de compra'} detail={requests.length ? 'Prueba con otro término de búsqueda.' : 'Registra una solicitud con artículos, presupuesto y al menos dos proveedores invitados.'} icon={ShoppingCart} /></td></tr>}
        </tbody></table></div>}
        <div className="purchase-table-foot"><span>Datos persistidos · actualizados desde el servidor</span><span><ShieldAlert size={13} /> Importes y decisiones de prácticas</span></div>
      </section>}
      {section === 'comparison' && <div className="purchase-comparison-layout">
        <section className="purchase-list-panel comparison-main">
          <div className="purchase-section-heading"><div><h2>Comparativa de ofertas</h2><p>Revisa precio total, plazo, calidad y condiciones de pago.</p></div>
            {selectedSummary && !readOnly && <button className="button button-quiet" onClick={() => setQuoteTarget(selectedSummary)} disabled={!canTeacher && !selected?.requestedSuppliers.some((s) => s.id === identity.data?.organizationId)} data-testid="button-add-purchase-offer"><Plus size={14} /> Registrar oferta</button>}
          </div>
          {selectedSummary ? <><div className="comparison-request-strip"><div><small>Solicitud seleccionada</small><strong>{selected?.requestNumber ?? selectedSummary.requestNumber}</strong><span>{selected?.purpose ?? selectedSummary.department}</span></div><div className="strip-budget"><small>Presupuesto máximo</small><b>{money(selected?.budgetCapCents ?? selectedSummary.budgetCapCents)}</b></div><div className="strip-deadline"><small>Entrega solicitada</small><b>{dateText(selected?.deadline ?? selectedSummary.deadline)}</b></div></div>
            <PurchaseData loading={reqQuery.isLoading || offersQ.isLoading} error={reqQuery.isError || offersQ.isError} retry={() => { void reqQuery.refetch(); void offersQ.refetch(); }} title="ofertas" />
            {!reqQuery.isLoading && !offersQ.isLoading && !reqQuery.isError && !offersQ.isError && <OffersTable offers={visibleOffers} request={selected} canAward={canCreate && !isSellerOnly} status={selected?.status ?? selectedSummary.status} onAward={issueOrder} />}
            <div className="score-explainer"><CircleHelp size={16} /><div><b>Puntuación comparativa simulada</b><p>Precio 40% · plazo de entrega 25% · calidad 20% · condiciones de pago 15%. El cálculo orienta el análisis; la elección debe justificarse y respetar el presupuesto con IGIC y portes.</p></div></div>
          </> : <PurchaseEmpty title="Selecciona una solicitud" detail="Elige una solicitud de la lista para revisar sus ofertas." icon={SlidersHorizontal} />}
        </section>
        <aside className="purchase-detail-column">
          <section className="purchase-list-panel purchase-detail-card"><div className="purchase-section-heading"><div><h2>Detalle de solicitud</h2><p>Datos y artículos de la necesidad</p></div>{selected && <PurchaseStatus status={selected.status} />}</div>
            {selected ? <><div className="request-summary-meta"><div><small>Organización compradora</small><b>{selected.organizationName}</b></div><div><small>Departamento</small><b>{selected.department}</b></div><div><small>Prioridad</small><b className={`urgency-${selected.urgency}`}>{statusText[selected.urgency]}</b></div><div><small>Presupuesto</small><b>{money(selected.budgetCapCents)}</b></div></div>
              <p className="request-purpose">{selected.purpose}</p>
              <div className="detail-lines-heading"><b>Artículos solicitados</b><span>{selected.lines.length} líneas</span></div>
              <div className="purchase-lines">{selected.lines.map((line) => <div className="purchase-line" key={line.id}><span className="line-mark"><Package size={14} /></span><div><b>{line.productName}</b><small>{line.sku} · {line.quantity} uds.</small><small>{line.justification}</small></div></div>)}</div>
              {selected.awardedReason && <div className="detail-reason"><small>Justificación de adjudicación</small><p>{selected.awardedReason}</p></div>}
              {selected.decisionReason && <div className="detail-reason"><small>Decisión docente</small><p>{selected.decisionReason}</p></div>}
            </> : reqQuery.isLoading ? <div className="purchase-skeleton"><i /><i /><i /></div> : <PurchaseEmpty title="Sin detalle disponible" detail="Selecciona una solicitud activa." icon={FileText} />}
          </section>
          <section className="purchase-list-panel history-card"><div className="purchase-section-heading"><div><h2>Historial de aprobación</h2><p>Registro de actividad · fecha simulada</p></div><History size={16} /></div>
            {eventsQ.isLoading && <div className="purchase-skeleton"><i /><i /></div>}
            {eventsQ.isError && <PurchaseData loading={false} error retry={() => void eventsQ.refetch()} title="el historial" />}
            {!!eventsQ.data?.length && <div className="purchase-timeline">{eventsQ.data.map((ev) => <article key={ev.id}><span className="timeline-check"><Check size={12} /></span><div><b>{ev.action}</b><p>{ev.reason}</p><small>{roleLabel(ev.actorRole)} · {dateText(ev.simulatedDate)}</small></div></article>)}</div>}
            {!eventsQ.isLoading && !eventsQ.isError && !eventsQ.data?.length && <p className="history-empty">Las transiciones justificadas aparecerán aquí.</p>}
          </section>
          {selectedSummary && <WorkflowActions request={selectedSummary} fullRequest={selected} offers={visibleOffers} role={role} readOnly={readOnly} canCreate={canCreate && !isSellerOnly} canTeacher={canTeacher} onAction={(action, offer) => { setError(''); setTransition({ request: selectedSummary, action, offer }); }} />}
        </aside>
      </div>}
      {section === 'orders' && canViewBuying && <PurchaseOrders />}
      {section === 'receipts' && canViewBuying && <ReceiptsSection orders={ordersQ.data ?? []} ordersLoading={ordersQ.isLoading} ordersError={ordersQ.isError} retryOrders={() => void ordersQ.refetch()} receipts={receiptsQ.data ?? []} receiptsLoading={receiptsQ.isLoading} receiptsError={receiptsQ.isError} retryReceipts={() => void receiptsQ.refetch()} canRecord={canCreate && !isSellerOnly} onNotice={onNotice} />}
      {section === 'invoices' && canViewBuying && <InvoicesSection orders={ordersQ.data ?? []} ordersLoading={ordersQ.isLoading} ordersError={ordersQ.isError} retryOrders={() => void ordersQ.refetch()} receipts={receiptsQ.data ?? []} receiptsLoading={receiptsQ.isLoading} receiptsError={receiptsQ.isError} retryReceipts={() => void receiptsQ.refetch()} invoices={invoicesQ.data ?? []} invoicesLoading={invoicesQ.isLoading} invoicesError={invoicesQ.isError} retryInvoices={() => void invoicesQ.refetch()} canRegister={canCreate && !isSellerOnly} canDecide={canTeacher || (role === 'team_manager' && (currentOrganization?.role === 'buyer' || currentOrganization?.role === 'both'))} onNotice={onNotice} />}
      {section === 'suppliers' && canViewBuying && <SupplierAnalysisSection metrics={supplierAnalysisQ.data ?? []} loading={supplierAnalysisQ.isLoading} error={supplierAnalysisQ.isError} retry={() => void supplierAnalysisQ.refetch()} />}
    </section>
    {newRequest && <RequestForm organizations={orgQ.data ?? []} products={productsQ.data ?? []} organizationId={identity.data?.organizationId ?? ''} initialProductId={marketPrefill?.productId} initialSupplierId={marketPrefill?.supplierId} close={() => { setNewRequest(false); setMarketPrefill(null); }} onSaved={(request) => { setNewRequest(false); setMarketPrefill(null); refresh(request.id); setSelectedId(request.id); setSection('comparison'); onNotice(`Solicitud ${request.requestNumber} creada como borrador.`); }} />}
    {quoteTarget && <OfferForm request={selected} summary={quoteTarget} organizations={orgQ.data ?? []} role={role} organizationId={identity.data?.organizationId ?? ''} close={() => setQuoteTarget(null)} onSaved={() => { setQuoteTarget(null); refresh(quoteTarget.id); onNotice('Oferta simulada registrada.'); }} />}
    {transition && <TransitionDialog target={transition} offers={offers} pending={false} error={error} setError={setError} close={() => setTransition(null)} onSuccess={(message) => { const id = transition.request.id; setTransition(null); refresh(id); onNotice(message); }} />}
  </main>;

  function BanknoteIcon() { return <span className="money-glyph">€</span>; }
}

function WorkflowActions({ request, fullRequest, offers, role, readOnly, canCreate, canTeacher, onAction }: {
  request: PurchaseRequestSummary; fullRequest?: PurchaseRequest; offers: PurchaseOffer[]; role: string;
  readOnly: boolean; canCreate: boolean; canTeacher: boolean; onAction: (action: 'submit' | 'review' | 'decision' | 'cancel' | 'award', offer?: PurchaseOffer) => void;
}) {
  const minCompleteOffers = offers.length >= 2;
  return <section className="purchase-actions-panel">
    <div className="workflow-caption"><span>PRÓXIMO PASO</span><b>{request.status === 'draft' ? 'Solicitar ofertas' : request.status === 'requested' ? 'Revisión docente' : request.status === 'pending_approval' ? 'Decisión docente' : request.status === 'approved' ? 'Emitir pedido' : 'Flujo cerrado'}</b></div>
    {request.status === 'draft' && <button className="button button-primary wide-button" disabled={!canCreate || readOnly} onClick={() => onAction('submit')}><ArrowRight size={15} /> Enviar a proveedores invitados</button>}
    {request.status === 'requested' && <button className="button button-primary wide-button" disabled={!canTeacher} onClick={() => onAction('review')}><BadgeCheck size={15} /> Enviar a aprobación docente</button>}
    {request.status === 'pending_approval' && canTeacher && <><div className="approval-readiness"><span className={minCompleteOffers ? 'ready' : 'waiting'}>{minCompleteOffers ? <Check size={14} /> : <Clock3 size={14} />}</span><span><b>{offers.length} de 2 ofertas mínimas</b><small>{minCompleteOffers ? 'Hay suficiente información para decidir.' : 'Registra dos ofertas completas antes de aprobar.'}</small></span></div><button className="button button-primary wide-button" disabled={!minCompleteOffers} onClick={() => onAction('decision')}><BadgeCheck size={15} /> Aprobar o rechazar</button></>}
    {request.status === 'approved' && <button className="button button-primary wide-button" disabled={!canCreate || readOnly} onClick={() => onAction('award')}><FileCheck2 size={15} /> Emitir pedido de compra</button>}
    {['draft', 'requested', 'pending_approval'].includes(request.status) && <button className="workflow-cancel" disabled={!canCreate || readOnly} onClick={() => onAction('cancel')}>Cancelar solicitud</button>}
    {!['draft', 'requested', 'pending_approval', 'approved'].includes(request.status) && <p className="workflow-closed">No hay acciones pendientes para esta solicitud.</p>}
    {role === 'mentor' || role === 'promoter' ? <p className="workflow-readonly">Perfil de consulta: las acciones están deshabilitadas.</p> : null}
    {fullRequest?.status === 'approved' && offers.length === 0 && <p className="workflow-readonly">No se puede emitir pedido sin una oferta adjudicable.</p>}
  </section>;
}

function TransitionDialog({ target, offers, pending, error, setError, close, onSuccess }: {
  target: { request: PurchaseRequestSummary; action: 'submit' | 'review' | 'decision' | 'cancel' | 'award'; offer?: PurchaseOffer };
  offers: PurchaseOffer[]; pending: boolean; error: string; setError: (v: string) => void; close: () => void; onSuccess: (message: string) => void;
}) {
  const qc = useQueryClient();
  const submit = useSubmitPurchaseRequest(); const review = useReviewPurchaseRequest();
  const decision = useDecidePurchaseRequest(); const award = useAwardPurchaseOrder(); const cancel = useCancelPurchaseRequest();
  const [reason, setReason] = useState('');
  const [decisionValue, setDecisionValue] = useState<'approved' | 'rejected'>('approved');
  const [offerId, setOfferId] = useState(target.offer?.id ?? offers[0]?.id ?? '');
  const [localError, setLocalError] = useState('');
  const actualPending = pending || submit.isPending || review.isPending || decision.isPending || award.isPending || cancel.isPending;
  const labels = { submit: 'Enviar solicitud', review: 'Solicitar aprobación docente', decision: 'Registrar decisión docente', cancel: 'Cancelar solicitud', award: 'Emitir pedido simulado' };
  const title = labels[target.action];
  const execute = (e: FormEvent) => {
    e.preventDefault(); setLocalError('');
    if (reason.trim().length < 5) return setLocalError('La justificación debe incluir al menos 5 caracteres.');
    const id = target.request.id;
    const onOk = () => {
      invalidatePurchaseWorkflow(qc, id);
      void qc.invalidateQueries({ queryKey: getListPurchaseOffersQueryKey(id) });
      onSuccess(`${title} · registrada en el historial simulado.`);
    };
    const onFail = (err: unknown) => setError(apiErrorMessage(err, 'No se pudo completar la transición. Revisa permisos y requisitos del flujo.'));
    const data = { reason: reason.trim() };
    if (target.action === 'submit') submit.mutate({ id, data }, { onSuccess: onOk, onError: onFail });
    if (target.action === 'review') review.mutate({ id, data }, { onSuccess: onOk, onError: onFail });
    if (target.action === 'decision') decision.mutate({ id, data: { ...data, decision: decisionValue } }, { onSuccess: onOk, onError: onFail });
    if (target.action === 'cancel') cancel.mutate({ id, data }, { onSuccess: onOk, onError: onFail });
    if (target.action === 'award') {
      if (!offerId) return setLocalError('Selecciona una oferta para emitir el pedido.');
      award.mutate({ id, data: { ...data, offerId } }, { onSuccess: onOk, onError: onFail });
    }
  };
  return <MasterDialog title={title} onClose={close}>
    <form className="form-stack" onSubmit={execute}>
      <p className="form-intro">Solicitud <b>{target.request.requestNumber}</b>. La transición quedará registrada con tu justificación y fecha simulada.</p>
      {target.action === 'decision' && <label>Decisión<select value={decisionValue} onChange={(e) => setDecisionValue(e.target.value as 'approved' | 'rejected')}><option value="approved">Aprobar solicitud</option><option value="rejected">Rechazar solicitud</option></select></label>}
      {target.action === 'award' && <><label>Oferta adjudicada<select required value={offerId} onChange={(e) => setOfferId(e.target.value)}><option value="">Selecciona oferta</option>{offers.map((o) => <option key={o.id} value={o.id}>{o.supplierName} · {money(o.totalCents)}</option>)}</select></label><p className="form-hint">El importe debe respetar el presupuesto máximo con IGIC y portes incluidos.</p></>}
      <label>Justificación<input minLength={5} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explica el motivo de esta decisión…" /></label>
      {(error || localError) && <div className="purchase-error" role="alert"><AlertTriangle size={15} />{localError || error}</div>}
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={close}>Volver</button><button className="button button-primary" disabled={actualPending}>{actualPending ? 'Registrando…' : title}</button></div>
    </form>
  </MasterDialog>;
}

function RequestForm({ organizations, products, organizationId, initialProductId, initialSupplierId, close, onSaved }: {
  organizations: Fp360Organization[];
  products: Fp360Product[];
  organizationId: string; initialProductId?: string; initialSupplierId?: string;
  close: () => void; onSaved: (r: PurchaseRequest) => void;
}) {
  const create = useCreatePurchaseRequest();
  const [operationId] = useState(opId);
  const [department, setDepartment] = useState(''); const [urgency, setUrgency] = useState<'low' | 'normal' | 'high' | 'urgent'>('normal');
  const [deadline, setDeadline] = useState(''); const [budget, setBudget] = useState(''); const [purpose, setPurpose] = useState('');
  const [supplierIds, setSupplierIds] = useState<string[]>(() => initialSupplierId ? [initialSupplierId] : []);
  const [lineProduct, setLineProduct] = useState(initialProductId ?? '');
  const [quantity, setQuantity] = useState('1'); const [justification, setJustification] = useState('');
  const [lines, setLines] = useState<{ productId: string; quantity: number; justification: string }[]>([]);
  const [error, setError] = useState('');
  const buyers = organizations.filter((o) => o.isActive && (o.role === 'buyer' || o.role === 'both'));
  const suppliers = organizations.filter((o) => o.isActive && (o.role === 'seller' || o.role === 'both'));
  const usableProducts = products.filter((p) => p.isActive && p.isPublished);
  useEffect(() => {
    if (!initialSupplierId || !organizations.length || organizations.some((organization) => organization.id === initialSupplierId && organization.isActive && (organization.role === 'seller' || organization.role === 'both'))) return;
    setSupplierIds((current) => current.includes(initialSupplierId) ? current.filter((id) => id !== initialSupplierId) : current);
  }, [initialSupplierId, organizations]);
  useEffect(() => {
    if (!initialProductId || !products.length || products.some((product) => product.id === initialProductId && product.isActive && product.isPublished)) return;
    setLineProduct((current) => current === initialProductId ? '' : current);
  }, [initialProductId, products]);
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    const cap = eurosToCents(budget);
    if (!buyers.some((o) => o.id === organizationId)) return setError('Tu organización no está habilitada como compradora.');
    if (supplierIds.length < 2) return setError('Invita al menos dos proveedores.');
    if (!lines.length) return setError('Añade al menos un artículo y su justificación.');
    if (cap === null || cap < 1) return setError('Indica un presupuesto válido en euros.');
    create.mutate({ data: { operationId, organizationId, department: department.trim(), urgency, deadline: deadline || null, budgetCapCents: cap, purpose: purpose.trim(), requestedSupplierIds: supplierIds, lines } }, {
      onSuccess: onSaved, onError: (err) => setError(apiErrorMessage(err, 'No se pudo crear la solicitud. Revisa los campos.')),
    });
  };
  const addLine = () => {
    if (!lineProduct || Number(quantity) < 1 || justification.trim().length < 5) return setError('Completa artículo, unidades y una justificación de 5 caracteres o más.');
    setLines([...lines, { productId: lineProduct, quantity: Number(quantity), justification: justification.trim() }]);
    setLineProduct(''); setQuantity('1'); setJustification(''); setError('');
  };
  return <MasterDialog title="Nueva solicitud de compra" onClose={close} wide>
    <form className="form-stack purchase-form" onSubmit={submit}>
      <p className="form-intro">Registra una necesidad de compra para tu empresa. Selecciona proveedores de la red para que puedan presentar una oferta simulada.</p>
      {(initialProductId || initialSupplierId) && <p className="form-hint">Selección iniciada desde Mercado FP360. Añade al menos un segundo proveedor para comparar ofertas y revisa el artículo antes de añadirlo.</p>}
      <div className="purchase-form-grid">
        <label>Departamento<input required minLength={2} maxLength={100} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="p. ej. Taller de informática" /></label>
        <label>Urgencia<select value={urgency} onChange={(e) => setUrgency(e.target.value as typeof urgency)}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
        <label>Fecha límite de entrega<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
        <label>Presupuesto máximo · euros<input required inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0,00" /></label>
      </div>
      <label>Finalidad de la compra<textarea required minLength={5} maxLength={500} rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Describe la necesidad de la empresa simulada" /></label>
      <fieldset className="supplier-fieldset"><legend>Proveedores invitados <small>Selecciona entre 2 y 5</small></legend><div className="supplier-picker">{suppliers.map((s) => <label key={s.id} className={supplierIds.includes(s.id) ? 'supplier-option selected' : 'supplier-option'}><input type="checkbox" checked={supplierIds.includes(s.id)} disabled={!supplierIds.includes(s.id) && supplierIds.length >= 5} onChange={(e) => setSupplierIds(e.target.checked ? [...supplierIds, s.id] : supplierIds.filter((id) => id !== s.id))} /><span><Building2 size={14} /><b>{s.name}</b><small>{s.island}</small></span></label>)}{!suppliers.length && <p>No hay proveedores activos disponibles en la red.</p>}</div></fieldset>
      <fieldset className="purchase-line-editor"><legend>Artículos solicitados</legend><div className="purchase-line-inputs"><label>Producto<select value={lineProduct} onChange={(e) => setLineProduct(e.target.value)}><option value="">Selecciona artículo</option>{usableProducts.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.sku}</option>)}</select></label><label>Unidades<input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label><label className="line-justification">Justificación<input minLength={5} value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Motivo de esta línea" /></label><button type="button" className="button button-quiet" onClick={addLine}><Plus size={14} /> Añadir</button></div>
        {!!lines.length && <div className="added-lines">{lines.map((line, i) => <div key={`${line.productId}-${i}`}><span>{products.find((p) => p.id === line.productId)?.name ?? 'Producto'} <small>× {line.quantity} · {line.justification}</small></span><button type="button" aria-label="Quitar artículo" onClick={() => setLines(lines.filter((_, index) => index !== i))}><X size={14} /></button></div>)}</div>}
      </fieldset>
      {error && <div className="purchase-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      <p className="form-hint">La creación guarda un borrador. El envío, aprobación y pedido requieren justificación en cada paso.</p>
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={close}>Cancelar</button><button className="button button-primary" disabled={create.isPending || suppliers.length < 2 || usableProducts.length === 0}>{create.isPending ? 'Guardando…' : 'Crear borrador'}</button></div>
    </form>
  </MasterDialog>;
}

function OfferForm({ request, summary, organizations, role, organizationId, close, onSaved }: {
  request?: PurchaseRequest; summary: PurchaseRequestSummary; organizations: Fp360Organization[];
  role: string; organizationId: string; close: () => void; onSaved: () => void;
}) {
  const create = useCreatePurchaseOffer();
  const [operationId] = useState(opId);
  const [supplier, setSupplier] = useState(''); const [reference, setReference] = useState(''); const [delivery, setDelivery] = useState('5');
  const [payment, setPayment] = useState('30'); const [freight, setFreight] = useState('0'); const [quality, setQuality] = useState('80'); const [validUntil, setValidUntil] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({}); const [error, setError] = useState('');
  const invited = organizations.filter((o) => request?.requestedSuppliers.some((s) => s.id === o.id) && (teacher || o.id === organizationId));
  const teacher = role === 'teacher' || role === 'administrator';
  const submit = (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (!request) return setError('No se han podido cargar los datos de la solicitud.');
    const orgId = supplier || (teacher ? '' : '');
    if (!orgId) return setError('Selecciona un proveedor invitado.');
    const lines = request.lines.map((line) => {
      const cents = eurosToCents(prices[line.id] ?? '');
      return cents === null ? null : { requestLineId: line.id, unitPriceCents: cents, igicBasisPoints: 700 };
    });
    if (lines.some((l) => !l)) return setError('Indica un precio válido para cada artículo.');
    const freightCents = eurosToCents(freight);
    if (freightCents === null) return setError('Indica un importe de portes válido.');
    create.mutate({ id: request.id, data: { operationId, supplierOrganizationId: orgId, quoteReference: reference.trim(), deliveryDays: Number(delivery), paymentDays: Number(payment), freightCents, qualityScoreBasisPoints: Math.round(Number(quality) * 100), validUntil: validUntil || null, lines: lines as { requestLineId: string; unitPriceCents: number; igicBasisPoints: number }[] } }, {
      onSuccess: onSaved, onError: (err) => setError(apiErrorMessage(err, 'No se pudo registrar la oferta. Comprueba que el proveedor está invitado.')),
    });
  };
  return <MasterDialog title={teacher ? 'Oferta simulada por docente' : 'Presentar oferta'} onClose={close} wide>
    <form className="form-stack purchase-form" onSubmit={submit}>
      <p className="form-intro">Solicitud <b>{summary.requestNumber}</b>. Las ofertas quedan registradas en el entorno de prácticas; no se envían a proveedores.</p>
      <div className="purchase-form-grid">
        <label>Proveedor invitado<select required value={supplier} onChange={(e) => setSupplier(e.target.value)}><option value="">Selecciona organización</option>{invited.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.island}</option>)}</select></label>
        <label>Referencia de oferta<input required maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="OF-2027-…" /></label>
        <label>Entrega · días<input type="number" min={1} max={365} value={delivery} onChange={(e) => setDelivery(e.target.value)} /></label>
        <label>Pago · días<input type="number" min={0} max={365} value={payment} onChange={(e) => setPayment(e.target.value)} /></label>
        <label>Portes · euros<input inputMode="decimal" required value={freight} onChange={(e) => setFreight(e.target.value)} /></label>
        <label>Calidad · 0–100<input type="number" min={0} max={100} step="0.01" value={quality} onChange={(e) => setQuality(e.target.value)} /></label>
        <label>Válida hasta<input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></label>
      </div>
      <div className="quote-lines"><b>Precio unitario por artículo</b>{request?.lines.map((line) => <label key={line.id}><span>{line.productName}<small>{line.sku} · {line.quantity} uds. · IGIC 7%</small></span><span className="euro-input"><input required inputMode="decimal" value={prices[line.id] ?? ''} onChange={(e) => setPrices({ ...prices, [line.id]: e.target.value })} placeholder="0,00" aria-label={`Precio unitario de ${line.productName}`} /> €</span></label>)}</div>
      {error && <div className="purchase-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      {!invited.length && <div className="purchase-error" role="status"><AlertTriangle size={15} />No hay proveedores invitados disponibles para presentar oferta.</div>}
      {teacher && <p className="form-hint">Como docente puedes registrar una oferta simulada para apoyar la práctica. Los importes y puntuaciones son ficticios.</p>}
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={close}>Cancelar</button><button className="button button-primary" disabled={create.isPending || !invited.length}>{create.isPending ? 'Registrando…' : 'Registrar oferta simulada'}</button></div>
    </form>
  </MasterDialog>;
}

function OffersTable({ offers, request, canAward, status, onAward }: { offers: PurchaseOffer[]; request?: PurchaseRequest; canAward: boolean; status: string; onAward: (o: PurchaseOffer) => void }) {
  const eligible = (o: PurchaseOffer) => o.totalCents <= (request?.budgetCapCents ?? 0);
  const sorted = useMemo(() => [...offers].sort((a, b) => b.weightedScoreBasisPoints - a.weightedScoreBasisPoints), [offers]);
  if (!offers.length) return <PurchaseEmpty title="Aún no hay ofertas" detail="Los proveedores invitados podrán presentar sus propuestas. Se requieren dos ofertas completas antes de la aprobación docente." icon={Truck} />;
  return <div className="offers-grid">
    {sorted.map((offer, i) => <article className={`offer-card ${i === 0 ? 'offer-best' : ''}`} key={offer.id} data-testid={`card-purchase-offer-${offer.id}`}>
      <div className="offer-top"><div className="offer-company-mark">{offer.supplierName.slice(0, 2).toUpperCase()}</div><div className="offer-name"><b>{offer.supplierName}</b><small>{offer.quoteReference} · {dateText(offer.validUntil)}</small></div>{i === 0 && <span className="offer-recommended">Mayor puntuación</span>}</div>
      <div className="offer-score"><div><small>Puntuación total</small><b>{percent(offer.weightedScoreBasisPoints)}</b></div><span className="score-track"><i style={{ width: `${Math.min(100, offer.weightedScoreBasisPoints / 100)}%` }} /></span></div>
      <div className="offer-stats"><div><small>Total con IGIC</small><b>{money(offer.totalCents)}</b></div><div><small>Entrega</small><b>{offer.deliveryDays} días</b></div><div><small>Pago</small><b>{offer.paymentDays} días</b></div><div><small>Calidad</small><b>{percent(offer.qualityScoreBasisPoints)}</b></div></div>
      <div className="offer-score-breakdown"><span>Precio <b>{percent(offer.priceScoreBasisPoints)}</b></span><span>Plazo <b>{percent(offer.deliveryScoreBasisPoints)}</b></span><span>Pago <b>{percent(offer.termsScoreBasisPoints)}</b></span></div>
      <div className="offer-cost-lines"><span>Base imponible <b>{money(offer.baseCents)}</b></span><span>IGIC <b>{money(offer.igicCents)}</b></span><span>Portes <b>{money(offer.freightCents)}</b></span></div>
      <details className="offer-detail"><summary>Ver artículos y precios</summary>{offer.lines.map((line) => <div key={line.requestLineId}><span>{line.productName} × {line.quantity}</span><b>{money(line.unitPriceCents)} / ud.</b></div>)}</details>
      {!eligible(offer) && <p className="offer-over-budget"><AlertTriangle size={13} />Supera el presupuesto máximo</p>}
      {canAward && status === 'approved' && <button className="button button-primary offer-award" disabled={!eligible(offer)} onClick={() => onAward(offer)}><FileCheck2 size={14} /> Adjudicar y emitir pedido</button>}
    </article>)}
  </div>;
}

function PurchaseOrders() {
  const q = useListPurchaseOrders();
  const [orderId, setOrderId] = useState('');
  const order = q.data?.find((o) => o.id === orderId) ?? q.data?.[0];
  return <div className="orders-layout">
    <section className="purchase-list-panel">
      <div className="purchase-section-heading"><div><h2>Pedidos de compra</h2><p>Pedidos simulados emitidos desde solicitudes aprobadas.</p></div><span className="purchase-count">{q.data?.length ?? 0} pedidos</span></div>
      <PurchaseData loading={q.isLoading} error={q.isError} retry={() => void q.refetch()} title="pedidos" />
      {!q.isLoading && !q.isError && <div className="purchase-table-wrap"><table className="purchase-table"><thead><tr><th>N.º pedido</th><th>Solicitud</th><th>Proveedor</th><th>Fecha prevista</th><th>Total</th><th>Estado</th><th /></tr></thead><tbody>{(q.data ?? []).map((o) => <tr key={o.id} className={order?.id === o.id ? 'is-selected' : ''} onClick={() => setOrderId(o.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOrderId(o.id); }}><td><b className="mono">{o.orderNumber}</b></td><td>{o.requestNumber}</td><td>{o.supplierName}</td><td>{dateText(o.expectedDate)}</td><td className="money-cell">{money(o.totalCents)}</td><td><PurchaseStatus status={o.status} /></td><td><ChevronRight size={15} /></td></tr>)}{!q.data?.length && <tr><td colSpan={7}><PurchaseEmpty title="No hay pedidos emitidos" detail="Los pedidos aparecerán tras aprobar una solicitud y adjudicar una oferta." icon={FileCheck2} /></td></tr>}</tbody></table></div>}
    </section>
    <aside className="purchase-list-panel order-detail">
      <div className="purchase-section-heading"><div><h2>Detalle del pedido</h2><p>Instantánea inmutable · sin cambios de stock</p></div><FileCheck2 size={17} /></div>
      {order ? <><div className="order-title"><small>{order.requestNumber}</small><h3>{order.orderNumber}</h3><PurchaseStatus status={order.status} /></div><div className="order-parties"><div><small>Empresa compradora</small><b>{order.buyerOrganizationName}</b></div><ArrowRight size={15} /><div><small>Proveedor</small><b>{order.supplierName}</b></div></div><div className="purchase-lines">{order.lines.map((line) => <div className="purchase-line" key={line.id}><span className="line-mark"><Package size={14} /></span><div><b>{line.productName}</b><small>{line.sku} · {line.quantity} uds. × {money(line.unitPriceCents)}</small><small>Base {money(line.baseCents)} · IGIC {money(line.igicCents)}</small></div></div>)}</div><div className="order-totals"><span>Base imponible <b>{money(order.baseCents)}</b></span><span>IGIC <b>{money(order.igicCents)}</b></span><span>Portes <b>{money(order.freightCents)}</b></span><strong>Total simulado <b>{money(order.totalCents)}</b></strong></div><div className="detail-reason"><small>Motivo de selección</small><p>{order.awardedReason}</p></div><div className="order-stock-note"><ShieldAlert size={14} /> El pedido no actualiza existencias. La recepción de mercancía será un flujo posterior.</div></> : <PurchaseEmpty title="Selecciona un pedido" detail="El detalle conservará las condiciones y artículos acordados." icon={FileText} />}
    </aside>
  </div>;
}

function invalidatePurchaseWorkflow(qc: ReturnType<typeof useQueryClient>, requestId?: string) {
  const keys: readonly (readonly unknown[])[] = [
    getListPurchaseRequestsQueryKey(), getListPurchaseOrdersQueryKey(),
    getListFp360ProductsQueryKey(),
    getListPurchaseReceiptsQueryKey(), getListPurchaseInvoicesQueryKey(),
    getListPurchaseSupplierAnalysisQueryKey(),
  ];
  for (const key of keys) void qc.invalidateQueries({ queryKey: key });
  if (requestId) {
    void qc.invalidateQueries({ queryKey: getGetPurchaseRequestQueryKey(requestId) });
    void qc.invalidateQueries({ queryKey: getListPurchaseEventsQueryKey(requestId) });
  }
}

function receivedByOrderLine(receipts: PurchaseReceipt[], orderId: string, lineId: string) {
  return receipts.filter((receipt) => receipt.orderId === orderId)
    .flatMap((receipt) => receipt.lines)
    .filter((line) => line.purchaseOrderLineId === lineId)
    .reduce((sum, line) => sum + line.quantityAccepted + line.quantityRejected, 0);
}
function acceptedByOrderLine(receipts: PurchaseReceipt[], orderId: string, lineId: string) {
  return receipts.filter((receipt) => receipt.orderId === orderId)
    .flatMap((receipt) => receipt.lines)
    .filter((line) => line.purchaseOrderLineId === lineId)
    .reduce((sum, line) => sum + line.quantityAccepted, 0);
}
function orderHasRemaining(order: PurchaseOrder, receipts: PurchaseReceipt[]) {
  return order.lines.some((line) => line.quantity > receivedByOrderLine(receipts, order.id, line.id));
}

function ReceiptsSection({ orders, ordersLoading, ordersError, retryOrders, receipts, receiptsLoading, receiptsError, retryReceipts, canRecord, onNotice }: {
  orders: PurchaseOrder[]; ordersLoading: boolean; ordersError: boolean; retryOrders: () => void;
  receipts: PurchaseReceipt[]; receiptsLoading: boolean; receiptsError: boolean; retryReceipts: () => void;
  canRecord: boolean; onNotice: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [target, setTarget] = useState<PurchaseOrder | null>(null);
  const openOrders = orders.filter((order) => orderHasRemaining(order, receipts));
  return <section className="purchase-extended-section" aria-label="Recepciones de compra">
    <div className="purchase-section-heading"><div><h2>Recepciones de mercancía</h2><p>Registra lo aceptado y rechazado frente a cada pedido emitido. Solo las unidades aceptadas se incorporan a existencias.</p></div>{canRecord && <span className="purchase-count">{openOrders.length} pedidos pendientes</span>}</div>
    <div className="receipt-guidance"><PackageCheck size={17} /><span>La recepción puede ser parcial. Indica cantidades por línea y describe cualquier incidencia o rechazo.</span></div>
    <PurchaseData loading={receiptsLoading || ordersLoading} error={receiptsError || ordersError} retry={() => { retryReceipts(); retryOrders(); }} title="pedidos y recepciones" />
    {!receiptsLoading && !receiptsError && !ordersLoading && !ordersError && <div className="purchase-table-wrap"><table className="purchase-table receipt-open-table"><thead><tr><th>Pedido</th><th>Proveedor</th><th>Fecha prevista</th><th>Unidades pendientes</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
      {openOrders.map((order) => {
        const pending = order.lines.reduce((sum, line) => sum + Math.max(0, line.quantity - receivedByOrderLine(receipts, order.id, line.id)), 0);
        return <tr key={order.id} data-testid={`row-receivable-order-${order.id}`}><td><b className="mono">{order.orderNumber}</b><small className="table-secondary">{order.requestNumber}</small></td><td>{order.supplierName}</td><td>{dateText(order.expectedDate)}</td><td><b>{pending}</b> uds.</td><td><PurchaseStatus status={order.status} /></td><td><button className="mini-button mini-button-blue" disabled={!canRecord} onClick={() => setTarget(order)} data-testid={`button-record-receipt-${order.id}`}><PackageCheck size={13} /> Registrar entrega</button></td></tr>;
      })}
      {!openOrders.length && <tr><td colSpan={6}><PurchaseEmpty title="No hay entregas pendientes" detail="Los pedidos con unidades pendientes aparecerán aquí. Una recepción cerrada se conserva en el historial." icon={PackageCheck} /></td></tr>}
    </tbody></table></div>}
    {!ordersLoading && !ordersError && !receiptsLoading && !receiptsError && <div className="purchase-section-heading receipt-history-heading"><div><h2>Historial de recepciones</h2><p>Referencias registradas y cantidades conformes o rechazadas.</p></div><span className="purchase-count">{receipts.length} registros</span></div>}
    {!receiptsLoading && !receiptsError && !ordersLoading && !ordersError && <div className="receipt-record-list">{receipts.map((receipt) => <article className="receipt-record" key={receipt.id} data-testid={`receipt-record-${receipt.id}`}><div className="receipt-record-symbol"><PackageCheck size={16} /></div><div className="receipt-record-main"><b>{receipt.receiptReference}</b><small>{receipt.orderNumber} · {receipt.supplierName}</small></div><div className="receipt-record-units"><span className="accepted-units">Aceptadas <b>{receipt.acceptedUnits}</b></span><span className="rejected-units">Rechazadas <b>{receipt.rejectedUnits}</b></span></div><PurchaseStatus status={receipt.status} /><time>{dateText(receipt.receivedDate)}</time></article>)}
      {!receipts.length && <p className="receipt-empty-history">Todavía no se han registrado entregas.</p>}
    </div>}
    {target && <ReceiptForm order={target} receipts={receipts} close={() => setTarget(null)} onSaved={(receipt) => { setTarget(null); invalidatePurchaseWorkflow(qc, target.requestId); onNotice(`Recepción ${receipt.receiptReference} registrada. Aceptadas: ${receipt.acceptedUnits}; rechazadas: ${receipt.rejectedUnits}.`); }} />}
  </section>;
}

function ReceiptForm({ order, receipts, close, onSaved }: {
  order: PurchaseOrder; receipts: PurchaseReceipt[]; close: () => void; onSaved: (receipt: PurchaseReceipt) => void;
}) {
  const qc = useQueryClient();
  const mutation = useRecordPurchaseReceipt();
  const [operationId] = useState(opId);
  const [reference, setReference] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [values, setValues] = useState<Record<string, { accepted: string; rejected: string; issue: string }>>({});
  const [error, setError] = useState('');
  const remaining = (line: PurchaseOrder['lines'][number]) => Math.max(0, line.quantity - receivedByOrderLine(receipts, order.id, line.id));
  const editableLines = order.lines.filter((line) => remaining(line) > 0);
  const save = (e: FormEvent) => {
    e.preventDefault(); setError('');
    const lines: PurchaseReceiptInput['lines'] = editableLines.map((line) => {
      const v = values[line.id] ?? { accepted: '', rejected: '', issue: '' };
      return { purchaseOrderLineId: line.id, quantityAccepted: Number(v.accepted || 0), quantityRejected: Number(v.rejected || 0), issueReason: v.issue.trim() || null };
    }).filter((line) => line.quantityAccepted + line.quantityRejected > 0);
    if (!lines.length) return setError('Indica al menos una unidad recibida.');
    for (const line of lines) {
      const poLine = editableLines.find((item) => item.id === line.purchaseOrderLineId);
      if (!poLine || line.quantityAccepted + line.quantityRejected > remaining(poLine)) return setError('La cantidad supera las unidades pendientes del pedido.');
      if (line.quantityRejected > 0 && !line.issueReason) return setError('Describe la incidencia de las unidades rechazadas.');
    }
    mutation.mutate({ id: order.id, data: { operationId, receiptReference: reference.trim(), receivedDate, lines } }, {
      onSuccess: (receipt) => { invalidatePurchaseWorkflow(qc, order.requestId); onSaved(receipt); },
      onError: (err) => setError(apiErrorMessage(err, 'No se pudo registrar la recepción. Revisa cantidades y referencia.')),
    });
  };
  return <MasterDialog title={`Registrar recepción · ${order.orderNumber}`} onClose={close} wide>
    <form className="form-stack purchase-form" onSubmit={save}>
      <p className="form-intro">Entrega de <b>{order.supplierName}</b>. El stock solo aumenta por las unidades aceptadas, nunca por las rechazadas.</p>
      <div className="purchase-form-grid"><label>Referencia de albarán<input required maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ALB-…" data-testid="input-receipt-reference" /></label><label>Fecha de recepción<input type="date" required value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} data-testid="input-receipt-date" /></label></div>
      <div className="receipt-line-list"><div className="receipt-line-header"><span>Artículo · pendiente</span><span>Aceptadas</span><span>Rechazadas</span></div>
        {editableLines.map((line) => {
          const v = values[line.id] ?? { accepted: '', rejected: '', issue: '' };
          return <div className="receipt-line-form" key={line.id} data-testid={`receipt-line-${line.id}`}><div className="receipt-line-product"><b>{line.productName}</b><small>{line.sku} · {remaining(line)} uds. por recibir</small></div><label><span className="sr-only">Unidades aceptadas de {line.productName}</span><input aria-label={`Unidades aceptadas de ${line.productName}`} type="number" min={0} max={remaining(line)} value={v.accepted} onChange={(e) => setValues({ ...values, [line.id]: { ...v, accepted: e.target.value } })} data-testid={`input-accepted-${line.id}`} /></label><label><span className="sr-only">Unidades rechazadas de {line.productName}</span><input aria-label={`Unidades rechazadas de ${line.productName}`} type="number" min={0} max={remaining(line)} value={v.rejected} onChange={(e) => setValues({ ...values, [line.id]: { ...v, rejected: e.target.value } })} data-testid={`input-rejected-${line.id}`} /></label>
            {Number(v.rejected) > 0 && <label className="receipt-issue-field">Incidencia de {line.productName}<input required maxLength={500} value={v.issue} onChange={(e) => setValues({ ...values, [line.id]: { ...v, issue: e.target.value } })} placeholder="Describe el daño, faltante o discrepancia" data-testid={`input-receipt-issue-${line.id}`} /></label>}
          </div>;
        })}
      </div>
      {error && <div className="purchase-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={close} data-testid="button-cancel-receipt">Cancelar</button><button className="button button-primary" disabled={mutation.isPending} data-testid="button-save-receipt">{mutation.isPending ? 'Registrando…' : 'Guardar recepción simulada'}</button></div>
    </form>
  </MasterDialog>;
}

const invoiceStatusText: Record<string, string> = {
  pending_review: 'Pendiente de revisión', conformed: 'Conforme', blocked: 'Bloqueada',
  correction_requested: 'Rectificación solicitada', rectified: 'Rectificada',
};
function InvoiceStatus({ status }: { status: string }) {
  const tone = status === 'conformed' || status === 'rectified' ? 'status-approved' : status === 'blocked' ? 'status-closed' : status === 'correction_requested' ? 'status-waiting' : 'status-draft';
  return <span className={`purchase-status ${tone}`} data-testid={`status-invoice-${status}`}><i />{invoiceStatusText[status] ?? status}</span>;
}
function InvoiceMatch({ status }: { status: string }) {
  return <span className={`invoice-match-pill ${status}`} data-testid={`match-invoice-${status}`}>{status === 'match' ? <><CircleCheck size={12} /> Coincide</> : <><AlertTriangle size={12} /> Diferencia</>}</span>;
}

function InvoicesSection({ orders, ordersLoading, ordersError, retryOrders, receipts, receiptsLoading, receiptsError, retryReceipts, invoices, invoicesLoading, invoicesError, retryInvoices, canRegister, canDecide, onNotice }: {
  orders: PurchaseOrder[]; ordersLoading: boolean; ordersError: boolean; retryOrders: () => void;
  receipts: PurchaseReceipt[]; receiptsLoading: boolean; receiptsError: boolean; retryReceipts: () => void;
  invoices: PurchaseInvoice[]; invoicesLoading: boolean; invoicesError: boolean; retryInvoices: () => void;
  canRegister: boolean; canDecide: boolean; onNotice: (message: string) => void;
}) {
  const qc = useQueryClient();
  const [formTarget, setFormTarget] = useState<{ order: PurchaseOrder; supersedes?: PurchaseInvoice } | null>(null);
  const [decisionTarget, setDecisionTarget] = useState<PurchaseInvoice | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const selected = invoices.find((invoice) => invoice.id === selectedId) ?? invoices[0];
  const selectedOrder = selected ? orders.find((order) => order.id === selected.orderId) : undefined;
  const replaceableOrders = orders.filter((order) => order.lines.some((line) => receivedByOrderLine(receipts, order.id, line.id) > 0));
  return <section className="purchase-extended-section invoice-section" aria-label="Facturas recibidas">
    <div className="purchase-section-heading"><div><h2>Facturas recibidas</h2><p>Contrasta el documento con unidades aceptadas, precios, IGIC y portes del pedido.</p></div>{canRegister && <span className="purchase-count">{replaceableOrders.length} pedidos con recepción</span>}</div>
    <div className="receipt-guidance invoice-guidance"><ReceiptText size={16} /><span>La conformidad exige coincidencia con los datos recibidos. Una diferencia bloquea la conformidad; las solicitudes de rectificación conservan el documento original.</span></div>
    <PurchaseData loading={invoicesLoading || receiptsLoading || ordersLoading} error={invoicesError || receiptsError || ordersError} retry={() => { retryInvoices(); retryReceipts(); retryOrders(); }} title="pedidos, recepciones y facturas" />
    {!invoicesLoading && !invoicesError && !receiptsLoading && !receiptsError && !ordersLoading && !ordersError && <div className="invoice-workspace">
      <div className="invoice-list-pane">
        <div className="invoice-pane-head"><b>Registro de facturas</b>{canRegister && <label><span className="sr-only">Pedido para registrar factura</span><select value="" onChange={(e) => { const order = orders.find((item) => item.id === e.target.value); if (order) setFormTarget({ order }); }} data-testid="select-invoice-order"><option value="">Registrar desde un pedido…</option>{replaceableOrders.map((order) => <option key={order.id} value={order.id}>{order.orderNumber} · {order.supplierName}</option>)}</select></label>}</div>
        <div className="invoice-table-wrap"><table className="purchase-table invoice-table"><thead><tr><th>Documento / pedido</th><th>Proveedor</th><th>Comparación</th><th>Total</th><th>Estado</th></tr></thead><tbody>
          {invoices.map((invoice) => <tr key={invoice.id} className={selected?.id === invoice.id ? 'is-selected' : ''} onClick={() => setSelectedId(invoice.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(invoice.id); }} data-testid={`row-purchase-invoice-${invoice.id}`}><td><b>{invoice.invoiceReference}</b><small className="table-secondary">{invoice.orderNumber} · {dateText(invoice.invoiceDate)}</small></td><td>{invoice.supplierName}</td><td><InvoiceMatch status={invoice.matchStatus} /></td><td className="money-cell">{money(invoice.totalCents)}</td><td><InvoiceStatus status={invoice.status} /></td></tr>)}
          {!invoices.length && <tr><td colSpan={5}><PurchaseEmpty title="Aún no hay facturas recibidas" detail="Selecciona un pedido con unidades aceptadas para registrar el documento recibido." icon={ReceiptText} /></td></tr>}
        </tbody></table></div>
      </div>
      <aside className="purchase-list-panel invoice-detail-panel">
        {selected ? <>
          <div className="purchase-section-heading"><div><h2>Comparación documental</h2><p>{selected.invoiceReference} · {selected.orderNumber}</p></div><InvoiceStatus status={selected.status} /></div>
          <div className={`invoice-match-banner ${selected.matchStatus}`}><span>{selected.matchStatus === 'match' ? <CircleCheck size={16} /> : <AlertTriangle size={16} />}</span><div><b>{selected.matchStatus === 'match' ? 'Coincidencia' : 'Diferencias detectadas'}</b><p>{selected.matchSummary}</p></div></div>
          <div className="invoice-comparison-lines"><div className="invoice-comparison-head"><span>Artículo</span><span>Factura / recibido</span><span>Precio / IGIC</span></div>{selected.lines.map((line) => <article key={line.id} className={line.matches ? '' : 'line-diff'} data-testid={`invoice-line-${line.id}`}><div><b>{line.productName}</b><small>{line.sku}</small><small className={line.matches ? 'line-match-yes' : 'line-match-no'}>{line.matches ? 'Coincide con pedido' : 'Diferencia con pedido'}</small></div><div><b>{line.quantity} / {line.expectedReceivedQuantity}</b><small>unidades facturadas / aceptadas</small></div><div><b>{money(line.unitPriceCents)} / {money(line.expectedUnitPriceCents)}</b><small>{percent(line.igicBasisPoints)} / {percent(line.expectedIgicBasisPoints)} IGIC</small></div></article>)}</div>
          <div className="invoice-amount-compare"><span>Base · factura <b>{money(selected.baseCents)}</b></span><span>Base · pedido <b>{selectedOrder ? money(selectedOrder.baseCents) : 'No disponible'}</b></span><span>IGIC · factura <b>{money(selected.igicCents)}</b></span><span>IGIC · pedido <b>{selectedOrder ? money(selectedOrder.igicCents) : 'No disponible'}</b></span><span>Portes · factura <b>{money(selected.freightCents)}</b></span><span>Portes · pedido <b>{selectedOrder ? money(selectedOrder.freightCents) : 'No disponible'}</b></span><strong>Total factura / pedido <b>{money(selected.totalCents)} / {selectedOrder ? money(selectedOrder.totalCents) : 'No disponible'}</b></strong></div>
          {selected.supersedesInvoiceId && <p className="invoice-supersedes">Rectifica la factura anterior <span className="mono">{invoices.find((i) => i.id === selected.supersedesInvoiceId)?.invoiceReference ?? 'documento previo'}</span></p>}
          {selected.decisionReason && <div className="detail-reason"><small>Resolución registrada</small><p>{selected.decisionReason}</p></div>}
          {canDecide && selected.status === 'pending_review' && <div className="invoice-decisions"><button className="button button-primary" disabled={selected.matchStatus !== 'match'} title={selected.matchStatus !== 'match' ? 'No se puede conformar una factura con diferencias.' : ''} onClick={() => setDecisionTarget(selected)} data-testid={`button-conform-invoice-${selected.id}`}><Check size={14} /> Conformar</button><button className="button button-quiet" onClick={() => setDecisionTarget(selected)} data-testid={`button-review-invoice-${selected.id}`}><SlidersHorizontal size={14} /> Resolver diferencias</button></div>}
          {canRegister && selected.status === 'correction_requested' && <button className="button button-secondary rectified-invoice-button" onClick={() => { const order = orders.find((item) => item.id === selected.orderId); if (order) setFormTarget({ order, supersedes: selected }); }} data-testid={`button-rectify-invoice-${selected.id}`}><Plus size={14} /> Registrar factura rectificada</button>}
        </> : <PurchaseEmpty title="Sin documentos para revisar" detail="Las facturas registradas aparecerán aquí con su comparación frente a la recepción y el pedido." icon={ReceiptText} />}
      </aside>
    </div>}
    {formTarget && <InvoiceForm order={formTarget.order} receipts={receipts} supersedes={formTarget.supersedes} close={() => setFormTarget(null)} onSaved={(invoice) => { setFormTarget(null); invalidatePurchaseWorkflow(qc, invoice.requestId); setSelectedId(invoice.id); onNotice(`Factura ${invoice.invoiceReference} registrada para revisión.`); }} />}
    {decisionTarget && <InvoiceDecisionDialog invoice={decisionTarget} close={() => setDecisionTarget(null)} onSaved={(invoice) => { setDecisionTarget(null); invalidatePurchaseWorkflow(qc, invoice.requestId); setSelectedId(invoice.id); onNotice(`Factura ${invoice.invoiceReference}: ${invoiceStatusText[invoice.status]}.`); }} />}
  </section>;
}

function InvoiceForm({ order, receipts, supersedes, close, onSaved }: {
  order: PurchaseOrder; receipts: PurchaseReceipt[]; supersedes?: PurchaseInvoice;
  close: () => void; onSaved: (invoice: PurchaseInvoice) => void;
}) {
  const mutation = useCreatePurchaseInvoice();
  const [operationId] = useState(opId);
  const [reference, setReference] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [freight, setFreight] = useState('');
  const [base, setBase] = useState('');
  const [igic, setIgic] = useState('');
  const [total, setTotal] = useState('');
  const [lines, setLines] = useState<Record<string, { quantity: string; unitPrice: string; igicPercent: string }>>({});
  const [error, setError] = useState('');
  const receivableLines = order.lines.map((line) => ({
    line,
    accepted: acceptedByOrderLine(receipts, order.id, line.id),
    rejected: receipts.filter((receipt) => receipt.orderId === order.id).flatMap((receipt) => receipt.lines).filter((item) => item.purchaseOrderLineId === line.id).reduce((sum, item) => sum + item.quantityRejected, 0),
  })).filter((x) => x.accepted + x.rejected > 0);
  const setLine = (id: string, field: 'quantity' | 'unitPrice' | 'igicPercent', value: string) => setLines((old) => {
    const previous = old[id] ?? { quantity: '', unitPrice: '', igicPercent: '' };
    return { ...old, [id]: { ...previous, [field]: value } };
  });
  const save = (e: FormEvent) => {
    e.preventDefault(); setError('');
    const baseCents = eurosToCents(base); const igicCents = eurosToCents(igic); const freightCents = eurosToCents(freight); const totalCents = eurosToCents(total);
    if ([baseCents, igicCents, freightCents, totalCents].some((v) => v === null)) return setError('Completa los importes de la factura en euros con hasta dos decimales.');
    const invoiceLines: PurchaseInvoiceInput['lines'] = receivableLines.map(({ line }) => {
      const v = lines[line.id] ?? { quantity: '', unitPrice: '', igicPercent: '' };
      const unitPriceCents = eurosToCents(v.unitPrice);
      const igicBasisPoints = Math.round(Number(v.igicPercent.replace(',', '.')) * 100);
      if (!v.quantity || Number(v.quantity) < 1 || unitPriceCents === null || !Number.isFinite(igicBasisPoints) || igicBasisPoints < 0 || igicBasisPoints > 10000) return null;
      return { purchaseOrderLineId: line.id, quantity: Number(v.quantity), unitPriceCents, igicBasisPoints };
    }).filter((line): line is NonNullable<typeof line> => line !== null);
    if (!invoiceLines.length || invoiceLines.length !== receivableLines.length) return setError('Indica cantidad, precio e IGIC para cada línea con unidades aceptadas.');
    if (Number(totalCents) !== Number(baseCents) + Number(igicCents) + Number(freightCents)) return setError('El total debe coincidir con base imponible + IGIC + portes.');
    mutation.mutate({ id: order.id, data: { operationId, invoiceReference: reference.trim(), invoiceDate, dueDate: dueDate || null, supersedesInvoiceId: supersedes?.id ?? null, baseCents: baseCents!, igicCents: igicCents!, freightCents: freightCents!, totalCents: totalCents!, lines: invoiceLines } }, {
      onSuccess: onSaved, onError: (err) => setError(apiErrorMessage(err, 'No se pudo registrar la factura. Revisa las líneas y los importes.')),
    });
  };
  return <MasterDialog title={supersedes ? 'Registrar factura rectificada' : 'Registrar factura recibida'} onClose={close} wide>
    <form className="form-stack purchase-form" onSubmit={save}>
      <p className="form-intro">Pedido <b>{order.orderNumber}</b> · {order.supplierName}. {supersedes ? <>Sustituye, sin borrar, el documento <b>{supersedes.invoiceReference}</b>.</> : 'Registra los datos tal como aparecen en el documento recibido.'}</p>
      <div className="purchase-form-grid"><label>Referencia de factura<input required maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} data-testid="input-invoice-reference" /></label><label>Fecha de factura<input type="date" required value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} data-testid="input-invoice-date" /></label><label>Vencimiento<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-invoice-due-date" /></label></div>
      <div className="invoice-entry-lines"><div className="invoice-entry-header"><span>Línea · unidades aceptadas</span><span>Ud. facturadas</span><span>Precio unitario</span><span>IGIC %</span></div>
        {receivableLines.map(({ line, accepted, rejected }) => <div className="invoice-entry-row" key={line.id} data-testid={`invoice-entry-line-${line.id}`}><div><b>{line.productName}</b><small>{line.sku} · {accepted} aceptadas / {rejected} rechazadas</small></div><input type="number" min={1} required aria-label={`Cantidad facturada de ${line.productName}`} value={lines[line.id]?.quantity ?? ''} onChange={(e) => setLine(line.id, 'quantity', e.target.value)} data-testid={`input-invoice-quantity-${line.id}`} /><input inputMode="decimal" required aria-label={`Precio de factura de ${line.productName}`} value={lines[line.id]?.unitPrice ?? ''} onChange={(e) => setLine(line.id, 'unitPrice', e.target.value)} placeholder="0,00" data-testid={`input-invoice-price-${line.id}`} /><input inputMode="decimal" required aria-label={`IGIC de factura de ${line.productName}`} value={lines[line.id]?.igicPercent ?? ''} onChange={(e) => setLine(line.id, 'igicPercent', e.target.value)} placeholder="%" data-testid={`input-invoice-tax-${line.id}`} /></div>)}
      </div>
      <div className="purchase-form-grid invoice-amount-fields"><label>Base imponible · euros<input inputMode="decimal" required value={base} onChange={(e) => setBase(e.target.value)} data-testid="input-invoice-base" /></label><label>IGIC · euros<input inputMode="decimal" required value={igic} onChange={(e) => setIgic(e.target.value)} data-testid="input-invoice-igic" /></label><label>Portes · euros<input inputMode="decimal" required value={freight} onChange={(e) => setFreight(e.target.value)} data-testid="input-invoice-freight" /></label><label>Total factura · euros<input inputMode="decimal" required value={total} onChange={(e) => setTotal(e.target.value)} data-testid="input-invoice-total" /></label></div>
      <p className="form-hint">El servidor comparará cantidades facturadas con unidades aceptadas, precios unitarios, tipos y cuotas de IGIC e importes frente al pedido.</p>
      {error && <div className="purchase-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={close} data-testid="button-cancel-invoice">Cancelar</button><button className="button button-primary" disabled={mutation.isPending || !receivableLines.length} data-testid="button-save-invoice">{mutation.isPending ? 'Guardando…' : 'Registrar para revisión'}</button></div>
    </form>
  </MasterDialog>;
}

function InvoiceDecisionDialog({ invoice, close, onSaved }: { invoice: PurchaseInvoice; close: () => void; onSaved: (invoice: PurchaseInvoice) => void }) {
  const qc = useQueryClient();
  const mutation = useDecidePurchaseInvoice();
  const [decision, setDecision] = useState<'conformed' | 'blocked' | 'correction_requested'>(invoice.matchStatus === 'match' ? 'conformed' : 'correction_requested');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const save = (e: FormEvent) => {
    e.preventDefault(); setError('');
    if (decision === 'conformed' && invoice.matchStatus !== 'match') return setError('No se puede conformar una factura con diferencias.');
    if (reason.trim().length < 5) return setError('La justificación debe incluir al menos 5 caracteres.');
    mutation.mutate({ id: invoice.id, data: { decision, reason: reason.trim() } }, {
      onSuccess: (result) => { invalidatePurchaseWorkflow(qc, result.requestId); onSaved(result); },
      onError: (err) => setError(apiErrorMessage(err, 'No se pudo registrar la decisión de la factura.')),
    });
  };
  return <MasterDialog title={`Resolver factura ${invoice.invoiceReference}`} onClose={close}>
    <form className="form-stack" onSubmit={save}>
      <p className="form-intro">{invoice.matchSummary}</p>
      <label>Resolución<select value={decision} onChange={(e) => setDecision(e.target.value as typeof decision)} data-testid="select-invoice-decision"><option value="conformed" disabled={invoice.matchStatus !== 'match'}>Conforme</option><option value="correction_requested">Solicitar rectificación</option><option value="blocked">Bloquear</option></select></label>
      <label>Justificación<textarea required minLength={5} maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explica la conformidad, diferencia o bloqueo" data-testid="input-invoice-decision-reason" /></label>
      {error && <div className="purchase-error" role="alert"><AlertTriangle size={15} />{error}</div>}
      <p className="form-hint">Solicitar rectificación conserva el documento original y permite vincular una factura corregida.</p>
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={close} data-testid="button-cancel-invoice-decision">Cancelar</button><button className="button button-primary" disabled={mutation.isPending || (decision === 'conformed' && invoice.matchStatus !== 'match')} data-testid={`button-save-invoice-decision-${invoice.id}`}>{mutation.isPending ? 'Guardando…' : 'Registrar resolución'}</button></div>
    </form>
  </MasterDialog>;
}

function SupplierAnalysisSection({ metrics, loading, error, retry }: { metrics: PurchaseSupplierMetric[]; loading: boolean; error: boolean; retry: () => void }) {
  return <section className="purchase-extended-section supplier-analysis-section" aria-label="Proveedores y análisis">
    <div className="purchase-section-heading"><div><h2>Proveedores y análisis</h2><p>Indicadores derivados exclusivamente de pedidos y recepciones persistidos.</p></div><span className="purchase-count">{metrics.length} proveedores</span></div>
    <div className="receipt-guidance analysis-guidance"><ChartNoAxesCombined size={17} /><span>Los porcentajes resumen entregas y aceptación registrados en este escenario. No son una evaluación real ni una previsión.</span></div>
    <PurchaseData loading={loading} error={error} retry={retry} title="el análisis de proveedores" />
    {!loading && !error && <div className="purchase-table-wrap"><table className="purchase-table supplier-analysis-table"><thead><tr><th>Proveedor</th><th>Pedidos</th><th>Recepciones a tiempo</th><th>Unidades aceptadas / rechazadas</th><th>Aceptación</th><th>Incidencias</th><th>Importe pedido</th><th>Media por pedido</th></tr></thead><tbody>
      {metrics.map((metric) => <tr key={metric.supplierOrganizationId} data-testid={`row-supplier-analysis-${metric.supplierOrganizationId}`}><td><div className="purchase-ref"><span className="offer-company-mark">{metric.supplierName.slice(0, 2).toUpperCase()}</span><span><b>{metric.supplierName}</b><small>{metric.isActive ? 'Activo en la red' : 'Inactivo'}</small></span></div></td><td><b>{metric.orderCount}</b><small className="table-secondary">{metric.receivedOrderCount} recibidos</small></td><td><span className={metric.onTimeBasisPoints >= 9000 ? 'analysis-good' : 'analysis-neutral'}>{percent(metric.onTimeBasisPoints)}</span></td><td><span className="accepted-units">{metric.acceptedUnits}</span><span className="muted-inline"> / </span><span className="rejected-units">{metric.rejectedUnits}</span></td><td><span className={metric.qualityAcceptanceBasisPoints >= 9500 ? 'analysis-good' : 'analysis-neutral'}>{percent(metric.qualityAcceptanceBasisPoints)}</span></td><td><span className={metric.complaintCount ? 'rejected-units' : 'analysis-good'}>{metric.complaintCount}</span></td><td className="money-cell">{money(metric.orderedCents)}</td><td>{money(metric.averageOrderCents)}</td></tr>)}
      {!metrics.length && <tr><td colSpan={8}><PurchaseEmpty title="Sin indicadores disponibles" detail="El análisis aparecerá cuando existan pedidos y recepciones reales del escenario." icon={ChartNoAxesCombined} /></td></tr>}
    </tbody></table></div>}
    <p className="analysis-footnote"><ShieldAlert size={13} /> Solo se presentan resultados devueltos por la API. Sin métricas fabricadas ni proveedores ajenos al alcance del perfil.</p>
  </section>;
}

function PurchaseStatus({ status }: { status: string }) {
  const cls = ['approved', 'ordered'].includes(status) ? 'status-approved' : ['rejected', 'cancelled'].includes(status) ? 'status-closed' : ['pending_approval', 'requested'].includes(status) ? 'status-waiting' : 'status-draft';
  return <span className={`purchase-status ${cls}`}><i />{statusText[status] ?? status}</span>;
}
function PurchaseData({ loading, error, retry, title }: { loading: boolean; error: boolean; retry: () => void; title: string }) {
  if (loading) return <div className="purchase-skeleton" aria-label="Cargando"><i /><i /><i /></div>;
  if (error) return <div className="purchase-error" role="alert"><ShieldAlert size={16} />No se pudieron cargar {title}.<button className="text-button" onClick={retry}>Reintentar</button></div>;
  return null;
}
function PurchaseEmpty({ title, detail, icon: Icon }: { title: string; detail: string; icon: typeof ClipboardList }) {
  return <div className="purchase-empty"><span><Icon size={20} /></span><b>{title}</b><p>{detail}</p></div>;
}
function roleLabel(role: string) {
  return ({ student: 'Estudiante', team_manager: 'Responsable de equipo', teacher: 'Docente', administrator: 'Administración', mentor: 'Mentoría', promoter: 'Promotor/a' } as Record<string, string>)[role] ?? role;
}

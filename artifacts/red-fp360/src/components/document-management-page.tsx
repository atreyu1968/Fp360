import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive, AlertCircle, ArrowDownToLine, BadgeCheck, BookCopy, ClipboardList, Clock3,
  FilePlus2, FileText, FileUp, FolderArchive, History, LockKeyhole, Plus, RefreshCw,
  RotateCcw, Search, ShieldAlert, UploadCloud,
} from 'lucide-react';
import {
  getGetFp360DocumentsOverviewQueryKey, useAbandonFp360DocumentUpload,
  useActOnFp360Document, useActOnFp360DocumentDossier, useCompleteFp360DocumentUpload,
  useCreateFp360Document, useCreateFp360DocumentDossier, useGenerateFp360DocumentFromTemplate,
  useGetFp360DocumentsOverview, useLogFp360DocumentAccess, useRequestFp360DocumentUploadUrl, useUpdateFp360Document,
} from '@workspace/api-client-react';
import type {
  AuthIdentity, Fp360Document, Fp360DocumentDossier, Fp360DocumentsOverview, Fp360Organization,
} from '@workspace/api-client-react';
import './document-management-page.css';

type Props = { identity: AuthIdentity; organizations?: Fp360Organization[]; onNotice: (message: string) => void };
type View = 'repository' | 'file' | 'templates' | 'approvals' | 'archive' | 'audit';
const tabs: Array<{ id: View; label: string; icon: typeof FileText }> = [
  { id: 'repository', label: 'Repositorio', icon: FileText },
  { id: 'file', label: 'Ficha de documento', icon: ClipboardList },
  { id: 'templates', label: 'Plantillas', icon: BookCopy },
  { id: 'approvals', label: 'Aprobaciones', icon: BadgeCheck },
  { id: 'archive', label: 'Archivo por expedientes', icon: FolderArchive },
  { id: 'audit', label: 'Histórico y auditoría', icon: History },
];
const statusLabels: Record<string, string> = {
  draft: 'Borrador', pending_review: 'En revisión', validated: 'Validado', confirmed: 'Confirmado',
  executed: 'Ejecutado', finalized: 'Finalizado', observed: 'Devuelto', rejected: 'Rechazado',
  voided: 'Anulado', rectified: 'Rectificado', pending_upload: 'Carga pendiente',
  uploaded: 'Disponible', abandoned: 'Abandonada', open: 'Abierto', archived: 'Archivado',
};
const typeLabels: Record<string, string> = {
  purchase_request: 'Solicitud de compra', quote: 'Presupuesto', purchase_order: 'Pedido',
  delivery_note: 'Albarán', invoice: 'Factura', payment: 'Pago', incident: 'Incidencia',
  contract: 'Contrato', project: 'Proyecto', employment_form: 'Formulario laboral',
  accounting: 'Contabilidad', educational: 'Educativo', other: 'Otro',
  purchase: 'Compras', sales: 'Ventas', labor: 'Laboral', educational_dossier: 'Educativo',
};
const opId = () => crypto.randomUUID();
const dateLabel = (value?: string | null) => value ? new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const sizeLabel = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const failMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación. Vuelve a intentarlo.';
const statusTone = (status: string) => ['validated', 'confirmed', 'executed', 'finalized', 'uploaded', 'open'].includes(status) ? 'good' : ['rejected', 'voided', 'abandoned'].includes(status) ? 'bad' : 'waiting';
function Status({ value }: { value: string }) {
  return <span className={`dm-status ${statusTone(value)}`}><i />{statusLabels[value] ?? value.replaceAll('_', ' ')}</span>;
}
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="dm-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}
function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="dm-empty"><span><FileText size={19} /></span><b>{title}</b><p>{detail}</p></div>;
}
function ErrorBox({ children }: { children: string }) {
  return children ? <p className="dm-error" role="alert"><AlertCircle size={15} />{children}</p> : null;
}

export function DocumentManagementPage({ identity, organizations = [], onNotice }: Props) {
  const queryClient = useQueryClient();
  const [selectedOrg, setSelectedOrg] = useState(identity.organizationId ?? '');
  const organizationId = identity.organizationId ?? selectedOrg;
  const params = useMemo(() => ({ organizationId }), [organizationId]);
  const queryKey = getGetFp360DocumentsOverviewQueryKey(params);
  const overview = useGetFp360DocumentsOverview(params, { query: { enabled: Boolean(organizationId), queryKey } });
  const data = overview.data as Fp360DocumentsOverview | undefined;
  const canReview = identity.role === 'teacher' || identity.role === 'administrator';
  const [view, setView] = useState<View>('repository');
  const [selectedDocId, setSelectedDocId] = useState('');
  const [selectedDossierId, setSelectedDossierId] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [showNewDossier, setShowNewDossier] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [pendingUpload, setPendingUpload] = useState<{ documentId: string; versionId: string; url: string; file: File } | null>(null);
  const [templateKey, setTemplateKey] = useState('');
  const [templateFields, setTemplateFields] = useState('{}');
  const [templateError, setTemplateError] = useState('');

  const createDossier = useCreateFp360DocumentDossier();
  const createDocument = useCreateFp360Document();
  const updateDocument = useUpdateFp360Document();
  const actDossier = useActOnFp360DocumentDossier();
  const generateTemplate = useGenerateFp360DocumentFromTemplate();
  const requestUpload = useRequestFp360DocumentUploadUrl();
  const completeUpload = useCompleteFp360DocumentUpload();
  const abandonUpload = useAbandonFp360DocumentUpload();
  const actDocument = useActOnFp360Document();
  const logDocumentAccess = useLogFp360DocumentAccess();
  const docs = data?.documents ?? [];
  const dossiers = data?.dossiers ?? [];
  const selectedDoc = docs.find((doc) => doc.id === selectedDocId);
  const selectedDocCanEdit = Boolean(selectedDoc && (selectedDoc.ownerUserId === identity.id || canReview));
  const selectedDocEditable = Boolean(selectedDoc && ['draft', 'observed', 'rejected'].includes(selectedDoc.status));
  const selectedHasVerifiedVersion = Boolean(selectedDoc && (data?.versions ?? []).some((version) => version.documentId === selectedDoc.id && version.status === 'uploaded'));
  const selectedDossier = dossiers.find((dossier) => dossier.id === selectedDossierId);
  const textFilter = search.trim().toLocaleLowerCase('es');
  const filteredDocs = docs.filter((doc) => {
    const dossier = dossiers.find((item) => item.id === doc.dossierId);
    const matches = `${doc.reference} ${doc.title} ${doc.description} ${doc.documentType} ${doc.department} ${doc.period} ${doc.tags.join(' ')} ${dossier?.reference ?? ''} ${dossier?.title ?? ''}`.toLocaleLowerCase('es').includes(textFilter);
    return matches && (statusFilter === 'all' || doc.status === statusFilter);
  });
  const canArchiveDossier = (dossier: Fp360DocumentDossier) => {
    const relatedDocuments = docs.filter((doc) => doc.dossierId === dossier.id);
    return relatedDocuments.length > 0 && relatedDocuments.every((doc) => ['finalized', 'rejected', 'voided'].includes(doc.status));
  };
  const invalidate = async () => queryClient.invalidateQueries({ queryKey });
  const lastAccessLog = useRef('');
  useEffect(() => {
    if (view !== 'file' || !selectedDocId) {
      lastAccessLog.current = '';
      return;
    }
    if (lastAccessLog.current === selectedDocId) return;
    lastAccessLog.current = selectedDocId;
    void logDocumentAccess.mutateAsync({ documentId: selectedDocId })
      .then(() => invalidate())
      .catch((accessError: unknown) => setError(failMessage(accessError)));
  }, [view, selectedDocId, logDocumentAccess.mutateAsync]);
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true); setError('');
    try { await fn(); await invalidate(); onNotice(success); }
    catch (actionError) { await invalidate(); setError(failMessage(actionError)); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent<HTMLFormElement>, fn: (fd: FormData) => Promise<unknown>, success: string, close?: () => void, afterSuccess?: (result: unknown) => void) => {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    void (async () => {
      try {
        const result = await fn(new FormData(form));
        await invalidate();
        form.reset();
        close?.();
        afterSuccess?.(result);
        onNotice(success);
      } catch (formError) { setError(failMessage(formError)); }
    })();
  };
  const submitDossier = (fd: FormData) => createDossier.mutateAsync({ data: {
    organizationId, title: String(fd.get('title')).trim(),
    dossierType: String(fd.get('dossierType')) as 'purchase' | 'sales' | 'accounting' | 'labor' | 'project' | 'educational' | 'other',
    department: String(fd.get('department')).trim(), period: String(fd.get('period')), operationId: opId(),
  } });
  const submitDocument = (fd: FormData) => createDocument.mutateAsync({ data: {
    organizationId, dossierId: String(fd.get('dossierId')),
    documentType: String(fd.get('documentType')) as Fp360Document['documentType'],
    title: String(fd.get('title')).trim(), description: String(fd.get('description')).trim(),
    department: String(fd.get('department')).trim(), period: String(fd.get('period')),
    documentDate: String(fd.get('documentDate')), visibility: String(fd.get('visibility')) as 'organization' | 'restricted',
    originApp: 'manual', tags: String(fd.get('tags')).split(',').map((tag) => tag.trim()).filter(Boolean), operationId: opId(),
  } });
  const updateDraft = (fd: FormData) => selectedDoc ? updateDocument.mutateAsync({ documentId: selectedDoc.id, data: {
    title: String(fd.get('title')).trim(), description: String(fd.get('description')).trim(),
    department: String(fd.get('department')).trim(), period: String(fd.get('period')),
    documentDate: String(fd.get('documentDate')), visibility: String(fd.get('visibility')) as 'organization' | 'restricted',
    tags: String(fd.get('tags')).split(',').map((tag) => tag.trim()).filter(Boolean), operationId: opId(),
  } }) : Promise.resolve();
  const openCreatedDocument = (result: unknown) => {
    if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') {
      setSelectedDocId(result.id);
      setView('file');
    }
  };
  const newFile = async (doc: Fp360Document, file?: File) => {
    if (!file) return;
    if (!(doc.ownerUserId === identity.id || canReview) || !['draft', 'observed', 'rejected'].includes(doc.status)) {
      setError('Solo la persona propietaria o una persona revisora puede cargar archivos en documentos editables.'); return;
    }
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'];
    if (!validTypes.includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
      setError('Admite PDF, JPEG, PNG, WebP, DOCX, XLSX o CSV de hasta 10 MB.'); return;
    }
    setBusy(true); setError('');
    try {
      const uploaded = await requestUpload.mutateAsync({ documentId: doc.id, data: {
        name: file.name, size: file.size, contentType: file.type as 'application/pdf',
        ...(uploadDescription.trim() ? { description: uploadDescription.trim() } : {}), operationId: opId(),
      } });
      setPendingUpload({ documentId: doc.id, versionId: uploaded.versionId, url: uploaded.uploadURL, file });
      const response = await fetch(uploaded.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file, credentials: 'omit' });
      if (!response.ok) throw new Error(`La transferencia falló (${response.status}).`);
      await completeUpload.mutateAsync({ documentId: doc.id, versionId: uploaded.versionId });
      setPendingUpload(null); setUploadDescription(''); await invalidate(); onNotice('Archivo cargado y verificado.');
    } catch (uploadError) {
      await invalidate(); setError(failMessage(uploadError));
    } finally { setBusy(false); }
  };
  const retryUpload = async () => {
    if (!pendingUpload) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(pendingUpload.url, { method: 'PUT', headers: { 'Content-Type': pendingUpload.file.type }, body: pendingUpload.file, credentials: 'omit' });
      if (!response.ok) throw new Error(`La transferencia falló (${response.status}).`);
      await completeUpload.mutateAsync({ documentId: pendingUpload.documentId, versionId: pendingUpload.versionId });
      setPendingUpload(null); await invalidate(); onNotice('Archivo cargado y verificado.');
    } catch (uploadError) { setError(failMessage(uploadError)); }
    finally { setBusy(false); }
  };
  const docAction = (doc: Fp360Document, action: 'submit' | 'approve' | 'return' | 'reject' | 'confirm' | 'execute' | 'finalize' | 'void' | 'restore', sourceVersionId?: string) =>
    run(() => actDocument.mutateAsync({ documentId: doc.id, data: { action, ...(reason.trim() ? { description: reason.trim() } : {}), ...(sourceVersionId ? { sourceVersionId } : {}), operationId: opId() } }), `Documento actualizado: ${statusLabels[action] ?? action}.`);

  if (!organizationId) return <main className="page-content dm-page"><section className="dm-unselected"><FolderArchive size={27} /><h1>Gestión documental</h1><p>Selecciona una organización para consultar su repositorio y expedientes.</p><Field label="Organización de trabajo"><select value={selectedOrg} onChange={(event) => setSelectedOrg(event.target.value)}><option value="">Selecciona organización</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name} · {org.center}</option>)}</select></Field></section></main>;

  return <main className="page-content dm-page">
    <header className="dm-heading"><div><div className="dm-breadcrumb">RED FP360 <span>/</span> OPERACIONES · APLICACIÓN 14</div><span className="dm-kicker">EMPRESAS FICTICIAS · TRAZABILIDAD DOCUMENTAL</span><h1>Archivo y gestión documental</h1><p>Organiza expedientes, versiones y revisiones. Cada archivo conserva su contexto y su historial.</p></div>
      {!identity.organizationId && <Field label="Organización de trabajo"><select value={organizationId} onChange={(event) => setSelectedOrg(event.target.value)}><option value="">Selecciona organización</option>{organizations.map((org) => <option key={org.id} value={org.id}>{org.name} · {org.center}</option>)}</select></Field>}
    </header>
    <aside className="dm-safety"><ShieldAlert size={18} /><div><b>ENTORNO EDUCATIVO · DOCUMENTACIÓN FICTICIA</b><span>Las plantillas generadas y las aprobaciones son simulaciones: no son formularios legales ni constituyen firma electrónica. No incluyas datos personales reales.</span></div></aside>
    <div className="dm-topline"><span><i /> Sesión autenticada · repositorio de la organización</span><span>Indicadores y registros proceden del sistema</span></div>
    <nav className="dm-tabs" role="tablist" aria-label="Vistas de gestión documental">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={view === id} className={view === id ? 'active' : ''} onClick={() => { setView(id); setError(''); }}><Icon size={15} />{label}</button>)}</nav>
    {overview.isLoading ? <div className="dm-skeleton" role="status" aria-label="Cargando repositorio"><span /><span /><span /><span /></div> :
      overview.isError ? <div className="dm-error-banner" role="alert"><AlertCircle size={17} />No se ha podido cargar el repositorio.<button type="button" onClick={() => void overview.refetch()}><RefreshCw size={14} /> Reintentar</button></div> :
        data && <>
          <section className="dm-metrics" aria-label="Indicadores documentales">
            <article><span className="blue"><FileText size={17} /></span><small>Documentos activos</small><strong>{data.metrics.activeDocuments.toLocaleString('es-ES')}</strong><em>En todas las áreas</em></article>
            <article><span className="green"><FolderArchive size={17} /></span><small>Expedientes abiertos</small><strong>{data.metrics.openDossiers.toLocaleString('es-ES')}</strong><em>De esta organización</em></article>
            <article><span className="amber"><Clock3 size={17} /></span><small>Revisiones pendientes</small><strong>{data.metrics.pendingApprovals.toLocaleString('es-ES')}</strong><em>Asignadas a departamentos</em></article>
            <article><span className="violet"><Archive size={17} /></span><small>Documentos clasificados</small><strong>{data.metrics.classificationPercent.toLocaleString('es-ES')} %</strong><em>Trazabilidad activa</em></article>
          </section>
          <ErrorBox>{error}</ErrorBox>
          {view === 'repository' && <section className="dm-panel">
            <header className="dm-section-head"><div><span className="dm-eyebrow">REPOSITORIO · {docs.length} DOCUMENTOS</span><h2>Operaciones en marcha</h2><p>Busca por referencia, título, empresa/área o expediente.</p></div><div className="dm-head-actions"><button className="dm-button secondary" type="button" onClick={() => setView('audit')}><History size={14} /> Ver histórico</button><button className="dm-button primary" type="button" onClick={() => setShowNewDoc((value) => !value)}><Plus size={15} /> Nuevo documento</button></div></header>
            <div className="dm-toolbar"><label className="dm-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por referencia, nombre o empresa…" aria-label="Buscar documentos y expedientes" /></label><label className="dm-filter"><span className="sr-only">Filtrar por estado</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option>{[...new Set(docs.map((doc) => doc.status))].map((status) => <option key={status} value={status}>{statusLabels[status] ?? status}</option>)}</select></label></div>
            {showNewDoc && <form className="dm-form dm-new-form" onSubmit={(event) => submit(event, submitDocument, 'Documento creado como borrador.', () => setShowNewDoc(false), openCreatedDocument)}>
              <h3>Registrar documento</h3><div className="dm-grid"><Field label="Expediente"><select name="dossierId" required defaultValue=""><option value="" disabled>Selecciona expediente</option>{dossiers.filter((dossier) => dossier.status === 'open').map((dossier) => <option key={dossier.id} value={dossier.id}>{dossier.reference} · {dossier.title}</option>)}</select></Field><Field label="Tipo"><select name="documentType">{Object.entries(typeLabels).filter(([key]) => !['purchase', 'sales', 'labor', 'educational_dossier'].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
              <div className="dm-grid"><Field label="Título"><input name="title" required minLength={3} maxLength={180} /></Field><Field label="Departamento"><input name="department" required minLength={2} maxLength={80} /></Field></div>
              <Field label="Descripción"><textarea name="description" maxLength={2000} /></Field><div className="dm-grid"><Field label="Periodo"><input name="period" type="month" required /></Field><Field label="Fecha del documento"><input name="documentDate" type="date" required /></Field></div>
              <div className="dm-grid"><Field label="Visibilidad"><select name="visibility"><option value="organization">Organización</option><option value="restricted">Restringido</option></select></Field><Field label="Etiquetas" hint="Separadas por comas"><input name="tags" maxLength={500} /></Field></div>
              <button className="dm-button primary" disabled={createDocument.isPending}><FilePlus2 size={14} /> Crear borrador</button>
            </form>}
            {filteredDocs.length ? <div className="dm-table-wrap"><table><thead><tr><th>Documento</th><th>Tipo</th><th>Empresa / área</th><th>Fecha</th><th>Versión</th><th>Estado</th></tr></thead><tbody>
              {filteredDocs.map((doc) => <tr key={doc.id} className={selectedDocId === doc.id ? 'selected' : ''}><td><button className="dm-row-select" type="button" onClick={() => { setSelectedDocId(doc.id); setView('file'); }}><b>{doc.reference}</b><small>{doc.title}</small></button></td><td>{typeLabels[doc.documentType] ?? doc.documentType}</td><td>{doc.department}</td><td>{dateLabel(doc.documentDate)}</td><td>{doc.versionNumber}</td><td><Status value={doc.status} /></td></tr>)}
            </tbody></table></div> : <Empty title={docs.length ? 'No hay documentos coincidentes' : 'Repositorio sin documentos'} detail={docs.length ? 'Prueba otra búsqueda o cambia el filtro de estado.' : 'Registra un documento o crea primero un expediente para empezar.'} />}
            <footer className="dm-table-footer"><span>{filteredDocs.length} documentos visibles</span><button type="button" className="dm-text-button" onClick={() => setShowNewDossier((value) => !value)}><Plus size={13} /> Crear expediente</button></footer>
            {showNewDossier && <form className="dm-form dm-new-form" onSubmit={(event) => submit(event, submitDossier, 'Expediente creado.', () => setShowNewDossier(false))}><h3>Nuevo expediente</h3><div className="dm-grid"><Field label="Nombre"><input name="title" required minLength={3} maxLength={160} /></Field><Field label="Tipo"><select name="dossierType">{['purchase','sales','accounting','labor','project','educational','other'].map((key) => <option key={key} value={key}>{typeLabels[key] ?? key}</option>)}</select></Field></div><div className="dm-grid"><Field label="Departamento"><input name="department" required minLength={2} /></Field><Field label="Periodo"><input name="period" type="month" required /></Field></div><button className="dm-button primary" disabled={createDossier.isPending}><FolderArchive size={14} /> Crear expediente</button></form>}
          </section>}

          {view === 'file' && <div className="dm-columns"><section className="dm-panel"><header className="dm-section-head"><div><span className="dm-eyebrow">{selectedDoc ? `FICHA · ${selectedDoc.reference}` : 'SELECCIÓN DOCUMENTAL'}</span><h2>{selectedDoc?.title ?? 'Ficha de documento'}</h2><p>{selectedDoc ? 'Metadatos, archivo, versiones y acciones disponibles.' : 'Selecciona un documento desde el repositorio para consultar su ficha.'}</p></div>{selectedDoc && <Status value={selectedDoc.status} />}</header>
            {!selectedDoc ? <Empty title="Ningún documento seleccionado" detail="Abre un documento desde el repositorio para editar su borrador, cargar archivos y revisar versiones." /> : <>
              <div className="dm-detail-grid"><div><small>Referencia</small><b>{selectedDoc.reference}</b></div><div><small>Tipo</small><b>{typeLabels[selectedDoc.documentType] ?? selectedDoc.documentType}</b></div><div><small>Departamento</small><b>{selectedDoc.department}</b></div><div><small>Periodo</small><b>{selectedDoc.period}</b></div><div><small>Responsable</small><b>{selectedDoc.ownerName}</b></div><div><small>Acceso</small><b>{selectedDoc.visibility === 'restricted' ? 'Restringido' : 'Organización'}</b></div><div className="wide"><small>Descripción</small><p>{selectedDoc.description || 'Sin descripción.'}</p></div></div>
              {selectedDocCanEdit && selectedDocEditable && <form className="dm-form dm-edit-form" onSubmit={(event) => submit(event, updateDraft, 'Metadatos actualizados.') }><h3>Editar metadatos</h3><div className="dm-grid"><Field label="Título"><input name="title" required defaultValue={selectedDoc.title} /></Field><Field label="Departamento"><input name="department" required defaultValue={selectedDoc.department} /></Field></div><Field label="Descripción"><textarea name="description" defaultValue={selectedDoc.description} /></Field><div className="dm-grid"><Field label="Periodo"><input name="period" type="month" required defaultValue={selectedDoc.period} /></Field><Field label="Fecha"><input name="documentDate" type="date" required defaultValue={selectedDoc.documentDate} /></Field></div><div className="dm-grid"><Field label="Visibilidad"><select name="visibility" defaultValue={selectedDoc.visibility}><option value="organization">Organización</option><option value="restricted">Restringido</option></select></Field><Field label="Etiquetas"><input name="tags" defaultValue={selectedDoc.tags.join(', ')} /></Field></div><button className="dm-button secondary" disabled={updateDocument.isPending}>Guardar cambios</button></form>}
              {selectedDocCanEdit && selectedDocEditable && <div className="dm-upload-box"><div><UploadCloud size={18} /><span><b>Archivo y versiones</b><small>PDF, imágenes, documentos Office o CSV · máximo 10 MB</small></span></div><Field label="Descripción de versión"><input value={uploadDescription} onChange={(event) => setUploadDescription(event.target.value)} maxLength={500} placeholder="Describe este archivo" /></Field><label className="dm-button primary dm-file-input"><FileUp size={14} /> {busy ? 'Procesando…' : 'Subir nueva versión'}<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx,.csv,application/pdf,image/jpeg,image/png,image/webp,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" disabled={busy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void newFile(selectedDoc, file); }} aria-label="Subir nueva versión del documento" /></label></div>}
              {pendingUpload && selectedDocCanEdit && selectedDocEditable && <div className="dm-recovery" role="status"><span>La transferencia quedó pendiente. Conserva esta pestaña para reintentar o abandona esta versión desde el historial.</span><button className="dm-button secondary" type="button" disabled={busy} onClick={() => void retryUpload()}><RefreshCw size={13} /> Reintentar transferencia</button></div>}
              <h3 className="dm-subtitle">Historial de versiones</h3><div className="dm-version-list">{(data.versions ?? []).filter((version) => version.documentId === selectedDoc.id).sort((a,b) => b.versionNumber-a.versionNumber).map((version) => <article key={version.id}><div className="dm-version-icon"><FileText size={16} /></div><div className="dm-version-copy"><b>v{version.versionNumber} · {version.originalName ?? 'Archivo pendiente'}</b><small>{version.description || version.contentType} · {sizeLabel(version.sizeBytes)} · {version.createdByName} · {dateLabel(version.createdAt)}</small>{version.checksumSha256 && <small className="dm-checksum">SHA-256 · {version.checksumSha256}</small>}</div><Status value={version.status} />{version.status === 'uploaded' && <a className="dm-icon-button" href={`/api/redfp360/documents/${encodeURIComponent(selectedDoc.id)}/versions/${encodeURIComponent(version.id)}/download`} aria-label={`Descargar ${version.originalName ?? 'versión'}`} title="Descargar archivo"><ArrowDownToLine size={15} /></a>}{selectedDocCanEdit && selectedDocEditable && version.status === 'pending_upload' && <><button className="dm-icon-button" type="button" title="Reintentar verificación" aria-label={`Reintentar verificación de v${version.versionNumber}`} disabled={busy} onClick={() => void run(() => completeUpload.mutateAsync({ documentId: selectedDoc.id, versionId: version.id }), 'Versión verificada.')}><RefreshCw size={14} /></button><button className="dm-icon-button danger" type="button" title="Abandonar carga pendiente" aria-label={`Abandonar carga pendiente v${version.versionNumber}`} disabled={busy} onClick={() => { if (window.confirm('¿Abandonar esta carga pendiente?')) void run(() => abandonUpload.mutateAsync({ documentId: selectedDoc.id, versionId: version.id }), 'Carga pendiente abandonada.'); }}><Archive size={14} /></button></>}{selectedDocCanEdit && selectedDocEditable && version.status === 'uploaded' && <button className="dm-icon-button" type="button" title="Restaurar esta versión" aria-label={`Restaurar versión ${version.versionNumber}`} disabled={busy} onClick={() => void docAction(selectedDoc, 'restore', version.id)}><RotateCcw size={14} /></button>}</article>)}
                {!data.versions.some((version) => version.documentId === selectedDoc.id) && <Empty title="Aún sin versiones" detail="Sube un archivo para crear la primera versión." />}
              </div>
              <div className="dm-actions">{selectedDocCanEdit && selectedDocEditable && selectedHasVerifiedVersion && <button className="dm-button secondary" disabled={busy} onClick={() => void docAction(selectedDoc, 'submit')}>{selectedDoc.status === 'draft' ? 'Enviar a revisión' : 'Volver a enviar a revisión'}</button>}{canReview && selectedDoc.status === 'pending_review' && <><button className="dm-button primary" disabled={busy} onClick={() => void docAction(selectedDoc, 'approve')}>Aprobar</button><button className="dm-button secondary" disabled={busy || !reason.trim()} onClick={() => void docAction(selectedDoc, 'return')}>Devolver para cambios</button><button className="dm-button danger" disabled={busy || !reason.trim()} onClick={() => void docAction(selectedDoc, 'reject')}>Rechazar</button></>}{selectedDocCanEdit && selectedDoc.status === 'validated' && <button className="dm-button primary" disabled={busy} onClick={() => void docAction(selectedDoc, 'confirm')}>Confirmar</button>}{selectedDocCanEdit && selectedDoc.status === 'confirmed' && <><button className="dm-button primary" disabled={busy} onClick={() => void docAction(selectedDoc, 'execute')}>Marcar ejecutado</button><button className="dm-button secondary" disabled={busy} onClick={() => void docAction(selectedDoc, 'finalize')}>Finalizar</button></>}{selectedDocCanEdit && selectedDoc.status === 'executed' && <button className="dm-button primary" disabled={busy} onClick={() => void docAction(selectedDoc, 'finalize')}>Finalizar</button>}{selectedDocCanEdit && !['finalized','voided'].includes(selectedDoc.status) && <button className="dm-button danger" disabled={busy || !reason.trim()} onClick={() => void docAction(selectedDoc, 'void')}>Anular</button>}</div>
              {selectedDocCanEdit && ['pending_review','validated','confirmed','executed','draft','observed','rejected'].includes(selectedDoc.status) && <Field label="Nota de actuación" hint="Obligatoria para devolver, rechazar o anular"><input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="Motivo o contexto de la actuación" /></Field>}
              {!selectedDocCanEdit && <p className="dm-readonly-note">Vista de solo lectura: solo la persona propietaria del documento o una persona revisora puede editarlo o actuar sobre él.</p>}
            </>}
          </section><aside className="dm-aside"><LockKeyhole size={19} /><span className="dm-eyebrow">CONTROL DOCUMENTAL</span><h3>El archivo no pierde su contexto.</h3><p>Metadatos, revisiones y versiones se conservan en el historial del escenario.</p><div className="dm-aside-note">Las acciones de aprobación y las evidencias se simulan dentro de RED FP360; no equivalen a una firma electrónica.</div></aside></div>}

          {view === 'templates' && <div className="dm-columns"><section className="dm-panel"><header className="dm-section-head"><div><span className="dm-eyebrow">GENERACIÓN DIDÁCTICA</span><h2>Plantillas educativas</h2><p>Genera documentos de escenario y vincúlalos a un expediente abierto.</p></div></header>
            <div className="dm-template-list">{data.templates.map((template) => <article key={template.key} className={templateKey === template.key ? 'selected' : ''}><div><b>{template.name}</b><small>{template.description}</small><span>{typeLabels[template.documentType] ?? template.documentType}</span></div><button className="dm-button secondary" type="button" onClick={() => setTemplateKey(template.key)}>Usar plantilla</button></article>)}{!data.templates.length && <Empty title="No hay plantillas disponibles" detail="Las plantillas aparecerán cuando el sistema las habilite para esta organización." />}</div>
            {templateKey && <form className="dm-form dm-new-form" onSubmit={(event) => {
              event.preventDefault(); setTemplateError('');
              const fd = new FormData(event.currentTarget);
              let fields: Record<string,string>;
              try { fields = JSON.parse(String(fd.get('fields') || '{}')) as Record<string,string>; if (!fields || Array.isArray(fields) || typeof fields !== 'object' || Object.values(fields).some((v) => typeof v !== 'string')) throw new Error(); }
              catch { setTemplateError('Introduce un objeto JSON con valores de texto, por ejemplo {"concepto":"Material didáctico"}.'); return; }
              const dossierId = String(fd.get('dossierId'));
              void generateTemplate.mutateAsync({ templateKey, data: { organizationId, dossierId, title: String(fd.get('title')).trim(), department: String(fd.get('department')).trim(), period: String(fd.get('period')), documentDate: String(fd.get('documentDate')), fields, operationId: opId() } }).then(async (doc) => { await invalidate(); setSelectedDocId(doc.id); setView('file'); onNotice('Documento educativo generado.'); }).catch((err: unknown) => setTemplateError(failMessage(err)));
            }}><h3>Datos de generación</h3><Field label="Expediente"><select name="dossierId" required defaultValue=""><option value="" disabled>Selecciona expediente abierto</option>{dossiers.filter((d) => d.status === 'open').map((d) => <option key={d.id} value={d.id}>{d.reference} · {d.title}</option>)}</select></Field><div className="dm-grid"><Field label="Título"><input name="title" required minLength={3} defaultValue={data.templates.find((t) => t.key === templateKey)?.name ?? ''} /></Field><Field label="Departamento"><input name="department" required minLength={2} /></Field></div><div className="dm-grid"><Field label="Periodo"><input name="period" type="month" required /></Field><Field label="Fecha"><input name="documentDate" type="date" required /></Field></div><Field label="Campos de la plantilla (JSON)" hint="Valores de texto para completar el recurso educativo."><textarea name="fields" defaultValue={templateFields} onChange={(event) => setTemplateFields(event.target.value)} /></Field><ErrorBox>{templateError}</ErrorBox><button className="dm-button primary" disabled={generateTemplate.isPending}><BookCopy size={14} /> Generar documento didáctico</button></form>}
          </section><aside className="dm-aside caution"><ShieldAlert size={19} /><span className="dm-eyebrow">AVISO IMPORTANTE</span><h3>Un recurso para aprender.</h3><p>Todo documento generado es sintético, de uso exclusivamente educativo. No tiene validez legal.</p><div className="dm-aside-note">Las aprobaciones del flujo son simulaciones, no firmas electrónicas ni aceptación contractual.</div></aside></div>}

          {view === 'approvals' && <section className="dm-panel"><header className="dm-section-head"><div><span className="dm-eyebrow">REVISIÓN · DECISIONES SIMULADAS</span><h2>Bandeja de aprobaciones</h2><p>Documentos enviados a revisión y actuaciones disponibles en el escenario.</p></div></header>{canReview ? <Field label="Nota de devolución o rechazo"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Explica la decisión para dejar constancia" /></Field> : <p className="dm-readonly-note" role="note">Vista de solo lectura. Las aprobaciones, devoluciones y rechazos están reservados a docentes y administración.</p>}<div className="dm-approval-list">{docs.filter((doc) => doc.status === 'pending_review').map((doc) => <article key={doc.id}><div><b>{doc.reference} · {doc.title}</b><small>{doc.department} · {typeLabels[doc.documentType] ?? doc.documentType} · {dateLabel(doc.documentDate)}</small></div><Status value={doc.status} />{canReview && <><button className="dm-button primary" disabled={busy} onClick={() => void docAction(doc, 'approve')}>Aprobar</button><button className="dm-button secondary" disabled={busy || !reason.trim()} onClick={() => void docAction(doc, 'return')}>Devolver</button><button className="dm-button danger" disabled={busy || !reason.trim()} onClick={() => void docAction(doc, 'reject')}>Rechazar</button></>}<button className="dm-text-button" onClick={() => { setSelectedDocId(doc.id); setView('file'); }}>Abrir ficha</button></article>)}{!docs.some((doc) => doc.status === 'pending_review') && <Empty title="Bandeja sin pendientes" detail="Los documentos enviados a revisión aparecerán aquí." />}</div></section>}

          {view === 'archive' && <section className="dm-panel"><header className="dm-section-head"><div><span className="dm-eyebrow">CONSERVACIÓN Y ACCESO</span><h2>Archivo por expedientes</h2><p>Busca expedientes, consulta su progreso y archívalos o vuelve a abrirlos.</p></div><button className="dm-button primary" onClick={() => setShowNewDossier((value) => !value)}><Plus size={14} /> Nuevo expediente</button></header>
            <label className="dm-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar expediente, referencia o departamento…" aria-label="Buscar expedientes" /></label>
            {showNewDossier && <form className="dm-form dm-new-form" onSubmit={(event) => submit(event, submitDossier, 'Expediente creado.', () => setShowNewDossier(false))}><h3>Nuevo expediente</h3><div className="dm-grid"><Field label="Nombre"><input name="title" required minLength={3} /></Field><Field label="Tipo"><select name="dossierType">{['purchase','sales','accounting','labor','project','educational','other'].map((key) => <option key={key} value={key}>{typeLabels[key] ?? key}</option>)}</select></Field></div><div className="dm-grid"><Field label="Departamento"><input name="department" required minLength={2} /></Field><Field label="Periodo"><input name="period" type="month" required /></Field></div><button className="dm-button primary">Crear expediente</button></form>}
            <div className="dm-dossier-grid">{dossiers.filter((d) => `${d.reference} ${d.title} ${d.department} ${d.period}`.toLocaleLowerCase('es').includes(textFilter)).map((dossier) => <article key={dossier.id} className={selectedDossierId === dossier.id ? 'selected' : ''}><div className="dm-dossier-top"><button className="dm-text-button" type="button" onClick={() => setSelectedDossierId(dossier.id)}>{dossier.reference} · Seleccionar</button><Status value={dossier.status} /></div><h3>{dossier.title}</h3><small>{typeLabels[dossier.dossierType] ?? dossier.dossierType} · {dossier.department} · {dossier.period}</small><div className="dm-progress"><span><i style={{ width: `${Math.max(0, Math.min(100, dossier.progressPercent))}%` }} /></span><small>{dossier.documentCount} documentos · {dossier.requiredCount} requeridos · {dossier.progressPercent}%</small></div><div className="dm-dossier-footer"><button className="dm-text-button" onClick={() => { setSelectedDossierId(dossier.id); setSearch(dossier.reference); setView('repository'); }}><FileText size={13} /> Ver documentos</button>{canReview && <button className="dm-button secondary" disabled={busy || (dossier.status === 'open' && !canArchiveDossier(dossier))} title={dossier.status === 'open' && !canArchiveDossier(dossier) ? 'Resuelve todos los documentos antes de archivar.' : undefined} onClick={() => void run(() => actDossier.mutateAsync({ dossierId: dossier.id, data: { action: dossier.status === 'open' ? 'archive' : 'reopen', operationId: opId() } }), dossier.status === 'open' ? 'Expediente archivado.' : 'Expediente reabierto.')}>{dossier.status === 'open' ? <><Archive size={13} /> Archivar</> : <><RotateCcw size={13} /> Reabrir</>}</button>}</div></article>)}{!dossiers.length && <Empty title="No hay expedientes" detail="Crea un expediente para organizar documentos del escenario." />}{dossiers.length > 0 && !dossiers.some((d) => `${d.reference} ${d.title} ${d.department} ${d.period}`.toLocaleLowerCase('es').includes(textFilter)) && <Empty title="Sin expedientes coincidentes" detail="Ajusta el texto de búsqueda." />}</div>
            {selectedDossier && <div className="dm-selected-dossier"><b>Expediente seleccionado · {selectedDossier.reference}</b><span>{selectedDossier.title} · {selectedDossier.retentionRule}</span>{canReview && selectedDossier.documentCount > 0 && <a className="dm-button secondary" href={`/api/redfp360/documents/dossiers/${encodeURIComponent(selectedDossier.id)}/package`}><ArrowDownToLine size={14} /> Descargar paquete verificado</a>}</div>}
          </section>}

          {view === 'audit' && <section className="dm-panel"><header className="dm-section-head"><div><span className="dm-eyebrow">TRAZABILIDAD · HISTORIAL INMUTABLE</span><h2>Histórico y auditoría</h2><p>Eventos del sistema asociados a documentos, versiones y expedientes.</p></div></header><label className="dm-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar evento, actor, referencia o detalle…" aria-label="Buscar en el histórico" /></label><div className="dm-timeline">{data.events.filter((event) => { const doc = docs.find((item) => item.id === event.documentId); const dossier = dossiers.find((item) => item.id === event.dossierId); return `${event.eventType} ${event.details} ${event.actorName} ${doc?.reference ?? ''} ${dossier?.reference ?? ''}`.toLocaleLowerCase('es').includes(textFilter); }).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map((event) => <article key={event.id}><i /><div><b>{event.details || event.eventType}</b><small>{event.actorName} · {dateLabel(event.simulatedDate)} · {event.eventType.replaceAll('_',' ')}</small>{event.documentId && <button className="dm-text-button" onClick={() => { setSelectedDocId(event.documentId!); setView('file'); }}>Abrir documento asociado</button>}{event.dossierId && <small>Expediente · {dossiers.find((d) => d.id === event.dossierId)?.reference ?? '—'}</small>}</div></article>)}{!data.events.length && <Empty title="Sin actividad registrada" detail="Las acciones documentales aparecerán aquí con su actor y fecha simulada." />}{data.events.length > 0 && !data.events.some((event) => `${event.eventType} ${event.details} ${event.actorName}`.toLocaleLowerCase('es').includes(textFilter)) && <Empty title="Sin eventos coincidentes" detail="Prueba una búsqueda diferente." />}</div></section>}
        </>}
  </main>;
}

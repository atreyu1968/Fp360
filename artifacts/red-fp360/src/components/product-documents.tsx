import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Download, FileText, FileUp, LoaderCircle, RotateCw, Trash2,
} from 'lucide-react';
import {
  getListFp360ProductDocumentsQueryKey, useCompleteFp360ProductDocumentUpload,
  useDeleteFp360ProductDocument, useListFp360ProductDocuments, useRequestFp360ProductDocumentUploadUrl,
} from '@workspace/api-client-react';
import type { Fp360ProductDocument, Fp360ProductDocumentUploadUrlInput } from '@workspace/api-client-react';
import { apiErrorMessage } from './master-shared';

const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ProductDocuments({ productId, canWrite }: { productId: string; canWrite: boolean }) {
  const queryClient = useQueryClient();
  const documents = useListFp360ProductDocuments(productId);
  const requestUpload = useRequestFp360ProductDocumentUploadUrl();
  const completeUpload = useCompleteFp360ProductDocumentUpload();
  const deleteDocument = useDeleteFp360ProductDocument();
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busyDocumentId, setBusyDocumentId] = useState('');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListFp360ProductDocumentsQueryKey(productId) });

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    if (!DOCUMENT_TYPES.includes(file.type)) {
      setError('Admite PDF, JPEG, PNG y WebP.');
      return;
    }
    if (file.size < 1 || file.size > MAX_DOCUMENT_SIZE) {
      setError('El documento debe ocupar entre 1 byte y 10 MB.');
      return;
    }
    setError('');
    setNotice('');
    setUploading(true);
    let documentId = '';
    try {
      const data: Fp360ProductDocumentUploadUrlInput = {
        name: file.name,
        size: file.size,
        contentType: file.type as Fp360ProductDocumentUploadUrlInput['contentType'],
        ...(description.trim() ? { description: description.trim() } : {}),
      };
      const pending = await requestUpload.mutateAsync({ id: productId, data });
      documentId = pending.documentId;
      const response = await fetch(pending.uploadURL, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
        credentials: 'omit',
      });
      if (!response.ok) throw new Error(`La transferencia falló (${response.status}).`);
      await completeUpload.mutateAsync({ id: productId, documentId });
      await invalidate();
      setDescription('');
      setNotice('Documento adjuntado y verificado.');
    } catch (uploadError) {
      if (documentId) await invalidate();
      setError(apiErrorMessage(uploadError, 'No se pudo completar la carga. Revisa los documentos pendientes.'));
    } finally {
      setUploading(false);
    }
  };

  const finishPending = async (document: Fp360ProductDocument) => {
    setError('');
    setNotice('');
    setBusyDocumentId(document.id);
    try {
      await completeUpload.mutateAsync({ id: productId, documentId: document.id });
      await invalidate();
      setNotice('Documento verificado y disponible.');
    } catch (completeError) {
      setError(apiErrorMessage(completeError, 'No se pudo verificar el archivo. Si no llegó a cargarse, elimínalo y vuelve a intentarlo.'));
      await invalidate();
    } finally {
      setBusyDocumentId('');
    }
  };

  const removeDocument = async (document: Fp360ProductDocument) => {
    if (!window.confirm(`¿Eliminar “${document.originalName}” de esta referencia?`)) return;
    setError('');
    setNotice('');
    setBusyDocumentId(document.id);
    try {
      await deleteDocument.mutateAsync({ id: productId, documentId: document.id });
      await invalidate();
      setNotice('Documento eliminado.');
    } catch (deleteError) {
      setError(apiErrorMessage(deleteError, 'No se pudo eliminar el documento.'));
    } finally {
      setBusyDocumentId('');
    }
  };

  return <section className="catalog-documents" aria-labelledby={`catalog-documents-${productId}`}>
    <div className="catalog-documents-heading">
      <div>
        <b id={`catalog-documents-${productId}`}>Documentación</b>
        <small>Fichas y certificados privados de esta referencia</small>
      </div>
      {canWrite && <label className="button mini-button-blue catalog-upload-button" data-testid="button-upload-product-document">
        <FileUp size={13} /> {uploading ? 'Subiendo…' : 'Adjuntar'}
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
          disabled={uploading}
          onChange={handleFile}
          aria-label="Adjuntar ficha o certificado"
          data-testid="input-product-document"
        />
      </label>}
    </div>
    {canWrite && <label className="catalog-document-description">Descripción opcional<input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="Ej.: ficha técnica, certificado…" disabled={uploading} data-testid="input-product-document-description" /></label>}
    {uploading && <div className="catalog-document-progress" role="status"><LoaderCircle size={14} className="catalog-spinning" /> Subiendo y verificando documento…</div>}
    {documents.isLoading && <div className="catalog-document-loading" aria-label="Cargando documentos"><span /><span /></div>}
    {documents.isError && <div className="catalog-document-error" role="alert">No se pudo cargar la documentación. <button className="text-button" onClick={() => void documents.refetch()} data-testid="button-retry-product-documents">Reintentar</button></div>}
    {error && <div className="catalog-document-error" role="alert">{error}</div>}
    {notice && <div className="catalog-document-notice" role="status">{notice}</div>}
    {documents.data && (documents.data.length ? <ul className="catalog-document-list">
      {documents.data.map((document) => <li key={document.id} data-testid={`row-product-document-${document.id}`}>
        <span className="catalog-document-icon"><FileText size={15} /></span>
        <span className="catalog-document-meta">
          <b title={document.originalName}>{document.originalName}</b>
          <small>{document.description || document.contentType.replace('image/', '').replace('application/', '').toUpperCase()} · {sizeLabel(document.sizeBytes)} · {dateLabel(document.createdAt)}</small>
        </span>
        <span className={`catalog-document-status ${document.status}`}>{document.status === 'ready' ? 'Disponible' : 'Pendiente'}</span>
        {document.status === 'ready' && <a className="mini-button catalog-document-action" href={`/api/redfp360/products/${encodeURIComponent(productId)}/documents/${encodeURIComponent(document.id)}/download`} target="_blank" rel="noreferrer" aria-label={`Descargar ${document.originalName}`} data-testid={`link-download-product-document-${document.id}`}><Download size={13} /></a>}
        {canWrite && document.status === 'pending' && <button className="mini-button catalog-document-action" onClick={() => void finishPending(document)} disabled={busyDocumentId === document.id} aria-label={`Reintentar verificación de ${document.originalName}`} data-testid={`button-complete-product-document-${document.id}`}>{busyDocumentId === document.id ? <LoaderCircle size={13} className="catalog-spinning" /> : <RotateCw size={13} />}</button>}
        {canWrite && <button className="mini-button admin-danger catalog-document-action" onClick={() => void removeDocument(document)} disabled={busyDocumentId === document.id || uploading} aria-label={`Eliminar ${document.originalName}`} data-testid={`button-delete-product-document-${document.id}`}><Trash2 size={13} /></button>}
      </li>)}
    </ul> : <div className="catalog-documents-empty">Todavía no hay documentos adjuntos.</div>)}
  </section>;
}

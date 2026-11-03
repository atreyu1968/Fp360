import { and, eq } from 'drizzle-orm';
import { Router, type IRouter, type NextFunction, type Request, type Response } from 'express';
import { db, fpDocumentVersions, fpOrganizations, fpProductDocuments } from '@workspace/db';
import { LocalObjectStorageError, verifyLocalUploadSignature } from '../lib/localObjectStorage';
import { ObjectStorageService } from '../lib/objectStorage';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const OBJECT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

router.put(
  '/storage/uploads/:objectId',
  async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const objectId = Array.isArray(request.params.objectId)
      ? request.params.objectId[0]
      : request.params.objectId;
    const expires = typeof request.query.expires === 'string' ? Number(request.query.expires) : Number.NaN;
    const signature = typeof request.query.signature === 'string' ? request.query.signature : '';
    const reject = (status: number, message: string) => {
      request.resume();
      response.status(status).json({ error: message });
    };

    if (!objectStorageService.isLocalBackend) {
      reject(404, 'La carga local no está habilitada.');
      return;
    }
    if (!OBJECT_ID_PATTERN.test(objectId) || !verifyLocalUploadSignature({
      objectId,
      expires,
      signature,
      secret: process.env.SESSION_SECRET || '',
    })) {
      reject(403, 'El enlace de carga no es válido o ha caducado.');
      return;
    }

    const objectPath = `/objects/uploads/${objectId}`;
    const [documentVersion] = await db.select({
      sizeBytes: fpDocumentVersions.sizeBytes,
      contentType: fpDocumentVersions.contentType,
    }).from(fpDocumentVersions).where(and(
      eq(fpDocumentVersions.objectPath, objectPath),
      eq(fpDocumentVersions.status, 'pending_upload'),
    )).limit(1);

    const [productDocument] = documentVersion ? [undefined] : await db.select({
      sizeBytes: fpProductDocuments.sizeBytes,
      contentType: fpProductDocuments.contentType,
    }).from(fpProductDocuments).where(and(
      eq(fpProductDocuments.objectPath, objectPath),
      eq(fpProductDocuments.status, 'pending'),
    )).limit(1);

    const [organizationLogo] = documentVersion || productDocument ? [undefined] : await db.select({
      sizeBytes: fpOrganizations.logoPendingSizeBytes,
      contentType: fpOrganizations.logoPendingContentType,
    }).from(fpOrganizations).where(eq(fpOrganizations.logoPendingObjectPath, objectPath)).limit(1);

    const pendingUpload = documentVersion ?? productDocument ?? (
      organizationLogo?.sizeBytes !== null && organizationLogo?.sizeBytes !== undefined &&
      organizationLogo.contentType
        ? { sizeBytes: organizationLogo.sizeBytes, contentType: organizationLogo.contentType }
        : undefined
    );
    if (!pendingUpload) {
      reject(404, 'No existe una carga pendiente para este enlace.');
      return;
    }

    const contentType = (request.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if (contentType !== pendingUpload.contentType.toLowerCase()) {
      reject(415, 'El tipo de archivo no coincide con la carga pendiente.');
      return;
    }
    const contentLength = request.get('content-length');
    if (contentLength !== undefined) {
      const parsedLength = Number(contentLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength !== pendingUpload.sizeBytes) {
        reject(parsedLength > pendingUpload.sizeBytes ? 413 : 400, 'El tamaño no coincide con la carga pendiente.');
        return;
      }
    }

    try {
      await objectStorageService.writeLocalUpload({
        objectId,
        source: request,
        expectedSize: pendingUpload.sizeBytes,
        contentType: pendingUpload.contentType,
      });
      response.status(201).json({ uploaded: true });
    } catch (error) {
      if (error instanceof LocalObjectStorageError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      request.log.error({ err: error, objectId }, 'Local object upload failed');
      next(error);
    }
  },
);

export default router;

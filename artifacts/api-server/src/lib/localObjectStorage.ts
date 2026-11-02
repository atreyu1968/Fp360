import { createHmac, createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, link, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MAX_LOCAL_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_URL_TTL_MS = 15 * 60 * 1000;
const OBJECT_ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export class LocalObjectStorageError extends Error {
  readonly status: 400 | 404 | 409 | 413;

  constructor(message: string, status: 400 | 404 | 409 | 413) {
    super(message);
    this.name = 'LocalObjectStorageError';
    this.status = status;
  }
}

interface LocalSidecar {
  contentType?: string;
  metadata?: Record<string, string>;
}

export class LocalObjectFile {
  readonly name: string;
  readonly filePath: string;
  private readonly sidecarPath: string;

  constructor(filePath: string, objectPath: string) {
    this.filePath = filePath;
    this.name = objectPath;
    this.sidecarPath = `${filePath}.redfp360.json`;
  }

  async exists(): Promise<[boolean]> {
    try {
      await access(this.filePath);
      return [true];
    } catch (error) {
      if (isMissing(error)) return [false];
      throw error;
    }
  }

  async getMetadata(): Promise<[Record<string, unknown>]> {
    const fileStat = await stat(this.filePath);
    const sidecar = await this.readSidecar();
    return [{
      size: fileStat.size,
      contentType: sidecar.contentType ?? 'application/octet-stream',
      metadata: sidecar.metadata ?? {},
    }];
  }

  async setMetadata(options: { metadata?: Record<string, string> }): Promise<void> {
    const current = await this.readSidecar();
    await this.writeSidecar({
      ...current,
      metadata: { ...current.metadata, ...options.metadata },
    });
  }

  async download(): Promise<[Buffer]> {
    return [await readFile(this.filePath)];
  }

  createReadStream(): Readable {
    return createReadStream(this.filePath);
  }

  async delete(options: { ignoreNotFound?: boolean } = {}): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (!isMissing(error) || !options.ignoreNotFound) throw error;
    }
    try {
      await unlink(this.sidecarPath);
    } catch (error) {
      if (!isMissing(error) || !options.ignoreNotFound) throw error;
    }
  }

  async setUploadContentType(contentType: string): Promise<void> {
    const current = await this.readSidecar();
    await this.writeSidecar({ ...current, contentType });
  }

  private async readSidecar(): Promise<LocalSidecar> {
    try {
      return JSON.parse(await readFile(this.sidecarPath, 'utf8')) as LocalSidecar;
    } catch (error) {
      if (isMissing(error)) return {};
      throw error;
    }
  }

  private async writeSidecar(sidecar: LocalSidecar): Promise<void> {
    const temporaryPath = `${this.sidecarPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(sidecar), { flag: 'wx', mode: 0o600 });
      await rename(temporaryPath, this.sidecarPath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }
}

export function createLocalUploadUrl({
  baseUrl,
  objectId,
  secret,
}: {
  baseUrl: string;
  objectId: string;
  secret: string;
}): string {
  if (!OBJECT_ID_PATTERN.test(objectId)) throw new Error('Invalid local object ID.');
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
    throw new Error('PUBLIC_BASE_URL must use HTTPS in production.');
  }
  const expires = Date.now() + UPLOAD_URL_TTL_MS;
  const signature = signUpload(objectId, expires, secret);
  return `${base.origin}/api/storage/uploads/${objectId}?expires=${expires}&signature=${signature}`;
}

export function verifyLocalUploadSignature({
  objectId,
  expires,
  signature,
  secret,
  now = Date.now(),
}: {
  objectId: string;
  expires: number;
  signature: string;
  secret: string;
  now?: number;
}): boolean {
  if (!OBJECT_ID_PATTERN.test(objectId) || !Number.isSafeInteger(expires) ||
    expires <= now || expires > now + UPLOAD_URL_TTL_MS + 30_000 ||
    !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signUpload(objectId, expires, secret), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function writeLocalUpload({
  rootDir,
  objectId,
  source,
  expectedSize,
  contentType,
}: {
  rootDir: string;
  objectId: string;
  source: Readable;
  expectedSize: number;
  contentType: string;
}): Promise<void> {
  if (!OBJECT_ID_PATTERN.test(objectId)) {
    throw new LocalObjectStorageError('Archivo no válido.', 400);
  }
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1) {
    throw new LocalObjectStorageError('El tamaño declarado no es válido.', 400);
  }
  if (expectedSize > MAX_LOCAL_UPLOAD_BYTES) {
    throw new LocalObjectStorageError('El archivo supera el límite permitido.', 413);
  }
  if (!path.isAbsolute(rootDir)) {
    throw new Error('LOCAL_OBJECT_STORAGE_DIR must be an absolute path.');
  }

  const uploadDir = path.join(path.resolve(rootDir), 'private', 'uploads');
  await mkdir(uploadDir, { recursive: true, mode: 0o750 });
  const destination = path.join(uploadDir, objectId);
  const temporaryPath = path.join(uploadDir, `.${objectId}.${randomUUID()}.uploading`);
  const hash = createHash('sha256');
  let actualSize = 0;

  const byteLimit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      actualSize += chunk.length;
      if (actualSize > expectedSize) {
        callback(new LocalObjectStorageError('La carga supera el tamaño declarado.', 413));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    await pipeline(source, byteLimit, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
    if (actualSize !== expectedSize) {
      throw new LocalObjectStorageError('La carga no coincide con el tamaño declarado.', 400);
    }

    const uploadedHash = hash.digest('hex');
    try {
      await link(temporaryPath, destination);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existingBytes = await readFile(destination);
      const existingHash = createHash('sha256').update(existingBytes).digest('hex');
      if (existingBytes.byteLength !== expectedSize || existingHash !== uploadedHash) {
        throw new LocalObjectStorageError('Ya existe una carga distinta para este enlace.', 409);
      }
    }
    await new LocalObjectFile(destination, `/objects/uploads/${objectId}`)
      .setUploadContentType(contentType);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

export function localObjectFilePath(rootDir: string, objectPath: string): string {
  if (!path.isAbsolute(rootDir) || !objectPath.startsWith('/objects/')) {
    throw new Error('Invalid local object path configuration.');
  }
  const relativePath = objectPath.slice('/objects/'.length);
  const segments = relativePath.split('/');
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new LocalObjectStorageError('Archivo no encontrado.', 404);
  }
  const base = path.resolve(rootDir, 'private');
  const filePath = path.resolve(base, ...segments);
  if (filePath !== base && !filePath.startsWith(`${base}${path.sep}`)) {
    throw new LocalObjectStorageError('Archivo no encontrado.', 404);
  }
  return filePath;
}

function signUpload(objectId: string, expires: number, secret: string): string {
  if (!secret) throw new Error('SESSION_SECRET must be set to sign local uploads.');
  return createHmac('sha256', secret)
    .update(`redfp360-local-upload:${objectId}:${expires}`)
    .digest('hex');
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST';
}

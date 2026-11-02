import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import {
  createLocalUploadUrl,
  LocalObjectFile,
  localObjectFilePath,
  verifyLocalUploadSignature,
  writeLocalUpload,
} from './localObjectStorage.ts';

const objectId = 'f1b2c334-12ab-4cde-8f01-123456789abc';

test('local upload stores bytes and content type in a private directory', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'redfp360-storage-'));
  const bytes = Buffer.from('documento de prueba');
  const filePath = path.join(rootDir, 'private', 'uploads', objectId);

  try {
    await writeLocalUpload({
      rootDir,
      objectId,
      source: Readable.from([bytes]),
      expectedSize: bytes.length,
      contentType: 'text/plain',
    });

    const file = new LocalObjectFile(filePath, `/objects/uploads/${objectId}`);
    const [exists] = await file.exists();
    const [metadata] = await file.getMetadata();
    const [downloaded] = await file.download();

    assert.equal(exists, true);
    assert.equal(metadata.size, bytes.length);
    assert.equal(metadata.contentType, 'text/plain');
    assert.deepEqual(downloaded, bytes);
    assert.equal((await stat(filePath)).mode & 0o077, 0);
    assert.equal(localObjectFilePath(rootDir, `/objects/uploads/${objectId}`), filePath);

    await file.delete({ ignoreNotFound: true });
    assert.equal((await file.exists())[0], false);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('local upload rejects an incorrect size without leaving a partial object', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'redfp360-storage-'));
  const filePath = path.join(rootDir, 'private', 'uploads', objectId);

  try {
    await assert.rejects(writeLocalUpload({
      rootDir,
      objectId,
      source: Readable.from([Buffer.from('short')]),
      expectedSize: 10,
      contentType: 'text/plain',
    }), /tamaño/i);
    await assert.rejects(readFile(filePath), { code: 'ENOENT' });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('local upload URLs are time-limited and signatures cannot be changed', () => {
  const secret = 'test-only-signing-secret';
  const url = new URL(createLocalUploadUrl({
    baseUrl: 'https://fp360.example.test',
    objectId,
    secret,
  }));
  const expires = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature') || '';

  assert.equal(url.origin, 'https://fp360.example.test');
  assert.equal(url.pathname, `/api/storage/uploads/${objectId}`);
  assert.equal(verifyLocalUploadSignature({ objectId, expires, signature, secret }), true);
  assert.equal(verifyLocalUploadSignature({
    objectId,
    expires,
    signature: `${signature.slice(0, -1)}0`,
    secret,
  }), false);
  assert.equal(verifyLocalUploadSignature({
    objectId,
    expires,
    signature,
    secret,
    now: expires + 1,
  }), false);
});

test('local object path rejects traversal outside the private directory', () => {
  const rootDir = path.resolve('/var/lib/redfp360/objects');
  assert.throws(() => localObjectFilePath(rootDir, '/objects/../secrets.json'));
});

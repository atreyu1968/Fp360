import assert from "node:assert/strict";
import { test } from "node:test";

process.env.RED_FP360_STORAGE_BACKEND = "gcs";

const { ObjectStorageService, objectStorageClient } = await import("./objectStorage.ts");

test("GCS backend signs private uploads without the Replit sidecar", async () => {
  const originalBucket = objectStorageClient.bucket;
  let signedOptions;
  objectStorageClient.bucket = (bucketName) => ({
    file: (objectName) => ({
      getSignedUrl: async (options) => {
        signedOptions = { bucketName, objectName, ...options };
        return [`https://storage.googleapis.com/${bucketName}/${objectName}?signature=test`];
      },
    }),
  });
  const previousDir = process.env.PRIVATE_OBJECT_DIR;
  process.env.PRIVATE_OBJECT_DIR = "/fp360-test-bucket/private";

  try {
    const url = await new ObjectStorageService().getObjectEntityUploadURL();
    assert.match(url, /^https:\/\/storage\.googleapis\.com\/fp360-test-bucket\/private\/uploads\/[a-f0-9-]{36}\?/i);
    assert.equal(signedOptions.bucketName, "fp360-test-bucket");
    assert.match(signedOptions.objectName, /^private\/uploads\/[a-f0-9-]{36}$/i);
    assert.equal(signedOptions.version, "v4");
    assert.equal(signedOptions.action, "write");
    assert.ok(signedOptions.expires > Date.now());
  } finally {
    objectStorageClient.bucket = originalBucket;
    if (previousDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = previousDir;
  }
});

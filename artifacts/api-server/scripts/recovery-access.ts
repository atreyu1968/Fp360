// Only bundled/executed by the disposable recovery drill, never mounted in the app.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import app from "../src/app";
import { ObjectStorageService } from "../src/lib/objectStorage";
import { canAccessObject, ObjectPermission } from "../src/lib/objectAcl";
import { pool } from "@workspace/db";

const objectDir = process.argv[2];
assert(objectDir && process.env.RECOVERY_DRILL === "disposable");
let storageReads = 0;
// Local file adapter: no sidecar, bucket, signed URL or cloud request is used.
ObjectStorageService.prototype.getObjectEntityFile = async function (path) {
  assert.equal(path, "/objects/uploads/00000000-0000-4000-8000-000000000001");
  storageReads++;
  const bytes = await readFile(`${objectDir}/uploads/00000000-0000-4000-8000-000000000001`);
  const metadata = JSON.parse(await readFile(`${objectDir}/acl.json`, "utf8"));
  const versions = await pool.query("SELECT checksum_sha256 FROM fp360_document_versions");
  assert(versions.rows.every(row => row.checksum_sha256 === createHash("sha256").update(bytes).digest("hex")));
  const file = {
    getMetadata: async () => [metadata],
    getSignedUrl: async () => ["https://recovery.invalid/private/not-a-real-signed-url"],
  };
  assert.equal(await canAccessObject({ objectFile: file as never, requestedPermission: ObjectPermission.READ }), false);
  assert.equal(await canAccessObject({ objectFile: file as never, userId: "other-company", requestedPermission: ObjectPermission.READ }), false);
  assert.equal(await canAccessObject({ objectFile: file as never, userId: "owner", requestedPermission: ObjectPermission.READ }), true);
  return file as never;
};

const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const base = `http://127.0.0.1:${address.port}`;
try {
  const path = "/api/redfp360/documents/document-1/versions/version-2/download";
  for (const [user, status] of [
    [null, 401], ["colleague", 404], ["other-company", 404], ["other-network", 404], ["inactive", 401],
  ] as const) {
    const response = await fetch(base + path, {
      redirect: "manual", headers: user ? { cookie: `redfp360_session=fixture-${user}` } : {},
    });
    assert.equal(response.status, status, `download denied: ${user}`);
    assert.equal(response.headers.get("location"), null);
    await response.arrayBuffer();
  }
  assert.equal(storageReads, 0, "denied requests must not read storage");
  const response = await fetch(base + path, {
    redirect: "manual", headers: { cookie: "redfp360_session=fixture-owner" },
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("location"), "https://recovery.invalid/private/not-a-real-signed-url");
  assert.equal(storageReads, 1);
  await response.arrayBuffer();
  for (const path of ["/api/storage/public-objects/uploads/00000000-0000-4000-8000-000000000001", "/objects/uploads/00000000-0000-4000-8000-000000000001"]) {
    const denied = await fetch(base + path);
    assert([401, 404].includes(denied.status));
    await denied.arrayBuffer();
  }
  console.log("PASS: restored API authorization, local private ACL and checksum; public/direct file routes denied by full app");
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await pool.end();
}

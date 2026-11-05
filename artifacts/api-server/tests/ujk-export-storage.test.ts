import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ObjectStorageService } from "../src/lib/objectStorage";
import { ObjectPermission, setObjectAclPolicy } from "../src/lib/objectAcl";
import { makePackageZip, sha256 } from "../src/lib/preparation-package";

// Real App Storage smoke test, using only a newly generated object; always remove it.
const storage = new ObjectStorageService();
const id = randomUUID(), owner = `export-storage-fixture-${id}`;
const file = storage.getObjectEntityHandle(`/objects/exports/test-${id}.zip`);
const bytes = makePackageZip([{ name: "manifest.json", data: Buffer.from('{"testOnly":true}') }]);
try {
  await file.save(bytes, { resumable: false, contentType: "application/zip", preconditionOpts: { ifGenerationMatch: 0 }, metadata: { cacheControl: "private, no-store" } });
  await setObjectAclPolicy(file, { owner, visibility: "private" });
  assert.ok(await storage.canAccessObjectEntity({ userId: owner, objectFile: file, requestedPermission: ObjectPermission.READ }));
  assert.equal(await storage.canAccessObjectEntity({ userId: "unrelated-actor", objectFile: file, requestedPermission: ObjectPermission.READ }), false);
  assert.equal(await storage.canAccessObjectEntity({ objectFile: file, requestedPermission: ObjectPermission.READ }), false);
  const [downloaded] = await file.download({ validation: "crc32c" });
  assert.equal(sha256(downloaded), sha256(bytes));
  const [metadata] = await file.getMetadata();
  assert.equal(metadata.cacheControl, "private, no-store");
  console.log("Private preparation ZIP stored and read intact in App Storage; owner-only ACL verified.");
} finally {
  await file.delete({ ignoreNotFound: true });
}

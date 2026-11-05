import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, ujkEvents, ujkExports, ujkUploads, type UjkExportRow } from "@workspace/db";
import type { UjkExportInput } from "@workspace/api-zod";
import { journeyDetail, ownedJourney, UjkError } from "./ujk-service";
import { ObjectStorageService } from "./objectStorage";
import { ObjectPermission, setObjectAclPolicy } from "./objectAcl";
import { logger } from "./logger";
import { makePackageZip, MAX_PACKAGE_BYTES, packageManifest, packageReport, sha256 } from "./preparation-package";

export const exportStorage = new ObjectStorageService();
export function serializeExport(row: UjkExportRow) {
  return {
    id: row.id, createdAt: row.createdAt.toISOString(), snapshotAt: row.snapshotAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
    readinessStatus: row.readinessStatus, evidenceCount: row.evidenceIds.length, size: row.size, sha256: row.sha256,
    downloadUrl: `/api/ujk/journeys/${row.journeyId}/exports/${row.id}/download`,
  };
}

export async function createPreparationExport(journeyId: string, owner: string, input: UjkExportInput) {
  if (input.consent !== true || input.evidenceIds.length > 20)
    throw new UjkError(400, "Persetujuan eksplisit dan maksimal 20 bukti diperlukan.");
  // All readiness inputs are read from one PostgreSQL MVCC snapshot and one clock instant.
  const captured = await db.transaction(async tx => {
    const journey = await ownedJourney(journeyId, owner, tx);
    const now = new Date();
    const detail = await journeyDetail(journey, tx, now);
    if (detail.review.lastEventId !== input.lastEventId || (detail.scheme?.id ?? null) !== input.schemeId)
      throw new UjkError(409, "Data kesiapan berubah. Muat ulang dan periksa pilihan sebelum menyetujui ekspor.");
    const files = await tx.select().from(ujkUploads).where(and(eq(ujkUploads.journeyId, journey.id), eq(ujkUploads.ownerId, owner), eq(ujkUploads.finalized, true)));
    const selected = input.evidenceIds.map(id => files.find(f => f.id === id));
    if (new Set(input.evidenceIds).size !== input.evidenceIds.length || selected.some(f => !f))
      throw new UjkError(400, "Pilih hanya bukti final milik Anda dalam jalur ini.");
    const selectedFiles = selected.filter((f): f is NonNullable<typeof f> => !!f);
    if (selectedFiles.reduce((n, f) => n + f.size, 0) > MAX_PACKAGE_BYTES - 1024 * 1024)
      throw new UjkError(413, "Paket maksimal 50 MB termasuk laporan. Kurangi bukti yang dipilih.");
    const events = await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
    return { detail, selectedFiles, events, now };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  const id = randomUUID(), objectPath = `/objects/exports/${id}.zip`;
  const manifest = packageManifest(captured.detail, input.evidenceIds, captured.events, captured.now, id);
  const entries: { name: string; data: Buffer }[] = [];
  const checksums = [];
  for (const file of captured.selectedFiles) {
    const object = await exportStorage.getObjectEntityFile(file.objectPath);
    if (!await exportStorage.canAccessObjectEntity({ userId: owner, objectFile: object, requestedPermission: ObjectPermission.READ }))
      throw new UjkError(403, "Izin bukti tidak berlaku; paket tidak dibuat.");
    const [metadata] = await object.getMetadata();
    if (Number(metadata.size) !== file.size) throw new UjkError(409, "Ukuran bukti berubah; paket tidak dibuat.");
    // Finalized evidence is immutable; pin the object generation as an additional integrity guard.
    const version = object.bucket.file(object.name, { generation: metadata.generation });
    const [bytes] = await version.download({ validation: "crc32c" });
    if (bytes.length !== file.size) throw new UjkError(409, "Bukti tidak utuh; paket tidak dibuat.");
    const ext = file.contentType === "application/pdf" ? "pdf" : file.contentType === "image/png" ? "png" : "jpg";
    const name = `bukti/${file.id}.${ext}`;
    entries.push({ name, data: bytes });
    checksums.push({ evidenceId: file.id, file: name, size: bytes.length, sha256: sha256(bytes) });
  }
  const json = Buffer.from(JSON.stringify({ ...manifest, files: checksums }, null, 2));
  const report = Buffer.from(packageReport(manifest));
  if (json.length + report.length + entries.reduce((n, e) => n + e.data.length, 0) > MAX_PACKAGE_BYTES - 65536)
    throw new UjkError(413, "Paket terlalu besar. Kurangi bukti yang dipilih.");
  const bytes = makePackageZip([{ name: "manifest.json", data: json }, { name: "ringkasan.html", data: report }, ...entries]);
  const hash = sha256(bytes), expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const object = exportStorage.getObjectEntityHandle(objectPath);
  try {
    await object.save(bytes, { resumable: false, contentType: "application/zip", preconditionOpts: { ifGenerationMatch: 0 }, metadata: { cacheControl: "private, no-store" } });
    await setObjectAclPolicy(object, { owner, visibility: "private" });
    return await db.transaction(async tx => {
      const [row] = await tx.insert(ujkExports).values({
        id, journeyId, ownerId: owner, objectPath, snapshotAt: captured.now, expiresAt,
        readinessStatus: captured.detail.journey.status, evidenceIds: input.evidenceIds, size: bytes.length, sha256: hash,
      }).returning();
      await tx.insert(ujkEvents).values({
        journeyId, kind: "preparation_export_created", summary: "Peserta membuat paket persiapan privat dengan persetujuan eksplisit; tidak dikirim ke LSP.",
        payload: { actorId: owner, exportId: id, consent: true, evidenceIds: input.evidenceIds, snapshotAt: captured.now.toISOString(), lastEventId: input.lastEventId, schemeId: input.schemeId, sha256: hash, expiresAt: expiresAt.toISOString() },
      });
      return row;
    });
  } catch (error) {
    try { await object.delete({ ignoreNotFound: true }); }
    catch { logger.error({ exportId: id }, "Failed to clean up unpublished preparation export"); }
    throw error;
  }
}

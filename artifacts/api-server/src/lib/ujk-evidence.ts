import { and, eq } from "drizzle-orm";
import { db, ujkEvents, ujkUploads, type UjkJourney } from "@workspace/db";
import { CreateUjkEvidenceBody } from "@workspace/api-zod";
import { DAY, databaseNow, type QuotaStore } from "./resource-quotas";
import { frozenUploadPath } from "./ujk-upload-quota";
import { ObjectStorageService } from "./objectStorage";
import { UjkError } from "./ujk-service";

export async function finalizeEvidence(
  owner: string, journey: UjkJourney, data: typeof CreateUjkEvidenceBody._output,
  storage: ObjectStorageService, store: QuotaStore = db,
) {
  await store.transaction(async tx => {
    // Serialize finalization, duplicate retries and cleanup, including storage I/O.
    const [upload] = await tx.select().from(ujkUploads).where(and(eq(ujkUploads.id, data.uploadId), eq(ujkUploads.journeyId, journey.id), eq(ujkUploads.ownerId, owner))).for("update");
    if (!upload) throw new UjkError(404, "Unggahan milik Anda tidak ditemukan.");
    if (upload.finalized) return;
    if (upload.stagingCleanedAt || await databaseNow(tx) - upload.createdAt.getTime() >= DAY) throw new UjkError(410, "Permintaan unggahan sudah kedaluwarsa setelah 24 jam. Pilih ulang berkas untuk mengunggah kembali.");
    const file = await storage.getObjectEntityFile(upload.objectPath);
    const [metadata] = await file.getMetadata();
    if (Number(metadata.size) !== upload.size || metadata.contentType !== upload.contentType) throw new UjkError(400, "Ukuran atau jenis berkas tidak sesuai dengan permintaan unggahan.");
    const frozenPath = frozenUploadPath(upload.id);
    const frozenFile = storage.getObjectEntityHandle(frozenPath);
    const [exists] = await frozenFile.exists();
    if (!exists) {
      const snapshot = file.bucket.file(file.name, { generation: metadata.generation });
      await snapshot.copy(frozenFile, { preconditionOpts: { ifGenerationMatch: 0 } });
    }
    const [frozenMetadata] = await frozenFile.getMetadata();
    if (Number(frozenMetadata.size) !== upload.size || frozenMetadata.contentType !== upload.contentType) throw new UjkError(400, "Salinan bukti tidak sesuai dengan permintaan unggahan.");
    await storage.trySetObjectEntityAclPolicy(frozenPath, { owner, visibility: "private" });
    const [finalized] = await tx.update(ujkUploads).set({
      title: data.title, description: data.description, valid: data.valid, authentic: data.authentic,
      current: data.current, sufficient: data.sufficient, finalized: true, finalizedAt: new Date(), objectPath: frozenPath,
    }).where(and(eq(ujkUploads.id, upload.id), eq(ujkUploads.finalized, false))).returning();
    if (finalized) await tx.insert(ujkEvents).values({ journeyId: journey.id, unitCode: upload.unitCode, kind: "evidence", summary: `Bukti ditambahkan: ${data.title}. Deklarasi peserta; menunggu review manusia.`, payload: { evidenceId: upload.id } });
  });
}

import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, ujkEvents, ujkExports } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { guarded } from "./ujk";
import { ownedJourney, UjkError } from "../lib/ujk-service";
import { createPreparationExport, exportStorage, serializeExport } from "../lib/ujk-export-service";
import { ObjectPermission } from "../lib/objectAcl";
import { sha256 } from "../lib/preparation-package";

const router = Router();
router.get("/ujk/journeys/:id/exports", guarded(async (req, res, owner) => {
  const journey = await ownedJourney(String(req.params.id), owner);
  const rows = await db.select().from(ujkExports).where(and(eq(ujkExports.journeyId, journey.id), eq(ujkExports.ownerId, owner))).orderBy(desc(ujkExports.createdAt));
  res.json(api.ListUjkExportsResponse.parse(rows.map(serializeExport)));
}));

router.post("/ujk/journeys/:id/exports", guarded(async (req, res, owner) => {
  const parsed = api.CreateUjkExportBody.safeParse(req.body);
  if (!parsed.success || parsed.data.consent !== true) throw new UjkError(400, "Pilih bukti dan setujui cakupan paket persiapan terlebih dahulu.");
  const row = await createPreparationExport(String(req.params.id), owner, parsed.data);
  res.status(201).json(api.CreateUjkExportResponse.parse(serializeExport(row)));
}));

async function exportRow(journeyId: string, exportId: string, owner: string) {
  await ownedJourney(journeyId, owner);
  if (!/^[0-9a-f-]{36}$/i.test(exportId)) throw new UjkError(404, "Paket tidak ditemukan.");
  const [row] = await db.select().from(ujkExports).where(and(eq(ujkExports.id, exportId), eq(ujkExports.journeyId, journeyId), eq(ujkExports.ownerId, owner)));
  if (!row) throw new UjkError(404, "Paket tidak ditemukan.");
  return row;
}

router.post("/ujk/journeys/:id/exports/:exportId/revoke", guarded(async (req, res, owner) => {
  const row = await exportRow(String(req.params.id), String(req.params.exportId), owner);
  const revoked = await db.transaction(async tx => {
    const [current] = await tx.select().from(ujkExports).where(eq(ujkExports.id, row.id)).for("update");
    if (current.revokedAt) return current;
    const [updated] = await tx.update(ujkExports).set({ revokedAt: new Date() }).where(eq(ujkExports.id, row.id)).returning();
    await tx.insert(ujkEvents).values({
      journeyId: row.journeyId, kind: "preparation_export_revoked", summary: "Peserta mencabut akses unduhan paket persiapan.",
      payload: { actorId: owner, exportId: row.id },
    });
    return updated;
  });
  res.json(api.RevokeUjkExportResponse.parse(serializeExport(revoked)));
}));

router.get("/ujk/journeys/:id/exports/:exportId/download", guarded(async (req, res, owner) => {
  const row = await exportRow(String(req.params.id), String(req.params.exportId), owner);
  // No enduring signed GET URL and no reviewer/manager access via evidence routes.
  const bytes = await db.transaction(async tx => {
    const [current] = await tx.select().from(ujkExports).where(eq(ujkExports.id, row.id)).for("update");
    if (current.revokedAt || current.expiresAt <= new Date()) throw new UjkError(410, "Akses paket sudah dicabut atau melewati 24 jam. Buat paket baru dengan persetujuan baru.");
    const file = await exportStorage.getObjectEntityFile(current.objectPath);
    if (!await exportStorage.canAccessObjectEntity({ userId: owner, objectFile: file, requestedPermission: ObjectPermission.READ }))
      throw new UjkError(404, "Paket tidak ditemukan.");
    const [buffer] = await file.download({ validation: "crc32c" });
    if (buffer.length !== current.size || sha256(buffer) !== current.sha256)
      throw new UjkError(409, "Integritas paket tidak sesuai; unduhan ditahan. Buat ulang paket.");
    await tx.insert(ujkEvents).values({
      journeyId: current.journeyId, kind: "preparation_export_download", summary: "Pemilik mengakses unduhan paket persiapan privat.",
      payload: { actorId: owner, exportId: current.id, sha256: current.sha256 },
    });
    return buffer;
  });
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="persiapan-ujk-${row.id}.zip"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(bytes);
}));
export default router;

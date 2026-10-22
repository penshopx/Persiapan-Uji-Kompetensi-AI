import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, desc, lt } from "drizzle-orm";
import { db, ujkJourneys, ujkEvents, ujkUploads } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { catalog } from "../lib/competency-catalog";
import { journeyDetail, ownedJourney, requireJourneyUnit, UjkError } from "../lib/ujk-service";
import { safetyQuestions } from "../lib/ujk-rules";
import { ObjectStorageService } from "../lib/objectStorage";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { randomUUID } from "node:crypto";

const router = Router();
export const ujkStorage = new ObjectStorageService();
export const guarded = (fn: (req: Request, res: Response, owner: string) => Promise<void>) => async (req: Request, res: Response) => {
  try {
    const owner = getAuth(req).userId;
    if (!owner) { res.status(401).json({ error: "Masuk untuk mengakses paspor dan bukti pribadi." }); return; }
    if (req.get("origin")) {
      const origin = new URL(req.get("origin")!);
      if (origin.host !== getClerkProxyHost(req)) throw new UjkError(403, "Asal permintaan tidak diizinkan.");
    }
    await fn(req, res, owner);
  } catch (error) {
    if (error instanceof UjkError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error({ errorType: error instanceof Error ? error.name : "Unknown" }, "UJK request failed");
    res.status(503).json({ error: "Data belum berhasil diproses. Isian Anda tidak dihapus; coba kembali." });
  }
};

router.get("/ujk/passport", guarded(async (_req, res, owner) => {
  const journeys = await db.select().from(ujkJourneys).where(eq(ujkJourneys.ownerId, owner)).orderBy(desc(ujkJourneys.createdAt));
  res.json(api.GetUjkPassportResponse.parse({ journeys: await Promise.all(journeys.map(async journey => (await journeyDetail(journey)).journey)) }));
}));

router.post("/ujk/journeys", guarded(async (req, res, owner) => {
  const parsed = api.CreateUjkJourneyBody.safeParse(req.body);
  if (!parsed.success || parsed.data.consent !== true) throw new UjkError(400, "Pilih jabatan dan setujui penyimpanan paspor pribadi terlebih dahulu.");
  const role = catalog.roles.find(role => role.id === parsed.data.roleId && role.practiceAvailable);
  if (!role) throw new UjkError(400, "Dokumen dan unit rujukan untuk jabatan ini belum siap.");
  const journey = await db.transaction(async tx => {
    const [created] = await tx.insert(ujkJourneys).values({
      ownerId: owner, roleId: role.id, unitCodes: catalog.units.filter(unit => unit.standardId === role.standardId).map(unit => unit.code),
    }).onConflictDoNothing().returning();
    if (created) {
      await tx.insert(ujkEvents).values({ journeyId: created.id, kind: "created", summary: "Paspor dibuat dengan persetujuan peserta; unit masih rujukan, bukan skema terverifikasi.", payload: { consent: true, roleId: role.id } });
      return created;
    }
    const [existing] = await tx.select().from(ujkJourneys).where(and(eq(ujkJourneys.ownerId, owner), eq(ujkJourneys.roleId, role.id)));
    return existing;
  });
  res.json(api.CreateUjkJourneyResponse.parse((await journeyDetail(journey)).journey));
}));

router.get("/ujk/journeys/:id", guarded(async (req, res, owner) => {
  res.json(await journeyDetail(await ownedJourney(String(req.params.id), owner)));
}));

router.post("/ujk/journeys/:id/self-assessment", guarded(async (req, res, owner) => {
  const journey = await ownedJourney(String(req.params.id), owner);
  const parsed = api.CreateUjkSelfAssessmentBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Asesmen mandiri belum lengkap. Isi unit, rencana, dan alasan pembaruan.");
  requireJourneyUnit(journey, parsed.data.unitCode);
  await db.insert(ujkEvents).values({ journeyId: journey.id, kind: "self_assessment", unitCode: parsed.data.unitCode, summary: `Asesmen mandiri: ${parsed.data.reason}`, payload: parsed.data });
  res.json(await journeyDetail(journey));
}));

router.post("/ujk/journeys/:id/safety", guarded(async (req, res, owner) => {
  const journey = await ownedJourney(String(req.params.id), owner);
  const parsed = api.CreateUjkSafetyAttemptBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Jawab ketiga pertanyaan gerbang K3.");
  const passed = safetyQuestions.every((q, i) => q.correct === parsed.data.answers[i]);
  const feedback = safetyQuestions.map((q, i) => `${q.correct === parsed.data.answers[i] ? "Benar" : "Perlu perbaikan"}: ${q.choices[q.correct]}. ${q.sourceNote}`);
  await db.insert(ujkEvents).values({ journeyId: journey.id, kind: "safety", summary: passed ? "Gerbang K3 internal lulus seluruh pertanyaan." : "Gerbang K3 internal belum lulus; rencana perbaikan dan uji ulang diperlukan.", payload: { ...parsed.data, passed, feedback } });
  res.json(api.CreateUjkSafetyAttemptResponse.parse({ passed, feedback, detail: await journeyDetail(journey) }));
}));

router.post("/ujk/journeys/:id/uploads", guarded(async (req, res, owner) => {
  const journey = await ownedJourney(String(req.params.id), owner);
  const parsed = api.RequestUjkEvidenceUploadBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Gunakan PDF, PNG, atau JPEG berukuran maksimal 10 MB.");
  requireJourneyUnit(journey, parsed.data.unitCode);
  const uploadURL = await ujkStorage.getObjectEntityUploadURL();
  const objectPath = ujkStorage.normalizeObjectEntityPath(uploadURL);
  const [upload] = await db.insert(ujkUploads).values({
    ownerId: owner, journeyId: journey.id, unitCode: parsed.data.unitCode,
    fileName: parsed.data.name, size: parsed.data.size, contentType: parsed.data.contentType, objectPath,
  }).returning();
  res.json(api.RequestUjkEvidenceUploadResponse.parse({ uploadId: upload.id, uploadURL }));
}));

router.post("/ujk/journeys/:id/evidence", guarded(async (req, res, owner) => {
  const journey = await ownedJourney(String(req.params.id), owner);
  const parsed = api.CreateUjkEvidenceBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.authentic) throw new UjkError(400, "Lengkapi judul, uraian, dan pernyataan bahwa bukti berasal dari pekerjaan/pembelajaran Anda sendiri.");
  const data = parsed.data;
  const [upload] = await db.select().from(ujkUploads).where(and(eq(ujkUploads.id, data.uploadId), eq(ujkUploads.journeyId, journey.id), eq(ujkUploads.ownerId, owner)));
  if (!upload) throw new UjkError(404, "Unggahan milik Anda tidak ditemukan.");
  if (upload.finalized) { res.json(await journeyDetail(journey)); return; }
  if (Date.now() - upload.createdAt.getTime() > 86400000) throw new UjkError(400, "Permintaan unggahan sudah kedaluwarsa. Unggah kembali berkas.");
  const file = await ujkStorage.getObjectEntityFile(upload.objectPath);
  const [metadata] = await file.getMetadata();
  if (Number(metadata.size) !== upload.size || metadata.contentType !== upload.contentType) throw new UjkError(400, "Ukuran atau jenis berkas tidak sesuai dengan permintaan unggahan.");
  // The PUT URL remains usable for 15 minutes. Freeze evidence into a new
  // private object that has never had a participant-facing write URL.
  const frozenFile = file.bucket.file(`${file.name}.evidence-${randomUUID()}`);
  const snapshot = file.bucket.file(file.name, { generation: metadata.generation });
  await snapshot.copy(frozenFile, { preconditionOpts: { ifGenerationMatch: 0 } });
  const frozenPath = ujkStorage.normalizeObjectEntityPath(`https://storage.googleapis.com/${frozenFile.bucket.name}/${frozenFile.name}`);
  await ujkStorage.trySetObjectEntityAclPolicy(frozenPath, { owner, visibility: "private" });
  await db.transaction(async tx => {
    const [finalized] = await tx.update(ujkUploads).set({
      title: data.title, description: data.description, valid: data.valid, authentic: data.authentic,
      current: data.current, sufficient: data.sufficient, finalized: true, finalizedAt: new Date(), objectPath: frozenPath,
    }).where(and(eq(ujkUploads.id, upload.id), eq(ujkUploads.finalized, false))).returning();
    if (finalized) await tx.insert(ujkEvents).values({ journeyId: journey.id, unitCode: upload.unitCode, kind: "evidence", summary: `Bukti ditambahkan: ${data.title}. Deklarasi peserta; menunggu review manusia.`, payload: { evidenceId: upload.id } });
  });
  res.json(await journeyDetail(journey));
}));

router.post("/ujk/journeys/:id/notes", guarded(async (req, res, owner) => {
  const journey = await ownedJourney(String(req.params.id), owner);
  const parsed = api.CreateUjkCorrectionBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Tuliskan alasan dan isi koreksi minimal 3 karakter.");
  await db.insert(ujkEvents).values({ journeyId: journey.id, kind: "correction", summary: parsed.data.note, payload: parsed.data });
  res.json(await journeyDetail(journey));
}));

router.get("/ujk/journeys/:id/history/:before", guarded(async (req, res, owner) => {
  const journey = await ownedJourney(String(req.params.id), owner);
  const before = Number(req.params.before);
  if (!Number.isSafeInteger(before) || before < 1 || before > 2147483647) throw new UjkError(400, "Penanda halaman riwayat tidak valid.");
  const rows = await db.select().from(ujkEvents).where(and(eq(ujkEvents.journeyId, journey.id), lt(ujkEvents.id, before))).orderBy(desc(ujkEvents.id)).limit(51);
  const page = rows.slice(0, 50);
  res.json(api.GetUjkHistoryResponse.parse({
    events: page.map(event => {
      const result = api.CreatePracticeTurnResponse.safeParse(event.payload.result);
      return {
        id: event.id, kind: event.kind, unitCode: event.unitCode, summary: event.summary,
        createdAt: event.createdAt.toISOString(), question: typeof event.payload.question === "string" ? event.payload.question : null,
        answer: typeof event.payload.answer === "string" ? event.payload.answer : null,
        score: result.success ? result.data.evaluation?.score ?? null : null,
      };
    }),
    nextCursor: rows.length > 50 ? page[page.length - 1].id : null,
  }));
}));

export default router;

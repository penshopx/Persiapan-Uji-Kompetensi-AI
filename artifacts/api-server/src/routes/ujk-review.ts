import { Router } from "express";
import { clerkClient } from "@clerk/express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, ujkEvents, ujkJourneys, ujkSchemes, ujkUploads } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { catalog } from "../lib/competency-catalog";
import { journeyDetail, ownedJourney, UjkError } from "../lib/ujk-service";
import { assignedJourney, caseJourney, isManager, requireManager } from "../lib/ujk-review-access";
import { isReviewAuthorized, reviewAccess, simulationFingerprint, simulationWorkFingerprint, schemeIsCurrent } from "../lib/ujk-review-state";
import { serializeScheme } from "../lib/ujk-schemes";
import { guarded } from "./ujk";

const router = Router();

async function workspace(actorId: string) {
  const manager = await isManager(actorId);
  const cases = [];
  // Only minimal administrative metadata is shared; no evidence or owner identity.
  const journeys = await db.select().from(ujkJourneys);
  for (const journey of journeys) {
    const events = await db.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
    const access = reviewAccess(events);
    if (manager || (access.reviewerId === actorId && journey.ownerId !== actorId)) cases.push({
      id: journey.id, roleId: journey.roleId, title: catalog.roles.find(r => r.id === journey.roleId)?.title ?? journey.roleId,
      reviewerId: access.reviewerId, consent: access.consent, canReview: isReviewAuthorized(journey.ownerId, actorId, access),
    });
  }
  // Entire revision history is preserved and visible to managers. Reviewers see latest per role.
  const rows = await db.select().from(ujkSchemes).orderBy(desc(ujkSchemes.id));
  const schemes = manager ? rows : rows.filter((row, i) => rows.findIndex(r => r.roleId === row.roleId) === i);
  return api.GetUjkReviewWorkspaceResponse.parse({ manager, cases, schemes: schemes.map(serializeScheme) });
}

router.get("/ujk/review-workspace", guarded(async (_req, res, actor) => { res.json(await workspace(actor)); }));

router.post("/ujk/schemes", guarded(async (req, res, actor) => {
  await requireManager(actor);
  const parsed = api.PublishUjkSchemeBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Lengkapi provenance, versi, masa berlaku, paket unit, dan alasan verifikasi.");
  const input = parsed.data;
  const role = catalog.roles.find(r => r.id === input.roleId);
  const from = input.validFrom ? new Date(input.validFrom) : null, until = input.validUntil ? new Date(input.validUntil) : null;
  if (!role || (from && !Number.isFinite(from.getTime())) || (until && !Number.isFinite(until.getTime())) || (from && until && from >= until)) throw new UjkError(400, "Jabatan atau periode berlaku tidak valid.");
  const url = new URL(input.sourceUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new UjkError(400, "Gunakan URL HTTPS sumber resmi tanpa kredensial.");
  const reference = catalog.units.filter(u => u.standardId === role.standardId).map(u => u.code);
  if (new Set(input.unitCodes).size !== input.unitCodes.length ||
    input.unitCodes.some(code => !reference.includes(code)) ||
    (input.status === "verified" && (!input.unitCodes.length || !until || !from || until <= new Date() || from > new Date()))) {
    throw new UjkError(400, "Paket terverifikasi harus berlaku saat ini dan berisi unit unik dengan sumber yang sudah diproses. Jangan mengganti kode unit baru dengan kode historis.");
  }
  const [row] = await db.insert(ujkSchemes).values({ ...input, level: role.level, validFrom: from, validUntil: until, checkedBy: actor }).returning();
  res.json(api.PublishUjkSchemeResponse.parse(serializeScheme(row)));
}));

router.post("/ujk/journeys/:id/assignment", guarded(async (req, res, actor) => {
  await requireManager(actor);
  const parsed = api.AssignUjkReviewerBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Isi identitas reviewer dan alasan penetapan.");
  const journey = await caseJourney(String(req.params.id));
  const { reviewerId, reason } = parsed.data;
  if (reviewerId === journey.ownerId || reviewerId === actor) throw new UjkError(403, "Peserta dan pengelola tidak dapat menetapkan diri sendiri sebagai reviewer kasus ini.");
  if (reviewerId) {
    try { await clerkClient.users.getUser(reviewerId); }
    catch { throw new UjkError(400, "Identitas reviewer tidak ditemukan pada penyedia akun."); }
  }
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM ujk_journeys WHERE id = ${journey.id} FOR UPDATE`);
    await tx.insert(ujkEvents).values({
      journeyId: journey.id, kind: "reviewer_assignment", summary: `Penetapan reviewer: ${reason}`,
      payload: { actorId: actor, reviewerId, reason },
    });
  });
  res.json(await workspace(actor));
}));

router.post("/ujk/journeys/:id/review-consent", guarded(async (req, res, actor) => {
  const journey = await ownedJourney(String(req.params.id), actor);
  const parsed = api.SetUjkReviewConsentBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Persetujuan akses tidak valid.");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM ujk_journeys WHERE id = ${journey.id} FOR UPDATE`);
    const events = await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
    const access = reviewAccess(events);
    if (!access.reviewerId || access.assignmentId !== parsed.data.assignmentId) throw new UjkError(409, "Reviewer telah berubah; muat ulang sebelum menyetujui akses.");
    await tx.insert(ujkEvents).values({
      journeyId: journey.id, kind: "review_consent", summary: parsed.data.consent ? "Peserta menyetujui akses reviewer ke kasus dan bukti privat." : "Peserta mencabut akses reviewer ke kasus dan bukti privat.",
      payload: { ...parsed.data, actorId: actor },
    });
  });
  res.json(await journeyDetail(journey));
}));

router.get("/ujk/journeys/:id/review", guarded(async (req, res, actor) => {
  res.json(await journeyDetail(await assignedJourney(String(req.params.id), actor)));
}));

router.post("/ujk/journeys/:id/simulation", guarded(async (req, res, actor) => {
  const journey = await ownedJourney(String(req.params.id), actor);
  const parsed = api.SubmitUjkSimulationBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Tuliskan laporan simulasi minimal 30 karakter dengan kasus, tindakan dan hasil.");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM ujk_journeys WHERE id = ${journey.id} FOR UPDATE`);
    const detail = await journeyDetail(journey);
    if (!detail.journey.schemeVerified || !detail.requiredUnitCodes.length ||
      detail.requiredUnitCodes.some(code => !detail.units.some(u => u.code === code && u.lastScore !== null)) ||
      !detail.journey.safetyPassed) throw new UjkError(409, "Verifikasi paket resmi, jawab latihan setiap unit wajib, dan selesaikan K3 sebelum mengajukan simulasi.");
    const events = await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
    const attempts = detail.requiredUnitCodes.map(code => {
      const event = [...events].reverse().find(e => e.kind === "practice" && e.unitCode === code && e.payload.action === "answer");
      const result = api.CreatePracticeTurnResponse.safeParse(event?.payload.result);
      return event ? { id: event.id, kind: event.kind, unitCode: code, summary: event.summary, createdAt: event.createdAt.toISOString(),
        question: typeof event.payload.question === "string" ? event.payload.question : null,
        answer: typeof event.payload.answer === "string" ? event.payload.answer : null, score: result.success ? result.data.evaluation?.score ?? null : null } : null;
    }).filter(a => a !== null);
    await tx.insert(ujkEvents).values({
      journeyId: journey.id, kind: "simulation_submission", summary: "Peserta mengajukan laporan simulasi untuk review manusia; bukan keputusan K/BK.",
      payload: { ...parsed.data, actorId: actor, schemeId: detail.scheme?.id, practiceSnapshot: simulationWorkFingerprint(events), attempts },
    });
  });
  res.json(await journeyDetail(journey));
}));

router.post("/ujk/journeys/:id/review", guarded(async (req, res, actor) => {
  const parsed = api.CreateUjkReviewBody.safeParse(req.body);
  if (!parsed.success) throw new UjkError(400, "Isi empat kriteria, keputusan, masa berlaku dan alasan review minimal 10 karakter.");
  const data = parsed.data;
  const journey = await assignedJourney(String(req.params.id), actor);
  const until = new Date(data.validUntil);
  if (!Number.isFinite(until.getTime()) || (data.accepted && until <= new Date())) throw new UjkError(400, "Persetujuan harus mempunyai batas waktu berlaku di masa depan.");
  if (data.accepted && !(data.valid && data.authentic && data.current && data.sufficient)) throw new UjkError(400, "Persetujuan memerlukan seluruh kriteria valid, asli, terkini, dan memadai.");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM ujk_journeys WHERE id = ${journey.id} FOR UPDATE`);
    const events = await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
    const access = reviewAccess(events);
    if (!isReviewAuthorized(journey.ownerId, actor, access)) throw new UjkError(403, "Penugasan atau persetujuan akses tidak aktif.");
    if (events.at(-1)?.id !== data.expectedEventId) throw new UjkError(409, "Kasus berubah. Muat ulang dan tinjau kembali sebelum memutuskan.");
    const [scheme] = await tx.select().from(ujkSchemes).where(eq(ujkSchemes.roleId, journey.roleId)).orderBy(desc(ujkSchemes.id)).limit(1);
    const schemeVerified = schemeIsCurrent(scheme, journey.unitCodes);
    if (data.accepted && !schemeVerified) throw new UjkError(409, "Skema belum terverifikasi atau tidak berlaku; persetujuan tidak dapat membuka kesiapan.");
    let unitCode: string | null = null;
    if (data.kind === "evidence_review") {
      if (!data.evidenceId || data.simulationId) throw new UjkError(400, "Pilih satu bukti privat untuk ditinjau.");
      const [file] = await tx.select().from(ujkUploads).where(and(eq(ujkUploads.id, data.evidenceId), eq(ujkUploads.journeyId, journey.id), eq(ujkUploads.finalized, true)));
      if (!file) throw new UjkError(404, "Bukti kasus tidak ditemukan.");
      unitCode = file.unitCode;
    } else {
      const submission = [...events].reverse().find(e => e.kind === "simulation_submission");
      if (!submission || submission.id !== data.simulationId || data.evidenceId) throw new UjkError(409, "Tinjau pengajuan simulasi terbaru.");
      if (data.accepted && submission.payload.schemeId !== String(scheme?.id)) throw new UjkError(409, "Paket skema berubah; peserta harus mengajukan simulasi ulang.");
      if (data.accepted && submission.payload.practiceSnapshot !== simulationWorkFingerprint(events)) throw new UjkError(409, "Latihan, K3 atau bukti berubah sejak pengajuan; peserta harus mengajukan simulasi ulang.");
    }
    await tx.insert(ujkEvents).values({
      journeyId: journey.id, kind: data.kind, unitCode,
      summary: `${data.kind === "evidence_review" ? "Review bukti" : "Review simulasi"} ${data.accepted ? "diterima" : "ditolak"}: ${data.reason}`,
      payload: { ...data, actorId: actor, assignmentId: access.assignmentId, consentId: access.consentId, schemeId: schemeVerified ? String(scheme.id) : null, fingerprint: simulationFingerprint(events, schemeVerified ? String(scheme.id) : null) },
    });
  });
  res.json(await journeyDetail(journey));
}));

export default router;

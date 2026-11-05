import { createHash, randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db, ujkAttempts, ujkEvents, type UjkJourney } from "@workspace/db";
import { CreatePracticeTurnBody, CreatePracticeTurnResponse } from "@workspace/api-zod";
import { ownedJourney, requireJourneyUnit, UjkError } from "./ujk-service";

type Input = typeof CreatePracticeTurnBody._output;
type Result = typeof CreatePracticeTurnResponse._output;
export type Journal = { journey: UjkJourney; owner: string; attemptId: string; executionId: string };
type JournalStore = Pick<typeof db, "select" | "insert" | "update" | "transaction">;

export async function prepareJournal(input: Input, owner: string | null, store: JournalStore = db) {
  if (!input.journeyId) {
    if (input.attemptId) throw new UjkError(400, "Identitas percobaan harus terkait jalur persiapan.");
    return { journal: null, cached: null };
  }
  if (!owner) throw new UjkError(401, "Masuk untuk menyimpan latihan ke paspor.");
  if (!input.attemptId) throw new UjkError(400, "Identitas percobaan latihan diperlukan.");
  const journey = await ownedJourney(input.journeyId, owner, store);
  if (journey.roleId !== input.roleId) throw new UjkError(400, "Jabatan tidak sesuai dengan jalur persiapan.");
  requireJourneyUnit(journey, input.unitCode);
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const [claimed] = await store.insert(ujkAttempts).values({
    id: input.attemptId, ownerId: owner, journeyId: journey.id, fingerprint,
  }).onConflictDoNothing().returning();
  const journal = { journey, owner, attemptId: input.attemptId };
  if (claimed) return { journal: { ...journal, executionId: claimed.executionId }, cached: null };
  const [existing] = await store.select().from(ujkAttempts).where(and(eq(ujkAttempts.id, input.attemptId), eq(ujkAttempts.ownerId, owner)));
  if (!existing) throw new UjkError(404, "Percobaan tidak ditemukan.");
  if (existing.fingerprint !== fingerprint || existing.journeyId !== journey.id) throw new UjkError(409, "Identitas percobaan sudah dipakai untuk masukan lain.");
  if (existing.state === "complete") return { journal: null, cached: CreatePracticeTurnResponse.parse(existing.response) };
  if (existing.state === "pending" && Date.now() - existing.createdAt.getTime() < 600000) throw new UjkError(409, "Latihan ini masih diproses. Tunggu sebelum mencoba kembali.");
  const [retry] = await store.update(ujkAttempts).set({ state: "pending", createdAt: new Date(), executionId: randomUUID() }).where(and(
    eq(ujkAttempts.id, existing.id), eq(ujkAttempts.state, existing.state),
    eq(ujkAttempts.executionId, existing.executionId),
    // PostgreSQL stores microseconds; JS Date round-trips only milliseconds.
    // Use a stale cutoff instead of exact timestamp equality. The first claimant
    // refreshes createdAt (or changes failed -> pending), excluding other retries.
    existing.state === "pending" ? lte(ujkAttempts.createdAt, new Date(Date.now() - 600000)) : undefined,
  )).returning();
  if (!retry) throw new UjkError(409, "Latihan ini sedang diproses.");
  return { journal: { ...journal, executionId: retry.executionId }, cached: null };
}

export async function failJournal(journal: Journal | null, store: JournalStore = db) {
  if (journal) await store.update(ujkAttempts).set({ state: "failed" }).where(and(
    eq(ujkAttempts.id, journal.attemptId), eq(ujkAttempts.state, "pending"), eq(ujkAttempts.executionId, journal.executionId),
  ));
}

export async function completeJournal(journal: Journal | null, input: Input, result: Result, store: JournalStore = db) {
  if (!journal) return;
  await store.transaction(async tx => {
    const [completed] = await tx.update(ujkAttempts).set({ state: "complete", response: result }).where(and(
      eq(ujkAttempts.id, journal.attemptId), eq(ujkAttempts.state, "pending"), eq(ujkAttempts.executionId, journal.executionId),
    )).returning();
    if (!completed) throw new UjkError(409, "Hasil latihan belum dapat dicatat.");
    const question = [...input.history].reverse().find(message => message.role === "assistant")?.content ?? result.question;
    await tx.insert(ujkEvents).values({
      journeyId: journal.journey.id, unitCode: input.unitCode, kind: "practice",
      summary: input.action === "start" ? "Pertanyaan latihan AI dimulai." : `Jawaban latihan AI dicatat; skor tekstual ${result.evaluation?.score ?? "—"}, bukan keputusan kompetensi.`,
      payload: { action: input.action, attemptId: journal.attemptId, question, answer: input.answer ?? null, result },
    });
  });
}

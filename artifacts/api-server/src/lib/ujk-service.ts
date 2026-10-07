import { and, asc, eq } from "drizzle-orm";
import { db, ujkJourneys, ujkEvents, ujkUploads, type UjkJourney } from "@workspace/db";
import { GetUjkJourneyResponse, CreateUjkSelfAssessmentBody, CreatePracticeTurnResponse } from "@workspace/api-zod";
import { catalog } from "./competency-catalog";
import { determineReadiness, PRACTICE_THRESHOLD, safetyQuestions } from "./ujk-rules";

export class UjkError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function ownedJourney(id: string, ownerId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new UjkError(404, "Jalur persiapan tidak ditemukan.");
  const [journey] = await db.select().from(ujkJourneys).where(and(eq(ujkJourneys.id, id), eq(ujkJourneys.ownerId, ownerId)));
  if (!journey) throw new UjkError(404, "Jalur persiapan tidak ditemukan.");
  return journey;
}

export function requireJourneyUnit(journey: UjkJourney, code: string) {
  if (!journey.unitCodes.includes(code)) throw new UjkError(400, "Unit tidak termasuk dalam jalur persiapan ini.");
}

export async function journeyDetail(journey: UjkJourney) {
  const events = await db.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
  const files = await db.select().from(ujkUploads).where(and(eq(ujkUploads.journeyId, journey.id), eq(ujkUploads.finalized, true)));
  const units = journey.unitCodes.map(code => {
    const source = catalog.units.find(unit => unit.code === code);
    const self = [...events].reverse().find(event => event.kind === "self_assessment" && event.unitCode === code);
    const parsedSelf = CreateUjkSelfAssessmentBody.safeParse(self?.payload);
    const attempt = [...events].reverse().find(event => event.kind === "practice" && event.unitCode === code && event.payload.action === "answer");
    const parsedPractice = CreatePracticeTurnResponse.safeParse(attempt?.payload.result);
    const evidence = files.filter(file => file.unitCode === code);
    return {
      code, title: source?.title ?? code, learned: parsedSelf.success ? parsedSelf.data.learned : false,
      confidence: parsedSelf.success ? parsedSelf.data.confidence : "none",
      plan: parsedSelf.success ? parsedSelf.data.plan : "",
      lastScore: parsedPractice.success ? parsedPractice.data.evaluation?.score ?? null : null,
      gaps: parsedPractice.success ? parsedPractice.data.evaluation?.gaps ?? [] : [],
      safetyCritical: code === "F.41JGA00.001.1",
      evidenceCount: evidence.length,
      reviewedEvidenceCount: evidence.filter(file => file.reviewStatus === "accepted" && file.valid && file.authentic && file.current && file.sufficient).length,
    };
  });
  const lastSafety = [...events].reverse().find(event => event.kind === "safety");
  const safetyPassed = lastSafety?.payload.passed === true;
  const readiness = determineReadiness(units, safetyPassed, journey.schemeVerified, journey.simulationPassed);
  return GetUjkJourneyResponse.parse({
    journey: {
      id: journey.id, roleId: journey.roleId, title: catalog.roles.find(role => role.id === journey.roleId)?.title ?? journey.roleId,
      createdAt: journey.createdAt.toISOString(), status: readiness.status, schemeVerified: journey.schemeVerified,
      safetyPassed, learnedCount: units.filter(unit => unit.learned).length, unitCount: units.length,
    },
    units,
    evidence: files.map(file => ({
      id: file.id, unitCode: file.unitCode, title: file.title, description: file.description,
      fileName: file.fileName, size: file.size, contentType: file.contentType,
      createdAt: (file.finalizedAt ?? file.createdAt).toISOString(),
      downloadUrl: `/api/storage${file.objectPath}`, valid: file.valid, authentic: file.authentic,
      current: file.current, sufficient: file.sufficient, reviewStatus: file.reviewStatus,
    })),
    safetyQuestions: safetyQuestions.map(({ correct: _correct, ...question }) => question),
    blockers: readiness.blockers, threshold: PRACTICE_THRESHOLD, simulationPassed: journey.simulationPassed,
    ruleNote: "Ambang 75 dan gerbang K3 semua jawaban benar adalah aturan internal latihan, bukan ambang kelulusan LSP. K3 gagal selalu menahan kesiapan. Deklarasi bukti dan skor AI bukan keputusan kompetensi.",
    schemeNote: "Paket unit skema resmi belum diverifikasi. Bukti serta simulasi masih memerlukan review manusia. Fitur persetujuan reviewer/skema belum tersedia; peserta tidak dapat menyetujui sendiri. Gerbang K3 umum memakai rujukan historis SKKK 36-2022, bukan penetapan unit wajib untuk semua jabatan.",
  });
}

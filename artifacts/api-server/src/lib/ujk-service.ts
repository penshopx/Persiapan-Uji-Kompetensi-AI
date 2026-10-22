import { and, asc, eq } from "drizzle-orm";
import { db, ujkJourneys, ujkEvents, ujkUploads, type UjkJourney } from "@workspace/db";
import { GetUjkJourneyResponse, CreateUjkSelfAssessmentBody, CreatePracticeTurnResponse, CreateUjkReviewBody } from "@workspace/api-zod";
import { catalog } from "./competency-catalog";
import { determineReadiness, PRACTICE_THRESHOLD, safetyQuestions } from "./ujk-rules";
import { reviewAccess, reviewIsCurrent, simulationFingerprint, schemeIsCurrent } from "./ujk-review-state";
import { latestScheme, serializeScheme } from "./ujk-schemes";

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
  const scheme = await latestScheme(journey.roleId);
  const schemeVerified = schemeIsCurrent(scheme, journey.unitCodes);
  const schemeId = schemeVerified ? String(scheme.id) : null;
  const access = reviewAccess(events);
  const evidence = files.map(file => {
    const review = [...events].reverse().find(e => e.kind === "evidence_review" && e.payload.evidenceId === file.id);
    const parsed = CreateUjkReviewBody.safeParse(review?.payload);
    const effective = parsed.success && reviewIsCurrent(review!.payload, access, schemeId);
    return {
      id: file.id, unitCode: file.unitCode, title: file.title, description: file.description,
      fileName: file.fileName, size: file.size, contentType: file.contentType,
      createdAt: (file.finalizedAt ?? file.createdAt).toISOString(), downloadUrl: `/api/storage${file.objectPath}`,
      // Learner declarations never count as reviewer findings.
      valid: parsed.success ? parsed.data.valid : false, authentic: parsed.success ? parsed.data.authentic : false,
      current: parsed.success ? parsed.data.current : false, sufficient: parsed.success ? parsed.data.sufficient : false,
      reviewStatus: effective ? "accepted" : parsed.success && !parsed.data.accepted ? "rejected" : "pending",
      reviewReason: parsed.success ? parsed.data.reason : null, reviewValidUntil: parsed.success ? parsed.data.validUntil.toISOString() : null,
    };
  });
  const units = journey.unitCodes.map(code => {
    const source = catalog.units.find(unit => unit.code === code);
    const self = [...events].reverse().find(event => event.kind === "self_assessment" && event.unitCode === code);
    const parsedSelf = CreateUjkSelfAssessmentBody.safeParse(self?.payload);
    const attempt = [...events].reverse().find(event => event.kind === "practice" && event.unitCode === code && event.payload.action === "answer");
    const parsedPractice = CreatePracticeTurnResponse.safeParse(attempt?.payload.result);
    const unitEvidence = evidence.filter(file => file.unitCode === code);
    return {
      code, title: source?.title ?? code, learned: parsedSelf.success ? parsedSelf.data.learned : false,
      confidence: parsedSelf.success ? parsedSelf.data.confidence : "none",
      plan: parsedSelf.success ? parsedSelf.data.plan : "",
      lastScore: parsedPractice.success ? parsedPractice.data.evaluation?.score ?? null : null,
      gaps: parsedPractice.success ? parsedPractice.data.evaluation?.gaps ?? [] : [],
      safetyCritical: code === "F.41JGA00.001.1",
      evidenceCount: unitEvidence.length,
      reviewedEvidenceCount: unitEvidence.filter(file => file.reviewStatus === "accepted").length,
    };
  });
  const lastSafety = [...events].reverse().find(event => event.kind === "safety");
  const safetyPassed = lastSafety?.payload.passed === true;
  const submission = [...events].reverse().find(e => e.kind === "simulation_submission");
  const simulationReview = [...events].reverse().find(e => e.kind === "simulation_review");
  const parsedSimulationReview = CreateUjkReviewBody.safeParse(simulationReview?.payload);
  const simulationPassed = parsedSimulationReview.success && !!submission &&
    simulationReview!.payload.simulationId === submission.id &&
    simulationReview!.payload.fingerprint === simulationFingerprint(events, schemeId) &&
    reviewIsCurrent(simulationReview!.payload, access, schemeId);
  // A verified subset, not all units in a standards document, defines mandatory work.
  const requiredUnitCodes = schemeVerified ? scheme.unitCodes : [];
  const requiredUnits = schemeVerified ? units.filter(u => requiredUnitCodes.includes(u.code)) : units;
  const readiness = determineReadiness(requiredUnits, safetyPassed, schemeVerified, simulationPassed);
  return GetUjkJourneyResponse.parse({
    journey: {
      id: journey.id, roleId: journey.roleId, title: catalog.roles.find(role => role.id === journey.roleId)?.title ?? journey.roleId,
      createdAt: journey.createdAt.toISOString(), status: readiness.status, schemeVerified,
      safetyPassed, learnedCount: requiredUnits.filter(unit => unit.learned).length, unitCount: requiredUnits.length,
    },
    units,
    evidence,
    safetyQuestions: safetyQuestions.map(({ correct: _correct, ...question }) => question),
    blockers: readiness.blockers, threshold: PRACTICE_THRESHOLD, simulationPassed,
    scheme: scheme ? serializeScheme(scheme) : null, requiredUnitCodes,
    review: {
      ...access, lastEventId: events.at(-1)?.id ?? 0, simulationId: submission?.id ?? null,
      simulationReport: typeof submission?.payload.report === "string" ? submission.payload.report : null,
      simulationReason: parsedSimulationReview.success ? parsedSimulationReview.data.reason : null,
      simulationAttempts: Array.isArray(submission?.payload.attempts) ? submission.payload.attempts : [],
      decisions: events.filter(e => ["evidence_review", "simulation_review", "reviewer_assignment", "review_consent"].includes(e.kind)).map(e => ({
        id: e.id, kind: e.kind, actorId: String(e.payload.actorId ?? ""), reason: String(e.payload.reason ?? e.summary), createdAt: e.createdAt.toISOString(),
      })),
    },
    ruleNote: "Ambang 75 dan gerbang K3 semua jawaban benar adalah aturan internal latihan, bukan ambang kelulusan LSP. K3 gagal selalu menahan kesiapan. Deklarasi bukti dan skor AI bukan keputusan kompetensi.",
    schemeNote: schemeVerified ? `Paket wajib ${scheme.unitCodes.length} unit, versi ${scheme.version}, diverifikasi pengelola dari ${scheme.authority}. Unit rujukan di luar paket tidak wajib. Siap Diajukan hanya kondisi persiapan; keputusan K/BK tetap wewenang LSP.`
      : "Skema belum terverifikasi atau tidak berlaku. Daftar unit dokumen hanya rujukan, bukan paket wajib. Gerbang tetap tertutup; skor AI dan persetujuan peserta tidak menggantikan review manusia atau keputusan K/BK LSP.",
  });
}

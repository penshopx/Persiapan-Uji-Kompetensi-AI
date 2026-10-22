import { createHash } from "node:crypto";

type Event = { id: number; kind: string; payload: Record<string, unknown> };
export function reviewAccess(events: Event[]) {
  const assignment = [...events].reverse().find(e => e.kind === "reviewer_assignment");
  const reviewerId = typeof assignment?.payload.reviewerId === "string" && assignment.payload.reviewerId ? assignment.payload.reviewerId : null;
  const consent = [...events].reverse().find(e => e.kind === "review_consent");
  return {
    assignmentId: assignment?.id ?? null, reviewerId,
    consentId: consent?.id ?? null,
    consent: !!reviewerId && consent?.payload.assignmentId === assignment?.id && consent?.payload.consent === true,
  };
}

export function isReviewAuthorized(ownerId: string, actorId: string, access: ReturnType<typeof reviewAccess>) {
  return ownerId !== actorId && access.reviewerId === actorId && access.consent;
}

export function reviewIsCurrent(payload: Record<string, unknown>, access: ReturnType<typeof reviewAccess>, schemeId: string | null, now = new Date()) {
  return access.consent && !!schemeId && payload.schemeId === schemeId &&
    payload.assignmentId === access.assignmentId && payload.actorId === access.reviewerId &&
    payload.consentId === access.consentId &&
    payload.accepted === true && payload.valid === true && payload.authentic === true &&
    payload.current === true && payload.sufficient === true &&
    typeof payload.validUntil === "string" && new Date(payload.validUntil).getTime() > now.getTime();
}

// Any new learning, evidence, K3, or simulation changes invalidate simulation approval.
export function simulationFingerprint(events: Event[], schemeId: string | null) {
  const inputs = events.filter(e => ["self_assessment", "practice", "safety", "evidence", "simulation_submission", "evidence_review", "correction"].includes(e.kind)).map(e => e.id);
  return createHash("sha256").update(JSON.stringify({ schemeId, inputs })).digest("hex");
}

export function simulationWorkFingerprint(events: Event[]) {
  const inputs = events.filter(e => ["self_assessment", "practice", "safety", "evidence", "correction"].includes(e.kind)).map(e => e.id);
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

export function schemeIsCurrent(scheme: { status: string; validFrom: Date | null; validUntil: Date | null; unitCodes: string[] } | undefined, referenceCodes: string[], now = new Date()) {
  return !!scheme && scheme.status === "verified" && !!scheme.validFrom && !!scheme.validUntil && scheme.validFrom <= now && scheme.validUntil > now &&
    scheme.unitCodes.length > 0 && new Set(scheme.unitCodes).size === scheme.unitCodes.length &&
    scheme.unitCodes.every(code => referenceCodes.includes(code));
}

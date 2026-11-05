import { isReviewAuthorized, reviewAccess, reviewIsCurrent, simulationFingerprint } from "./ujk-review-state";

type Event = { id: number; kind: string; payload: Record<string, unknown>; createdAt: Date };
export type Delivery = { accountId: string; sourceEventId: number; kind: string; dedupeKey: string; deadline: Date | null };
const WINDOW = 7 * 24 * 60 * 60 * 1000;

export function eventDeliveries(ownerId: string, events: Event[], event: Event): Delivery[] {
  const make = (accountId: string, kind: string): Delivery => ({
    accountId, kind, sourceEventId: event.id, dedupeKey: `event:${event.id}:${kind}`, deadline: null,
  });
  if (event.kind === "reviewer_assignment") {
    const reviewer = event.payload.reviewerId;
    return typeof reviewer === "string" && reviewer && reviewer !== ownerId
      ? [make(ownerId, "consent_requested"), make(reviewer, "reviewer_assigned")] : [];
  }
  if (event.kind === "review_consent") {
    const access = reviewAccess(events.filter(e => e.id <= event.id));
    if (access.reviewerId && access.reviewerId !== ownerId && event.payload.assignmentId === access.assignmentId) {
      return [make(access.reviewerId, event.payload.consent === true ? "consent_granted" : "consent_revoked")];
    }
  }
  if (["evidence_review", "simulation_review"].includes(event.kind) && event.payload.accepted === false) {
    return [make(ownerId, event.kind === "evidence_review" ? "evidence_rejected" : "simulation_rejected")];
  }
  return [];
}

// Only latest, still applicable decisions produce reminders; expiry never grants access or readiness.
export function expiryDeliveries(ownerId: string, events: Event[], schemeId: string | null, now = new Date()): Delivery[] {
  const access = reviewAccess(events);
  const latest = new Map<string, Event>();
  for (const event of events) {
    if (event.kind === "evidence_review") latest.set(`evidence:${event.payload.evidenceId}`, event);
    if (event.kind === "simulation_review") latest.set("simulation", event);
  }
  const deliveries: Delivery[] = [];
  for (const event of latest.values()) {
    const deadline = new Date(String(event.payload.validUntil));
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() > now.getTime() + WINDOW) continue;
    // Test validity just before expiry to retain all non-time authorization gates.
    if (!reviewIsCurrent(event.payload, access, schemeId, new Date(deadline.getTime() - 1))) continue;
    if (event.kind === "simulation_review") {
      const submission = [...events].reverse().find(e => e.kind === "simulation_submission");
      if (!submission || event.payload.simulationId !== submission.id ||
        event.payload.fingerprint !== simulationFingerprint(events, schemeId)) continue;
    }
    const kind = `${event.kind === "evidence_review" ? "evidence" : "approval"}_${deadline <= now ? "expired" : "expiring"}`;
    for (const accountId of new Set([ownerId, access.reviewerId!])) {
      deliveries.push({ accountId, sourceEventId: event.id, kind, dedupeKey: `deadline:${event.id}:${kind}`, deadline });
    }
  }
  return deliveries;
}

export function notificationTarget(journeyId: string, ownerId: string, accountId: string, events: Event[], kind: string) {
  if (accountId === ownerId) return `/ujk/${journeyId}?tab=${kind.startsWith("evidence") ? "bukti" : "tinjau"}`;
  return isReviewAuthorized(ownerId, accountId, reviewAccess(events)) ? `/review/${journeyId}` : null;
}

export function notificationMessage(kind: string) {
  const messages: Record<string, string> = {
    consent_requested: "Persetujuan Anda diminta untuk penugasan reviewer baru.",
    reviewer_assigned: "Anda menerima penugasan reviewer. Akses kasus mengikuti persetujuan peserta yang masih aktif.",
    consent_granted: "Peserta memberikan persetujuan akses untuk penugasan Anda.",
    consent_revoked: "Persetujuan akses reviewer telah dicabut.",
    evidence_rejected: "Bukti ditolak. Buka jalur persiapan untuk melihat alasan dan memperbaikinya.",
    simulation_rejected: "Simulasi ditolak. Buka jalur persiapan untuk melihat alasan dan mengajukan ulang.",
    evidence_expiring: "Masa berlaku tinjauan bukti akan habis dalam tujuh hari. Tinjauan ulang diperlukan.",
    evidence_expired: "Masa berlaku tinjauan bukti telah habis. Tinjauan ulang diperlukan.",
    approval_expiring: "Persetujuan simulasi akan habis dalam tujuh hari. Tinjauan ulang diperlukan.",
    approval_expired: "Persetujuan simulasi telah kedaluwarsa. Tinjauan ulang diperlukan.",
  };
  return messages[kind] ?? "Ada pemberitahuan persiapan baru.";
}

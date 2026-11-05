import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isReviewAuthorized,
  reviewAccess,
  reviewIsCurrent,
  schemeIsCurrent,
  simulationFingerprint,
  simulationWorkFingerprint,
} from "../src/lib/ujk-review-state";

// Baseline review rules for reminder integration, not notification endpoint tests.
// Fixed instants avoid dependence on the machine's clock or local timezone.
const deadline = new Date("2026-11-05T17:00:00.000Z");
const before = new Date(deadline.getTime() - 1);
const after = new Date(deadline.getTime() + 1);
type Event = { id: number; kind: string; payload: Record<string, unknown> };
const events: Event[] = [
  { id: 1, kind: "reviewer_assignment", payload: { reviewerId: "reviewer" } },
  { id: 2, kind: "review_consent", payload: { assignmentId: 1, consent: true } },
  { id: 3, kind: "practice", payload: {} },
  { id: 4, kind: "simulation_submission", payload: {} },
];
const access = reviewAccess(events);
const approval = {
  assignmentId: 1, consentId: 2, actorId: "reviewer", schemeId: "scheme",
  accepted: true, valid: true, authentic: true, current: true, sufficient: true,
  validUntil: deadline.toISOString(),
};
const scheme = {
  status: "verified", validFrom: new Date(deadline.getTime() - 86400000),
  validUntil: deadline, unitCodes: ["unit"],
};

test("review expires at the exact deadline, not one millisecond later", () => {
  assert.equal(reviewIsCurrent(approval, access, "scheme", before), true);
  assert.equal(reviewIsCurrent(approval, access, "scheme", deadline), false);
  assert.equal(reviewIsCurrent(approval, access, "scheme", after), false);
});

test("UTC and Bangkok offset representations have identical expiry behavior", () => {
  const offsetApproval = { ...approval, validUntil: "2026-11-06T00:00:00.000+07:00" };
  for (const now of [before, deadline, after]) {
    assert.equal(
      reviewIsCurrent(offsetApproval, access, "scheme", now),
      reviewIsCurrent(approval, access, "scheme", now),
    );
  }
});

test("scheme expiration is exclusive and its start instant is inclusive", () => {
  assert.equal(schemeIsCurrent(scheme, ["unit"], before), true);
  assert.equal(schemeIsCurrent(scheme, ["unit"], deadline), false);
  assert.equal(schemeIsCurrent(scheme, ["unit"], after), false);
  assert.equal(schemeIsCurrent(scheme, ["unit"], scheme.validFrom), true);
  assert.equal(schemeIsCurrent(scheme, ["unit"], new Date(scheme.validFrom.getTime() - 1)), false);
});

test("revocation or reassignment blocks access before an approval expires", () => {
  const revoked = reviewAccess([
    ...events,
    { id: 5, kind: "review_consent", payload: { assignmentId: 1, consent: false } },
  ]);
  const reassigned = reviewAccess([
    ...events,
    { id: 5, kind: "reviewer_assignment", payload: { reviewerId: "replacement" } },
  ]);
  for (const state of [revoked, reassigned]) {
    assert.equal(isReviewAuthorized("participant", "reviewer", state), false);
    assert.equal(reviewIsCurrent(approval, state, "scheme", before), false);
  }
  assert.equal(isReviewAuthorized("participant", "replacement", reassigned), false);
});

test("bookkeeping cannot renew review consent, authority, or an expired approval", () => {
  // Synthetic bookkeeping examples exercise the event-kind allowlists. The
  // reminder implementation must still enforce ownership at its own API layer.
  for (const kind of ["notification_created", "notification_read", "notification_dismissed"]) {
    const updated = [...events, {
      id: 5, kind,
      payload: { reviewerId: "stranger", consent: true, accepted: true, validUntil: "2099-01-01T00:00:00Z" },
    }];
    assert.deepEqual(reviewAccess(updated), access);
    assert.equal(simulationFingerprint(updated, "scheme"), simulationFingerprint(events, "scheme"));
    assert.equal(simulationWorkFingerprint(updated), simulationWorkFingerprint(events));
    assert.equal(reviewIsCurrent(approval, reviewAccess(updated), "scheme", before), true);
    assert.equal(reviewIsCurrent(approval, reviewAccess(updated), "scheme", deadline), false);
    assert.equal(isReviewAuthorized("participant", "stranger", reviewAccess(updated)), false);
  }
});

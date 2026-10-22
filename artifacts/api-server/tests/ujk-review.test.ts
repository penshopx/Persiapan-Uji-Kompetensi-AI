import assert from "node:assert/strict";
import { reviewAccess, isReviewAuthorized, reviewIsCurrent, schemeIsCurrent, simulationFingerprint, simulationWorkFingerprint } from "../src/lib/ujk-review-state";

const now = new Date("2026-10-10T12:00:00Z");
const events = [
  { id: 1, kind: "reviewer_assignment", payload: { reviewerId: "reviewer", actorId: "manager" } },
  { id: 2, kind: "review_consent", payload: { assignmentId: 1, consent: true } },
];
const access = reviewAccess(events);
assert.ok(isReviewAuthorized("learner", "reviewer", access));
assert.ok(!isReviewAuthorized("reviewer", "reviewer", access), "No self approval");
assert.ok(!isReviewAuthorized("learner", "manager", access), "Manager has no blanket evidence access");
assert.ok(!isReviewAuthorized("learner", "stranger", access));
assert.ok(!reviewAccess(events.slice(0, 1)).consent, "Consent is required");
assert.ok(!reviewAccess([...events, { id: 3, kind: "reviewer_assignment", payload: { reviewerId: "other" } }]).consent, "Consent binds exact assignment");
const revoked = reviewAccess([...events, { id: 3, kind: "review_consent", payload: { assignmentId: 1, consent: false } }]);
assert.ok(!isReviewAuthorized("learner", "reviewer", revoked));
const payload = {
  assignmentId: 1, consentId: 2, actorId: "reviewer", schemeId: "1", accepted: true,
  valid: true, authentic: true, current: true, sufficient: true, validUntil: "2026-11-01T00:00:00Z",
};
assert.ok(reviewIsCurrent(payload, access, "1", now));
for (const field of ["valid", "authentic", "current", "sufficient", "accepted"]) {
  assert.ok(!reviewIsCurrent({ ...payload, [field]: false }, access, "1", now), `${field} is mandatory`);
}
assert.ok(!reviewIsCurrent(payload, access, null, now), "Unverified package cannot pass");
assert.ok(!reviewIsCurrent(payload, access, "2", now), "Revised package needs new review");
assert.ok(!reviewIsCurrent(payload, revoked, "1", now));
assert.ok(!reviewIsCurrent(payload, reviewAccess([...events, { id: 4, kind: "review_consent", payload: { assignmentId: 1, consent: true } }]), "1", now), "Regrant cannot revive old approval");
assert.ok(!reviewIsCurrent({ ...payload, validUntil: "garbage" }, access, "1", now));
assert.ok(!reviewIsCurrent({ ...payload, validUntil: now.toISOString() }, access, "1", now));
assert.ok(!reviewIsCurrent({ ...payload, actorId: "learner" }, access, "1", now));
const scheme = { status: "verified", validFrom: new Date("2026-01-01"), validUntil: new Date("2027-01-01"), unitCodes: ["unit1", "unit2"] };
assert.ok(schemeIsCurrent(scheme, ["unit1", "unit2", "reference-only"], now));
assert.ok(!schemeIsCurrent({ ...scheme, status: "unverified" }, scheme.unitCodes, now));
assert.ok(!schemeIsCurrent({ ...scheme, status: "withdrawn" }, scheme.unitCodes, now));
assert.ok(!schemeIsCurrent({ ...scheme, unitCodes: [] }, scheme.unitCodes, now));
assert.ok(!schemeIsCurrent({ ...scheme, unitCodes: ["unit1", "unknown"] }, scheme.unitCodes, now));
assert.ok(!schemeIsCurrent({ ...scheme, unitCodes: ["unit1", "unit1"] }, scheme.unitCodes, now));
assert.ok(!schemeIsCurrent({ ...scheme, validUntil: now }, scheme.unitCodes, now));
assert.ok(!schemeIsCurrent({ ...scheme, validFrom: null }, scheme.unitCodes, now));
assert.ok(!schemeIsCurrent({ ...scheme, validUntil: null }, scheme.unitCodes, now));
assert.ok(!schemeIsCurrent({ ...scheme, validFrom: new Date("2027-01-01") }, scheme.unitCodes, now));
const base = [...events, { id: 3, kind: "practice", payload: {} }, { id: 4, kind: "simulation_submission", payload: {} }];
const hash = simulationFingerprint(base, "1");
assert.equal(simulationFingerprint([...base, { id: 5, kind: "simulation_review", payload: {} }], "1"), hash, "Decision doesn't invalidate itself");
for (const kind of ["practice", "safety", "self_assessment", "evidence", "evidence_review", "simulation_submission", "correction"]) {
  assert.notEqual(simulationFingerprint([...base, { id: 6, kind, payload: {} }], "1"), hash, `New ${kind} invalidates simulation`);
}
assert.notEqual(simulationFingerprint(base, "2"), hash);
assert.equal(simulationWorkFingerprint([...base, { id: 7, kind: "evidence_review", payload: {} }]), simulationWorkFingerprint(base), "Reviewer may finish evidence after submission");
assert.notEqual(simulationWorkFingerprint([...base, { id: 8, kind: "safety", payload: { passed: false } }]), simulationWorkFingerprint(base));
console.log("UJK consent, scoped authorization, package validity, four evidence criteria and simulation snapshot regression checks passed.");

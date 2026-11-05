import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, ujkJourneys, ujkEvents, ujkSchemes, ujkUploads } from "@workspace/db";
import { catalog } from "../src/lib/competency-catalog";
import { journeyDetail, ownedJourney } from "../src/lib/ujk-service";
import { packageManifest } from "../src/lib/preparation-package";

const rollback = new Error("ROLLBACK_TEST_FIXTURE");
try {
  await db.transaction(async tx => {
    const role = catalog.roles.find(r => r.practiceAvailable)!;
    const code = catalog.units.find(u => u.standardId === role.standardId)!.code;
    const owner = `export-fixture-${randomUUID()}`;
    const now = new Date("2026-11-05T12:00:00Z");
    const until = new Date("2026-11-05T12:01:00Z");
    const [journey] = await tx.insert(ujkJourneys).values({ ownerId: owner, roleId: role.id, unitCodes: [code] }).returning();
    const [scheme] = await tx.insert(ujkSchemes).values({
      roleId: role.id, version: "test-only-rollback", status: "verified", authority: "Test fixture",
      sourceUrl: "https://example.com/test-only", sourceHash: "test-fixture", sourceLocator: "fixture",
      validFrom: new Date("2026-01-01"), validUntil: until, unitCodes: [code], reason: "Rollback fixture", checkedBy: owner,
    }).returning();
    const [file] = await tx.insert(ujkUploads).values({
      ownerId: owner, journeyId: journey.id, unitCode: code, objectPath: `/objects/test/${randomUUID()}`,
      fileName: "test.pdf", contentType: "application/pdf", size: 1, finalized: true, title: "Test-only",
    }).returning();
    const [assignment] = await tx.insert(ujkEvents).values({ journeyId: journey.id, kind: "reviewer_assignment", summary: "test", payload: { reviewerId: "test-reviewer" } }).returning();
    const [consent] = await tx.insert(ujkEvents).values({ journeyId: journey.id, kind: "review_consent", summary: "test", payload: { assignmentId: assignment.id, consent: true } }).returning();
    const [finding] = await tx.insert(ujkEvents).values({
      journeyId: journey.id, kind: "evidence_review", unitCode: code, summary: "test",
      payload: { kind: "evidence_review", evidenceId: file.id, expectedEventId: consent.id, accepted: true,
        valid: true, authentic: true, current: true, sufficient: true, reason: "Test fixture reason",
        validUntil: until.toISOString(), actorId: "test-reviewer", assignmentId: assignment.id, consentId: consent.id, schemeId: String(scheme.id) },
    }).returning();
    assert.equal((await ownedJourney(journey.id, owner, tx)).id, journey.id);
    await assert.rejects(ownedJourney(journey.id, "different-owner", tx), (e: unknown) => (e as { status: number }).status === 404);
    const captured = await journeyDetail(journey, tx, now);
    assert.deepEqual(captured.requiredUnitCodes, [code], "Scheme must come from transaction, not outside it");
    assert.equal(captured.scheme?.id, String(scheme.id));
    assert.equal(captured.evidence[0].reviewStatus, "accepted");
    assert.equal(captured.review.lastEventId, finding.id);
    const manifest = packageManifest(captured, [file.id], [assignment, consent, finding], now, randomUUID());
    await tx.insert(ujkEvents).values({ journeyId: journey.id, kind: "safety", summary: "failed later", payload: { passed: false } });
    const later = await journeyDetail(journey, tx, until);
    assert.equal(later.journey.schemeVerified, false, "Expiry re-evaluates at supplied clock");
    assert.equal(later.evidence[0].reviewStatus, "pending");
    assert.equal(manifest.scheme?.status, "verified", "Old snapshot must not mutate when current state changes");
    assert.equal(manifest.evidence[0].reviewStatus, "accepted");
    assert.equal(manifest.simulation.lastEventId, finding.id);
    throw rollback;
  }, { isolationLevel: "repeatable read" });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await pool.end();
}
console.log("Transactional preparation snapshot, owner isolation, expiry clock, and immutable manifest verified.");

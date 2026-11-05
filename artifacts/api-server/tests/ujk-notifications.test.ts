import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, pool, ujkEvents, ujkJourneys, ujkNotifications, ujkNotificationReads } from "@workspace/db";
import { eventDeliveries, expiryDeliveries, notificationMessage, notificationTarget } from "../src/lib/ujk-notification-rules";
import { deliverReviewEvent, saveDeliveries } from "../src/lib/ujk-notifications";
import { reviewAccess, reviewIsCurrent, simulationFingerprint } from "../src/lib/ujk-review-state";
import { GetUjkNotificationsResponse } from "@workspace/api-zod";

const now = new Date("2026-11-05T12:00:00Z");
const owner = "participant", reviewer = "reviewer";
const event = (id: number, kind: string, payload: Record<string, unknown>) => ({ id, kind, payload, createdAt: now });
const assignment = event(1, "reviewer_assignment", { reviewerId: reviewer, reason: "private-case-reason" });
const consent = event(2, "review_consent", { assignmentId: 1, consent: true });
const accessEvents = [assignment, consent];
const payload = {
  assignmentId: 1, consentId: 2, actorId: reviewer, schemeId: "1", accepted: true,
  valid: true, authentic: true, current: true, sufficient: true,
  validUntil: new Date(now.getTime() + 7 * 86400000).toISOString(), evidenceId: randomUUID(),
};
const evidence = event(3, "evidence_review", payload);
assert.deepEqual(eventDeliveries(owner, [assignment], assignment).map(d => [d.accountId, d.kind]), [
  [owner, "consent_requested"], [reviewer, "reviewer_assigned"],
]);
assert.equal(eventDeliveries(owner, accessEvents, consent)[0].kind, "consent_granted");
const rejected = event(4, "evidence_review", { ...payload, accepted: false });
assert.equal(eventDeliveries(owner, [...accessEvents, rejected], rejected)[0].kind, "evidence_rejected");
assert.equal(eventDeliveries(owner, [], event(5, "simulation_review", { accepted: false }))[0].kind, "simulation_rejected");
assert.equal(eventDeliveries(owner, [], event(6, "practice", {})).length, 0);
assert.equal(eventDeliveries(owner, [], event(6, "reviewer_assignment", { reviewerId: "" })).length, 0);
const events = [...accessEvents, evidence];
assert.equal(expiryDeliveries(owner, events, "1", new Date(now.getTime() - 1)).length, 0, "No reminder before seven-day window");
const reminders = expiryDeliveries(owner, events, "1", now);
assert.equal(reminders.length, 2);
assert.ok(reminders.every(d => d.kind === "evidence_expiring"));
assert.equal(expiryDeliveries(owner, events, null, now).length, 0, "Unverified scheme grants nothing");
assert.equal(expiryDeliveries(owner, [...events, rejected], "1", now).length, 0, "New rejection supersedes earlier approval");
const expiry = new Date(payload.validUntil);
assert.ok(expiryDeliveries(owner, events, "1", expiry).every(d => d.kind === "evidence_expired"));
assert.ok(!reviewIsCurrent(payload, reviewAccess(events), "1", expiry), "Deadline notification cannot activate readiness");
const revoked = [...events, event(7, "review_consent", { assignmentId: 1, consent: false })];
assert.equal(expiryDeliveries(owner, revoked, "1", now).length, 0);
const reassigned = [...events, event(8, "reviewer_assignment", { reviewerId: "other-reviewer" })];
assert.equal(expiryDeliveries(owner, reassigned, "1", now).length, 0);
assert.equal(notificationTarget("case", owner, reviewer, [assignment], "reviewer_assigned"), null, "Pre-consent assignment reveals no case destination");
assert.equal(notificationTarget("case", owner, reviewer, events, "consent_granted"), "/review/case");
assert.equal(notificationTarget("case", owner, reviewer, revoked, "consent_granted"), null);
assert.equal(notificationTarget("case", owner, reviewer, reassigned, "reviewer_assigned"), null);
assert.equal(notificationTarget("case", owner, "manager", events, "reviewer_assigned"), null);
assert.equal(notificationTarget("case", owner, "stranger", events, "reviewer_assigned"), null);
assert.equal(notificationTarget("case", owner, owner, revoked, "evidence_rejected"), "/ujk/case?tab=bukti");
assert.equal(notificationTarget("case", owner, owner, events, "consent_requested"), "/ujk/case?tab=tinjau");
const submission = event(9, "simulation_submission", {});
const simulationEvents = [...events, submission];
const simulation = event(10, "simulation_review", {
  ...payload, simulationId: 9, fingerprint: simulationFingerprint(simulationEvents, "1"),
});
assert.equal(expiryDeliveries(owner, [...simulationEvents, simulation], "1", now).filter(d => d.kind === "approval_expiring").length, 2);
assert.equal(expiryDeliveries(owner, [...simulationEvents, simulation, event(11, "safety", { passed: false })], "1", now).filter(d => d.kind === "approval_expiring").length, 0);
for (const d of reminders) assert.ok(!notificationMessage(d.kind).includes("private-case-reason"));
GetUjkNotificationsResponse.parse({ items: [], unreadCount: 0, nextCursor: null });

// Real DB delivery and receipts in a rolled-back fixture: never mutate user history.
const rollback = new Error("ROLLBACK_NOTIFICATION_TEST");
try {
  await db.transaction(async tx => {
    const accountId = `notification-test-${randomUUID()}`;
    const [journey] = await tx.insert(ujkJourneys).values({ ownerId: accountId, roleId: "asisten-arsitek", unitCodes: [] }).returning();
    const [assigned] = await tx.insert(ujkEvents).values({
      journeyId: journey.id, kind: "reviewer_assignment", summary: "Test-only assignment",
      payload: { reviewerId: `reviewer-${accountId}` },
    }).returning();
    await deliverReviewEvent(tx, journey, assigned);
    await deliverReviewEvent(tx, journey, assigned);
    const rows = await tx.select().from(ujkNotifications).where(eq(ujkNotifications.journeyId, journey.id));
    assert.equal(rows.length, 2, "Retries deliver once to each account");
    assert.equal(rows.filter(r => r.accountId === accountId).length, 1);
    const n = rows.find(r => r.accountId === accountId)!;
    const [foreign] = await tx.select().from(ujkNotifications).where(and(eq(ujkNotifications.id, n.id), eq(ujkNotifications.accountId, "stranger")));
    assert.equal(foreign, undefined, "Account ownership predicate hides foreign message");
    const before = await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id));
    await tx.insert(ujkNotificationReads).values({ accountId, notificationId: n.id }).onConflictDoNothing();
    await tx.insert(ujkNotificationReads).values({ accountId, notificationId: n.id }).onConflictDoNothing();
    const receipts = await tx.select().from(ujkNotificationReads).where(eq(ujkNotificationReads.notificationId, n.id));
    assert.equal(receipts.length, 1);
    assert.deepEqual(await tx.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)), before, "Mark-read never touches append-only audit");
    await saveDeliveries(tx, journey.id, [
      { accountId, sourceEventId: assigned.id, kind: "evidence_expiring", dedupeKey: `test:${assigned.id}`, deadline: now },
    ]);
    // The DB guard itself must reject mutations, not just application conventions.
    await tx.execute(sql`SAVEPOINT guard_check`);
    let guarded = false;
    try { await tx.execute(sql`UPDATE ujk_notifications SET kind = kind WHERE id = ${n.id}`); }
    catch (error) { guarded = /append-only/.test(String((error as { cause?: Error }).cause?.message)); }
    await tx.execute(sql`ROLLBACK TO SAVEPOINT guard_check`);
    assert.ok(guarded);
    throw rollback;
  });
} catch (error) { if (error !== rollback) throw error; }
finally { await pool.end(); }
console.log("Notification recipients, deadlines, revocation-safe targets, idempotent DB delivery and isolated read receipts passed.");

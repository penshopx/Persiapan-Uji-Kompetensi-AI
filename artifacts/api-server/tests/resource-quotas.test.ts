import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import * as schema from "../../../lib/db/src/schema/index";
import { DAY, HOUR, LIMITS, QuotaError, databaseNow, quotaWindow, releaseAi, reserveAi } from "../src/lib/resource-quotas";
import { reserveUpload, frozenUploadPath } from "../src/lib/ujk-upload-quota";
import { cleanupStaging } from "../src/lib/staging-cleanup";
import { finalizeEvidence } from "../src/lib/ujk-evidence";
import { ObjectStorageService } from "../src/lib/objectStorage";
import { UjkError } from "../src/lib/ujk-service";
import { catalog } from "../src/lib/competency-catalog";
import { prepareJournal, completeJournal } from "../src/lib/ujk-practice-journal";
import { CreatePracticeTurnResponse } from "@workspace/api-zod";

// Real independent DB sessions, isolated tables. No participant data or paid AI/storage.
const name = `quota_test_${randomUUID().replaceAll("-", "")}`;
const clients = await Promise.all([pool.connect(), pool.connect()]);
const [a, b] = clients.map(client => drizzle(client, { schema }));
const { resourceQuotas, aiLeases, ujkUploads, ujkEvents, ujkJourneys } = schema;
const quota = (error: unknown) => error instanceof QuotaError && error.retryAfter > 0;
const rejected = (results: PromiseSettledResult<unknown>[]) => results.filter(r => r.status === "rejected");
const owner = "test-account";
const MiB = 1024 * 1024;
let now: number;

async function seedQuota(key: string, requests: number, bytes = 0) {
  await a.insert(resourceQuotas).values({ key, requests, bytes, expiresAt: new Date(now + DAY) });
}
async function reset() {
  // Only disposable isolated tables, never public participant tables.
  await a.execute(sql.raw(`truncate ${name}.resource_quotas, ${name}.ai_leases, ${name}.ujk_uploads, ${name}.ujk_events, ${name}.ujk_attempts`));
  now = await a.transaction(databaseNow);
}

// Minimal storage double exercises copy generations, private ACL and deletion targets.
const objects = new Map<string, { size: number; contentType: string; generation: string }>();
const deleted: string[] = [];
let copies = 0, failAcl = false, failDelete = false;
function handle(path: string, generation?: string): any {
  return {
    name: path,
    bucket: { file: (p: string, options?: { generation?: string }) => handle(p, options?.generation) },
    exists: async () => [objects.has(path)],
    getMetadata: async () => {
      assert.ok(objects.has(path), `Missing test object ${path}`);
      return [objects.get(path)];
    },
    copy: async (dest: { name: string }, options: unknown) => {
      assert.deepEqual(options, { preconditionOpts: { ifGenerationMatch: 0 } });
      assert.equal(generation, objects.get(path)?.generation, "Copies the inspected source generation");
      assert.ok(!objects.has(dest.name), "Never overwrite a snapshot");
      objects.set(dest.name, { ...objects.get(path)! }); copies++;
    },
    delete: async (options: unknown) => {
      assert.deepEqual(options, { ignoreNotFound: true });
      if (failDelete) throw new Error("Test storage unavailable");
      deleted.push(path); objects.delete(path);
    },
  };
}
const storage = {
  getObjectEntityHandle: (path: string) => handle(path),
  getObjectEntityFile: async (path: string) => handle(path),
  trySetObjectEntityAclPolicy: async (path: string, acl: unknown) => {
    assert.deepEqual(acl, { owner, visibility: "private" });
    if (failAcl) throw new Error("Test crash after copy");
    return path;
  },
} as unknown as ObjectStorageService;

try {
  await db.execute(sql.raw(`create schema ${name}`));
  for (const table of ["resource_quotas", "ai_leases", "ujk_uploads", "ujk_events", "ujk_attempts", "ujk_journeys"]) {
    await db.execute(sql.raw(`create table ${name}.${table} (like public.${table} including defaults including indexes)`));
  }
  for (const client of clients) await client.query(`set search_path to ${name}, public`);
  await reset();
  assert.deepEqual(quotaWindow(HOUR - 1, HOUR), { start: 0, end: HOUR });
  assert.deepEqual(quotaWindow(HOUR, HOUR), { start: HOUR, end: 2 * HOUR });
  assert.deepEqual(quotaWindow(DAY, DAY), { start: DAY, end: 2 * DAY });
  const role = catalog.roles.find(r => r.practiceAvailable)!;
  const unit = catalog.units.find(u => u.standardId === role.standardId)!;
  const [journey] = await a.insert(ujkJourneys).values({ ownerId: owner, roleId: role.id, unitCodes: [unit.code] }).returning();
  const input = { journeyId: journey.id, unitCode: unit.code, fileName: "bukti.pdf", size: MiB, contentType: "application/pdf" };
  const windows = () => ({ hour: quotaWindow(now, HOUR), day: quotaWindow(now, DAY) });

  // Boundary and cross-replica race: exactly one last hourly slot.
  await seedQuota(`ai:hour:account:${owner}:${windows().hour.start}`, 19);
  let race = await Promise.allSettled([reserveAi(owner, "", a), reserveAi(owner, "", b)]);
  assert.equal(rejected(race).length, 1);
  assert.ok(quota((rejected(race)[0] as PromiseRejectedResult).reason));
  assert.equal((await a.select().from(resourceQuotas).where(eq(resourceQuotas.key, `ai:day:${windows().day.start}`)))[0].requests, 1);
  for (const r of race) if (r.status === "fulfilled") await releaseAi(r.value, b);
  // A new store/session still sees the exhausted account quota.
  await assert.rejects(reserveAi(owner, "", b), quota);

  await reset();
  await seedQuota(`ai:day:${windows().day.start}`, 199);
  race = await Promise.allSettled([reserveAi("one", "", a), reserveAi("two", "", b)]);
  assert.equal(rejected(race).length, 1, "Global day cap is shared");
  assert.equal((await a.select().from(resourceQuotas)).length, 2, "Denied account increment rolled back");
  await reset();
  const leases = await Promise.all([reserveAi("a", "", a), reserveAi("b", "", b), reserveAi("c", "", a)]);
  await assert.rejects(reserveAi("d", "", b), quota);
  await releaseAi(leases[0], b);
  await reserveAi("d", "", b);
  await a.update(aiLeases).set({ expiresAt: new Date(now - 1) });
  await reserveAi("after-crash", "", b);
  await reset();
  const anonymous = await reserveAi(null, "test-address", a);
  assert.ok((await a.select().from(resourceQuotas)).some(q => q.key.startsWith("ai:hour:ip:") && !q.key.includes("test-address")));
  await releaseAi(anonymous, a);
  // Old windows do not prevent requests after reset.
  await reset();
  await seedQuota(`ai:hour:account:${owner}:${windows().hour.start - HOUR}`, 20);
  await seedQuota(`ai:day:${windows().day.start - DAY}`, 200);
  await releaseAi(await reserveAi(owner, "", b), b);

  // Count + byte + daily/hourly boundaries, across journeys and independent sessions.
  await reset();
  for (let i = 0; i < 4; i++) await reserveUpload(owner, input, a);
  const uploadRace = await Promise.allSettled([reserveUpload(owner, input, a), reserveUpload(owner, { ...input, journeyId: randomUUID() }, b)]);
  assert.equal(rejected(uploadRace).length, 1);
  assert.equal((await a.select().from(ujkUploads)).length, LIMITS.uploadPending);
  await reset();
  for (let i = 0; i < 3; i++) await reserveUpload(owner, { ...input, size: 10 * MiB }, a);
  await assert.rejects(reserveUpload(owner, { ...input, size: 1 }, b), quota);
  await reserveUpload("other-owner", input, b);
  await reset();
  await seedQuota(`upload:hour:${owner}:${windows().hour.start}`, 20);
  await assert.rejects(reserveUpload(owner, input, b), quota);
  assert.equal((await a.select().from(ujkUploads)).length, 0);
  await reset();
  await seedQuota(`upload:day:${owner}:${windows().day.start}`, 50);
  await assert.rejects(reserveUpload(owner, input, a), quota);
  assert.equal((await a.select().from(resourceQuotas)).length, 1, "Hourly quota rolled back on daily rejection");
  await reset();
  await seedQuota(`upload:day:${owner}:${windows().day.start}`, 1, 99 * MiB);
  const lastByte = await reserveUpload(owner, input, a);
  await assert.rejects(reserveUpload(owner, { ...input, size: 1 }, b), quota);
  assert.ok(lastByte.stagingPath);

  // Completed journal replay is before AI quota reservation: no extra charge/event.
  await reset();
  const practice = { journeyId: journey.id, attemptId: randomUUID(), roleId: role.id, unitCode: unit.code,
    action: "start" as const, mode: "practice" as const, history: [] };
  const result = CreatePracticeTurnResponse.parse({ response: "Latihan", question: "Pertanyaan?", evaluation: null, citations: [], agentRuns: [] });
  const first = await prepareJournal(practice, owner, a);
  const ai = await reserveAi(owner, "", a);
  await completeJournal(first.journal, practice, result, a);
  await releaseAi(ai, a);
  const counts = await a.select().from(resourceQuotas);
  assert.deepEqual((await prepareJournal(practice, owner, b)).cached, result);
  assert.deepEqual(await b.select().from(resourceQuotas), counts);
  assert.equal((await a.select().from(ujkEvents)).length, 1);

  // Actual finalizer: simultaneous retries create one private snapshot and event.
  await reset();
  const upload = await reserveUpload(owner, input, a);
  objects.set(upload.objectPath, { size: input.size, contentType: input.contentType, generation: "123" });
  const evidence = { uploadId: upload.id, title: "Bukti kerja", description: "Uraian kerja", valid: true, authentic: true, current: true, sufficient: true };
  await assert.rejects(finalizeEvidence("another-owner", journey, evidence, storage, b), e => e instanceof UjkError && e.status === 404);
  await Promise.all([finalizeEvidence(owner, journey, evidence, storage, a), finalizeEvidence(owner, journey, evidence, storage, b)]);
  assert.equal(copies, 1);
  assert.equal((await a.select().from(ujkEvents)).length, 1);
  const frozen = frozenUploadPath(upload.id);
  objects.set(upload.objectPath, { size: 900, contentType: input.contentType, generation: "124" });
  assert.equal(objects.get(frozen)?.size, input.size, "Reusing writable URL cannot mutate final evidence");
  await a.update(ujkUploads).set({ createdAt: new Date(now - 2 * DAY) });
  await cleanupStaging(storage, b);
  assert.ok(objects.has(frozen));
  assert.ok(!objects.has(upload.objectPath));
  await finalizeEvidence(owner, journey, evidence, storage, b);
  assert.equal((await a.select().from(ujkEvents)).length, 1);

  // A failed transaction after copying is recoverable; unused snapshot is tracked for cleanup.
  await reset(); objects.clear();
  const recoverable = await reserveUpload(owner, input, a);
  objects.set(recoverable.objectPath, { size: input.size, contentType: input.contentType, generation: "200" });
  failAcl = true;
  await assert.rejects(finalizeEvidence(owner, journey, { ...evidence, uploadId: recoverable.id }, storage, a));
  failAcl = false;
  const copiesBeforeRecovery = copies;
  await finalizeEvidence(owner, journey, { ...evidence, uploadId: recoverable.id }, storage, b);
  assert.equal(copies, copiesBeforeRecovery, "A retry reuses the crash-surviving private snapshot");
  assert.equal((await a.select().from(ujkEvents)).length, 1);

  await reset(); objects.clear(); deleted.length = 0;
  const pending = await reserveUpload(owner, input, a);
  objects.set(pending.objectPath, { size: input.size, contentType: input.contentType, generation: "234" });
  failAcl = true;
  await assert.rejects(finalizeEvidence(owner, journey, { ...evidence, uploadId: pending.id }, storage, a));
  failAcl = false;
  assert.equal((await a.select().from(ujkUploads))[0].finalized, false);
  assert.ok(objects.has(frozenUploadPath(pending.id)));
  await a.update(ujkUploads).set({ createdAt: new Date(now - 2 * DAY) });
  await assert.rejects(finalizeEvidence(owner, journey, { ...evidence, uploadId: pending.id }, storage, a), e => e instanceof UjkError && e.status === 410);
  failDelete = true;
  await assert.rejects(cleanupStaging(storage, b));
  assert.equal((await a.select().from(ujkUploads))[0].stagingCleanedAt, null);
  failDelete = false;
  await Promise.all([cleanupStaging(storage, a), cleanupStaging(storage, b)]);
  assert.ok(!objects.has(frozenUploadPath(pending.id)));
  assert.equal(deleted.length, 2, "Two workers do not clean the same reservation twice");
  assert.equal((await a.select().from(ujkUploads)).length, 1, "Cleanup keeps upload metadata");
  assert.equal(await cleanupStaging(storage, a), 0);

  // Cleanup skips a row held by the finalizer, and leaves fresh/legacy-final evidence alone.
  await reset(); deleted.length = 0;
  const locked = await reserveUpload(owner, input, a);
  await a.update(ujkUploads).set({ createdAt: new Date(now - 2 * DAY) });
  await a.transaction(async tx => {
    await tx.select().from(ujkUploads).where(eq(ujkUploads.id, locked.id)).for("update");
    assert.equal(await cleanupStaging(storage, b), 0);
  });
  await cleanupStaging(storage, b);
  await reserveUpload(owner, input, a);
  await a.insert(ujkUploads).values({ ...input, ownerId: owner, objectPath: "/objects/uploads/legacy.evidence-final", finalized: true, createdAt: new Date(now - 2 * DAY) });
  const deletedBefore = deleted.length;
  await cleanupStaging(storage, b);
  assert.equal(deleted.length, deletedBefore);
  console.log("PASS: persistent AI/account/global/concurrency caps, upload count/byte/pending quotas, journal cache, immutable finalization, crash/orphan/expiry cleanup and replica races");
} finally {
  for (const client of clients) {
    await client.query("reset search_path");
    client.release();
  }
  await db.execute(sql.raw(`drop schema if exists ${name} cascade`));
  await pool.end();
}

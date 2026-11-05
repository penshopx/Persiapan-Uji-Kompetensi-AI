import { createHash, randomUUID } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import { db, resourceQuotas, aiLeases } from "@workspace/db";
import { UjkError } from "./ujk-service";

export type QuotaStore = Pick<typeof db, "transaction" | "delete">;
export type QuotaTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const LIMITS = {
  aiHourly: 20, aiDailyGlobal: 200, aiConcurrentGlobal: 3,
  uploadHourly: 20, uploadDaily: 50, uploadDailyBytes: 100 * 1024 * 1024,
  uploadPending: 5, uploadPendingBytes: 30 * 1024 * 1024,
};

export class QuotaError extends UjkError {
  constructor(message: string, public retryAfter: number) { super(429, message); }
}

// Locks are transaction-scoped and work across processes, restarts and replicas.
export async function lockQuota(tx: QuotaTx, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

export async function databaseNow(tx: QuotaTx): Promise<number> {
  const result = await tx.execute(sql`select clock_timestamp() as now`);
  return new Date(result.rows[0].now as string).getTime();
}

export function quotaWindow(now: number, duration: number) {
  const start = Math.floor(now / duration) * duration;
  return { start, end: start + duration };
}

export async function chargeQuota(tx: QuotaTx, key: string, end: number, maxRequests: number, bytes = 0, maxBytes = Infinity, message = "Kuota tercapai.", now = Date.now()) {
  const [row] = await tx.select().from(resourceQuotas).where(eq(resourceQuotas.key, key));
  if ((row?.requests ?? 0) >= maxRequests || (row?.bytes ?? 0) + bytes > maxBytes) {
    throw new QuotaError(message, Math.max(1, Math.ceil((end - now) / 1000)));
  }
  await tx.insert(resourceQuotas).values({ key, requests: 1, bytes, expiresAt: new Date(end) })
    .onConflictDoUpdate({ target: resourceQuotas.key, set: {
      requests: sql`${resourceQuotas.requests} + 1`, bytes: sql`${resourceQuotas.bytes} + ${bytes}`,
    } });
}

export async function reserveAi(owner: string | null, ip: string, store: QuotaStore = db) {
  return store.transaction(async tx => {
    await lockQuota(tx, "ai:global");
    const now = await databaseNow(tx);
    const hour = quotaWindow(now, HOUR), day = quotaWindow(now, DAY);
    // Do not persist raw IP addresses. Anonymous requests still share the global cap.
    const identity = owner ? `account:${owner}` : `ip:${createHash("sha256").update(ip).digest("hex")}`;
    const [{ value: active }] = await tx.select({ value: count() }).from(aiLeases).where(gt(aiLeases.expiresAt, new Date(now)));
    if (active >= LIMITS.aiConcurrentGlobal) throw new QuotaError("Tiga latihan AI sedang diproses. Coba lagi dalam beberapa menit.", 60);
    await chargeQuota(tx, `ai:hour:${identity}:${hour.start}`, hour.end, LIMITS.aiHourly, 0, Infinity,
      "Kuota AI Anda tercapai: maksimal 20 giliran per jam. Coba setelah pergantian jam (UTC).", now);
    await chargeQuota(tx, `ai:day:${day.start}`, day.end, LIMITS.aiDailyGlobal, 0, Infinity,
      "Kuota AI seluruh layanan tercapai: 200 giliran per hari. Coba setelah pukul 00.00 UTC.", now);
    const id = randomUUID();
    // Whole-turn runtime deadline is 150s. Lease lasts 5m, allowing crashed workers to recover.
    await tx.insert(aiLeases).values({ id, expiresAt: new Date(now + 5 * 60000) });
    return id;
  });
}

export async function releaseAi(id: string, store: QuotaStore = db) {
  await store.delete(aiLeases).where(and(eq(aiLeases.id, id)));
}

import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, ujkUploads } from "@workspace/db";
import { DAY, HOUR, LIMITS, chargeQuota, databaseNow, lockQuota, QuotaError, quotaWindow, type QuotaStore } from "./resource-quotas";

type UploadInput = Pick<typeof ujkUploads.$inferInsert, "journeyId" | "unitCode" | "fileName" | "size" | "contentType">;
export const frozenUploadPath = (id: string) => `/objects/evidence/${id}`;

export async function reserveUpload(owner: string, input: UploadInput, store: QuotaStore = db) {
  return store.transaction(async tx => {
    await lockQuota(tx, `upload:${owner}`);
    const now = await databaseNow(tx), hour = quotaWindow(now, HOUR), day = quotaWindow(now, DAY);
    const [pending] = await tx.select({
      count: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${ujkUploads.size}), 0)::float8`,
    }).from(ujkUploads).where(and(eq(ujkUploads.ownerId, owner), eq(ujkUploads.finalized, false), isNull(ujkUploads.stagingCleanedAt)));
    if (pending.count >= LIMITS.uploadPending || pending.bytes + input.size > LIMITS.uploadPendingBytes) {
      throw new QuotaError("Kuota unggahan tertunda tercapai: maksimal 5 berkas atau 30 MB per akun. Selesaikan penyimpanan bukti; staging kedaluwarsa dibersihkan otomatis setelah 24 jam.", 3600);
    }
    await chargeQuota(tx, `upload:hour:${owner}:${hour.start}`, hour.end, LIMITS.uploadHourly, 0, Infinity,
      "Kuota permintaan unggahan tercapai: maksimal 20 per jam per akun. Coba setelah pergantian jam (UTC).", now);
    await chargeQuota(tx, `upload:day:${owner}:${day.start}`, day.end, LIMITS.uploadDaily, input.size, LIMITS.uploadDailyBytes,
      "Kuota unggahan harian tercapai: maksimal 50 permintaan atau 100 MB per akun. Coba setelah pukul 00.00 UTC.", now);
    const id = randomUUID(), stagingPath = `/objects/staging/${id}`;
    const [upload] = await tx.insert(ujkUploads).values({ ...input, id, ownerId: owner, objectPath: stagingPath, stagingPath }).returning();
    return upload;
  });
}

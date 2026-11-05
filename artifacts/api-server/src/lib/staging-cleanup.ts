import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, aiLeases, resourceQuotas, ujkUploads } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { DAY, databaseNow, type QuotaStore } from "./resource-quotas";
import { frozenUploadPath } from "./ujk-upload-quota";
import { logger } from "./logger";

// Bounded batches, row locks and SKIP LOCKED allow multiple replicas safely.
// No bucket-wide listing/deletion, no deletion of upload/event database history.
export async function cleanupStaging(storage = new ObjectStorageService(), store: QuotaStore = db, batchSize = 100) {
  let cleaned = 0;
  for (let i = 0; i < batchSize; i++) {
    const found = await store.transaction(async tx => {
      const now = await databaseNow(tx);
      const [upload] = await tx.select().from(ujkUploads).where(and(
        isNull(ujkUploads.stagingCleanedAt), lt(ujkUploads.createdAt, new Date(now - DAY)),
        // Legacy finalized uploads have no recorded staging path: leave them untouched.
        sql`(${ujkUploads.stagingPath} is not null or ${ujkUploads.finalized} = false)`,
      )).orderBy(ujkUploads.createdAt).limit(1).for("update", { skipLocked: true });
      if (!upload) return false;
      const staging = upload.stagingPath ?? upload.objectPath;
      // Only paths issued by this application, never a final evidence location.
      if (!/^\/objects\/(staging|uploads)\/[0-9a-f-]{36}$/.test(staging) || (upload.finalized && staging === upload.objectPath)) {
        throw new Error("Unsafe staging cleanup path");
      }
      await storage.getObjectEntityHandle(staging).delete({ ignoreNotFound: true });
      // A copy may have succeeded before a worker crashed/DB transaction rolled back.
      // The same row lock is held throughout finalization, so finalized evidence cannot race here.
      if (!upload.finalized) await storage.getObjectEntityHandle(frozenUploadPath(upload.id)).delete({ ignoreNotFound: true });
      await tx.update(ujkUploads).set({ stagingCleanedAt: new Date(now) }).where(eq(ujkUploads.id, upload.id));
      return true;
    });
    if (!found) break;
    cleaned++;
  }
  // Counter/lease expiry is also database-clock based. Never touches attempts/events.
  await store.delete(aiLeases).where(lt(aiLeases.expiresAt, sql`clock_timestamp()`));
  await store.delete(resourceQuotas).where(lt(resourceQuotas.expiresAt, sql`clock_timestamp() - interval '2 days'`));
  return cleaned;
}

export function startStagingCleanup() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const cleaned = await cleanupStaging();
      logger.info({ cleaned }, "Expired upload staging cleanup completed");
    } catch (error) {
      logger.error({ errorType: error instanceof Error ? error.name : "Unknown" }, "Staging cleanup failed; will retry without deleting history");
    } finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 3600000);
  timer.unref();
}

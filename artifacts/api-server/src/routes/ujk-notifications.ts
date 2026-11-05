import { Router } from "express";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, ujkEvents, ujkJourneys, ujkNotifications, ujkNotificationReads } from "@workspace/db";
import * as api from "@workspace/api-zod";
import { guarded } from "./ujk";
import { UjkError } from "../lib/ujk-service";
import { reconcileNotifications } from "../lib/ujk-notifications";
import { notificationMessage, notificationTarget } from "../lib/ujk-notification-rules";

const router = Router();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function ownedNotification(id: string, actor: string) {
  if (!uuid.test(id)) throw new UjkError(404, "Pemberitahuan tidak ditemukan.");
  const [row] = await db.select().from(ujkNotifications).where(and(eq(ujkNotifications.id, id), eq(ujkNotifications.accountId, actor)));
  if (!row) throw new UjkError(404, "Pemberitahuan tidak ditemukan.");
  return row;
}
async function target(row: typeof ujkNotifications.$inferSelect, actor: string) {
  const [journey] = await db.select().from(ujkJourneys).where(eq(ujkJourneys.id, row.journeyId));
  if (!journey) return null;
  const events = await db.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
  return notificationTarget(journey.id, journey.ownerId, actor, events, row.kind);
}

router.get("/ujk/notifications", guarded(async (req, res, actor) => {
  res.setHeader("Cache-Control", "private, no-store");
  let cursor: typeof ujkNotifications.$inferSelect | undefined;
  if (req.query.before !== undefined) {
    if (typeof req.query.before !== "string") throw new UjkError(400, "Kursor tidak valid.");
    cursor = await ownedNotification(req.query.before, actor);
  }
  await reconcileNotifications(actor);
  const rows = await db.select({ notification: ujkNotifications, read: ujkNotificationReads.readAt })
    .from(ujkNotifications).leftJoin(ujkNotificationReads, eq(ujkNotificationReads.notificationId, ujkNotifications.id))
    .where(and(eq(ujkNotifications.accountId, actor), cursor
      ? sql`(${ujkNotifications.createdAt}, ${ujkNotifications.id}) < (SELECT created_at, id FROM ujk_notifications WHERE id = ${cursor.id})` : undefined))
    .orderBy(desc(ujkNotifications.createdAt), desc(ujkNotifications.id)).limit(31);
  const [count] = await db.select({ total: sql<number>`count(*)::int` }).from(ujkNotifications)
    .leftJoin(ujkNotificationReads, eq(ujkNotificationReads.notificationId, ujkNotifications.id))
    .where(and(eq(ujkNotifications.accountId, actor), isNull(ujkNotificationReads.notificationId)));
  const items = await Promise.all(rows.slice(0, 30).map(async ({ notification: n, read }) => {
    const href = await target(n, actor);
    // Never return case IDs, actor identities, reasons, evidence titles or old destinations.
    return {
      id: n.id, kind: href ? n.kind : "unavailable",
      message: href ? notificationMessage(n.kind) : "Pemberitahuan tinjauan tersimpan. Akses kasus belum atau tidak lagi tersedia.",
      createdAt: n.createdAt.toISOString(), deadline: href ? n.deadline?.toISOString() ?? null : null,
      readAt: read?.toISOString() ?? null, canOpen: !!href,
    };
  }));
  res.json(api.GetUjkNotificationsResponse.parse({ items, unreadCount: count.total, nextCursor: rows.length > 30 ? rows[29].notification.id : null }));
}));

router.post("/ujk/notifications/:id/read", guarded(async (req, res, actor) => {
  res.setHeader("Cache-Control", "private, no-store");
  const n = await ownedNotification(String(req.params.id), actor);
  await db.insert(ujkNotificationReads).values({ notificationId: n.id, accountId: actor }).onConflictDoNothing();
  const [receipt] = await db.select().from(ujkNotificationReads).where(eq(ujkNotificationReads.notificationId, n.id));
  res.json(api.ReadUjkNotificationResponse.parse({ readAt: receipt.readAt.toISOString() }));
}));

router.get("/ujk/notifications/:id/open", guarded(async (req, res, actor) => {
  res.setHeader("Cache-Control", "private, no-store");
  const href = await target(await ownedNotification(String(req.params.id), actor), actor);
  if (!href) throw new UjkError(404, "Kasus tidak tersedia atau persetujuan akses tidak aktif.");
  res.json(api.OpenUjkNotificationResponse.parse({ href }));
}));

export default router;

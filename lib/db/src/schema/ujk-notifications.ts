import { pgTable, uuid, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { ujkJourneys } from "./ujk-journeys";
import { ujkEvents } from "./ujk-events";

// Immutable delivery records. Reading a message must never mutate audit history.
export const ujkNotifications = pgTable("ujk_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: text("account_id").notNull(),
  journeyId: uuid("journey_id").notNull().references(() => ujkJourneys.id),
  sourceEventId: integer("source_event_id").notNull().references(() => ujkEvents.id),
  kind: text("kind").notNull(),
  dedupeKey: text("dedupe_key").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("ujk_notification_delivery_unique").on(t.accountId, t.dedupeKey),
  index("ujk_notification_account_order").on(t.accountId, t.createdAt, t.id),
]);
export const ujkNotificationReads = pgTable("ujk_notification_reads", {
  notificationId: uuid("notification_id").primaryKey().references(() => ujkNotifications.id),
  accountId: text("account_id").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertUjkNotificationSchema = createInsertSchema(ujkNotifications).omit({ id: true, createdAt: true });
export type UjkNotification = typeof ujkNotifications.$inferSelect;

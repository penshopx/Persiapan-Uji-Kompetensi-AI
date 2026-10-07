import { pgTable, serial, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ujkJourneys } from "./ujk-journeys";

export const ujkEvents = pgTable("ujk_events", {
  id: serial("id").primaryKey(),
  journeyId: uuid("journey_id").notNull().references(() => ujkJourneys.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  unitCode: text("unit_code"),
  summary: text("summary").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("ujk_events_journey_order").on(t.journeyId, t.id)]);
export const insertUjkEventSchema = createInsertSchema(ujkEvents).omit({ id: true, createdAt: true });
export type InsertUjkEvent = z.infer<typeof insertUjkEventSchema>;
export type UjkEvent = typeof ujkEvents.$inferSelect;

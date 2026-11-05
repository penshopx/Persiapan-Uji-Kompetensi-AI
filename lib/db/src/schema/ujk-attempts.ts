import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ujkJourneys } from "./ujk-journeys";

export const ujkAttempts = pgTable("ujk_attempts", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  journeyId: uuid("journey_id").notNull().references(() => ujkJourneys.id, { onDelete: "restrict" }),
  fingerprint: text("fingerprint").notNull(),
  executionId: uuid("execution_id").notNull().defaultRandom(),
  state: text("state").notNull().default("pending"),
  response: jsonb("response").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const insertUjkAttemptSchema = createInsertSchema(ujkAttempts).omit({ createdAt: true });
export type InsertUjkAttempt = z.infer<typeof insertUjkAttemptSchema>;
export type UjkAttempt = typeof ujkAttempts.$inferSelect;

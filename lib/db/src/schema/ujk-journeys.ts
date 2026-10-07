import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ujkJourneys = pgTable("ujk_journeys", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  roleId: text("role_id").notNull(),
  unitCodes: text("unit_codes").array().notNull(),
  schemeVerified: boolean("scheme_verified").notNull().default(false),
  simulationPassed: boolean("simulation_passed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  consentAt: timestamp("consent_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("ujk_owner_role_unique").on(t.ownerId, t.roleId)]);
export const insertUjkJourneySchema = createInsertSchema(ujkJourneys).omit({ id: true, createdAt: true, consentAt: true });
export type InsertUjkJourney = z.infer<typeof insertUjkJourneySchema>;
export type UjkJourney = typeof ujkJourneys.$inferSelect;

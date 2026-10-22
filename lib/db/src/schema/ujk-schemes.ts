import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Revisions are only inserted. A withdrawal is a new revision, never a deletion.
export const ujkSchemes = pgTable("ujk_schemes", {
  id: serial("id").primaryKey(),
  roleId: text("role_id").notNull(),
  level: integer("level"),
  version: text("version").notNull(),
  authority: text("authority").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceHash: text("source_hash").notNull(),
  sourceLocator: text("source_locator").notNull(),
  status: text("status").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  unitCodes: text("unit_codes").array().notNull(),
  reason: text("reason").notNull(),
  checkedBy: text("checked_by").notNull(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("ujk_scheme_role_revision").on(t.roleId, t.id)]);
export const insertUjkSchemeSchema = createInsertSchema(ujkSchemes).omit({ id: true, checkedAt: true });
export type UjkSchemeRow = typeof ujkSchemes.$inferSelect;

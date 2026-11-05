import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { ujkJourneys } from "./ujk-journeys";

// No file bytes in PostgreSQL. Creation/revocation/download audits are append-only events.
export const ujkExports = pgTable("ujk_exports", {
  id: uuid("id").primaryKey(),
  journeyId: uuid("journey_id").notNull().references(() => ujkJourneys.id, { onDelete: "restrict" }),
  ownerId: text("owner_id").notNull(),
  objectPath: text("object_path").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  readinessStatus: text("readiness_status").notNull(),
  evidenceIds: text("evidence_ids").array().notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
}, t => [index("ujk_exports_owner_journey").on(t.ownerId, t.journeyId)]);
export type UjkExportRow = typeof ujkExports.$inferSelect;

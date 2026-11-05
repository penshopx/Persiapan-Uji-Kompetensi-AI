import { pgTable, uuid, text, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { ujkJourneys } from "./ujk-journeys";

export const ujkUploads = pgTable("ujk_uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  journeyId: uuid("journey_id").notNull().references(() => ujkJourneys.id, { onDelete: "restrict" }),
  unitCode: text("unit_code").notNull(),
  objectPath: text("object_path").notNull().unique(),
  // Preserve the original writable staging location after freezing evidence.
  stagingPath: text("staging_path"),
  stagingCleanedAt: timestamp("staging_cleaned_at", { withTimezone: true }),
  fileName: text("file_name").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  finalized: boolean("finalized").notNull().default(false),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  valid: boolean("valid").notNull().default(false),
  authentic: boolean("authentic").notNull().default(false),
  current: boolean("current").notNull().default(false),
  sufficient: boolean("sufficient").notNull().default(false),
  reviewStatus: text("review_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp("finalized_at", { withTimezone: true }),
}, table => [
  index("ujk_uploads_owner_pending_idx").on(table.ownerId, table.finalized, table.stagingCleanedAt),
  index("ujk_uploads_cleanup_idx").on(table.stagingCleanedAt, table.createdAt),
]);
export const insertUjkUploadSchema = createInsertSchema(ujkUploads).omit({ id: true, createdAt: true });
export type InsertUjkUpload = z.infer<typeof insertUjkUploadSchema>;
export type UjkUpload = typeof ujkUploads.$inferSelect;

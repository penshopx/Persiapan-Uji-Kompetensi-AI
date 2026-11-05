import { pgTable, text, integer, bigint, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const resourceQuotas = pgTable("resource_quotas", {
  key: text("key").primaryKey(),
  requests: integer("requests").notNull().default(0),
  bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const aiLeases = pgTable("ai_leases", {
  id: uuid("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const insertResourceQuotaSchema = createInsertSchema(resourceQuotas);
export type InsertResourceQuota = z.infer<typeof insertResourceQuotaSchema>;
export type ResourceQuota = typeof resourceQuotas.$inferSelect;
export const insertAiLeaseSchema = createInsertSchema(aiLeases);
export type InsertAiLease = z.infer<typeof insertAiLeaseSchema>;
export type AiLease = typeof aiLeases.$inferSelect;

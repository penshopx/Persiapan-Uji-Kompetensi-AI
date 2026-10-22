import assert from "node:assert/strict";
import { db, pool, ujkSchemes, ujkJourneys } from "@workspace/db";
import { sql } from "drizzle-orm";
import { journeyDetail } from "../src/lib/ujk-service";

try {
  for (const table of ["ujk_events", "ujk_schemes"]) {
    for (const statement of [`DELETE FROM ${table} WHERE false`, `UPDATE ${table} SET id = id WHERE false`, `TRUNCATE ${table}`]) {
      let rejected = false;
      try { await db.transaction(async tx => { await tx.execute(sql.raw(statement)); throw new Error("UNPROTECTED"); }); }
      catch (error) {
        const cause = (error as { cause?: Error }).cause;
        rejected = /append-only/.test(cause?.message ?? (error as Error).message);
      }
      assert.ok(rejected, `${table} must reject ${statement.split(" ")[0]}`);
    }
  }
  const rows = await db.select().from(ujkSchemes);
  const candidates = rows.filter(r => r.checkedBy === "source-research");
  assert.ok(candidates.length >= 4);
  assert.ok(candidates.every(r => r.status === "unverified" && r.validFrom === null && r.validUntil === null), "Source research must not fabricate a valid version");
  assert.equal(candidates.find(r => r.roleId === "asisten-arsitek")?.unitCodes.length, 6);
  assert.equal(candidates.find(r => r.roleId === "asisten-pemula-arsitek")?.unitCodes.length, 4);
  // Covers persisted decisions as well as pending evidence; never log private contents.
  const journeys = await db.select().from(ujkJourneys).limit(100);
  for (const journey of journeys) {
    const detail = await journeyDetail(journey);
    assert.ok(detail.evidence.every(e => e.reviewValidUntil === null || typeof e.reviewValidUntil === "string"), "Parsed Date findings must serialize back into ISO response strings");
  }
  console.log("Database append-only guards and honest candidate provenance verified.");
} finally { await pool.end(); }

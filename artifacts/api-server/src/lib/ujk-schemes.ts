import { desc, eq } from "drizzle-orm";
import { db, ujkSchemes, type UjkSchemeRow } from "@workspace/db";

export async function latestScheme(roleId: string, store: Pick<typeof db, "select"> = db) {
  const [row] = await store.select().from(ujkSchemes).where(eq(ujkSchemes.roleId, roleId)).orderBy(desc(ujkSchemes.id)).limit(1);
  return row;
}

export function serializeScheme(row: UjkSchemeRow, now = new Date()) {
  return {
    ...row, id: String(row.id), validFrom: row.validFrom?.toISOString() ?? null, validUntil: row.validUntil?.toISOString() ?? null,
    checkedAt: row.checkedAt.toISOString(),
    status: row.status === "verified" && (!row.validUntil || row.validUntil <= now) ? "expired"
      : row.status === "verified" && (!row.validFrom || row.validFrom > now) ? "unverified" : row.status,
  };
}

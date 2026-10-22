import { clerkClient } from "@clerk/express";
import { asc, eq } from "drizzle-orm";
import { db, ujkJourneys, ujkEvents } from "@workspace/db";
import { UjkError } from "./ujk-service";
import { isReviewAuthorized, reviewAccess } from "./ujk-review-state";

export async function isManager(actorId: string) {
  // Private metadata can only be set via Clerk's trusted server/admin interface.
  // Never read user-editable unsafeMetadata or a role sent by the browser.
  const user = await clerkClient.users.getUser(actorId);
  return user.privateMetadata.ujkRole === "manager";
}

export async function requireManager(actorId: string) {
  if (!await isManager(actorId)) throw new UjkError(403, "Hanya pengelola terotorisasi yang dapat menetapkan reviewer atau skema.");
}

export async function caseJourney(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new UjkError(404, "Kasus tidak ditemukan.");
  const [journey] = await db.select().from(ujkJourneys).where(eq(ujkJourneys.id, id));
  if (!journey) throw new UjkError(404, "Kasus tidak ditemukan.");
  return journey;
}

export async function assignedJourney(id: string, actorId: string) {
  const journey = await caseJourney(id);
  const events = await db.select().from(ujkEvents).where(eq(ujkEvents.journeyId, id)).orderBy(asc(ujkEvents.id));
  if (!isReviewAuthorized(journey.ownerId, actorId, reviewAccess(events))) throw new UjkError(404, "Kasus tidak ditemukan atau persetujuan akses tidak aktif.");
  return journey;
}

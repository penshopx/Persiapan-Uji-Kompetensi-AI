import { asc, desc, eq, gt, or, sql } from "drizzle-orm";
import { db, ujkEvents, ujkJourneys, ujkNotifications, ujkSchemes, type UjkJourney } from "@workspace/db";
import { eventDeliveries, expiryDeliveries, type Delivery } from "./ujk-notification-rules";
import { schemeIsCurrent } from "./ujk-review-state";
import { logger } from "./logger";

type Store = Pick<typeof db, "insert" | "select">;

export async function saveDeliveries(store: Store, journeyId: string, deliveries: Delivery[]) {
  if (deliveries.length) await store.insert(ujkNotifications)
    .values(deliveries.map(d => ({ ...d, journeyId }))).onConflictDoNothing();
}

// Called inside the same transaction as review events, not as a best-effort side effect.
export async function deliverReviewEvent(store: Store, journey: UjkJourney, event: typeof ujkEvents.$inferSelect) {
  const events = await store.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
  await saveDeliveries(store, journey.id, eventDeliveries(journey.ownerId, events, event));
}

// Reconciliation backfills existing history and catches deadlines after downtime.
// Bounded journey batches avoid loading the whole database into memory.
export async function reconcileNotifications(accountId?: string, now = new Date()) {
  let after: string | undefined;
  for (;;) {
    const journeys: UjkJourney[] = await db.select().from(ujkJourneys).where(
      sql`${after ? gt(ujkJourneys.id, after) : sql`true`} AND ${
        accountId ? or(eq(ujkJourneys.ownerId, accountId),
          sql`EXISTS (SELECT 1 FROM ujk_events e WHERE e.journey_id = ${ujkJourneys.id}
            AND e.kind = 'reviewer_assignment' AND e.payload->>'reviewerId' = ${accountId})`) : sql`true`
      }`,
    ).orderBy(asc(ujkJourneys.id)).limit(100);
    for (const journey of journeys) {
      const events = await db.select().from(ujkEvents).where(eq(ujkEvents.journeyId, journey.id)).orderBy(asc(ujkEvents.id));
      const [scheme] = await db.select().from(ujkSchemes).where(eq(ujkSchemes.roleId, journey.roleId)).orderBy(desc(ujkSchemes.id)).limit(1);
      const schemeId = schemeIsCurrent(scheme, journey.unitCodes, now) ? String(scheme.id) : null;
      const deliveries = [
        ...events.flatMap(event => eventDeliveries(journey.ownerId, events, event)),
        ...expiryDeliveries(journey.ownerId, events, schemeId, now),
      ];
      // Limit insert size for journeys with long histories.
      for (let i = 0; i < deliveries.length; i += 250) await saveDeliveries(db, journey.id, deliveries.slice(i, i + 250));
    }
    if (journeys.length < 100) break;
    after = journeys.at(-1)!.id;
  }
}

export function startNotificationReminders() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await reconcileNotifications(); }
    catch (error) { logger.error({ errorType: error instanceof Error ? error.name : "Unknown" }, "UJK notification reconciliation failed"); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 60 * 60 * 1000);
  timer.unref();
}

import { eq } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { processedStripeEvents } from '../db/schema.js';

interface StripeEventDedupeServiceDeps {
  getDb: typeof getDb;
}

export const createStripeEventDedupeService = (
  deps: StripeEventDedupeServiceDeps = { getDb },
) => {
  return {
    async isEventProcessed(eventId: string): Promise<boolean> {
      const db = await deps.getDb();
      const rows = await db
        .select({ eventId: processedStripeEvents.eventId })
        .from(processedStripeEvents)
        .where(eq(processedStripeEvents.eventId, eventId))
        .limit(1);
      return rows.length > 0;
    },

    /** Returns true if this call inserted the row (i.e. the event is new). */
    async markEventProcessed(eventId: string): Promise<boolean> {
      const db = await deps.getDb();
      const inserted = await db
        .insert(processedStripeEvents)
        .values({ eventId })
        .onConflictDoNothing()
        .returning({ eventId: processedStripeEvents.eventId });
      return inserted.length > 0;
    },

    /** Called when handler dispatch throws, so a legitimate Stripe retry isn't swallowed. */
    async unmarkEventProcessed(eventId: string): Promise<void> {
      const db = await deps.getDb();
      await db.delete(processedStripeEvents).where(eq(processedStripeEvents.eventId, eventId));
    },
  };
};

export const stripeEventDedupeService = createStripeEventDedupeService();

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

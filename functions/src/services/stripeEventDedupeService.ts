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
        .select({ status: processedStripeEvents.status })
        .from(processedStripeEvents)
        .where(eq(processedStripeEvents.eventId, eventId))
        .limit(1);
      return rows[0]?.status === 'completed';
    },

    /** Returns true when this invocation should dispatch handler side effects. */
    async markEventProcessed(eventId: string): Promise<boolean> {
      const db = await deps.getDb();
      const inserted = await db
        .insert(processedStripeEvents)
        .values({ eventId, status: 'processing' })
        .onConflictDoNothing()
        .returning({ eventId: processedStripeEvents.eventId });
      if (inserted.length > 0) {
        return true;
      }

      const existing = await db
        .select({ status: processedStripeEvents.status })
        .from(processedStripeEvents)
        .where(eq(processedStripeEvents.eventId, eventId))
        .limit(1);
      // A row left in 'processing' means a prior attempt failed before completion — allow retry.
      return existing[0]?.status === 'processing';
    },

    async completeEventProcessed(eventId: string): Promise<void> {
      const db = await deps.getDb();
      await db
        .update(processedStripeEvents)
        .set({ status: 'completed' })
        .where(eq(processedStripeEvents.eventId, eventId));
    },

    /** Called when handler dispatch throws, so a legitimate Stripe retry isn't swallowed. */
    async unmarkEventProcessed(eventId: string): Promise<void> {
      const db = await deps.getDb();
      await db.delete(processedStripeEvents).where(eq(processedStripeEvents.eventId, eventId));
    },
  };
};

export const stripeEventDedupeService = createStripeEventDedupeService();

import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { processedStripeEvents } from '../db/schema.js';

/** In-flight webhook claims older than this are treated as stale and may be reacquired. */
export const PROCESSING_LEASE_MS = 5 * 60 * 1000;

interface StripeEventDedupeServiceDeps {
  getDb: typeof getDb;
  now?: () => Date;
}

export const createStripeEventDedupeService = (
  deps: StripeEventDedupeServiceDeps = { getDb },
) => {
  const now = deps.now ?? (() => new Date());

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
        .select({
          status: processedStripeEvents.status,
          createdAt: processedStripeEvents.createdAt,
        })
        .from(processedStripeEvents)
        .where(eq(processedStripeEvents.eventId, eventId))
        .limit(1);
      const row = existing[0];
      if (!row || row.status === 'completed') {
        return false;
      }

      const staleBefore = new Date(now().getTime() - PROCESSING_LEASE_MS);
      if (row.createdAt >= staleBefore) {
        return false;
      }

      const reacquired = await db
        .update(processedStripeEvents)
        .set({ createdAt: now() })
        .where(
          and(
            eq(processedStripeEvents.eventId, eventId),
            eq(processedStripeEvents.status, 'processing'),
            lt(processedStripeEvents.createdAt, staleBefore),
          ),
        )
        .returning({ eventId: processedStripeEvents.eventId });
      return reacquired.length > 0;
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

    /** Expire an in-flight claim so the next Stripe retry can reacquire it. */
    async expireProcessingClaim(eventId: string): Promise<void> {
      const db = await deps.getDb();
      await db
        .update(processedStripeEvents)
        .set({ createdAt: new Date(0) })
        .where(
          and(
            eq(processedStripeEvents.eventId, eventId),
            eq(processedStripeEvents.status, 'processing'),
          ),
        );
    },
  };
};

export const stripeEventDedupeService = createStripeEventDedupeService();

import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { subscriptions } from '../db/schema.js';
import { createCreditService } from './creditService.js';

const SIGNUP_CREDIT_REFERENCE_ID = 'signup';

export interface UpsertSubscriptionParams {
  userId: string;
  planTier: 'free' | 'monthly_20' | 'monthly_50' | 'payg';
  planStatus: 'active' | 'cancelled' | 'expired';
  currentCredits?: number;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  billingCycleStart?: Date | null;
  billingCycleEnd?: Date | null;
}

interface SubscriptionServiceDeps {
  getDb: typeof getDb;
  creditService?: ReturnType<typeof createCreditService>;
}

export const createSubscriptionService = (
  deps: SubscriptionServiceDeps = { getDb },
) => {
  const service = {
    async getSubscription(userId: string) {
      const db = await deps.getDb();
      const result = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .limit(1);
      return result[0] || null;
    },

    async getOrCreateDefaultSubscription(userId: string) {
      const db = await deps.getDb();
      const creditService = deps.creditService ?? createCreditService({ getDb: deps.getDb });

      await db
        .insert(subscriptions)
        .values({
          userId,
          planTier: 'free',
          planStatus: 'active',
          // Credits are granted through credit_transactions (signup grant), then synchronized onto subscriptions.
          currentCredits: 0,
        })
        .onConflictDoNothing({ target: subscriptions.userId });

      const subscription = await service.getSubscription(userId);
      if (!subscription) {
        throw new Error(`Failed to load subscription after default bootstrap for user: ${userId}`);
      }

      // Always call — addCredits is idempotent via referenceId, so duplicate calls are safe.
      // Guards against the DB trigger handle_new_user() pre-creating the subscription row
      // without a matching credit_transactions row.
      await creditService.addCredits(userId, 50, null, 'signup', SIGNUP_CREDIT_REFERENCE_ID);

      return await service.getSubscription(userId) ?? subscription;
    },

    async upsertSubscription(params: UpsertSubscriptionParams) {
      const db = await deps.getDb();
      const [upserted] = await db
        .insert(subscriptions)
        .values({
          userId: params.userId,
          planTier: params.planTier,
          planStatus: params.planStatus,
          currentCredits: params.currentCredits ?? 50,
          stripeSubscriptionId: params.stripeSubscriptionId,
          stripeCustomerId: params.stripeCustomerId,
          billingCycleStart: params.billingCycleStart,
          billingCycleEnd: params.billingCycleEnd,
        })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: {
            planTier: params.planTier,
            planStatus: params.planStatus,
            currentCredits: params.currentCredits ?? sql`${subscriptions.currentCredits}`,
            stripeSubscriptionId: params.stripeSubscriptionId !== undefined ? params.stripeSubscriptionId : sql`${subscriptions.stripeSubscriptionId}`,
            stripeCustomerId: params.stripeCustomerId !== undefined ? params.stripeCustomerId : sql`${subscriptions.stripeCustomerId}`,
            billingCycleStart: params.billingCycleStart !== undefined ? params.billingCycleStart : sql`${subscriptions.billingCycleStart}`,
            billingCycleEnd: params.billingCycleEnd !== undefined ? params.billingCycleEnd : sql`${subscriptions.billingCycleEnd}`,
            updatedAt: new Date(),
          }
        })
        .returning();
      return upserted;
    },

    async acceptTerms(userId: string, version: string, acceptedAt: Date) {
      const db = await deps.getDb();
      await service.getOrCreateDefaultSubscription(userId);

      await db
        .update(subscriptions)
        .set({
          termsVersion: version,
          termsAcceptedAt: acceptedAt,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));
    },
  };

  return service;
};

export const subscriptionService = createSubscriptionService();

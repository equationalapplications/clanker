import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { subscriptions } from '../db/schema.js';

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

export const subscriptionService = {
  async getSubscription(userId: string) {
    const db = await getDb();
    const result = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    return result[0] || null;
  },

  async getOrCreateDefaultSubscription(userId: string) {
    const db = await getDb();
    await db
      .insert(subscriptions)
      .values({
        userId,
        planTier: 'free',
        planStatus: 'active',
        currentCredits: 50,
      })
      .onConflictDoNothing({ target: subscriptions.userId });

    const subscription = await this.getSubscription(userId);
    if (!subscription) {
      throw new Error(`Failed to load subscription after default bootstrap for user: ${userId}`);
    }

    return subscription;
  },

  async upsertSubscription(params: UpsertSubscriptionParams) {
    const db = await getDb();
    const [upserted] = await db
      .insert(subscriptions)
      .values({
        userId: params.userId,
        planTier: params.planTier,
        planStatus: params.planStatus,
        currentCredits: params.currentCredits ?? 0,
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
    const db = await getDb();
    const existing = await this.getSubscription(userId);

    if (existing) {
      await db
        .update(subscriptions)
        .set({
          termsVersion: version,
          termsAcceptedAt: acceptedAt,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.userId, userId));
    } else {
      await db.insert(subscriptions).values({
        userId,
        termsVersion: version,
        termsAcceptedAt: acceptedAt,
      });
    }
  },
};

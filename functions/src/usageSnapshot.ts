import * as logger from 'firebase-functions/logger'

interface SubscriptionRow {
  planTier: string;
  planStatus: string;
}

export interface UsageSnapshot {
  planTier: string | null;
  planStatus: 'active' | 'cancelled' | 'expired' | null;
  verifiedAt: string;
}

const VALID_PLAN_STATUSES = new Set(['active', 'cancelled', 'expired']);

export function buildUsageSnapshot(
  subscription: SubscriptionRow | null,
  verifiedAt?: string
): UsageSnapshot {
  const timestamp = verifiedAt ?? new Date().toISOString();

  if (!subscription) {
    return { planTier: null, planStatus: null, verifiedAt: timestamp };
  }

  const planStatus = VALID_PLAN_STATUSES.has(subscription.planStatus)
    ? (subscription.planStatus as 'active' | 'cancelled' | 'expired')
    : null;

  return {
    planTier: subscription.planTier,
    planStatus,
    verifiedAt: timestamp,
  };
}

export async function buildUsageSnapshotForUser(
  userId: string,
  subscriptionService: { getSubscription(userId: string): Promise<SubscriptionRow | null> },
  functionName: string
): Promise<UsageSnapshot> {
  try {
    const subscription = await subscriptionService.getSubscription(userId);
    return buildUsageSnapshot(subscription);
  } catch (snapshotError: unknown) {
    logger.warn(
      `Failed to fetch subscription for usage snapshot in ${functionName}`,
      { userId, error: snapshotError }
    );
    return buildUsageSnapshot(null);
  }
}

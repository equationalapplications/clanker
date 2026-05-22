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

export function buildUsageSnapshot(subscription: SubscriptionRow | null): UsageSnapshot {
  if (!subscription) {
    return { planTier: null, planStatus: null, verifiedAt: new Date().toISOString() };
  }

  const planStatus = VALID_PLAN_STATUSES.has(subscription.planStatus)
    ? (subscription.planStatus as 'active' | 'cancelled' | 'expired')
    : null;

  return {
    planTier: subscription.planTier,
    planStatus,
    verifiedAt: new Date().toISOString(),
  };
}

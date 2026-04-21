import { useSelector } from '@xstate/react'
import { PLAN_TIERS, SUBSCRIPTION_TIERS, type PlanTier } from '~/config/constants'
import { useAuthMachine } from '~/hooks/useMachines'
import type { SubscriptionSnapshot } from '~/auth/bootstrapSession'

const ALL_PLAN_TIERS = Object.values(PLAN_TIERS)

const isPlanTier = (value: unknown): value is PlanTier => {
  return typeof value === 'string' && ALL_PLAN_TIERS.includes(value as PlanTier)
}

export interface AuthCreditsSnapshot {
  totalCredits: number
  hasUnlimited: boolean
  subscriptions: {
    tier: string
    credits: number
    isUnlimited: boolean
  }[]
}

export function useAuthSubscription(): SubscriptionSnapshot | null {
  const authService = useAuthMachine()
  return useSelector(authService, (state) => state.context.subscription)
}

export function useAuthCredits(): AuthCreditsSnapshot {
  const authService = useAuthMachine()
  const subscription = useSelector(authService, (state) => state.context.subscription)

  const tier = subscription?.planTier ?? 'free'
  const active = subscription?.planStatus === 'active'
  const isUnlimited = active && isPlanTier(tier) && SUBSCRIPTION_TIERS.includes(tier)
  const totalCredits = Math.max(0, subscription?.currentCredits ?? 0)

  return {
    totalCredits,
    hasUnlimited: isUnlimited,
    subscriptions: [
      {
        tier,
        credits: totalCredits,
        isUnlimited,
      },
    ],
  }
}

export function useAuthTerms(): { termsVersion: string | null; termsAcceptedAt: string | null } {
  const subscription = useAuthSubscription()
  return {
    termsVersion: subscription?.termsVersion ?? null,
    termsAcceptedAt: subscription?.termsAcceptedAt ?? null,
  }
}

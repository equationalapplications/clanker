import { useSelector } from '@xstate/react'
import { PLAN_TIERS, SUBSCRIPTION_TIERS, type PlanTier } from '~/config/constants'
import { useAuthMachine } from '~/hooks/useMachines'

interface CurrentPlan {
  tier: PlanTier | null
  isSubscriber: boolean
  isLoading: boolean
  remainingCredits: number | null
}

const ALL_PLAN_TIERS = Object.values(PLAN_TIERS)

const isPlanTier = (value: unknown): value is PlanTier => {
  return typeof value === 'string' && ALL_PLAN_TIERS.includes(value as PlanTier)
}

/**
 * Derives the current subscription plan from the authMachine's subscription context.
 *
 * This eliminates the need to decode any raw JWT — the subscription data is
 * already managed by authMachine during the bootstrap process.
 */
export function useCurrentPlan(): CurrentPlan {
  const authService = useAuthMachine()

  const subscription = useSelector(
    authService,
    (state) => state.context.subscription,
  )
  const isLoading = useSelector(
    authService,
    (state) =>
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping'),
  )

  const tier = isPlanTier(subscription?.planTier) ? subscription.planTier : null
  const isActive = subscription?.planStatus === 'active'
  const remainingCredits =
    typeof subscription?.currentCredits === 'number' && Number.isFinite(subscription.currentCredits)
      ? Math.max(0, subscription.currentCredits)
      : null

  const isSubscriber = isActive && tier !== null && SUBSCRIPTION_TIERS.includes(tier)

  return { tier, isSubscriber, isLoading, remainingCredits }
}

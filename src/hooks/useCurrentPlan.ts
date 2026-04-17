import { useSelector } from '@xstate/react'
import { SUBSCRIPTION_TIERS, type PlanTier } from '~/config/constants'
import { useAuthMachine } from '~/hooks/useMachines'

interface CurrentPlan {
  tier: PlanTier | null
  isSubscriber: boolean
  isLoading: boolean
}

/**
 * Derives the current subscription plan from the authMachine's subscription context.
 *
 * This eliminates the need to decode a Supabase JWT — the subscription data is
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

  const tier = (subscription?.planTier as PlanTier) ?? null

  const isSubscriber = tier !== null && SUBSCRIPTION_TIERS.includes(tier)

  return { tier, isSubscriber, isLoading }
}

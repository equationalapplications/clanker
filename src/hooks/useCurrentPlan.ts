import { useSelector } from '@xstate/react'
import { APP_NAME, SUBSCRIPTION_TIERS, type PlanTier } from '~/config/constants'
import { useAuthMachine } from '~/hooks/useMachines'

interface CurrentPlan {
  tier: PlanTier | null
  isSubscriber: boolean
  isLoading: boolean
}

interface JwtPlan {
  app: string
  tier: PlanTier
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64Url = token.split('.')[1]
  // Convert base64url to standard base64 (replace URL-safe chars, add padding)
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const json = atob(padded)
  return JSON.parse(json)
}

function extractTierFromToken(accessToken: string, appName: string): PlanTier | null {
  try {
    const payload = decodeJwtPayload(accessToken)
    const plans = payload.plans as JwtPlan[] | undefined
    if (!Array.isArray(plans)) return null
    const match = plans.find((p) => p.app === appName)
    return match?.tier ?? null
  } catch {
    return null
  }
}

/**
 * Derives the current subscription plan from the authMachine's supabaseSession context.
 *
 * This eliminates a duplicate Supabase `onAuthStateChange` listener — the session is
 * already managed by authMachine and exposed via its context, so we simply select from it.
 */
export function useCurrentPlan(): CurrentPlan {
  const authService = useAuthMachine()

  const supabaseSession = useSelector(authService, (state) => state.context.supabaseSession)
  const isLoading = useSelector(
    authService,
    (state) =>
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('exchangingToken') ||
      state.matches('establishingSupabaseSession'),
  )

  const tier = supabaseSession?.access_token
    ? extractTierFromToken(supabaseSession.access_token, APP_NAME)
    : null

  const isSubscriber = tier !== null && SUBSCRIPTION_TIERS.includes(tier)

  return { tier, isSubscriber, isLoading }
}

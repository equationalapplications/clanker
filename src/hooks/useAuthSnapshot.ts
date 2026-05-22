import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'
import type { SubscriptionSnapshot } from '~/auth/bootstrapSession'

export interface AuthCreditsSnapshot {
  totalCredits: number
  nextExpiryDate: string | null
}

export function useAuthSubscription(): SubscriptionSnapshot | null {
  const authService = useAuthMachine()
  return useSelector(authService, (state) => state.context.subscription)
}

export function useAuthCredits(): AuthCreditsSnapshot {
  const authService = useAuthMachine()
  const subscription = useSelector(authService, (state) => state.context.subscription)

  return {
    totalCredits: Math.max(0, subscription?.currentCredits ?? 0),
    nextExpiryDate: subscription?.nextExpiryDate ?? null,
  }
}

export function useAuthTerms(): { termsVersion: string | null; termsAcceptedAt: string | null } {
  const subscription = useAuthSubscription()
  return {
    termsVersion: subscription?.termsVersion ?? null,
    termsAcceptedAt: subscription?.termsAcceptedAt ?? null,
  }
}

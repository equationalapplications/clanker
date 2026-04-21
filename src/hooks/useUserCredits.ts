import { useMutation } from '@tanstack/react-query'
import { useSelector } from '@xstate/react'
import { deductCredits } from '~/utilities/getUserCredits'
import { useAuthMachine } from '~/hooks/useMachines'
import { useAuthCredits } from '~/hooks/useAuthSnapshot'
import { requestBootstrapRefresh } from '~/hooks/useBootstrapRefresh'

export const useUserCredits = () => {
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)
  const isLoading = useSelector(
    authService,
    (state) =>
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping'),
  )
  const credits = useAuthCredits()

  return {
    data: user ? credits : undefined,
    isLoading,
    error: null,
    refetch: async () => {
      if (user) {
        requestBootstrapRefresh(authService, 'manual')
      }
      return Promise.resolve({ data: user ? credits : undefined })
    },
  }
}

export const useDeductCredits = () => {
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)

  return useMutation({
    mutationFn: ({ amount, description }: { amount: number; description?: string }) =>
      deductCredits(amount, description),
    onSuccess: () => {
      if (user) {
        requestBootstrapRefresh(authService, 'manual')
      }
    },
    onError: (error) => {
      console.error('Failed to deduct credits:', error)
    },
  })
}

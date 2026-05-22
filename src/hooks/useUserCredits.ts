import { useSelector } from '@xstate/react'
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
  const error = useSelector(authService, (state) => state.context.error)
  const credits = useAuthCredits()

  return {
    data: user ? credits : undefined,
    isLoading,
    error,
    refetch: () => {
      if (user) {
        requestBootstrapRefresh(authService, 'manual')
      }
    },
  }
}

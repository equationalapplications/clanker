import { Redirect } from 'expo-router'
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'
import LoadingIndicator from '~/components/LoadingIndicator'

export default function Index() {
  const authService = useAuthMachine()
  const user = useSelector(authService, (state) => state.context.user)
  const isLoading = useSelector(
    authService,
    (state) =>
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping'),
  )

  if (isLoading) {
    return <LoadingIndicator />
  }

  return <Redirect href={user ? '/chat' : '/sign-in'} />
}

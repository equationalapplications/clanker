import { Redirect } from 'expo-router'
import { useSelector } from '@xstate/react'
import { useAuthMachine } from '~/hooks/useMachines'
import LoadingIndicator from '~/components/LoadingIndicator'

export default function Index() {
  const authService = useAuthMachine()
  const { user, isLoading } = useSelector(authService, (state) => ({
    user: state.context.user,
    isLoading:
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('exchangingToken') ||
      state.matches('establishingSupabaseSession'),
  }))

  if (isLoading) {
    return <LoadingIndicator />
  }

  return <Redirect href={user ? '/chat' : '/sign-in'} />
}

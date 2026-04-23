import Head from 'expo-router/head'
import { Redirect } from 'expo-router'
import { useSelector } from '@xstate/react'
import LandingPage from '~/components/LandingPage'
import LoadingIndicator from '~/components/LoadingIndicator'
import { useAuthMachine } from '~/hooks/useMachines'

export default function WebIndex() {
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

  return (
    <>
      <Head>
        <title>Clanker — Design, chat with, and share your own AI characters</title>
        <meta
          name="description"
          content="Create custom AI characters with unique personalities, chat with them, and share them with anyone."
        />
        <meta property="og:title" content="Clanker" />
        <meta
          property="og:description"
          content="Create custom AI characters with unique personalities, chat with them, and share them with anyone."
        />
        <meta property="og:type" content="website" />
      </Head>
      {user ? <Redirect href="/chat" /> : <LandingPage />}
    </>
  )
}

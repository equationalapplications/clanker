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
          content="Create AI characters, chat with them, and talk in real time with live voice calls. Hands-free conversations with web search and shared memory. 1 credit per minute for live voice."
        />
        <meta property="og:title" content="Clanker" />
        <meta
          property="og:description"
          content="Design AI characters with unique personalities, chat with them, and call them in real time with natural, uninterrupted voice conversations."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://clanker-ai.com/" />
        <meta property="og:image" content="https://clanker-ai.com/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Clanker" />
        <meta
          name="twitter:description"
          content="Design AI characters, chat with them, and call them in real time with natural, uninterrupted voice conversations."
        />
        <meta name="twitter:image" content="https://clanker-ai.com/og-image.png" />
      </Head>
      {user ? <Redirect href="/chat" /> : <LandingPage />}
    </>
  )
}

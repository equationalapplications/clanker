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
        <title>Clanker — AI Characters with Real-Time Voice & Google OKF Memory</title>
        <meta
          name="description"
          content="Design AI characters with real-time voice. Own memory with Google's OKF, edit in Obsidian, and memory that learns from chat, docs, and web search."
        />
        <meta
          name="keywords"
          content="AI characters, real-time voice AI, AI voice chat, Open Knowledge Format, OKF, Google OKF, AI memory, Obsidian AI, export AI character, AI companion, voice assistant"
        />
        <link rel="canonical" href="https://clanker-ai.com/welcome" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Clanker" />
        <meta property="og:url" content="https://clanker-ai.com/welcome" />
        <meta
          property="og:title"
          content="Clanker — AI Characters with Real-Time Voice & Google OKF Memory"
        />
        <meta
          property="og:description"
          content="Design AI characters with real-time voice. Own memory with Google's OKF, edit in Obsidian, and memory that learns from chat, docs, and web search."
        />
        <meta property="og:image" content="https://clanker-ai.com/og-image.png" />
        <meta property="og:image:width" content="1024" />
        <meta property="og:image:height" content="500" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:title"
          content="Clanker — AI Characters with Real-Time Voice & Google OKF Memory"
        />
        <meta
          name="twitter:description"
          content="Design AI characters with real-time voice. Own memory with Google's OKF, edit in Obsidian, and memory that learns from chat, docs, and web search."
        />
        <meta name="twitter:image" content="https://clanker-ai.com/og-image.png" />
      </Head>
      {user ? <Redirect href="/chat" /> : <LandingPage />}
    </>
  )
}

import Head from 'expo-router/head'
import LandingPage from '~/components/LandingPage'

export default function WebIndex() {
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
      <LandingPage />
    </>
  )
}

import Head from 'expo-router/head'
import RealTimeVoicePage from '~/components/LandingPage/RealTimeVoicePage'

export default function RealTimeVoiceRoute() {
  return (
    <>
      <Head>
        <title>Live Real-Time Voice Calls — Clanker</title>
        <meta
          name="description"
          content="Talk to your AI characters in real time with Clanker. Natural phone-call conversations, hands-free speakerphone, seamless interruptions, and live web and memory tools. 1 credit per minute."
        />
        <meta property="og:title" content="Clanker — Live Real-Time Voice Calls" />
        <meta
          property="og:description"
          content="Experience natural, uninterrupted voice conversations with your AI characters. Hands-free, interruptible, and powered by live tools."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://clanker-ai.com/real-time-voice" />
        <meta property="og:image" content="https://clanker-ai.com/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Clanker — Live Real-Time Voice Calls" />
        <meta
          name="twitter:description"
          content="Talk to your AI characters in real time — natural phone-call conversations, hands-free, interruptible, with live web and memory tools."
        />
        <meta name="twitter:image" content="https://clanker-ai.com/og-image.png" />
        <link rel="canonical" href="https://clanker-ai.com/real-time-voice" />
      </Head>
      <RealTimeVoicePage />
    </>
  )
}

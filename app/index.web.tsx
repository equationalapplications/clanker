import Head from 'expo-router/head'
import { Redirect } from 'expo-router'
import { useSelector } from '@xstate/react'
import LandingPage from '~/components/LandingPage'
import LoadingIndicator from '~/components/LoadingIndicator'
import { useAuthMachine } from '~/hooks/useMachines'
import { SITE_META, SITE_BASE } from '~/config/landingConfig'

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

  const canonicalUrl = `${SITE_BASE}${SITE_META.canonicalPath}`

  return (
    <>
      <Head>
        <title>{SITE_META.title}</title>
        <meta name="description" content={SITE_META.description} />
        <meta name="keywords" content={SITE_META.keywords} />
        <link rel="canonical" href={canonicalUrl} />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_META.siteName} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:title" content={SITE_META.title} />
        <meta property="og:description" content={SITE_META.description} />
        <meta property="og:image" content={SITE_META.ogImage} />
        <meta property="og:image:width" content={String(SITE_META.ogImageWidth)} />
        <meta property="og:image:height" content={String(SITE_META.ogImageHeight)} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={SITE_META.title} />
        <meta name="twitter:description" content={SITE_META.description} />
        <meta name="twitter:image" content={SITE_META.ogImage} />
      </Head>
      {user ? <Redirect href="/chat" /> : <LandingPage />}
    </>
  )
}

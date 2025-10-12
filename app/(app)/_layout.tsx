import { Redirect, router, Stack } from 'expo-router'
import { useSubscriptionStatus } from '~/hooks/useSubscriptionStatus'
import { ActivityIndicator, View } from 'react-native'
import { useEffect } from 'react'

export default function AppLayout() {
  const { needsTermsAcceptance, isUpdate, isLoading } = useSubscriptionStatus()

  console.log(
    '[AppLayout] Render - isLoading:',
    isLoading,
    'needsTermsAcceptance:',
    needsTermsAcceptance,
    'isUpdate:',
    isUpdate,
  )

  useEffect(() => {
    console.log(
      '[AppLayout] useEffect triggered - isLoading:',
      isLoading,
      'needsTermsAcceptance:',
      needsTermsAcceptance,
    )
    if (!isLoading && needsTermsAcceptance) {
      console.log('[AppLayout] Redirecting to accept-terms')
      router.replace({
        pathname: '/accept-terms',
        params: { isUpdate: isUpdate.toString() },
      })
    }
  }, [isLoading, needsTermsAcceptance, isUpdate])

  if (isLoading) {
    console.log('[AppLayout] Showing loading indicator')
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  if (needsTermsAcceptance) {
    console.log('[AppLayout] Rendering Redirect to accept-terms')
    return <Redirect href="/accept-terms" />
  }

  console.log('[AppLayout] Rendering Stack with drawer')
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
    </Stack>
  )
}

import { useCallback, useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text, Button } from 'react-native-paper'
import { useRouter } from 'expo-router'
import { useBootstrapRefresh } from '~/hooks/useBootstrapRefresh'

export default function CheckoutSuccess() {
  const router = useRouter()
  const refreshBootstrap = useBootstrapRefresh()
  const hasTriggeredRef = useRef(false)

  const refreshAndNavigate = useCallback(() => {
    if (hasTriggeredRef.current) {
      router.replace('/')
      return
    }

    hasTriggeredRef.current = true
    refreshBootstrap('purchase')
    router.replace('/')
  }, [refreshBootstrap, router])

  useEffect(() => {
    const timer = setTimeout(async () => {
      refreshAndNavigate()
    }, 3000)
    return () => clearTimeout(timer)
  }, [refreshAndNavigate])

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>
        Purchase complete!
      </Text>
      <Text variant="bodyLarge" style={styles.subtitle}>
        Your subscription is now active. Redirecting you back…
      </Text>
      <Button
        mode="contained"
        onPress={() => {
          refreshAndNavigate()
        }}
        style={styles.button}
      >
        Go to app
      </Button>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    opacity: 0.7,
  },
  button: {
    marginTop: 8,
  },
})

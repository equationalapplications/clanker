import { useCallback, useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text, Button } from 'react-native-paper'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useBootstrapRefresh } from '~/hooks/useBootstrapRefresh'
import { getCurrentUser } from '~/config/firebaseConfig'
import { createCheckoutChannel } from '~/utilities/checkoutChannel'
import { CHECKOUT_SCHEMA_VERSION, readCheckoutAttempts, upsertCheckoutAttempt } from '~/utilities/checkoutStateStore'
import { resolveCheckoutAttemptId } from '~/utilities/checkoutAttemptId'

export default function CheckoutSuccess() {
  const router = useRouter()
  const params = useLocalSearchParams<{ attemptId?: string | string[] }>()
  const refreshBootstrap = useBootstrapRefresh()
  const hasTriggeredRef = useRef(false)
  const attemptId = useMemo(() => resolveCheckoutAttemptId(params.attemptId), [params.attemptId])

  const refreshAndNavigate = useCallback(() => {
    if (hasTriggeredRef.current) {
      router.replace('/')
      return
    }

    hasTriggeredRef.current = true

    const uid = getCurrentUser()?.uid
    if (attemptId && uid) {
      const existing = readCheckoutAttempts(uid)[attemptId]

      if (existing) {
        const nextRecord = {
          ...existing,
          status: 'succeeded' as const,
          at: new Date().toISOString(),
          sourceTabId: 'checkout-success',
          schemaVersion: CHECKOUT_SCHEMA_VERSION,
        }

        const updateResult = upsertCheckoutAttempt(uid, nextRecord)
        if (updateResult.applied) {
          const payload = updateResult.record ?? nextRecord
          const channel = createCheckoutChannel({ uid })
          channel.publish({ type: 'CHECKOUT_SUCCEEDED', payload })
          channel.close()
        }
      }
    }

    refreshBootstrap('purchase')
    router.replace('/')
  }, [attemptId, refreshBootstrap, router])

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
        Your purchase is confirmed. Redirecting you back...
      </Text>
      <Button
        mode="contained"
        testID="checkout-success-go-to-app"
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

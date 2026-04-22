import { useCallback, useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text, Button } from 'react-native-paper'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { getCurrentUser } from '~/config/firebaseConfig'
import { createCheckoutChannel } from '~/utilities/checkoutChannel'
import { CHECKOUT_SCHEMA_VERSION, readCheckoutAttempts, upsertCheckoutAttempt } from '~/utilities/checkoutStateStore'
import { resolveCheckoutAttemptId } from '~/utilities/checkoutAttemptId'

export default function CheckoutCancel() {
  const router = useRouter()
  const params = useLocalSearchParams<{ attemptId?: string | string[] }>()
  const hasTriggeredRef = useRef(false)
  const attemptId = useMemo(() => resolveCheckoutAttemptId(params.attemptId), [params.attemptId])

  const completeCancelAttempt = useCallback(() => {
    if (hasTriggeredRef.current) {
      return
    }

    hasTriggeredRef.current = true

    const uid = getCurrentUser()?.uid
    if (attemptId && uid) {
      const existing = readCheckoutAttempts(uid)[attemptId]

      if (existing) {
        const nextRecord = {
          ...existing,
          status: 'cancelled' as const,
          at: new Date().toISOString(),
          sourceTabId: 'checkout-cancel',
          schemaVersion: CHECKOUT_SCHEMA_VERSION,
        }

        const updateResult = upsertCheckoutAttempt(uid, nextRecord)
        if (updateResult.applied) {
          const payload = updateResult.record ?? nextRecord
          const channel = createCheckoutChannel({ uid })
          channel.publish({ type: 'CHECKOUT_CANCELLED', payload })
          channel.close()
        }
      }
    }
  }, [attemptId])

  const navigateBackToApp = useCallback(() => {
    completeCancelAttempt()
    router.replace('/')
  }, [completeCancelAttempt, router])

  const navigateToRetry = useCallback(() => {
    completeCancelAttempt()
    router.back()
  }, [completeCancelAttempt, router])

  useEffect(() => {
    const timer = setTimeout(() => {
      navigateBackToApp()
    }, 3000)

    return () => clearTimeout(timer)
  }, [navigateBackToApp])

  return (
    <View style={styles.container}>
      <Text variant="headlineMedium" style={styles.title}>
        Checkout cancelled
      </Text>
      <Text variant="bodyLarge" style={styles.subtitle}>
        No charge was made. You can try again whenever {"you're"} ready.
      </Text>
      <Button
        mode="contained"
        testID="checkout-cancel-try-again"
        onPress={navigateToRetry}
        style={styles.button}
      >
        Try again
      </Button>
      <Button mode="text" testID="checkout-cancel-back-to-app" onPress={navigateBackToApp}>
        Back to app
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

import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Text, Button } from 'react-native-paper'
import { useRouter } from 'expo-router'
import { getUserState } from '~/services/apiClient'

export default function CheckoutSuccess() {
  const router = useRouter()

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        await getUserState()
      } catch (error: any) {
        console.warn('⚠️ User state refresh failed after checkout:', error.message)
      }
      router.replace('/')
    }, 3000)
    return () => clearTimeout(timer)
  }, [router])

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
        onPress={async () => {
          try {
            await getUserState()
          } catch (error: any) {
            console.warn('⚠️ User state refresh failed after checkout:', error.message)
          }
          router.replace('/')
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

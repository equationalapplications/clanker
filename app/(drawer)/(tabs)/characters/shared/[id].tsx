import { useEffect, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import { useLocalSearchParams, router } from 'expo-router'
import { ActivityIndicator, Button, Text } from 'react-native-paper'
import { useSelector } from '@xstate/react'
import { importSharedCharacterFromCloud } from '~/services/characterSyncService'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { useAuthMachine } from '~/hooks/useMachines'

export default function SharedCharacterImportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const authService = useAuthMachine()
  const { user, isAuthLoading } = useSelector(authService, (state) => ({
    user: state.context.user,
    isAuthLoading:
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('bootstrapping'),
  }))
  const { isSubscriber, isLoading: isPlanLoading } = useCurrentPlan()
  const [isImporting, setIsImporting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    if (isPlanLoading || isAuthLoading || !id) {
      return
    }

    if (!user) {
      setErrorMessage('Please sign in to import this shared character.')
      return
    }

    if (!isSubscriber) {
      setErrorMessage('Cloud character import requires a monthly_20 or monthly_50 subscription.')
      return
    }

    let cancelled = false
    setIsImporting(true)
    setErrorMessage(null)

    importSharedCharacterFromCloud(id)
      .then(({ localCharacterId }) => {
        if (cancelled) {
          return
        }
        router.replace(`/chat/${localCharacterId}`)
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        setErrorMessage(
          error instanceof Error ? error.message : 'Failed to import shared character.',
        )
      })
      .finally(() => {
        if (!cancelled) {
          setIsImporting(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, isAuthLoading, isPlanLoading, isSubscriber, user])

  if (isAuthLoading || isPlanLoading || isImporting) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>Importing shared character...</Text>
      </View>
    )
  }

  return (
    <View style={styles.centered}>
      <Text variant="titleMedium" style={styles.statusText}>
        {errorMessage || 'Unable to import shared character.'}
      </Text>
      <View style={styles.actions}>
        <Button mode="outlined" onPress={() => router.replace('/characters/list')}>
          Back to Characters
        </Button>
        {!user ? (
          <Button mode="contained" onPress={() => router.replace('/sign-in')}>
            Sign In
          </Button>
        ) : null}
        {user && !isSubscriber ? (
          <Button mode="contained" onPress={() => router.push('/subscribe')}>
            Subscribe
          </Button>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  statusText: {
    textAlign: 'center',
    marginTop: 12,
  },
  actions: {
    marginTop: 16,
    gap: 12,
    width: '100%',
    maxWidth: 320,
  },
})

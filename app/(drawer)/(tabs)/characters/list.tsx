import { View, StyleSheet, FlatList } from 'react-native'
import { Text, Button, ActivityIndicator, Snackbar, IconButton } from 'react-native-paper'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@xstate/react'
import { useCharacters, useCreateCharacter, useSyncCharacters } from '~/hooks/useCharacters'
import { CharacterCard } from '~/components/CharacterCard'
import { useCharacterMachine } from '~/hooks/useMachines'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'

export default function CharactersListScreen() {
  const { characters, isLoading } = useCharacters()
  const { create, isPending, pendingCharacterId } = useCreateCharacter()
  const { isSubscriber } = useCurrentPlan()
  const characterService = useCharacterMachine()
  const isCreatingDefault = useSelector(characterService, (s) => s.matches('creatingDefault'))
  const { sync, isCloudSyncing, error: cloudSyncError } = useSyncCharacters()
  const [cloudSyncRequested, setCloudSyncRequested] = useState(false)
  const cloudSyncErrorAtRequestRef = useRef<unknown>(null)
  const didEnterCloudSyncStateRef = useRef(false)
  const [toastState, setToastState] = useState<{
    message: string
    requiresSubscription: boolean
  } | null>(null)

  // Navigate to edit page when creation completes
  useEffect(() => {
    if (pendingCharacterId) {
      router.push(`/characters/${pendingCharacterId}/edit`)
      characterService.send({ type: 'CLEAR_PENDING_NAV' })
    }
  }, [pendingCharacterId, characterService])

  const handleCreateCharacter = () => {
    create({ name: 'New Character', is_public: false })
  }

  const handleCloudSync = () => {
    if (!isSubscriber) {
      setToastState({
        message: 'Cloud retrieval requires a monthly subscription.',
        requiresSubscription: true,
      })
      return
    }
    cloudSyncErrorAtRequestRef.current = cloudSyncError
    didEnterCloudSyncStateRef.current = false
    setCloudSyncRequested(true)
    sync()
  }

  useEffect(() => {
    if (cloudSyncRequested && isCloudSyncing) {
      didEnterCloudSyncStateRef.current = true
    }
  }, [cloudSyncRequested, isCloudSyncing])

  useEffect(() => {
    if (!cloudSyncRequested || isCloudSyncing || !didEnterCloudSyncStateRef.current) {
      return
    }

    if (cloudSyncError && cloudSyncError !== cloudSyncErrorAtRequestRef.current) {
      setToastState({
        message: cloudSyncError instanceof Error ? cloudSyncError.message : 'Failed to sync characters.',
        requiresSubscription: false,
      })
    }

    cloudSyncErrorAtRequestRef.current = cloudSyncError
    didEnterCloudSyncStateRef.current = false
    setCloudSyncRequested(false)
  }, [cloudSyncError, cloudSyncRequested, isCloudSyncing])

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading characters...</Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text variant="headlineMedium" style={styles.title}>
          Characters
        </Text>
        <View style={styles.headerActions}>
          <IconButton
            icon="cloud-sync"
            size={28}
            onPress={handleCloudSync}
            loading={isCloudSyncing}
            disabled={isCloudSyncing}
            accessibilityLabel="Cloud Sync"
          />
          <Button
            mode="contained"
            icon="plus"
            onPress={handleCreateCharacter}
            loading={isPending || isCreatingDefault}
            disabled={isPending || isCreatingDefault}
          >
            New
          </Button>
        </View>
      </View>

      {!characters || characters.length === 0 ? (
        <View style={styles.centered}>
          {isCreatingDefault ? (
            <>
              <Text variant="bodyLarge" style={styles.emptyText}>
                Creating your first character...
              </Text>
              <ActivityIndicator size="small" style={styles.emptySpinner} />
            </>
          ) : (
            <Text variant="bodyLarge" style={styles.emptyText}>
              No characters yet. Tap &quot;New&quot; to create one!
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={characters}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CharacterCard
              id={item.id}
              name={item.name}
              appearance={item.appearance ?? undefined}
              avatar={item.avatar ?? undefined}
              onPress={() => router.push(`/chat/${item.id}`)}
              onEdit={() => router.push(`/characters/${item.id}/edit`)}
            />
          )}
          contentContainerStyle={styles.list}
        />
      )}

      <Snackbar
        visible={toastState !== null}
        onDismiss={() => setToastState(null)}
        duration={4000}
        action={
          toastState?.requiresSubscription && !isSubscriber
            ? {
                label: 'Subscribe',
                onPress: () => router.push('/subscribe'),
              }
            : undefined
        }
      >
        {toastState?.message}
      </Snackbar>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    fontWeight: 'bold',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  list: {
    paddingBottom: 16,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    opacity: 0.7,
  },
  emptyText: {
    opacity: 0.7,
    textAlign: 'center',
  },
  emptySpinner: {
    marginTop: 12,
  },
})

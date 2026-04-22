import { View, StyleSheet, FlatList } from 'react-native'
import { Text, Button, ActivityIndicator, Snackbar } from 'react-native-paper'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { useSelector } from '@xstate/react'
import { useCharacters, useCreateCharacter } from '~/hooks/useCharacters'
import { CharacterCard } from '~/components/CharacterCard'
import { useCharacterMachine } from '~/hooks/useMachines'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { restoreFromCloud } from '~/services/characterSyncService'

export default function CharactersListScreen() {
  const { characters, isLoading } = useCharacters()
  const { create, isPending, pendingCharacterId } = useCreateCharacter()
  const { isSubscriber } = useCurrentPlan()
  const characterService = useCharacterMachine()
  const isCreatingDefault = useSelector(characterService, (s) => s.matches('creatingDefault'))
  const [isRestoring, setIsRestoring] = useState(false)
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

  const handleRetrieveFromCloud = async () => {
    if (!isSubscriber) {
      setToastState({
        message: 'Cloud retrieval requires a monthly_20 or monthly_50 subscription.',
        requiresSubscription: true,
      })
      return
    }

    setIsRestoring(true)
    try {
      await restoreFromCloud()
      characterService.send({ type: 'LOAD' })
    } catch (error) {
      setToastState({
        message: error instanceof Error ? error.message : 'Failed to retrieve characters from cloud.',
        requiresSubscription: false,
      })
    } finally {
      setIsRestoring(false)
    }
  }

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
      <View style={styles.retrieveContainer}>
        <Button
          mode="outlined"
          icon="cloud-download"
          onPress={handleRetrieveFromCloud}
          loading={isRestoring}
          disabled={isRestoring}
        >
          Retrieve from Cloud
        </Button>
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
  retrieveContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
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

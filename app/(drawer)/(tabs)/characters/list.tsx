import { View, StyleSheet, FlatList } from 'react-native'
import { Text, Button, ActivityIndicator, Snackbar, IconButton, Portal, Modal, useTheme } from 'react-native-paper'
import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { useSelector } from '@xstate/react'
import { useCharacters, useCreateCharacter, useSyncCharacters } from '~/hooks/useCharacters'
import { CharacterCard } from '~/components/CharacterCard'
import { useCharacterMachine, useAuthMachine } from '~/hooks/useMachines'
import { createCharacter } from '~/database/characterDatabase'
import { useImportCharacterOKF } from '~/hooks/useImportCharacterOKF'
import { reportError } from '~/utilities/reportError'

const OKF_CLONE_PREVIEW_ENTITY_ID = 'okf-clone-preview'

export default function CharactersListScreen() {
  const { characters, isLoading } = useCharacters()
  const { create, isPending, pendingCharacterId } = useCreateCharacter()
  const characterService = useCharacterMachine()
  const isCreatingDefault = useSelector(characterService, (s) => s.matches('creatingDefault'))
  const { sync, isCloudSyncing, error: cloudSyncError } = useSyncCharacters()
  const [cloudSyncRequested, setCloudSyncRequested] = useState(false)
  const cloudSyncErrorAtRequestRef = useRef<unknown>(null)
  const didEnterCloudSyncStateRef = useRef(false)
  const importErrorShownRef = useRef<Error | null>(null)
  const [toastState, setToastState] = useState<{
    message: string
    requiresSubscription: boolean
  } | null>(null)
  const { colors } = useTheme()
  const authService = useAuthMachine()
  const userId = useSelector(authService, (state) => state.context.user?.uid ?? null)
  const {
    preview: importPreview,
    isParsing: isImportParsing,
    isImporting,
    error: importError,
    handlePickAndPreview,
    handleCommitImport,
    handleCancel: handleImportCancel,
  } = useImportCharacterOKF()
  const [isCreatingClone, setIsCreatingClone] = useState(false)
  const clonedCharacterIdRef = useRef<string | null>(null)

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

  const handleCreateFromBundle = () => {
    clonedCharacterIdRef.current = null
    handlePickAndPreview(OKF_CLONE_PREVIEW_ENTITY_ID)
  }

  const handleCloneCancel = () => {
    clonedCharacterIdRef.current = null
    handleImportCancel()
  }

  const handleCloneDismiss = () => {
    if (!isImporting && !isCreatingClone) {
      handleCloneCancel()
    }
  }

  const handleConfirmClone = async () => {
    if (!userId) return
    setIsCreatingClone(true)
    try {
      let characterId = clonedCharacterIdRef.current
      if (!characterId) {
        const newCharacter = await createCharacter(userId, {
          name: 'Imported Character',
          is_public: false,
        })
        if (!newCharacter) throw new Error('Failed to create character')
        characterId = newCharacter.id
        clonedCharacterIdRef.current = characterId
        characterService.send({ type: 'LOAD' })
      }
      const imported = await handleCommitImport(characterId, 'clone')
      if (imported) {
        clonedCharacterIdRef.current = null
        router.push(`/chat/${characterId}`)
      }
    } catch (err) {
      reportError(err, 'okf-clone:create')
      setToastState({
        message: 'Failed to create character from bundle.',
        requiresSubscription: false,
      })
    } finally {
      setIsCreatingClone(false)
    }
  }

  const handleCloudSync = () => {
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

  useEffect(() => {
    if (importError && importError !== importErrorShownRef.current) {
      setToastState({
        message:
          (importError as Error & { displayMessage?: string }).displayMessage ?? importError.message,
        requiresSubscription: false,
      })
      importErrorShownRef.current = importError
    }
  }, [importError])

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
            onPress={() => {
              if (isCloudSyncing || isPending || isCreatingDefault) {
                return
              }
              handleCloudSync()
            }}
            loading={isCloudSyncing}
            disabled={isCloudSyncing || isPending || isCreatingDefault}
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
          <Button
            mode="outlined"
            icon="file-import-outline"
            onPress={handleCreateFromBundle}
            disabled={isImportParsing || isImporting || isCreatingClone}
            loading={isImportParsing}
          >
            From Bundle
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
        action={undefined}
      >
        {toastState?.message}
      </Snackbar>

      <Portal>
        <Modal
          visible={importPreview !== null}
          onDismiss={handleCloneDismiss}
          contentContainerStyle={[styles.cloneModal, { backgroundColor: colors.surface }]}
        >
          <Text variant="headlineSmall" style={styles.cloneModalTitle}>
            Create Character from Bundle
          </Text>
          <Text variant="bodyMedium">
            {importPreview
              ? `Ready to import ${importPreview.facts} facts, ${importPreview.tasks} tasks, ${importPreview.events} timeline events, ${importPreview.edges} relationships into a new character.`
              : ''}
          </Text>
          <Button
            mode="contained"
            onPress={() => {
              void handleConfirmClone()
            }}
            loading={isImporting || isCreatingClone}
            disabled={isImporting || isCreatingClone}
            style={styles.cloneModalButton}
          >
            Create Character
          </Button>
          <Button mode="text" onPress={handleCloneCancel} disabled={isImporting || isCreatingClone}>
            Cancel
          </Button>
        </Modal>
      </Portal>
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
  cloneModal: {
    margin: 24,
    padding: 24,
    borderRadius: 12,
    gap: 12,
  },
  cloneModalTitle: {
    fontWeight: 'bold',
  },
  cloneModalButton: {
    marginTop: 8,
  },
})

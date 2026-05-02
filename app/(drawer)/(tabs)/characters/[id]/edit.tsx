import { useLocalSearchParams, router } from 'expo-router'
import { Alert, View, StyleSheet, ScrollView, Share } from 'react-native'
import {
  Text,
  TextInput,
  Button,
  Divider,
  HelperText,
  Switch,
  Snackbar,
  Portal,
  Modal,
  Menu,
  useTheme,
} from 'react-native-paper'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useSelector } from '@xstate/react'
import { useCharacter, useUpdateCharacter, useUnsyncCharacter, useSyncCharacters } from '~/hooks/useCharacters'
import { useAuthMachine } from '~/hooks/useMachines'
import CharacterAvatar from '~/components/CharacterAvatar'
import { useImageGeneration } from '~/hooks/useImageGeneration'
import { useAvatarUpload } from '~/hooks/useAvatarUpload'
import { buildImagePrompt } from '~/utils/buildImagePrompt'
import { useEditDirtyState } from '~/hooks/useEditDirtyState'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { reportError } from '~/utilities/reportError'
import {
  buildCharacterShareUrl,
  buildNativeCharacterShareLink,
} from '~/utilities/characterShare'
import { DEFAULT_VOICE, GEMINI_VOICES } from '~/constants/geminiVoices'
import { useWikiExport } from '@equationalapplications/expo-llm-wiki/react'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { wikiSync } from '~/services/apiClient'
import { getWiki } from '~/services/wikiService'

export default function EditCharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const theme = useTheme()
  const authService = useAuthMachine()
  const { isSubscriber } = useCurrentPlan()
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }))
  const { character, isLoading } = useCharacter(id)
  const {
    update,
    isPending: isUpdating,
    error: updateError,
  } = useUpdateCharacter()
  const { isCloudUnsyncing, error: unsyncError } = useUnsyncCharacter()
  const { isCloudSyncing, error: cloudSyncError } = useSyncCharacters()
  const { execute: exportWiki, isPending: isWikiSyncing } = useWikiExport()

  const [name, setName] = useState('')
  const [appearance, setAppearance] = useState('')
  const [traits, setTraits] = useState('')
  const [emotions, setEmotions] = useState('')
  const [context, setContext] = useState('')
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE)
  const [voiceMenuVisible, setVoiceMenuVisible] = useState(false)
  const [saveToCloud, setSaveToCloud] = useState(false)
  const [isCharacterShareable, setIsCharacterShareable] = useState(false)
  const [avatarUri, setAvatarUri] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [didAttemptSave, setDidAttemptSave] = useState(false)
  const [toastState, setToastState] = useState<{
    message: string
    requiresSubscription: boolean
  } | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const prevIsUpdatingRef = useRef(false)
  const prevIsCloudUnsyncingRef = useRef(false)
  const prevIsCloudSyncingRef = useRef(false)

  // Track loaded values for dirty-state comparison
  const loadedValues = useMemo(() => {
    if (!character) return null
    return {
      name: character.name || '',
      appearance: character.appearance || '',
      traits: character.traits || '',
      emotions: character.emotions || '',
      context: character.context || '',
      voice: character.voice ?? DEFAULT_VOICE,
      saveToCloud: character.save_to_cloud ? 'true' : 'false',
      isShareable: character.is_public ? 'true' : 'false',
    }
  }, [character])

  const canEdit = useMemo(() => {
    if (!character || !user?.uid) return false
    // Treat empty owner_user_id as unknown ownership:
    // - allow edits for purely local legacy characters (no cloud_id)
    // - deny edits for cloud/shared characters with unknown ownership
    if (!character.owner_user_id) return !character.cloud_id
    return user.uid === character.owner_user_id
  }, [character, user?.uid])

  useEditDirtyState(
    canEdit
      ? {
          name,
          appearance,
          traits,
          emotions,
          context,
          voice,
          saveToCloud: saveToCloud ? 'true' : 'false',
          isShareable: isCharacterShareable ? 'true' : 'false',
        }
      : loadedValues ?? {
          name: '',
          appearance: '',
          traits: '',
          emotions: '',
          context: '',
          voice: DEFAULT_VOICE,
          saveToCloud: 'false',
          isShareable: 'false',
        },
    loadedValues,
  )

  // Update local state when character data loads
  useEffect(() => {
    if (character) {
      setName(character.name || '')
      setAppearance(character.appearance || '')
      setTraits(character.traits || '')
      setEmotions(character.emotions || '')
      setContext(character.context || '')
      setSaveToCloud(character.save_to_cloud ?? false)
      setIsCharacterShareable(character.is_public || false)
      setVoice(character.voice ?? DEFAULT_VOICE)
      setAvatarUri(character.avatar ?? null)
    }
  }, [character])

  // Effect to handle navigation after saving
  useEffect(() => {
    const justFinishedUpdating = !isUpdating && prevIsUpdatingRef.current
    const justFinishedUnsyncing = !isCloudUnsyncing && prevIsCloudUnsyncingRef.current
    const justFinishedSyncing = !isCloudSyncing && prevIsCloudSyncingRef.current
    if (isSaving && !isUpdating && !isCloudUnsyncing && !isCloudSyncing && (justFinishedUpdating || justFinishedUnsyncing || justFinishedSyncing)) {
      // Update (and any subsequent cloud sync or unsync) has completed
      setIsSaving(false)
      if (!updateError && !unsyncError && !cloudSyncError) {
        // Success: navigate away only if there's no error
        if (router.canGoBack()) {
          router.back()
        } else {
          router.replace('/characters/list')
        }
      }
      // If there's an error, stay on the page so the error message is visible.
    }
    prevIsUpdatingRef.current = isUpdating
    prevIsCloudUnsyncingRef.current = isCloudUnsyncing
    prevIsCloudSyncingRef.current = isCloudSyncing
  }, [isUpdating, isCloudUnsyncing, isCloudSyncing, isSaving, updateError, unsyncError, cloudSyncError])

  const {
    generateImage,
    isGenerating,
    error: imageError,
    clearError,
  } = useImageGeneration({
    characterId: id || '',
    onImageGenerated: (fileUri) => setAvatarUri(fileUri),
  })

  const {
    uploadAvatar,
    isUploading,
    error: uploadError,
    clearError: clearUploadError,
  } = useAvatarUpload({
    characterId: id || '',
    onImageUploaded: (dataUri) => setAvatarUri(dataUri),
  })

  const avatarError = uploadError || imageError

  const handleSave = () => {
    if (!id || !user?.uid) return
    setDidAttemptSave(true)
    setIsSaving(true)
    update(id, {
      name,
      appearance,
      traits,
      emotions,
      context,
      save_to_cloud: saveToCloud,
      is_public: saveToCloud ? isCharacterShareable : false,
      voice,
    })
  }

  const cloudCharacterId = character?.cloud_id ?? null
  const shareUrl = cloudCharacterId ? buildCharacterShareUrl(cloudCharacterId) : null
  const nativeShareLink = cloudCharacterId ? buildNativeCharacterShareLink(cloudCharacterId) : null

  const handleToggleSaveToCloud = (nextValue: boolean) => {
    if (nextValue && !isSubscriber) {
      setToastState({
        message: 'Cloud character save requires a monthly subscription.',
        requiresSubscription: true,
      })
      return
    }

    if (!nextValue && character?.save_to_cloud === true) {
      Alert.alert(
        'Remove from Cloud?',
        'Are you sure you want to remove the character from the cloud?',
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'Confirm',
            onPress: () => {
              setSaveToCloud(false)
              setIsCharacterShareable(false)
            },
          },
        ],
      )
      return
    }

    setSaveToCloud(nextValue)
    if (!nextValue) {
      setIsCharacterShareable(false)
    }
  }

  const handleWikiSync = async () => {
    if (!cloudCharacterId) {
      setToastState({
        message: 'Save this character to cloud and sync it first, then try again.',
        requiresSubscription: false,
      })
      return
    }
    try {
      const localDump = await exportWiki([id])
      const cloudDump: MemoryDump = {
        generatedAt: localDump.generatedAt,
        entities: {
          [cloudCharacterId]: localDump.entities[id] ?? { facts: [], tasks: [], events: [] },
        },
      }
      const result = await wikiSync({ dump: cloudDump })
      const remoteDump = result.data.remoteDump
      if (remoteDump) {
        const remappedDump: MemoryDump = {
          generatedAt: remoteDump.generatedAt,
          entities: {
            [id]: remoteDump.entities[cloudCharacterId] ?? { facts: [], tasks: [], events: [] },
          },
        }
        let importSucceeded = true
        try {
          await getWiki().importDump(remappedDump, { merge: true })
        } catch (importErr) {
          if (importErr instanceof WikiBusyError) {
            importSucceeded = false
            // Cloud sync succeeded; local merge skipped because wiki is busy.
            // The remote dump will be merged on the next manual or automatic sync.
          } else {
            throw importErr
          }
        }
        if (importSucceeded) {
          try {
            await getWiki().runPrune(id, { retainSoftDeletedFor: 7, retainEventsFor: 30, vacuum: false })
          } catch (pruneErr) {
            if (!(pruneErr instanceof WikiBusyError)) {
              console.warn('runPrune failed after wiki sync', pruneErr)
            }
          }
        }
      }
      setToastState({ message: 'Memory synced to cloud.', requiresSubscription: false })
    } catch (syncErr) {
      console.warn('handleWikiSync failed', syncErr)
      setToastState({ message: 'Failed to sync memory. Check your connection and try again.', requiresSubscription: false })
    }
  }

  const handleOpenShareCard = () => {
    if (!cloudCharacterId || !shareUrl) {
      setToastState({
        message: 'Save this character to cloud and sync it first, then try sharing again.',
        requiresSubscription: false,
      })
      return
    }
    setShowShareModal(true)
  }

  const handleShare = async () => {
    if (!shareUrl) {
      setToastState({
        message: 'No share link available for this character yet.',
        requiresSubscription: false,
      })
      return
    }

    const title = `Meet ${name || character?.name || 'my character'} on Clanker`
    const messageLines = [
      title,
      '',
      `Web link: ${shareUrl}`,
      nativeShareLink ? `App deep link: ${nativeShareLink}` : null,
    ].filter(Boolean) as string[]

    try {
      await Share.share({
        title,
        message: messageLines.join('\n'),
        url: shareUrl,
      })
    } catch (error) {
      reportError(error, 'characterShare')
      setToastState({
        message: 'Sharing was unsuccessful. Please try again.',
        requiresSubscription: false,
      })
    }
  }

  if (isLoading) {
    return (
      <View style={styles.container}>
        <Text>Loading character...</Text>
      </View>
    )
  }

  if (!character) {
    return (
      <View style={styles.container}>
        <Text>Character not found</Text>
        <Button
          mode="contained"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace('/characters/list')
          }
        >
          Go Back
        </Button>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Keep snackbar as a sibling so it anchors to viewport bottom instead of scroll content. */}
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text variant="headlineMedium" style={styles.title}>
            Edit Character
          </Text>

          <View style={styles.avatarContainer}>
            <CharacterAvatar size={120} imageUrl={avatarUri} characterName={name} />
            <View style={styles.avatarActionsRow}>
              <Button
                mode="outlined"
                icon={isUploading ? undefined : 'image-plus'}
                onPress={() => {
                  clearError()
                  clearUploadError()
                  uploadAvatar()
                }}
                disabled={isUploading || isGenerating || !canEdit}
                loading={isUploading}
                style={styles.avatarActionButton}
              >
                Upload Photo
              </Button>
              <Button
                mode="outlined"
                icon={isGenerating ? undefined : 'image-auto-adjust'}
                onPress={() => {
                  clearError()
                  clearUploadError()
                  generateImage(buildImagePrompt({ name, appearance, traits, emotions }))
                }}
                disabled={isGenerating || isUploading || !canEdit}
                loading={isGenerating}
                style={styles.avatarActionButton}
              >
                {avatarUri ? 'Regenerate Image' : 'Generate Image'}
              </Button>
            </View>
            {avatarError ? (
              <HelperText type="error" visible>
                {avatarError}
              </HelperText>
            ) : null}
          </View>

          <Divider style={styles.avatarDivider} />

          <TextInput
            label="Name"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
            maxLength={30}
            editable={canEdit}
          />

          <TextInput
            label="Appearance"
            value={appearance}
            onChangeText={setAppearance}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={3}
            maxLength={144}
            editable={canEdit}
          />

          <TextInput
            label="Personality Traits"
            value={traits}
            onChangeText={setTraits}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={3}
            maxLength={144}
            editable={canEdit}
          />

          <TextInput
            label="Emotions"
            value={emotions}
            onChangeText={setEmotions}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={3}
            maxLength={144}
            editable={canEdit}
          />

          <TextInput
            label="Context"
            value={context}
            onChangeText={setContext}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={4}
            editable={canEdit}
          />

          <Divider style={styles.voiceDivider} />

          <Text variant="labelLarge" style={styles.voiceLabel}>Voice</Text>
          <Menu
            visible={voiceMenuVisible}
            onDismiss={() => setVoiceMenuVisible(false)}
            anchor={
              <Button
                mode="outlined"
                onPress={() => canEdit && setVoiceMenuVisible(true)}
                disabled={!canEdit}
                style={styles.voiceButton}
              >
                {(() => {
                  const style = GEMINI_VOICES.find((v) => v.name === voice)?.style
                  return style ? `${voice} — ${style}` : voice
                })()}
              </Button>
            }
          >
            {GEMINI_VOICES.map((v) => (
              <Menu.Item
                key={v.name}
                title={`${v.name} — ${v.style}`}
                onPress={() => {
                  setVoice(v.name)
                  setVoiceMenuVisible(false)
                }}
              />
            ))}
          </Menu>

          <View style={styles.toggleRow}>
            <View style={styles.toggleTextContainer}>
              <Text variant="titleMedium">Save to Cloud</Text>
              <Text variant="bodySmall" style={styles.toggleHelperText}>
                Requires a monthly subscription.
              </Text>
            </View>
            <Switch value={saveToCloud} onValueChange={handleToggleSaveToCloud} disabled={!canEdit} />
          </View>

          {character.owner_user_id && canEdit ? (
            <Text variant="bodySmall" style={styles.ownershipText}>
              You own this character. Only you can edit the cloud version.
            </Text>
          ) : character.owner_user_id && !canEdit ? (
            <Text variant="bodySmall" style={styles.ownershipText}>
              You can view this character, but only the owner can edit it.
            </Text>
          ) : null}

          <View style={styles.toggleRow}>
            <View style={styles.toggleTextContainer}>
              <Text variant="titleMedium">Make Character Shareable</Text>
              <Text variant="bodySmall" style={styles.toggleHelperText}>
                Enabled only when cloud saving is on.
              </Text>
            </View>
            <Switch
              value={isCharacterShareable}
              onValueChange={setIsCharacterShareable}
              disabled={!saveToCloud || !canEdit}
            />
          </View>

          {isCharacterShareable ? (
            <Button mode="outlined" icon="share-variant" onPress={handleOpenShareCard} style={styles.shareButton} disabled={!canEdit}>
              Share Character
            </Button>
          ) : null}

          {isSubscriber && canEdit && character?.save_to_cloud && character?.cloud_id ? (
            <Button
              mode="outlined"
              icon="brain"
              onPress={handleWikiSync}
              disabled={isWikiSyncing}
              loading={isWikiSyncing}
              style={styles.shareButton}
            >
              Sync Memory
            </Button>
          ) : null}

          <Divider style={styles.divider} />

          <View style={styles.buttonContainer}>
            <Button
              mode="text"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/characters/list'))}
              style={styles.button}
            >
              Cancel
            </Button>
            <Button
              mode="contained"
              onPress={handleSave}
              disabled={isSaving || isUpdating || isCloudUnsyncing || isCloudSyncing || !canEdit}
              loading={isSaving || isUpdating || isCloudUnsyncing || isCloudSyncing}
              style={styles.button}
            >
              Save Changes
            </Button>
          </View>
          {didAttemptSave && (updateError || unsyncError || cloudSyncError) ? (
            <HelperText type="error" visible style={styles.errorText}>
              {unsyncError instanceof Error
                ? unsyncError.message
                : cloudSyncError instanceof Error
                ? cloudSyncError.message
                : updateError instanceof Error
                ? updateError.message
                : 'Failed to save character. Please try again.'}
            </HelperText>
          ) : null}
        </View>

        <Portal>
          <Modal
            visible={showShareModal}
            onDismiss={() => setShowShareModal(false)}
            contentContainerStyle={[styles.shareModal, { backgroundColor: theme.colors.surface }]}
          >
            <Text variant="headlineSmall" style={styles.shareTitle}>
              Share Character
            </Text>
            <CharacterAvatar size={96} imageUrl={avatarUri} characterName={name} />
            <Text variant="titleLarge" style={styles.shareCharacterName}>
              {name || 'Character'}
            </Text>
            {shareUrl ? (
              <>
                <Text selectable style={styles.shareLink}>
                  {shareUrl}
                </Text>
                <Button mode="contained" icon="share" onPress={handleShare}>
                  Share
                </Button>
              </>
            ) : (
              <Text variant="bodyMedium">No share link available yet.</Text>
            )}
          </Modal>
        </Portal>
      </ScrollView>

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
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  title: {
    marginBottom: 24,
  },
  avatarContainer: {
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  avatarActionsRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 8,
  },
  avatarActionButton: {
    flex: 1,
  },
  avatarDivider: {
    marginBottom: 20,
  },
  input: {
    marginBottom: 16,
  },
  voiceDivider: {
    marginBottom: 16,
  },
  voiceLabel: {
    marginBottom: 8,
  },
  voiceButton: {
    marginBottom: 16,
    alignSelf: 'stretch',
  },
  divider: {
    marginVertical: 20,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  toggleTextContainer: {
    flex: 1,
  },
  toggleHelperText: {
    opacity: 0.7,
  },
  shareButton: {
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  button: {
    flex: 1,
  },
  errorText: {
    marginTop: 8,
    textAlign: 'center',
  },
  shareModal: {
    margin: 20,
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    gap: 12,
  },
  shareTitle: {
    textAlign: 'center',
  },
  shareCharacterName: {
    textAlign: 'center',
  },
  shareLink: {
    textAlign: 'center',
  },
  ownershipText: {
    opacity: 0.7,
    marginBottom: 8,
  },
})

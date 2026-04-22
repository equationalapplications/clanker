import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet, ScrollView , Share } from 'react-native'
import { Image } from 'expo-image'
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
} from 'react-native-paper'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useSelector } from '@xstate/react'
import { useCharacter, useUpdateCharacter } from '~/hooks/useCharacters'
import { useAuthMachine } from '~/hooks/useMachines'
import CharacterAvatar from '~/components/CharacterAvatar'
import { useImageGeneration } from '~/hooks/useImageGeneration'
import { buildImagePrompt } from '~/utils/buildImagePrompt'
import { useEditDirtyState } from '~/hooks/useEditDirtyState'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import {
  buildCharacterQrCodeUrl,
  buildCharacterShareUrl,
  buildNativeCharacterShareLink,
} from '~/utilities/characterShare'

export default function EditCharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
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

  const [name, setName] = useState('')
  const [appearance, setAppearance] = useState('')
  const [traits, setTraits] = useState('')
  const [emotions, setEmotions] = useState('')
  const [context, setContext] = useState('')
  const [saveToCloud, setSaveToCloud] = useState(false)
  const [isShareable, setIsShareable] = useState(false)
  const [avatarUri, setAvatarUri] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [didAttemptSave, setDidAttemptSave] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showShareModal, setShowShareModal] = useState(false)
  const prevIsUpdatingRef = useRef(false)

  // Track loaded values for dirty-state comparison
  const loadedValues = useMemo(() => {
    if (!character) return null
    return {
      name: character.name || '',
      appearance: character.appearance || '',
      traits: character.traits || '',
      emotions: character.emotions || '',
      context: character.context || '',
      saveToCloud: character.save_to_cloud ? 'true' : 'false',
      isShareable: character.is_public ? 'true' : 'false',
    }
  }, [character])

  useEditDirtyState(
    {
      name,
      appearance,
      traits,
      emotions,
      context,
      saveToCloud: saveToCloud ? 'true' : 'false',
      isShareable: isSharable ? 'true' : 'false',
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
      setIsSharable(character.is_public || false)
      setAvatarUri(character.avatar ?? null)
    }
  }, [character])

  // Effect to handle navigation after saving
  useEffect(() => {
    if (isSaving && !isUpdating && prevIsUpdatingRef.current) {
      // Update just completed
      setIsSaving(false) // Reset saving trigger
      if (!updateError) {
        // Success: navigate away only if there's no error
        if (router.canGoBack()) {
          router.back()
        } else {
          router.replace('/characters/list')
        }
      }
      // If there's an error, we stay on the page, and an error message can be displayed.
    }
    prevIsUpdatingRef.current = isUpdating
  }, [isUpdating, isSaving, updateError])

  const {
    generateImage,
    isGenerating,
    error: imageError,
    clearError,
  } = useImageGeneration({
    characterId: id || '',
    onImageGenerated: (fileUri) => setAvatarUri(fileUri),
  })

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
      is_public: saveToCloud ? isSharable : false,
    })
  }

  const cloudCharacterId = character?.cloud_id ?? null
  const shareUrl = cloudCharacterId ? buildCharacterShareUrl(cloudCharacterId) : null
  const nativeShareLink = cloudCharacterId ? buildNativeCharacterShareLink(cloudCharacterId) : null
  const qrCodeUrl = shareUrl ? buildCharacterQrCodeUrl(shareUrl) : null

  const handleToggleSaveToCloud = (nextValue: boolean) => {
    if (nextValue && !isSubscriber) {
      setToastMessage('Cloud character save requires a monthly_20 or monthly_50 subscription.')
      return
    }

    setSaveToCloud(nextValue)
    if (!nextValue) {
      setIsSharable(false)
    }
  }

  const handleOpenShareCard = () => {
    if (!cloudCharacterId || !shareUrl) {
      setToastMessage('Save this character to cloud and sync it first, then try sharing again.')
      return
    }
    setShowShareModal(true)
  }

  const handleShare = async () => {
    if (!shareUrl) {
      setToastMessage('No share link available for this character yet.')
      return
    }

    const title = `Meet ${name || character?.name || 'my character'} on Clanker`
    const messageLines = [
      title,
      '',
      `Web link: ${shareUrl}`,
      nativeShareLink ? `App deep link: ${nativeShareLink}` : null,
    ].filter(Boolean) as string[]

    await Share.share({
      title,
      message: messageLines.join('\n'),
      url: shareUrl,
    })
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
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text variant="headlineMedium" style={styles.title}>
          Edit Character
        </Text>

        <View style={styles.avatarContainer}>
          <CharacterAvatar size={120} imageUrl={avatarUri} characterName={name} />
          <Button
            mode="outlined"
            icon={isGenerating ? undefined : 'image-auto-adjust'}
            onPress={() => {
              clearError()
              generateImage(buildImagePrompt({ name, appearance, traits, emotions }))
            }}
            disabled={isGenerating}
            loading={isGenerating}
            style={styles.generateButton}
          >
            {avatarUri ? 'Regenerate Image' : 'Generate Image'}
          </Button>
          {imageError ? (
            <HelperText type="error" visible>
              {imageError}
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
        />

        <TextInput
          label="Context"
          value={context}
          onChangeText={setContext}
          mode="outlined"
          style={styles.input}
          multiline
          numberOfLines={4}
        />

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextContainer}>
            <Text variant="titleMedium">Save to Cloud</Text>
            <Text variant="bodySmall" style={styles.toggleHelperText}>
              Requires monthly_20 or monthly_50 subscription.
            </Text>
          </View>
          <Switch value={saveToCloud} onValueChange={handleToggleSaveToCloud} />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextContainer}>
            <Text variant="titleMedium">Make Character Shareable</Text>
            <Text variant="bodySmall" style={styles.toggleHelperText}>
              Enabled only when cloud saving is on.
            </Text>
          </View>
          <Switch
            value={isSharable}
            onValueChange={setIsSharable}
            disabled={!saveToCloud}
          />
        </View>

        {isSharable ? (
          <Button mode="outlined" icon="share-variant" onPress={handleOpenShareCard} style={styles.shareButton}>
            Share Character
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
            disabled={isSaving || isUpdating}
            loading={isSaving || isUpdating}
            style={styles.button}
          >
            Save Changes
          </Button>
        </View>
        {didAttemptSave && updateError ? (
          <HelperText type="error" visible style={styles.errorText}>
            {updateError instanceof Error
              ? updateError.message
              : 'Failed to save character. Please try again.'}
          </HelperText>
        ) : null}
      </View>

      <Portal>
        <Modal
          visible={showShareModal}
          onDismiss={() => setShowShareModal(false)}
          contentContainerStyle={styles.shareModal}
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
              {qrCodeUrl ? (
                <Image
                  source={{ uri: qrCodeUrl }}
                  style={styles.qrImage}
                  contentFit="contain"
                />
              ) : null}
              <Button mode="contained" icon="share" onPress={handleShare}>
                Share
              </Button>
            </>
          ) : (
            <Text variant="bodyMedium">No share link available yet.</Text>
          )}
        </Modal>
      </Portal>

      <Snackbar
        visible={toastMessage !== null}
        onDismiss={() => setToastMessage(null)}
        duration={4000}
        action={{
          label: 'Subscribe',
          onPress: () => router.push('/subscribe'),
        }}
      >
        {toastMessage}
      </Snackbar>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
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
  generateButton: {
    alignSelf: 'center',
  },
  avatarDivider: {
    marginBottom: 20,
  },
  input: {
    marginBottom: 16,
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
    backgroundColor: '#fff',
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
  qrImage: {
    width: 220,
    height: 220,
  },
})

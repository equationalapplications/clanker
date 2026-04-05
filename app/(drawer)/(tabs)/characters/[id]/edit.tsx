import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet, ScrollView } from 'react-native'
import { Text, TextInput, Button, Divider, HelperText } from 'react-native-paper'
import { useState, useEffect, useMemo } from 'react'
import { useSelector } from '@xstate/react'
import { useCharacter, useUpdateCharacter } from '~/hooks/useCharacters'
import { useAuthMachine } from '~/hooks/useMachines'
import CharacterAvatar from '~/components/CharacterAvatar'
import { useLocalImageGeneration } from '~/hooks/useLocalImageGeneration'
import { buildImagePrompt } from '~/utils/buildImagePrompt'
import { useEditDirtyState } from '~/hooks/useEditDirtyState'

export default function EditCharacterScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const authService = useAuthMachine()
  const { user } = useSelector(authService, (state) => ({
    user: state.context.user,
  }))
  const { character, isLoading } = useCharacter(id)
  const { update } = useUpdateCharacter()

  const [name, setName] = useState('')
  const [appearance, setAppearance] = useState('')
  const [traits, setTraits] = useState('')
  const [emotions, setEmotions] = useState('')
  const [context, setContext] = useState('')
  const [avatarUri, setAvatarUri] = useState<string | null>(null)

  // Track loaded values for dirty-state comparison
  const loadedValues = useMemo(() => {
    if (!character) return null
    return {
      name: character.name || '',
      appearance: character.appearance || '',
      traits: character.traits || '',
      emotions: character.emotions || '',
      context: character.context || '',
    }
  }, [character])

  useEditDirtyState({ name, appearance, traits, emotions, context }, loadedValues)

  // Update local state when character data loads
  useEffect(() => {
    if (character) {
      setName(character.name || '')
      setAppearance(character.appearance || '')
      setTraits(character.traits || '')
      setEmotions(character.emotions || '')
      setContext(character.context || '')
      setAvatarUri(character.avatar ?? null)
    }
  }, [character])

  const {
    generateImage,
    isGenerating,
    error: imageError,
    clearError,
  } = useLocalImageGeneration({
    characterId: id || '',
    onImageGenerated: (fileUri) => setAvatarUri(fileUri),
  })

  const handleSave = () => {
    if (!id || !user?.uid) return

    try {
      update(id, {
        name,
        appearance,
        traits,
        emotions,
        context,
      })
      if (router.canGoBack()) {
        router.back()
      } else {
        router.replace('/characters/list')
      }
    } catch (error) {
      console.error('Failed to save character:', error)
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

        <Divider style={styles.divider} />

        <View style={styles.buttonContainer}>
          <Button mode="outlined" onPress={() => router.back()} style={styles.button}>
            Cancel
          </Button>
          <Button mode="contained" onPress={handleSave} style={styles.button}>
            Save Changes
          </Button>
        </View>
      </View>
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
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  button: {
    flex: 1,
  },
})

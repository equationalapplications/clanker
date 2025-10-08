/**
 * Example: Character Management with Offline Support
 *
 * This file demonstrates best practices for using React Query hooks
 * with offline capabilities in the Yours Brightly app.
 */

import React, { useState } from 'react'
import { View, FlatList, RefreshControl, StyleSheet, Alert } from 'react-native'
import { Button, Card, Text, TextInput, ActivityIndicator } from 'react-native-paper'
import {
  useCharacters,
  useCharacter,
  useCreateCharacter,
  useUpdateCharacter,
  useDeleteCharacter,
} from '~/hooks/useCharacters'

/**
 * Example 1: List all characters with loading, error, and empty states
 */
export function CharacterListExample() {
  const { characters, isLoading, error, refetch, isRefetching } = useCharacters()

  // Handle loading state on first load
  if (isLoading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" />
        <Text>Loading characters...</Text>
      </View>
    )
  }

  // Handle error state with retry button
  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Failed to load characters</Text>
        <Text>{error.message}</Text>
        <Button mode="contained" onPress={() => refetch()}>
          Retry
        </Button>
      </View>
    )
  }

  // Handle empty state
  if (characters.length === 0) {
    return (
      <View style={styles.centerContainer}>
        <Text>No characters yet</Text>
        <Text>Create your first character to get started!</Text>
      </View>
    )
  }

  // Render list with pull-to-refresh
  return (
    <FlatList
      data={characters}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      renderItem={({ item }) => (
        <Card style={styles.card}>
          <Card.Title title={item.name} subtitle={item.appearance} />
          <Card.Content>
            <Text>Traits: {item.traits}</Text>
            <Text>Emotions: {item.emotions}</Text>
          </Card.Content>
        </Card>
      )}
    />
  )
}

/**
 * Example 2: View single character with real-time updates
 */
export function CharacterDetailExample({ characterId }: { characterId: string }) {
  const { character, isLoading, error } = useCharacter(characterId)

  if (isLoading) {
    return <ActivityIndicator />
  }

  if (error) {
    return <Text>Error: {error.message}</Text>
  }

  if (!character) {
    return <Text>Character not found</Text>
  }

  return (
    <View>
      <Text variant="headlineMedium">{character.name}</Text>
      <Text variant="bodyLarge">{character.appearance}</Text>
      <Text>Traits: {character.traits}</Text>
      <Text>Emotions: {character.emotions}</Text>
      <Text>Context: {character.context}</Text>
    </View>
  )
}

/**
 * Example 3: Create character with optimistic update
 */
export function CreateCharacterExample() {
  const [name, setName] = useState('')
  const [appearance, setAppearance] = useState('')
  const createCharacter = useCreateCharacter()

  const handleCreate = async () => {
    if (!name || !appearance) {
      Alert.alert('Error', 'Please fill in all fields')
      return
    }

    try {
      await createCharacter.mutateAsync({
        name,
        appearance,
        traits: 'Friendly and helpful',
        emotions: 'Happy and excited',
        context: 'A new companion ready to chat',
        is_public: false,
      })

      // Character appears in list immediately (optimistic update)
      // Form resets only after successful creation
      setName('')
      setAppearance('')
      Alert.alert('Success', 'Character created!')
    } catch (error) {
      // Error is automatically rolled back, no manual cleanup needed
      Alert.alert('Error', 'Failed to create character')
    }
  }

  return (
    <View style={styles.form}>
      <TextInput
        label="Name"
        value={name}
        onChangeText={setName}
        disabled={createCharacter.isPending}
      />
      <TextInput
        label="Appearance"
        value={appearance}
        onChangeText={setAppearance}
        disabled={createCharacter.isPending}
        multiline
      />
      <Button
        mode="contained"
        onPress={handleCreate}
        loading={createCharacter.isPending}
        disabled={createCharacter.isPending}
      >
        Create Character
      </Button>
      {createCharacter.isError && (
        <Text style={styles.errorText}>
          {createCharacter.error?.message || 'Failed to create character'}
        </Text>
      )}
    </View>
  )
}

/**
 * Example 4: Update character with optimistic update
 */
export function EditCharacterExample({ characterId }: { characterId: string }) {
  const { character } = useCharacter(characterId)
  const updateCharacter = useUpdateCharacter()
  const [name, setName] = useState(character?.name || '')
  const [appearance, setAppearance] = useState(character?.appearance || '')

  const handleSave = async () => {
    try {
      await updateCharacter.mutateAsync({
        id: characterId,
        updates: { name, appearance },
      })

      // Update appears immediately in UI (optimistic update)
      Alert.alert('Success', 'Character updated!')
    } catch (error) {
      // Automatically rolled back on error
      Alert.alert('Error', 'Failed to update character')
    }
  }

  if (!character) return null

  return (
    <View style={styles.form}>
      <TextInput
        label="Name"
        value={name}
        onChangeText={setName}
        disabled={updateCharacter.isPending}
      />
      <TextInput
        label="Appearance"
        value={appearance}
        onChangeText={setAppearance}
        disabled={updateCharacter.isPending}
        multiline
      />
      <Button
        mode="contained"
        onPress={handleSave}
        loading={updateCharacter.isPending}
        disabled={updateCharacter.isPending}
      >
        Save Changes
      </Button>
    </View>
  )
}

/**
 * Example 5: Delete character with confirmation
 */
export function DeleteCharacterExample({ characterId }: { characterId: string }) {
  const deleteCharacter = useDeleteCharacter()

  const handleDelete = () => {
    Alert.alert('Delete Character', 'Are you sure? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCharacter.mutateAsync(characterId)
            // Character removed from list immediately (optimistic update)
            Alert.alert('Success', 'Character deleted')
          } catch (error) {
            // Automatically rolled back on error
            Alert.alert('Error', 'Failed to delete character')
          }
        },
      },
    ])
  }

  return (
    <Button
      mode="contained"
      onPress={handleDelete}
      loading={deleteCharacter.isPending}
      disabled={deleteCharacter.isPending}
      buttonColor="red"
    >
      Delete Character
    </Button>
  )
}

/**
 * Example 6: Offline indicator
 */
export function OfflineIndicatorExample() {
  const { isLoading, isFetching, error } = useCharacters()

  // Show indicator when offline and using cached data
  if (error && error.message.includes('network')) {
    return (
      <View style={styles.offlineBanner}>
        <Text style={styles.offlineText}>📡 Offline - Showing cached data</Text>
      </View>
    )
  }

  // Show indicator when syncing in background
  if (isFetching && !isLoading) {
    return (
      <View style={styles.syncBanner}>
        <Text>🔄 Syncing...</Text>
      </View>
    )
  }

  return null
}

/**
 * Example 7: Complete screen with all features
 */
export function CharacterManagementScreen() {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)

  return (
    <View style={styles.container}>
      <OfflineIndicatorExample />

      {selectedCharacterId ? (
        <>
          <CharacterDetailExample characterId={selectedCharacterId} />
          <EditCharacterExample characterId={selectedCharacterId} />
          <DeleteCharacterExample characterId={selectedCharacterId} />
          <Button onPress={() => setSelectedCharacterId(null)}>Back to List</Button>
        </>
      ) : (
        <>
          <CreateCharacterExample />
          <CharacterListExample />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    marginBottom: 16,
  },
  form: {
    gap: 16,
    marginBottom: 24,
  },
  errorText: {
    color: 'red',
    marginTop: 8,
  },
  offlineBanner: {
    backgroundColor: '#FFA500',
    padding: 8,
    alignItems: 'center',
  },
  offlineText: {
    color: 'white',
    fontWeight: 'bold',
  },
  syncBanner: {
    backgroundColor: '#E3F2FD',
    padding: 8,
    alignItems: 'center',
  },
})

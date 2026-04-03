import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet, ScrollView } from 'react-native'
import { Text, Button, Divider, ActivityIndicator, Icon } from 'react-native-paper'
import { useCharacter } from '~/hooks/useCharacters'

export default function CharacterDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: character, isLoading } = useCharacter(id)

  const handleEditCharacter = () => {
    router.push(`/characters/${id}/edit`)
  }

  const handleStartChat = () => {
    router.push(`/characters/${id}/chat`)
  }

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  if (!character) {
    return (
      <View style={styles.centered}>
        <Text variant="bodyLarge">Character not found</Text>
        <Button mode="contained" style={styles.button} onPress={() => router.back()}>
          Go Back
        </Button>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <Icon source="account-circle-outline" size={56} />
          <View style={styles.headerInfo}>
            <Text variant="headlineMedium" style={styles.title}>
              {character.name}
            </Text>
          </View>
        </View>

        <Divider style={styles.divider} />

        {character.appearance ? (
          <View style={styles.field}>
            <Text variant="labelLarge" style={styles.label}>
              Appearance
            </Text>
            <Text variant="bodyMedium">{character.appearance}</Text>
          </View>
        ) : null}

        {character.traits ? (
          <View style={styles.field}>
            <Text variant="labelLarge" style={styles.label}>
              Personality Traits
            </Text>
            <Text variant="bodyMedium">{character.traits}</Text>
          </View>
        ) : null}

        {character.emotions ? (
          <View style={styles.field}>
            <Text variant="labelLarge" style={styles.label}>
              Emotions
            </Text>
            <Text variant="bodyMedium">{character.emotions}</Text>
          </View>
        ) : null}

        {character.context ? (
          <View style={styles.field}>
            <Text variant="labelLarge" style={styles.label}>
              Context
            </Text>
            <Text variant="bodyMedium">{character.context}</Text>
          </View>
        ) : null}

        <Divider style={styles.divider} />

        <View style={styles.buttonContainer}>
          <Button
            mode="contained"
            style={styles.button}
            icon="pencil"
            onPress={handleEditCharacter}
          >
            Edit Character
          </Button>
          <Button mode="contained" style={styles.button} icon="chat" onPress={handleStartChat}>
            Start Chat
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerInfo: {
    flex: 1,
  },
  title: {
    fontWeight: 'bold',
  },
  divider: {
    marginVertical: 20,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    marginBottom: 4,
    opacity: 0.7,
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    marginTop: 4,
  },
})

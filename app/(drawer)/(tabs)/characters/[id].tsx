import { useLocalSearchParams, router } from 'expo-router'
import { View, StyleSheet, ScrollView } from 'react-native'
import { Text, Button, Divider } from 'react-native-paper'

export default function CharacterDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()

  const handleEditCharacter = () => {
    router.push(`/characters/${id}/edit`)
  }

  const handleStartChat = () => {
    router.push(`/characters/${id}/chat`)
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text variant="headlineMedium" style={styles.title}>
          Character Details
        </Text>
        <Text variant="bodyLarge" style={styles.id}>
          ID: {id}
        </Text>

        <Divider style={styles.divider} />

        {/* Character Information Section */}
        <View style={styles.section}>
          <Text variant="titleLarge" style={styles.sectionTitle}>
            Character Information
          </Text>
          <Text variant="bodyMedium" style={styles.note}>
            TODO: Display character details (name, appearance, personality, etc.)
          </Text>
          <Button mode="contained" style={styles.button} onPress={handleEditCharacter}>
            Edit Character
          </Button>
        </View>

        <Divider style={styles.divider} />

        {/* Chat Section */}
        <View style={styles.section}>
          <Text variant="titleLarge" style={styles.sectionTitle}>
            Chat with Character
          </Text>
          <Text variant="bodyMedium" style={styles.note}>
            TODO: Implement chat interface here
          </Text>
          <Button mode="contained" style={styles.button} onPress={handleStartChat}>
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
  content: {
    padding: 20,
  },
  title: {
    marginBottom: 8,
  },
  id: {
    opacity: 0.7,
    marginBottom: 20,
  },
  divider: {
    marginVertical: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  note: {
    opacity: 0.7,
    marginBottom: 16,
  },
  button: {
    marginTop: 8,
  },
})

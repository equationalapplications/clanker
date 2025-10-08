import { View, StyleSheet, ScrollView } from 'react-native'
import { Text } from 'react-native-paper'

export default function ChatsScreen() {
  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text variant="headlineMedium" style={styles.title}>
          Chats
        </Text>
        <Text variant="bodyMedium" style={styles.note}>
          TODO: Implement chats list UI here
        </Text>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  title: {
    marginBottom: 20,
  },
  note: {
    opacity: 0.7,
  },
})

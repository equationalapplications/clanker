import { useLocalSearchParams } from 'expo-router'
import { ScrollView, StyleSheet, View, Alert } from 'react-native'
import { Text, List, IconButton, Divider, ActivityIndicator, useTheme } from 'react-native-paper'
import { useCallback, useState } from 'react'
import { useMemoryBundle } from '~/hooks/useMemoryBundle'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import type { WikiFact, WikiTask, WikiEvent } from '@equationalapplications/expo-llm-wiki'

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function FactItem({ fact, onDelete }: { fact: WikiFact; onDelete: (id: string) => void }) {
  return (
    <List.Item
      title={fact.title}
      description={`${fact.body}\n${fact.confidence} · ${fact.source_type.replace(/_/g, ' ')} · ${formatDate(fact.created_at)}`}
      descriptionNumberOfLines={4}
      left={(props) => <List.Icon {...props} icon="lightbulb-outline" />}
      right={() => (
        <IconButton
          icon="delete-outline"
          size={20}
          onPress={() => onDelete(fact.id)}
          accessibilityLabel="Delete"
        />
      )}
    />
  )
}

function TaskItem({ task, onDelete }: { task: WikiTask; onDelete: (id: string) => void }) {
  return (
    <List.Item
      title={task.description}
      description={`${task.status} · priority ${task.priority} · ${formatDate(task.created_at)}`}
      descriptionNumberOfLines={2}
      left={(props) => <List.Icon {...props} icon="checkbox-marked-outline" />}
      right={() => (
        <IconButton
          icon="delete-outline"
          size={20}
          onPress={() => onDelete(task.id)}
          accessibilityLabel="Delete"
        />
      )}
    />
  )
}

function EventItem({ event }: { event: WikiEvent }) {
  return (
    <List.Item
      title={event.summary}
      description={`${event.event_type} · ${formatDate(event.created_at)}`}
      descriptionNumberOfLines={2}
      left={(props) => <List.Icon {...props} icon="clock-outline" />}
    />
  )
}

export default function MemoryInspectorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const entityId = typeof id === 'string' ? id : ''
  const theme = useTheme()
  const { bundle, isLoading, error, refetch } = useMemoryBundle(entityId)
  const { forget } = useCharacterWiki(entityId)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- deletingId reserved for in-flight UI (plan)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDeleteFact = useCallback(
    (entryId: string) => {
      Alert.alert('Delete Fact', 'This fact will be permanently removed.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(entryId)
            try {
              await forget({ entryId })
              await refetch()
            } finally {
              setDeletingId(null)
            }
          },
        },
      ])
    },
    [forget, refetch],
  )

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      Alert.alert('Delete Task', 'This task will be permanently removed.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingId(taskId)
            try {
              await forget({ taskId })
              await refetch()
            } finally {
              setDeletingId(null)
            }
          },
        },
      ])
    },
    [forget, refetch],
  )

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Loading memory…</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: theme.colors.error }}>Failed to load memory: {error.message}</Text>
      </View>
    )
  }

  const facts = bundle?.facts.filter((f) => !f.deleted_at) ?? []
  const tasks = bundle?.tasks.filter((t) => !t.deleted_at) ?? []
  const events = bundle?.events ?? []

  const isEmpty = facts.length === 0 && tasks.length === 0 && events.length === 0

  return (
    <ScrollView style={styles.container}>
      {isEmpty ? (
        <View style={styles.centered}>
          <Text variant="bodyLarge" style={styles.emptyText}>
            No memory entries yet. Chat with this character to build their memory.
          </Text>
        </View>
      ) : null}

      {facts.length > 0 ? (
        <List.Section>
          <List.Subheader>Facts ({facts.length})</List.Subheader>
          {facts.map((fact) => (
            <FactItem key={fact.id} fact={fact} onDelete={handleDeleteFact} />
          ))}
        </List.Section>
      ) : null}

      {facts.length > 0 && tasks.length > 0 ? <Divider /> : null}

      {tasks.length > 0 ? (
        <List.Section>
          <List.Subheader>Tasks ({tasks.length})</List.Subheader>
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} onDelete={handleDeleteTask} />
          ))}
        </List.Section>
      ) : null}

      {(facts.length > 0 || tasks.length > 0) && events.length > 0 ? <Divider /> : null}

      {events.length > 0 ? (
        <List.Section>
          <List.Subheader>Events ({events.length})</List.Subheader>
          {events.map((event) => (
            <EventItem key={event.id} event={event} />
          ))}
        </List.Section>
      ) : null}
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
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
  },
  emptyText: {
    textAlign: 'center',
    opacity: 0.7,
  },
})

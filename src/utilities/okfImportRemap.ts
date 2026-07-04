import { randomUUID } from 'expo-crypto'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'

export function remapOkfDumpIds(dump: MemoryDump, entityId: string): MemoryDump {
  const entity = dump.entities[entityId]
  if (!entity) return dump

  const idMap = new Map<string, string>()
  for (const fact of entity.facts) {
    idMap.set(fact.id, randomUUID())
  }
  for (const task of entity.tasks) {
    idMap.set(task.id, randomUUID())
  }

  const remappedFacts = entity.facts.map((fact) => ({
    ...fact,
    id: idMap.get(fact.id) ?? fact.id,
  }))
  const remappedTasks = entity.tasks.map((task) => ({
    ...task,
    id: idMap.get(task.id) ?? task.id,
  }))

  const remappedEdges = (entity.edges ?? []).flatMap((edge) => {
    const sourceId = idMap.get(edge.source_id)
    const targetId = idMap.get(edge.target_id)
    if (!sourceId || !targetId) return []
    return [{ ...edge, source_id: sourceId, target_id: targetId }]
  })

  const remappedEvents = entity.events.map((event) => {
    if (!event.related_entry_id) return event
    // Defensive: every fact/task in this entity was just remapped above, so
    // related_entry_id should always resolve. If it somehow doesn't, null it
    // out rather than leave a reference to an id that no longer exists.
    const remappedRelatedId = idMap.get(event.related_entry_id)
    return { ...event, related_entry_id: remappedRelatedId ?? null }
  })

  return {
    ...dump,
    entities: {
      ...dump.entities,
      [entityId]: {
        ...entity,
        facts: remappedFacts,
        tasks: remappedTasks,
        edges: remappedEdges,
        events: remappedEvents,
      },
    },
  }
}

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
    // As of OKF profile v1 (core-llm-wiki 4.18+), parseOkfBundle preserves
    // event ids from log.md id comments. A clone beside a still-live source
    // character would collide on the events table's id primary key and be
    // silently dropped by INSERT OR IGNORE — regenerate, matching the
    // package's own evt_ prefix convention.
    const remappedRelatedId = event.related_entry_id
      ? (idMap.get(event.related_entry_id) ?? null)
      : null
    return { ...event, id: `evt_${randomUUID()}`, related_entry_id: remappedRelatedId }
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

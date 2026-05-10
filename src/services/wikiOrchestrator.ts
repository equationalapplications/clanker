import { createActor, type ActorRefFrom } from 'xstate'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
import { wikiMachine } from '~/machines/wikiMachine'
import type { Wiki } from '~/services/wikiService'

type WikiActor = ActorRefFrom<typeof wikiMachine>

const actors = new Map<string, WikiActor>()

export interface SyncAllItem {
  entityId: string
  runRemoteSync: (dump: MemoryDump) => Promise<MemoryDump | null>
}

function getOrSpawn(entityId: string, wiki: Wiki): WikiActor {
  const existing = actors.get(entityId)
  if (existing) return existing
  const actor = createActor(wikiMachine, { input: { entityId, wiki } })
  actor.start()
  actors.set(entityId, actor)
  return actor
}

function stop(entityId: string): void {
  const actor = actors.get(entityId)
  if (!actor) return
  actor.stop()
  actors.delete(entityId)
}

async function syncAll(items: SyncAllItem[], wiki: Wiki, concurrency = 2): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()
      if (!item) return
      const actor = getOrSpawn(item.entityId, wiki)
      
      // If actor is in error state, send RETRY first to recover
      if (actor.getSnapshot().matches('error')) {
        actor.send({ type: 'RETRY' })
      }
      
      await new Promise<void>((resolve) => {
        const sub = actor.subscribe((snap) => {
          if (snap.matches('idle')) {
            sub.unsubscribe()
            resolve()
          } else if (snap.matches('error')) {
            sub.unsubscribe()
            resolve()
          }
        })
        actor.send({
          type: 'SYNC',
          runRemoteSync: item.runRemoteSync,
        })
      })
    }
  })
  await Promise.all(workers)
}

export const wikiOrchestrator = { getOrSpawn, stop, syncAll }

/** For tests only — drop all spawned actors. */
export function _resetWikiOrchestratorForTests(): void {
  for (const a of actors.values()) a.stop()
  actors.clear()
}

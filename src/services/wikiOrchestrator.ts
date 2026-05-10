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

/**
 * Get or spawn an actor for the given entityId.
 * 
 * Note: Actors are cached by entityId only. If a different Wiki instance
 * is passed for the same entityId, the existing actor will continue using
 * the original wiki reference. In production, wiki is a singleton, so this
 * is not an issue. For tests, use _resetWikiOrchestratorForTests() between
 * test cases that use different wiki instances.
 */
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

async function syncAll(
  items: SyncAllItem[],
  wiki: Wiki,
  concurrency = 2,
  timeoutMs = 60000,
): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      const item = items[index]
      if (!item) return
      const actor = getOrSpawn(item.entityId, wiki)
      
      // If actor is in error state, send RETRY first to recover
      if (actor.getSnapshot().matches('error')) {
        actor.send({ type: 'RETRY' })
      }
      
      await new Promise<void>((resolve, reject) => {
        // If actor is already syncing, wait for that cycle to finish and do not
        // enqueue another SYNC that could resolve against the wrong cycle.
        const wasAlreadySyncing = actor.getSnapshot().matches('syncing')
        // If already syncing, subscribe() won't replay the current state; treat as seen so we
        // still resolve when the in-flight cycle reaches idle/error.
        let seenSyncing = wasAlreadySyncing
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        
        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId)
        }
        
        const sub = actor.subscribe((snap) => {
          if (snap.matches('syncing')) {
            seenSyncing = true
          }

          // Only resolve once we've seen syncing and then returned to idle/error.
          if (seenSyncing && (snap.matches('idle') || snap.matches('error'))) {
            sub.unsubscribe()
            cleanup()
            resolve()
          }
        })
        
        // Set timeout for this sync operation
        timeoutId = setTimeout(() => {
          sub.unsubscribe()
          reject(new Error(`Sync timeout for entity ${item.entityId} after ${timeoutMs}ms`))
        }, timeoutMs)

        if (!wasAlreadySyncing) {
          actor.send({
            type: 'SYNC',
            runRemoteSync: item.runRemoteSync,
          })
        }
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

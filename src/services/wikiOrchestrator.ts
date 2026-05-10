import { createActor, type ActorRefFrom, waitFor } from 'xstate'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
import { wikiMachine, type WikiMachineInput } from '~/machines/wikiMachine'
import type { Wiki } from '~/services/wikiService'

type WikiActor = ActorRefFrom<typeof wikiMachine>

/** Optional settings forwarded when spawning a new `wikiMachine` actor. */
export type WikiOrchestratorMachineOptions = Partial<
  Pick<WikiMachineInput, 'busyRetryDelayMs' | 'statusPollIntervalMs'>
>

const actors = new Map<string, WikiActor>()

export interface SyncAllItem {
  entityId: string
  runRemoteSync: (dump: MemoryDump) => Promise<MemoryDump | null>
}

export interface SyncAllOptions {
  /**
   * After the batch finishes, stop actors for entity IDs that were not in the
   * orchestrator map when `syncAll` started (avoids leaving status timers from
   * batch-only spawns). Pre-existing actors are never stopped.
   */
  stopActorsSpawnedForBatch?: boolean
  /** Applied only when this call creates the actor (same entityId as existing actor unchanged). */
  machineOptions?: WikiOrchestratorMachineOptions
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
function getOrSpawn(
  entityId: string,
  wiki: Wiki,
  machineOptions?: WikiOrchestratorMachineOptions,
): WikiActor {
  const existing = actors.get(entityId)
  if (existing) return existing
  const actor = createActor(wikiMachine, {
    input: { entityId, wiki, ...machineOptions },
  })
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
  options?: SyncAllOptions,
): Promise<void> {
  const entityIdsBefore = new Set(actors.keys())
  let nextIndex = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      const item = items[index]
      if (item == null) continue
      const actor = getOrSpawn(item.entityId, wiki, options?.machineOptions)

      // Drain error recovery before we subscribe for this SYNC: otherwise RETRY
      // can flush queued work that fails and hits `error` before our SYNC runs,
      // and a naive subscriber would treat that unrelated error as sync completion.
      if (actor.getSnapshot().matches('error')) {
        actor.send({ type: 'RETRY' })
        try {
          await waitFor(actor, (s) => s.matches('idle'), { timeout: timeoutMs })
        } catch {
          throw new Error(
            `Actor for entity ${item.entityId} did not return to idle after RETRY (queued work may still be failing).`,
          )
        }
      }

      await new Promise<void>((resolve, reject) => {
        // If actor is already syncing, wait for that cycle to finish and do not
        // enqueue another SYNC that could resolve against the wrong cycle.
        const wasAlreadySyncing = actor.getSnapshot().matches('syncing')
        // If already syncing, subscribe() won't replay the current state; treat as seen so we
        // still resolve when the in-flight cycle reaches idle/error.
        let seenSyncing = wasAlreadySyncing
        let settled = false
        let timeoutId: ReturnType<typeof setTimeout> | undefined

        const finish = (fn: () => void) => {
          if (settled) return
          settled = true
          fn()
        }

        const cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId)
        }

        const sub = actor.subscribe((snap) => {
          if (snap.matches('syncing')) {
            seenSyncing = true
          }

          // If we enqueued a new SYNC but the actor hits `error` before ever entering
          // `syncing` (e.g. in-flight or queued non-sync work fails first), fail fast
          // instead of waiting for the full timeout with seenSyncing still false.
          if (
            !wasAlreadySyncing &&
            !seenSyncing &&
            snap.matches('error')
          ) {
            sub.unsubscribe()
            cleanup()
            finish(() =>
              reject(
                new Error(
                  `Sync for entity ${item.entityId} did not run: actor entered error before syncing (queued work may have failed first).`,
                ),
              ),
            )
            return
          }

          // Require a syncing snapshot for this cycle so an unrelated `error` (e.g. from
          // queued work) cannot resolve the promise before our SYNC is processed.
          if (seenSyncing && snap.matches('idle')) {
            sub.unsubscribe()
            cleanup()
            finish(() => resolve())
            return
          }
          if (seenSyncing && snap.matches('error')) {
            sub.unsubscribe()
            cleanup()
            const err =
              snap.context.lastError ??
              new Error(`Sync failed for entity ${item.entityId}`)
            finish(() => reject(err))
            return
          }
        })
        
        // Set timeout for this sync operation
        timeoutId = setTimeout(() => {
          sub.unsubscribe()
          finish(() =>
            reject(new Error(`Sync timeout for entity ${item.entityId} after ${timeoutMs}ms`)),
          )
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
  try {
    await Promise.all(workers)
  } finally {
    if (options?.stopActorsSpawnedForBatch) {
      const touched = new Set(
        items.filter((i): i is SyncAllItem => i != null).map((i) => i.entityId),
      )
      for (const entityId of touched) {
        if (!entityIdsBefore.has(entityId) && actors.has(entityId)) {
          stop(entityId)
        }
      }
    }
  }
}

export const wikiOrchestrator = { getOrSpawn, stop, syncAll }

/** For tests only — drop all spawned actors. */
export function _resetWikiOrchestratorForTests(): void {
  for (const a of actors.values()) a.stop()
  actors.clear()
}

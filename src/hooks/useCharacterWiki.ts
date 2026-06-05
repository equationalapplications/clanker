import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWiki, WikiBusyError, type EntityStatus, type MemoryDump } from '@equationalapplications/expo-llm-wiki'
import type { IngestArgs, ForgetArgs } from '~/machines/wikiMachine'
import { wikiOrchestrator } from '~/services/wikiOrchestrator'
import { wikiSync } from '~/services/apiClient'
import { reportError } from '~/utilities/reportError'

type CharacterWikiOperation = 'reading' | 'writing' | 'ingesting' | 'forgetting' | 'syncing'

const DEFAULT_OPERATION_TIMEOUT_MS = 60_000

const emptyOperationTail = (): Record<CharacterWikiOperation, Promise<void>> => ({
  reading: Promise.resolve(),
  writing: Promise.resolve(),
  ingesting: Promise.resolve(),
  forgetting: Promise.resolve(),
  syncing: Promise.resolve(),
})

/** Per-entity queues so concurrent hook instances share one serialized chain per op. */
const entityOperationQueues = new Map<string, Record<CharacterWikiOperation, Promise<void>>>()

function tailForEntity(entityId: string) {
  let tail = entityOperationQueues.get(entityId)
  if (!tail) {
    tail = emptyOperationTail()
    entityOperationQueues.set(entityId, tail)
  }
  return tail
}

/** For tests only — clears cross-hook serialization state. */
export function _resetCharacterWikiEntityQueuesForTests() {
  entityOperationQueues.clear()
}

/**
 * Waits for an actor to complete a specific operation. Rejects if the operation
 * doesn't complete within the timeout.
 *
 * @param actor - Wiki machine actor
 * @param operation - Operation state to wait for
 * @param timeoutMs - Maximum time to wait before rejecting (default: 60s)
 */
function waitForActorOperation(
  actor: ReturnType<typeof wikiOrchestrator.getOrSpawn>,
  operation: CharacterWikiOperation,
  timeoutMs: number = DEFAULT_OPERATION_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let seenOperation = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const current = actor.getSnapshot()
    
    const cleanup = (sub: ReturnType<typeof actor.subscribe>) => {
      if (timeoutId) clearTimeout(timeoutId)
      sub.unsubscribe()
    }
    
    if (current.matches(operation)) {
      seenOperation = true
    } else if (current.matches('error')) {
      reject(current.context.lastError ?? new Error(`Wiki ${operation} failed`))
      return
    }
    
    let previous = current
    const sub = actor.subscribe((snap) => {
      if (snap.matches(operation)) {
        seenOperation = true
      }
      // Resolve/reject when leaving the requested operation state.
      // Do not resolve on reading→busyRetry: the same event is still in flight.
      // Do resolve on reading→idle, reading→error, or reading→another op: XState may
      // batch idle+flush so subscribers never see operation→idle when another event
      // runs immediately (Bugbot: cross-type overlap timeouts).
      if (seenOperation && previous.matches(operation) && !snap.matches(operation)) {
        if (snap.matches('busyRetry')) {
          previous = snap
          return
        }
        cleanup(sub)
        if (snap.matches('error')) {
          reject(snap.context.lastError ?? new Error(`Wiki ${operation} failed`))
        } else {
          resolve()
        }
        return
      }
      previous = snap
    })
    
    timeoutId = setTimeout(() => {
      cleanup(sub)
      reject(new Error(`Wiki ${operation} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
}

export function useCharacterWiki(entityId: string) {
  const wiki = useWiki()
  const actor = useMemo(
    () => (wiki ? wikiOrchestrator.getOrSpawn(entityId, wiki) : null),
    [entityId, wiki],
  )
  
  const [snapshot, setSnapshot] = useState(() => actor?.getSnapshot() ?? null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sync snapshot from actor on change
    setSnapshot(actor?.getSnapshot() ?? null)
    if (!actor) return
    const sub = actor.subscribe((next) => setSnapshot(next))
    return () => sub.unsubscribe()
  }, [actor])

  const runSerialized = useCallback(
    <T,>(operation: CharacterWikiOperation, run: () => Promise<T>): Promise<T> => {
      const tail = tailForEntity(entityId)
      const previous = tail[operation]
      const next = previous.then(run, run)
      tail[operation] = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
    [entityId],
  )

  const read = useCallback(async (query: string) => {
    if (!actor) return null
    return runSerialized('reading', async () => {
      actor.send({ type: 'READ', query })
      await waitForActorOperation(actor, 'reading')
      return actor.getSnapshot().context.lastReadResult
    })
  }, [actor, runSerialized])

  const write = useCallback(async (summary: string) => {
    if (!actor) return
    await runSerialized('writing', async () => {
      actor.send({ type: 'WRITE', summary })
      await waitForActorOperation(actor, 'writing')
    })
  }, [actor, runSerialized])

  const hasChanged = useCallback(async (sourceRef: string, sourceHash: string) => {
    if (!wiki || !wiki.hasChanged) return true
    return wiki.hasChanged(entityId, sourceRef, sourceHash)
  }, [entityId, wiki])

  const forget = useCallback(async (args: ForgetArgs) => {
    if (!actor) return
    await runSerialized('forgetting', async () => {
      actor.send({ type: 'FORGET', args })
      await waitForActorOperation(actor, 'forgetting')
    })
  }, [actor, runSerialized])

  const ingest = useCallback(async (doc: IngestArgs) => {
    if (!actor) {
      return { chunks: 0 }
    }
    return runSerialized('ingesting', async () => {
      actor.send({ type: 'INGEST', doc })
      await waitForActorOperation(actor, 'ingesting')
      return actor.getSnapshot().context.lastIngestResult ?? { chunks: 0 }
    })
  }, [actor, runSerialized])

  const sync = useCallback(async (cloudEntityId: string) => {
    if (!actor) {
      return { success: false, message: 'Wiki not available. Ensure WikiProvider is mounted.' }
    }
    const busyMessage = 'Memory is busy. Please try again shortly.'
    const failureMessage = 'Failed to sync memory. Check your connection and try again.'
    try {
      await runSerialized('syncing', async () => {
        actor.send({
          type: 'SYNC',
          runRemoteSync: async (localDump) => {
            const localBundle = localDump.entities[entityId] ?? { facts: [], tasks: [], events: [] }
            const cloudDump: MemoryDump = {
              generatedAt: localDump.generatedAt,
              entities: {
                [cloudEntityId]: {
                  facts: localBundle.facts.map((f) => ({ ...f, entity_id: cloudEntityId })),
                  tasks: localBundle.tasks.map((t) => ({ ...t, entity_id: cloudEntityId })),
                  events: localBundle.events.map((e) => ({ ...e, entity_id: cloudEntityId })),
                },
              },
            }
            const result = await wikiSync({ dump: cloudDump })
            const remoteDump = result.data?.remoteDump
            if (!remoteDump) {
              throw new Error('wikiSync returned without remoteDump in response data')
            }
            const remappedDump: MemoryDump = {
              generatedAt: remoteDump.generatedAt,
              entities: {
                [entityId]: remoteDump.entities[cloudEntityId] ?? { facts: [], tasks: [], events: [] },
              },
            }
            return remappedDump
          },
        })
        await waitForActorOperation(actor, 'syncing')
      })
      return { success: true, message: 'Memory synced to cloud.' }
    } catch (err: unknown) {
      const message = err instanceof WikiBusyError ? busyMessage : failureMessage
      if (message === failureMessage) {
        reportError(err, `wiki:${entityId}:sync`)
      }
      return { success: false, message }
    }
  }, [actor, entityId, runSerialized])

  return {
    status: (snapshot?.context.status as EntityStatus | undefined) ?? { ingesting: false, librarian: false, heal: false },
    isBusy: snapshot ? !snapshot.matches('idle') : false,
    isIngesting: snapshot?.matches('ingesting') ?? false,
    error: snapshot?.context.lastError ?? null,
    read,
    write,
    ingest,
    forget,
    sync,
    hasChanged,
  }
}


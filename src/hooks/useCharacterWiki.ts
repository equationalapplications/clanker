import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWiki, WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
import type { IngestArgs, ForgetArgs } from '~/machines/wikiMachine'
import { wikiOrchestrator } from '~/services/wikiOrchestrator'
import { wikiSync } from '~/services/apiClient'
import { reportError } from '~/utilities/reportError'

type WikiStatus = { ingesting: boolean; librarian: boolean; heal: boolean }

type CharacterWikiOperation = 'reading' | 'writing' | 'ingesting' | 'forgetting' | 'syncing'

function waitForActorOperation(
  actor: ReturnType<typeof wikiOrchestrator.getOrSpawn>,
  operation: CharacterWikiOperation,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let seenOperation = false
    const current = actor.getSnapshot()
    if (current.matches(operation)) {
      seenOperation = true
    } else if (current.matches('idle')) {
      resolve()
      return
    } else if (current.matches('error')) {
      reject(current.context.lastError ?? new Error(`Wiki ${operation} failed`))
      return
    }
    let previous = current
    const sub = actor.subscribe((snap) => {
      if (snap.matches(operation)) {
        seenOperation = true
      }
      // Resolve/reject only when leaving the requested operation state.
      // This avoids resolving during busyRetry -> idle intermediate steps.
      if (seenOperation && previous.matches(operation) && snap.matches('idle')) {
        sub.unsubscribe()
        resolve()
        return
      }
      if (seenOperation && previous.matches(operation) && snap.matches('error')) {
        sub.unsubscribe()
        reject(snap.context.lastError ?? new Error(`Wiki ${operation} failed`))
        return
      }
      previous = snap
    })
  })
}

export function useCharacterWiki(entityId: string) {
  const wiki = useWiki()
  const actor = useMemo(
    () => (wiki ? wikiOrchestrator.getOrSpawn(entityId, wiki) : null),
    [entityId, wiki],
  )
  const operationQueues = useRef<Record<CharacterWikiOperation, Promise<void>>>({
    reading: Promise.resolve(),
    writing: Promise.resolve(),
    ingesting: Promise.resolve(),
    forgetting: Promise.resolve(),
    syncing: Promise.resolve(),
  })
  const [snapshot, setSnapshot] = useState(() => actor?.getSnapshot() ?? null)

  useEffect(() => {
    setSnapshot(actor?.getSnapshot() ?? null)
    if (!actor) return
    const sub = actor.subscribe((next) => setSnapshot(next))
    return () => sub.unsubscribe()
  }, [actor])

  const runSerialized = useCallback(
    <T,>(operation: CharacterWikiOperation, run: () => Promise<T>): Promise<T> => {
      const previous = operationQueues.current[operation]
      const next = previous.then(run, run)
      operationQueues.current[operation] = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    },
    [],
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
        reportError(err, 'wiki:sync')
      }
      return { success: false, message }
    }
  }, [actor, entityId, runSerialized])

  return {
    status: (snapshot?.context.status as WikiStatus | undefined) ?? { ingesting: false, librarian: false, heal: false },
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


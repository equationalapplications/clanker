import { useCallback, useEffect, useMemo, useState } from 'react'
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
  const [snapshot, setSnapshot] = useState(() => actor?.getSnapshot() ?? null)

  useEffect(() => {
    setSnapshot(actor?.getSnapshot() ?? null)
    if (!actor) return
    const sub = actor.subscribe((next) => setSnapshot(next))
    return () => sub.unsubscribe()
  }, [actor])

  const read = useCallback(async (query: string) => {
    if (!actor) return null
    actor.send({ type: 'READ', query })
    await waitForActorOperation(actor, 'reading')
    return actor.getSnapshot().context.lastReadResult
  }, [actor])

  const write = useCallback(async (summary: string) => {
    if (!actor) return
    actor.send({ type: 'WRITE', summary })
    await waitForActorOperation(actor, 'writing')
  }, [actor])

  const hasChanged = useCallback(async (sourceRef: string, sourceHash: string) => {
    if (!wiki || !wiki.hasChanged) return true
    return wiki.hasChanged(entityId, sourceRef, sourceHash)
  }, [entityId, wiki])

  const forget = useCallback(async (args: ForgetArgs) => {
    if (!actor) return
    actor.send({ type: 'FORGET', args })
    await waitForActorOperation(actor, 'forgetting')
  }, [actor])

  const ingest = useCallback(async (doc: IngestArgs) => {
    if (!actor) {
      return { chunks: 0 }
    }
    actor.send({ type: 'INGEST', doc })
    await waitForActorOperation(actor, 'ingesting')
    return actor.getSnapshot().context.lastIngestResult ?? { chunks: 0 }
  }, [actor])

  const sync = useCallback(async (cloudEntityId: string) => {
    if (!actor) {
      return { success: false, message: 'Wiki not available. Ensure WikiProvider is mounted.' }
    }
    const busyMessage = 'Memory is busy. Please try again shortly.'
    const failureMessage = 'Failed to sync memory. Check your connection and try again.'
    try {
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
      return { success: true, message: 'Memory synced to cloud.' }
    } catch (err: unknown) {
      const message = err instanceof WikiBusyError ? busyMessage : failureMessage
      if (message === failureMessage) {
        reportError(err, 'wiki:sync')
      }
      return { success: false, message }
    }
  }, [actor, entityId])

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


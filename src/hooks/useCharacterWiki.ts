/**
 * Custom hooks for character wiki operations.
 * Wraps expo-llm-wiki hooks with character-specific logic and error handling.
 */

import { useState } from 'react'
import { useMemoryRead, useWikiWrite, useWikiExport, useWikiMaintenance, useWiki, WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import type { MemoryDump } from '@equationalapplications/expo-llm-wiki'
import { wikiSync } from '~/services/apiClient'

/**
 * Read memory facts/tasks/events for a character based on a query.
 * Wrapper around useMemoryRead with character ID binding.
 */
export function useCharacterMemoryRead(characterId: string, query: string) {
  return useMemoryRead(characterId, query)
}

/**
 * Write an observation event to a character's memory.
 * Wrapper around useWikiWrite that formats the event properly for observations.
 */
export function useCharacterMemoryWrite() {
  const wikiWrite = useWikiWrite()

  return {
    write: async (characterId: string, summary: string) => {
      return wikiWrite.execute(characterId, {
        event_type: 'observation',
        summary,
      })
    },
    isPending: wikiWrite.isPending,
    error: wikiWrite.error,
    lastResult: wikiWrite.lastResult,
  }
}

/**
 * Sync a character's memory to cloud and back.
 * Combines export → wikiSync → import → prune with proper error handling.
 */
export function useCharacterWikiSync() {
  const wiki = useWiki()
  const exportWiki = useWikiExport()
  const maintenance = useWikiMaintenance()
  const [isSyncing, setIsSyncing] = useState(false)

  const sync = async (
    characterId: string,
    cloudCharacterId: string,
  ): Promise<{ success: boolean; message: string }> => {
    setIsSyncing(true)
    try {
      if (!wiki) {
        return { success: false, message: 'Wiki not available. Ensure WikiProvider is mounted.' }
      }

      // 1. Export local wiki dump
      const localDump = await exportWiki.execute([characterId])

      // 2. Remap to cloud entity ID and sync to cloud
      const cloudDump: MemoryDump = {
        generatedAt: localDump.generatedAt,
        entities: {
          [cloudCharacterId]: localDump.entities[characterId] ?? { facts: [], tasks: [], events: [] },
        },
      }

      const result = await wikiSync({ dump: cloudDump })
      const remoteDump = result.data.remoteDump

      if (!remoteDump) {
        return { success: false, message: 'No remote dump returned from cloud sync.' }
      }

      // 3. Remap remote dump back to local entity ID and import
      const remappedDump: MemoryDump = {
        generatedAt: remoteDump.generatedAt,
        entities: {
          [characterId]: remoteDump.entities[cloudCharacterId] ?? { facts: [], tasks: [], events: [] },
        },
      }

      // Import (handle WikiBusyError gracefully)
      let importSucceeded = false
      try {
        await wiki.importDump(remappedDump, { merge: true })
        importSucceeded = true
      } catch (importErr) {
        if (!(importErr instanceof WikiBusyError)) {
          throw importErr
        }
        // WikiBusyError: cloud sync succeeded but local merge deferred
        console.warn('[wiki] import deferred due to busy state; will merge on next sync')
      }

      // 4. Prune only after a successful import (skip when import was deferred)
      if (importSucceeded) {
        try {
          await maintenance.runPrune(characterId, {
            retainSoftDeletedFor: 7,
            retainEventsFor: 30,
            vacuum: false,
          })
        } catch (pruneErr) {
          if (!(pruneErr instanceof WikiBusyError)) {
            console.warn('[wiki] prune failed after sync:', pruneErr)
          }
          // WikiBusyError: defer to next sync cycle
        }
      }

      return { success: true, message: 'Memory synced to cloud.' }
    } catch (error) {
      console.error('[wiki] sync failed:', error)
      const message = error instanceof WikiBusyError
        ? 'Memory is busy. Please try again shortly.'
        : 'Failed to sync memory. Check your connection and try again.'
      return { success: false, message }
    } finally {
      setIsSyncing(false)
    }
  }

  return {
    sync,
    isPending: isSyncing || exportWiki.isPending || maintenance.isPending,
    error: exportWiki.error || maintenance.error,
  }
}

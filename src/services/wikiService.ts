// src/services/wikiService.ts
import { createWiki } from '@equationalapplications/expo-llm-wiki'
import type { SQLiteDatabase } from 'expo-sqlite'
import { createWikiLlmProvider } from './wikiLlmProvider'

type Wiki = ReturnType<typeof createWiki>

export const TABLE_PREFIX = 'llm_wiki_'
let _wiki: Wiki | null = null

export function setupWiki(db: SQLiteDatabase): Wiki {
  if (_wiki) return _wiki
  _wiki = createWiki(db, {
    llmProvider: createWikiLlmProvider(),
    config: {
      tablePrefix: TABLE_PREFIX,
      autoLibrarianThreshold: 5, // entries: trigger auto-librarian
      autoHealThreshold: 100, // entries: trigger auto-heal
      pruneRetainSoftDeletedFor: 3, // days: keep soft-deleted entries
      pruneEventsAfter: 14, // days: delete old events
      orphanAfterDays: 14, // days: mark unlinked entities as orphan
      staleInferredAfterDays: 30, // days: mark old librarian entries as stale
      preFilterLimit: 300, // FTS pre-filter limit for retrieval
      hybridWeight: 0.7, // hybrid search weight (0=FTS, 1=vector)
    },
  })
  return _wiki
}

export function getWiki(): Wiki | null {
  return _wiki
}

export async function initWiki(db: SQLiteDatabase): Promise<void> {
  // v3→v4 migration: Update source_type enum values before setup()
  // expo-llm-wiki@4.0.0 renamed enum values but does NOT auto-migrate.
  // This idempotent migration runs the documented manual SQL per v4.0.0 release notes.

  // Read-only checks outside transaction to minimize lock time
  const tableExists = await db.getFirstAsync<{ exists: number }>(
    `SELECT 1 as exists FROM sqlite_master WHERE type='table' AND name=?`,
    [`${TABLE_PREFIX}entries`],
  )
  if (tableExists?.exists === 1) {
    const hasOldEnums = await db.getFirstAsync(
      `SELECT 1 FROM ${TABLE_PREFIX}entries WHERE source_type IN ('user_document', 'agent_inferred') LIMIT 1`,
    )
    if (hasOldEnums) {
      // Only wrap UPDATE statements in transaction when migration needed
      await db.withTransactionAsync(async () => {
        await db.execAsync(
          `UPDATE ${TABLE_PREFIX}entries SET source_type = 'immutable_document' WHERE source_type = 'user_document'`,
        )
        await db.execAsync(
          `UPDATE ${TABLE_PREFIX}entries SET source_type = 'librarian_inferred' WHERE source_type = 'agent_inferred'`,
        )
      })
    }
  }

  const wiki = setupWiki(db)
  await wiki.setup()
}

/** For tests only — reset the singleton between test runs. */
export function _resetWikiForTests(): void {
  _wiki = null
}

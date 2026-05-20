// src/services/wikiService.ts
import { createWiki } from '@equationalapplications/expo-llm-wiki'
import type { EntityStatus } from '@equationalapplications/expo-llm-wiki'
import type { SQLiteDatabase } from 'expo-sqlite'
import { createWikiLlmProvider } from './wikiLlmProvider'

// Base Wiki type from the package
type BaseWiki = ReturnType<typeof createWiki>

// Extended Wiki type with future methods (for forward compatibility)
export type Wiki = BaseWiki & {
  subscribeEntityStatus: (
    entityId: string,
    callback: (status: EntityStatus) => void,
  ) => () => void
}

export const TABLE_PREFIX = 'llm_wiki_'
const DEFAULT_WIKI_PREFILTER_LIMIT = 300
const wikiNoResultQueries = new Map<string, Set<string>>()
let _wiki: Wiki | null = null

function getWikiNoResultCache(entityId: string): Set<string> {
  let cache = wikiNoResultQueries.get(entityId)
  if (!cache) {
    cache = new Set<string>()
    wikiNoResultQueries.set(entityId, cache)
  }
  return cache
}

export async function readFromWiki(
  wiki: Wiki,
  entityId: string,
  query: string,
): Promise<Awaited<ReturnType<Wiki['read']>>> {
  const queryKey = `${entityId}:${query}`
  const noResultCache = getWikiNoResultCache(entityId)
  const result = await wiki.read(entityId, query)

  if (query.trim().length === 0 || result.facts.length > 0 || noResultCache.has(queryKey)) {
    return result
  }

  const fullScanResult = await wiki.read(entityId, query, {
    preFilterLimit: null,
  })

  if (fullScanResult.facts.length === 0) {
    noResultCache.add(queryKey)
  }

  return fullScanResult
}

const WIKI_METADATA_TABLE = `"${TABLE_PREFIX}meta"`
const WIKI_EMBEDDING_MIGRATION_KEY = 'wiki_embedding_tasktype_migration_v1'

async function ensureWikiEmbeddingMigration(
  db: SQLiteDatabase,
  wiki: Wiki,
): Promise<void> {
  const dbExecAsync =
    typeof db.execAsync === 'function' ? db.execAsync.bind(db) : undefined
  const dbRunAsync =
    typeof db.runAsync === 'function' ? db.runAsync.bind(db) : undefined

  if (!dbExecAsync || !dbRunAsync) {
    return
  }

  await dbExecAsync(
    `CREATE TABLE IF NOT EXISTS ${WIKI_METADATA_TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  )

  const existing = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM ${WIKI_METADATA_TABLE} WHERE key = ?`,
    [WIKI_EMBEDDING_MIGRATION_KEY],
  )
  if (existing?.value === '1') {
    return
  }

  const runReembed = (wiki as { runReembed?: (entityId?: string, opts?: { force?: boolean; skipExisting?: boolean }) => Promise<{ embedded: number; skipped: number; failed: number }> }).runReembed
  if (typeof runReembed !== 'function') {
    return
  }

  const migrationResult = await runReembed.call(wiki, undefined, { force: true })
  if (migrationResult?.failed > 0) {
    console.warn('[Wiki] Embedding migration completed with failures:', migrationResult)
    return
  }

  await dbRunAsync(
    `INSERT OR REPLACE INTO ${WIKI_METADATA_TABLE} (key, value) VALUES (?, ?)`,
    [WIKI_EMBEDDING_MIGRATION_KEY, '1'],
  )
}

export function getSourceTypeEnumMigrationSql(): string[] {
  const entriesTable = `"${TABLE_PREFIX}entries"`
  return [
    `UPDATE ${entriesTable} SET source_type = 'immutable_document' WHERE source_type = 'user_document'`,
    `UPDATE ${entriesTable} SET source_type = 'librarian_inferred' WHERE source_type = 'agent_inferred'`,
  ]
}

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
      preFilterLimit: DEFAULT_WIKI_PREFILTER_LIMIT, // limit search candidates for speed
      hybridWeight: 1, // prefer vector scoring while still prefiltering candidates for speed
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
  const tableExists = await db.getFirstAsync<{ has_table: number }>(
    `SELECT 1 as has_table FROM sqlite_master WHERE type='table' AND name=?`,
    [`${TABLE_PREFIX}entries`],
  )
  if (tableExists?.has_table === 1) {
    const hasOldEnums = await db.getFirstAsync<{ has_old_enums: number }>(
      `SELECT 1 AS has_old_enums FROM "${TABLE_PREFIX}entries" WHERE source_type IN ('user_document', 'agent_inferred') LIMIT 1`,
    )
    if (hasOldEnums?.has_old_enums === 1) {
      // Only wrap UPDATE statements in transaction when migration needed
      await db.withTransactionAsync(async () => {
        for (const statement of getSourceTypeEnumMigrationSql()) {
          await db.execAsync(statement)
        }
      })
    }
  }

  const wiki = setupWiki(db)
  await wiki.setup()
  if (tableExists?.has_table === 1) {
    void ensureWikiEmbeddingMigration(db, wiki).catch((error) => {
      console.error('[Wiki] Background embedding migration failed:', error)
    })
  }
}

/** For tests only — reset the singleton between test runs. */
export function _resetWikiForTests(): void {
  _wiki = null
}

/**
 * Migration audit: v3 schema seeded into SQLite, then wiki@4.1.0 setup() runs.
 * Asserts setup() does not throw and pre-existing rows are preserved.
 *
 * This test guards the v3 → v4 upgrade per spec § Risks.
 *
 * Note: v4.0.0 introduced a BREAKING CHANGE requiring manual SQL migration for
 * source_type enum values (user_document→immutable_document, agent_inferred→librarian_inferred).
 * Since the library doesn't auto-migrate these enums, this test verifies the manual
 * migration path works by: 1) seeding minimal v3 schema (entities, entries, facts tables),
 * 2) inserting rows with v3 enum values, 3) running the manual migration SQL to update
 * enum values, 4) running setup() to upgrade to v4 schema, 5) verifying the migrated rows
 * are preserved with correct v4 enum values.
 */

// Mock expo-sqlite to use better-sqlite3 for testing
jest.mock('expo-sqlite', () => {
  const { createExpoSqliteBetterSqlite3Mock } = require('./helpers/expoSqliteBetterSqlite3Mock')
  return createExpoSqliteBetterSqlite3Mock()
})

jest.mock('~/services/wikiLlmProvider', () => ({
  createWikiLlmProvider: () => ({ generateText: jest.fn() }),
}))

describe('wiki v3 → v4 migration audit', () => {
  let db: any

  beforeEach(() => {
    const { openDatabaseSync } = require('expo-sqlite')
    db = openDatabaseSync(':memory:')
  })

  afterEach(() => {
    db.closeSync()
  })

  it('v3 DB upgrades to v4 after manual enum migration', async () => {
    // 1. Seed minimal v3 schema
    // NOTE: This is a minimal v3-compatible schema focused on testing the documented
    // v4.0.0 breaking change (source_type enum migration). It includes the core tables
    // (entities, entries, facts) and columns needed to validate that:
    // - The manual enum migration SQL works
    // - wiki.setup() runs without error against a v3-shaped DB
    // - Pre-existing rows are preserved
    // A full v3 schema export would be more robust but is beyond the scope of this
    // migration audit, which focuses on the specific enum migration path documented
    // in the v4.0.0 release notes.
    db.execSync(`
      CREATE TABLE llm_wiki_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE llm_wiki_entries (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        source_hash TEXT,
        tags TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        FOREIGN KEY (entity_id) REFERENCES llm_wiki_entities(id)
      );
      CREATE TABLE llm_wiki_facts (
        id TEXT PRIMARY KEY,
        entity_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (entity_id) REFERENCES llm_wiki_entities(id)
      );
    `)

    // 2. Insert test data with v3 enum values
    const now = Date.now()
    db.runSync(
      `INSERT INTO llm_wiki_entities (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
      ['ent-1', 'Test Entity', now, now],
    )
    db.runSync(
      `INSERT INTO llm_wiki_entries (id, entity_id, title, body, source_type, source_ref, source_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['entry-1', 'ent-1', 'User Doc Entry', 'Body 1', 'user_document', 'doc-123', '', now, now],
    )
    db.runSync(
      `INSERT INTO llm_wiki_entries (id, entity_id, title, body, source_type, source_ref, source_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['entry-2', 'ent-1', 'Agent Entry', 'Body 2', 'agent_inferred', null, '', now, now],
    )

    // 3. Run manual migration SQL per v4.0.0 breaking change notes
    db.execSync(`UPDATE llm_wiki_entries SET source_type = 'immutable_document' WHERE source_type = 'user_document'`)
    db.execSync(`UPDATE llm_wiki_entries SET source_type = 'librarian_inferred' WHERE source_type = 'agent_inferred'`)

    // 4. Run wiki.setup() to upgrade schema to v4
    const { createWiki } = require('@equationalapplications/expo-llm-wiki')
    const wiki = createWiki(db, {
      llmProvider: { generateText: jest.fn() } as any,
      config: { tablePrefix: 'llm_wiki_' },
    })
    await wiki.setup()

    // 5. Verify rows preserved with correct v4 enum values
    const rows = db.getAllSync(
      `SELECT id, source_type FROM llm_wiki_entries WHERE id IN (?, ?) ORDER BY id`,
      ['entry-1', 'entry-2'],
    )
    expect(rows).toEqual([
      { id: 'entry-1', source_type: 'immutable_document' },
      { id: 'entry-2', source_type: 'librarian_inferred' },
    ])

    // Verify entity also preserved
    const entity = db.getFirstSync(`SELECT id, name FROM llm_wiki_entities WHERE id = ?`, ['ent-1'])
    expect(entity).toEqual({ id: 'ent-1', name: 'Test Entity' })
  })
})

/**
 * Two-phase local apply for proactive messages (Task 10 of Phase 2).
 *
 * Exercises applyProactiveMessages and countUnreadProactive against a real
 * SQLite engine (better-sqlite3) so the IGNORE-vs-REPLACE behaviour and the
 * json_extract(message_data, '$.proactive') predicate are guaranteed by the
 * database, not by a mock that can't fail the same way.
 */

import { createExpoSqliteBetterSqlite3Mock } from '../../../__tests__/helpers/expoSqliteBetterSqlite3Mock'
import { UNREAD_STALENESS_ESCAPE_MS } from '../../constants/proactive'
import { applyProactiveMessages, countUnreadProactive, type LocalMessage } from '../messageDatabase'
import { CREATE_TABLES } from '../schema'

type BetterSqliteDb = ReturnType<
  ReturnType<typeof createExpoSqliteBetterSqlite3Mock>['openDatabaseSync']
>

let mockDbOverride: BetterSqliteDb | null = null

const mockDb = {
  runAsync: jest.fn(),
  getFirstAsync: jest.fn(),
}

jest.mock('../index', () => ({
  getDatabase: jest.fn(async () => mockDbOverride ?? mockDb),
}))

interface ProactiveMessagePayload {
  messageId: string
  characterId: string
  text: string
  createdAt: string
  readAt: string | null
}

function payload(overrides: Partial<ProactiveMessagePayload> = {}): ProactiveMessagePayload {
  return {
    messageId: 'm1',
    characterId: 'char-1',
    text: 'hello',
    createdAt: '2026-09-08T12:00:00.000Z',
    readAt: null,
    ...overrides,
  }
}

// Mirrors the column list on the `messages` table after migrations 18 (synced_at)
// and 25 (read_at). Defaults match a proactively-synced row so the count test's
// json_extract predicate matches; per-test overrides can still swap message_data
// or any other column.
function insertLocal(overrides: Partial<LocalMessage> = {}): Promise<void> {
  const row: LocalMessage = {
    id: 'default-id',
    character_id: 'char-1',
    sender_user_id: 'char-1',
    recipient_user_id: 'char-1',
    text: '',
    created_at: Date.now(),
    message_data: JSON.stringify({ proactive: true }),
    pending: 0,
    sent: 1,
    error: 0,
    edited: 0,
    synced_at: null,
    read_at: null,
    ...overrides,
  }
  // `mockDbOverride!` is safe inside any `it`/`beforeEach`/`afterEach` —
  // beforeAll has already replaced the null sentinel with a real handle.
  void mockDbOverride!.runAsync(
    `INSERT INTO messages
     (id, character_id, sender_user_id, recipient_user_id, text, created_at, message_data, pending, sent, error, edited, synced_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.character_id,
      row.sender_user_id,
      row.recipient_user_id,
      row.text,
      row.created_at,
      row.message_data,
      row.pending,
      row.sent,
      row.error,
      row.edited,
      row.synced_at,
      row.read_at,
    ],
  )
  return Promise.resolve()
}

function getLocal(id: string): Promise<LocalMessage | null> {
  return mockDbOverride!.getFirstAsync<LocalMessage>('SELECT * FROM messages WHERE id = ?', [id])
}

beforeAll(() => {
  mockDbOverride = createExpoSqliteBetterSqlite3Mock().openDatabaseSync(':memory:')
  mockDbOverride.execSync(CREATE_TABLES)
})

afterAll(() => {
  mockDbOverride!.closeSync()
})

beforeEach(() => {
  mockDbOverride!.execSync('DELETE FROM messages;')
  jest.clearAllMocks()
})

describe('applyProactiveMessages', () => {
  it('does not clobber an existing local row', async () => {
    await insertLocal({ id: 'm1', text: 'local text', pending: 1 })
    await applyProactiveMessages([payload({ messageId: 'm1', text: 'server text' })])

    const row = await getLocal('m1')
    // INSERT OR IGNORE, not OR REPLACE: OR REPLACE would silently reset
    // pending/sent/error on every re-sync.
    expect(row?.text).toBe('local text')
    expect(row?.pending).toBe(1)
  })

  it('applies read_at to a row it already has', async () => {
    await insertLocal({ id: 'm1', read_at: null })
    await applyProactiveMessages([payload({ messageId: 'm1', readAt: '2026-09-08T12:00:00.000Z' })])

    expect((await getLocal('m1'))?.read_at).toBe(Date.parse('2026-09-08T12:00:00.000Z'))
  })

  it('never clears a read_at that is already set', async () => {
    await insertLocal({ id: 'm1', read_at: 1_700_000_000_000 })
    await applyProactiveMessages([payload({ messageId: 'm1', readAt: null })])

    // The update is one-directional (AND read_at IS NULL) so an out-of-order
    // page cannot resurrect a cleared badge.
    expect((await getLocal('m1'))?.read_at).toBe(1_700_000_000_000)
  })

  it('inserts a row it does not have', async () => {
    await applyProactiveMessages([payload({ messageId: 'new', text: 'hello' })])
    expect((await getLocal('new'))?.text).toBe('hello')
  })
})

describe('countUnreadProactive', () => {
  it('ignores messages past the staleness escape', async () => {
    const now = Date.parse('2026-09-08T00:00:00.000Z')
    await insertLocal({
      id: 'old',
      read_at: null,
      created_at: now - UNREAD_STALENESS_ESCAPE_MS - 1,
    })
    await insertLocal({ id: 'new', read_at: null, created_at: now - 1000 })

    expect(await countUnreadProactive('char-1', now)).toBe(1)
  })
})

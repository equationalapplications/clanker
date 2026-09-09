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
import {
  applyProactiveMessages,
  countUnreadProactive,
  markProactiveReadLocally,
  type LocalMessage,
} from '../messageDatabase'
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

const USER_ID = 'user-1'

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
    await applyProactiveMessages([payload({ messageId: 'm1', text: 'server text' })], USER_ID)

    const row = await getLocal('m1')
    // INSERT OR IGNORE, not OR REPLACE: OR REPLACE would silently reset
    // pending/sent/error on every re-sync.
    expect(row?.text).toBe('local text')
    expect(row?.pending).toBe(1)
  })

  it('applies read_at to a row it already has', async () => {
    await insertLocal({ id: 'm1', read_at: null })
    await applyProactiveMessages(
      [payload({ messageId: 'm1', readAt: '2026-09-08T12:00:00.000Z' })],
      USER_ID,
    )

    expect((await getLocal('m1'))?.read_at).toBe(Date.parse('2026-09-08T12:00:00.000Z'))
  })

  it('never clears a read_at that is already set', async () => {
    await insertLocal({ id: 'm1', read_at: 1_700_000_000_000 })
    await applyProactiveMessages([payload({ messageId: 'm1', readAt: null })], USER_ID)

    // The update is one-directional (AND read_at IS NULL) so an out-of-order
    // page cannot resurrect a cleared badge.
    expect((await getLocal('m1'))?.read_at).toBe(1_700_000_000_000)
  })

  it('inserts a row it does not have', async () => {
    await applyProactiveMessages([payload({ messageId: 'new', text: 'hello' })], USER_ID)
    expect((await getLocal('new'))?.text).toBe('hello')
  })

  // The row existing is not the same as the row being reachable. Every read
  // path filters `(sender_user_id = ? OR recipient_user_id = ?)` against the
  // user, so writing the character into both columns hides the message from the
  // chat while countUnreadProactive — which filters on character_id alone —
  // still badges it: the dot lights and the thread opens empty.
  it('writes columns the user-scoped read path can actually match', async () => {
    await applyProactiveMessages([payload({ messageId: 'visible' })], USER_ID)

    const row = await getLocal('visible')
    expect(row?.recipient_user_id).toBe(USER_ID)
    // Sender stays the character: toGiftedChatMessage decides authorship with
    // `sender_user_id === currentUserId`, so naming the user here would render
    // the character's own message as the user's.
    expect(row?.sender_user_id).toBe('char-1')

    const visible = await mockDbOverride!.getFirstAsync<LocalMessage>(
      `SELECT * FROM messages
        WHERE character_id = ? AND (sender_user_id = ? OR recipient_user_id = ?)`,
      ['char-1', USER_ID, USER_ID],
    )
    expect(visible?.id).toBe('visible')
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

describe('markProactiveReadLocally', () => {
  it("writes read_at for ALL of the character's unread proactive rows and returns their ids", async () => {
    await insertLocal({ id: 'p1', character_id: 'c1' })
    await insertLocal({ id: 'p2', character_id: 'c1' })
    await insertLocal({
      id: 'regular',
      character_id: 'c1',
      message_data: JSON.stringify({ proactive: false }),
    }) // not proactive
    await insertLocal({ id: 'p3', character_id: 'c2' }) // other character
    const ids = await markProactiveReadLocally('c1')
    expect(ids.sort()).toEqual(['p1', 'p2'])
    const row = await getLocal('p1')
    expect(row?.read_at).not.toBeNull()
  })

  it('is a no-op when there is nothing unread (second open)', async () => {
    await insertLocal({ id: 'p1', character_id: 'c1' })
    await markProactiveReadLocally('c1')
    const ids = await markProactiveReadLocally('c1')
    expect(ids).toEqual([])
  })

  it('leaves already-read rows out of the returned ids', async () => {
    await insertLocal({ id: 'p1', character_id: 'c1' })
    await markProactiveReadLocally('c1')
    await markProactiveReadLocally('c1') // both calls
    expect(await countUnreadProactive('c1', Date.now())).toBe(0)
  })
})

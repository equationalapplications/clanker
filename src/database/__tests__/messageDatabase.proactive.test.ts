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
  mockDbOverride!.execSync('DELETE FROM messages; DELETE FROM characters;')
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

  // SQLite's SQLITE_MAX_VARIABLE_NUMBER is 999 by default; an UPDATE with
  // that many IN-placeholders is rejected during prepare, before any row
  // changes. Seed 250 rows (forces 3 batches at the 100-batch ceiling) and
  // verify the whole backlog still gets read_at — and that the row is updated
  // in multiple transaction-internal UPDATE calls, not one oversize one.
  it("batches the ID-based UPDATE so a backlog above SQLite's host-parameter ceiling still marks locally", async () => {
    const TOTAL = 250
    for (let i = 0; i < TOTAL; i++) {
      await insertLocal({ id: `big-${i}`, character_id: 'c-bulk' })
    }
    const runSpy = jest.spyOn(mockDbOverride!, 'runAsync')
    const ids = await markProactiveReadLocally('c-bulk')
    expect(ids.length).toBe(TOTAL)
    // Batched updates: 100 + 100 + 50 = 3 UPDATE calls (not the single oversize
    // call that would fail prepare on real devices with large backlogs).
    const updateCalls = runSpy.mock.calls.filter(([sql]) =>
      String(sql).trimStart().toUpperCase().startsWith('UPDATE'),
    )
    expect(updateCalls.length).toBe(3)
    runSpy.mockRestore()
    // Spot-check that the very last row (must be in the partial batch) is marked.
    const last = await getLocal(`big-${TOTAL - 1}`)
    expect(last?.read_at).not.toBeNull()
  })
})

/**
 * Regression: proactive rows arrive keyed by the SERVER's character UUID, but
 * every local read path (countUnreadProactive, markProactiveReadLocally, the
 * chat thread query) filters on the LOCAL `characters.id`. Those diverge for
 * every locally-created-then-uploaded character (`char_<uuid>` local id, server
 * UUID in `cloud_id`) and for every imported/shared character — they coincide
 * only on a device that materialised the row via restoreFromCloud. Without the
 * cloud->local resolve the rows are orphans no badge or thread ever sees, and
 * `messages.character_id` has no FK so nothing rejects the bad insert.
 */
function insertCharacter(id: string, cloudId: string | null): void {
  mockDbOverride!.runSync(
    `INSERT INTO characters (id, user_id, name, created_at, updated_at, cloud_id, owner_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, USER_ID, 'C', 1, 1, cloudId, USER_ID],
  )
}

describe('applyProactiveMessages cloud->local character mapping', () => {
  it('stores the row under the LOCAL character id when it diverges from cloud_id', async () => {
    insertCharacter('char_local1', 'cloud-uuid-1')

    await applyProactiveMessages(
      [payload({ messageId: 'p1', characterId: 'cloud-uuid-1' })],
      USER_ID,
    )

    const row = await getLocal('p1')
    expect(row?.character_id).toBe('char_local1')
    // The badge queries by local id; this is the deliverable that was broken.
    await expect(countUnreadProactive('char_local1', Date.now())).resolves.toBe(1)
  })

  it('keys sender_user_id to the local id too, so authorship still resolves', async () => {
    insertCharacter('char_local2', 'cloud-uuid-2')

    await applyProactiveMessages(
      [payload({ messageId: 'p2', characterId: 'cloud-uuid-2' })],
      USER_ID,
    )

    const row = await getLocal('p2')
    expect(row?.sender_user_id).toBe('char_local2')
  })

  it('falls back to the server id when no local character row exists yet', async () => {
    // Character has not synced down. Dropping the message would lose it, so the
    // insert keeps the server id and the row becomes reachable once the
    // character lands locally under that same id (restoreFromCloud path).
    await applyProactiveMessages(
      [payload({ messageId: 'p3', characterId: 'cloud-orphan' })],
      USER_ID,
    )

    const row = await getLocal('p3')
    expect(row?.character_id).toBe('cloud-orphan')
  })

  it('resolves each message independently within one batch', async () => {
    insertCharacter('char_localA', 'cloud-A')
    insertCharacter('char_localB', 'cloud-B')

    await applyProactiveMessages(
      [
        payload({ messageId: 'pa', characterId: 'cloud-A' }),
        payload({ messageId: 'pb', characterId: 'cloud-B' }),
      ],
      USER_ID,
    )

    expect((await getLocal('pa'))?.character_id).toBe('char_localA')
    expect((await getLocal('pb'))?.character_id).toBe('char_localB')
  })
})

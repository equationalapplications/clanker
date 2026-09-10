/**
 * Proactive-message sync orchestrator (Task 10 of Phase 2).
 *
 * The orchestrator shipped without coverage. Its correctness rests on three
 * invariants that are easy to break in a refactor and silent when broken —
 * a dropped message just never appears, and a skipped cursor never recovers:
 *
 *   1. The cursor advances in the SAME transaction as the inserts.
 *   2. A final page (nextCursor === null) still advances the cursor, to the
 *      last applied message, so the next sync does not re-fetch it.
 *   3. The loop terminates: on a 0-row page, and at MAX_PAGES, even when the
 *      server keeps handing back a non-null nextCursor.
 *
 * The Firebase callable and the SQLite handle are substituted so the loop is
 * testable without a database or a network.
 */

import { PROACTIVE_SYNC_CURSOR_KEY } from '~/constants/proactive'
import { syncProactiveMessages } from '../proactiveSync'

const mockCallable = jest.fn()
// Returns the LOCAL character ids it wrote under, mirroring the real
// implementation. The default stands in for the no-divergence case (local id
// == cloud id), so the identity mapping keeps the existing touched-id
// assertions meaningful; a test can override it to simulate divergence.
const mockApplyProactiveMessages = jest.fn(async (payload: { characterId: string }[] = []) =>
  Array.from(new Set(payload.map((m) => m.characterId))),
)
const mockSetSyncCursor = jest.fn(async () => {})
let mockStoredCursor: { createdAt: string; messageId: string } | null = null

// Records the order of applies and cursor writes relative to transaction
// boundaries, which is what invariant 1 is actually about.
const mockTrace: string[] = []

jest.mock('@react-native-firebase/app', () => ({ getApp: () => ({}) }))
jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable:
    () =>
    (...args: unknown[]) =>
      mockCallable(...args),
}))
jest.mock('~/database/messageDatabase', () => ({
  applyProactiveMessages: (...args: unknown[]) => {
    mockTrace.push('apply')
    return mockApplyProactiveMessages(...(args as []))
  },
}))
jest.mock('~/database/syncState', () => ({
  getSyncCursor: jest.fn(async () => mockStoredCursor),
  setSyncCursor: (...args: unknown[]) => {
    mockTrace.push('cursor')
    return mockSetSyncCursor(...(args as []))
  },
}))
jest.mock('~/database', () => ({
  getDatabase: async () => ({
    withTransactionAsync: async (fn: () => Promise<void>) => {
      mockTrace.push('tx:begin')
      await fn()
      mockTrace.push('tx:commit')
    },
  }),
}))

const msg = (id: string, createdAt = '2026-09-08T12:00:00.000Z', characterId = 'c1') => ({
  messageId: id,
  characterId,
  text: 'hi',
  createdAt,
  readAt: null,
})

beforeEach(() => {
  jest.clearAllMocks()
  mockTrace.length = 0
  mockStoredCursor = null
})

describe('proactive sync orchestrator', () => {
  it('reports the characters it wrote rows for, deduplicated across pages', async () => {
    // The caller invalidates exactly these thread caches, so an over-broad or
    // missing id is the difference between a stale thread and a refetch of
    // every conversation the user has open.
    const cursor = { createdAt: '2026-09-08T12:00:00.000Z', messageId: 'm1' }
    mockCallable
      .mockResolvedValueOnce({
        data: {
          messages: [
            msg('m1', '2026-09-08T12:00:00.000Z', 'c1'),
            msg('m2', '2026-09-08T12:00:01.000Z', 'c2'),
          ],
          nextCursor: cursor,
        },
      })
      .mockResolvedValueOnce({
        data: { messages: [msg('m3', '2026-09-08T12:00:02.000Z', 'c1')], nextCursor: null },
      })

    const touched = await syncProactiveMessages('uid-1')

    expect(touched.slice().sort()).toEqual(['c1', 'c2'])
  })

  it('reports no characters when the server has nothing new', async () => {
    mockCallable.mockResolvedValueOnce({ data: { messages: [], nextCursor: null } })

    await expect(syncProactiveMessages('uid-1')).resolves.toEqual([])
  })

  it('applies the page and advances the cursor inside one transaction', async () => {
    // A crash between the inserts and the cursor write would either skip
    // messages (cursor ahead) or re-deliver them forever (cursor behind). Both
    // must be impossible, so both writes belong to the same transaction.
    mockCallable.mockResolvedValueOnce({
      data: { messages: [msg('m1')], nextCursor: null },
    })

    await syncProactiveMessages('user-1')

    expect(mockTrace).toEqual(['tx:begin', 'apply', 'cursor', 'tx:commit'])
  })

  it('advances the cursor to the last message on a final page', async () => {
    // The server omits nextCursor on the last page. Leaving the cursor where it
    // was would re-fetch that page on every subsequent sync, forever.
    mockCallable.mockResolvedValueOnce({
      data: {
        messages: [msg('m1'), msg('m2', '2026-09-08T12:00:05.000Z')],
        nextCursor: null,
      },
    })

    await syncProactiveMessages('user-1')

    expect(mockSetSyncCursor).toHaveBeenCalledTimes(1)
    expect(mockSetSyncCursor).toHaveBeenCalledWith(
      PROACTIVE_SYNC_CURSOR_KEY,
      { createdAt: '2026-09-08T12:00:05.000Z', messageId: 'm2' },
      expect.anything(),
    )
  })

  it('follows nextCursor across pages and sends it back on the next call', async () => {
    const cursor = { createdAt: '2026-09-08T12:00:00.000Z', messageId: 'm1' }
    mockCallable
      .mockResolvedValueOnce({ data: { messages: [msg('m1')], nextCursor: cursor } })
      .mockResolvedValueOnce({ data: { messages: [msg('m2')], nextCursor: null } })

    await syncProactiveMessages('user-1')

    expect(mockCallable).toHaveBeenCalledTimes(2)
    expect(mockCallable).toHaveBeenNthCalledWith(1, {
      sinceCreatedAt: undefined,
      sinceMessageId: undefined,
    })
    expect(mockCallable).toHaveBeenNthCalledWith(2, {
      sinceCreatedAt: cursor.createdAt,
      sinceMessageId: cursor.messageId,
    })
  })

  it('stops on an empty page and does not apply anything', async () => {
    mockCallable.mockResolvedValueOnce({
      data: {
        messages: [],
        nextCursor: { createdAt: '2026-09-08T12:00:00.000Z', messageId: 'm9' },
      },
    })

    await syncProactiveMessages('user-1')

    expect(mockCallable).toHaveBeenCalledTimes(1)
    expect(mockApplyProactiveMessages).not.toHaveBeenCalled()
    // The empty window is still consumed, so the next sync starts past it.
    expect(mockSetSyncCursor).toHaveBeenCalledTimes(1)
  })

  it('terminates at MAX_PAGES when the server never stops paging', async () => {
    // A server that always returns rows AND a non-null nextCursor would spin
    // this loop forever without the cap, draining battery and quota on device.
    mockCallable.mockResolvedValue({
      data: {
        messages: [msg('m1')],
        nextCursor: { createdAt: '2026-09-08T12:00:00.000Z', messageId: 'm1' },
      },
    })

    await syncProactiveMessages('user-1')

    expect(mockCallable).toHaveBeenCalledTimes(50)
  })
})

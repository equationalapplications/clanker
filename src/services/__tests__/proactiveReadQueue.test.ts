/**
 * Durable mark-read queue (Task 11 of Phase 2).
 *
 * The brief's RED/GREEN tests verify that a network failure doesn't drop the
 * read receipt — the server would then believe the user is ignoring the
 * character and suppress every future push from it. The implementation
 * persists ids in the `sync_state` table (Task 9 storage) so the queue
 * survives an app kill; this suite substitutes an in-memory store for the
 * real SQLite handle so the queue logic is testable without a database.
 */

import { PROACTIVE_READ_QUEUE_KEY } from '~/constants/proactive'
import { enqueueMarkRead, flushMarkReadQueue } from '../proactiveReadQueue'

let mockStore: Record<string, string> = {}

jest.mock('~/database/syncState', () => ({
  getSyncJson: jest.fn(async (key: string) => {
    const value = mockStore[key]
    return value === undefined ? null : JSON.parse(value)
  }),
  setSyncJson: jest.fn(async (key: string, value: unknown) => {
    mockStore[key] = JSON.stringify(value)
  }),
}))

beforeEach(() => {
  mockStore = {}
  jest.clearAllMocks()
})

describe('proactive read queue', () => {
  it('retries a failed mark-read instead of dropping it', async () => {
    let attempts = 0
    const call = jest.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('network')
      return { updated: 1 }
    })

    await enqueueMarkRead(['m1'], call)
    await flushMarkReadQueue(call)

    // A dropped mark-read leaves the server believing the user is ignoring this
    // character and suppresses every future push from it, silently.
    expect(attempts).toBe(2)
  })

  it('clears the queue once the call succeeds', async () => {
    const call = jest.fn(async () => ({ updated: 1 }))
    await enqueueMarkRead(['m1'], call)
    await flushMarkReadQueue(call)
    await flushMarkReadQueue(call)

    expect(call).toHaveBeenCalledTimes(1)
  })

  it('concurrent enqueues do not overwrite each other', async () => {
    // Without the queue lock, both enqueues would read an empty queue and the
    // second write would overwrite the first — losing 'a'. The lock makes the
    // second enqueue wait for the first to commit before reading, so both
    // appends survive.
    await Promise.all([enqueueMarkRead(['a']), enqueueMarkRead(['b'])])
    const stored = (JSON.parse(mockStore[PROACTIVE_READ_QUEUE_KEY]!) as string[]).sort()
    expect(stored).toEqual(['a', 'b'])
  })

  it('flush removes only its snapshot, preserving ids enqueued during the call', async () => {
    // The queue lock prevents an interleaved enqueue from writing through the
    // mock during the call, so emulate it by mutating the store directly. The
    // contract under test is: the flush's snapshot subtraction must not delete
    // ids it never sent.
    mockStore[PROACTIVE_READ_QUEUE_KEY] = JSON.stringify(['m1'])

    const call = jest.fn(async (req: { messageIds: string[] }) => {
      // Simulate a concurrent enqueue that landed mid-call: the queue now
      // carries m1 (the snapshot) plus m2 (the new enqueue).
      mockStore[PROACTIVE_READ_QUEUE_KEY] = JSON.stringify(['m1', 'm2'])
      return { updated: 1 }
    })

    await flushMarkReadQueue(call)

    const remaining = JSON.parse(mockStore[PROACTIVE_READ_QUEUE_KEY]!) as string[]
    expect(remaining).toEqual(['m2'])
  })
})

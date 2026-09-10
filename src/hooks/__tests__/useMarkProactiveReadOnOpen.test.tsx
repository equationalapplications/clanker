import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import { useMarkProactiveReadOnOpen } from '../useMarkProactiveReadOnOpen'

const mockCount = jest.fn()
const mockMarkLocally = jest.fn()
const mockEnqueue = jest.fn()
// Real flushMarkReadQueue is async; the mock must return a Promise so the
// hook's `.catch(...)` chain does not blow up on an undefined value.
const mockFlush = jest.fn(async () => undefined)

// useFocusEffect stores the cleanup callback against the latest effect call so
// tests can simulate the navigation lifecycle: mount → focus → blur → refocus.
// Mirrors expo-router's real behavior — a focus call runs the effect, a blur
// runs the previous cleanup, a refocus runs the effect again with a fresh
// cleanup. The shape (one registered cleanup at a time) is what the hook
// depends on.
let mockActiveCleanup: (() => void) | undefined
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => () => void) => {
    mockActiveCleanup?.()
    const cleanup = effect()
    mockActiveCleanup = cleanup
  },
}))

// getDatabase returns an object with withTransactionAsync that runs the callback
// inline. The real implementation wraps fn in a SQLite transaction; this fake
// preserves the seam by running fn synchronously through Promise.resolve so
// the hook's transaction-aware shape (mark locally + enqueue) is exercised as
// written.
const mockFakeDb = {
  withTransactionAsync: async (fn: () => Promise<unknown>) => fn(),
}
jest.mock('~/database/index', () => ({
  getDatabase: async () => mockFakeDb,
}))

jest.mock('~/database/messageDatabase', () => ({
  countUnreadProactive: (...a: unknown[]) => mockCount(...a),
  markProactiveReadLocally: (...a: unknown[]) => mockMarkLocally(...a),
}))
jest.mock('~/services/proactiveReadQueue', () => ({
  enqueueMarkRead: (...a: unknown[]) => mockEnqueue(...a),
  flushMarkReadQueue: (...a: unknown[]) => mockFlush(...a),
}))
jest.mock('~/services/proactiveMarkReadService', () => ({
  markProactiveReadViaCallable: jest.fn(),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      // Reclaim cache immediately — nothing needs to survive the test, and
      // jest-expo's worker exits cleanly when there are no live subscribers
      // pointing at pending garbage-collection timers.
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  })
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, invalidateSpy, Wrapper }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockActiveCleanup?.()
  mockActiveCleanup = undefined
})

describe('useMarkProactiveReadOnOpen', () => {
  it('marks locally, persists the queue, and kicks the flush when unread > 0', async () => {
    mockCount.mockResolvedValue(2)
    mockMarkLocally.mockResolvedValue(['p1', 'p2'])
    const { invalidateSpy, Wrapper } = createWrapper()
    renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper: Wrapper })
    // Atomic pair: mark locally + enqueue (no call) inside the same SQLite tx.
    await waitFor(() => expect(mockMarkLocally).toHaveBeenCalledWith('c1', mockFakeDb))
    await waitFor(() =>
      expect(mockEnqueue).toHaveBeenCalledWith(['p1', 'p2'], undefined, mockFakeDb),
    )
    // After the tx commits, the flush fires once.
    await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['proactiveUnread'] })
  })

  it('does nothing when unread is 0 (second open is a no-op)', async () => {
    mockCount.mockResolvedValue(0)
    const { Wrapper } = createWrapper()
    renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper: Wrapper })
    await waitFor(() => expect(mockCount).toHaveBeenCalled())
    expect(mockMarkLocally).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockFlush).not.toHaveBeenCalled()
  })

  it('does not flush when the local write returned no ids', async () => {
    mockCount.mockResolvedValue(2)
    mockMarkLocally.mockResolvedValue([])
    const { Wrapper } = createWrapper()
    renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper: Wrapper })
    await waitFor(() => expect(mockMarkLocally).toHaveBeenCalled())
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockFlush).not.toHaveBeenCalled()
  })

  // Regression for the CodeRabbit finding: the hook used to depend on
  // [characterId, queryClient], so returning to the chat with the same deps did
  // not rerun the effect and a proactive message that arrived while the chat
  // was blurred stayed marked-unread on refocus.
  it('re-runs on refocus and clears a proactive message that arrived during blur', async () => {
    // Initial focus: nothing unread (count=0, returns without marking). After
    // blur + refocus, the proactive message has arrived (count=1) and gets
    // marked. Only ONE markProactiveReadLocally call happens — the first
    // render short-circuits on the unread check.
    mockCount.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    mockMarkLocally.mockResolvedValueOnce(['p-new'])
    const { invalidateSpy, Wrapper } = createWrapper()
    const { rerender } = renderHook(
      ({ characterId }: { characterId: string }) => useMarkProactiveReadOnOpen(characterId),
      { wrapper: Wrapper, initialProps: { characterId: 'c1' } },
    )

    // Initial focus: nothing unread yet, nothing to mark.
    await waitFor(() => expect(mockCount).toHaveBeenCalledTimes(1))
    expect(mockMarkLocally).not.toHaveBeenCalled()

    // Blur: the cleanup runs, cancelling any in-flight mark-read work.
    mockActiveCleanup!()

    // Refocus: a proactive message arrived while we were blurred. The hook
    // must re-run and clear it. re-rendering with the same props drives the
    // refocused mount the real navigation would produce.
    rerender({ characterId: 'c1' })
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalledWith(['p-new'], undefined, mockFakeDb))
    await waitFor(() => expect(mockFlush).toHaveBeenCalledTimes(1))
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['proactiveUnread'] })
  })

  // Regression for the second CodeRabbit finding: a queue persistence failure
  // must roll back the local read_at write so the next focus can retry the
  // full pair. The fake db throws on the enqueue inside the transaction; the
  // hook must propagate the throw and leave mockMarkLocally's effect moot —
  // no flush is kicked, no cache is invalidated.
  it('rolls back the local mark when the queue write fails inside the transaction', async () => {
    mockCount.mockResolvedValue(1)
    mockMarkLocally.mockResolvedValue(['p-boom'])
    mockEnqueue.mockRejectedValueOnce(new Error('disk full'))
    const { invalidateSpy, Wrapper } = createWrapper()
    renderHook(() => useMarkProactiveReadOnOpen('c1'), { wrapper: Wrapper })
    await waitFor(() => expect(mockEnqueue).toHaveBeenCalled())
    // The error swallowed by the catch — but nothing downstream ran.
    expect(mockFlush).not.toHaveBeenCalled()
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})

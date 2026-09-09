import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useProactiveSync } from '../useProactiveSync'
import { markProactiveReadViaCallable } from '~/services/proactiveMarkReadService'

const mockSync = jest.fn()
const mockFlush = jest.fn()
const mockMarkReadCall = markProactiveReadViaCallable as unknown as jest.Mock

jest.mock('~/services/proactiveSync', () => ({
  syncProactiveMessages: (...args: unknown[]) => mockSync(...args),
}))
jest.mock('~/services/proactiveReadQueue', () => ({
  flushMarkReadQueue: (...args: unknown[]) => mockFlush(...args),
}))
jest.mock('~/services/proactiveMarkReadService', () => ({
  markProactiveReadViaCallable: jest.fn(),
}))
// useProactiveSync imports these for cache keys. The transitive imports touch
// expo-constants and the SQLite handle, so stub the modules to avoid pulling
// the whole database stack into a hook-only test.
jest.mock('~/hooks/useProactiveUnread', () => ({
  proactiveUnreadKeys: {
    all: ['proactiveUnread'],
    detail: (id: string) => ['proactiveUnread', id],
  },
}))
// Mirrors the real factory in ~/hooks/useMessages. Kept in sync by
// useMessages.messageKeys.test.ts, which asserts the real keys have this shape
// — a stub that drifts is how an over-broad invalidation hid here before.
jest.mock('~/hooks/useMessages', () => ({
  messageKeys: {
    all: ['messages'],
    lists: () => ['messages', 'list'],
    character: (characterId: string) => ['messages', 'list', characterId],
    list: (characterId: string, recipientUserId: string) => [
      'messages',
      'list',
      characterId,
      recipientUserId,
    ],
  },
}))

const appStateListeners: ((state: string) => void)[] = []
jest.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, cb: (state: string) => void) => {
      appStateListeners.push(cb)
      return { remove: jest.fn() }
    },
  },
  Platform: { OS: 'ios', select: (obj: Record<string, unknown>) => obj.ios },
}))

const notificationListeners: Record<string, (notification: unknown) => void> = {}
jest.mock('expo-notifications', () => ({
  addNotificationReceivedListener: (cb: (n: unknown) => void) => {
    notificationListeners.received = cb
    return { remove: jest.fn() }
  },
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getInitialNotificationAsync: jest.fn(async () => null),
}))

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  })
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

beforeEach(() => {
  jest.clearAllMocks()
  appStateListeners.length = 0
  for (const k of Object.keys(notificationListeners)) delete notificationListeners[k]
  mockSync.mockResolvedValue([])
  mockFlush.mockResolvedValue(undefined)
  mockMarkReadCall.mockResolvedValue({ updated: 0 })
})

const fireAppStateActive = () => {
  expect(appStateListeners.length).toBeGreaterThan(0)
  act(() => {
    appStateListeners[0]('active')
  })
}

describe('useProactiveSync', () => {
  it('fires sync on app foreground (active)', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    fireAppStateActive()

    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('uid-1'))
  })

  it('fires sync on foreground receipt of a PROACTIVE_CHARACTER_MESSAGE notification', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    await act(async () => {
      notificationListeners.received?.({
        request: {
          content: { data: { type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/x' } },
        },
      })
    })

    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('uid-1'))
  })

  it('ignores foreground receipts of other notification types', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    // The mount (cold-start) sync has already fired; the assertion is that the
    // foreign receipt adds no FURTHER run.
    await act(async () => {})
    const before = mockSync.mock.calls.length

    await act(async () => {
      notificationListeners.received?.({
        request: { content: { data: { type: 'OTHER' } } },
      })
    })

    expect(mockSync).toHaveBeenCalledTimes(before)
  })

  it('fires sync on mount (cold start, no AppState change and no tap)', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('uid-1'))
  })

  it('does NOT fire on mount without a user id', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useProactiveSync(null), { wrapper: Wrapper })

    await act(async () => {})
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('overlapping triggers share one in-flight run', async () => {
    let resolveSync!: () => void
    mockSync.mockImplementationOnce(
      () =>
        new Promise<void>((res) => {
          resolveSync = res
        }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    act(() => {
      result.current.triggerSync()
      result.current.triggerSync()
      result.current.triggerSync()
    })

    expect(mockSync).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSync()
    })
  })

  it('invalidates the unread + message caches after a successful sync', async () => {
    const { Wrapper, queryClient } = createWrapper()
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')
    mockSync.mockResolvedValue(['char-1'])

    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    await act(async () => {
      appStateListeners[0]('active')
    })

    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('uid-1'))

    await waitFor(() => {
      const calls = invalidateSpy.mock.calls.map((args) => JSON.stringify(args[0]?.queryKey ?? []))
      expect(calls.some((key) => key.startsWith('["proactiveUnread"'))).toBe(true)
      // Scoped to the touched thread, NOT the `["messages"]` catch-all that
      // would refetch every cached conversation.
      expect(calls).toContain(JSON.stringify(['messages', 'list', 'char-1']))
      expect(calls).not.toContain(JSON.stringify(['messages']))
    })
  })

  it('flushes the read queue even when the sync pull fails', async () => {
    mockSync.mockRejectedValueOnce(new Error('boom'))
    const { Wrapper } = createWrapper()
    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    // A stranded mark-read queue makes the server suppress every future push
    // from that character, so the flush must not share the pull's fate.
    await waitFor(() => expect(mockFlush).toHaveBeenCalled())
  })

  it('does NOT invalidate on sync failure', async () => {
    mockSync.mockRejectedValueOnce(new Error('boom'))
    const { Wrapper, queryClient } = createWrapper()
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries')

    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    await act(async () => {
      appStateListeners[0]('active')
    })

    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('uid-1'))

    // Give the rejected run time to settle — if invalidation were going to
    // happen, it would have happened by now.
    await act(async () => {
      await new Promise((res) => setTimeout(res, 10))
    })

    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('flushes the read queue with the real callable after a successful sync', async () => {
    const { Wrapper } = createWrapper()
    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    await act(async () => {
      appStateListeners[0]('active')
    })

    await waitFor(() => expect(mockFlush).toHaveBeenCalledWith(mockMarkReadCall))
  })
})

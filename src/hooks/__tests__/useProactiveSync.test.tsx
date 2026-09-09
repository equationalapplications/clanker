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
jest.mock('~/hooks/useMessages', () => ({
  messageKeys: {
    all: ['messages'],
  },
}))

const appStateListeners: Array<(state: string) => void> = []
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
  mockSync.mockResolvedValue(undefined)
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

    await act(async () => {
      notificationListeners.received?.({
        request: { content: { data: { type: 'OTHER' } } },
      })
    })

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

    renderHook(() => useProactiveSync('uid-1'), { wrapper: Wrapper })

    await act(async () => {
      appStateListeners[0]('active')
    })

    await waitFor(() => expect(mockSync).toHaveBeenCalledWith('uid-1'))

    await waitFor(() => {
      const calls = invalidateSpy.mock.calls.map((args) => JSON.stringify(args[0]?.queryKey ?? []))
      expect(calls.some((key) => key.startsWith('["proactiveUnread"'))).toBe(true)
      expect(calls.some((key) => key.startsWith('["messages"'))).toBe(true)
    })
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

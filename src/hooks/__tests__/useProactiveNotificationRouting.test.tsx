import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react-native'
import { useProactiveNotificationRouting } from '../useProactiveNotificationRouting'

const mockRouterPush = jest.fn()
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockRouterPush(...a) },
}))

let responseListener: ((response: unknown) => void) | undefined
let mockLastResponse: unknown = null
const mockClearLast = jest.fn(async () => {
  mockLastResponse = null
})
jest.mock('expo-notifications', () => ({
  useLastNotificationResponse: () => mockLastResponse,
  addNotificationResponseReceivedListener: (cb: (r: unknown) => void) => {
    responseListener = cb
    return { remove: jest.fn() }
  },
  clearLastNotificationResponseAsync: () => mockClearLast(),
}))

// triggerSync returns a Promise that resolves when the test fires
// `triggerSyncResolver()`. Tests can await the resolution to observe the
// post-sync mark-read (the chain runs in a microtask).
const triggerSyncPending: { resolve: (() => void) | null } = { resolve: null }
const triggerSync = jest.fn(
  () =>
    new Promise<void>((resolve) => {
      triggerSyncPending.resolve = resolve
    }),
)

const mockMarkLocally = jest.fn()
const mockEnqueue = jest.fn()
const mockFakeDb = {
  withTransactionAsync: async (fn: () => Promise<unknown>) => fn(),
}
jest.mock('~/database/index', () => ({
  getDatabase: async () => mockFakeDb,
}))
jest.mock('~/database/messageDatabase', () => ({
  markProactiveReadLocally: (...a: unknown[]) => mockMarkLocally(...a),
}))
jest.mock('~/services/proactiveReadQueue', () => ({
  enqueueMarkRead: (...a: unknown[]) => mockEnqueue(...a),
}))
jest.mock('~/services/proactiveMarkReadService', () => ({
  markProactiveReadViaCallable: jest.fn(),
}))

function response(data: unknown, identifier = 'notif-1') {
  return { notification: { request: { identifier, content: { data } } } }
}

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
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
  responseListener = undefined
  mockLastResponse = null
  triggerSyncPending.resolve = null
  mockMarkLocally.mockResolvedValue([])
})

it('routes a tap with valid type + /chat/ deepLink and fires the sync trigger non-blocking', () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }))
  expect(triggerSync).toHaveBeenCalledTimes(1)
  expect(mockRouterPush).toHaveBeenCalledWith('/chat/abc')
})

it('ignores a wrong type', () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(response({ type: 'OTHER', deepLink: '/chat/abc' }))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores a malformed deepLink', () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: 'https://evil.example/chat/x' }),
  )
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores a missing deepLink', () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE' }))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores missing data', () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(response(undefined))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores a dot-segment deepLink (e.g. /chat/../admin)', () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/../admin' }))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores a multi-segment deepLink after /chat/', () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc/extra' }))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('routes cold start after mount and clears the response', async () => {
  const { Wrapper } = createWrapper()
  mockLastResponse = response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' })
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/chat/abc'))
  expect(triggerSync).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(mockClearLast).toHaveBeenCalledTimes(1))
})

it('ignores a cold-start notification of the wrong shape and leaves the response in place', async () => {
  const { Wrapper } = createWrapper()
  mockLastResponse = response({ type: 'OTHER' })
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  await waitFor(() => expect(mockRouterPush).not.toHaveBeenCalled())
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockClearLast).not.toHaveBeenCalled()
})

it('does not route the same response identifier twice (listener + useLastNotificationResponse)', () => {
  // Cold-start: useLastNotificationResponse fires first, captures the response
  // and routes it. A duplicate tap on the same notification (same identifier)
  // then arrives via the listener — must dedupe so the chat route isn't
  // pushed twice.
  const { Wrapper } = createWrapper()
  mockLastResponse = response(
    { type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' },
    'dup-id',
  )
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  expect(mockRouterPush).toHaveBeenCalledTimes(1)
  expect(triggerSync).toHaveBeenCalledTimes(1)
  expect(mockClearLast).toHaveBeenCalledTimes(1)

  // Same identifier via the second path (listener) — must NOT call router.push
  // again. This is the regression CodeRabbit flagged: mounted taps can reach
  // both addNotificationResponseReceivedListener and useLastNotificationResponse.
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }, 'dup-id'),
  )
  expect(mockRouterPush).toHaveBeenCalledTimes(1)
  expect(triggerSync).toHaveBeenCalledTimes(1)
})

it('routes the SAME deepLink from DIFFERENT identifiers (no over-dedupe)', () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }, 'id-1'),
  )
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }, 'id-2'),
  )
  expect(mockRouterPush).toHaveBeenCalledTimes(2)
  expect(triggerSync).toHaveBeenCalledTimes(2)
})

// Regression for the CodeRabbit finding: the chat-mount mark-read saw an
// unread count of zero BEFORE the tap-triggered sync inserted the new
// messages, so those stayed unread on the server until the next sync. The
// routing hook must mark the thread read AFTER the sync completes, so the
// unread count reflects reality as soon as the sync lands.
it('marks the opened thread read after triggerSync resolves', async () => {
  const { Wrapper, invalidateSpy } = createWrapper()
  mockMarkLocally.mockResolvedValue(['p-new-1', 'p-new-2'])
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })

  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }))

  // Pre-resolution: navigation fired, sync is in flight, no mark-read yet.
  expect(mockMarkLocally).not.toHaveBeenCalled()
  triggerSyncPending.resolve?.()
  await waitFor(() => expect(mockMarkLocally).toHaveBeenCalledWith('abc', mockFakeDb))
  await waitFor(() =>
    expect(mockEnqueue).toHaveBeenCalledWith(['p-new-1', 'p-new-2'], undefined, mockFakeDb),
  )
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['proactiveUnread'] })
})

it('does not mark the thread read when triggerSync returns void', async () => {
  // Defensive: if a caller does not pass a Promise-returning triggerSync
  // (e.g. a custom one that runs synchronously), the routing hook must not
  // throw and must not invoke the post-sync mark-read.
  const syncVoid = jest.fn(() => undefined)
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync: syncVoid }), { wrapper: Wrapper })
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }))
  await new Promise((res) => setTimeout(res, 10))
  expect(syncVoid).toHaveBeenCalledTimes(1)
  expect(mockMarkLocally).not.toHaveBeenCalled()
})

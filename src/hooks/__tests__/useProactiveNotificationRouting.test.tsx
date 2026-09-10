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

// Cloud UUID -> local id. Defaults to identity (no divergence); tests that
// exercise the mapping register an entry.
const mockLocalIds = new Map<string, string>()
jest.mock('~/database/characterDatabase', () => ({
  resolveLocalCharacterId: async (cloudId: string) => mockLocalIds.get(cloudId) ?? cloudId,
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

it('routes a tap with valid type + /chat/ deepLink and fires the sync trigger non-blocking', async () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }))
  // triggerSync still fires synchronously; only the push waits on the
  // cloud->local id resolve (one local SQLite read), so it lands a microtask
  // later than it used to.
  expect(triggerSync).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/chat/abc'))
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

it('does not route the same response identifier twice (listener + useLastNotificationResponse)', async () => {
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
  await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(1))
  expect(triggerSync).toHaveBeenCalledTimes(1)
  expect(mockClearLast).toHaveBeenCalledTimes(1)

  // Same identifier via the second path (listener) — must NOT call router.push
  // again. This is the regression CodeRabbit flagged: mounted taps can reach
  // both addNotificationResponseReceivedListener and useLastNotificationResponse.
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }, 'dup-id'),
  )
  // Dedupe is still decided synchronously, so a flush of the microtask queue
  // must not produce a second push.
  await Promise.resolve()
  expect(mockRouterPush).toHaveBeenCalledTimes(1)
  expect(triggerSync).toHaveBeenCalledTimes(1)
})

it('routes the SAME deepLink from DIFFERENT identifiers (no over-dedupe)', async () => {
  const { Wrapper } = createWrapper()
  renderHook(() => useProactiveNotificationRouting({ triggerSync }), { wrapper: Wrapper })
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }, 'id-1'),
  )
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }, 'id-2'),
  )
  await waitFor(() => expect(mockRouterPush).toHaveBeenCalledTimes(2))
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

/**
 * Regression: the push payload's deepLink carries the SERVER character UUID,
 * but `/chat/<id>` is validated by useTabCharacterId against the set of LOCAL
 * character ids, and markProactiveReadLocally filters on the local id too. A
 * diverged character therefore routed to a dead id and marked nothing read.
 */
describe('cloud->local character id resolution', () => {
  beforeEach(() => {
    mockLocalIds.clear()
  })

  it('routes to the LOCAL chat id, not the cloud id from the deepLink', async () => {
    mockLocalIds.set('cloud-uuid-9', 'char_local9')
    const { Wrapper } = createWrapper()
    const { unmount } = renderHook(() => useProactiveNotificationRouting({ triggerSync }), {
      wrapper: Wrapper,
    })

    responseListener?.(
      response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/cloud-uuid-9' }),
    )

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/chat/char_local9'))
    unmount()
  })

  it('marks the LOCAL thread read after the sync resolves', async () => {
    mockLocalIds.set('cloud-uuid-8', 'char_local8')
    mockMarkLocally.mockResolvedValue(['m1'])
    const { Wrapper } = createWrapper()
    const { unmount } = renderHook(() => useProactiveNotificationRouting({ triggerSync }), {
      wrapper: Wrapper,
    })

    responseListener?.(
      response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/cloud-uuid-8' }, 'notif-8'),
    )

    await waitFor(() => expect(triggerSyncPending.resolve).not.toBeNull())
    triggerSyncPending.resolve?.()

    await waitFor(() =>
      expect(mockMarkLocally).toHaveBeenCalledWith('char_local8', expect.anything()),
    )
    unmount()
  })

  it('falls back to the deepLink id when the character has no local row', async () => {
    const { Wrapper } = createWrapper()
    const { unmount } = renderHook(() => useProactiveNotificationRouting({ triggerSync }), {
      wrapper: Wrapper,
    })

    responseListener?.(
      response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/cloud-orphan' }, 'notif-7'),
    )

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/chat/cloud-orphan'))
    unmount()
  })
})

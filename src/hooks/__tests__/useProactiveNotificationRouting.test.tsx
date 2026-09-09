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

const triggerSync = jest.fn()
function response(data: unknown, identifier = 'notif-1') {
  return { notification: { request: { identifier, content: { data } } } }
}

beforeEach(() => {
  jest.clearAllMocks()
  responseListener = undefined
  mockLastResponse = null
})

it('routes a tap with valid type + /chat/ deepLink and fires the sync trigger non-blocking', () => {
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }))
  expect(triggerSync).toHaveBeenCalledTimes(1)
  expect(mockRouterPush).toHaveBeenCalledWith('/chat/abc')
})

it('ignores a wrong type', () => {
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(response({ type: 'OTHER', deepLink: '/chat/abc' }))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores a malformed deepLink', () => {
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: 'https://evil.example/chat/x' }),
  )
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores a missing deepLink', () => {
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE' }))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores missing data', () => {
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(response(undefined))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores a dot-segment deepLink (e.g. /chat/../admin)', () => {
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/../admin' }))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('ignores a multi-segment deepLink after /chat/', () => {
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc/extra' }))
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockRouterPush).not.toHaveBeenCalled()
})

it('routes cold start after mount and clears the response', async () => {
  mockLastResponse = response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' })
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith('/chat/abc'))
  expect(triggerSync).toHaveBeenCalledTimes(1)
  await waitFor(() => expect(mockClearLast).toHaveBeenCalledTimes(1))
})

it('ignores a cold-start notification of the wrong shape and leaves the response in place', async () => {
  mockLastResponse = response({ type: 'OTHER' })
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  await waitFor(() => expect(mockRouterPush).not.toHaveBeenCalled())
  expect(triggerSync).not.toHaveBeenCalled()
  expect(mockClearLast).not.toHaveBeenCalled()
})

it('does not route the same response identifier twice (listener + useLastNotificationResponse)', () => {
  // Cold-start: useLastNotificationResponse fires first, captures the response
  // and routes it. A duplicate tap on the same notification (same identifier)
  // then arrives via the listener — must dedupe so the chat route isn't
  // pushed twice.
  mockLastResponse = response(
    { type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' },
    'dup-id',
  )
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
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
  // Two distinct notifications, same target. Each must route; the dedupe set
  // is keyed on identifier, not deepLink.
  renderHook(() => useProactiveNotificationRouting({ triggerSync }))
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }, 'id-1'),
  )
  responseListener!(
    response({ type: 'PROACTIVE_CHARACTER_MESSAGE', deepLink: '/chat/abc' }, 'id-2'),
  )
  expect(mockRouterPush).toHaveBeenCalledTimes(2)
  expect(triggerSync).toHaveBeenCalledTimes(2)
})

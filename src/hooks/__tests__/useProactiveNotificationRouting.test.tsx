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
function response(data: unknown) {
  return { notification: { request: { content: { data } } } }
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

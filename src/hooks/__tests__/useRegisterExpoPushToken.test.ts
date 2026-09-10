import { renderHook, waitFor } from '@testing-library/react-native'
import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import { useRegisterExpoPushToken } from '../useRegisterExpoPushToken'

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  getDevicePushTokenAsync: jest.fn(),
}))

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      ios: { bundleIdentifier: 'com.example.app' },
      notification: { vapidPublicKey: 'vapid-key' },
    },
  },
}))

const mockRegisterFn = jest.fn()
jest.mock('~/config/firebaseConfig', () => ({
  registerExpoPushTokenFn: (...args: unknown[]) => mockRegisterFn(...args),
  appCheckReady: Promise.resolve(),
  getCurrentUser: () => ({}),
}))

jest.mock('~/auth/devSandboxFlag', () => ({
  isDevSandboxEnabled: () => false,
}))

const mockGetPermissions = Notifications.getPermissionsAsync as jest.Mock
const mockRequestPermissions = Notifications.requestPermissionsAsync as jest.Mock
const mockGetExpoPushToken = Notifications.getExpoPushTokenAsync as jest.Mock
const mockGetDevicePushToken = Notifications.getDevicePushTokenAsync as jest.Mock

let originalOSDescriptor: PropertyDescriptor | undefined

function setPlatformOS(value: 'ios' | 'android' | 'web') {
  if (!originalOSDescriptor) {
    originalOSDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS') ?? {
      value: Platform.OS,
      configurable: true,
      writable: true,
    }
  }
  Object.defineProperty(Platform, 'OS', {
    value,
    configurable: true,
    writable: true,
  })
}

function resetPlatformOS() {
  if (originalOSDescriptor) {
    Object.defineProperty(Platform, 'OS', originalOSDescriptor)
    originalOSDescriptor = undefined
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockGetPermissions.mockResolvedValue({ status: 'granted' })
  mockRequestPermissions.mockResolvedValue({ status: 'granted' })
  mockGetExpoPushToken.mockResolvedValue({ data: 'ExponentPushToken[abc]' })
  mockGetDevicePushToken.mockResolvedValue({ type: 'expo', data: 'device-token' })
  mockRegisterFn.mockResolvedValue({ data: { ok: true } })
})

afterEach(() => {
  resetPlatformOS()
})

describe('useRegisterExpoPushToken', () => {
  it('sends capabilities.proactivePush: true with the native token', async () => {
    setPlatformOS('ios')
    renderHook(() => useRegisterExpoPushToken({ enabled: true, projectId: 'proj' }))
    await waitFor(() => expect(mockRegisterFn).toHaveBeenCalled())
    expect(mockRegisterFn).toHaveBeenCalledWith({
      expoPushToken: 'ExponentPushToken[abc]',
      capabilities: { proactivePush: true },
    })
  })

  it('sends capabilities.proactivePush: true on the web path', async () => {
    setPlatformOS('web')
    mockGetDevicePushToken.mockResolvedValue({
      type: 'web',
      data: { endpoint: 'https://example.com/push', keys: { p256dh: 'k', auth: 'a' } },
    })
    renderHook(() => useRegisterExpoPushToken({ enabled: true, projectId: 'proj' }))
    await waitFor(() => expect(mockRegisterFn).toHaveBeenCalled())
    const callArg = mockRegisterFn.mock.calls[0][0] as Record<string, unknown>
    expect(callArg.capabilities).toEqual({ proactivePush: true })
  })

  it('does not register when disabled', async () => {
    setPlatformOS('ios')
    renderHook(() => useRegisterExpoPushToken({ enabled: false, projectId: 'proj' }))
    await waitFor(() => expect(mockGetPermissions).not.toHaveBeenCalled())
    expect(mockRegisterFn).not.toHaveBeenCalled()
  })

  // Regression for the CodeRabbit finding: a true→false transition must
  // actively clear proactivePushReady on the server. The previous behavior
  // just skipped registration, leaving a persisted `true` from the prior
  // session. The downgrade fires a capability-only call (no token) so the
  // server clears the flag without overwriting the existing expo_push_token.
  it('clears proactivePushReady when notifications transition from enabled to disabled', async () => {
    setPlatformOS('ios')
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRegisterExpoPushToken({ enabled, projectId: 'proj' }),
      { initialProps: { enabled: true } },
    )
    await waitFor(() =>
      expect(mockRegisterFn).toHaveBeenCalledWith({
        expoPushToken: 'ExponentPushToken[abc]',
        capabilities: { proactivePush: true },
      }),
    )
    mockRegisterFn.mockClear()

    rerender({ enabled: false })

    await waitFor(() =>
      expect(mockRegisterFn).toHaveBeenCalledWith({
        capabilities: { proactivePush: false },
      }),
    )
    // No token in the payload — the server's capabilities-only branch leaves
    // expo_push_token untouched.
    const downgradeArg = mockRegisterFn.mock.calls[0][0] as Record<string, unknown>
    expect(downgradeArg.expoPushToken).toBeUndefined()
    expect(downgradeArg.webDevicePushToken).toBeUndefined()
  })

  it('does not fire a downgrade call on the very first render with enabled=false', async () => {
    setPlatformOS('ios')
    renderHook(() => useRegisterExpoPushToken({ enabled: false, projectId: 'proj' }))
    await waitFor(() => expect(mockGetPermissions).not.toHaveBeenCalled())
    expect(mockRegisterFn).not.toHaveBeenCalled()
  })
})

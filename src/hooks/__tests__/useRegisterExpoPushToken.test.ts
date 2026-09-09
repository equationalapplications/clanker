import { renderHook, waitFor } from '@testing-library/react-native'
import { Platform } from 'react-native'
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

import * as Notifications from 'expo-notifications'

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
})

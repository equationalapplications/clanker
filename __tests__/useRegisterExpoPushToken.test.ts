import { renderHook, waitFor } from '@testing-library/react-native'
import Constants from 'expo-constants'
import { useRegisterExpoPushToken } from '~/hooks/useRegisterExpoPushToken'

jest.mock('expo-constants', () => ({
  expoConfig: {
    notification: { vapidPublicKey: 'test-vapid-key' },
    scheme: 'com.equationalapplications.clanker',
  },
}))

const defaultExpoConfig = {
  notification: { vapidPublicKey: 'test-vapid-key' },
  scheme: 'com.equationalapplications.clanker',
}

const mockRegisterExpoPushTokenFn = jest.fn().mockResolvedValue({ data: { ok: true } })

const mockIsDevSandboxEnabled = jest.fn().mockReturnValue(false)
jest.mock('~/auth/devSandboxFlag', () => ({
  isDevSandboxEnabled: (...args: unknown[]) => mockIsDevSandboxEnabled(...args),
}))

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  getDevicePushTokenAsync: jest.fn().mockResolvedValue({
    type: 'web',
    data: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'p', auth: 'a' },
    },
  }),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(true),
}))

jest.mock('~/config/firebaseConfig', () => ({
  appCheckReady: Promise.resolve(),
  getCurrentUser: jest.fn().mockReturnValue({ getIdToken: jest.fn().mockResolvedValue('id-tok') }),
  registerExpoPushTokenFn: (...args: unknown[]) => mockRegisterExpoPushTokenFn(...args),
}))

describe('useRegisterExpoPushToken', () => {
  beforeEach(() => {
    __setJestPlatformOS('ios')
    jest.mocked(Constants).expoConfig = {
      ...defaultExpoConfig,
    } as unknown as typeof Constants.expoConfig
    window.localStorage.clear()
    mockRegisterExpoPushTokenFn.mockClear()
    mockIsDevSandboxEnabled.mockReturnValue(false)
    jest.clearAllMocks()
  })

  afterEach(() => {
    __resetJestPlatformOS()
  })

  it('registers native token via Firebase callable', async () => {
    const Notifications = require('expo-notifications')

    renderHook(() => useRegisterExpoPushToken({ enabled: true, projectId: 'test-proj' }))
    await waitFor(() => {
      expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-proj' })
      expect(mockRegisterExpoPushTokenFn).toHaveBeenCalledWith({
        expoPushToken: 'ExponentPushToken[test]',
      })
    })
  })

  it('skips web registration when vapidPublicKey is not configured', async () => {
    __setJestPlatformOS('web')
    jest.mocked(Constants).expoConfig = {
      notification: {},
      scheme: 'com.equationalapplications.clanker',
    } as unknown as typeof Constants.expoConfig
    const Notifications = require('expo-notifications')

    renderHook(() => useRegisterExpoPushToken({ enabled: true, projectId: 'test-proj' }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(Notifications.getDevicePushTokenAsync).not.toHaveBeenCalled()
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled()
    expect(mockRegisterExpoPushTokenFn).not.toHaveBeenCalled()
  })

  it('registers web push via Firebase callable', async () => {
    __setJestPlatformOS('web')
    const Notifications = require('expo-notifications')
    window.localStorage.setItem('EXPO_NOTIFICATIONS_INSTALLATION_ID', 'install-1')

    renderHook(() =>
      useRegisterExpoPushToken({
        enabled: true,
        projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
      }),
    )
    await waitFor(() => {
      expect(Notifications.getDevicePushTokenAsync).toHaveBeenCalled()
      expect(mockRegisterExpoPushTokenFn).toHaveBeenCalledWith({
        webDevicePushToken: {
          type: 'web',
          data: {
            endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
            keys: { p256dh: 'p', auth: 'a' },
          },
        },
        projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
        applicationId: 'com.equationalapplications.clanker',
        deviceId: 'install-1',
      })
    })
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled()
  })

  it('skips registration entirely in the dev sandbox', async () => {
    // Mock auth has no real Firebase identity, so the callable rejects with
    // "Authentication required" — never attempt it.
    mockIsDevSandboxEnabled.mockReturnValue(true)
    const Notifications = require('expo-notifications')

    renderHook(() => useRegisterExpoPushToken({ enabled: true, projectId: 'test-proj' }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled()
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled()
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled()
    expect(mockRegisterExpoPushTokenFn).not.toHaveBeenCalled()
  })
})

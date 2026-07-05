jest.mock('@react-native-firebase/analytics', () => {
  const mockAnalyticsInstance = { __brand: 'analyticsInstance' }
  const mockGetAnalytics = jest.fn(() => mockAnalyticsInstance)
  const mockLogEvent = jest.fn()
  const mockLogScreenView = jest.fn()
  const mockSetAnalyticsCollectionEnabled = jest.fn().mockResolvedValue(undefined)
  const mockSetUserId = jest.fn().mockResolvedValue(undefined)

  return {
    __esModule: true,
    getAnalytics: mockGetAnalytics,
    logEvent: mockLogEvent,
    logScreenView: mockLogScreenView,
    setAnalyticsCollectionEnabled: mockSetAnalyticsCollectionEnabled,
    setUserId: mockSetUserId,
  }
})

import {
  getAnalytics,
  logEvent as rnfbLogEvent,
  logScreenView as rnfbLogScreenView,
  setAnalyticsCollectionEnabled,
  setUserId as rnfbSetUserId,
} from '@react-native-firebase/analytics'
import { logEvent, logScreenView, setAnalyticsEnabled, setUserId } from '~/services/analyticsService'

const mockAnalyticsInstance = getAnalytics()

describe('analyticsService (native)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(setAnalyticsCollectionEnabled).mockResolvedValue(undefined)
    jest.mocked(rnfbSetUserId).mockResolvedValue(undefined)
  })

  it('logScreenView calls RNFB logScreenView with screen_name and screen_class', () => {
    logScreenView('home')
    expect(rnfbLogScreenView).toHaveBeenCalledWith(mockAnalyticsInstance, {
      screen_name: 'home',
      screen_class: 'home',
    })
  })

  it('logScreenView swallows errors instead of throwing', () => {
    jest.mocked(rnfbLogScreenView).mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => logScreenView('home')).not.toThrow()
  })

  it('logEvent forwards name and params to RNFB logEvent', () => {
    logEvent('character_created', { platform: 'ios' })
    expect(rnfbLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'character_created', { platform: 'ios' })
  })

  it('logEvent works with no params', () => {
    logEvent('message_sent')
    expect(rnfbLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'message_sent', undefined)
  })

  it('logEvent swallows errors instead of throwing', () => {
    jest.mocked(rnfbLogEvent).mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => logEvent('x')).not.toThrow()
  })

  it('setAnalyticsEnabled(true) calls setAnalyticsCollectionEnabled(instance, true)', async () => {
    await setAnalyticsEnabled(true)
    expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, true)
  })

  it('setAnalyticsEnabled(false) calls setAnalyticsCollectionEnabled(instance, false)', async () => {
    await setAnalyticsEnabled(false)
    expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, false)
  })

  it('setAnalyticsEnabled swallows errors instead of throwing/rejecting', async () => {
    jest.mocked(setAnalyticsCollectionEnabled).mockRejectedValue(new Error('boom'))
    await expect(setAnalyticsEnabled(true)).resolves.toBeUndefined()
  })

  it('setUserId(uid) calls RNFB setUserId with the uid', async () => {
    await setUserId('firebase-uid-123')
    expect(rnfbSetUserId).toHaveBeenCalledWith(mockAnalyticsInstance, 'firebase-uid-123')
  })

  it('setUserId(null) clears the user id with an empty string', async () => {
    await setUserId(null)
    expect(rnfbSetUserId).toHaveBeenCalledWith(mockAnalyticsInstance, '')
  })

  it('setUserId swallows errors instead of throwing/rejecting', async () => {
    jest.mocked(rnfbSetUserId).mockRejectedValue(new Error('boom'))
    await expect(setUserId('x')).resolves.toBeUndefined()
  })
})

jest.mock('firebase/analytics', () => {
  const mockAnalyticsInstance = { __brand: 'webAnalyticsInstance' }
  const mockGetAnalytics = jest.fn(() => mockAnalyticsInstance)
  const mockIsSupported = jest.fn()
  const mockLogEvent = jest.fn()
  const mockSetAnalyticsCollectionEnabled = jest.fn()
  const mockSetUserId = jest.fn()

  return {
    __esModule: true,
    getAnalytics: mockGetAnalytics,
    isSupported: mockIsSupported,
    logEvent: mockLogEvent,
    setAnalyticsCollectionEnabled: mockSetAnalyticsCollectionEnabled,
    setUserId: mockSetUserId,
  }
})

jest.mock('~/config/firebaseConfig.web', () => ({
  firebaseApp: { __brand: 'firebaseApp' },
}))

import {
  getAnalytics,
  isSupported,
  logEvent as firebaseLogEvent,
  setAnalyticsCollectionEnabled,
  setUserId as firebaseSetUserId,
} from 'firebase/analytics'
import {
  logEvent,
  logScreenView,
  setAnalyticsEnabled,
  setUserId,
  __resetAnalyticsForTests,
} from '~/services/analyticsService.web'

const mockAnalyticsInstance = getAnalytics()

describe('analyticsService.web', () => {
  beforeEach(() => {
    __resetAnalyticsForTests()
    jest.clearAllMocks()
    jest.mocked(isSupported).mockResolvedValue(true)
  })

  it('logScreenView is a no-op before analytics is enabled', () => {
    logScreenView('home')
    expect(firebaseLogEvent).not.toHaveBeenCalled()
  })

  it('logEvent is a no-op before analytics is enabled', () => {
    logEvent('message_sent')
    expect(firebaseLogEvent).not.toHaveBeenCalled()
  })

  it('setAnalyticsEnabled(true) initializes analytics when isSupported() resolves true', async () => {
    await setAnalyticsEnabled(true)
    expect(isSupported).toHaveBeenCalled()
    expect(getAnalytics).toHaveBeenCalledWith({ __brand: 'firebaseApp' })
    expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, true)
  })

  it('does not initialize analytics when isSupported() resolves false', async () => {
    jest.mocked(isSupported).mockResolvedValue(false)
    await setAnalyticsEnabled(true)
    expect(getAnalytics).not.toHaveBeenCalled()
    expect(setAnalyticsCollectionEnabled).not.toHaveBeenCalled()
  })

  it('does not initialize analytics when isSupported() resolves false', async () => {
    jest.mocked(isSupported).mockResolvedValue(false)
    await setAnalyticsEnabled(true)
    expect(getAnalytics).not.toHaveBeenCalled()
    expect(setAnalyticsCollectionEnabled).not.toHaveBeenCalled()
  })

  it('does not queue logEvent calls after isSupported() resolves false', async () => {
    jest.mocked(isSupported).mockResolvedValue(false)
    await setAnalyticsEnabled(true)
    logEvent('message_sent')
    logEvent('sign_up')
    expect(firebaseLogEvent).not.toHaveBeenCalled()
  })

  it('does not queue setUserId calls after isSupported() resolves false', async () => {
    jest.mocked(isSupported).mockResolvedValue(false)
    await setAnalyticsEnabled(true)
    await setUserId('firebase-uid-123')
    expect(firebaseSetUserId).not.toHaveBeenCalled()
  })

  it('after enabling, logScreenView forwards a screen_view event with firebase_screen params', async () => {
    await setAnalyticsEnabled(true)
    logScreenView('home')
    expect(firebaseLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'screen_view', {
      firebase_screen: 'home',
      firebase_screen_class: 'home',
    })
  })

  it('after enabling, logEvent forwards name and params', async () => {
    await setAnalyticsEnabled(true)
    logEvent('character_created', { platform: 'web' })
    expect(firebaseLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'character_created', { platform: 'web' })
  })

  it('queues logEvent calls made while async init is in flight and flushes after init', async () => {
    let resolveSupported!: (v: boolean) => void
    jest.mocked(isSupported).mockReturnValue(new Promise<boolean>((r) => { resolveSupported = r }))

    const enablePromise = setAnalyticsEnabled(true)
    logEvent('sign_up', { platform: 'web' })
    expect(firebaseLogEvent).not.toHaveBeenCalled()

    resolveSupported(true)
    await enablePromise
    expect(firebaseLogEvent).toHaveBeenCalledWith(mockAnalyticsInstance, 'sign_up', { platform: 'web' })
  })

  it('queues setUserId calls made while async init is in flight and flushes after init', async () => {
    let resolveSupported!: (v: boolean) => void
    jest.mocked(isSupported).mockReturnValue(new Promise<boolean>((r) => { resolveSupported = r }))

    const enablePromise = setAnalyticsEnabled(true)
    const userIdPromise = setUserId('firebase-uid-123')
    expect(firebaseSetUserId).not.toHaveBeenCalled()

    resolveSupported(true)
    await Promise.all([enablePromise, userIdPromise])
    expect(firebaseSetUserId).toHaveBeenCalledWith(mockAnalyticsInstance, 'firebase-uid-123')
  })

  it('setAnalyticsEnabled(false) disables collection on an already-initialized instance', async () => {
    await setAnalyticsEnabled(true)
    jest.mocked(setAnalyticsCollectionEnabled).mockClear()
    await setAnalyticsEnabled(false)
    expect(setAnalyticsCollectionEnabled).toHaveBeenCalledWith(mockAnalyticsInstance, false)
  })

  it('logEvent and setUserId are no-ops after disabling following a prior enable', async () => {
    await setAnalyticsEnabled(true)
    logEvent('message_sent')
    expect(firebaseLogEvent).toHaveBeenCalled()
    jest.mocked(firebaseLogEvent).mockClear()
    jest.mocked(firebaseSetUserId).mockClear()

    await setAnalyticsEnabled(false)
    logEvent('message_sent')
    await setUserId('firebase-uid-123')
    expect(firebaseLogEvent).not.toHaveBeenCalled()
    expect(firebaseSetUserId).not.toHaveBeenCalled()
  })

  it('setAnalyticsEnabled(false) before ever enabling is a no-op, not a throw', async () => {
    await expect(setAnalyticsEnabled(false)).resolves.toBeUndefined()
    expect(setAnalyticsCollectionEnabled).not.toHaveBeenCalled()
  })

  it('setUserId(null) clears the user id', async () => {
    await setAnalyticsEnabled(true)
    await setUserId(null)
    expect(firebaseSetUserId).toHaveBeenCalledWith(mockAnalyticsInstance, null)
  })

  it('swallows isSupported() rejection instead of throwing', async () => {
    jest.mocked(isSupported).mockRejectedValue(new Error('boom'))
    await expect(setAnalyticsEnabled(true)).resolves.toBeUndefined()
  })
})

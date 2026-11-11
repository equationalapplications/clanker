jest.mock('@react-native-firebase/crashlytics', () => {
  const mockInstance = { __brand: 'crashlyticsInstance' }
  return {
    __esModule: true,
    getCrashlytics: jest.fn(() => mockInstance),
    setCrashlyticsCollectionEnabled: jest.fn().mockResolvedValue(undefined),
    deleteUnsentReports: jest.fn().mockResolvedValue(undefined),
    setUserId: jest.fn().mockResolvedValue(undefined),
    setAttribute: jest.fn().mockResolvedValue(undefined),
    recordError: jest.fn(),
  }
})

const mockStore = new Map<string, string>()
jest.mock('~/utilities/kvStorage', () => ({
  Storage: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => {
      mockStore.set(key, value)
    },
  },
}))

import {
  deleteUnsentReports,
  getCrashlytics,
  setAttribute,
  setCrashlyticsCollectionEnabled,
} from '@react-native-firebase/crashlytics'
import { clearCrashlyticsContext, initializeCrashlytics } from '~/services/crashlyticsService'

const instance = getCrashlytics()

describe('crashlyticsService (native)', () => {
  beforeEach(() => {
    mockStore.clear()
    jest.clearAllMocks()
    jest.mocked(deleteUnsentReports).mockResolvedValue(undefined)
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('enables collection only when the signed-in uid owns a stored grant', async () => {
    mockStore.set('setting:analytics', '1')
    mockStore.set('setting:analyticsOwner', 'A')

    await initializeCrashlytics('A')

    expect(setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(instance, true)
    expect(deleteUnsentReports).not.toHaveBeenCalled()
  })

  it.each([
    ['another account', 'B'],
    ['no signed-in user', null],
  ])('disables and drops queued reports for %s', async (_label, uid) => {
    mockStore.set('setting:analytics', '1')
    mockStore.set('setting:analyticsOwner', 'A')

    await initializeCrashlytics(uid)

    expect(setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(instance, false)
    expect(deleteUnsentReports).toHaveBeenCalledWith(instance)
  })

  it('swallows a deleteUnsentReports rejection', async () => {
    jest.mocked(deleteUnsentReports).mockRejectedValue(new Error('boom'))
    await expect(initializeCrashlytics(null)).resolves.toBeUndefined()
    expect(setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(instance, false)
  })

  it('clearCrashlyticsContext blanks the context attribute', async () => {
    await clearCrashlyticsContext()
    expect(setAttribute).toHaveBeenCalledWith(instance, 'context', '')
  })
})

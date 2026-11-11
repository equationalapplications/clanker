const mockStore = new Map<string, string>()
const mockCalls: string[] = []

jest.mock('~/utilities/kvStorage', () => ({
  Storage: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => {
      mockStore.set(key, value)
    },
  },
}))

const mockSetCrashlyticsEnabled = jest.fn(async (v: boolean) => {
  mockCalls.push(`crashlyticsEnabled:${v}`)
})
const mockSetCrashlyticsUserId = jest.fn(async (v: string | null) => {
  mockCalls.push(`crashlyticsUserId:${v}`)
})
const mockClearCrashlyticsContext = jest.fn(async () => {
  mockCalls.push('crashlyticsContext:clear')
})
const mockSetAnalyticsEnabled = jest.fn(async (v: boolean) => {
  mockCalls.push(`analyticsEnabled:${v}`)
})
const mockSetUserId = jest.fn(async (v: string | null) => {
  mockCalls.push(`analyticsUserId:${v}`)
})

jest.mock('~/services/crashlyticsService', () => ({
  setCrashlyticsEnabled: (v: boolean) => mockSetCrashlyticsEnabled(v),
  setCrashlyticsUserId: (v: string | null) => mockSetCrashlyticsUserId(v),
  clearCrashlyticsContext: () => mockClearCrashlyticsContext(),
}))

jest.mock('~/services/analyticsService', () => ({
  setAnalyticsEnabled: (v: boolean) => mockSetAnalyticsEnabled(v),
  setUserId: (v: string | null) => mockSetUserId(v),
}))

import {
  __resetAnalyticsConsentForTests,
  isAnalyticsConsentActive,
  reconcileAnalyticsConsent,
  resetAnalyticsConsent,
  setAnalyticsChoice,
  subscribeAnalyticsConsent,
} from '~/services/analyticsConsent'

const VALUE = 'setting:analytics'
const OWNER = 'setting:analyticsOwner'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('analyticsConsent (native)', () => {
  beforeEach(() => {
    mockStore.clear()
    mockCalls.length = 0
    jest.clearAllMocks()
    __resetAnalyticsConsentForTests()
  })

  it('clears ids and the context attribute before turning collection off', async () => {
    mockStore.set(VALUE, '1')
    mockStore.set(OWNER, 'A')
    reconcileAnalyticsConsent('B')
    await flush()

    const firstDisable = mockCalls.indexOf('crashlyticsEnabled:false')
    expect(firstDisable).toBeGreaterThan(-1)
    for (const call of [
      'crashlyticsUserId:null',
      'analyticsUserId:null',
      'crashlyticsContext:clear',
    ]) {
      expect(mockCalls.indexOf(call)).toBeGreaterThan(-1)
      expect(mockCalls.indexOf(call)).toBeLessThan(firstDisable)
    }
  })

  it('a mismatched owner clears storage and notifies listeners', () => {
    mockStore.set(VALUE, '1')
    mockStore.set(OWNER, 'A')
    const listener = jest.fn()
    subscribeAnalyticsConsent(listener)

    reconcileAnalyticsConsent('B')

    expect(mockStore.get(VALUE)).toBe('')
    expect(mockStore.get(OWNER)).toBe('')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('the owner resumes collection and gets their uid attached after enabling', async () => {
    mockStore.set(VALUE, '1')
    mockStore.set(OWNER, 'A')
    const listener = jest.fn()
    subscribeAnalyticsConsent(listener)

    reconcileAnalyticsConsent('A')
    await flush()

    expect(listener).not.toHaveBeenCalled()
    expect(isAnalyticsConsentActive()).toBe(true)
    expect(mockCalls.indexOf('crashlyticsEnabled:true')).toBeLessThan(
      mockCalls.indexOf('crashlyticsUserId:A'),
    )
    expect(mockSetUserId).toHaveBeenCalledWith('A')
  })

  it('reconcile(null) suspends collection but leaves storage alone', async () => {
    mockStore.set(VALUE, '1')
    mockStore.set(OWNER, 'A')
    const listener = jest.fn()
    subscribeAnalyticsConsent(listener)

    reconcileAnalyticsConsent(null)
    await flush()

    expect(mockStore.get(VALUE)).toBe('1')
    expect(mockStore.get(OWNER)).toBe('A')
    expect(listener).not.toHaveBeenCalled()
    expect(isAnalyticsConsentActive()).toBe(false)
    expect(mockSetCrashlyticsEnabled).toHaveBeenCalledWith(false)
  })

  it('setAnalyticsChoice records the choice for the signed-in subject', async () => {
    reconcileAnalyticsConsent('A')
    const listener = jest.fn()
    subscribeAnalyticsConsent(listener)

    setAnalyticsChoice(true)
    await flush()

    expect(mockStore.get(VALUE)).toBe('1')
    expect(mockStore.get(OWNER)).toBe('A')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(mockSetCrashlyticsEnabled).toHaveBeenLastCalledWith(true)
    expect(isAnalyticsConsentActive()).toBe(true)
  })

  it('setAnalyticsChoice with no subject writes ownerless and stays off', async () => {
    setAnalyticsChoice(true)
    await flush()

    expect(mockStore.get(VALUE)).toBe('1')
    expect(mockStore.get(OWNER)).toBe('')
    expect(mockSetCrashlyticsEnabled).not.toHaveBeenCalledWith(true)
    expect(isAnalyticsConsentActive()).toBe(false)
  })

  it('resetAnalyticsConsent forgets the choice, turns collection off and notifies', async () => {
    mockStore.set(VALUE, '1')
    mockStore.set(OWNER, 'A')
    reconcileAnalyticsConsent('A')
    const listener = jest.fn()
    subscribeAnalyticsConsent(listener)

    await resetAnalyticsConsent()

    expect(mockStore.get(VALUE)).toBe('')
    expect(mockStore.get(OWNER)).toBe('')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(mockSetCrashlyticsEnabled).toHaveBeenLastCalledWith(false)
    expect(mockSetAnalyticsEnabled).toHaveBeenLastCalledWith(false)
    expect(isAnalyticsConsentActive()).toBe(false)
  })

  it('applies SDK updates in order, so a later grant is not undone by an earlier off', async () => {
    reconcileAnalyticsConsent('A') // nothing stored -> off
    setAnalyticsChoice(true) // immediately after -> on
    await flush()
    await flush()

    expect(mockSetCrashlyticsEnabled).toHaveBeenLastCalledWith(true)
    expect(mockSetAnalyticsEnabled).toHaveBeenLastCalledWith(true)
  })

  it('unsubscribe stops notifications', () => {
    const listener = jest.fn()
    const unsubscribe = subscribeAnalyticsConsent(listener)
    unsubscribe()
    setAnalyticsChoice(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('is a no-op on web', async () => {
    ;(globalThis as any).__setJestPlatformOS('web')
    try {
      mockStore.set(VALUE, '1')
      mockStore.set(OWNER, 'A')
      reconcileAnalyticsConsent('B')
      setAnalyticsChoice(true)
      await resetAnalyticsConsent()
      await flush()

      expect(mockStore.get(VALUE)).toBe('1')
      expect(mockStore.get(OWNER)).toBe('A')
      expect(mockCalls).toEqual([])
      expect(isAnalyticsConsentActive()).toBe(false)
    } finally {
      ;(globalThis as any).__resetJestPlatformOS()
    }
  })
})

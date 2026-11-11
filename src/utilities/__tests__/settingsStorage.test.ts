import {
  clearAnalyticsConsent,
  clearSettings,
  hasStoredSetting,
  resolveAnalyticsConsent,
  writeAnalyticsChoice,
} from '../settingsStorage'

const mockStore = new Map<string, string>()
const mockGetItemSync = jest.fn((key: string) => mockStore.get(key) ?? null)
const mockSetItemSync = jest.fn((key: string, value: string) => {
  mockStore.set(key, value)
})

jest.mock('~/utilities/kvStorage', () => ({
  Storage: {
    getItemSync: (key: string) => mockGetItemSync(key),
    setItemSync: (key: string, value: string) => mockSetItemSync(key, value),
  },
}))

const VALUE = 'setting:analytics'
const OWNER = 'setting:analyticsOwner'

describe('hasStoredSetting', () => {
  beforeEach(() => {
    mockStore.clear()
    mockGetItemSync.mockClear()
  })

  it('is false when the setting was never written', () => {
    expect(hasStoredSetting('analytics')).toBe(false)
  })

  it('is true for an explicit "0" or "1"', () => {
    mockStore.set('setting:analytics', '0')
    expect(hasStoredSetting('analytics')).toBe(true)
    mockStore.set('setting:analytics', '1')
    expect(hasStoredSetting('analytics')).toBe(true)
  })

  // Sign-out blanks every setting to '', which must re-open the consent prompt.
  it('is false again after clearSettings()', () => {
    mockStore.set('setting:analytics', '1')
    clearSettings()
    expect(hasStoredSetting('analytics')).toBe(false)
  })

  it('treats unreadable storage as decided so it cannot re-prompt every launch', () => {
    mockGetItemSync.mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    expect(hasStoredSetting('analytics')).toBe(true)
  })
})

describe('resolveAnalyticsConsent', () => {
  beforeEach(() => {
    mockStore.clear()
    mockGetItemSync.mockClear()
    mockSetItemSync.mockClear()
  })

  // [stored value, stored owner, signed-in uid, expected result, expected value, expected owner]
  const rows: [
    string | null,
    string | null,
    string | null,
    boolean,
    string | null,
    string | null,
  ][] = [
    // No one signed in: inactive, record kept so the owner resumes without a re-prompt.
    ['1', 'A', null, false, '1', 'A'],
    ['0', 'A', null, false, '0', 'A'],
    // Owner signed in: the stored value decides.
    ['1', 'A', 'A', true, '1', 'A'],
    ['0', 'A', 'A', false, '0', 'A'],
    // Another account: blank so that account is asked.
    ['1', 'A', 'B', false, '', ''],
    ['0', 'A', 'B', false, '', ''],
    // Ownerless legacy: a decline is adopted, a grant must be re-proven.
    ['0', null, 'A', false, '0', 'A'],
    ['0', '', 'A', false, '0', 'A'],
    ['1', null, 'A', false, '', null],
    // Unset: nothing to reconcile.
    [null, null, 'A', false, null, null],
    ['', 'A', 'B', false, '', 'A'],
  ]

  it.each(rows)(
    'value=%p owner=%p uid=%p -> %p (stores %p / %p)',
    (value, owner, uid, expected, nextValue, nextOwner) => {
      if (value !== null) mockStore.set(VALUE, value)
      if (owner !== null) mockStore.set(OWNER, owner)

      expect(resolveAnalyticsConsent(uid)).toBe(expected)
      expect(mockStore.get(VALUE) ?? null).toBe(nextValue)
      expect(mockStore.get(OWNER) ?? null).toBe(nextOwner)
    },
  )

  it('is inactive and writes nothing when storage throws', () => {
    mockGetItemSync.mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    expect(resolveAnalyticsConsent('A')).toBe(false)
    expect(mockSetItemSync).not.toHaveBeenCalled()
  })
})

describe('writeAnalyticsChoice / clearAnalyticsConsent', () => {
  beforeEach(() => {
    mockStore.clear()
    mockSetItemSync.mockClear()
  })

  it('writes the value before the owner so a torn write fails toward a re-prompt', () => {
    writeAnalyticsChoice(true, 'A')
    expect(mockSetItemSync.mock.calls).toEqual([
      [VALUE, '1'],
      [OWNER, 'A'],
    ])
  })

  it('writes an ownerless choice when no one is signed in', () => {
    writeAnalyticsChoice(false, null)
    expect(mockStore.get(VALUE)).toBe('0')
    expect(mockStore.get(OWNER)).toBe('')
  })

  it('clearAnalyticsConsent blanks the value and the owner', () => {
    writeAnalyticsChoice(true, 'A')
    clearAnalyticsConsent()
    expect(mockStore.get(VALUE)).toBe('')
    expect(mockStore.get(OWNER)).toBe('')
  })

  it('clearSettings blanks the owner too', () => {
    writeAnalyticsChoice(true, 'A')
    clearSettings()
    expect(mockStore.get(OWNER)).toBe('')
  })
})

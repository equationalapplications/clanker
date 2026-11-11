import { clearSettings, hasStoredSetting } from '../settingsStorage'

const mockStore = new Map<string, string>()
const mockGetItemSync = jest.fn((key: string) => mockStore.get(key) ?? null)

jest.mock('~/utilities/kvStorage', () => ({
  Storage: {
    getItemSync: (key: string) => mockGetItemSync(key),
    setItemSync: (key: string, value: string) => {
      mockStore.set(key, value)
    },
  },
}))

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

import {
  CONSENT_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
} from '~/utilities/cookieConsentTypes'
import {
  readConsent,
  writeConsent,
  clearConsent,
} from '~/utilities/cookieConsentStorage.web'

function setItem(value: string) {
  window.localStorage.setItem(CONSENT_STORAGE_KEY, value)
}

describe('cookieConsentStorage.web', () => {
  beforeEach(() => window.localStorage.clear())

  it('returns null when storage is empty', () => {
    expect(readConsent()).toBeNull()
  })

  it('round-trips a valid record', () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    try {
      const now = new Date('2026-01-01T00:00:00Z').toISOString()
      const record = {
        policyVersion: COOKIE_POLICY_VERSION,
        consentedAt: now,
        expiresAt: new Date('2027-01-01T00:00:00Z').toISOString(),
        regionMode: 'opt-in-strict' as const,
        choices: {
          necessary: true,
          analytics: false,
          marketing: false,
          preferences: false,
        },
      }
      writeConsent(record)
      expect(readConsent()).toEqual(record)
    } finally {
      jest.useRealTimers()
    }
  })

  it('returns null when JSON is corrupt', () => {
    setItem('{not json')
    expect(readConsent()).toBeNull()
  })

  it('treats wrong policyVersion as stale (null)', () => {
    setItem(
      JSON.stringify({
        policyVersion: 0,
        consentedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2027-01-01T00:00:00Z',
        regionMode: 'opt-in-strict',
        choices: { necessary: true, analytics: true, marketing: true, preferences: true },
      }),
    )
    expect(readConsent()).toBeNull()
  })

  it('treats expired record as null', () => {
    setItem(
      JSON.stringify({
        policyVersion: COOKIE_POLICY_VERSION,
        consentedAt: '2024-01-01T00:00:00Z',
        expiresAt: '2025-01-01T00:00:00Z',
        regionMode: 'opt-in-strict',
        choices: { necessary: true, analytics: true, marketing: true, preferences: true },
      }),
    )
    expect(readConsent()).toBeNull()
  })

  it('clears storage', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, '{}')
    clearConsent()
    expect(window.localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull()
  })
})

import { PRIVACY } from '../src/config/privacyConfig'

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

describe('privacyConfig', () => {
  it('contains the expected updated privacy policy metadata and content', () => {
    const normalizedPrivacy = normalizeWhitespace(PRIVACY.privacy)

    expect(PRIVACY.version).toBe('1.11')
    expect(PRIVACY.lastUpdated).toBe('July 25, 2026')
    expect(normalizedPrivacy).toContain('Business Transfers')
    expect(normalizedPrivacy).toContain(
      'merger, acquisition, financing, reorganization, bankruptcy, or sale of all or a portion of our assets'
    )
    expect(normalizedPrivacy).toContain('Crash Reporting and Diagnostics')
    expect(normalizedPrivacy).toContain('requires explicit opt-in')
    expect(normalizedPrivacy).toContain('We use Stripe, a third-party payment processor')
    expect(normalizedPrivacy).toContain('Profile page')
    expect(normalizedPrivacy).toContain('info@equationalapplications.com')
  })
})

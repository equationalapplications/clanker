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
    expect(normalizedPrivacy).toContain(
      'Any such successor will remain bound by the commitments made in this privacy policy with respect to information transferred'
    )
    expect(normalizedPrivacy).toContain(
      'We will provide notice within the App or by email before any personal information becomes subject to a materially different privacy policy'
    )
    expect(normalizedPrivacy).toContain('unless and until you are notified of and consent to')
    expect(normalizedPrivacy).toContain('Crash Reporting and Diagnostics')
    expect(normalizedPrivacy).toContain('requires explicit opt-in')
    expect(normalizedPrivacy).toContain('We use Stripe, a third-party payment processor')
    expect(normalizedPrivacy).toContain('Profile page')
    expect(normalizedPrivacy).toContain('info@equationalapplications.com')
  })
})

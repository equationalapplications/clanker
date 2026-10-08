const mockRecordTermsDecline = jest.fn()
const mockShowAlert = jest.fn()
const mockLogEvent = jest.fn()

jest.mock('~/machines/termsMachine', () => ({
  recordTermsDecline: (...args: unknown[]) => mockRecordTermsDecline(...args),
}))

jest.mock('~/utilities/showAlert', () => ({
  showAlert: (...args: unknown[]) => mockShowAlert(...args),
}))

jest.mock('~/services/analyticsService', () => ({
  logEvent: (...args: unknown[]) => mockLogEvent(...args),
}))

const {
  termsDeclineWindowEnd,
  termsDeclineUsesPaidPeriod,
  handleTermsDecline,
  handleTermsCanceled,
  TERMS_DECLINE_FALLBACK_WINDOW_MS,
} = require('~/utilities/termsDecline')

const NOW = new Date('2026-10-08T12:00:00.000Z')

function subscription(nextExpiryDate: string | null) {
  return { nextExpiryDate } as any
}

describe('termsDeclineWindowEnd (issue #810)', () => {
  it('uses the subscription period end when billing provides a future one', () => {
    const periodEnd = '2026-10-20T00:00:00.000Z'
    expect(termsDeclineWindowEnd(subscription(periodEnd), NOW)).toBe(periodEnd)
  })

  it.each([
    ['a past period end', '2026-10-01T00:00:00.000Z'],
    ['no period end', null],
    ['an unparseable period end', 'not-a-date'],
  ])('falls back to 24h from now given %s', (_label, nextExpiryDate) => {
    expect(termsDeclineWindowEnd(subscription(nextExpiryDate), NOW)).toBe(
      new Date(NOW.getTime() + TERMS_DECLINE_FALLBACK_WINDOW_MS).toISOString(),
    )
  })
})

describe('termsDeclineUsesPaidPeriod (finding: notice must match the real window)', () => {
  it('is true only for a future parseable period end', () => {
    expect(termsDeclineUsesPaidPeriod(subscription('2026-10-20T00:00:00.000Z'), NOW)).toBe(true)
    expect(termsDeclineUsesPaidPeriod(subscription('2026-10-01T00:00:00.000Z'), NOW)).toBe(false)
    expect(termsDeclineUsesPaidPeriod(subscription(null), NOW)).toBe(false)
    expect(termsDeclineUsesPaidPeriod(subscription('not-a-date'), NOW)).toBe(false)
    expect(termsDeclineUsesPaidPeriod(null, NOW)).toBe(false)
  })
})

describe('handleTermsDecline (issue #810)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function serviceWith(context: {
    subscription: { nextExpiryDate: string | null } | null
    userUid?: string | null
    isUpdate?: boolean
  }) {
    return {
      getSnapshot: () => ({
        context: { userUid: 'firebase-u1', isUpdate: true, ...context },
      }),
      send: jest.fn(),
    }
  }

  it('records the window, sends DECLINE_TERMS with it, and shows the paid-period notice', () => {
    const periodEnd = '2026-10-20T00:00:00.000Z'
    const service = serviceWith({ subscription: { nextExpiryDate: periodEnd } })

    handleTermsDecline(service as any)

    const now = mockRecordTermsDecline.mock.calls[0][2] as Date
    expect(mockRecordTermsDecline).toHaveBeenCalledWith(periodEnd, 'firebase-u1', expect.any(Date))
    expect(now.getTime()).toBeGreaterThan(Date.now() - 60_000)
    expect(service.send).toHaveBeenCalledWith({ type: 'DECLINE_TERMS', windowEnd: periodEnd })
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Terms declined',
      expect.stringContaining("until the end of the period you've already paid for"),
    )
    expect(mockLogEvent).toHaveBeenCalledWith('terms_declined', { window: 'paid_period' })
  })

  it('falls back to the 24h window, says so in the notice, and tags the telemetry', () => {
    const service = serviceWith({ subscription: null })

    handleTermsDecline(service as any)

    const windowEnd = service.send.mock.calls[0][0].windowEnd as string
    const drift = Math.abs(Date.parse(windowEnd) - (Date.now() + TERMS_DECLINE_FALLBACK_WINDOW_MS))
    expect(drift).toBeLessThan(60_000)
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Terms declined',
      expect.stringContaining('for the next 24 hours'),
    )
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Terms declined',
      expect.not.stringContaining("period you've already paid for"),
    )
    expect(mockLogEvent).toHaveBeenCalledWith('terms_declined', { window: 'fallback_24h' })
  })
})

describe('handleTermsCanceled (finding: one cancel policy, two surfaces)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function service(isUpdate: boolean, termsVersion: string | null) {
    return {
      getSnapshot: () => ({
        context: {
          subscription:
            termsVersion === null
              ? null
              : { termsVersion, nextExpiryDate: '2026-10-20T00:00:00.000Z' },
          userUid: 'firebase-u1',
          isUpdate,
        },
      }),
      send: jest.fn(),
    }
  }

  it('routes an eligible update decline to notice-then-enforce, skipping the age gate', () => {
    const termsService = service(true, '2.5')
    const authService = { send: jest.fn() }
    const verifyAge = jest.fn()

    handleTermsCanceled(termsService as any, authService as any, verifyAge)

    expect(verifyAge).not.toHaveBeenCalled()
    expect(authService.send).not.toHaveBeenCalled()
    expect(mockRecordTermsDecline).toHaveBeenCalledWith(
      expect.any(String),
      'firebase-u1',
      expect.any(Date),
    )
    expect(termsService.send).toHaveBeenCalledWith({
      type: 'DECLINE_TERMS',
      windowEnd: expect.any(String),
    })
  })

  it.each([
    ['a pre-gate version', '2.4'],
    ['an older version', '1.9'],
    ['no previous version', null],
    ['a malformed version', 'garbage'],
    ['a suffixed version', '2.5-beta'],
  ])('routes a legacy update decline (%s) through the age gate instead', (_label, termsVersion) => {
    // CodeRabbit round on PR #812: declining straight into notice-then-enforce would let
    // an account that accepted terms BEFORE the age gate keep access without ever
    // reaching the age-rejection path. Same rule as acceptance, fail closed.
    const termsService = service(true, termsVersion)
    const authService = { send: jest.fn() }
    const verifyAge = jest.fn()

    handleTermsCanceled(termsService as any, authService as any, verifyAge)

    expect(verifyAge).toHaveBeenCalledTimes(1)
    expect(termsService.send).not.toHaveBeenCalled()
    expect(mockRecordTermsDecline).not.toHaveBeenCalled()
    expect(mockShowAlert).not.toHaveBeenCalled()
    expect(authService.send).not.toHaveBeenCalled()
  })

  it.each(['2.10', '3.0'])('treats a previous version of %s as age-verified', (termsVersion) => {
    const termsService = service(true, termsVersion)
    const authService = { send: jest.fn() }
    const verifyAge = jest.fn()

    handleTermsCanceled(termsService as any, authService as any, verifyAge)

    expect(verifyAge).not.toHaveBeenCalled()
    expect(termsService.send).toHaveBeenCalledWith({
      type: 'DECLINE_TERMS',
      windowEnd: expect.any(String),
    })
  })

  it('signs a legacy update decline out while Play verification blocks the age flow', () => {
    // PR #812 review: no age signal can be read under VERIFICATION_REQUIRED, so re-running
    // the age flow would loop — sign-out keeps a way off the blocking screen.
    const termsService = service(true, '2.4')
    const authService = { send: jest.fn() }
    const verifyAge = jest.fn()

    handleTermsCanceled(termsService as any, authService as any, verifyAge, true)

    expect(authService.send).toHaveBeenCalledWith({ type: 'SIGN_OUT' })
    expect(verifyAge).not.toHaveBeenCalled()
    expect(termsService.send).not.toHaveBeenCalled()
  })

  it('signs a first-time decline out (no prior Terms to fall back on)', () => {
    const termsService = service(false, null)
    const authService = { send: jest.fn() }
    const verifyAge = jest.fn()

    handleTermsCanceled(termsService as any, authService as any, verifyAge)

    expect(authService.send).toHaveBeenCalledWith({ type: 'SIGN_OUT' })
    expect(verifyAge).not.toHaveBeenCalled()
    expect(termsService.send).not.toHaveBeenCalled()
    expect(mockRecordTermsDecline).not.toHaveBeenCalled()
  })
})

const mockRecordTermsDecline = jest.fn()
const mockShowAlert = jest.fn()

jest.mock('~/machines/termsMachine', () => ({
  recordTermsDecline: (...args: unknown[]) => mockRecordTermsDecline(...args),
}))

jest.mock('~/utilities/showAlert', () => ({
  showAlert: (...args: unknown[]) => mockShowAlert(...args),
}))

const {
  termsDeclineWindowEnd,
  handleTermsDecline,
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

describe('handleTermsDecline (issue #810)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  function serviceWith(subscriptionValue: { nextExpiryDate: string | null } | null) {
    return {
      getSnapshot: () => ({ context: { subscription: subscriptionValue } }),
      send: jest.fn(),
    }
  }

  it('records the window, sends DECLINE_TERMS with it, and shows the notice', () => {
    const periodEnd = '2026-10-20T00:00:00.000Z'
    const service = serviceWith({ nextExpiryDate: periodEnd })

    handleTermsDecline(service as any)

    const now = mockRecordTermsDecline.mock.calls[0][1] as Date
    expect(mockRecordTermsDecline).toHaveBeenCalledWith(periodEnd, expect.any(Date))
    expect(now.getTime()).toBeGreaterThan(Date.now() - 60_000)
    expect(service.send).toHaveBeenCalledWith({ type: 'DECLINE_TERMS', windowEnd: periodEnd })
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Terms declined',
      expect.stringContaining('keep using Clanker under the previous Terms'),
    )
  })

  it('falls back to the 24h window when no period end is available', () => {
    const service = serviceWith(null)

    handleTermsDecline(service as any)

    const windowEnd = service.send.mock.calls[0][0].windowEnd as string
    const drift = Math.abs(Date.parse(windowEnd) - (Date.now() + TERMS_DECLINE_FALLBACK_WINDOW_MS))
    expect(drift).toBeLessThan(60_000)
  })
})

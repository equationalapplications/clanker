describe('checkoutStateStore.web', () => {
  const uid = 'user-a'

  beforeEach(() => {
    jest.resetModules()
    if (typeof localStorage !== 'undefined') {
      localStorage.clear()
    }
  })

  it('transitions pending to succeeded and pending to cancelled', () => {
    const { upsertCheckoutAttempt, readCheckoutAttempts } = require('~/utilities/checkoutStateStore.web')

    const base = {
      attemptId: 'attempt-1',
      productType: 'payg',
      at: '2026-04-22T10:00:00.000Z',
      sourceTabId: 'tab-a',
      schemaVersion: 1 as const,
    }

    upsertCheckoutAttempt(uid, { ...base, status: 'pending' })
    upsertCheckoutAttempt(uid, {
      ...base,
      status: 'succeeded',
      at: '2026-04-22T10:01:00.000Z',
    })

    expect(readCheckoutAttempts(uid)['attempt-1']?.status).toBe('succeeded')

    upsertCheckoutAttempt(uid, {
      ...base,
      attemptId: 'attempt-2',
      status: 'pending',
      at: '2026-04-22T10:02:00.000Z',
    })
    upsertCheckoutAttempt(uid, {
      ...base,
      attemptId: 'attempt-2',
      status: 'cancelled',
      at: '2026-04-22T10:03:00.000Z',
    })

    expect(readCheckoutAttempts(uid)['attempt-2']?.status).toBe('cancelled')
  })

  it('ignores an older event for the same attempt', () => {
    const { upsertCheckoutAttempt, readCheckoutAttempts } = require('~/utilities/checkoutStateStore.web')

    upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-3',
      productType: 'payg',
      status: 'pending',
      at: '2026-04-22T10:05:00.000Z',
      sourceTabId: 'tab-z',
      schemaVersion: 1,
    })

    const result = upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-3',
      productType: 'payg',
      status: 'cancelled',
      at: '2026-04-22T10:04:59.000Z',
      sourceTabId: 'tab-a',
      schemaVersion: 1,
    })

    expect(result.applied).toBe(false)
    expect(readCheckoutAttempts(uid)['attempt-3']?.status).toBe('pending')
  })

  it('uses lexicographic sourceTabId tie-break for equal timestamps', () => {
    const { upsertCheckoutAttempt, readCheckoutAttempts } = require('~/utilities/checkoutStateStore.web')

    upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-4',
      productType: 'payg',
      status: 'pending',
      at: '2026-04-22T10:06:00.000Z',
      sourceTabId: 'tab-b',
      schemaVersion: 1,
    })

    const lowerTie = upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-4',
      productType: 'payg',
      status: 'cancelled',
      at: '2026-04-22T10:06:00.000Z',
      sourceTabId: 'tab-a',
      schemaVersion: 1,
    })

    expect(lowerTie.applied).toBe(false)
    expect(readCheckoutAttempts(uid)['attempt-4']?.status).toBe('pending')

    const higherTie = upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-4',
      productType: 'payg',
      status: 'succeeded',
      at: '2026-04-22T10:06:00.000Z',
      sourceTabId: 'tab-z',
      schemaVersion: 1,
    })

    expect(higherTie.applied).toBe(true)
    expect(readCheckoutAttempts(uid)['attempt-4']?.status).toBe('succeeded')
  })

  it('allows same-tab overwrite for equal timestamps', () => {
    const { upsertCheckoutAttempt, readCheckoutAttempts } = require('~/utilities/checkoutStateStore.web')

    upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-4b',
      productType: 'payg',
      status: 'pending',
      at: '2026-04-22T10:06:00.000Z',
      sourceTabId: 'tab-a',
      schemaVersion: 1,
    })

    const overwrite = upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-4b',
      productType: 'payg',
      status: 'cancelled',
      at: '2026-04-22T10:06:00.000Z',
      sourceTabId: 'tab-a',
      schemaVersion: 1,
    })

    expect(overwrite.applied).toBe(true)
    expect(readCheckoutAttempts(uid)['attempt-4b']?.status).toBe('cancelled')
  })

  it('rejects records with invalid status or invalid timestamp', () => {
    const { upsertCheckoutAttempt, readCheckoutAttempts } = require('~/utilities/checkoutStateStore.web')

    const invalidStatus = upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-invalid-status',
      productType: 'payg',
      status: 'not-a-status',
      at: '2026-04-22T10:00:00.000Z',
      sourceTabId: 'tab-a',
      schemaVersion: 1,
    })

    const invalidTimestamp = upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-invalid-at',
      productType: 'payg',
      status: 'pending',
      at: 'not-a-date',
      sourceTabId: 'tab-a',
      schemaVersion: 1,
    })

    expect(invalidStatus.applied).toBe(false)
    expect(invalidTimestamp.applied).toBe(false)
    expect(readCheckoutAttempts(uid)['attempt-invalid-status']).toBeUndefined()
    expect(readCheckoutAttempts(uid)['attempt-invalid-at']).toBeUndefined()
  })

  it('expires stale pending attempts older than TTL', () => {
    const { CHECKOUT_TTL_MS, expireStalePendingAttempts, readCheckoutAttempts, upsertCheckoutAttempt } =
      require('~/utilities/checkoutStateStore.web')

    const now = Date.parse('2026-04-22T11:00:00.000Z')
    const staleAt = new Date(now - CHECKOUT_TTL_MS - 1).toISOString()

    upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-5',
      productType: 'payg',
      status: 'pending',
      at: staleAt,
      sourceTabId: 'tab-a',
      schemaVersion: 1,
    })

    const expired = expireStalePendingAttempts(uid, now, 'tab-cleaner')

    expect(expired).toHaveLength(1)
    expect(expired[0].status).toBe('expired')
    expect(readCheckoutAttempts(uid)['attempt-5']?.status).toBe('expired')
  })

  it('ignores unknown schemaVersion records silently', () => {
    const { upsertCheckoutAttempt, readCheckoutAttempts } = require('~/utilities/checkoutStateStore.web')

    const result = upsertCheckoutAttempt(uid, {
      attemptId: 'attempt-6',
      productType: 'payg',
      status: 'pending',
      at: '2026-04-22T10:00:00.000Z',
      sourceTabId: 'tab-a',
      schemaVersion: 2,
    })

    expect(result.applied).toBe(false)
    expect(readCheckoutAttempts(uid)['attempt-6']).toBeUndefined()
  })

  it('keeps uid keyspaces isolated', () => {
    const { readCheckoutAttempts, upsertCheckoutAttempt } = require('~/utilities/checkoutStateStore.web')

    upsertCheckoutAttempt('user-a', {
      attemptId: 'attempt-7',
      productType: 'payg',
      status: 'pending',
      at: '2026-04-22T10:00:00.000Z',
      sourceTabId: 'tab-a',
      schemaVersion: 1,
    })

    expect(readCheckoutAttempts('user-a')['attempt-7']?.status).toBe('pending')
    expect(readCheckoutAttempts('user-b')['attempt-7']).toBeUndefined()
  })

  it('is safe to import under SSR with no window', () => {
    const originalWindow = (globalThis as { window?: Window }).window

    try {
      ;(globalThis as { window?: Window }).window = undefined
      jest.isolateModules(() => {
        expect(() => require('~/utilities/checkoutStateStore.web')).not.toThrow()
      })
    } finally {
      ;(globalThis as { window?: Window }).window = originalWindow
    }
  })
})

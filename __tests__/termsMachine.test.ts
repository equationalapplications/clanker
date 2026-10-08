import { createActor, waitFor } from 'xstate'
import { TERMS } from '../src/config/termsConfig'

const mockAcceptTermsFn = jest.fn()
const mockLogEvent = jest.fn()
const mockStorageGetItemSync = jest.fn().mockReturnValue(null)
const mockStorageSetItemSync = jest.fn()

jest.mock('../src/services/apiClient', () => ({
  acceptTermsFn: mockAcceptTermsFn,
}))

jest.mock('../src/services/analyticsService', () => ({
  logEvent: mockLogEvent,
}))

jest.mock('../src/utilities/kvStorage', () => ({
  Storage: {
    getItemSync: (...args: unknown[]) => mockStorageGetItemSync(...args),
    setItemSync: (...args: unknown[]) => mockStorageSetItemSync(...args),
  },
}))

const { termsMachine } = require('../src/machines/termsMachine')

const WAIT_OPTS = { timeout: 2000 }

function signedInAuthState(userId = 'db-user-1', subscription = {}) {
  return {
    matches: (value: string) => value === 'signedIn',
    context: {
      dbUser: { id: userId },
      subscription: {
        termsVersion: null,
        termsAcceptedAt: null,
        ...subscription,
      },
    },
  }
}

describe('termsMachine', () => {
  beforeEach(() => {
    mockAcceptTermsFn.mockReset()
    mockLogEvent.mockReset()
    mockAcceptTermsFn.mockResolvedValue({ data: { success: true } })
  })

  it('goes to accepted when current terms are already accepted', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: TERMS.version,
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)

    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(actor.getSnapshot().context.isUpdate).toBe(false)
    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })

  it('goes to acceptanceRequired with isUpdate=true when terms version is stale', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: '0.0.1',
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.isUpdate).toBe(true)
    actor.stop()
  })

  it('goes to acceptanceRequired with isUpdate=false when terms were never accepted', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', { termsVersion: null, termsAcceptedAt: null }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.isUpdate).toBe(false)
    actor.stop()
  })

  it('accepts terms successfully from acceptanceRequired', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', { termsVersion: null, termsAcceptedAt: null }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(mockAcceptTermsFn).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })

  it('logs terms_accepted when acceptance succeeds', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', { termsVersion: null, termsAcceptedAt: null }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(mockLogEvent).toHaveBeenCalledWith('terms_accepted', { is_update: false })
    actor.stop()
  })

  it('returns to acceptanceRequired and stores error when accept write fails', async () => {
    mockAcceptTermsFn.mockRejectedValue(new Error('write failed'))

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', { termsVersion: null, termsAcceptedAt: null }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.error?.message).toContain('write failed')
    actor.stop()
  })
})

describe('termsMachine decline (notice-then-enforce, issue #810)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockStorageGetItemSync.mockReturnValue(null)
  })

  it('DECLINE_TERMS leaves the blocking state without an acceptance write or sign-out', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: '2.3',
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    const windowEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    actor.send({ type: 'DECLINE_TERMS', windowEnd } as any)

    // Not blocked anymore, but NOT accepted either
    expect(actor.getSnapshot().matches('declined')).toBe(true)
    expect(actor.getSnapshot().matches('accepted')).toBe(false)
    expect(actor.getSnapshot().context.declinedUntil).toBe(windowEnd)
    // Decline records no acceptance with the backend
    expect(mockAcceptTermsFn).not.toHaveBeenCalled()
    // Stored termsVersion stays stale — enforcement relies on it at next check
    expect(actor.getSnapshot().context.subscription?.termsVersion).toBe('2.3')
    actor.stop()
  })

  it('suppresses re-blocking on the next check while the decline window is active', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockStorageGetItemSync.mockReturnValue(
      JSON.stringify({ termsVersion: TERMS.version, suppressUntil: future }),
    )

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: '2.3',
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)

    await waitFor(actor, (state) => state.matches('declined'), WAIT_OPTS)
    // Suppression came from the persisted record, not a session decline
    expect(actor.getSnapshot().context.declinedUntil).toBeNull()
    actor.stop()
  })

  it('decline suppression never satisfies the genuine-acceptance state', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockStorageGetItemSync.mockReturnValue(
      JSON.stringify({ termsVersion: TERMS.version, suppressUntil: future }),
    )

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: '2.3',
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)

    // Regression (review finding on PR #811): suppression used to land in 'accepted',
    // which the UI effects treat as a real acceptance — fabricating one and wiping the
    // decline record. It must rest in 'declined' instead.
    await waitFor(actor, (state) => state.matches('declined'), WAIT_OPTS)
    expect(actor.getSnapshot().matches('accepted')).toBe(false)
    actor.stop()
  })

  it('signing out clears the persisted decline record', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: '2.3',
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    const windowEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    actor.send({ type: 'DECLINE_TERMS', windowEnd } as any)
    mockStorageSetItemSync.mockClear()

    // A different account signing in on this device must not inherit the window
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: { matches: () => false, context: { subscription: null } },
    } as any)
    await waitFor(actor, (state) => state.matches('idle'), WAIT_OPTS)

    expect(mockStorageSetItemSync).toHaveBeenCalledWith('terms:declined', '')
    actor.stop()
  })

  it('re-prompts (acceptanceRequired) once the decline window has expired', async () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString()
    mockStorageGetItemSync.mockReturnValue(
      JSON.stringify({ termsVersion: TERMS.version, suppressUntil: past }),
    )

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: '2.3',
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.isUpdate).toBe(true)
    actor.stop()
  })

  it('a decline record for an older terms version does not suppress a newer bump', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    mockStorageGetItemSync.mockReturnValue(
      JSON.stringify({ termsVersion: '1.9', suppressUntil: future }),
    )

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: '2.3',
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    actor.stop()
  })

  it('an in-session decline keeps suppressing re-checks even when the KV record is missing', async () => {
    // Simulates a failed recordTermsDecline persistence: storage has no record, so only
    // the session window (declinedUntil) can suppress.
    mockStorageGetItemSync.mockReturnValue(null)

    const actor = createActor(termsMachine)
    actor.start()
    const staleAuthState = signedInAuthState('u1', {
      termsVersion: '2.3',
      termsAcceptedAt: '2026-01-01T00:00:00.000Z',
    })
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: staleAuthState } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    const windowEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    actor.send({ type: 'DECLINE_TERMS', windowEnd } as any)
    expect(actor.getSnapshot().matches('declined')).toBe(true)
    expect(actor.getSnapshot().matches('accepted')).toBe(false)

    // A later in-session re-check (auth snapshot change) stays suppressed until the window ends
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: staleAuthState } as any)
    await waitFor(actor, (state) => state.matches('declined'), WAIT_OPTS)
    actor.stop()
  })

  it('resumes blocking at an in-session re-check once the decline window has expired', async () => {
    // Regression (review finding on PR #811): a session decline flag that never expires
    // kept the app unblocked until restart; enforcement must resume without a relaunch.
    mockStorageGetItemSync.mockReturnValue(null)

    const actor = createActor(termsMachine)
    actor.start()
    const staleAuthState = signedInAuthState('u1', {
      termsVersion: '2.3',
      termsAcceptedAt: '2026-01-01T00:00:00.000Z',
    })
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: staleAuthState } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    const expiredWindow = new Date(Date.now() - 60 * 1000).toISOString()
    actor.send({ type: 'DECLINE_TERMS', windowEnd: expiredWindow } as any)
    expect(actor.getSnapshot().matches('declined')).toBe(true)
    expect(actor.getSnapshot().matches('accepted')).toBe(false)

    // Next re-check after the window: blocking resumes in the same session
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: staleAuthState } as any)
    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.isUpdate).toBe(true)
    actor.stop()
  })

  it('a DECLINE_TERMS arriving during the acceptance write is consumed, not acted on', async () => {
    // Regression (review finding on PR #811): the cancel button is disabled while
    // accepting, but a non-UI sender could still deliver DECLINE_TERMS mid-write.
    // It must be consumed in place — the in-flight write resolves on its own.
    let resolveWrite!: (value: { data: { success: boolean } }) => void
    mockAcceptTermsFn.mockReturnValue(
      new Promise((resolve) => {
        resolveWrite = resolve
      }),
    )

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({
      type: 'AUTH_STATE_CHANGED',
      authState: signedInAuthState('u1', {
        termsVersion: '2.3',
        termsAcceptedAt: '2026-01-01T00:00:00.000Z',
      }),
    } as any)
    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('accepting'), WAIT_OPTS)

    // Mid-write decline: consumed — still accepting, no session decline window seeded
    const windowEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    actor.send({ type: 'DECLINE_TERMS', windowEnd } as any)
    expect(actor.getSnapshot().matches('accepting')).toBe(true)
    expect(actor.getSnapshot().context.declinedUntil).toBeNull()

    // The write still resolves normally to a genuine acceptance
    resolveWrite({ data: { success: true } })
    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(actor.getSnapshot().context.declinedUntil).toBeNull()
    actor.stop()
  })
})

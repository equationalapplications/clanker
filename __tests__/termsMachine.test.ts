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

    actor.send({ type: 'DECLINE_TERMS' })

    // Not blocked anymore, but NOT accepted either
    expect(actor.getSnapshot().matches('accepted')).toBe(true)
    expect(actor.getSnapshot().context.declined).toBe(true)
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

    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(actor.getSnapshot().context.declined).toBe(true)
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
})

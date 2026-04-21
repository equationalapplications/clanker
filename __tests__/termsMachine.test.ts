import { createActor, waitFor } from 'xstate'
import { TERMS } from '../src/config/termsConfig'

const mockAcceptTermsFn = jest.fn()

jest.mock('../src/services/apiClient', () => ({
  acceptTermsFn: mockAcceptTermsFn,
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
        ...subscription
      },
    },
  }
}

describe('termsMachine', () => {
  beforeEach(() => {
    mockAcceptTermsFn.mockReset()
    mockAcceptTermsFn.mockResolvedValue({ data: { success: true } })
  })

  it('goes to accepted when current terms are already accepted', async () => {
    const actor = createActor(termsMachine)
    actor.start()
    actor.send({ 
      type: 'AUTH_STATE_CHANGED', 
      authState: signedInAuthState('u1', { termsVersion: TERMS.version, termsAcceptedAt: '2026-01-01T00:00:00.000Z' }) 
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
      authState: signedInAuthState('u1', { termsVersion: '0.0.1', termsAcceptedAt: '2026-01-01T00:00:00.000Z' }) 
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
      authState: signedInAuthState('u1', { termsVersion: null, termsAcceptedAt: null }) 
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
      authState: signedInAuthState('u1', { termsVersion: null, termsAcceptedAt: null }) 
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(mockAcceptTermsFn).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })

  it('returns to acceptanceRequired and stores error when accept write fails', async () => {
    mockAcceptTermsFn.mockRejectedValue(new Error('write failed'))

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({ 
      type: 'AUTH_STATE_CHANGED', 
      authState: signedInAuthState('u1', { termsVersion: null, termsAcceptedAt: null }) 
    } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.error?.message).toContain('write failed')
    actor.stop()
  })
})
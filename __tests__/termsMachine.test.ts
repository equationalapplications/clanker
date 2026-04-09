import { createActor, waitFor } from 'xstate'
import { TERMS } from '../src/config/termsConfig'

const mockMaybeSingle = jest.fn()
const mockUpsert = jest.fn()
const mockFrom = jest.fn(() => ({
  select: jest.fn(() => ({
    eq: jest.fn(() => ({
      eq: jest.fn(() => ({
        maybeSingle: mockMaybeSingle,
      })),
    })),
  })),
  upsert: mockUpsert,
}))

jest.mock('../src/config/supabaseClient', () => ({
  supabaseClient: {
    from: mockFrom,
  },
}))

const { termsMachine } = require('../src/machines/termsMachine')

const WAIT_OPTS = { timeout: 2000 }

function signedInAuthState(userId = 'supabase-user-1') {
  return {
    matches: (value: string) => value === 'signedIn',
    context: {
      supabaseSession: {
        user: { id: userId },
      },
    },
  }
}

describe('termsMachine', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('goes to accepted when current terms are already accepted', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { terms_accepted_at: '2026-01-01T00:00:00.000Z', terms_version: TERMS.version },
      error: null,
    })

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: signedInAuthState() } as any)

    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(actor.getSnapshot().context.isUpdate).toBe(false)
    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })

  it('goes to acceptanceRequired with isUpdate=true when terms version is stale', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { terms_accepted_at: '2026-01-01T00:00:00.000Z', terms_version: '0.0.1' },
      error: null,
    })

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: signedInAuthState() } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.isUpdate).toBe(true)
    actor.stop()
  })

  it('routes check errors to acceptanceRequired and stores the error', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: new Error('network failed'),
    })

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: signedInAuthState() } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.error?.message).toContain('network failed')
    actor.stop()
  })

  it('accepts terms successfully from acceptanceRequired', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })
    mockUpsert.mockResolvedValue({ error: null })

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: signedInAuthState() } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('accepted'), WAIT_OPTS)
    expect(mockUpsert).toHaveBeenCalledTimes(1)
    expect(actor.getSnapshot().context.error).toBeNull()
    actor.stop()
  })

  it('returns to acceptanceRequired and stores error when accept write fails', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: null,
    })
    mockUpsert.mockResolvedValue({ error: new Error('write failed') })

    const actor = createActor(termsMachine)
    actor.start()
    actor.send({ type: 'AUTH_STATE_CHANGED', authState: signedInAuthState() } as any)

    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)

    actor.send({ type: 'ACCEPT_TERMS' })
    await waitFor(actor, (state) => state.matches('acceptanceRequired'), WAIT_OPTS)
    expect(actor.getSnapshot().context.error?.message).toContain('write failed')
    actor.stop()
  })
})
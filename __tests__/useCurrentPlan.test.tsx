import React from 'react'
import { useSelector } from '@xstate/react'
import { act, create } from 'react-test-renderer'
import { PLAN_TIERS } from '~/config/constants'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'

jest.mock('@xstate/react', () => ({
  useSelector: jest.fn(),
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: jest.fn(() => ({})),
}))

type HookValue = ReturnType<typeof useCurrentPlan>

interface MockState {
  context: {
    supabaseSession: {
      access_token: string
    } | null
  }
  matches: (stateValue: string) => boolean
}

const mockUseSelector = useSelector as jest.Mock

function toBase64Url(value: string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = toBase64Url(JSON.stringify(payload))
  return `${header}.${body}.signature`
}

function makeState(options?: { accessToken?: string | null; activeStates?: string[] }): MockState {
  const accessToken = options?.accessToken ?? null
  const activeStates = new Set(options?.activeStates ?? [])

  return {
    context: {
      supabaseSession: accessToken ? { access_token: accessToken } : null,
    },
    matches: (stateValue: string) => activeStates.has(stateValue),
  }
}

function renderUseCurrentPlan(state: MockState): HookValue {
  mockUseSelector.mockImplementation((_service: unknown, selector: (value: MockState) => unknown) =>
    selector(state),
  )

  let hookValue: HookValue | null = null

  function Probe() {
    hookValue = useCurrentPlan()
    return null
  }

  act(() => {
    create(<Probe />)
  })

  if (hookValue === null) {
    throw new Error('useCurrentPlan did not produce a value')
  }

  return hookValue
}

describe('useCurrentPlan', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(['initializing', 'signingIn', 'exchangingToken', 'establishingSupabaseSession'])(
    'sets isLoading to true while auth machine is %s',
    (stateValue) => {
      const result = renderUseCurrentPlan(makeState({ activeStates: [stateValue] }))
      expect(result.isLoading).toBe(true)
    },
  )

  it('sets isLoading to false outside loading states', () => {
    const result = renderUseCurrentPlan(makeState({ activeStates: ['signedIn'] }))
    expect(result.isLoading).toBe(false)
  })

  it('derives a subscriber tier from a valid token plan for this app', () => {
    const token = makeJwt({
      plans: [{ app: 'clanker', tier: PLAN_TIERS.MONTHLY_20 }],
    })

    const result = renderUseCurrentPlan(makeState({ accessToken: token }))

    expect(result.tier).toBe(PLAN_TIERS.MONTHLY_20)
    expect(result.isSubscriber).toBe(true)
  })

  it('marks users with free tier as non-subscribers', () => {
    const token = makeJwt({
      plans: [{ app: 'clanker', tier: PLAN_TIERS.FREE }],
    })

    const result = renderUseCurrentPlan(makeState({ accessToken: token }))

    expect(result.tier).toBe(PLAN_TIERS.FREE)
    expect(result.isSubscriber).toBe(false)
  })

  it('returns null tier when token has no plan entry for this app', () => {
    const token = makeJwt({
      plans: [{ app: 'another-app', tier: PLAN_TIERS.MONTHLY_50 }],
    })

    const result = renderUseCurrentPlan(makeState({ accessToken: token }))

    expect(result.tier).toBeNull()
    expect(result.isSubscriber).toBe(false)
  })

  it.each(['not-a-jwt', 'abc.def', 'abc.!@#.signature'])(
    'handles malformed token %s without throwing',
    (token) => {
      const result = renderUseCurrentPlan(makeState({ accessToken: token }))

      expect(result.tier).toBeNull()
      expect(result.isSubscriber).toBe(false)
    },
  )

  it('uses two primitive selectors to avoid object identity churn', () => {
    const state = makeState({ activeStates: ['initializing'] })
    renderUseCurrentPlan(state)

    expect(mockUseSelector).toHaveBeenCalledTimes(2)

    const tokenState = makeState({ accessToken: 'token-value' })
    const selectors = mockUseSelector.mock.calls.map(
      (call) => call[1] as (value: MockState) => unknown,
    )

    const accessTokenSelector = selectors.find(
      (selector) =>
        selector(state) === null && selector(tokenState) === 'token-value',
    )
    const isLoadingSelector = selectors.find(
      (selector) =>
        selector(state) === true && typeof selector(state) === 'boolean',
    )

    expect(accessTokenSelector).toBeDefined()
    expect(isLoadingSelector).toBeDefined()

    expect(accessTokenSelector?.(state)).toBeNull()
    expect(accessTokenSelector?.(tokenState)).toBe('token-value')
    expect(typeof accessTokenSelector?.(tokenState)).toBe('string')
    expect(isLoadingSelector?.(state)).toBe(true)
    expect(typeof isLoadingSelector?.(state)).toBe('boolean')
  })
})
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
    subscription: {
      planTier: string
    } | null
  }
  matches: (stateValue: string) => boolean
}

const mockUseSelector = useSelector as jest.Mock

function makeState(options?: { planTier?: string | null; activeStates?: string[] }): MockState {
  const planTier = options?.planTier ?? null
  const activeStates = new Set(options?.activeStates ?? [])

  return {
    context: {
      subscription: planTier ? { planTier } : null,
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

  it.each(['initializing', 'signingIn', 'bootstrapping'])(
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

  it('derives a subscriber tier from the subscription context', () => {
    const result = renderUseCurrentPlan(makeState({ planTier: PLAN_TIERS.MONTHLY_20 }))

    expect(result.tier).toBe(PLAN_TIERS.MONTHLY_20)
    expect(result.isSubscriber).toBe(true)
  })

  it('marks users with free tier as non-subscribers', () => {
    const result = renderUseCurrentPlan(makeState({ planTier: PLAN_TIERS.FREE }))

    expect(result.tier).toBe(PLAN_TIERS.FREE)
    expect(result.isSubscriber).toBe(false)
  })

  it('returns null tier when subscription context is missing', () => {
    const result = renderUseCurrentPlan(makeState({ planTier: null }))

    expect(result.tier).toBeNull()
    expect(result.isSubscriber).toBe(false)
  })

  it('returns null tier when subscription context has an unknown tier', () => {
    const result = renderUseCurrentPlan(makeState({ planTier: 'enterprise' }))

    expect(result.tier).toBeNull()
    expect(result.isSubscriber).toBe(false)
  })

  it('uses two primitive selectors to avoid object identity churn', () => {
    const state = makeState({ activeStates: ['initializing'] })
    renderUseCurrentPlan(state)

    expect(mockUseSelector).toHaveBeenCalledTimes(2)

    const subState = makeState({ planTier: PLAN_TIERS.MONTHLY_20 })
    const selectors = mockUseSelector.mock.calls.map(
      (call) => call[1] as (value: MockState) => unknown,
    )

    const subscriptionSelector = selectors.find(
      (selector) =>
        selector(state) === null && (selector(subState) as any)?.planTier === PLAN_TIERS.MONTHLY_20,
    )
    const isLoadingSelector = selectors.find(
      (selector) =>
        selector(state) === true && typeof selector(state) === 'boolean',
    )

    expect(subscriptionSelector).toBeDefined()
    expect(isLoadingSelector).toBeDefined()

    expect(subscriptionSelector?.(state)).toBeNull()
    expect(subscriptionSelector?.(subState)).toEqual({ planTier: PLAN_TIERS.MONTHLY_20 })
    expect(isLoadingSelector?.(state)).toBe(true)
  })
})
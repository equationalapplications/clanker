import React from 'react'
import renderer from 'react-test-renderer'

const mockRouterReplace = jest.fn()
const mockShowAlert = jest.fn()

jest.mock('~/utilities/showAlert', () => ({
  showAlert: (...args: unknown[]) => mockShowAlert(...args),
}))

jest.mock('~/services/analyticsService', () => ({
  logEvent: jest.fn(),
}))

jest.mock('~/machines/termsMachine', () => {
  const real = jest.requireActual('~/machines/termsMachine') as Record<string, unknown>
  // Stable per-test-file mocks (getters returning fresh jest.fn()s would make any
  // call assertion impossible). Everything else stays real so DECLINE_TERMS flows
  // through the actual termsMachine.
  return { ...real, recordTermsDecline: jest.fn(), clearTermsDecline: jest.fn() }
})

jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}))

const mockTermsService = {
  send: jest.fn(),
  getSnapshot: jest.fn(() => ({
    context: {
      subscription:
        currentSnapshot?.termsVersion === undefined
          ? null
          : { termsVersion: currentSnapshot.termsVersion },
      isUpdate: currentSnapshot?.isUpdate ?? false,
      userUid: 'firebase-u1',
    },
  })),
}
const mockAuthService = { send: jest.fn() }

jest.mock('~/hooks/useMachines', () => ({
  useTermsMachine: () => mockTermsService,
  useAuthMachine: () => mockAuthService,
}))

const mockUseSelector = jest.fn()

jest.mock('@xstate/react', () => ({
  useSelector: (...args: unknown[]) => mockUseSelector(...args),
}))

type AcceptTermsProps = {
  onAccepted?: () => void
  onCanceled?: () => void
  isUpdate?: boolean
  accepting?: boolean
  error?: string | null
}

let mockLastAcceptTermsProps: AcceptTermsProps | null = null
let mockShowDobPicker = false
let mockManualDobPickerRendered = false

jest.mock('~/components/AcceptTerms', () => ({
  AcceptTerms: (props: AcceptTermsProps) => {
    mockLastAcceptTermsProps = props
    return null
  },
}))

jest.mock('~/components/ManualDobPicker', () => ({
  ManualDobPicker: () => {
    mockManualDobPickerRendered = true
    return null
  },
}))

jest.mock('~/hooks/useAgeVerification', () => ({
  useAgeVerification: ({ onVerified }: { onVerified: () => void; onRejected: () => void }) => ({
    verifyAge: onVerified,
    isVerifying: false,
    showDobPicker: mockShowDobPicker,
    handleDobResult: jest.fn(),
  }),
}))

type TermsSnapshot = {
  accepted: boolean
  declined?: boolean
  accepting: boolean
  isUpdate?: boolean
  // subscription.termsVersion, mirrored into the mock actor snapshot
  termsVersion?: string | null
  error: Error | null
}

// The cancel policy reads the actor snapshot (context.isUpdate / subscription / userUid),
// so the mock getSnapshot mirrors whatever setTermsSnapshot last installed.
let currentSnapshot: TermsSnapshot | null = null

function setTermsSnapshot(snapshot: TermsSnapshot) {
  currentSnapshot = snapshot
  mockUseSelector.mockImplementation((_: unknown, selector: (state: unknown) => unknown) => {
    const state = {
      matches: (value: string) => {
        if (value === 'accepted') return snapshot.accepted
        if (value === 'declined') return (snapshot as { declined?: boolean }).declined === true
        if (value === 'accepting') return snapshot.accepting
        return false
      },
      context: {
        isUpdate: snapshot.isUpdate ?? false,
        error: snapshot.error,
      },
    }

    return selector(state)
  })
}

describe('accept-terms screen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLastAcceptTermsProps = null
    mockShowDobPicker = false
    mockManualDobPickerRendered = false
    currentSnapshot = null
    setTermsSnapshot({ accepted: false, accepting: false, error: null })
  })

  it('redirects to root when terms are accepted', () => {
    setTermsSnapshot({ accepted: true, accepting: false, error: null })

    const AcceptTermsScreen = require('../app/(drawer)/accept-terms').default

    renderer.act(() => {
      renderer.create(<AcceptTermsScreen />)
    })

    expect(mockAuthService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TERMS_ACCEPTED_LOCAL',
      }),
    )
    expect(mockRouterReplace).toHaveBeenCalledWith('/')
  })

  it('declining re-enters the app WITHOUT recording an acceptance', () => {
    setTermsSnapshot({ accepted: false, declined: true, accepting: false, error: null })

    const AcceptTermsScreen = require('../app/(drawer)/accept-terms').default

    renderer.act(() => {
      renderer.create(<AcceptTermsScreen />)
    })

    // Regression (review finding on PR #811): decline used to share the 'accepted' state,
    // so this effect fabricated a TERMS_ACCEPTED_LOCAL for the new Terms version.
    expect(mockAuthService.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TERMS_ACCEPTED_LOCAL' }),
    )
    expect(mockRouterReplace).toHaveBeenCalledWith('/')
  })

  it('sends ACCEPT_TERMS with isUpdate=true from the child callback', () => {
    // isUpdate comes from the machine context (finding: search params are client-craftable
    // and could disagree with the drawer gate's machine-derived value)
    setTermsSnapshot({ accepted: false, accepting: false, isUpdate: true, error: null })

    const AcceptTermsScreen = require('../app/(drawer)/accept-terms').default

    renderer.act(() => {
      renderer.create(<AcceptTermsScreen />)
    })

    expect(mockLastAcceptTermsProps).not.toBeNull()

    renderer.act(() => {
      mockLastAcceptTermsProps?.onAccepted?.()
    })

    expect(mockTermsService.send).toHaveBeenCalledWith({ type: 'ACCEPT_TERMS', isUpdate: true })
  })

  it('shows the decline notice without signing out from the child cancel callback', () => {
    // Age-gated previous version ('2.5'): the cancel policy skips the age gate and
    // declines straight into notice-then-enforce (issue #810).
    setTermsSnapshot({
      accepted: false,
      accepting: false,
      isUpdate: true,
      termsVersion: '2.5',
      error: null,
    })

    const AcceptTermsScreen = require('../app/(drawer)/accept-terms').default

    renderer.act(() => {
      renderer.create(<AcceptTermsScreen />)
    })

    expect(mockLastAcceptTermsProps).not.toBeNull()

    renderer.act(() => {
      mockLastAcceptTermsProps?.onCanceled?.()
    })

    // Decline keeps paid access (issue #810): no SIGN_OUT; DECLINE_TERMS + notice instead
    expect(mockAuthService.send).not.toHaveBeenCalledWith({ type: 'SIGN_OUT' })
    expect(mockTermsService.send).toHaveBeenCalledWith({
      type: 'DECLINE_TERMS',
      windowEnd: expect.any(String),
    })
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Terms declined',
      expect.stringContaining('keep using Clanker under the previous Terms'),
    )
  })

  it('routes a legacy account cancel through the age gate instead of declining', () => {
    // CodeRabbit round on PR #812: an account whose previous Terms predate the age gate
    // must run the age flow on cancel too — the hook mock wires verifyAge to onVerified,
    // so reaching the gate means a verified adult then accepts instead of declining.
    setTermsSnapshot({
      accepted: false,
      accepting: false,
      isUpdate: true,
      termsVersion: '2.4',
      error: null,
    })

    const AcceptTermsScreen = require('../app/(drawer)/accept-terms').default

    renderer.act(() => {
      renderer.create(<AcceptTermsScreen />)
    })

    renderer.act(() => {
      mockLastAcceptTermsProps?.onCanceled?.()
    })

    expect(mockTermsService.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DECLINE_TERMS' }),
    )
    expect(mockAuthService.send).not.toHaveBeenCalledWith({ type: 'SIGN_OUT' })
    expect(mockTermsService.send).toHaveBeenCalledWith({ type: 'ACCEPT_TERMS', isUpdate: true })
  })

  it('declining a first-time acceptance still signs out (no prior Terms to fall back on)', () => {
    const AcceptTermsScreen = require('../app/(drawer)/accept-terms').default

    renderer.act(() => {
      renderer.create(<AcceptTermsScreen />)
    })

    renderer.act(() => {
      mockLastAcceptTermsProps?.onCanceled?.()
    })

    expect(mockAuthService.send).toHaveBeenCalledWith({ type: 'SIGN_OUT' })
    expect(mockTermsService.send).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DECLINE_TERMS' }),
    )
  })

  it('renders ManualDobPicker instead of AcceptTerms when showDobPicker is true', () => {
    mockShowDobPicker = true

    const AcceptTermsScreen = require('../app/(drawer)/accept-terms').default

    renderer.act(() => {
      renderer.create(<AcceptTermsScreen />)
    })

    expect(mockManualDobPickerRendered).toBe(true)
    expect(mockLastAcceptTermsProps).toBeNull()
  })
})

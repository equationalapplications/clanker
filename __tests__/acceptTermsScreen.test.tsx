import React from 'react'
import renderer from 'react-test-renderer'

const mockRouterReplace = jest.fn()
const mockUseLocalSearchParams = jest.fn()
const mockShowAlert = jest.fn()

jest.mock('~/utilities/showAlert', () => ({
  showAlert: (...args: unknown[]) => mockShowAlert(...args),
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
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}))

const mockTermsService = {
  send: jest.fn(),
  getSnapshot: jest.fn(() => ({ context: { subscription: null } })),
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
  error: Error | null
}

function setTermsSnapshot(snapshot: TermsSnapshot) {
  mockUseSelector.mockImplementation((_: unknown, selector: (state: unknown) => unknown) => {
    const state = {
      matches: (value: string) => {
        if (value === 'accepted') return snapshot.accepted
        if (value === 'declined') return (snapshot as { declined?: boolean }).declined === true
        if (value === 'accepting') return snapshot.accepting
        return false
      },
      context: {
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
    mockUseLocalSearchParams.mockReturnValue({ isUpdate: 'false' })
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
    mockUseLocalSearchParams.mockReturnValue({ isUpdate: 'true' })

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
    mockUseLocalSearchParams.mockReturnValue({ isUpdate: 'true' })

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

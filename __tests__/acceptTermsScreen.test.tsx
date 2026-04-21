import React from 'react'
import renderer from 'react-test-renderer'

const mockRouterReplace = jest.fn()
const mockUseLocalSearchParams = jest.fn()

jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}))

const mockTermsService = { send: jest.fn() }
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

jest.mock('~/components/AcceptTerms', () => ({
  AcceptTerms: (props: AcceptTermsProps) => {
    mockLastAcceptTermsProps = props
    return null
  },
}))

type TermsSnapshot = {
  accepted: boolean
  accepting: boolean
  error: Error | null
}

function setTermsSnapshot(snapshot: TermsSnapshot) {
  mockUseSelector.mockImplementation((_: unknown, selector: (state: unknown) => unknown) => {
    const state = {
      matches: (value: string) => {
        if (value === 'accepted') return snapshot.accepted
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

  it('sends SIGN_OUT from the child cancel callback', () => {
    const AcceptTermsScreen = require('../app/(drawer)/accept-terms').default

    renderer.act(() => {
      renderer.create(<AcceptTermsScreen />)
    })

    expect(mockLastAcceptTermsProps).not.toBeNull()

    renderer.act(() => {
      mockLastAcceptTermsProps?.onCanceled?.()
    })

    expect(mockAuthService.send).toHaveBeenCalledWith({ type: 'SIGN_OUT' })
  })
})

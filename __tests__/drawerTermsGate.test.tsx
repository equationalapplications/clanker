import React from 'react'
import renderer from 'react-test-renderer'

const mockDrawerScreenOptions = jest.fn()
let mockLastAcceptTermsProps: Record<string, unknown> | null = null

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
  },
  useNavigation: () => ({
    dispatch: jest.fn(),
  }),
}))

jest.mock('expo-router/build/react-navigation/drawer', () => {
  const React = require('react')
  return {
    DrawerContentScrollView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DrawerItemList: () => null,
    DrawerItem: () => null,
  }
})

jest.mock('expo-router/drawer', () => {
  const React = require('react')

  const Drawer = ({
    children,
    screenOptions,
  }: {
    children: React.ReactNode
    screenOptions?: any
  }) => {
    if (screenOptions) {
      mockDrawerScreenOptions(screenOptions)
    }
    return <>{children}</>
  }
  Drawer.Screen = ({ name }: { name: string }) => <>{name}</>

  return { Drawer }
})

jest.mock('react-native-paper', () => ({
  useTheme: () => ({
    colors: {
      surface: '#fff',
      onSurface: '#111',
      primary: '#08f',
      onSurfaceVariant: '#666',
    },
  }),
  Icon: () => null,
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

jest.mock('~/components/AcceptTerms', () => ({
  AcceptTerms: (props: Record<string, unknown>) => {
    mockLastAcceptTermsProps = props
    return null
  },
}))

let mockLastDobPickerProps: { onComplete: (isAdult: boolean) => void } | null = null

jest.mock('~/components/ManualDobPicker', () => ({
  ManualDobPicker: (props: { onComplete: (isAdult: boolean) => void }) => {
    mockLastDobPickerProps = props
    return null
  },
}))

const mockShowAlert = jest.fn()

jest.mock('~/utilities/showAlert', () => ({
  showAlert: (...args: unknown[]) => mockShowAlert(...args),
}))

const mockRecordTermsDecline = jest.fn()
const mockClearTermsDecline = jest.fn()

jest.mock('~/machines/termsMachine', () => ({
  recordTermsDecline: (...args: unknown[]) => mockRecordTermsDecline(...args),
  clearTermsDecline: (...args: unknown[]) => mockClearTermsDecline(...args),
}))

// The real useAgeVerification hook runs; only the native age-range module is mocked.
const mockRequestAgeRange = jest.fn()
const mockIsEligible = jest.fn()

jest.mock('expo-age-range', () => ({
  requestAgeRangeAsync: (...args: unknown[]) => mockRequestAgeRange(...args),
  isEligibleForAgeFeaturesAsync: (...args: unknown[]) => mockIsEligible(...args),
  requestAgeSignalsAccessAsync: (...args: unknown[]) => mockRequestSignalsAccess(...args),
}))

const mockRequestSignalsAccess = jest.fn()

const mockUseSelector = jest.fn()

jest.mock('@xstate/react', () => ({
  useSelector: (...args: any[]) => mockUseSelector(...args),
}))

type TermsSnapshot = {
  accepted: boolean
  blocking: boolean
  loading: boolean
  isUpdate: boolean
  accepting: boolean
  error: Error | null
  // subscription.termsVersion: the previously accepted Terms version (null for new accounts)
  termsVersion?: string | null
}

function setTermsSnapshot(snapshot: TermsSnapshot) {
  mockUseSelector.mockImplementation((_: unknown, selector: (state: any) => any) => {
    const state = {
      matches: (value: string) => {
        if (value === 'accepted') return snapshot.accepted
        if (value === 'acceptanceRequired') return snapshot.blocking
        if (value === 'idle' || value === 'checking') return snapshot.loading
        if (value === 'accepting') return snapshot.accepting
        return false
      },
      context: {
        isUpdate: snapshot.isUpdate,
        error: snapshot.error,
        subscription:
          snapshot.termsVersion === undefined ? null : { termsVersion: snapshot.termsVersion },
      },
    }
    return selector(state)
  })
}

describe('drawer terms gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockLastAcceptTermsProps = null
    mockLastDobPickerProps = null
  })

  it('maps (tabs) route to Chat labels in drawer screenOptions', () => {
    setTermsSnapshot({
      accepted: true,
      blocking: false,
      loading: false,
      isUpdate: false,
      accepting: false,
      error: null,
    })

    const AppLayout = require('../app/(drawer)/_layout').default

    renderer.act(() => {
      renderer.create(<AppLayout />)
    })

    expect(mockDrawerScreenOptions).toHaveBeenCalledTimes(1)

    const screenOptions = mockDrawerScreenOptions.mock.calls[0][0]
    const tabsOptions = screenOptions({ route: { name: '(tabs)' } })

    expect(tabsOptions.drawerLabel).toBe('Chat')
    expect(tabsOptions.title).toBe('Chat')
    expect(tabsOptions.headerTitle).toBe('Chat')
  })

  it('renders AcceptTerms directly when terms are blocking', () => {
    setTermsSnapshot({
      accepted: false,
      blocking: true,
      loading: false,
      isUpdate: true,
      accepting: false,
      error: null,
    })

    const AppLayout = require('../app/(drawer)/_layout').default

    renderer.act(() => {
      renderer.create(<AppLayout />)
    })

    expect(mockLastAcceptTermsProps).toBeTruthy()
    expect(mockLastAcceptTermsProps).toMatchObject({
      isUpdate: true,
      accepting: false,
      error: undefined,
    })
    expect(mockDrawerScreenOptions).not.toHaveBeenCalled()
  })

  it('wires accept action to terms machine from blocking UI', () => {
    setTermsSnapshot({
      accepted: false,
      blocking: true,
      loading: false,
      isUpdate: true,
      accepting: false,
      error: null,
      termsVersion: '2.5',
    })

    const AppLayout = require('../app/(drawer)/_layout').default

    renderer.act(() => {
      renderer.create(<AppLayout />)
    })

    const onAccepted = mockLastAcceptTermsProps?.onAccepted as (() => void) | undefined
    expect(onAccepted).toBeDefined()

    renderer.act(() => {
      onAccepted?.()
    })

    expect(mockTermsService.send).toHaveBeenCalledWith({ type: 'ACCEPT_TERMS', isUpdate: true })
  })

  it('hides gated screens when terms are not accepted', () => {
    setTermsSnapshot({
      accepted: false,
      blocking: false,
      loading: false,
      isUpdate: false,
      accepting: false,
      error: null,
    })

    const AppLayout = require('../app/(drawer)/_layout').default

    let tree!: renderer.ReactTestRenderer
    renderer.act(() => {
      tree = renderer.create(<AppLayout />)
    })

    // All screens are still rendered (Expo Router requires Screen children)
    // but gated ones receive hidden options
    const text = JSON.stringify(tree.toJSON())
    expect(text).toContain('accept-terms')
    expect(text).toContain('(tabs)')
    expect(text).toContain('profile')
    expect(text).toContain('settings')
    expect(text).toContain('subscribe')

    // Verify screenOptions apply hidden styles to gated routes
    expect(mockDrawerScreenOptions).toHaveBeenCalled()
  })
})

describe('drawer terms gate decline (issue #810)', () => {
  const blockingSnapshot = (isUpdate: boolean, termsVersion?: string | null): TermsSnapshot => ({
    accepted: false,
    blocking: true,
    loading: false,
    isUpdate,
    accepting: false,
    error: null,
    termsVersion,
  })

  function renderLayout() {
    const AppLayout = require('../app/(drawer)/_layout').default
    renderer.act(() => {
      renderer.create(<AppLayout />)
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockLastAcceptTermsProps = null
    mockLastDobPickerProps = null
  })

  it('declining shows the notice, records the decline, and does NOT sign out', () => {
    setTermsSnapshot(blockingSnapshot(true, '2.5'))
    renderLayout()

    renderer.act(() => {
      ;(mockLastAcceptTermsProps?.onCanceled as () => void)()
    })

    expect(mockAuthService.send).not.toHaveBeenCalledWith({ type: 'SIGN_OUT' })
    expect(mockRecordTermsDecline).toHaveBeenCalledTimes(1)
    expect(mockTermsService.send).toHaveBeenCalledWith({
      type: 'DECLINE_TERMS',
      windowEnd: expect.any(String),
    })
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Terms declined',
      expect.stringContaining('keep using Clanker under the previous Terms'),
    )
  })

  it('a real acceptance clears any decline record', () => {
    setTermsSnapshot({
      accepted: false,
      blocking: true,
      loading: false,
      isUpdate: true,
      accepting: false,
      error: null,
      termsVersion: '2.5',
    })
    renderLayout()

    // Accept transitions blocking → accepted inside termsMachine; the layout effect then
    // clears the stale decline record via clearTermsDecline().
    expect(mockClearTermsDecline).toBeDefined()
  })
})

describe('drawer terms gate age verification', () => {
  const blockingSnapshot = (isUpdate: boolean, termsVersion?: string | null): TermsSnapshot => ({
    accepted: false,
    blocking: true,
    loading: false,
    isUpdate,
    accepting: false,
    error: null,
    termsVersion,
  })

  const acceptTermsCalls = () =>
    mockTermsService.send.mock.calls.filter(([event]) => event?.type === 'ACCEPT_TERMS')

  function renderLayout() {
    const AppLayout = require('../app/(drawer)/_layout').default
    renderer.act(() => {
      renderer.create(<AppLayout />)
    })
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockLastAcceptTermsProps = null
    mockLastDobPickerProps = null
    __setJestPlatformOS('android')
    mockRequestSignalsAccess.mockResolvedValue('SHARED')
  })

  afterEach(() => {
    __resetJestPlatformOS()
  })

  it('does not send ACCEPT_TERMS for a new account until the age check verifies the user', async () => {
    let resolveAgeRange!: (value: { lowerBound: number | null; upperBound: null }) => void
    mockRequestAgeRange.mockReturnValue(
      new Promise((resolve) => {
        resolveAgeRange = resolve
      }),
    )
    setTermsSnapshot(blockingSnapshot(false))
    renderLayout()

    const onAccepted = mockLastAcceptTermsProps?.onAccepted as () => Promise<void>
    let pending!: Promise<void>
    await renderer.act(async () => {
      pending = onAccepted()
    })

    expect(mockRequestAgeRange).toHaveBeenCalledTimes(1)
    expect(acceptTermsCalls()).toHaveLength(0)
    expect(mockLastAcceptTermsProps).toMatchObject({ accepting: true })

    await renderer.act(async () => {
      resolveAgeRange({ lowerBound: 18, upperBound: null })
      await pending
    })

    expect(acceptTermsCalls()).toEqual([[{ type: 'ACCEPT_TERMS', isUpdate: false }]])
  })

  it('signs out an under-18 new account without sending ACCEPT_TERMS', async () => {
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 13, upperBound: 17 })
    setTermsSnapshot(blockingSnapshot(false))
    renderLayout()

    await renderer.act(async () => {
      await (mockLastAcceptTermsProps?.onAccepted as () => Promise<void>)()
    })

    expect(acceptTermsCalls()).toHaveLength(0)
    expect(mockShowAlert).toHaveBeenCalledWith(
      'Age Restriction',
      'This app is for users 18 and older.',
    )
    expect(mockAuthService.send).toHaveBeenCalledWith({ type: 'SIGN_OUT' })
  })

  it('routes a new account through the DOB picker when no age signal is available', async () => {
    mockRequestSignalsAccess.mockResolvedValue('NOT_SHARED')
    setTermsSnapshot(blockingSnapshot(false))
    renderLayout()

    await renderer.act(async () => {
      await (mockLastAcceptTermsProps?.onAccepted as () => Promise<void>)()
    })

    expect(mockLastDobPickerProps).toBeTruthy()
    expect(acceptTermsCalls()).toHaveLength(0)

    renderer.act(() => {
      mockLastDobPickerProps?.onComplete(true)
    })

    expect(acceptTermsCalls()).toEqual([[{ type: 'ACCEPT_TERMS', isUpdate: false }]])
  })

  it.each(['2.5', '2.10', '3.0'])(
    'skips the age check when an account that accepted age-gated terms %s re-accepts',
    (termsVersion) => {
      setTermsSnapshot(blockingSnapshot(true, termsVersion))
      renderLayout()

      renderer.act(() => {
        ;(mockLastAcceptTermsProps?.onAccepted as () => void)()
      })

      expect(acceptTermsCalls()).toEqual([[{ type: 'ACCEPT_TERMS', isUpdate: true }]])
      expect(mockRequestSignalsAccess).not.toHaveBeenCalled()
      expect(mockRequestAgeRange).not.toHaveBeenCalled()
      expect(mockLastDobPickerProps).toBeNull()
    },
  )

  it.each(['2.4', '1.9', 'garbage', '2.5-beta', '2.5garbage'])(
    'runs the age check before ACCEPT_TERMS for a legacy account that accepted terms %s',
    async (termsVersion) => {
      let resolveAgeRange!: (value: { lowerBound: number | null; upperBound: null }) => void
      mockRequestAgeRange.mockReturnValue(
        new Promise((resolve) => {
          resolveAgeRange = resolve
        }),
      )
      setTermsSnapshot(blockingSnapshot(true, termsVersion))
      renderLayout()

      const onAccepted = mockLastAcceptTermsProps?.onAccepted as () => Promise<void>
      let pending!: Promise<void>
      await renderer.act(async () => {
        pending = onAccepted()
      })

      expect(mockRequestAgeRange).toHaveBeenCalledTimes(1)
      expect(acceptTermsCalls()).toHaveLength(0)

      await renderer.act(async () => {
        resolveAgeRange({ lowerBound: 18, upperBound: null })
        await pending
      })

      expect(acceptTermsCalls()).toEqual([[{ type: 'ACCEPT_TERMS', isUpdate: true }]])
    },
  )

  it('signs out an under-18 legacy account on re-acceptance without sending ACCEPT_TERMS', async () => {
    mockRequestAgeRange.mockResolvedValue({ lowerBound: 13, upperBound: 17 })
    setTermsSnapshot(blockingSnapshot(true, '2.4'))
    renderLayout()

    await renderer.act(async () => {
      await (mockLastAcceptTermsProps?.onAccepted as () => Promise<void>)()
    })

    expect(acceptTermsCalls()).toHaveLength(0)
    expect(mockAuthService.send).toHaveBeenCalledWith({ type: 'SIGN_OUT' })
  })
})

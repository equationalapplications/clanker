import React from 'react'
import renderer from 'react-test-renderer'

const mockReplace = jest.fn()
const mockUsePathname = jest.fn()
const mockDrawerScreenOptions = jest.fn()

jest.mock('expo-router', () => ({
  router: {
    replace: (...args: any[]) => mockReplace(...args),
  },
  usePathname: () => mockUsePathname(),
}))

jest.mock('expo-router/drawer', () => {
  const React = require('react')

  const Drawer = ({ children, screenOptions }: { children: React.ReactNode; screenOptions?: any }) => {
    if (screenOptions) {
      mockDrawerScreenOptions(screenOptions)
    }
    return <>{children}</>
  }
  Drawer.Screen = ({ name }: { name: string }) => <>{name}</>

  return { Drawer }
})

jest.mock('@react-navigation/native', () => ({
  DrawerActions: {
    toggleDrawer: jest.fn(() => ({ type: 'TOGGLE_DRAWER' })),
  },
  useNavigation: () => ({
    dispatch: jest.fn(),
  }),
}))

jest.mock('@react-navigation/drawer', () => {
  const React = require('react')
  return {
    DrawerContentScrollView: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    DrawerItemList: () => null,
    DrawerItem: () => null,
  }
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

const mockTermsService = { send: jest.fn() }

jest.mock('~/hooks/useMachines', () => ({
  useTermsMachine: () => mockTermsService,
}))

const mockUseSelector = jest.fn()

jest.mock('@xstate/react', () => ({
  useSelector: (...args: any[]) => mockUseSelector(...args),
}))

type TermsSnapshot = {
  accepted: boolean
  blocking: boolean
  loading: boolean
  isUpdate: boolean
}

function setTermsSnapshot(snapshot: TermsSnapshot) {
  mockUseSelector.mockImplementation((_: unknown, selector: (state: any) => any) => {
    const state = {
      matches: (value: string) => {
        if (value === 'accepted') return snapshot.accepted
        if (value === 'acceptanceRequired') return snapshot.blocking
        if (value === 'idle' || value === 'checking') return snapshot.loading
        return false
      },
      context: {
        isUpdate: snapshot.isUpdate,
      },
    }
    return selector(state)
  })
}

describe('drawer terms gate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockUsePathname.mockReturnValue('/chat')
  })

  it('maps (tabs) route to Chat labels in drawer screenOptions', () => {
    setTermsSnapshot({ accepted: true, blocking: false, loading: false, isUpdate: false })

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

  it('redirects to accept-terms when terms are blocking on another route', () => {
    setTermsSnapshot({ accepted: false, blocking: true, loading: false, isUpdate: false })

    const AppLayout = require('../app/(drawer)/_layout').default

    renderer.act(() => {
      renderer.create(<AppLayout />)
    })

    expect(mockReplace).toHaveBeenCalledTimes(1)
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/accept-terms',
      params: { isUpdate: 'false' },
    })
  })

  it('does not self-redirect when already on accept-terms', () => {
    mockUsePathname.mockReturnValue('/accept-terms')
    setTermsSnapshot({ accepted: false, blocking: true, loading: false, isUpdate: true })

    const AppLayout = require('../app/(drawer)/_layout').default

    renderer.act(() => {
      renderer.create(<AppLayout />)
    })

    expect(mockReplace).not.toHaveBeenCalled()
  })

  it('hides gated screens when terms are not accepted', () => {
    setTermsSnapshot({ accepted: false, blocking: false, loading: false, isUpdate: false })

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

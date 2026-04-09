import { act, create } from 'react-test-renderer'

const mockUseAdminUsers = jest.fn()

jest.mock('@xstate/react', () => ({
  useSelector: () => ({ uid: 'firebase-user-1' }),
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({ send: jest.fn() }),
}))

jest.mock('~/components/admin/UsersTable', () => ({
  UsersTable: () => null,
}))

jest.mock('~/components/admin/UserActionPanel', () => ({
  UserActionPanel: () => null,
}))

jest.mock('~/components/admin/ConfirmationModal', () => ({
  AdminConfirmationModal: () => null,
}))

jest.mock('react-native-paper', () => {
  const React = require('react')
  const { Pressable, Text: RNText, TextInput: RNTextInput, View } = require('react-native')

  const Button = ({ children, onPress, ...props }: any) => (
    <Pressable onPress={onPress} {...props}>
      <RNText>{children}</RNText>
    </Pressable>
  )

  const Card = ({ children, ...props }: any) => <View {...props}>{children}</View>
  Card.Content = ({ children, ...props }: any) => <View {...props}>{children}</View>

  const Text = ({ children, ...props }: any) => <RNText {...props}>{children}</RNText>
  const TextInput = (props: any) => <RNTextInput {...props} />
  const useTheme = () => ({
    colors: {
      background: '#ffffff',
      surface: '#f5f5f5',
      onBackground: '#111111',
      onSurfaceVariant: '#6b7280',
      primary: '#2563eb',
      outline: '#d1d5db',
    },
  })

  return {
    Button,
    Card,
    Text,
    TextInput,
    useTheme,
  }
})

jest.mock('~/hooks/useAdminDashboard', () => ({
  useAdminUsers: (...args: unknown[]) => mockUseAdminUsers(...args),
  useSetAdminUserCredits: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useSetAdminUserSubscription: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useClearAdminTerms: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useResetAdminUserState: () => ({ isPending: false, mutateAsync: jest.fn() }),
  useDeleteAdminUser: () => ({ isPending: false, mutateAsync: jest.fn() }),
}))

describe('AdminDashboardScreen search debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers()

    mockUseAdminUsers.mockReturnValue({
      data: {
        users: [],
        hasMore: false,
        totalCount: 0,
      },
      isLoading: false,
      isFetching: false,
      refetch: jest.fn(),
    })
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  it('uses debounced search value when querying users', () => {
    const AdminDashboardScreen = require('../app/admin/index').default
    let tree: ReturnType<typeof create>

    act(() => {
      tree = create(<AdminDashboardScreen />)
    })

    const latestInput = () => mockUseAdminUsers.mock.calls.at(-1)?.[0] as { search: string }

    expect(latestInput().search).toBe('')

    const searchInput = tree!.root.find(
      (node: any) =>
        typeof node.props?.onChangeText === 'function' &&
        typeof node.props?.value === 'string' &&
        node.props?.placeholder == null,
    )

    act(() => {
      searchInput.props.onChangeText('search-term')
    })

    expect(latestInput().search).toBe('')

    act(() => {
      jest.advanceTimersByTime(299)
    })

    expect(latestInput().search).toBe('')

    act(() => {
      jest.advanceTimersByTime(1)
    })

    expect(latestInput().search).toBe('search-term')
  })
})

import React from 'react'
import { act, create } from 'react-test-renderer'
import { CreditCounterIcon } from '~/components/CreditCounterIcon'
import { useCurrentPlan } from '~/hooks/useCurrentPlan'
import { useUserCredits } from '~/hooks/useUserCredits'

const mockPush = jest.fn()

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

jest.mock('~/hooks/useCurrentPlan', () => ({
  useCurrentPlan: jest.fn(),
}))

jest.mock('~/hooks/useUserCredits', () => ({
  useUserCredits: jest.fn(),
}))

jest.mock('react-native-paper', () => {
  const React = require('react')
  const { Text: RNText } = require('react-native')

  return {
    Badge: ({ children }: { children: React.ReactNode }) => <RNText testID="badge">{children}</RNText>,
    Text: ({ children, ...props }: { children: React.ReactNode }) => <RNText {...props}>{children}</RNText>,
  }
})

const mockUseCurrentPlan = useCurrentPlan as jest.Mock
const mockUseUserCredits = useUserCredits as jest.Mock

describe('CreditCounterIcon with useCurrentPlan', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows loading badge while plan state is loading', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: true })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 88 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<CreditCounterIcon />)
    })

    const badge = tree.root.findByProps({ testID: 'badge' })
    expect(badge.props.children).toBe('...')
  })

  it('shows numeric credits when neither credits nor plan are loading', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 42 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<CreditCounterIcon />)
    })

    const badge = tree.root.findByProps({ testID: 'badge' })
    expect(badge.props.children).toBe(42)
  })

  it('renders subscriber UI and no credits badge for subscribers', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: true, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 99 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<CreditCounterIcon />)
    })

    expect(tree.root.findAllByProps({ testID: 'badge' })).toHaveLength(0)
    const textNodes = tree.root.findAll((node) => node.props?.children === '∞')
    expect(textNodes.length).toBeGreaterThan(0)
  })

  it('pressable has accessibilityRole "button"', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 42 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<CreditCounterIcon />)
    })

    // Find the root Pressable (has onPress)
    const allWithOnPress = tree.root.findAll((node: any) => !!node.props.onPress)
    expect(allWithOnPress[0].props.accessibilityRole).toBe('button')
  })

  it('pressable has accessibilityLabel with credit count for non-subscriber', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 42 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<CreditCounterIcon />)
    })

    const allWithOnPress = tree.root.findAll((node: any) => !!node.props.onPress)
    expect(allWithOnPress[0].props.accessibilityLabel).toBe('42 credits remaining')
  })

  it('pressable has accessibilityLabel for subscriber', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: true, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 0 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<CreditCounterIcon />)
    })

    const allWithOnPress = tree.root.findAll((node: any) => !!node.props.onPress)
    expect(allWithOnPress[0].props.accessibilityLabel).toBe('Premium subscriber, unlimited credits')
  })

  it('pressable has accessibilityHint for subscription management', () => {
    mockUseCurrentPlan.mockReturnValue({ isSubscriber: false, isLoading: false })
    mockUseUserCredits.mockReturnValue({ data: { totalCredits: 42 }, isLoading: false })

    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<CreditCounterIcon />)
    })

    const allWithOnPress = tree.root.findAll((node: any) => !!node.props.onPress)
    expect(allWithOnPress[0].props.accessibilityHint).toBe('Opens subscription management')
  })
})
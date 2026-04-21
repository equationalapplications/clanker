import React from 'react'
import { act, create } from 'react-test-renderer'
import { Platform } from 'react-native'

const mockUseUserCredits = jest.fn()
const mockMakePackagePurchase = jest.fn()
const mockAuthServiceSend = jest.fn()
const mockInvalidateQueries = jest.fn()

jest.mock('react-native-paper', () => {
  const React = require('react')
  const { Pressable, Text: RNText, View } = require('react-native')

  const Button = ({ children, onPress, ...props }: any) => {
    const testIdFromChildren = typeof children === 'string' ? children : undefined
    return (
      <Pressable testID={props.testID ?? testIdFromChildren} onPress={onPress} {...props}>
        <RNText>{children}</RNText>
      </Pressable>
    )
  }

  const Card = ({ children, ...props }: any) => <View {...props}>{children}</View>
  Card.Content = ({ children, ...props }: any) => <View {...props}>{children}</View>

  const Text = ({ children, ...props }: any) => <RNText {...props}>{children}</RNText>
  const Chip = ({ children, ...props }: any) => <View {...props}>{children}</View>
  const Snackbar = ({ visible, children }: any) => (visible ? <RNText>{children}</RNText> : null)

  const useTheme = () => ({
    colors: {
      primary: '#2563eb',
      errorContainer: '#fee2e2',
      tertiaryContainer: '#e0f2fe',
      onSurfaceVariant: '#6b7280',
    },
  })

  return {
    Button,
    Card,
    Text,
    Chip,
    Snackbar,
    useTheme,
  }
})

jest.mock('~/hooks/useUserCredits', () => ({
  useUserCredits: (...args: unknown[]) => mockUseUserCredits(...args),
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({ send: mockAuthServiceSend }),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: (...args: unknown[]) => mockInvalidateQueries(...args),
  }),
}))

jest.mock('~/utilities/makePackagePurchase', () => ({
  makePackagePurchase: (...args: unknown[]) => mockMakePackagePurchase(...args),
}))

jest.mock('~/components/LoadingIndicator', () => () => null)

describe('CreditsDisplay purchase flows', () => {
  const mockRefetch = jest.fn()
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { })
    jest.clearAllMocks()
    jest.replaceProperty(Platform, 'OS', 'web')

    mockRefetch.mockResolvedValue(undefined)
    mockUseUserCredits.mockReturnValue({
      data: { hasUnlimited: false, totalCredits: 42 },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    })

    mockMakePackagePurchase.mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('keeps purchase buttons disabled after successful web checkout launch', async () => {
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 100 Credits - $10' })

    await act(async () => {
      await buyButton.props.onPress()
    })

    const subscribeButton = tree.root.findByProps({ testID: 'Unlimited Subscription - $20/Month' })

    expect(mockMakePackagePurchase).toHaveBeenCalledWith('payg')
    expect(mockRefetch).not.toHaveBeenCalled()
    expect(mockInvalidateQueries).not.toHaveBeenCalled()
    expect(buyButton.props.disabled).toBe(true)
    expect(subscribeButton.props.disabled).toBe(true)
  })

  it('resets web purchase state and shows error snackbar on checkout failure', async () => {
    mockMakePackagePurchase.mockRejectedValueOnce(new Error('checkout failed'))
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 100 Credits - $10' })

    await act(async () => {
      await buyButton.props.onPress()
    })

    const subscribeButton = tree.root.findByProps({ testID: 'Unlimited Subscription - $20/Month' })

    expect(buyButton.props.disabled).toBe(false)
    expect(subscribeButton.props.disabled).toBe(false)
    expect(JSON.stringify(tree.toJSON())).toContain('Purchase failed. Please try again.')
  })

  it('refreshes bootstrap and clears loading after native subscription purchase', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios')
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: 'Unlimited Subscription - $20/Month' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 100 Credits - $10' })

    expect(mockMakePackagePurchase).toHaveBeenCalledWith('monthly_20')
    expect(mockRefetch).not.toHaveBeenCalled()
    expect(mockAuthServiceSend).toHaveBeenCalledWith({ type: 'REFRESH_BOOTSTRAP' })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['userCredits'] })
    expect(subscribeButton.props.disabled).toBe(false)
    expect(buyButton.props.disabled).toBe(false)
  })

  it('refreshes bootstrap when restore is pressed without query refetch', async () => {
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const restoreButton = tree.root.findByProps({ testID: 'Sync Subscription & Credits' })

    await act(async () => {
      await restoreButton.props.onPress()
    })

    expect(mockRefetch).not.toHaveBeenCalled()
    expect(mockAuthServiceSend).toHaveBeenCalledWith({ type: 'REFRESH_BOOTSTRAP' })
  })
})

import React from 'react'
import { act, create } from 'react-test-renderer'

const mockUseUserCredits = jest.fn()
const mockUsePowerBalance = jest.fn()
const mockMakePackagePurchase = jest.fn()
const mockAuthServiceSend = jest.fn()
const mockUseAuthSubscription = jest.fn()

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

jest.mock('~/hooks/usePowerBalance', () => ({
  usePowerBalance: (...args: unknown[]) => mockUsePowerBalance(...args),
}))

jest.mock('~/hooks/useAuthSnapshot', () => ({
  useAuthSubscription: (...args: unknown[]) => mockUseAuthSubscription(...args),
}))

jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({ send: mockAuthServiceSend }),
}))

jest.mock('~/hooks/useBootstrapRefresh', () => ({
  useBootstrapRefresh: () => mockAuthServiceSend,
}))

jest.mock('~/utilities/makePackagePurchase', () => ({
  makePackagePurchase: (...args: unknown[]) => mockMakePackagePurchase(...args),
}))

jest.mock('~/components/LoadingIndicator', () => () => null)

describe('CreditsDisplay purchase flows', () => {
  const mockRefetch = jest.fn()
  let consoleErrorSpy: jest.SpyInstance

  const createDeferredPurchase = () => {
    let resolvePurchase!: (value: unknown) => void
    const purchasePromise = new Promise((resolve) => {
      resolvePurchase = resolve
    })

    return {
      purchasePromise,
      resolvePurchase,
    }
  }

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { })
    jest.clearAllMocks()
    __setJestPlatformOS('web')

    mockRefetch.mockResolvedValue(undefined)
    mockUseUserCredits.mockReturnValue({
      data: { totalCredits: 42, nextExpiryDate: null },
      isLoading: false,
      error: null,
      refetch: mockRefetch,
    })
    mockUsePowerBalance.mockReturnValue({
      totalPower: 42,
      grantedPower: 100,
      rawFill: 0.42,
      barFill: 0.4,
      band: 'normal',
      isLoading: false,
    })

    mockMakePackagePurchase.mockResolvedValue(undefined)
    mockUseAuthSubscription.mockReturnValue(null)
  })

  afterEach(() => {
    __resetJestPlatformOS()
    consoleErrorSpy.mockRestore()
  })

  it('keeps purchase buttons disabled after successful web checkout launch', async () => {
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 10,000 Power - $10' })

    await act(async () => {
      await buyButton.props.onPress()
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })

    expect(mockMakePackagePurchase).toHaveBeenCalledWith('payg')
    expect(mockRefetch).not.toHaveBeenCalled()
    expect(buyButton.props.disabled).toBe(true)
    expect(subscribeButton.props.disabled).toBe(true)
  })

  it.each([
    {
      buttonTestId: 'Buy 10,000 Power - $10',
      packageType: 'payg',
    },
    {
      buttonTestId: '30,000 Power / month · $20',
      packageType: 'monthly_20',
    },
  ])('ignores a rapid second same-tab web purchase start for %s', async ({ buttonTestId, packageType }) => {
    const { purchasePromise, resolvePurchase } = createDeferredPurchase()
    mockMakePackagePurchase.mockReturnValueOnce(purchasePromise)

    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const purchaseButton = tree.root.findByProps({ testID: buttonTestId })

    await act(async () => {
      const firstPress = purchaseButton.props.onPress()
      const secondPress = purchaseButton.props.onPress()

      resolvePurchase(undefined)
      await Promise.all([firstPress, secondPress])
    })

    expect(mockMakePackagePurchase).toHaveBeenCalledTimes(1)
    expect(mockMakePackagePurchase).toHaveBeenCalledWith(packageType)
  })

  it('resets web purchase state and shows error snackbar on checkout failure', async () => {
    mockMakePackagePurchase.mockRejectedValueOnce(new Error('checkout failed'))
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 10,000 Power - $10' })

    await act(async () => {
      await buyButton.props.onPress()
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })

    expect(buyButton.props.disabled).toBe(false)
    expect(subscribeButton.props.disabled).toBe(false)
    expect(JSON.stringify(tree.toJSON())).toContain('Purchase failed. Please try again.')
  })

  it('shows the server-provided message when subscribe is blocked by an existing mobile subscription', async () => {
    const blockedError = Object.assign(
      new Error('You already have an active subscription on mobile. Manage it in the App Store or Play Store.'),
      { code: 'functions/already-exists' }
    )
    mockMakePackagePurchase.mockRejectedValueOnce(blockedError)
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    expect(JSON.stringify(tree.toJSON())).toContain(
      'You already have an active subscription on mobile. Manage it in the App Store or Play Store.'
    )
  })

  it('shows the generic message for a non-business-rule error code', async () => {
    const genericError = Object.assign(new Error('boom'), { code: 'functions/internal' })
    mockMakePackagePurchase.mockRejectedValueOnce(genericError)
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    expect(JSON.stringify(tree.toJSON())).toContain('Purchase failed. Please try again.')
  })

  it('refreshes bootstrap and clears loading after native subscription purchase', async () => {
    __setJestPlatformOS('ios')
    mockMakePackagePurchase.mockResolvedValueOnce({ appUserId: 'user-1' })
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 10,000 Power - $10' })

    expect(mockMakePackagePurchase).toHaveBeenCalledWith('monthly_20')
    expect(mockRefetch).not.toHaveBeenCalled()
    expect(mockAuthServiceSend).toHaveBeenCalledWith('purchase')
    expect(subscribeButton.props.disabled).toBe(false)
    expect(buyButton.props.disabled).toBe(false)
  })

  it('does not refresh state when native subscription purchase is cancelled', async () => {
    __setJestPlatformOS('ios')
    mockMakePackagePurchase.mockResolvedValueOnce(null)
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    expect(mockAuthServiceSend).not.toHaveBeenCalled()
    expect(subscribeButton.props.disabled).toBe(false)
  })

  it('does not refresh state when native payg purchase is cancelled', async () => {
    __setJestPlatformOS('ios')
    mockMakePackagePurchase.mockResolvedValueOnce(null)
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 10,000 Power - $10' })

    await act(async () => {
      await buyButton.props.onPress()
    })

    expect(mockAuthServiceSend).not.toHaveBeenCalled()
    expect(buyButton.props.disabled).toBe(false)
  })

  it('refreshes bootstrap when restore is pressed without query refetch', async () => {
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const restoreButton = tree.root.findByProps({ testID: 'Sync Subscription & Power' })

    await act(async () => {
      await restoreButton.props.onPress()
    })

    expect(mockRefetch).not.toHaveBeenCalled()
    expect(mockAuthServiceSend).toHaveBeenCalledWith('restore')
  })

  it('keeps payg enabled when only subscribe lock is active', async () => {
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <CreditsDisplay
          webCheckoutLocks={{
            isPaygLocked: false,
            isSubscribeLocked: true,
          }}
        />,
      )
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })
    const buyButton = tree.root.findByProps({ testID: 'Buy 10,000 Power - $10' })

    expect(subscribeButton.props.disabled).toBe(true)
    expect(buyButton.props.disabled).toBe(false)
  })

  it('keeps subscribe enabled when only payg lock is active', async () => {
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <CreditsDisplay
          webCheckoutLocks={{
            isPaygLocked: true,
            isSubscribeLocked: false,
          }}
        />,
      )
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })
    const buyButton = tree.root.findByProps({ testID: 'Buy 10,000 Power - $10' })

    expect(subscribeButton.props.disabled).toBe(false)
    expect(buyButton.props.disabled).toBe(true)
  })

  it('on web, does not show expiredMessage snackbar (parent owns it)', async () => {
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(
        <CreditsDisplay
          webCheckoutLocks={{
            isPaygLocked: false,
            isSubscribeLocked: false,
          }}
          expiredMessage="Previous checkout timed out"
        />,
      )
    })

    // On web, CreditsDisplay receives expiredMessage prop but does NOT show it in snackbar
    // The parent (subscribe.tsx) is responsible for showing the timeout message
    const treeString = JSON.stringify(tree.toJSON())
    expect(treeString).not.toContain('Previous checkout timed out')
  })

  it('blocks subscribe when an active subscription exists on the other provider', async () => {
    mockUseAuthSubscription.mockReturnValue({
      planTier: 'monthly_20',
      planStatus: 'active',
      currentCredits: 100,
      grantedTotal: 100,
      termsVersion: null,
      termsAcceptedAt: null,
      nextExpiryDate: null,
      cancelAtPeriodEnd: false,
      subscriptionProvider: 'revenuecat',
    })

    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    expect(mockMakePackagePurchase).not.toHaveBeenCalled()
    expect(JSON.stringify(tree.toJSON())).toContain(
      'You already have an active subscription. Manage it on the platform where you subscribed.'
    )
    expect(subscribeButton.props.disabled).toBe(false)
  })

  it('shows the refresh message when the purchase fails with invalid-argument', async () => {
    const staleBundleError = Object.assign(new Error('stale price id'), {
      code: 'functions/invalid-argument',
    })
    mockMakePackagePurchase.mockRejectedValueOnce(staleBundleError)
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 10,000 Power - $10' })

    await act(async () => {
      await buyButton.props.onPress()
    })

    expect(JSON.stringify(tree.toJSON())).toContain(
      'This app version is out of date — please refresh and try again.'
    )
  })

  it('shows the generic message for other purchase errors', async () => {
    mockMakePackagePurchase.mockRejectedValueOnce(new Error('boom'))
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const buyButton = tree.root.findByProps({ testID: 'Buy 10,000 Power - $10' })

    await act(async () => {
      await buyButton.props.onPress()
    })

    expect(JSON.stringify(tree.toJSON())).toContain('Purchase failed. Please try again.')
  })

  it('allows subscribe when the active subscription is on the current (web/stripe) provider', async () => {
    mockUseAuthSubscription.mockReturnValue({
      planTier: 'monthly_20',
      planStatus: 'active',
      currentCredits: 100,
      grantedTotal: 100,
      termsVersion: null,
      termsAcceptedAt: null,
      nextExpiryDate: null,
      cancelAtPeriodEnd: false,
      subscriptionProvider: 'stripe',
    })

    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: '30,000 Power / month · $20' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    expect(mockMakePackagePurchase).toHaveBeenCalledWith('monthly_20')
  })
})

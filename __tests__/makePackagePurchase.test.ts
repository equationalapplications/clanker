let mockPlatformOS: 'web' | 'ios' | 'android' = 'web'

jest.mock('react-native', () => {
  return {
    Platform: {
      get OS() {
        return mockPlatformOS
      },
    },
    Linking: {
      openURL: jest.fn(),
    },
  }
})

jest.mock('~/config/constants', () => ({
  stripeMonthly20PriceId: 'price_monthly_20',
  stripeMonthly50PriceId: 'price_monthly_50',
  stripeCreditPackPriceId: 'price_credit_pack',
  REVENUECAT_PRODUCTS: {
    MONTHLY_20: 'monthly_20_subscription',
    get CREDIT_PACK() {
      return mockPlatformOS === 'ios' ? 'credit_100' : 'credit_pack_100'
    },
  },
}))

jest.mock('~/config/firebaseConfig', () => ({
  purchasePackageStripe: jest.fn(),
}))

jest.mock('~/config/revenueCatConfig', () => ({
  purchaseProduct: jest.fn(),
}))

jest.mock('~/config/supabaseClient', () => ({
  supabaseClient: {
    auth: {
      refreshSession: jest.fn(),
    },
  },
}))

type PlatformOS = 'web' | 'ios' | 'android'

function createHarness(platform: PlatformOS = 'web') {
  jest.resetModules()
  mockPlatformOS = platform

  const { Linking } = require('react-native')
  const { makePackagePurchase } = require('~/utilities/makePackagePurchase')
  const { purchasePackageStripe } = require('~/config/firebaseConfig')
  const { purchaseProduct } = require('~/config/revenueCatConfig')
  const { supabaseClient } = require('~/config/supabaseClient')

  const purchasePackageStripeMock = purchasePackageStripe as jest.Mock
  const purchaseProductMock = purchaseProduct as jest.Mock
  const openURLMock = Linking.openURL as jest.Mock
  const refreshSessionMock = supabaseClient.auth.refreshSession as jest.Mock

  purchasePackageStripeMock.mockResolvedValue({ data: 'https://checkout.stripe.test/session_1' })
  purchaseProductMock.mockResolvedValue({ entitlements: {} })
  refreshSessionMock.mockResolvedValue(undefined)

  return {
    makePackagePurchase,
    purchasePackageStripeMock,
    purchaseProductMock,
    openURLMock,
    refreshSessionMock,
  }
}

describe('makePackagePurchase', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockPlatformOS = 'web'
  })

  it('uses credit-pack Stripe price on web payg purchase', async () => {
    const { makePackagePurchase, purchasePackageStripeMock, purchaseProductMock, openURLMock } = createHarness('web')

    await makePackagePurchase('payg')

    expect(purchasePackageStripeMock).toHaveBeenCalledWith({ priceId: 'price_credit_pack' })
    expect(openURLMock).toHaveBeenCalledWith('https://checkout.stripe.test/session_1')
    expect(purchaseProductMock).not.toHaveBeenCalled()
  })

  it('uses monthly Stripe price on web subscription purchase', async () => {
    const { makePackagePurchase, purchasePackageStripeMock, purchaseProductMock, openURLMock } = createHarness('web')

    await makePackagePurchase('monthly_20')

    expect(purchasePackageStripeMock).toHaveBeenCalledWith({ priceId: 'price_monthly_20' })
    expect(openURLMock).toHaveBeenCalledWith('https://checkout.stripe.test/session_1')
    expect(purchaseProductMock).not.toHaveBeenCalled()
  })

  it('throws when Stripe checkout URL is missing on web', async () => {
    const { makePackagePurchase, purchasePackageStripeMock, openURLMock } = createHarness('web')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      purchasePackageStripeMock.mockResolvedValue({ data: '' })

      await expect(makePackagePurchase('payg')).rejects.toThrow('No checkout URL returned from Stripe. Please try again.')

      expect(openURLMock).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('uses RevenueCat and refreshes session on native', async () => {
    const { makePackagePurchase, purchasePackageStripeMock, purchaseProductMock, openURLMock, refreshSessionMock } = createHarness('ios')

    await makePackagePurchase('payg')

    expect(purchaseProductMock).toHaveBeenCalledWith('credit_100')
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    expect(purchasePackageStripeMock).not.toHaveBeenCalled()
    expect(openURLMock).not.toHaveBeenCalled()
  })

  it('uses Android RevenueCat product id on Android native', async () => {
    const { makePackagePurchase, purchasePackageStripeMock, purchaseProductMock, openURLMock, refreshSessionMock } = createHarness('android')

    await makePackagePurchase('payg')

    expect(purchaseProductMock).toHaveBeenCalledWith('credit_pack_100')
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    expect(purchasePackageStripeMock).not.toHaveBeenCalled()
    expect(openURLMock).not.toHaveBeenCalled()
  })

  it('does not refresh session when RevenueCat returns null customer info', async () => {
    const { makePackagePurchase, purchaseProductMock, refreshSessionMock } = createHarness('ios')
    purchaseProductMock.mockResolvedValueOnce(null)

    const result = await makePackagePurchase('monthly_20')

    expect(result).toBeNull()
    expect(purchaseProductMock).toHaveBeenCalledWith('monthly_20_subscription')
    expect(refreshSessionMock).not.toHaveBeenCalled()
  })

  it('rejects monthly_50 purchase while product is disabled', async () => {
    const { makePackagePurchase, purchaseProductMock, refreshSessionMock } = createHarness('ios')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(makePackagePurchase('monthly_50')).rejects.toThrow(
        'monthly_50 purchase is disabled until RevenueCat product setup is complete.',
      )
      expect(purchaseProductMock).not.toHaveBeenCalled()
      expect(refreshSessionMock).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('propagates errors when opening Stripe checkout URL fails', async () => {
    const { makePackagePurchase, openURLMock, refreshSessionMock } = createHarness('web')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    openURLMock.mockRejectedValueOnce(new Error('cannot open url'))

    try {
      await expect(makePackagePurchase('payg')).rejects.toThrow('cannot open url')
      expect(refreshSessionMock).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})

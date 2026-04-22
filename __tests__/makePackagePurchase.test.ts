let mockPlatformOS: 'web' | 'ios' | 'android' = 'web'
const mockRandomUUID = jest.fn(() => 'attempt-web-uuid')
const mockGetCurrentUser = jest.fn()
const mockUpsertCheckoutAttempt = jest.fn()
const mockPublish = jest.fn()
const mockClose = jest.fn()
const mockCreateCheckoutChannel = jest.fn(() => ({
  publish: mockPublish,
  subscribe: jest.fn(),
  close: mockClose,
}))

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
    get MONTHLY_20() {
      return mockPlatformOS === 'android'
        ? 'monthly_20_subscription:monthly-usd-20'
        : 'monthly_20_subscription'
    },
    get CREDIT_PACK() {
      return mockPlatformOS === 'ios' ? 'credit_100' : 'credit_pack_100'
    },
  },
}))

jest.mock('~/config/firebaseConfig', () => ({
  purchasePackageStripe: jest.fn(),
  getCurrentUser: () => mockGetCurrentUser(),
}))

jest.mock('~/config/revenueCatConfig', () => ({
  purchaseProduct: jest.fn(),
}))

jest.mock('~/utilities/checkoutStateStore', () => ({
  CHECKOUT_SCHEMA_VERSION: 1,
  upsertCheckoutAttempt: mockUpsertCheckoutAttempt,
}))

jest.mock('~/utilities/checkoutChannel', () => ({
  createCheckoutChannel: mockCreateCheckoutChannel,
}))

jest.mock('expo-crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}))

type PlatformOS = 'web' | 'ios' | 'android'

function createHarness(platform: PlatformOS = 'web') {
  jest.resetModules()
  mockPlatformOS = platform

  const { Linking } = require('react-native')
  const { makePackagePurchase } = require('~/utilities/makePackagePurchase')
  const { purchasePackageStripe } = require('~/config/firebaseConfig')
  const { purchaseProduct } = require('~/config/revenueCatConfig')

  const purchasePackageStripeMock = purchasePackageStripe as jest.Mock
  const purchaseProductMock = purchaseProduct as jest.Mock
  const openURLMock = Linking.openURL as jest.Mock

  purchasePackageStripeMock.mockResolvedValue({ data: 'https://checkout.stripe.test/session_1' })
  purchaseProductMock.mockResolvedValue({ entitlements: {} })

  return {
    makePackagePurchase,
    purchasePackageStripeMock,
    purchaseProductMock,
    openURLMock,
  }
}

describe('makePackagePurchase', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    mockPlatformOS = 'web'
    mockRandomUUID.mockReset()
    mockRandomUUID.mockReturnValue('attempt-web-uuid')
    mockGetCurrentUser.mockReturnValue({ uid: 'user-1' })
    mockCreateCheckoutChannel.mockReturnValue({
      publish: mockPublish,
      subscribe: jest.fn(),
      close: mockClose,
    })
    mockUpsertCheckoutAttempt.mockImplementation((_uid: string, incoming: unknown) => ({
      applied: true,
      record: incoming,
    }))
  })

  function withMockWindowLocation<T>(callback: (location: { href: string }) => Promise<T>): Promise<T> {
    const originalWindow = globalThis.window
    const mockLocation = { href: '' }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: { location: mockLocation } as unknown as Window,
    })

    return callback(mockLocation).finally(() => {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        writable: true,
        value: originalWindow,
      })
    })
  }

  it('uses credit-pack Stripe price on web payg purchase', async () => {
    await withMockWindowLocation(async location => {
      const {
        makePackagePurchase,
        purchasePackageStripeMock,
        purchaseProductMock,
        openURLMock,
      } = createHarness('web')

      await makePackagePurchase('payg')

      expect(mockRandomUUID).toHaveBeenCalledTimes(1)
      expect(purchasePackageStripeMock).toHaveBeenCalledWith({
        priceId: 'price_credit_pack',
        attemptId: 'attempt-web-uuid',
      })
      expect(location.href).toBe('https://checkout.stripe.test/session_1')
      expect(openURLMock).not.toHaveBeenCalled()
      expect(purchaseProductMock).not.toHaveBeenCalled()
    })
  })

  it('persists and publishes a pending checkout attempt before redirect on web', async () => {
    const sequence: string[] = []

    mockUpsertCheckoutAttempt.mockImplementation((_uid: string, incoming: unknown) => {
      sequence.push('persist')
      return {
        applied: true,
        record: incoming,
      }
    })
    mockPublish.mockImplementation(() => {
      sequence.push('publish')
    })

    await withMockWindowLocation(async location => {
      const {
        makePackagePurchase,
        purchasePackageStripeMock,
        purchaseProductMock,
        openURLMock,
      } = createHarness('web')

      let redirectedHref = ''
      Object.defineProperty(location, 'href', {
        configurable: true,
        get: () => redirectedHref,
        set: (value: string) => {
          sequence.push('redirect')
          redirectedHref = value
        },
      })

      await makePackagePurchase('payg')

      expect(purchasePackageStripeMock).toHaveBeenCalledWith({
        priceId: 'price_credit_pack',
        attemptId: 'attempt-web-uuid',
      })
      expect(mockCreateCheckoutChannel).toHaveBeenCalledWith({ uid: 'user-1' })
      expect(mockCreateCheckoutChannel).toHaveBeenCalledTimes(1)
      expect(mockUpsertCheckoutAttempt).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledTimes(1)
      expect(mockClose).toHaveBeenCalledTimes(1)
      expect(sequence).toEqual(['persist', 'publish', 'redirect'])

      expect(mockUpsertCheckoutAttempt).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          attemptId: 'attempt-web-uuid',
          productType: 'payg',
          status: 'pending',
          sourceTabId: expect.any(String),
          schemaVersion: 1,
        }),
      )

      const persistedRecord = mockUpsertCheckoutAttempt.mock.calls[0][1]

      expect(persistedRecord).toEqual(
        expect.objectContaining({
          at: expect.any(String),
        }),
      )
      expect(Number.isFinite(Date.parse((persistedRecord as { at: string }).at))).toBe(true)

      expect(mockPublish).toHaveBeenCalledWith({
        type: 'CHECKOUT_STARTED',
        payload: persistedRecord,
      })
      expect(redirectedHref).toBe('https://checkout.stripe.test/session_1')
      expect(openURLMock).not.toHaveBeenCalled()
      expect(purchaseProductMock).not.toHaveBeenCalled()
    })
  })

  it('uses monthly Stripe price on web subscription purchase', async () => {
    await withMockWindowLocation(async location => {
      const {
        makePackagePurchase,
        purchasePackageStripeMock,
        purchaseProductMock,
        openURLMock,
      } = createHarness('web')

      await makePackagePurchase('monthly_20')

      expect(purchasePackageStripeMock).toHaveBeenCalledWith({
        priceId: 'price_monthly_20',
        attemptId: 'attempt-web-uuid',
      })
      expect(location.href).toBe('https://checkout.stripe.test/session_1')
      expect(openURLMock).not.toHaveBeenCalled()
      expect(purchaseProductMock).not.toHaveBeenCalled()
    })
  })

  it('redirects on web without persisting when uid is unavailable', async () => {
    mockGetCurrentUser.mockReturnValue(null)

    await withMockWindowLocation(async location => {
      const {
        makePackagePurchase,
        purchasePackageStripeMock,
        purchaseProductMock,
        openURLMock,
      } = createHarness('web')

      await expect(makePackagePurchase('monthly_20')).resolves.toBeUndefined()

      expect(purchasePackageStripeMock).toHaveBeenCalledWith({
        priceId: 'price_monthly_20',
        attemptId: 'attempt-web-uuid',
      })
      expect(mockUpsertCheckoutAttempt).not.toHaveBeenCalled()
      expect(mockCreateCheckoutChannel).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
      expect(mockClose).not.toHaveBeenCalled()
      expect(location.href).toBe('https://checkout.stripe.test/session_1')
      expect(openURLMock).not.toHaveBeenCalled()
      expect(purchaseProductMock).not.toHaveBeenCalled()
    })
  })

  it('throws when Stripe checkout URL is missing on web', async () => {
    await withMockWindowLocation(async () => {
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
  })

  it('uses RevenueCat on native', async () => {
    const { makePackagePurchase, purchasePackageStripeMock, purchaseProductMock, openURLMock } = createHarness('ios')

    await makePackagePurchase('payg')

    expect(purchaseProductMock).toHaveBeenCalledWith('credit_100')
    expect(purchasePackageStripeMock).not.toHaveBeenCalled()
    expect(openURLMock).not.toHaveBeenCalled()
  })

  it('uses Android RevenueCat product id on Android native', async () => {
    const { makePackagePurchase, purchasePackageStripeMock, purchaseProductMock, openURLMock } = createHarness('android')

    await makePackagePurchase('payg')

    expect(purchaseProductMock).toHaveBeenCalledWith('credit_pack_100')
    expect(purchasePackageStripeMock).not.toHaveBeenCalled()
    expect(openURLMock).not.toHaveBeenCalled()
  })

  it('handles null customer info from RevenueCat', async () => {
    const { makePackagePurchase, purchaseProductMock } = createHarness('ios')
    purchaseProductMock.mockResolvedValueOnce(null)

    const result = await makePackagePurchase('monthly_20')

    expect(result).toBeNull()
    expect(purchaseProductMock).toHaveBeenCalledWith('monthly_20_subscription')
  })

  it('rejects monthly_50 purchase while product is disabled', async () => {
    const { makePackagePurchase, purchaseProductMock } = createHarness('ios')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await expect(makePackagePurchase('monthly_50')).rejects.toThrow(
        'monthly_50 purchase is disabled until RevenueCat product setup is complete.',
      )
      expect(purchaseProductMock).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('keeps native Linking path untouched on iOS', async () => {
    const { makePackagePurchase, purchaseProductMock, purchasePackageStripeMock, openURLMock } = createHarness('ios')

    await makePackagePurchase('monthly_20')

    expect(purchaseProductMock).toHaveBeenCalledWith('monthly_20_subscription')
    expect(purchasePackageStripeMock).not.toHaveBeenCalled()
    expect(openURLMock).not.toHaveBeenCalled()
  })

  it('uses Android base plan product id for monthly_20 on Android', async () => {
    const { makePackagePurchase, purchaseProductMock, purchasePackageStripeMock, openURLMock } = createHarness('android')

    await makePackagePurchase('monthly_20')

    expect(purchaseProductMock).toHaveBeenCalledWith('monthly_20_subscription:monthly-usd-20')
    expect(purchasePackageStripeMock).not.toHaveBeenCalled()
    expect(openURLMock).not.toHaveBeenCalled()
  })
})

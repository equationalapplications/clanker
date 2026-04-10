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
    MONTHLY_50: 'monthly_50_subscription',
    CREDIT_PACK: 'credit_pack_100',
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

import { Linking } from 'react-native'
import { makePackagePurchase } from '~/utilities/makePackagePurchase'
import { purchasePackageStripe } from '~/config/firebaseConfig'
import { purchaseProduct } from '~/config/revenueCatConfig'
import { supabaseClient } from '~/config/supabaseClient'

const purchasePackageStripeMock = purchasePackageStripe as jest.Mock
const purchaseProductMock = purchaseProduct as jest.Mock
const openURLMock = Linking.openURL as jest.Mock
const refreshSessionMock = supabaseClient.auth.refreshSession as jest.Mock

describe('makePackagePurchase', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockPlatformOS = 'web'
    purchasePackageStripeMock.mockResolvedValue({ data: 'https://checkout.stripe.test/session_1' })
    purchaseProductMock.mockResolvedValue({ entitlements: {} })
    refreshSessionMock.mockResolvedValue(undefined)
  })

  it('uses credit-pack Stripe price on web payg purchase', async () => {
    await makePackagePurchase('payg')

    expect(purchasePackageStripeMock).toHaveBeenCalledWith({ priceId: 'price_credit_pack' })
    expect(openURLMock).toHaveBeenCalledWith('https://checkout.stripe.test/session_1')
    expect(purchaseProductMock).not.toHaveBeenCalled()
  })

  it('uses monthly Stripe price on web subscription purchase', async () => {
    await makePackagePurchase('monthly_20')

    expect(purchasePackageStripeMock).toHaveBeenCalledWith({ priceId: 'price_monthly_20' })
    expect(openURLMock).toHaveBeenCalledWith('https://checkout.stripe.test/session_1')
    expect(purchaseProductMock).not.toHaveBeenCalled()
  })

  it('throws when Stripe checkout URL is missing on web', async () => {
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
    mockPlatformOS = 'ios'

    await makePackagePurchase('payg')

    expect(purchaseProductMock).toHaveBeenCalledWith('credit_pack_100')
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
    expect(purchasePackageStripeMock).not.toHaveBeenCalled()
    expect(openURLMock).not.toHaveBeenCalled()
  })
})

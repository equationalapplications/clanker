import { Linking, Platform } from 'react-native'
import {
  stripeMonthly20PriceId,
  stripeCreditPackPriceId,
  REVENUECAT_PRODUCTS,
} from '../config/constants'
import { purchasePackageStripe } from '../config/firebaseConfig'
import { purchaseProduct } from '../config/revenueCatConfig'
import { supabaseClient } from '../config/supabaseClient'

export type ProductType = 'monthly_20' | 'monthly_50' | 'payg'

type ActiveProductType = Exclude<ProductType, 'monthly_50'>

const STRIPE_PRICE_MAP: Record<ActiveProductType, string> = {
  monthly_20: stripeMonthly20PriceId,
  payg: stripeCreditPackPriceId,
}

const REVENUECAT_PRODUCT_MAP: Record<ActiveProductType, string> = {
  monthly_20: REVENUECAT_PRODUCTS.MONTHLY_20,
  payg: REVENUECAT_PRODUCTS.CREDIT_PACK,
}

export async function makePackagePurchase(productType: ProductType = 'monthly_20') {
  try {
    if (productType === 'monthly_50') {
      throw new Error('monthly_50 purchase is disabled until RevenueCat product setup is complete.')
    }

    const activeProductType = productType

    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      // Native: use RevenueCat for in-app purchases
      const productIdentifier = REVENUECAT_PRODUCT_MAP[activeProductType]
      const customerInfo = await purchaseProduct(productIdentifier)
      // Refresh claims only after successful purchase; no-op on cancellation/error null result.
      if (customerInfo !== null) {
        await supabaseClient.auth.refreshSession()
      }
      return customerInfo
    } else if (Platform.OS === 'web') {
      // Web: use Stripe checkout via Firebase Cloud Function
      const priceId = STRIPE_PRICE_MAP[activeProductType]
      const checkoutUrlData = await purchasePackageStripe({ priceId })
      const checkoutUrl = (checkoutUrlData as any)?.data || ''

      if (checkoutUrl) {
        await Linking.openURL(checkoutUrl)
      } else {
        throw new Error('No checkout URL returned from Stripe. Please try again.')
      }
    }
  } catch (error) {
    console.error('Purchase error:', error)
    throw error
  }
}
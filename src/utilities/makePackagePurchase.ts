import { Linking, Platform } from 'react-native'
import {
  stripeMonthly20PriceId,
  stripeMonthly50PriceId,
  stripeCreditPackPriceId,
  REVENUECAT_PRODUCTS,
} from '../config/constants'
import { purchasePackageStripe } from '../config/firebaseConfig'
import { purchaseProduct } from '../config/revenueCatConfig'
import { supabaseClient } from '../config/supabaseClient'

export type ProductType = 'monthly_20' | 'monthly_50' | 'payg'

const STRIPE_PRICE_MAP: Record<ProductType, string> = {
  monthly_20: stripeMonthly20PriceId,
  monthly_50: stripeMonthly50PriceId,
  payg: stripeCreditPackPriceId,
}

const REVENUECAT_PRODUCT_MAP: Record<ProductType, string> = {
  monthly_20: REVENUECAT_PRODUCTS.MONTHLY_20,
  monthly_50: REVENUECAT_PRODUCTS.MONTHLY_50,
  payg: REVENUECAT_PRODUCTS.CREDIT_PACK,
}

export async function makePackagePurchase(productType: ProductType = 'monthly_20') {
  try {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      // Native: use RevenueCat for in-app purchases
      const productIdentifier = REVENUECAT_PRODUCT_MAP[productType]
      const customerInfo = await purchaseProduct(productIdentifier)
      // Refresh Supabase session so JWT custom claims (plans) reflect the new subscription tier
      await supabaseClient.auth.refreshSession()
      return customerInfo
    } else if (Platform.OS === 'web') {
      // Web: use Stripe checkout via Firebase Cloud Function
      const priceId = STRIPE_PRICE_MAP[productType]
      const checkoutUrlData = await purchasePackageStripe({ priceId })
      const checkoutUrl = (checkoutUrlData as any)?.data || ''

      if (checkoutUrl) {
        await Linking.openURL(checkoutUrl)
      } else {
        const msg = 'No checkout URL returned from Stripe. Please try again.'
        console.error(msg)
        if (typeof window !== 'undefined') {
          window.alert(msg)
        }
      }
    }
  } catch (error) {
    console.error('Purchase error:', error)
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.alert('Something went wrong starting checkout. Please try again.')
    }
    throw error
  }
}
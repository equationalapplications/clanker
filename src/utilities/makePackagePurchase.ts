import { Linking, Platform } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  stripeMonthly20PriceId,
  stripeCreditPackPriceId,
  REVENUECAT_PRODUCTS,
} from '../config/constants'
import { getCurrentUser, purchasePackageStripe } from '../config/firebaseConfig'
import { purchaseProduct } from '../config/revenueCatConfig'
import { createCheckoutChannel } from './checkoutChannel'
import {
  CHECKOUT_SCHEMA_VERSION,
  type CheckoutAttemptRecord,
  upsertCheckoutAttempt,
} from './checkoutStateStore'

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

const CHECKOUT_SOURCE_TAB_STORAGE_KEY = 'checkout:source-tab-id'

function getCheckoutSourceTabId(fallbackTabId: string): string {
  if (typeof window === 'undefined') {
    return fallbackTabId
  }

  try {
    const storage = globalThis.sessionStorage ?? window.sessionStorage
    const existingTabId = storage?.getItem(CHECKOUT_SOURCE_TAB_STORAGE_KEY)

    if (existingTabId) {
      return existingTabId
    }

    storage?.setItem(CHECKOUT_SOURCE_TAB_STORAGE_KEY, fallbackTabId)
  } catch {
    return fallbackTabId
  }

  return fallbackTabId
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
      // Callers handle native post-purchase refresh for credits and subscription UI state.
      return customerInfo
    } else if (Platform.OS === 'web') {
      // Web: use Stripe checkout via Firebase Cloud Function
      const priceId = STRIPE_PRICE_MAP[activeProductType]
      const attemptId = randomUUID()
      const checkoutUrlData = await purchasePackageStripe({ priceId, attemptId })
      const checkoutUrl = (checkoutUrlData as any)?.data || ''

      if (checkoutUrl) {
        const uid = getCurrentUser()?.uid ?? null

        if (uid) {
          const pendingAttempt: CheckoutAttemptRecord = {
            attemptId,
            productType: activeProductType,
            status: 'pending',
            at: new Date().toISOString(),
            sourceTabId: getCheckoutSourceTabId(attemptId),
            schemaVersion: CHECKOUT_SCHEMA_VERSION,
          }
          const { record } = upsertCheckoutAttempt(uid, pendingAttempt)
          const channel = createCheckoutChannel({ uid })

          try {
            channel.publish({
              type: 'CHECKOUT_STARTED',
              payload: record ?? pendingAttempt,
            })
          } finally {
            channel.close()
          }
        }

        if (typeof window !== 'undefined' && window.location) {
          window.location.href = checkoutUrl
        } else {
          await Linking.openURL(checkoutUrl)
        }
      } else {
        throw new Error('No checkout URL returned from Stripe. Please try again.')
      }
    }
  } catch (error) {
    console.error('Purchase error:', error)
    throw error
  }
}
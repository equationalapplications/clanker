import { Platform } from 'react-native'
import Purchases, {
  PURCHASE_TYPE,
  type CustomerInfo,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from 'react-native-purchases'

let isInitialized = false

/**
 * Initialize RevenueCat SDK for iOS/Android.
 * Must be called once during native app startup.
 */
export async function initializeRevenueCat(): Promise<void> {
  if (Platform.OS === 'web') return

  const appleKey = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY
  const googleKey = process.env.EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY

  const apiKey = Platform.OS === 'ios' ? appleKey : googleKey

  if (!apiKey) {
    console.warn(
      `⚠️ RevenueCat API key not set for ${Platform.OS}. ` +
        'Set EXPO_PUBLIC_REVENUECAT_APPLE_KEY or EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY.',
    )
    return
  }

  try {
    Purchases.configure({ apiKey })
    isInitialized = true
    console.log('✅ RevenueCat initialized successfully.')
  } catch (error) {
    console.error('❌ Error initializing RevenueCat:', error)
  }
}

/**
 * Purchase a product by its RevenueCat product identifier.
 * Returns the CustomerInfo after a successful purchase.
 */
export async function purchaseProduct(productIdentifier: string): Promise<CustomerInfo | null> {
  if (!isInitialized) {
    throw new Error('RevenueCat is not initialized. Call initializeRevenueCat() first.')
  }

  try {
    const offerings = await Purchases.getOfferings()
    let packageToPurchase: PurchasesPackage | undefined

    // Search all offerings for the matching product
    for (const offering of Object.values(offerings.all)) {
      const found = offering.availablePackages.find(
        (pkg) => pkg.product.identifier === productIdentifier,
      )
      if (found) {
        packageToPurchase = found
        break
      }
    }

    if (!packageToPurchase) {
      const allProductIds = Object.values(offerings.all).flatMap((o) =>
        o.availablePackages.map((p) => p.product.identifier),
      )

      // Fallback for products that exist in RevenueCat but are not assigned
      // to an offering package (common with one-time consumables).
      const inAppProducts = await Purchases.getProducts(
        [productIdentifier],
        PURCHASE_TYPE.INAPP,
      )
      const subsProducts = await Purchases.getProducts([productIdentifier], PURCHASE_TYPE.SUBS)

      const matchedProduct: PurchasesStoreProduct | undefined = [
        ...inAppProducts,
        ...subsProducts,
      ].find((product) => product.identifier === productIdentifier)

      if (!matchedProduct) {
        throw new Error(
          `Product "${productIdentifier}" not found. ` +
          `Offerings: [${Object.keys(offerings.all).join(', ')}]. ` +
          `Offering products: [${allProductIds.join(', ')}]. ` +
          `INAPP: [${inAppProducts.map((p) => p.identifier).join(', ')}]. ` +
          `SUBS: [${subsProducts.map((p) => p.identifier).join(', ')}].`,
        )
      }

      const { customerInfo } = await Purchases.purchaseStoreProduct(matchedProduct)
      console.log('✅ Purchase successful via direct store product fallback.')
      return customerInfo
    }

    const { customerInfo } = await Purchases.purchasePackage(packageToPurchase)
    console.log('✅ Purchase successful.')
    return customerInfo
  } catch (error: any) {
    if (error.userCancelled) {
      console.log('Purchase cancelled by user.')
      return null
    }
    console.error('❌ Purchase error:', error)
    throw error
  }
}

/**
 * Get the current customer's subscription info from RevenueCat.
 */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isInitialized) {
    console.error('RevenueCat is not initialized.')
    return null
  }

  try {
    return await Purchases.getCustomerInfo()
  } catch (error) {
    console.error('❌ Error getting customer info:', error)
    return null
  }
}

/**
 * Restore previous purchases (e.g. after reinstall or device switch).
 */
export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!isInitialized) {
    console.error('RevenueCat is not initialized.')
    return null
  }

  try {
    const customerInfo = await Purchases.restorePurchases()
    console.log('✅ Purchases restored successfully.')
    return customerInfo
  } catch (error) {
    console.error('❌ Error restoring purchases:', error)
    return null
  }
}

/**
 * Link RevenueCat's subscriber identity to a known user ID (Firebase UID).
 * Call this after Firebase authentication succeeds so webhook payloads carry
 * the Firebase UID as app_user_id instead of an anonymous RevenueCat ID.
 */
export async function loginRevenueCat(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !isInitialized) return

  try {
    await Purchases.logIn(userId)
    console.log('✅ RevenueCat identity linked to Firebase UID.')
  } catch (error) {
    console.error('❌ Error linking RevenueCat identity:', error)
  }
}

/**
 * Revert RevenueCat to an anonymous user on sign-out.
 * Call this alongside Firebase sign-out.
 */
export async function logoutRevenueCat(): Promise<void> {
  if (Platform.OS === 'web' || !isInitialized) return

  try {
    await Purchases.logOut()
    console.log('✅ RevenueCat logged out.')
  } catch (error) {
    console.error('❌ Error logging out from RevenueCat:', error)
  }
}

import Purchases, { CustomerInfo } from "react-native-purchases"

import {
  platform,
  revenueCatPurchasesStripeApiKey,
  revenueCatSubscribersApi,
} from "../config/constants"
import { auth } from "../config/firebaseConfig"
import { Subscriber } from "../config/purchasesConfig"

interface PurchasesOfferingsData {
  subscriber: Subscriber
}

export const getIsPremium = async (): Promise<boolean> => {
  if (!auth.currentUser) {
    return false
  }
  const uid = auth?.currentUser?.uid

  if (platform === "ios" || platform === "android") {
    const customerInfo: CustomerInfo = await Purchases.getCustomerInfo()
    const entitlements = customerInfo?.entitlements

    return entitlements && Object.keys(entitlements?.active)?.length > 0
  } else if (platform === "web") {
    let retryCount = 0
    while (retryCount < 3) {
      try {
        const response = await fetch(revenueCatSubscribersApi + "/" + uid, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${revenueCatPurchasesStripeApiKey}`,
          },
        })

        if (response.status !== 200) {
          throw new Error(`Failed to get user subscription data. Status code: ${response.status}`)
        }

        const purchasesOfferingsData: PurchasesOfferingsData = await response.json()
        const subscriber = purchasesOfferingsData?.subscriber
        const entitlements = subscriber?.entitlements ?? {}
        return entitlements && Object.keys(entitlements)?.length > 0
      } catch (error) {
        retryCount += 1
        if (retryCount === 3) {
          // send error to error boundary component
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, 30000)) // wait for 30 seconds before retrying
      }
    }
  }

  return false
}

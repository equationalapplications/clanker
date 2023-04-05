import * as WebBrowser from "expo-web-browser"
import { httpsCallable } from "firebase/functions"
import Purchases from "react-native-purchases"

import {
  platform,
  stripeMontlySubscriptionPriceId,
  AndroidIosMonthlySubscriptionPurchasePackage,
} from "../config/constants"
import { functions } from "../config/firebaseConfig"
import { queryClient } from "../config/queryClient"

const purchasePackageStripe: any = httpsCallable(functions, "purchasePackageStripe")

export const updateIsPremium = (data: boolean) => {
  // optimistically update the cache value for `isPremium`
  queryClient.setQueryData<boolean>("isPremium", data)
}

export async function makePackagePurchase() {
  try {
    if (platform === "ios" || platform === "android") {
      // Purchase package using the Purchases SDK
      await Purchases.purchasePackage(AndroidIosMonthlySubscriptionPurchasePackage)

      // Optimistically update the cache value for `isPremium` to true
      updateIsPremium(true)
    } else if (platform === "web") {
      // Get the checkout URL from Firebase Cloud Functions
      const checkoutUrlData = await purchasePackageStripe({ stripeMontlySubscriptionPriceId })
      const checkoutUrl = checkoutUrlData?.data || ""
      if (checkoutUrl) {
        // Open the checkout URL in a new browser window
        await WebBrowser.openBrowserAsync(checkoutUrl)

        // Optimistically update the cache value for `isPremium` to true
        updateIsPremium(true)
      }
    }
  } catch (error) {
    console.log("Error: ", error)
  }
}

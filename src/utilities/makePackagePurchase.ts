// TODO: Install expo-web-browser dependency
// import * as WebBrowser from "expo-web-browser"
import { httpsCallable } from "firebase/functions"
import Purchases from "react-native-purchases"

import {
  platform,
  stripeMontlySubscriptionPriceId,
  AndroidIosMonthlySubscriptionPurchasePackage,
} from "../config/constants"
import { functions } from "../config/firebaseConfig"

const purchasePackageStripe: any = httpsCallable(functions, "purchasePackageStripe")

export async function makePackagePurchase() {
  try {
    if (platform === "ios" || platform === "android") {
      // Purchase package using the Purchases SDK
      await Purchases.purchasePackage(AndroidIosMonthlySubscriptionPurchasePackage)
    } else if (platform === "web") {
      // Get the checkout URL from Firebase Cloud Functions
      const checkoutUrlData = await purchasePackageStripe({ stripeMontlySubscriptionPriceId })
      const checkoutUrl = checkoutUrlData?.data || ""
      if (checkoutUrl) {
        // TODO: Implement web browser opening when expo-web-browser is available
        // await WebBrowser.openBrowserAsync(checkoutUrl)
        console.log("Would open checkout URL:", checkoutUrl)
      }
    }
  } catch (error) {
    console.log("Error: ", error)
  }
}

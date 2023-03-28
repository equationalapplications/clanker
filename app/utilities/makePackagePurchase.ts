import * as WebBrowser from "expo-web-browser"
import { httpsCallable } from "firebase/functions"
import Purchases from "react-native-purchases"

import { platform, stripeMontlySubscriptionPriceId, AndroidIosMonthlySubscriptionPurchasePackage } from "../config/constants"
import { functions } from "../config/firebaseConfig"

const purchasePackageStripe: any = httpsCallable(functions, "purchasePackageStripe")

export default async function makePackagePurchase() {
  try {
    if (platform === "ios" || platform === "android") {
      await Purchases.purchasePackage(AndroidIosMonthlySubscriptionPurchasePackage)
    } else if (platform === "web") {
      const checkoutUrlData = await purchasePackageStripe({ stripeMontlySubscriptionPriceId })
      const checkoutUrl = checkoutUrlData?.data || ""
      if (checkoutUrl) {
        await WebBrowser.openBrowserAsync(checkoutUrl)
      }
    }
  } catch (error) {
    console.log("Error: ", error)
  }
}

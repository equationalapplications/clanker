import * as WebBrowser from "expo-web-browser"
import { User } from "firebase/auth"
import { httpsCallable } from "firebase/functions"
import Purchases, { PurchasesPackage } from "react-native-purchases"

import { platform } from "../config/constants"
import { functions } from "../config/firebaseConfig"

const purchasePackageStripe: any = httpsCallable(functions, "purchasePackageStripe")

export default async function makePackagePurchase({
  purchasePackage,
  user,
}: {
  purchasePackage: PurchasesPackage
  user: User
}) {
  try {
    if (platform === "ios" || platform === "android") {
      const purchase = await Purchases.purchasePackage(purchasePackage)
    } else if (platform === "web") {
      const purchasePackageId = purchasePackage?.platform_product_identifier || ""
      console.log("purchasePackageId: ", purchasePackageId)
      const checkoutUrlData = await purchasePackageStripe({ purchasePackageId })
      const checkoutUrl = checkoutUrlData?.data || ""

      console.log("checkoutUrl: ", checkoutUrl)
      if (checkoutUrl) {
        await WebBrowser.openBrowserAsync(checkoutUrl)
      }
    }
  } catch (error) {
    console.log("Error: ", error)
  }
}

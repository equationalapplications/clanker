import Purchases from "react-native-purchases"

import {
  platform,
  revenueCatPurchasesIosApiKey,
  revenueCatPurchasesAndroidApiKey,
} from "./constants"

export const initializePurchases = async (userId: string) => {
  try {
    const apiKey =
      platform === "ios"
        ? revenueCatPurchasesIosApiKey
        : platform === "android"
        ? revenueCatPurchasesAndroidApiKey
        : null

    if (!apiKey) {
      throw new Error(`Invalid API key for platform ${platform}`)
    }

    await Purchases.setDebugLogsEnabled(true)
    await Purchases.setup(apiKey, userId)
  } catch (error) {
    console.log("Error setting up Purchases:", error)
  }
}

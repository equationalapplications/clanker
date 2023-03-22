import Purchases from "react-native-purchases"

import {
  platform,
  revenueCatPurchasesIosApiKey,
  revenueCatPurchasesAndroidApiKey,
} from "./constants"

export const purchasesConfig = async (userId: string) => {
  if (platform === "ios") {
    Purchases.setDebugLogsEnabled(true)
    await Purchases.configure({
      apiKey: revenueCatPurchasesIosApiKey,
      appUserID: userId,
    })
  } else if (platform === "android") {
    Purchases.setDebugLogsEnabled(true)
    await Purchases.configure({
      apiKey: revenueCatPurchasesAndroidApiKey,
      appUserID: userId,
      observerMode: false,
      useAmazon: false,
    })
    // OR: if building for Amazon, be sure to follow the installation instructions then:
    // await Purchases.configure({ apiKey: '<public_amazon_api_key>', useAmazon: true });
  } else if (platform === "web") {
    // Configure Axios to use the same origin as the web app
    // axios.defaults.baseURL = window.location.origin;
    //const idTokenUser = await user?.getIdToken()
    //setIdToken(idTokenUser)
  }
}

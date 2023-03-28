import Constants from "expo-constants"
import { PurchasesPackage } from "react-native-purchases"
import { Platform } from "react-native"

export const platform =
  Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web"

export const googleWebClientId = Constants.expoConfig?.extra?.googleWebClientId
export const googleAndroidClientId = Constants.expoConfig?.extra?.googleAndroidClientId
export const facebookAuthAppId = Constants.expoConfig?.extra?.facebookAuthAppId

export const firebaseApiKey = Constants.expoConfig?.extra?.firebaseApiKey
export const firebaseAuthDomain = Constants.expoConfig?.extra?.firebaseAuthDomain
export const firebaseProjectId = Constants.expoConfig?.extra?.firebaseProjectId
export const firebaseStorageBucket = Constants.expoConfig?.extra?.firebaseStorageBucket
export const firebaseMessagingSenderId = Constants.expoConfig?.extra?.firebaseMessagingSenderId
export const firebaseAppId = Constants.expoConfig?.extra?.firebaseAppId

export const charactersCollection = Constants.expoConfig?.extra?.charactersCollection
export const userCharactersCollection = Constants.expoConfig?.extra?.userCharactersCollection
export const userChatsCollection = Constants.expoConfig?.extra?.userChatsCollection
export const messagesCollection = Constants.expoConfig?.extra?.messagesCollection
export const usersPublicCollection = Constants.expoConfig?.extra?.usersPublicCollection
export const usersPrivateCollection = Constants.expoConfig?.extra?.usersPrivateCollection

export const revenueCatPurchasesIosApiKey =
  Constants.expoConfig?.extra?.revenueCatPurchasesIosApiKey
export const revenueCatPurchasesAndroidApiKey =
  Constants.expoConfig?.extra?.revenueCatPurchasesAndroidApiKey
export const revenueCatPurchasesStripeApiKey =
  Constants.expoConfig?.extra?.revenueCatPurchasesStripeApiKey
export const revenueCatPurchasesEntitlementId =
  Constants.expoConfig?.extra?.revenueCatPurchasesEntitlementId
export const purchasesRevenueCatStripeUrl =
  "https://us-central1-your-brightly-ai.cloudfunctions.net/getCustomerInfoRevenueCatStripe"
export const revenueCatBaseUrl = "https://api.revenuecat.com/v1"
export const stripeCustomerPortal = "https://billing.stripe.com/p/login/28obLIehA711btKcMM"
export const stripeMontlySubscriptionPriceId = "price_1MVejqDTb0norRA06zwoexic"
export const AndroidIosMonthlySubscriptionPurchasePackage: PurchasesPackage = {
  "identifier": "$rc_monthly",
  "offeringIdentifier": "premium",
  "packageType": "MONTHLY",
  "product": {
    "currencyCode": "USD",
    "description": "",
    "discounts": null,
    "identifier": "premium",
    "introPrice": null,
    "price": 4.99,
    "priceString": "$4.99",
    "productCategory": "SUBSCRIPTION",
    "productType": "AUTO_RENEWABLE_SUBSCRIPTION",
    "subscriptionPeriod": "P1M",
    "title": "Yours Brightly AI Subscription (Yours Brightly AI)"
  }
}

export const defaultAvatarUrl = Constants.expoConfig?.extra?.defaultAvatarUrl

export const appBaseUrl = "https://yours-brightly-ai.equationalapplications.com"

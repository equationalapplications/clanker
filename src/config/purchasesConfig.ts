import Purchases from "react-native-purchases"

import {
  platform,
  revenueCatPurchasesIosApiKey,
  revenueCatPurchasesAndroidApiKey,
} from "./constants"

export interface Subscriber {
  original_app_user_id: string
  original_application_version: string | null
  original_purchase_date: string | null
  management_url: string | null
  first_seen: string
  last_seen: string
  entitlements: Record<string, Entitlement>
  subscriptions: Record<string, Subscription>
  non_subscriptions: Record<string, NonSubscription[]>
  other_purchases: Record<string, NonSubscription[]> // deprecated
  subscriber_attributes: Record<string, SubscriberAttribute>
}

export interface Entitlement {
  expires_date: string
  grace_period_expires_date: string | null
  purchase_date: string
  product_identifier: string
}

export interface Subscription {
  expires_date: string
  purchase_date: string
  original_purchase_date: string
  ownership_type: "PURCHASED" | "FAMILY_SHARED"
  period_type: "normal" | "trial" | "intro"
  store: "app_store" | "mac_app_store" | "play_store" | "amazon" | "stripe" | "promotional"
  is_sandbox: boolean
  unsubscribe_detected_at: string | null
  billing_issues_detected_at: string | null
  grace_period_expires_date: string | null
  refunded_at: string | null
  auto_resume_date: string | null
}

export interface NonSubscription {
  id: string
  purchase_date: string
  store: "app_store" | "mac_app_store" | "play_store" | "amazon" | "stripe"
  is_sandbox: boolean
}

export interface SubscriberAttribute {
  value: string
  updated_at_ms: number
}

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
      // observerMode: false, // deprecated property
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

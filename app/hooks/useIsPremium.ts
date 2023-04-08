import { User } from "firebase/auth"
import { useEffect } from "react"
import Purchases, { CustomerInfo } from "react-native-purchases"
import { useQuery } from "react-query"

import useUser from "./useUser"
import {
  platform,
  revenueCatPurchasesStripeApiKey,
  revenueCatBaseUrl,
  revenueCatSubscribers,
} from "../config/constants"
import { Subscriber } from "../config/purchasesConfig"

interface PurchasesOfferingsData {
  subscriber: Subscriber
}

const fetchPremiumStatus = async (user: User): Promise<boolean | null> => {
  if (!user) {
    return null
  }

  if (platform === "ios" || platform === "android") {
    const customerInfo: CustomerInfo = await Purchases.getCustomerInfo()
    const entitlements = customerInfo?.entitlements

    return entitlements && Object.keys(entitlements?.active).length > 0
  } else if (platform === "web") {
    const response = await fetch(revenueCatBaseUrl + revenueCatSubscribers + "/" + user.uid, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${revenueCatPurchasesStripeApiKey}`,
      },
    })
    const purchasesOfferingsData: PurchasesOfferingsData = await response.json()
    const subscriber = purchasesOfferingsData?.subscriber
    const entitlements = subscriber?.entitlements ?? {}

    return entitlements && Object.keys(entitlements).length > 0
  }

  return null
}

export const useIsPremium = (): boolean | null => {
  const user = useUser()

  const { data: isPremium, refetch } = useQuery<boolean | null>(
    "isPremium",
    () => fetchPremiumStatus(user),
    {
      enabled: !!user,
      refetchOnWindowFocus: false,
      retry: false,
      staleTime: Infinity,
      useErrorBoundary: true,
    },
  )

  useEffect(() => {
    if (user) {
      refetch()
    }
  }, [user, refetch])

  return isPremium
}

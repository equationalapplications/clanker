import { useEffect, useState } from "react"
import Purchases, { CustomerInfo } from "react-native-purchases"

import {
  platform,
  purchasesRevenueCatStripeUrl,
  revenueCatPurchasesEntitlementId,
} from "../config/constants"
import useUser from "../hooks/useUser"
import { useIsPremium } from "./useIsPremium"

const useCustomerInfo = (): CustomerInfo | null => {
  const user = useUser()
  const isPremium = useIsPremium()

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(null)

  useEffect(() => {
    const fetchCustomerInfo = async () => {
      try {
        if (platform === "ios" || platform === "android") {
          const customerInfoData = await Purchases.getCustomerInfo()
          const revenuecatIsPremium =
            customerInfoData?.entitlements?.active?.hasOwnProperty(
              revenueCatPurchasesEntitlementId,
            ) ?? false
          setCustomerInfo(customerInfoData)
        } else if (platform === "web") {
          const idToken = await user?.getIdToken()
          const response = await fetch(purchasesRevenueCatStripeUrl, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
          })
          const customerInfoData = await response.json()
          const activeSubscriptions = customerInfoData?.subscriber?.subscriptions
          const revenuecatIsPremium = activeSubscriptions?.length > 0 ?? false
          console.log(activeSubscriptions)
          setCustomerInfo(activeSubscriptions)
        }
      } catch (e) {
        console.log(e)
      }
    }
    if (user) {
      fetchCustomerInfo()
    }
  }, [user])

  return customerInfo
}

export default useCustomerInfo

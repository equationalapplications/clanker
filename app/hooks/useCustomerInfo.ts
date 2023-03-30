import { useEffect, useState } from "react"
import Purchases, { CustomerInfo } from "react-native-purchases"

import {
  platform,
  purchasesRevenueCatStripeUrl,
  revenueCatPurchasesEntitlementId,
} from "../config/constants"
import useUser from "../hooks/useUser"
import setIsPremium from "../utilities/setIsPremium"
import useUserPrivate from "./useUserPrivate"

const useCustomerInfo = (): CustomerInfo | null => {
  const user = useUser()
  const userPrivate = useUserPrivate()
  const isPremium = userPrivate?.isPremium

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
          if (revenuecatIsPremium == !isPremium) {
            setIsPremium()
          }
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
          if (revenuecatIsPremium == !isPremium) {
            setIsPremium()
          }
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

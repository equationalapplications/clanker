import { useEffect, useState } from "react"
import Purchases, { CustomerInfo } from "react-native-purchases"

import { platform, purchasesRevenueCatStripeUrl } from "../config/constants"
import useUser from "../hooks/useUser"

const useCustomerInfo = (): CustomerInfo | null => {
  const user = useUser()

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(null)

  useEffect(() => {
    const fetchCustomerInfo = async () => {
      try {
        if (platform === "ios" || platform === "android") {
          const customerInfoData = await Purchases.getCustomerInfo()
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

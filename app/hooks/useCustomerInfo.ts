import { useEffect, useState } from "react"
import Purchases, { CustomerInfo } from "react-native-purchases"

import { platform, purchasesRevenueCatStripeUrl } from "../config/constants"
import useUser from "../hooks/useUser"

const useCustomerInfo = (): [CustomerInfo, boolean, Error | null] => {
  const user = useUser()
  const uid = user?.uid

  const [customerInfo, setCustomerInfo] = useState<CustomerInfo>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

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
        setError(e)
        setLoading(false)
      }
    }
    fetchCustomerInfo()
  }, [])

  return [customerInfo, loading, error]
}

export default useCustomerInfo

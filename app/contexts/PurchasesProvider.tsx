import React, { createContext, useEffect, useState, ReactNode } from "react"
import Purchases, { CustomerInfo } from "react-native-purchases"

import {
  platform,
  revenueCatPurchasesAndroidApiKey,
  revenueCatPurchasesIosApiKey,
  purchasesRevenueCatStripeUrl,
} from "../config/constants"
import useUser from "../hooks/useUser"

const fetch = require("node-fetch")

interface PurchasesProviderProps {
  children: ReactNode
}

interface PurchasesContextValue {
  customerInfo: CustomerInfo | null
}

const initialContextValue: PurchasesContextValue = {
  customerInfo: null,
}

export const PurchasesContext = createContext<PurchasesContextValue>(initialContextValue)

export const PurchasesProvider: React.FC<PurchasesProviderProps> = ({ children }) => {
  const user = useUser()
  const uid = user?.uid
  const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null)
  const [idToken, setIdToken] = useState<any | null>(null)

  useEffect(() => {
    const configurePurchases = async () => {
      if (platform === "ios") {
        Purchases.setDebugLogsEnabled(true)
        await Purchases.configure({
          apiKey: revenueCatPurchasesIosApiKey,
          appUserID: user?.uid,
        })
      } else if (platform === "android") {
        console.log("p prov", revenueCatPurchasesAndroidApiKey)
        Purchases.setDebugLogsEnabled(true)
        await Purchases.configure({
          apiKey: revenueCatPurchasesAndroidApiKey,
          appUserID: user?.uid,
          observerMode: false,
          useAmazon: false,
        })
        // OR: if building for Amazon, be sure to follow the installation instructions then:
        // await Purchases.configure({ apiKey: '<public_amazon_api_key>', useAmazon: true });
      } else if (platform === "web") {
        // Configure Axios to use the same origin as the web app
        // axios.defaults.baseURL = window.location.origin;
        const idTokenUser = await user?.getIdToken()
        setIdToken(idTokenUser)
      }
    }

    const getCustomerInfo = async () => {
      try {
        if (platform === "ios" || platform === "android") {
          const customerInfoData = await Purchases.getCustomerInfo()
          setCustomerInfo(customerInfoData)
        } else if (platform === "web") {
          try {
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
          } catch (e) {
            console.log(e)
          }
        }
      } catch (e) {
        console.log(e)
      }
    }

    if (user?.uid) {
      ;(async () => {
        await configurePurchases()
        if (idToken) {
          await getCustomerInfo()
        }
      })()
    } else {
      setCustomerInfo(null)
    }
  }, [user?.uid, idToken])

  const contextValue: PurchasesContextValue = {
    customerInfo,
  }

  return <PurchasesContext.Provider value={contextValue}>{children}</PurchasesContext.Provider>
}

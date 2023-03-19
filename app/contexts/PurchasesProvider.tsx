import Constants from "expo-constants"
import React, { createContext, useEffect, useState, ReactNode } from "react"
import { Platform } from "react-native"
import Purchases, { CustomerInfo } from "react-native-purchases"

import useUser from "../hooks/useUser"

const revenueCatPurchasesAndroidApiKey = Constants.manifest.extra.revenueCatPurchasesAndroidApiKey
const revenueCatPurchasesIosApiKey = Constants.manifest.extra.revenueCatPurchasesIosApiKey
const revenueCatPurchasesStripeApiKey = Constants.manifest.extra.revenueCatPurchasesStripeApiKey
const revenueCatPurchasesEntitlementId = Constants.manifest.extra.revenueCatPurchasesEntitlementId

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
    const [customerInfo, setCustomerInfo] = useState<CustomerInfo | null>(null)

    useEffect(() => {
        // Purchases.setDebugLogsEnabled(true)

        const configurePurchases = async () => {
            if (Platform.OS === "ios") {
                // await Purchases.configure({ apiKey: '<public_apple_api_key>' });
            } else if (Platform.OS === "android") {
                // await Purchases.configure({
                //     apiKey: revenueCatPurchasesAndroidApiKey,
                //     appUserID: user?.uid,
                //     observerMode: false,
                //     useAmazon: false,
                // })

                // OR: if building for Amazon, be sure to follow the installation instructions then:
                // await Purchases.configure({ apiKey: '<public_amazon_api_key>', useAmazon: true });
            } else if (Platform.OS === "web") {
                //  await Purchases.configure({
                //      apiKey: revenueCatPurchasesStripeApiKey,
                //      appUserID: user?.uid,
                //      observerMode: false,
                //  })
            }
        }

        const getCustomerInfo = async () => {
            try {
                //   const customerInfoData = await Purchases.getCustomerInfo()
                //   setCustomerInfo(customerInfoData)
            } catch (e) {
                console.log(e)
            }
        }

        if (user?.uid) {
            configurePurchases().then(() => {
                getCustomerInfo()
            })
        } else {
            setCustomerInfo(null)
        }
    }, [user?.uid])

    const contextValue: PurchasesContextValue = {
        customerInfo,
    }

    return <PurchasesContext.Provider value={contextValue}>{children}</PurchasesContext.Provider>
}

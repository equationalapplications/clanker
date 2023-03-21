import Constants from "expo-constants"
import { getIdToken } from "firebase/auth"
import React, { createContext, useEffect, useState, ReactNode } from "react"
import { Platform } from "react-native"
import Purchases, { CustomerInfo } from "react-native-purchases"
const fetch = require("node-fetch")

import useUser from "../hooks/useUser"

const purchasesRevenueCatStripeUrl = "https://us-central1-your-brightly-ai.cloudfunctions.net/getCustomerInfoRevenueCatStripe"
const revenueCatPurchasesAndroidApiKey = Constants.expoConfig.extra.revenueCatPurchasesAndroidApiKey
const revenueCatPurchasesIosApiKey = Constants.expoConfig.extra.revenueCatPurchasesIosApiKey
const revenueCatPurchasesStripeApiKey = Constants.expoConfig.extra.revenueCatPurchasesStripeApiKey
const revenueCatPurchasesEntitlementId = Constants.expoConfig.extra.revenueCatPurchasesEntitlementId

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
            if (Platform.OS === "ios") {
                Purchases.setDebugLogsEnabled(true)
                await Purchases.configure({
                    apiKey: revenueCatPurchasesIosApiKey,
                    appUserID: user?.uid,
                })
            } else if (Platform.OS === "android") {
                Purchases.setDebugLogsEnabled(true)
                await Purchases.configure({
                    apiKey: revenueCatPurchasesAndroidApiKey,
                    appUserID: user?.uid,
                    observerMode: false,
                    useAmazon: false,
                })
                // OR: if building for Amazon, be sure to follow the installation instructions then:
                // await Purchases.configure({ apiKey: '<public_amazon_api_key>', useAmazon: true });
            } else if (Platform.OS === "web") {
                // Configure Axios to use the same origin as the web app
                // axios.defaults.baseURL = window.location.origin;
                const idTokenUser = await user?.getIdToken()
                setIdToken(idTokenUser)
            }
        }

        const getCustomerInfo = async () => {
            try {
                if (Platform.OS === "ios" || Platform.OS === "android") {
                    const customerInfoData = await Purchases.getCustomerInfo()
                    setCustomerInfo(customerInfoData)
                } else if (Platform.OS === "web") {
                    try {
                        const response = await fetch(purchasesRevenueCatStripeUrl, {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                                Authorization: `Bearer ${idToken}`,
                            },
                        });
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
            (async () => {
                console.log(user?.uid, idToken)
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

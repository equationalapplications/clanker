import { useEffect, useState } from "react"
import Purchases, { PurchasesOfferings } from "react-native-purchases"

import { platform, purchasesRevenueCatStripeUrl } from "../config/constants"
import useUser from "./useUser"
//import { purchasesConfig } from "../config/purchasesConfig"

//export const usePurchasesOfferings = (): [PurchasesOfferings, boolean, Error | null] => {
export const usePurchasesOfferings = (): PurchasesOfferings | null => {

    const user = useUser()

    const [purchasesOfferings, setPurchasesOfferings] = useState<PurchasesOfferings>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<Error | null>(null)

    useEffect(() => {
        const fetchPurchasesOfferings = async () => {
            //        await purchasesConfig(user?.uid)
            try {
                if (platform === "ios" || platform === "android") {
                    const offerings = await Purchases.getOfferings()
                    console.log(offerings)
                    if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
                        setPurchasesOfferings(offerings)
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
                    const purchasesOfferingsData = await response.json()
                    const offerings = purchasesOfferingsData?.PurchasesOfferings
                    console.log(offerings)
                    setPurchasesOfferings(offerings)
                }
            } catch (e) {
                setError(e)
                setLoading(false)
                console.log(e, e.message)
            }
        }
        if (user) {
            fetchPurchasesOfferings()
        }

    }, [user])

    // return [purchasesOfferings, loading, error]
    return purchasesOfferings
}

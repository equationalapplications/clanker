import { useEffect, useState } from "react"
import Purchases from "react-native-purchases"

import { platform, revenueCatPurchasesStripeApiKey, revenueCatBaseUrl } from "../config/constants"
import useUser from "./useUser"

export const useIsPremium = (): boolean | null => {
    const user = useUser()
    const [isPremium, setIsPremium] = useState<boolean | null>(null)

    useEffect(() => {
        const fetchPurchasesOfferings = async () => {
            try {
                if (platform === "ios" || platform === "android") {
                    const offerings = await Purchases.getOfferings()
                    if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
                        setIsPremium(true)
                    } else {
                        setIsPremium(false)
                    }
                } else if (platform === "web") {
                    const response = await fetch(
                        revenueCatBaseUrl + "/subscribers/" + user.uid + "/offerings",
                        {
                            method: "GET",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${revenueCatPurchasesStripeApiKey}`,
                            },
                        },
                    )
                    const purchasesOfferingsData = await response.json()
                    if (
                        purchasesOfferingsData?.current_offering_id !== null &&
                        purchasesOfferingsData?.current?.availablePackages?.length !== 0
                    ) {
                        setIsPremium(true)
                    } else {
                        setIsPremium(false)
                    }
                }
            } catch (e) {
                console.log(e, e.message)
            }
        }
        if (user) {
            fetchPurchasesOfferings()
        }
    }, [user])

    return isPremium
}

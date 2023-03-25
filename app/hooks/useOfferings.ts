import { useEffect, useState } from "react"
import Purchases, { PurchasesPackage } from "react-native-purchases"

import { platform, revenueCatPurchasesStripeApiKey, revenueCatBaseUrl } from "../config/constants"
import useUser from "./useUser"

interface Offering {
  identifier: string
  description: string
  package: PurchasesPackage
}

export const useOfferings = (): Offering[] | null => {
  const user = useUser()

  const [purchasesOfferings, setPurchasesOfferings] = useState<Offering[]>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const fetchPurchasesOfferings = async () => {
      //        await purchasesConfig(user?.uid)
      try {
        if (platform === "ios" || platform === "android") {
          const offerings = await Purchases.getOfferings()
          if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
            const offering: Offering = {
              identifier: offerings.current.availablePackages[0].identifier,
              description: offerings.current.serverDescription,
              package: offerings.current.availablePackages[0],
            }
            setPurchasesOfferings([offering])
          }
        } else if (platform === "web") {
          // const idToken = await user?.getIdToken()
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
          const offerings = purchasesOfferingsData
          console.log(offerings)
          if (
            offerings?.current_offering_id !== null &&
            offerings?.current?.availablePackages?.length !== 0
          ) {
            const offering: Offering = {
              identifier: offerings.current_offering_id,
              description: offerings.offerings[1].description,
              package: offerings.offerings[1].packages[0],
            }
            setPurchasesOfferings([offering])
          }
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

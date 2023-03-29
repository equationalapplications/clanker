import * as WebBrowser from "expo-web-browser"
import { Button } from "react-native-paper"
import Purchases from "react-native-purchases"

import { stripeCustomerPortal, platform } from "../config/constants"
import useUserPrivate from "../hooks/useUserPrivate"

export default function SubscriptionBillingInfoButton() {
  const userPrivate = useUserPrivate()
  const isPremium = userPrivate?.isPremium

  const onPressBilling = async () => {
    try {
      if (platform === "web") {
        await WebBrowser.openBrowserAsync(stripeCustomerPortal)
      } else {
        const getCustomerInfo = await Purchases?.getCustomerInfo()
        const managementURL = getCustomerInfo?.managementURL
        if (!managementURL) return
        await WebBrowser.openBrowserAsync(managementURL)
      }
    } catch (e) {
      console.log(e)
    }
  }

  return (
    <Button mode="outlined" onPress={onPressBilling} disabled={!isPremium}>
      Subscription & Billing
    </Button>
  )
}

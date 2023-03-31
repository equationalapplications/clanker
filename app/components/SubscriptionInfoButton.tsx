import * as WebBrowser from "expo-web-browser"
import Purchases from "react-native-purchases"

import Button from "../components/Button"
import { stripeCustomerPortal, platform } from "../config/constants"

export default function SubscriptionInfoButton() {
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
    <Button mode="outlined" onPress={onPressBilling}>
      Subscription & Billing
    </Button>
  )
}

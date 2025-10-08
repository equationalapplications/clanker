// TODO: Install expo-web-browser dependency
// import * as WebBrowser from "expo-web-browser"
import Purchases from 'react-native-purchases'

import Button from '~/components/Button'
import { stripeCustomerPortal, platform } from '~/config/constants'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
}

export default function SubscriptionInfoButton({ onChangeIsLoading }: Props) {
  const onPressBilling = async () => {
    try {
      if (platform === 'web') {
        onChangeIsLoading(true)
        // TODO: Implement web browser opening when expo-web-browser is available
        // await WebBrowser.openBrowserAsync(stripeCustomerPortal)
        console.log('Would open:', stripeCustomerPortal)
        onChangeIsLoading(false)
      } else {
        onChangeIsLoading(true)
        const getCustomerInfo = await Purchases?.getCustomerInfo()
        const managementURL = getCustomerInfo?.managementURL
        if (!managementURL) return
        // TODO: Implement web browser opening when expo-web-browser is available
        // await WebBrowser.openBrowserAsync(managementURL)
        console.log('Would open:', managementURL)
      }
      onChangeIsLoading(false)
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

// TODO: Install expo-web-browser dependency
// import * as WebBrowser from "expo-web-browser"

import Button from '~/components/Button'
import { stripeCustomerPortal } from '~/config/constants'

interface Props {
  onChangeIsLoading: (isLoading: boolean) => void
}

export default function SubscriptionInfoButton({ onChangeIsLoading }: Props) {
  const onPressBilling = async () => {
    try {
      onChangeIsLoading(true)
      // All platforms use Stripe Customer Portal now
      // TODO: Implement web browser opening when expo-web-browser is available
      // await WebBrowser.openBrowserAsync(stripeCustomerPortal)
      console.log('Would open:', stripeCustomerPortal)
      onChangeIsLoading(false)
    } catch (e) {
      console.log(e)
      onChangeIsLoading(false)
    }
  }

  return (
    <Button mode="outlined" onPress={onPressBilling}>
      Subscription & Billing
    </Button>
  )
}

// TODO: Install expo-web-browser dependency
// import * as WebBrowser from "expo-web-browser"

import {
  platform,
  stripeMontlySubscriptionPriceId,
} from '../config/constants'
import { purchasePackageStripe } from '../config/firebaseConfig'

export async function makePackagePurchase() {
  try {
    if (platform === 'ios' || platform === 'android') {
      // TODO: Implement native in-app purchases for iOS/Android
      console.log('Native in-app purchases not yet implemented')
      // For now, redirect to Stripe checkout on mobile as well
      const checkoutUrlData = await purchasePackageStripe({ stripeMontlySubscriptionPriceId })
      const checkoutUrl = (checkoutUrlData as any)?.data || ''

      if (checkoutUrl) {
        console.log('Would open checkout URL:', checkoutUrl)
      }
    } else if (platform === 'web') {
      // Get the checkout URL from Firebase Cloud Functions
      const checkoutUrlData = await purchasePackageStripe({ stripeMontlySubscriptionPriceId })
      const checkoutUrl = (checkoutUrlData as any)?.data || ''

      if (checkoutUrl) {
        // TODO: Implement web browser opening when expo-web-browser is available
        // await WebBrowser.openBrowserAsync(checkoutUrl)
        console.log('Would open checkout URL:', checkoutUrl)
      }
    }
  } catch (error) {
    console.log('Error: ', error)
  }
}
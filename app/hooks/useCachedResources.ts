import { FontAwesome } from "@expo/vector-icons"
import Constants from "expo-constants"
import * as Font from "expo-font"
import * as SplashScreen from "expo-splash-screen"
import { useEffect, useState } from "react"
import Purchases from "react-native-purchases"
import { useAuthUser } from "@react-query-firebase/auth"

import { auth } from "../config/firebaseConfig"

export default function useCachedResources() {
  const [isLoadingComplete, setLoadingComplete] = useState(false)
  const user = useAuthUser(["user"], auth)

  // Load any resources or data that we need prior to rendering the app
  useEffect(() => {
    async function loadResourcesAndDataAsync() {
      try {
        SplashScreen.preventAutoHideAsync()

        // Load fonts
        await Font.loadAsync({
          ...FontAwesome.font,
          "space-mono": require("../../assets/fonts/SpaceMono-Regular.ttf"),
        })

        // Configure Purchases
        Purchases.setDebugLogsEnabled(true)
        Purchases.configure({
          apiKey: Constants.expoConfig?.extra?.revenueCatPurchasesApiKey,
          appUserID: user.data?.uid,
          observerMode: false,
          useAmazon: false,
        })
      } catch (e) {
        // We might want to provide this error information to an error reporting service
        console.warn(e)
      } finally {
        setLoadingComplete(true)
        SplashScreen.hideAsync()
      }
    }

    loadResourcesAndDataAsync()
  }, [])

  return isLoadingComplete
}

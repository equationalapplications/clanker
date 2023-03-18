import { useEffect } from "react"
import Purchases from "react-native-purchases"
import Constants from "expo-constants"
import useUser from "./useUser"
import { Platform } from "react-native"

const androidApiKey = Constants.expoConfig?.extra?.revenueCatPurchasesApiKey

export default function usePurchase() {
    const user = useUser()
    const uid = user?.uid ?? ""

    useEffect(() => {
        Purchases.setDebugLogsEnabled(true);
        const purchasesConfigure = async () => {
            if (Platform.OS === 'ios') {
                //  await Purchases.configure({ apiKey: <public_apple_api_key> });
            } else if (Platform.OS === 'android') {
                await Purchases.configure({
                    apiKey: androidApiKey,
                    appUserID: uid,
                    observerMode: false,
                    useAmazon: false,
                });

                // OR: if building for Amazon, be sure to follow the installation instructions then:
                //   await Purchases.configure({ apiKey: <public_amazon_api_key>, useAmazon: true });
            }
        }
        if (uid) {
            purchasesConfigure()
        }
    }, [uid])
    return {}
}

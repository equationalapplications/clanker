import { StatusBar } from "expo-status-bar"
import React, { useState } from "react"
import { StyleSheet, Text, View } from "react-native"
//import { useAlerts } from "react-native-paper-alerts"

import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import { platform } from "../config/constants"
import { useOfferings } from "../hooks/useOfferings"
import useUser from "../hooks/useUser"
import makePackagePurchase from "../utilities/makePackagePurchase"

export default function SubscribeModal() {
  //const alerts = useAlerts()
  const user = useUser()
  const offerings = useOfferings()
  const description = offerings?.[0]?.description
  const identifier = offerings?.[0]?.identifier
  const purchasePackage = offerings?.[0]?.package

  const [isLoading, setIsLoading] = useState(false)
  /*
    const stackedBtnAlert = () =>
      new Promise<string>((resolve) => {
        alerts.alert(
          "Verify Subscription Purchase",
          "Are you sure you want to purchase a subscription?.",
          [
            {
              text: "Yes, I want to purchase a subscription.",
              onPress: () => resolve("Yes, I want to purchase a subscription."),
            },
            {
              text: "No, thank you.",
              onPress: () => resolve("No, thank you."),
              style: "cancel",
            },
          ],
          {
            stacked: true,
          },
        )
      })
  */
  const onPressPurchase = async () => {
    // const response = await stackedBtnAlert()
    // if (response === "Yes, I want to purchase a subscription.") {
    setIsLoading(true)
    await makePackagePurchase({ purchasePackage, user })
    setIsLoading(false)
    //console.log("Purchase successful", purchasePackage?.platform_product_identifier)
    //  } else {
    // User clicked "No, thank you"
    //   console.log("Purchase cancelled")
    //  }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Subscribe</Text>
      <View style={styles.separator} />
      {isLoading && <LoadingIndicator />}
      <Button onPress={onPressPurchase} disabled={!user}>
        {/* diplay the first available package as this button */}
        {description}
      </Button>
      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={platform === "ios" ? "light" : "auto"} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
})

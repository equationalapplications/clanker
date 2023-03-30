import { StatusBar } from "expo-status-bar"
import React, { useState } from "react"
import { StyleSheet, View } from "react-native"
import { Text } from "react-native-paper"

import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import SubscriptionBillingInfoButton from "../components/SubscriptionBillingInfoButton"
import { platform } from "../config/constants"
import useUser from "../hooks/useUser"
import useUserPrivate from "../hooks/useUserPrivate"
import makePackagePurchase from "../utilities/makePackagePurchase"
import setIsPremium from "../utilities/setIsPremium"

export default function SubscribeModal() {
  const user = useUser()
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits
  const isPremium = userPrivate?.isPremium

  const [isLoading, setIsLoading] = useState(false)

  const onPressPurchase = async () => {
    setIsLoading(true)
    await makePackagePurchase()
    await setIsPremium()
    setIsLoading(false)
  }

  return (
    <View style={styles.container}>
      {credits <= 0 && !isPremium ? (
        <>
          <Text>Please Subscribe for Unlimited Credits</Text>
          <View style={styles.separator} />
        </>
      ) : null}

      {isLoading && <LoadingIndicator />}
      {isPremium ? (
        <>
          <Text style={styles.title}>Thank You for Subscribing!</Text>
          <View style={styles.separator} />
          <SubscriptionBillingInfoButton />
        </>
      ) : (
        <>
          <Text style={styles.title}>Unlimited Credits</Text>
          <Text style={styles.title}>$4.99 per month</Text>
          <View style={styles.separator} />
          <Button onPress={onPressPurchase} disabled={!user} mode="contained">
            Subscribe Now!
          </Button>
        </>
      )}
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

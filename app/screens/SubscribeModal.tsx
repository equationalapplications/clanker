import { StatusBar } from "expo-status-bar"
import React, { useState } from "react"
import { StyleSheet, View } from "react-native"
import { Text } from "react-native-paper"

import CombinedSubscriptionButton from "../components/CombinedSubscriptionButton"
import LoadingIndicator from "../components/LoadingIndicator"
import { platform } from "../config/constants"
import { useIsPremium } from "../hooks/useIsPremium"
import useUserPrivate from "../hooks/useUserPrivate"

export default function SubscribeModal() {
  const userPrivate = useUserPrivate()
  const credits = userPrivate?.credits
  const isPremium = useIsPremium()

  const [isLoading, setIsLoading] = useState(false)

  const onChangeIsLoading = (isLoading) => {
    setIsLoading(isLoading)
  }

  return (
    <View style={styles.container}>
      {credits <= 0 && !isPremium ? (
        <>
          <Text>Please Subscribe for Unlimited Credits</Text>
          <View style={styles.separator} />
        </>
      ) : null}
      {isPremium ? (
        <>
          <Text style={styles.title}>Thank You for Subscribing!</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>Unlimited Credits</Text>
          <Text style={styles.title}>$4.99 per month</Text>
        </>
      )}
      <View style={styles.separatorSmall} />
      {isLoading && <LoadingIndicator />}
      <View style={styles.separatorSmall} />
      <CombinedSubscriptionButton onChangeIsLoading={onChangeIsLoading} />
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
  separatorSmall: {
    marginVertical: 10,
    height: 1,
    width: "80%",
  },
})

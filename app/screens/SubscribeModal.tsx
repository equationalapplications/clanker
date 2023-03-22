import { StatusBar } from "expo-status-bar"
import React from "react"
import { StyleSheet, Text, View } from "react-native"
import { useAlerts } from "react-native-paper-alerts"

import Button from "../components/Button"
import { usePurchasesOfferings } from "../hooks/usePurchasesOfferings"
import useUser from "../hooks/useUser"
import { platform } from "../config/constants"

export default function SubscribeModal() {
  const alerts = useAlerts()
  const user = useUser()
  const purchasesOfferings = usePurchasesOfferings()
  console.log("subs", purchasesOfferings)


  const multipleBtnAlert = () =>
    alerts.alert(
      "Alert with Multiple Buttons",
      "This is a alert dialog with multiple button and different styles.",
      [
        {
          text: "Agree",
        },
        {
          text: "Disagree",
          style: "cancel",
        },
        {
          text: "Not Sure",
          style: "destructive",
        },
      ],
    )

  const stackedBtnAlert = () =>
    alerts.alert(
      "Verify Subscription Purchase",
      "Are you sure you want to purchase a subscription?.",
      [
        {
          text: "Yes, I want to purchase a subscription.",
        },
        {
          text: "No, thank you.",
        },
      ],
      {
        stacked: true,
      },
    )

  const nonUpercaseAlert = () =>
    alerts.alert(
      "Alert with Multiple Buttons",
      "This is a alert dialog with multiple button and different styles.",
      [
        {
          text: "Agree",
        },
        {
          text: "Disagree",
          style: "cancel",
        },
        {
          text: "Not Sure",
          style: "destructive",
        },
      ],
      {
        uppercase: false,
      },
    )

  const simplePrompt = () =>
    alerts.prompt("Verify Purchase", "Are you sure you wish to make a purchase?", (message) => {
      // toast.show({ message });
    })

  const onPressPurchase = () => {
    if (platform === "ios") {
    } else if (platform === "android") {
    } else if (platform === "web") {
      const payload = {
        app_user_id: "your_user_id",
        fetch_token: "your_receipt_or_fetch_token",
      }

      stackedBtnAlert()

      //fetch("https://api.revenuecat.com/v1/receipts", {
      //  method: "POST",
      //  headers: {
      //    "Content-Type": "application/json",
      //    Authorization: "Bearer your_api_key",
      //  },
      //  body: JSON.stringify(payload),
      //})
      //  .then((response) => response.json())
      //  .then((data) => console.log(data))
      //  .catch((error) => console.error(error));
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Subscribe</Text>
      <View style={styles.separator} />
      <Button onPress={onPressPurchase} disabled={!user}>
        "hmm"
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

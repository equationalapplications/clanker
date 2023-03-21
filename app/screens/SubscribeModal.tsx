import Constants from "expo-constants"
import { StatusBar } from "expo-status-bar"
import { Platform, StyleSheet, Text, View } from "react-native"
import { getIdToken } from "firebase/auth"
import React, { createContext, useEffect, useState, ReactNode } from "react"
import Purchases, { CustomerInfo, PurchasesOfferings } from "react-native-purchases"
import { useAlerts } from 'react-native-paper-alerts';
import Button from "../components/Button"

import useUser from "../hooks/useUser"

const fetch = require("node-fetch")

const revenueCatBaseUrl =
  "https://api.revenuecat.com/v1"
const revenueCatPurchasesAndroidApiKey = Constants.expoConfig.extra.revenueCatPurchasesAndroidApiKey
const revenueCatPurchasesIosApiKey = Constants.expoConfig.extra.revenueCatPurchasesIosApiKey
const revenueCatPurchasesStripeApiKey = Constants.expoConfig.extra.revenueCatPurchasesStripeApiKey
const revenueCatPurchasesEntitlementId = Constants.expoConfig.extra.revenueCatPurchasesEntitlementId


export default function SubscribeModal() {
  const alerts = useAlerts();
  const user = useUser()
  const uid = user?.uid
  const [offerings, setOfferings] = useState<PurchasesOfferings | null>(null)

  useEffect(() => {
    const getOfferings = async () => {
      if (uid) {
        if (Platform.OS === "ios") {

        } else if (Platform.OS === "android") {

        } else if (Platform.OS === "web") {
          try {
            // const idToken = await user?.getIdToken()
            const response = await fetch(revenueCatBaseUrl + "/subscribers/" + uid + "/offerings", {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${revenueCatPurchasesStripeApiKey}`,
              },
            })
            const offeringsData = await response.json()

            console.log(offeringsData.offerings)
            setOfferings(offeringsData.offerings)
          } catch (e) {
            console.log(e)
          }
        }
      }
    }
    getOfferings()
    return
  }, [uid])

  const multipleBtnAlert = () =>
    alerts.alert(
      'Alert with Multiple Buttons',
      'This is a alert dialog with multiple button and different styles.',
      [
        {
          text: 'Agree',
        },
        {
          text: 'Disagree',
          style: 'cancel',
        },
        {
          text: 'Not Sure',
          style: 'destructive',
        },
      ]
    );

  const stackedBtnAlert = () =>
    alerts.alert(
      'Verify Subscription Purchase',
      'Are you sure you want to purchase a subscription?.',
      [
        {
          text: 'Yes, I want to purchase a subscription.',
        },
        {
          text: 'No, thank you.',
        },
      ],
      {
        stacked: true,
      }
    );

  const nonUpercaseAlert = () =>
    alerts.alert(
      'Alert with Multiple Buttons',
      'This is a alert dialog with multiple button and different styles.',
      [
        {
          text: 'Agree',
        },
        {
          text: 'Disagree',
          style: 'cancel',
        },
        {
          text: 'Not Sure',
          style: 'destructive',
        },
      ],
      {
        uppercase: false,
      }
    );

  const simplePrompt = () =>
    alerts.prompt('Verify Purchase', 'Are you sure you wish to make a purchase?', (message) => {
      // toast.show({ message });
    });

  const onPressPurchase = () => {
    if (Platform.OS === "ios") {

    } else if (Platform.OS === "android") {

    } else if (Platform.OS === "web") {
      const payload = {
        app_user_id: "your_user_id",
        fetch_token: "your_receipt_or_fetch_token",
      };

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
      <Button onPress={onPressPurchase} disabled={!user || !offerings}>
        {offerings ? offerings[0]?.description : null}
      </Button>
      {/* Use a light status bar on iOS to account for the black space above the modal */}
      <StatusBar style={Platform.OS === "ios" ? "light" : "auto"} />
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

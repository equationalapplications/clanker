import { StatusBar } from "expo-status-bar"
import React from "react"
import { StyleSheet, Text, View } from "react-native"
import { useAlerts } from "react-native-paper-alerts"
import Purchases, { PurchasesPackage } from "react-native-purchases"

import Button from "../components/Button"
import { platform } from "../config/constants"
import { useOfferings } from "../hooks/useOfferings"
import useUser from "../hooks/useUser"

export default async function makePackagePurchase(purchasesPackage: PurchasesPackage) {
  try {
    if (platform === "ios" || platform === "android") {
      const purchase = await Purchases.purchasePackage(purchasesPackage)
    } else if (platform === "web") {
      // Handle web subscription purchase
    }
  } catch (error) {
    console.log("Error: ", error)
  }
}

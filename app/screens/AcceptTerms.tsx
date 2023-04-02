import { useNavigation } from "@react-navigation/native"
import { StatusBar } from "expo-status-bar"
import { httpsCallable } from "firebase/functions"
import React, { useState } from "react"
import { StyleSheet, View } from "react-native"
import { Text, Checkbox } from "react-native-paper"

import Button from "../components/Button"
import Logo from "../components/Logo"
import { platform } from "../config/constants"
import { functions } from "../config/firebaseConfig"
import { RootStackScreenProps } from "../navigation/types"

const acceptTermsFn: any = httpsCallable(functions, "acceptTerms")

export function AcceptTerms() {
  const [checked, setChecked] = useState(false)
  const navigation = useNavigation()
  const onPressChecked = () => {
    setChecked(!checked)
  }

  const onPressAccept = () => {
    acceptTermsFn()
    navigation.navigate("Root")
  }

  const onPressTerms = () => {
    navigation.navigate("Terms")
  }

  const onPressPrivacy = () => {
    navigation.navigate("Privacy")
  }

  return (
    <View style={styles.container}>
      <Logo />
      <Button onPress={onPressTerms}>Terms of Service</Button>
      <Button onPress={onPressPrivacy}>Privacy Policy</Button>
      <View style={styles.row}>
        <Checkbox status={checked ? "checked" : "unchecked"} onPress={onPressChecked} />
        <Text style={styles.text}>
          I am over 18 years of age and I have read and accept the Terms and Conditions and Privacy
          Policy.
        </Text>
      </View>
      <View style={styles.separatorSmall} />
      <Button mode="contained" disabled={!checked} onPress={onPressAccept}>
        I accept
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
    marginHorizontal: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  text: {
    fontSize: 16,
    fontWeight: "normal",
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

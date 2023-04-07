import { useNavigation } from "@react-navigation/native"
import { StatusBar } from "expo-status-bar"
import { httpsCallable } from "firebase/functions"
import React, { useState } from "react"
import { StyleSheet, View } from "react-native"
import { Text, Checkbox } from "react-native-paper"

import { platform } from "../config/constants"
import { auth, functions } from "../config/firebaseConfig"
import { queryClient } from "../config/queryClient"
import { useAcceptTerms } from "../hooks/useAcceptTerms"
import Button from "./Button"
import Logo from "./Logo"

const deleteUserFn: any = httpsCallable(functions, "deleteUser")

export function AcceptTerms() {
  const [checked, setChecked] = useState(false)
  const navigation = useNavigation()
  const acceptTermsMutation = useAcceptTerms()

  const onPressChecked = () => {
    setChecked(!checked)
  }

  const onPressAccept = () => {
    acceptTermsMutation.mutate()
  }

  const onPressCancel = async () => {
    await deleteUserFn()
    await auth.currentUser?.delete()
    queryClient.clear()
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
      <Button mode="contained" onPress={onPressCancel}>
        Cancel
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

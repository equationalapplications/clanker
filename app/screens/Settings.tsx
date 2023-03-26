import * as WebBrowser from "expo-web-browser"
import { StyleSheet, View } from "react-native"

import Button from "../components/Button"
import { stripeCustomerPortal, platform } from "../config/constants"
import { RootTabScreenProps } from "../navigation/types"

export default function Settings({ navigation }: RootTabScreenProps<"Settings">) {
  const onPressProfile = () => {
    navigation.navigate("Profile")
  }

  const onPressBilling = async () => {
    if (platform === "web") {
      await WebBrowser.openBrowserAsync(stripeCustomerPortal)
    }
  }

  return (
    <View style={styles.container}>
      <Button mode="outlined" onPress={onPressProfile}>
        Profile
      </Button>
      <Button mode="outlined" onPress={onPressBilling}>
        Billing
      </Button>
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

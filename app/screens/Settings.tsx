import React, { useState } from "react"
import { StyleSheet, View } from "react-native"

import Button from "../components/Button"
import CombinedSubscriptionButton from "../components/CombinedSubscriptionButton"
import LoadingIndicator from "../components/LoadingIndicator"
import { BottomTabScreenProps } from "../navigation/types"

export default function Settings({ navigation }: BottomTabScreenProps<"Settings">) {
  const [isLoading, setIsLoading] = useState(false)

  const onChangeIsLoading = (isLoading: boolean) => {
    setIsLoading(isLoading)
  }

  const onPressProfile = () => {
    navigation.navigate("SettingsStack", { screen: "Profile" })
  }

  return (
    <View style={styles.container}>
      <Button mode="outlined" onPress={onPressProfile}>
        Profile
      </Button>
      {isLoading && <LoadingIndicator />}
      <CombinedSubscriptionButton onChangeIsLoading={onChangeIsLoading} />
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

import { StyleSheet, View } from "react-native"

import Button from "../components/Button"
import CombinedSubscriptionButton from "../components/CombinedSubscriptionButton"
import { RootTabScreenProps } from "../navigation/types"

export default function Settings({ navigation }: RootTabScreenProps<"Settings">) {
  const onPressProfile = () => {
    navigation.navigate("Profile")
  }

  return (
    <View style={styles.container}>
      <Button mode="outlined" onPress={onPressProfile}>
        Profile
      </Button>
      <CombinedSubscriptionButton />
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

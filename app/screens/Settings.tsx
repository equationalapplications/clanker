import { StyleSheet } from "react-native"

import Button from "../components/Button"
import { Text, View } from "../components/Themed"
import { RootTabScreenProps } from "../navigation/types"

export default function Settings({ navigation }: RootTabScreenProps<"Settings">) {
  const onPressProfile = () => {
    navigation.navigate("Profile")
  }

  const onPressCharacters = () => {
    navigation.navigate("Characters")
  }

  return (
    <View style={styles.container}>
      <Button mode="outlined" onPress={onPressProfile}>
        Profile
      </Button>
      <Button mode="outlined" onPress={onPressCharacters}>
        Characters
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

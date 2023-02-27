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
      <Text style={styles.title}>Settings</Text>
      <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
      <Button mode="contained" onPress={onPressProfile}>
        <Text>Profile</Text>
      </Button>
      <Button mode="contained" onPress={onPressCharacters}>
        <Text>Characters</Text>
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

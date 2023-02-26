import { StyleSheet, Button } from "react-native"
import { useAuthSignOut } from "@react-query-firebase/auth"

import { auth } from "../config/firebaseConfig"
import EditScreenInfo from "../components/EditScreenInfo"
import { Text, View } from "../components/Themed"

export default function TabTwoScreen() {
  const authMutation = useAuthSignOut(auth)
  const onPress = () => {
    authMutation.mutate()
  }
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
      <Button title="Sign Out" onPress={onPress} />
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

import { useAuthSignOut } from "@react-query-firebase/auth"
import { StyleSheet } from "react-native"

import Button from "../components/Button"
import { Text, View } from "../components/Themed"
import { auth } from "../config/firebaseConfig"

export default function Profile({ navigation }: RootTabScreenProps<"Profile">) {
  const authMutation = useAuthSignOut(auth)
  const onPressSignOut = () => {
    authMutation.mutate()
  }
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
      <Button mode="contained" onPress={onPressSignOut}>
        <Text>Sign Out</Text>
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

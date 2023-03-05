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
      <Button mode="outlined" onPress={onPressSignOut}>
        Sign Out
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

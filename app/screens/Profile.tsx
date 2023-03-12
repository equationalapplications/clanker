import { useAuthSignOut, useAuthUser } from "@react-query-firebase/auth"
import { StyleSheet, View } from "react-native"
import { Text, Avatar } from "react-native-paper"

import Button from "../components/Button"
import { auth } from "../config/firebaseConfig"

export default function Profile() {
  const user = useAuthUser(["user"], auth)
  const { photoURL, displayName, email } = user.data
  const authMutation = useAuthSignOut(auth)

  const onPressSignOut = () => {
    authMutation.mutate()
  }
  return (
    <View style={styles.container}>
      <Avatar.Image size={150} source={{ uri: photoURL }} />
      <Text>{displayName}</Text>
      <Text>{email}</Text>
      <View style={styles.separator} />
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

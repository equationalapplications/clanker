import { useAuthSignOut, useAuthUser } from "@react-query-firebase/auth"
import { StyleSheet, View } from "react-native"
import { Text, Avatar } from "react-native-paper"
import { useQueryClient } from "react-query"
import { useNavigation } from "@react-navigation/native"

import Button from "../components/Button"
import { auth } from "../config/firebaseConfig"

export default function Profile() {
  const navigation = useNavigation()
  const user = useAuthUser(["user", auth.currentUser?.uid ?? ""], auth)
  const displayName = user.data?.displayName ?? ""
  const email = user.data?.email ?? ""
  const photoURL = user.data?.photoURL ?? "https://www.gravatar.com/avatar?d=mp"

  const mutationAuthSignOut = useAuthSignOut(auth)
  const queryClient = useQueryClient()

  const onPressSignOut = () => {
    // queryClient.removeQueries("user")
    // queryClient.resetQueries("user")
    // auth.signOut()
    mutationAuthSignOut.mutate()
    navigation.navigate("SignIn")
    //queryClient.resetQueries("user")
    // queryClient.removeQueries("user")
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

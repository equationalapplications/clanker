import { useNavigation } from "@react-navigation/native"
import { StyleSheet, View } from "react-native"
import { Text, Avatar } from "react-native-paper"

import Button from "../components/Button"
import { auth } from "../config/firebaseConfig"
import useUser from "../hooks/useUser"
import useUserPrivate from "../hooks/useUserPrivate"

export default function Profile() {
  const navigation = useNavigation()
  const user = useUser()
  const userPrivate = useUserPrivate()
  const displayName = user?.displayName
  const email = user?.email
  const photoURL = user?.photoURL ?? "https://www.gravatar.com/avatar?d=mp"
  const credits = userPrivate?.credits
  console.log(user)

  const onPressSignOut = () => {
    auth.signOut()
    navigation.navigate("SignIn")
  }
  return (
    <View style={styles.container}>
      <Avatar.Image size={150} source={{ uri: photoURL }} style={{ marginVertical: 10 }} />
      <Text>{displayName}</Text>
      <Text>{email}</Text>
      <Text>Credits: {credits}</Text>
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

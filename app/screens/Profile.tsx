import { useNavigation } from "@react-navigation/native"
import { useMemo, useCallback } from "react"
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
  const displayName = useMemo(() => user?.displayName, [user])
  const email = useMemo(() => user?.email, [user])
  const photoURL = useMemo(() => user?.photoURL ?? "https://www.gravatar.com/avatar?d=mp", [user])
  const credits = useMemo(() => userPrivate?.credits, [userPrivate])

  const onPressSignOut = useCallback(() => {
    auth.signOut()
    navigation.navigate("SignIn")
  }, [navigation])

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
  separator: {
    marginVertical: 30,
    height: 1,
    width: "80%",
  },
})

import { useAuthSignOut } from "@react-query-firebase/auth"
import { StyleSheet, Button } from "react-native"

import { Text, View } from "../components/Themed"
import { auth } from "../config/firebaseConfig"
import { RootTabScreenProps } from "../navigation/types"

export default function TabOneScreen({ navigation }: RootTabScreenProps<"TabOne">) {
  const mutation = useAuthSignOut(auth)

  const onPress = () => {
    mutation.mutate()
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Tab One</Text>
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

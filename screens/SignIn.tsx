import * as Google from "expo-auth-session/providers/google"
import * as WebBrowser from "expo-web-browser"
import { getAuth, GoogleAuthProvider, signInWithCredential } from "firebase/auth"
import { useEffect } from "react"
import { StyleSheet, Button } from "react-native"

import { Text, View } from "../components/Themed"
import { RootStackScreenProps } from "../navigation/types"

WebBrowser.maybeCompleteAuthSession()

export default function SignIn({ navigation }: RootStackScreenProps<"SignIn">) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: "800200662040-m7pub0f15vdappk7qoqm1fcl4rsahvov.apps.googleusercontent.com",
  })

  useEffect(() => {
    if (response?.type === "success") {
      const { id_token } = response.params
      const auth = getAuth()
      const credential = GoogleAuthProvider.credential(id_token)
      signInWithCredential(auth, credential)
    }
  }, [response])

  return (
    <View style={styles.container}>
      <Button
        disabled={!request}
        title="Login"
        onPress={() => {
          promptAsync()
        }}
      />
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

import { useAuthSignInWithCredential } from "@react-query-firebase/auth"
import { ResponseType } from "expo-auth-session"
import * as Facebook from "expo-auth-session/providers/facebook"
import * as Google from "expo-auth-session/providers/google"
import Constants from "expo-constants"
import * as WebBrowser from "expo-web-browser"
import { GoogleAuthProvider, FacebookAuthProvider } from "firebase/auth"
import { useEffect } from "react"
import { StyleSheet } from "react-native"

import ProviderButton from "../components/AuthProviderButton"
import { View } from "../components/Themed"
import { auth } from "../config/firebaseConfig"

WebBrowser.maybeCompleteAuthSession()

export default function SignIn() {
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useIdTokenAuthRequest({
    clientId: Constants.expoConfig?.extra?.googleAuthClientId,
  })

  const [facebookRequest, facebookResponse, facebookPromptAsync] = Facebook.useAuthRequest({
    clientId: Constants.expoConfig?.extra?.facebookAuthAppId,
    responseType: ResponseType.Token,
  })

  const mutationAuthSignInWithCredential = useAuthSignInWithCredential(auth)

  useEffect(() => {
    if (googleResponse?.type === "success") {
      const { id_token } = googleResponse.params
      const credential = GoogleAuthProvider.credential(id_token)
      mutationAuthSignInWithCredential.mutate(credential)
    }
    if (facebookResponse?.type === "success") {
      const { access_token } = facebookResponse.params
      const credential = FacebookAuthProvider.credential(access_token)
      mutationAuthSignInWithCredential.mutate(credential)
    }
  }, [googleResponse, facebookResponse])

  const GoogleLoginOnPress = () => {
    googlePromptAsync()
  }

  const FacebookLoginOnPress = () => {
    facebookPromptAsync()
  }

  return (
    <View style={styles.container}>
      <ProviderButton onPress={GoogleLoginOnPress} type="google">
        Google
      </ProviderButton>
      <ProviderButton onPress={FacebookLoginOnPress} type="facebook">
        Facebook
      </ProviderButton>
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

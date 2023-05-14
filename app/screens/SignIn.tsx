import { ResponseType, makeRedirectUri } from "expo-auth-session"
import * as Facebook from "expo-auth-session/providers/facebook"
import * as Google from "expo-auth-session/providers/google"
import * as WebBrowser from "expo-web-browser"
import { GoogleAuthProvider, FacebookAuthProvider, signInWithCredential } from "firebase/auth"
import { useEffect } from "react"
import { StyleSheet, View, Text } from "react-native"

import { AcceptTerms } from "../components/AcceptTerms"
import ProviderButton from "../components/AuthProviderButton"
import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import Logo from "../components/Logo"
import { MonoText, TitleText } from "../components/StyledText"
import {
  googleWebClientId,
  googleAndroidClientId,
  facebookAuthAppId,
  googleIosClientId,
  scheme,
} from "../config/constants"
import { auth } from "../config/firebaseConfig"
import { useUser } from "../hooks/useUser"
import { useUserPrivate } from "../hooks/useUserPrivate"
import { RootStackScreenProps } from "../navigation/types"

WebBrowser.maybeCompleteAuthSession()

export default function SignIn({ navigation }: RootStackScreenProps<"SignIn">) {
  const user = useUser()
  const userPrivate = useUserPrivate()
  const hasAcceptedTermsDate = userPrivate?.hasAcceptedTermsDate ?? null

  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    webClientId: googleWebClientId,
    androidClientId: googleAndroidClientId,
    iosClientId: googleIosClientId,
    redirectUri: makeRedirectUri({
      scheme,
    }),
  })

  const [facebookRequest, facebookResponse, facebookPromptAsync] = Facebook.useAuthRequest({
    clientId: facebookAuthAppId,
    responseType: ResponseType.Token,
  })

  useEffect(() => {
    if (googleResponse && googleResponse.type === "success" && googleResponse.authentication) {
      const accessToken = googleResponse.authentication.accessToken
      const credential = GoogleAuthProvider.credential(null, accessToken)
      signInWithCredential(auth, credential).catch((error) => {
        // Handle Errors here.
        const errorCode = error.code
        const errorMessage = error.message
        // The email of the user's account used.
        const email = error.email
        // The credential that was used.
        const credential = GoogleAuthProvider.credentialFromError(error)
        console.log(errorCode, errorMessage, email, credential)
      })
    }
    if (
      facebookResponse &&
      facebookResponse.type === "success" &&
      facebookResponse.authentication
    ) {
      const idToken = facebookResponse.authentication.accessToken
      const credential = FacebookAuthProvider.credential(idToken)
      signInWithCredential(auth, credential).catch((error) => {
        // Handle Errors here.
        const errorCode = error.code
        const errorMessage = error.message
        // The email of the user's account used.
        const email = error.email
        // The credential that was used.
        const credential = GoogleAuthProvider.credentialFromError(error)
        console.log(errorCode, errorMessage, email, credential)
      })
    }
  }, [googleResponse, facebookResponse])

  const GoogleLoginOnPress = () => {
    googlePromptAsync()
  }

  const FacebookLoginOnPress = () => {
    facebookPromptAsync()
  }

  const onPressPrivacy = () => {
    navigation.navigate("Privacy")
  }

  const onPressTerms = () => {
    navigation.navigate("Terms")
  }
  return (
    <View style={styles.container}>
      {(user && hasAcceptedTermsDate) || (user && !userPrivate) ? <LoadingIndicator /> : null}
      {user && userPrivate && !hasAcceptedTermsDate ? <AcceptTerms /> : null}
      {!user ? (
        <>
          <TitleText>Yours Brightly AI</TitleText>
          <View style={styles.separator} />
          <MonoText>Create Your Own Simulated Friend</MonoText>
          <Logo />
          <ProviderButton disabled={!googleRequest} onPress={GoogleLoginOnPress} type="google">
            Google
          </ProviderButton>
          <ProviderButton
            disabled={!facebookRequest}
            onPress={FacebookLoginOnPress}
            type="facebook"
          >
            Facebook
          </ProviderButton>
          <Text>
            <Button mode="text" onPress={onPressTerms}>
              Terms and Conditions
            </Button>
            <Button mode="text" onPress={onPressPrivacy}>
              Privacy Policy
            </Button>
          </Text>
        </>
      ) : null}
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

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
import Button from "../components/Button"
import Logo from "../components/Logo"
import { MonoText, TitleText, ParagraphText } from "../components/StyledText"
import { View, Text } from "../components/Themed"
import { auth } from "../config/firebaseConfig"

WebBrowser.maybeCompleteAuthSession()

export default function SignIn({ navigation }) {
  const [googleRequest, googleResponse, googlePromptAsync] = Google.useIdTokenAuthRequest({
    webClientId: Constants.expoConfig?.extra?.googleWebClientId,
    androidClientId: Constants.expoConfig?.extra?.googleAndroidClientId,
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

  const onPressPrivacy = () => {
    navigation.navigate("Privacy")
  }

  const onPressTerms = () => {
    navigation.navigate("Terms")
  }

  return (
    <View style={styles.container}>
      <TitleText>Yours Brightly AI</TitleText>
      <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
      <MonoText>Create Your Own Simulated Friend</MonoText>
      <Logo />
      <ProviderButton disabled={!googleRequest} onPress={GoogleLoginOnPress} type="google">
        Google
      </ProviderButton>
      <ProviderButton disabled={!facebookRequest} onPress={FacebookLoginOnPress} type="facebook">
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

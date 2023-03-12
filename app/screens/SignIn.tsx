import { useAuthSignInWithCredential } from "@react-query-firebase/auth"
import { ResponseType } from "expo-auth-session"
import * as Facebook from "expo-auth-session/providers/facebook"
import * as Google from "expo-auth-session/providers/google"
import Constants from "expo-constants"
import * as WebBrowser from "expo-web-browser"
import { GoogleAuthProvider, FacebookAuthProvider, signInWithCredential } from "firebase/auth"
import { useEffect, useState } from "react"
import { StyleSheet, View, Text } from "react-native"

import ProviderButton from "../components/AuthProviderButton"
import Button from "../components/Button"
import Logo from "../components/Logo"
import { MonoText, TitleText } from "../components/StyledText"
import { auth } from "../config/firebaseConfig"

WebBrowser.maybeCompleteAuthSession()

export default function SignIn({ navigation }) {
  //const [token, setToken] = useState("")
  //const [userInfo, setUserInfo] = useState(null)

  const [googleRequest, googleResponse, googlePromptAsync] = Google.useAuthRequest({
    webClientId: Constants.expoConfig?.extra?.googleWebClientId,
    androidClientId: Constants.expoConfig?.extra?.googleAndroidClientId,
  })

  const [facebookRequest, facebookResponse, facebookPromptAsync] = Facebook.useAuthRequest({
    clientId: Constants.expoConfig?.extra?.facebookAuthAppId,
    responseType: ResponseType.Token,
  })

  //const mutationAuthSignInWithCredential = useAuthSignInWithCredential(auth)

  const getUserInfoGoogle = async () => {
    try {
      //  const response = await fetch("https://www.googleapis.com/userinfo/v2/me", {
      //    headers: { Authorization: `Bearer ${token}` },
      //  })
      //
      //  const user = await response.json()
      //  setUserInfo(user)
    } catch (error) {
      // Add your own error handler here
    }
  }

  const getUserInfoFacebook = async () => {
    try {
      //  const userInfoResponse = await fetch(
      //    `https://graph.facebook.com/me?access_token=${facebookResponse.authentication.accessToken}&fields=id,name,picture.type(large)`,
      //  )
      //  const user = await userInfoResponse.json()
      //  setUserInfo(user)
    } catch (error) {
      // Add your own error handler here
    }
  }

  useEffect(() => {
    if (googleResponse?.type === "success") {
      //setToken(googleResponse.authentication.accessToken)
      //getUserInfoGoogle()
      const idToken = null // googleResponse.authentication.accessToken;
      const accessToken = googleResponse.authentication.accessToken
      const credential = GoogleAuthProvider.credential(idToken, accessToken)
      //console.log(accessToken)
      //mutationAuthSignInWithCredential.mutate(credential)
      signInWithCredential(auth, credential)
    }
    if (
      facebookResponse &&
      facebookResponse.type === "success" &&
      facebookResponse.authentication
    ) {
      //setToken(facebookResponse.authentication.accessToken)
      //getUserInfoFacebook()
      const idToken = facebookResponse.authentication.accessToken
      const credential = FacebookAuthProvider.credential(idToken)
      //console.log(idToken)
      //mutationAuthSignInWithCredential.mutate(credential)
      signInWithCredential(auth, credential)
    }
  }, [
    googleResponse,
    facebookResponse,
    // token
  ])

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
      <View style={styles.separator} />
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

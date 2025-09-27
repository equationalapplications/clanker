import { useEffect, useState } from "react"
import { StyleSheet, View, Text } from "react-native"

import { AcceptTerms } from "../components/AcceptTerms"
import ProviderButton from "../components/AuthProviderButton"
import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import Logo from "../components/Logo"
import { MonoText, TitleText } from "../components/StyledText"
import { useUser } from "../hooks/useUser"
import { useUserPrivate } from "../hooks/useUserPrivate"
import { RootStackScreenProps } from "../navigation/types"
import { initializeGoogleSignIn, signInWithGoogle } from "../services/googleSignInUnified"

export default function SignIn({ navigation }: RootStackScreenProps<"SignIn">) {
  const user = useUser()
  const userPrivate = useUserPrivate()
  const hasAcceptedTermsDate = userPrivate?.hasAcceptedTermsDate ?? null
  const [googleSignInLoading, setGoogleSignInLoading] = useState(false)

  // Initialize Google Sign-In when component mounts
  useEffect(() => {
    initializeGoogleSignIn().catch(console.error)
  }, [])

  const GoogleLoginOnPress = async () => {
    setGoogleSignInLoading(true)
    try {
      const result = await signInWithGoogle()
      if (!result.success && result.error) {
        console.error("Google Sign-In failed:", result.error)
        // TODO: Show user-friendly error message
        alert(`Sign-in failed: ${result.error}`)
      }
    } catch (error) {
      console.error("Google Sign-In error:", error)
      alert("An unexpected error occurred during sign-in")
    } finally {
      setGoogleSignInLoading(false)
    }
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
          <ProviderButton
            disabled={googleSignInLoading}
            loading={googleSignInLoading}
            onPress={GoogleLoginOnPress}
            type="google"
          >
            Google
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

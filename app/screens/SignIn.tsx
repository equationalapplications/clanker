import { useEffect, useState } from "react"
import { StyleSheet, View, Text } from "react-native"

import ProviderButton from "../components/AuthProviderButton"
import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import Logo from "../components/Logo"
import { MonoText, TitleText } from "../components/StyledText"
import { useAuthentication } from "../hooks/useAuthentication"
import { RootStackScreenProps } from "../navigation/types"
import { initializeGoogleSignIn, signInWithGoogle } from "../services/googleSignInUnified"

export default function SignIn({ navigation }: RootStackScreenProps<"SignIn">) {
  const { firebaseUser: user, supabaseUser, isLoading, error } = useAuthentication()
  const [googleSignInLoading, setGoogleSignInLoading] = useState(false)

  // Initialize Google Sign-In when component mounts
  useEffect(() => {
    initializeGoogleSignIn().catch(console.error)
  }, [])

  // Navigate to Dashboard when both Firebase and Supabase authentication is complete
  useEffect(() => {
    if (user && supabaseUser) {
      navigation.navigate("Dashboard")
    }
  }, [user, supabaseUser, navigation])

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
    //navigation.navigate("Privacy")
  }

  const onPressTerms = () => {
    // navigation.navigate("Terms")
  }
  return (
    <View style={styles.container}>
      {user && isLoading ? <LoadingIndicator /> : null}
      {!user ? (
        <>
          <TitleText>Yours Brightly AI</TitleText>
          <View style={styles.separator} />
          <MonoText>Create Your Own Simulated Friend</MonoText>
          <Logo />
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>Authentication Error:</Text>
              <Text style={styles.errorMessage}>{error}</Text>
            </View>
          )}
          <ProviderButton
            disabled={googleSignInLoading || isLoading}
            loading={googleSignInLoading || isLoading}
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
  errorContainer: {
    backgroundColor: "#ffebee",
    padding: 16,
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ef5350",
  },
  errorText: {
    fontWeight: "bold",
    color: "#c62828",
    marginBottom: 4,
  },
  errorMessage: {
    color: "#d32f2f",
  },
})

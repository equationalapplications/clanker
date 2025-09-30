import { useEffect, useState } from "react"
import { StyleSheet, View, Text } from "react-native"
import { useRouter } from "expo-router"

import { AcceptTerms } from "../components/AcceptTerms"
import ProviderButton from "../components/AuthProviderButton"
import Button from "../components/Button"
import LoadingIndicator from "../components/LoadingIndicator"
import Logo from "../components/Logo"
import { MonoText, TitleText } from "../components/StyledText"
import { useAuth } from "../hooks/useAuth"
import { useAppAccess } from "../hooks/useAppAccess"
import { initializeGoogleSignIn, signInWithGoogle } from "../services/googleSignInUnified"

export default function SignIn() {
  const router = useRouter()
  const { firebaseUser: user, supabaseUser, isLoading, error } = useAuth()
  const { hasAccess, hasAcceptedTerms, isLoading: appAccessLoading } = useAppAccess()
  const [googleSignInLoading, setGoogleSignInLoading] = useState(false)

  // Initialize Google Sign-In when component mounts
  useEffect(() => {
    initializeGoogleSignIn().catch(console.error)
  }, [])

  // Navigate to Dashboard when both Firebase and Supabase authentication is complete AND user has app access
  useEffect(() => {
    console.log('SignIn useEffect - Auth status:', {
      user: !!user,
      supabaseUser: !!supabaseUser,
      hasAccess,
      hasAcceptedTerms,
      appAccessLoading
    })

    // Temporary bypass: navigate to dashboard if both auth providers are working
    // TODO: Re-enable app access checks once the permission system is working
    if (user && supabaseUser) {
      console.log('Both auth providers ready, navigating to dashboard...')
      // Try navigating to the private root, which should show the tabs
      router.replace("/(private)")
    }

    // Original condition (commented out for now):
    // if (user && supabaseUser && hasAccess && hasAcceptedTerms) {
    //   router.replace("/dashboard")
    // }
  }, [user, supabaseUser, hasAccess, hasAcceptedTerms, router, appAccessLoading])

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
    router.push("/privacy")
  }

  const onPressTerms = () => {
    router.push("/terms")
  }

  const handleTermsAccepted = () => {
    // Terms accepted, user should now have access - the useEffect will handle navigation
    console.log('Terms accepted, waiting for navigation...')
  }

  const handleTermsCanceled = async () => {
    // User canceled terms acceptance, sign them out
    try {
      const { auth } = await import('../config/firebaseConfig')
      const { supabase } = await import('../config/supabaseClient')

      await supabase.auth.signOut()
      await auth.signOut()

      console.log('User signed out after terms cancellation')
    } catch (error) {
      console.error('Error signing out after terms cancellation:', error)
    }
  }

  // Show loading if authentication is in progress
  if (isLoading || appAccessLoading) {
    return (
      <View style={styles.container}>
        <LoadingIndicator />
        <Text style={styles.loadingText}>
          {isLoading ? 'Authenticating...' : 'Checking app access...'}
        </Text>
      </View>
    )
  }

  // Show terms acceptance if user is authenticated but hasn't accepted terms
  if (user && supabaseUser && !hasAcceptedTerms) {
    return (
      <AcceptTerms
        onAccepted={handleTermsAccepted}
        onCanceled={handleTermsCanceled}
        termsVersion="1.0"
      />
    )
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
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button mode="text" onPress={onPressTerms}>Terms and Conditions</Button>
            <Button mode="text" onPress={onPressPrivacy}>Privacy Policy</Button>
          </View>
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
  loadingText: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 16,
    color: '#666',
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

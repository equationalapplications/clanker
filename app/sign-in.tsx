import { useEffect, useState } from 'react'
import { StyleSheet, View, Text, Alert } from 'react-native'
import { useRouter } from 'expo-router'

import ProviderButton from '~/auth/AuthProviderButton'
import Button from '~/components/Button'
import LoadingIndicator from '~/components/LoadingIndicator'
import Logo from '~/components/Logo'
import { MonoText, TitleText } from '~/components/StyledText'
import { useAuth } from '~/auth/useAuth'
import { initializeGoogleSignIn, signInWithGoogle } from '~/services/googleSignInUnified'

export default function SignIn() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const [googleSignInLoading, setGoogleSignInLoading] = useState(false)

  // Initialize Google Sign-In when component mounts
  useEffect(() => {
    initializeGoogleSignIn().catch(console.error)
  }, [])

  useEffect(() => {
    if (user) {
      router.replace('/characters')
    }
  }, [user, router])

  const GoogleLoginOnPress = async () => {
    setGoogleSignInLoading(true)
    try {
      const result = await signInWithGoogle()
      if (!result.success && result.error) {
        console.error('Google Sign-In failed:', result.error)
        // TODO: Show user-friendly error message
        Alert.alert(`Sign-in failed: ${result.error}`)
      }
    } catch (error) {
      console.error('Google Sign-In error:', error)
      Alert.alert('An unexpected error occurred during sign-in')
    } finally {
      setGoogleSignInLoading(false)
    }
  }

  const onPressPrivacy = () => {
    router.push('/privacy')
  }

  const onPressTerms = () => {
    router.push('/terms')
  }

  // Show loading if authentication is in progress
  if (isLoading) {
    return (
      <View style={styles.container}>
        <LoadingIndicator />
        <Text style={styles.loadingText}>
          {isLoading ? 'Authenticating...' : 'Checking app access...'}
        </Text>
      </View>
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
          <ProviderButton
            disabled={googleSignInLoading || isLoading}
            loading={googleSignInLoading || isLoading}
            onPress={GoogleLoginOnPress}
            type="google"
          >
            Google
          </ProviderButton>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Button mode="text" onPress={onPressTerms}>
              Terms and Conditions
            </Button>
            <Button mode="text" onPress={onPressPrivacy}>
              Privacy Policy
            </Button>
          </View>
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%',
  },
  loadingText: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    backgroundColor: '#ffebee',
    padding: 16,
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef5350',
  },
  errorText: {
    fontWeight: 'bold',
    color: '#c62828',
    marginBottom: 4,
  },
  errorMessage: {
    color: '#d32f2f',
  },
})

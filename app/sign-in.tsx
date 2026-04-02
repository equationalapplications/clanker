import { useEffect, useState } from 'react'
import { StyleSheet, View, Alert, Platform } from 'react-native'
import { useRouter } from 'expo-router'

import ProviderButton from '~/auth/AuthProviderButton'
import Button from '~/components/Button'
import Logo from '~/components/Logo'
import { MonoText, TitleText } from '~/components/StyledText'
import { useAuth } from '~/auth/useAuth'
import { signInWithGoogle } from '~/auth/googleSignin'
import { signInWithApple, handleAppleRedirectResult } from '~/auth/appleSignin'

// expo-apple-authentication is iOS-only; defer require to avoid breaking
// web bundling or crashing Android where the native module is unavailable.
const AppleAuthentication = Platform.OS === 'ios' ? require('expo-apple-authentication') : null

export default function SignIn() {
  const router = useRouter()
  const { user } = useAuth()
  const [googleSignInLoading, setGoogleSignInLoading] = useState(false)
  const [appleSignInLoading, setAppleSignInLoading] = useState(false)

  useEffect(() => {
    if (user) {
      router.replace('/characters')
    }
  }, [user, router])

  useEffect(() => {
    handleAppleRedirectResult().then((result) => {
      if (!result.success && result.error) {
        console.error('Apple Sign-In redirect failed:', result.error)
        Alert.alert('Sign-in failed', result.error)
      }
    })
  }, [])

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

  const AppleLoginOnPress = async () => {
    if (appleSignInLoading) {
      return
    }
    setAppleSignInLoading(true)
    try {
      const result = await signInWithApple()
      if (!result.success && result.error) {
        console.error('Apple Sign-In failed:', result.error)
        Alert.alert('Sign-in failed', result.error)
      }
    } catch (error) {
      console.error('Apple Sign-In error:', error)
      Alert.alert('An unexpected error occurred during sign-in')
    } finally {
      setAppleSignInLoading(false)
    }
  }

  const onPressTerms = () => {
    router.push('/terms')
  }

  return (
    <View style={styles.container}>
      {!user ? (
        <>
          <TitleText>Clanker</TitleText>
          <View style={styles.separator} />
          <MonoText>Create Your Own AI Clanker</MonoText>
          <Logo />
          <ProviderButton
            disabled={googleSignInLoading}
            loading={googleSignInLoading}
            onPress={GoogleLoginOnPress}
            type="google"
          >
            Google
          </ProviderButton>
          {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={20}
              style={styles.appleButton}
              onPress={AppleLoginOnPress}
            />
          )}
          {Platform.OS === 'web' && (
            <ProviderButton
              disabled={appleSignInLoading}
              loading={appleSignInLoading}
              onPress={AppleLoginOnPress}
              type="apple"
            >
              Apple
            </ProviderButton>
          )}
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
  appleButton: {
    width: 300,
    height: 44,
    marginVertical: 5,
  },
  loadingText: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    padding: 16,
    margin: 16,
    borderRadius: 8,
    borderWidth: 1,
  },
  errorText: {
    fontWeight: 'bold',
    marginBottom: 4,
  },
  errorMessage: {},
})

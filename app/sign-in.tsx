import { useEffect } from 'react'
import { StyleSheet, View, Alert, Platform, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { useSelector } from '@xstate/react'

import ProviderButton from '~/auth/AuthProviderButton'
import Button from '~/components/Button'
import Logo from '~/components/Logo'
import { MonoText, TitleText } from '~/components/StyledText'
import { useAuthMachine } from '~/hooks/useMachines'
import { handleAppleRedirectResult } from '~/auth/appleSignin'

// expo-apple-authentication is iOS-only; defer require to avoid breaking
// web bundling or crashing Android where the native module is unavailable.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const AppleAuthentication = Platform.OS === 'ios' ? require('expo-apple-authentication') : null

export default function SignIn() {
  const router = useRouter()
  const { width } = useWindowDimensions()
  const isNarrowScreen = width < 380
  const authService = useAuthMachine()
  const { isSignedIn, isLoading, error } = useSelector(authService, (state) => ({
    isSignedIn: state.matches('signedIn'),
    isLoading:
      state.matches('initializing') ||
      state.matches('signingIn') ||
      state.matches('exchangingToken') ||
      state.matches('establishingSupabaseSession'),
    error: state.context.error,
  }))

  useEffect(() => {
    if (isSignedIn) {
      router.replace('/characters/list')
    }
  }, [isSignedIn, router])

  useEffect(() => {
    if (error) {
      Alert.alert('Sign-in failed', error.message)
    }
  }, [error])

  useEffect(() => {
    handleAppleRedirectResult().then((result) => {
      if (!result.success && result.error) {
        console.error('Apple Sign-In redirect failed:', result.error)
        Alert.alert('Sign-in failed', result.error)
      }
    })
  }, [])

  const GoogleLoginOnPress = () => {
    authService.send({ type: 'SIGN_IN', provider: 'google' })
  }

  const onPressPrivacy = () => {
    router.push('/privacy')
  }

  const AppleLoginOnPress = () => {
    authService.send({ type: 'SIGN_IN', provider: 'apple' })
  }

  const onPressTerms = () => {
    router.push('/terms')
  }

  return (
    <View style={styles.container}>
      {!isSignedIn ? (
        <>
          <TitleText>Clanker</TitleText>
          <View style={styles.separator} />
          <MonoText>Create Your Own AI Clanker</MonoText>
          <Logo />
          <View style={styles.authButtons}>
            <ProviderButton
              style={styles.providerButton}
              disabled={isLoading}
              loading={isLoading}
              onPress={GoogleLoginOnPress}
              type="google"
            >
              Google
            </ProviderButton>
            {Platform.OS === 'ios' && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                cornerRadius={40}
                style={styles.appleButton}
                onPress={AppleLoginOnPress}
              />
            )}
            {Platform.OS === 'web' && (
              <ProviderButton
                style={styles.providerButton}
                disabled={isLoading}
                loading={isLoading}
                onPress={AppleLoginOnPress}
                type="apple"
              >
                Apple
              </ProviderButton>
            )}
          </View>
          <View style={[styles.footer, isNarrowScreen && styles.footerNarrow]}>
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
    padding: 20,
  },
  separator: {
    marginVertical: 30,
    height: 1,
    width: '80%',
    backgroundColor: '#eee',
  },
  authButtons: {
    width: '100%',
    maxWidth: 300,
    marginTop: 10,
  },
  appleButton: {
    width: '100%',
    height: 44,
    marginTop: 10,
  },
  providerButton: {
    width: '100%',
  },
  footer: {
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
  },
  footerNarrow: {
    flexDirection: 'column',
  },
})

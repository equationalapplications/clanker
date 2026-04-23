import { useEffect, useState } from 'react'
import { StyleSheet, View, Alert, Platform, ScrollView, useWindowDimensions, Linking } from 'react-native'
import { useRouter, useLocalSearchParams, type Href } from 'expo-router'
import * as ExpoLinking from 'expo-linking'
import { useSelector } from '@xstate/react'

import ProviderButton from '~/auth/AuthProviderButton'
import Button from '~/components/Button'
import Logo from '~/components/Logo'
import { MonoText, TitleText } from '~/components/StyledText'
import { useAuthMachine } from '~/hooks/useMachines'
import { handleAppleRedirectResult } from '~/auth/appleSignin'
import {
  isProtectedPath,
  toValidatedInternalHref,
  resolveRedirectDestination,
} from '~/utilities/authRedirect'

// Defer native Apple auth require to avoid loading it in web bundles.
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
      state.matches('bootstrapping'),
    error: state.context.error,
  }))

  const { redirect } = useLocalSearchParams<{ redirect?: string }>()
  const [initialRedirect, setInitialRedirect] = useState<Href | null>(null)

  useEffect(() => {
    let mounted = true

    Linking.getInitialURL()
      .then((url) => {
        if (!mounted || !url) return

        // expo-linking correctly handles custom-scheme URLs like
        // com.equationalapplications.clanker://chat/123 where new URL() would
        // treat 'chat' as the host and return '/123' as the pathname.
        const parsed = ExpoLinking.parse(url)
        const { path, queryParams } = parsed

        if (!path) return

        const pathname = '/' + path
        const search =
          queryParams && Object.keys(queryParams).length > 0
            ? '?' + new URLSearchParams(queryParams as Record<string, string>).toString()
            : ''
        const fullPath = pathname + search
        const validatedPath = toValidatedInternalHref(fullPath)

        if (validatedPath && isProtectedPath(pathname)) {
          setInitialRedirect(validatedPath)
        }
      })
      .catch((error) => {
        console.warn('Failed to read initial URL for post-auth redirect:', error)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (isSignedIn) {
      const destination = resolveRedirectDestination(initialRedirect, redirect)
      router.replace(destination)
    }
  }, [isSignedIn, router, redirect, initialRedirect])

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
    <ScrollView
      style={styles.scrollContainer}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
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
              {Platform.OS === 'ios' && AppleAuthentication && (
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
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  container: {
    width: '100%',
    alignItems: 'center',
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

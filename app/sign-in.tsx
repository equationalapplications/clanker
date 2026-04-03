import { useEffect } from 'react'
import { StyleSheet, View, Alert, Platform } from 'react-native'
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
  const authService = useAuthMachine();
  const { user, isLoading, error } = useSelector(authService, (state) => ({
    user: state.context.user,
    isLoading: state.matches('signingIn'),
    error: state.context.error,
  }));

  useEffect(() => {
    if (user) {
      router.replace('/(drawer)/(tabs)/characters')
    }
  }, [user, router])

  useEffect(() => {
    if (error) {
      Alert.alert('Sign-in failed', error.message);
    }
  }, [error]);

  useEffect(() => {
    handleAppleRedirectResult().then((result) => {
      if (!result.success && result.error) {
        console.error('Apple Sign-In redirect failed:', result.error)
        Alert.alert('Sign-in failed', result.error)
      }
    })
  }, [])

  const GoogleLoginOnPress = () => {
    authService.send({ type: 'SIGN_IN', provider: 'google' });
  }

  const onPressPrivacy = () => {
    router.push('/privacy')
  }

  const AppleLoginOnPress = () => {
    authService.send({ type: 'SIGN_IN', provider: 'apple' });
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
              cornerRadius={5}
              style={styles.appleButton}
              onPress={AppleLoginOnPress}
            />
          )}
          <View style={styles.footer}>
            <Button onPress={onPressTerms}>
              <MonoText>Terms & Conditions</MonoText>
            </Button>
            <Button onPress={onPressPrivacy}>
              <MonoText>Privacy Policy</MonoText>
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
  appleButton: {
    width: 192,
    height: 44,
    marginTop: 10,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
})

import { Platform } from 'react-native'
import { getAuth, signInWithCredential, AppleAuthProvider } from '@react-native-firebase/auth'

import { generateNonce, sha256 } from './nonce'

export interface AppleSignInResult {
  success: boolean
  error?: string
}

export const signInWithApple = async (): Promise<AppleSignInResult> => {
  if (Platform.OS !== 'ios') {
    return { success: false, error: 'Apple Sign-In is only available on iOS' }
  }

  // Defer import until after platform check to avoid crashing on Android
  // where the expo-apple-authentication native module is unavailable
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AppleAuthentication = require('expo-apple-authentication')

  try {
    const isAvailable = await AppleAuthentication.isAvailableAsync()
    if (!isAvailable) {
      return { success: false, error: 'Apple Sign-In is not available on this device' }
    }

    const rawNonce = generateNonce()
    const hashedNonce = await sha256(rawNonce)

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    })

    const { identityToken } = credential

    if (!identityToken) {
      return { success: false, error: 'No identity token received from Apple' }
    }

    const appleCredential = AppleAuthProvider.credential(identityToken, rawNonce)
    await signInWithCredential(getAuth(), appleCredential)

    console.log('✅ Apple Sign-In successful')
    return { success: true }
  } catch (error: any) {
    console.error('Apple Sign-In Error:', error)

    if (error.code === 'ERR_REQUEST_CANCELED') {
      return { success: false, error: 'Sign-in was cancelled' }
    }

    return { success: false, error: error.message || 'Unknown error occurred' }
  }
}

// Apple does not provide an SDK-level sign-out. Per Expo docs, simply clearing
// the user's stored data is the recommended approach. Firebase sign-out is
// handled separately by the auth context.
export const signOutFromApple = async (): Promise<void> => {
  // no-op
}

// no-op on native — redirect result handling is web-only
export const handleAppleRedirectResult = async (): Promise<AppleSignInResult> => {
  return { success: true }
}

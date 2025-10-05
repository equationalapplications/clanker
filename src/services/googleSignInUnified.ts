import { Platform } from "react-native"

// Import native implementation
import {
  configureGoogleSignIn,
  signInWithGoogle as signInWithGoogleNative,
  signOutFromGoogle as signOutFromGoogleNative,
  getCurrentGoogleUser as getCurrentGoogleUserNative,
  type GoogleSignInResult
} from "~/services/googleSignIn"

// Import web implementation
import {
  configureGoogleSignInWeb,
  signInWithGoogleWeb
} from "~/services/googleSignInWeb"

export type { GoogleSignInResult }

// Initialize Google Sign-In based on platform
export const initializeGoogleSignIn = async () => {
  if (Platform.OS === 'web') {
    await configureGoogleSignInWeb()
  } else {
    configureGoogleSignIn()
  }
}

// Unified sign in method
export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  if (Platform.OS === 'web') {
    return await signInWithGoogleWeb()
  } else {
    return await signInWithGoogleNative()
  }
}

// Sign out (only available on native platforms)
export const signOutFromGoogle = async (): Promise<void> => {
  if (Platform.OS !== 'web') {
    await signOutFromGoogleNative()
  }
}

// Get current user (only available on native platforms)
export const getCurrentGoogleUser = async () => {
  if (Platform.OS !== 'web') {
    return await getCurrentGoogleUserNative()
  }
  return null
}
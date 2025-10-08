import { Platform } from 'react-native'
import { GoogleSignin } from '@react-native-google-signin/google-signin'
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { auth } from '~/config/firebaseConfig'
import { googleWebClientId, googleAndroidClientId } from '../config/constants'

// Configure Google Sign-In
export const configureGoogleSignIn = () => {
  GoogleSignin.configure({
    webClientId: googleWebClientId, // Required for both Android and web
    offlineAccess: true,
    hostedDomain: '',
    forceCodeForRefreshToken: true,
    accountName: '',
    // iosClientId: "",
    googleServicePlistPath: '',
    profileImageSize: 120,
  })
}

export interface GoogleSignInResult {
  success: boolean
  error?: string
}

export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  try {
    // Check if your device supports Google Play
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })

    // Get the users ID token
    const userInfo = await GoogleSignin.signIn()

    // Get the ID token from the user info (coerce to string to satisfy typings)
    const idToken = (userInfo as any).idToken as string | undefined

    if (!idToken) {
      return { success: false, error: 'No ID token received from Google' }
    }

    // Create a Google credential with the token
    const googleCredential = GoogleAuthProvider.credential(idToken)

    // Sign-in the user with the credential
    await signInWithCredential(auth, googleCredential)

    return { success: true }
  } catch (error: any) {
    console.error('Google Sign-In Error:', error)

    // Handle specific error cases
    if (error.code === 'statusCodes.SIGN_IN_CANCELLED') {
      return { success: false, error: 'Sign in was cancelled' }
    }
    if (error.code === 'statusCodes.IN_PROGRESS') {
      return { success: false, error: 'Sign in is already in progress' }
    }
    if (error.code === 'statusCodes.PLAY_SERVICES_NOT_AVAILABLE') {
      return { success: false, error: 'Play services not available or outdated' }
    }

    return { success: false, error: error.message || 'Unknown error occurred' }
  }
}

export const signOutFromGoogle = async (): Promise<void> => {
  try {
    await GoogleSignin.revokeAccess()
    await GoogleSignin.signOut()
  } catch (error) {
    console.error('Google Sign-Out Error:', error)
  }
}

export const getCurrentGoogleUser = async () => {
  try {
    const userInfo = await GoogleSignin.signInSilently()
    return userInfo
  } catch (error) {
    console.log('No current Google user:', error)
    return null
  }
}

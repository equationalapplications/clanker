import { GoogleSignin } from '@react-native-google-signin/google-signin'
import { Platform } from 'react-native'
import firebaseAuth from '@react-native-firebase/auth'

// Configure Google Sign-In
export const initializeGoogleSignIn = () => {
  // Base config works for Android and iOS; Android uses the Web client ID.
  const baseConfig: Record<string, any> = {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, // Required for Android & web OAuth
    offlineAccess: true,
    hostedDomain: '',
    forceCodeForRefreshToken: true,
    accountName: '',
    googleServicePlistPath: '',
    profileImageSize: 120,
  }

  // On iOS, prefer the iOS client ID if provided
  if (Platform.OS === 'ios' && process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID) {
    baseConfig.iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
  }

  // Note: The RN Google Sign-In SDK uses the Web client ID on Android.
  // If you maintain an Android client ID, it's typically not required here.
  // Leaving a reference for clarity (not passed to configure to avoid type issues):
  // const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID

  GoogleSignin.configure(baseConfig as any)
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
    const response = await GoogleSignin.signIn()

    console.log('🔍 Google Sign-In response:', JSON.stringify(response, null, 2))

    // Extract ID token from the response - check different possible locations
    const idToken = response.data?.idToken || (response as any).idToken

    if (!idToken) {
      console.error('❌ No ID token in response:', response)
      return { success: false, error: 'No ID token received from Google' }
    }

    console.log('✅ Got ID token, signing in with Firebase...')

    // Create Google credential using React Native Firebase
    const googleCredential = firebaseAuth.GoogleAuthProvider.credential(idToken)

    // Sign in to Firebase with the Google credential
    await firebaseAuth().signInWithCredential(googleCredential)

    console.log('✅ Firebase sign-in successful')
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

export const getCurrentUser = async () => {
  try {
    const userInfo = await GoogleSignin.signInSilently()
    return userInfo
  } catch (error) {
    console.log('No current Google user:', error)
    return null
  }
}

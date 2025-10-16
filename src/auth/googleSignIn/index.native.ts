import { GoogleSignin } from '@react-native-google-signin/google-signin'
import { auth } from '~/config/firebaseConfig'
import { googleWebClientId } from '~/config/constants'

// Configure Google Sign-In
export const initializeGoogleSignIn = () => {
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
    const response = await GoogleSignin.signIn()

    console.log('🔍 Google Sign-In response:', JSON.stringify(response, null, 2))

    // Extract ID token from the response - check different possible locations
    const idToken = response.data?.idToken || (response as any).idToken

    if (!idToken) {
      console.error('❌ No ID token in response:', response)
      return { success: false, error: 'No ID token received from Google' }
    }

    console.log('✅ Got ID token, signing in with Firebase...')

    // Import React Native Firebase auth to get GoogleAuthProvider
    const authModule = await import('@react-native-firebase/auth')
    const googleCredential = authModule.default.GoogleAuthProvider.credential(idToken)

    // Sign in to Firebase with the Google credential
    await auth.signInWithCredential(googleCredential)

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

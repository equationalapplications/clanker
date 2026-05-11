import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin'
import { getAuth, signInWithCredential, GoogleAuthProvider } from '@react-native-firebase/auth'
import { syncDisplayNameFromCredential } from './syncDisplayName'

// Configure Google Sign-In
export const initializeGoogleSignIn = () => {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. Configure it in .env or EAS secrets.'
    )
  }

  // Base config works for Android and iOS; Android uses the Web client ID.
  // iosClientId is set explicitly so Google Sign-In doesn't need to read CLIENT_ID
  // from the bundled GoogleService-Info.plist (which may be stripped in some builds).
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
  const baseConfig: Record<string, any> = {
    webClientId,
    ...(iosClientId ? { iosClientId } : {}),
    offlineAccess: true,
    hostedDomain: '',
    forceCodeForRefreshToken: true,
    accountName: '',
    profileImageSize: 120,
  }

  GoogleSignin.configure(baseConfig as any)
}

export interface GoogleSignInResult {
  success: boolean
  cancelled?: boolean
  error?: string
}

export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  try {
    // Check if your device supports Google Play
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })

    const response = await GoogleSignin.signIn()

    if (response.type === 'cancelled') {
      return { success: false, cancelled: true, error: 'Sign-in was cancelled' }
    }

    console.log('🔍 Google Sign-In response received (idToken redacted)')

    const idToken = response.data.idToken

    if (!idToken) {
      console.error('❌ No ID token in response')
      return { success: false, error: 'No ID token received from Google' }
    }

    const googleCredential = GoogleAuthProvider.credential(idToken)
    const userCredential = await signInWithCredential(getAuth(), googleCredential)

    const givenName = response.data.user?.givenName?.trim() ?? ''
    const familyName = response.data.user?.familyName?.trim() ?? ''
    const googleDisplayName = response.data.user?.name?.trim() ?? `${givenName} ${familyName}`.trim()

    try {
      await syncDisplayNameFromCredential(userCredential.user, googleDisplayName)
    } catch (syncError: any) {
      console.warn('Google Sign-In display name sync failed:', syncError)
    }

    console.log('✅ Firebase sign-in successful')
    return { success: true }
  } catch (error: any) {
    console.error('Google Sign-In Error:', error)

    // Handle specific error cases
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      return { success: false, cancelled: true, error: 'Sign-in was cancelled' }
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      return { success: false, error: 'Sign in is already in progress' }
    }
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
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

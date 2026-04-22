// Web-specific Google Sign-In implementation
import { GoogleAuthProvider, getAuth, signInWithCredential, signInWithPopup } from 'firebase/auth'
import { firebaseApp } from '~/config/firebaseConfig.web'

declare global {
  interface Window {
    google?: any
  }
}

export interface GoogleSignInResult {
  success: boolean
  error?: string
}

let googleLoadPromise: Promise<void> | null = null

const auth = getAuth(firebaseApp)
const googleProvider = new GoogleAuthProvider()

const loadGoogleScript = (): Promise<void> => {
  if (googleLoadPromise) {
    return googleLoadPromise
  }

  googleLoadPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts) {
      resolve()
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.onload = () => {
      resolve()
    }
    script.onerror = reject
    document.body.appendChild(script)
  })

  return googleLoadPromise
}

export const initializeGoogleSignIn = async () => {
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  if (!webClientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. Configure it in .env or EAS secrets.'
    )
  }

  await loadGoogleScript()

  if (window.google && window.google.accounts) {
    window.google.accounts.id.initialize({
      client_id: webClientId,
      callback: () => {}, // Will be set per sign-in attempt
    })
  }
}

/**
 * Sign in with Google using Firebase popup as primary method
 * Falls back to Google One Tap / OAuth2 if popup is blocked
 */
export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  // Validate client ID once at the start
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  if (!webClientId) {
    return { success: false, error: 'Google Web Client ID not configured' }
  }

  try {
    // Primary method: Firebase signInWithPopup (most reliable, avoids FedCM issues)
    try {
      console.log('🔐 Attempting Google Sign-In via Firebase popup...')
      await signInWithPopup(auth, googleProvider)
      console.log('✅ Google Sign-In successful via popup')
      return { success: true }
    } catch (popupError: any) {
      // If popup was blocked or closed, try Google Identity Services
      console.log('⚠️ Popup sign-in failed, trying Google Identity Services:', popupError.code)

      if (popupError.code === 'auth/popup-closed-by-user') {
        return { success: false, error: 'Sign-in cancelled' }
      }

      if (popupError.code === 'auth/popup-blocked') {
        console.log('🔄 Popup blocked, falling back to Google One Tap...')
        // Fall through to Google Identity Services below
      } else {
        // For other errors, report them
        return { success: false, error: popupError.message || 'Popup sign-in failed' }
      }
    }

    // Fallback: Google Identity Services (One Tap / OAuth2)
    await loadGoogleScript()

    if (!window.google || !window.google.accounts) {
      return { success: false, error: 'Google Sign-In not available' }
    }

    return new Promise((resolve) => {
      window.google.accounts.id.initialize({
        client_id: webClientId,
        callback: async (response: any) => {
          try {
            if (response.credential) {
              const googleCredential = GoogleAuthProvider.credential(response.credential)
              await signInWithCredential(auth, googleCredential)
              resolve({ success: true })
            } else {
              resolve({ success: false, error: 'No credential received' })
            }
          } catch (error: any) {
            console.error('Google Sign-In Error:', error)
            resolve({ success: false, error: error.message || 'Unknown error occurred' })
          }
        },
      })

      window.google.accounts.id.prompt((notification: any) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // One Tap not available, try OAuth2 token flow
          window.google.accounts.oauth2
            .initTokenClient({
              client_id: webClientId,
              scope: 'email profile',
              callback: async (response: any) => {
                try {
                  if (response.access_token) {
                    const credential = GoogleAuthProvider.credential(null, response.access_token)
                    await signInWithCredential(auth, credential)
                    resolve({ success: true })
                  } else {
                    resolve({ success: false, error: 'No access token received' })
                  }
                } catch (error: any) {
                  console.error('Google OAuth Error:', error)
                  resolve({ success: false, error: error.message || 'Unknown error occurred' })
                }
              },
            })
            .requestAccessToken()
        }
      })
    })
  } catch (error: any) {
    console.error('Google Sign-In Setup Error:', error)
    return { success: false, error: error.message || 'Unknown error occurred' }
  }
}

// Stub for web - sign out is handled by Firebase auth
export const signOutFromGoogle = async (): Promise<void> => {
  // No-op on web - Firebase auth handles sign out
}

// Stub for web - not needed on web platform
export const getCurrentUser = async () => {
  return null
}

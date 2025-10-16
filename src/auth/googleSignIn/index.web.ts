// Web-specific Google Sign-In implementation
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { auth } from '~/config/firebaseConfig'
import { googleWebClientId } from '~/config/constants'

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
  await loadGoogleScript()

  if (window.google && window.google.accounts) {
    window.google.accounts.id.initialize({
      client_id: googleWebClientId,
      callback: () => { }, // Will be set per sign-in attempt
    })
  }
}

export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  try {
    await loadGoogleScript()

    if (!window.google || !window.google.accounts) {
      return { success: false, error: 'Google Sign-In not available' }
    }

    return new Promise((resolve) => {
      window.google.accounts.id.initialize({
        client_id: googleWebClientId,
        callback: async (response: any) => {
          try {
            if (response.credential) {
              // Create a Google credential with the token
              const googleCredential = GoogleAuthProvider.credential(response.credential)

              // Sign-in the user with the credential
              await signInWithCredential(auth._instance, googleCredential)

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

      // Show the sign-in popup
      window.google.accounts.id.prompt((notification: any) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // Fallback to popup if the one-tap is not displayed
          window.google.accounts.oauth2
            .initTokenClient({
              client_id: googleWebClientId,
              scope: 'email profile',
              callback: async (response: any) => {
                try {
                  if (response.access_token) {
                    // For OAuth2 flow, we need to get the ID token differently
                    // This is a simplified version - you might need to adjust based on your needs
                    const credential = GoogleAuthProvider.credential(null, response.access_token)
                    await signInWithCredential(auth._instance, credential)
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

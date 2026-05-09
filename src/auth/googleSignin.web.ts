// Web-specific Google Sign-In implementation
import { GoogleAuthProvider, getAuth, signInWithCredential } from 'firebase/auth'
import { firebaseApp } from '~/config/firebaseConfig.web'
import { syncDisplayNameFromCredential } from './syncDisplayName.web'

declare global {
  interface Window {
    google?: any
  }
}

export interface GoogleSignInResult {
  success: boolean
  error?: string
}

const auth = getAuth(firebaseApp)
let scriptPromise: Promise<void> | null = null

const loadGoogleScript = (): Promise<void> => {
  if (scriptPromise) return scriptPromise
  const p = new Promise<void>((resolve, reject) => {
    // Short-circuit only when the GIS `id` API is fully available. Other scripts
    // may populate `google.accounts` partially (e.g. analytics tags, or a
    // half-initialized GIS load), and the sign-in flow below depends on
    // `google.accounts.id`. Falling through ensures the GIS client is loaded.
    if (window.google?.accounts?.id) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.google?.accounts?.id) {
        resolve()
        return
      }
      script.remove()
      reject(new Error('Google Identity Services loaded but google.accounts.id is unavailable'))
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('Failed to load Google Identity Services'))
    }
    document.body.appendChild(script)
  })
  scriptPromise = p
  void p.catch(() => {
    scriptPromise = null
  })
  return p
}

const getClientId = (): string | null => process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || null

export const initializeGoogleSignIn = async (): Promise<void> => {
  const clientId = getClientId()
  if (!clientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. Configure it in .env locally or set it as a build-time environment variable in eas.json (see: https://docs.expo.dev/build-reference/variables/).',
    )
  }
  await loadGoogleScript()
  if (!window.google?.accounts?.id) {
    throw new Error('Google Identity Services did not load (google.accounts.id unavailable)')
  }
}

const exchangeCredential = async (idToken: string): Promise<GoogleSignInResult> => {
  try {
    const cred = GoogleAuthProvider.credential(idToken, null)
    const userCredential = await signInWithCredential(auth, cred)
    try {
      await syncDisplayNameFromCredential(userCredential.user)
    } catch (syncError: any) {
      // Session is already established; a failed profile sync should not surface as sign-in failure.
      console.error('Google Sign-In display name sync failed:', syncError)
    }
    return { success: true }
  } catch (error: any) {
    console.error('Google Sign-In credential exchange failed:', error)
    return { success: false, error: error.message || 'Sign-in failed' }
  }
}

export const signInWithGoogle = async (): Promise<GoogleSignInResult> => {
  const clientId = getClientId()
  if (!clientId) {
    return { success: false, error: 'Google Web Client ID not configured' }
  }

  try {
    await loadGoogleScript()
  } catch (error: any) {
    return { success: false, error: error.message || 'Google Sign-In unavailable' }
  }

  if (!window.google?.accounts?.id) {
    return { success: false, error: 'Google Sign-In unavailable' }
  }

  /** FedCM / some browsers may not invoke the prompt listener; avoid hanging the auth machine. */
  const PROMPT_SETTLE_TIMEOUT_MS = 180_000

  return new Promise<GoogleSignInResult>((resolve) => {
    let settled = false
    const settle = (r: GoogleSignInResult) => {
      if (settled) return
      settled = true
      clearTimeout(promptTimeout)
      resolve(r)
    }

    const promptTimeout = setTimeout(() => {
      settle({
        success: false,
        error: 'Google Sign-In timed out',
      })
    }, PROMPT_SETTLE_TIMEOUT_MS)
    ;(promptTimeout as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.()

    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: async (response: any) => {
        try {
          if (!response?.credential) {
            settle({ success: false, error: 'No credential received' })
            return
          }
          // Prompt-settle timeout only covers the FedCM / prompt phase; once we have
          // an ID token, slow `signInWithCredential` must not lose a race to that timer.
          clearTimeout(promptTimeout)
          const exchanged = await exchangeCredential(response.credential)
          settle(exchanged)
        } catch (error: any) {
          console.error('Google Sign-In callback exception:', error)
          settle({ success: false, error: error?.message || String(error) || 'Sign-in callback failed' })
        }
      },
    })

    window.google.accounts.id.prompt((notification: any) => {
      if (notification?.isDismissedMoment?.()) {
        // GIS reports `credential_returned` when the prompt closes after account
        // selection while the async credential callback is still exchanging the ID
        // token. Treating that as "cancelled" races with `exchangeCredential` and
        // surfaces a false failure while sign-in succeeds.
        if (notification.getDismissedReason?.() === 'credential_returned') {
          return
        }
        settle({ success: false, error: 'Sign-in cancelled' })
        return
      }
      if (notification?.isNotDisplayed?.() || notification?.isSkippedMoment?.()) {
        settle({
          success: false,
          error: 'Google Sign-In unavailable',
        })
      }
    })
  })
}

export const getCurrentUser = async () => null

export const signOutFromGoogle = async (): Promise<void> => {
  // No-op on web. Firebase signOut is sufficient; authMachine no longer depends on GIS sign-out.
}

/** Clears GIS script load cache between tests (Jest). */
export const resetGoogleSignInWebForTests = (): void => {
  scriptPromise = null
}

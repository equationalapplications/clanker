// Web-specific Google Sign-In implementation — FedCM rendered button
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
  cancelled?: boolean
  error?: string
}

const auth = getAuth(firebaseApp)

let scriptPromise: Promise<void> | null = null

const loadGoogleScript = (): Promise<void> => {
  if (scriptPromise) return scriptPromise
  const p = new Promise<void>((resolve, reject) => {
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

export interface GoogleSignInHandlers {
  onCredentialStart: () => void
  onCredentialSuccess: () => void
  onCredentialError: (error: Error) => void
}

let currentHandlers: GoogleSignInHandlers | null = null

const handleCredential = async (response: any): Promise<void> => {
  const handlers = currentHandlers
  if (!handlers) return

  if (!response?.credential) {
    handlers.onCredentialError(new Error('No credential received from Google'))
    return
  }

  handlers.onCredentialStart()

  try {
    const cred = GoogleAuthProvider.credential(response.credential, null)
    const userCredential = await signInWithCredential(auth, cred)

    try {
      await syncDisplayNameFromCredential(userCredential.user)
    } catch (syncError) {
      console.warn('Google Sign-In display name sync failed:', syncError)
    }

    handlers.onCredentialSuccess()
  } catch (error: unknown) {
    console.warn('Google Sign-In credential exchange failed:', error)
    handlers.onCredentialError(error instanceof Error ? error : new Error(String(error)))
  }
}

export const initializeGoogleSignIn = async (handlers: GoogleSignInHandlers): Promise<void> => {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
  if (!clientId) {
    throw new Error(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set. Configure it in .env locally or as a build-time variable in eas.json.',
    )
  }

  await loadGoogleScript()

  if (!window.google?.accounts?.id) {
    throw new Error('Google Identity Services did not load (google.accounts.id unavailable)')
  }

  currentHandlers = handlers

  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: handleCredential,
    use_fedcm_for_button: true,
    auto_select: false,
    itp_support: true,
  })
}

export interface RenderButtonOptions {
  theme?: string
  size?: string
  text?: string
  shape?: string
  width?: number
}

export const renderGoogleSignInButton = (
  container: HTMLElement,
  options?: RenderButtonOptions,
): void => {
  window.google?.accounts?.id?.renderButton(container, {
    type: 'standard',
    theme: options?.theme ?? 'filled_blue',
    size: options?.size ?? 'large',
    text: options?.text ?? 'signin_with',
    shape: options?.shape ?? 'rectangular',
    logo_alignment: 'left',
    ...(options?.width !== undefined ? { width: options.width } : {}),
  })
}

/**
 * Web Google sign-in uses the FedCM GIS button (`GoogleSignInButton.web`).
 * The auth machine still calls this symbol on web for symmetry; the UI path
 * should not reach it.
 */
export const signInWithGoogle = async (): Promise<GoogleSignInResult> => ({
  success: false,
  error: 'Use the Google sign-in button on web',
})

export const getCurrentUser = async () => null

export const signOutFromGoogle = async (): Promise<void> => {
  // No-op on web. Firebase signOut is sufficient.
}

/** Resets script load cache and stored handlers between tests (Jest). */
export const resetGoogleSignInWebForTests = (): void => {
  scriptPromise = null
  currentHandlers = null
}

// src/auth/appleSignin.web.ts
import { OAuthProvider, getAuth, signInWithCredential } from 'firebase/auth'
import { firebaseApp } from '~/config/firebaseConfig.web'
import { generateNonce, sha256 } from './nonce.web'
import { syncDisplayNameFromCredential } from './syncDisplayName.web'

declare global {
  interface Window {
    AppleID?: any
  }
}

export interface AppleSignInResult {
  success: boolean
  cancelled?: boolean
  error?: string
}

const auth = getAuth(firebaseApp)
let scriptPromise: Promise<void> | null = null

const APPLE_JS_SRC =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'

const loadAppleScript = (): Promise<void> => {
  if (scriptPromise) return scriptPromise
  const p = new Promise<void>((resolve, reject) => {
    if (window.AppleID?.auth) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = APPLE_JS_SRC
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.AppleID?.auth) {
        resolve()
        return
      }
      script.remove()
      reject(new Error('Apple Sign In JS loaded but AppleID.auth is unavailable'))
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('Failed to load Apple Sign In JS'))
    }
    document.body.appendChild(script)
  })
  scriptPromise = p
  void p.catch(() => {
    scriptPromise = null
  })
  return p
}

const buildDisplayNameFromAppleUser = (user: any): string | undefined => {
  const first = user?.name?.firstName?.trim?.() || ''
  const last = user?.name?.lastName?.trim?.() || ''
  const combined = `${first} ${last}`.trim()
  return combined || undefined
}

export interface AppleSignInHandlers {
  onCredentialStart: () => void
  onCredentialSuccess: () => void
  onCredentialError: (error: Error) => void
}

let currentAppleHandlers: AppleSignInHandlers | null = null
let currentRawNonce: string | null = null

export const initializeAppleSignIn = async (
  handlers: AppleSignInHandlers,
): Promise<() => void> => {
  const clientId = process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID
  const redirectURI = process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI
  if (!clientId || !redirectURI) {
    throw new Error('Apple Sign-In not configured (missing client id or redirect URI)')
  }

  await loadAppleScript()

  if (!window.AppleID?.auth) {
    throw new Error('Apple Sign-In unavailable (AppleID.auth unavailable)')
  }

  let rawNonce: string
  let hashedNonce: string
  try {
    rawNonce = generateNonce()
    hashedNonce = await sha256(rawNonce)
  } catch (error: unknown) {
    throw error instanceof Error ? error : new Error(String(error))
  }

  currentAppleHandlers = handlers
  currentRawNonce = rawNonce

  const handleSuccess = async (event: Event): Promise<void> => {
    const storedHandlers = currentAppleHandlers
    const storedNonce = currentRawNonce
    currentRawNonce = null
    if (!storedHandlers) return

    const data = (event as CustomEvent).detail
    const idToken = data?.authorization?.id_token

    if (!idToken || !storedNonce) {
      storedHandlers.onCredentialError(new Error('No identity token received from Apple'))
      return
    }

    storedHandlers.onCredentialStart()

    try {
      const provider = new OAuthProvider('apple.com')
      const credential = provider.credential({ idToken, rawNonce: storedNonce })
      const userCredential = await signInWithCredential(auth, credential)

      const fallbackName = buildDisplayNameFromAppleUser(data?.user)
      try {
        await syncDisplayNameFromCredential(userCredential.user, fallbackName)
      } catch (syncError) {
        console.warn('Apple Sign-In display name sync failed:', syncError)
      }

      storedHandlers.onCredentialSuccess()
    } catch (error: unknown) {
      storedHandlers.onCredentialError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const handleFailure = (event: Event): void => {
    const storedHandlers = currentAppleHandlers
    if (!storedHandlers) return
    const detail = (event as CustomEvent).detail
    if (detail?.error === 'popup_closed_by_user') return
    storedHandlers.onCredentialError(new Error(detail?.error || 'Apple Sign-In failed'))
  }

  document.addEventListener('AppleIDSignInOnSuccess', handleSuccess)
  document.addEventListener('AppleIDSignInOnFailure', handleFailure)

  window.AppleID.auth.init({
    clientId,
    scope: 'name email',
    redirectURI,
    usePopup: true,
    nonce: hashedNonce,
  })

  return () => {
    document.removeEventListener('AppleIDSignInOnSuccess', handleSuccess)
    document.removeEventListener('AppleIDSignInOnFailure', handleFailure)
    currentAppleHandlers = null
    currentRawNonce = null
  }
}

export const signInWithApple = async (): Promise<AppleSignInResult> => {
  const clientId = process.env.EXPO_PUBLIC_APPLE_WEB_CLIENT_ID
  const redirectURI = process.env.EXPO_PUBLIC_APPLE_WEB_REDIRECT_URI
  if (!clientId || !redirectURI) {
    return {
      success: false,
      error: 'Apple Sign-In not configured (missing client id or redirect URI)',
    }
  }

  try {
    await loadAppleScript()
  } catch (error: any) {
    return { success: false, error: error.message || 'Apple Sign-In unavailable' }
  }

  if (!window.AppleID?.auth) {
    return { success: false, error: 'Apple Sign-In unavailable' }
  }

  let rawNonce: string
  let hashedNonce: string
  try {
    rawNonce = generateNonce()
    hashedNonce = await sha256(rawNonce)
  } catch (error: any) {
    console.error('Apple Sign-In nonce generation failed:', error)
    return {
      success: false,
      error: error?.message || 'Apple Sign-In unavailable',
    }
  }

  try {
    window.AppleID.auth.init({
      clientId,
      scope: 'name email',
      redirectURI,
      usePopup: true,
      nonce: hashedNonce,
    })

    const data = await window.AppleID.auth.signIn()
    const idToken = data?.authorization?.id_token
    if (!idToken) {
      return { success: false, error: 'No identity token received from Apple' }
    }

    const provider = new OAuthProvider('apple.com')
    const credential = provider.credential({ idToken, rawNonce })
    const userCredential = await signInWithCredential(auth, credential)

    const fallbackName = buildDisplayNameFromAppleUser(data?.user)
    try {
      await syncDisplayNameFromCredential(userCredential.user, fallbackName)
    } catch (syncError: any) {
      // Session is already established; a failed profile sync should not surface as sign-in failure.
      console.error('Apple Sign-In display name sync failed:', syncError)
    }

    return { success: true }
  } catch (error: any) {
    if (error?.error === 'popup_closed_by_user') {
      return { success: false, cancelled: true, error: 'Sign-in cancelled' }
    }
    console.error('Apple Sign-In failed:', error)
    return { success: false, error: error?.error || error?.message || 'Apple Sign-In failed' }
  }
}

// Apple has no SDK-level sign-out on web. Firebase signOut clears the session.
export const signOutFromApple = async (): Promise<void> => {
  // no-op
}

/** Resets script load cache and stored handlers between tests (Jest). */
export const resetAppleSignInWebForTests = (): void => {
  scriptPromise = null
  currentAppleHandlers = null
  currentRawNonce = null
}

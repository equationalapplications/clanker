// src/auth/appleSignin.web.ts
import { OAuthProvider, getAuth, signInWithCredential } from 'firebase/auth'
import { firebaseApp } from '~/config/firebaseConfig.web'
import { generateNonce, sha256 } from './nonce.web'
import { syncDisplayNameFromCredential } from './syncDisplayName'

declare global {
  interface Window {
    AppleID?: any
  }
}

export interface AppleSignInResult {
  success: boolean
  error?: string
}

const auth = getAuth(firebaseApp)
let scriptPromise: Promise<void> | null = null

const APPLE_JS_SRC =
  'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js'

const loadAppleScript = (): Promise<void> => {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    if (window.AppleID?.auth) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = APPLE_JS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Apple Sign In JS'))
    document.body.appendChild(script)
  })
  return scriptPromise
}

const buildDisplayNameFromAppleUser = (user: any): string | undefined => {
  const first = user?.name?.firstName?.trim?.() || ''
  const last = user?.name?.lastName?.trim?.() || ''
  const combined = `${first} ${last}`.trim()
  return combined || undefined
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
    await syncDisplayNameFromCredential(userCredential.user as any, fallbackName)

    return { success: true }
  } catch (error: any) {
    if (error?.error === 'popup_closed_by_user') {
      return { success: false, error: 'Sign-in cancelled' }
    }
    console.error('Apple Sign-In failed:', error)
    return { success: false, error: error?.error || error?.message || 'Apple Sign-In failed' }
  }
}

// Apple has no SDK-level sign-out on web. Firebase signOut clears the session.
export const signOutFromApple = async (): Promise<void> => {
  // no-op
}

// Redirect-result handler kept as a no-op so existing imports do not break during the
// transition. Safe to delete once Task 7 removes all callers.
export const handleAppleRedirectResult = async (): Promise<AppleSignInResult> => {
  return { success: true }
}

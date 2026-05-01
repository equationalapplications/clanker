// Firebase Web SDK - for web platform
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import {
  getAuth,
  onAuthStateChanged as onAuthStateChangedInternal,
  signOut as signOutInternal,
  type User,
  type Unsubscribe,
} from 'firebase/auth'
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions'
import { reportError } from '~/utilities/reportError'

declare global {
  // Firebase docs use the global FIREBASE_APPCHECK_DEBUG_TOKEN marker on web.
  interface Window {
    FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean
  }

  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined
}

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
}

const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(config)

const isAppCheckAlreadyInitializedError = (error: unknown) => {
  if (!error || typeof error !== 'object') {
    return false
  }

  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  return code.includes('already-initialized')
}

const isDevBuild =
  typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'

const enableLocalWebAppCheckDebugToken = () => {
  if (typeof window === 'undefined' || !isDevBuild) {
    return
  }

  const configuredDebugToken = process.env.EXPO_PUBLIC_WEB_APP_CHECK_DEBUG_TOKEN?.trim()
  if (!configuredDebugToken) {
    return
  }

  const tokenValue = configuredDebugToken.toLowerCase() === 'auto' ? true : configuredDebugToken

  // Firebase Web App Check reads this global before initializeAppCheck.
  globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = tokenValue
  window.FIREBASE_APPCHECK_DEBUG_TOKEN = tokenValue

  console.log('🧪 Firebase App Check web debug token enabled for development')
}

const appCheckReady: Promise<void> = (() => {
  if (typeof window === 'undefined') {
    return Promise.resolve()
  }

  enableLocalWebAppCheckDebugToken()

  const recaptchaSiteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY?.trim()
  if (!recaptchaSiteKey) {
    console.warn('⚠️ EXPO_PUBLIC_RECAPTCHA_SITE_KEY not set — Firebase App Check disabled')
    return Promise.resolve()
  }

  try {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
    console.log('✅ Firebase App Check activated successfully with Enterprise provider')
    return Promise.resolve()
  } catch (error) {
    if (isAppCheckAlreadyInitializedError(error)) {
      return Promise.resolve()
    }

    reportError(error, 'App Check initialization (web)')
    return Promise.reject(error)
  }
})()

const auth = getAuth(firebaseApp)

const getCurrentUser = () => auth.currentUser

const onAuthStateChanged = (callback: (user: User | null) => void): Unsubscribe =>
  onAuthStateChangedInternal(auth, callback)

const signOut = () => signOutInternal(auth)

const functionsInstance: Functions = getFunctions(firebaseApp, 'us-central1')

const exchangeToken = httpsCallable(functionsInstance, 'exchangeToken')

const generateReplyFn = httpsCallable(functionsInstance, 'generateReply')
const generateVoiceReplyFn = httpsCallable(functionsInstance, 'generateVoiceReply')

const generateImageFn = httpsCallable(functionsInstance, 'generateImage')

const summarizeTextFn = httpsCallable(functionsInstance, 'summarizeText')

const purchasePackageStripe = httpsCallable(functionsInstance, 'purchasePackageStripe')

const spendCreditsFn = httpsCallable(functionsInstance, 'spendCredits')

const adminListUsersFn = httpsCallable(functionsInstance, 'adminListUsers')
const adminSetUserCreditsFn = httpsCallable(functionsInstance, 'adminSetUserCredits')
const adminSetUserSubscriptionFn = httpsCallable(functionsInstance, 'adminSetUserSubscription')
const adminClearTermsAcceptanceFn = httpsCallable(functionsInstance, 'adminClearTermsAcceptance')
const adminResetUserStateFn = httpsCallable(functionsInstance, 'adminResetUserState')
const adminDeleteUserFn = httpsCallable(functionsInstance, 'adminDeleteUser')
const deleteMyAccountFn = httpsCallable(functionsInstance, 'deleteMyAccount')
const updateUserProfileFn = httpsCallable(functionsInstance, 'updateUserProfile')
const acceptTermsFn = httpsCallable(functionsInstance, 'acceptTerms')
const syncCharacterFn = httpsCallable(functionsInstance, 'syncCharacter')
const deleteCharacterFn = httpsCallable(functionsInstance, 'deleteCharacter')
const getUserCharactersFn = httpsCallable(functionsInstance, 'getUserCharacters')
const getPublicCharacterFn = httpsCallable(functionsInstance, 'getPublicCharacter')
const wikiLlmFn = httpsCallable(functionsInstance, 'wikiLlm')
const wikiSyncFn = httpsCallable(functionsInstance, 'wikiSync')

export type FirebaseUser = User
export { appCheckReady }

export {
  auth,
  firebaseApp,
  getCurrentUser,
  onAuthStateChanged,
  signOut,
  exchangeToken,
  generateReplyFn,
  generateVoiceReplyFn,
  generateImageFn,
  summarizeTextFn,
  purchasePackageStripe,
  spendCreditsFn,
  adminListUsersFn,
  adminSetUserCreditsFn,
  adminSetUserSubscriptionFn,
  adminClearTermsAcceptanceFn,
  adminResetUserStateFn,
  adminDeleteUserFn,
  deleteMyAccountFn,
  updateUserProfileFn,
  acceptTermsFn,
  syncCharacterFn,
  deleteCharacterFn,
  getUserCharactersFn,
  getPublicCharacterFn,
  wikiLlmFn,
  wikiSyncFn,
}

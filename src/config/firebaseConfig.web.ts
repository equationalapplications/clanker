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

const appCheckReady: Promise<void> = (() => {
  if (typeof window === 'undefined') {
    return Promise.resolve()
  }

  const recaptchaSiteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY
  if (!recaptchaSiteKey) {
    const error = new Error('EXPO_PUBLIC_RECAPTCHA_SITE_KEY not set; Firebase App Check is disabled')
    console.warn('⚠️ EXPO_PUBLIC_RECAPTCHA_SITE_KEY not set — Firebase App Check disabled')
    return Promise.reject(error)
  }

  try {
    initializeAppCheck(firebaseApp, {
      provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
    console.log('✅ Firebase App Check activated successfully with Enterprise provider')
    return Promise.resolve()
  } catch (error) {
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

const purchasePackageStripe = httpsCallable(functionsInstance, 'purchasePackageStripe')

const spendCreditsFn = httpsCallable(functionsInstance, 'spendCredits')

const adminListUsersFn = httpsCallable(functionsInstance, 'adminListUsers')
const adminSetUserCreditsFn = httpsCallable(functionsInstance, 'adminSetUserCredits')
const adminSetUserSubscriptionFn = httpsCallable(functionsInstance, 'adminSetUserSubscription')
const adminClearTermsAcceptanceFn = httpsCallable(functionsInstance, 'adminClearTermsAcceptance')
const adminResetUserStateFn = httpsCallable(functionsInstance, 'adminResetUserState')
const adminDeleteUserFn = httpsCallable(functionsInstance, 'adminDeleteUser')

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
  purchasePackageStripe,
  spendCreditsFn,
  adminListUsersFn,
  adminSetUserCreditsFn,
  adminSetUserSubscriptionFn,
  adminClearTermsAcceptanceFn,
  adminResetUserStateFn,
  adminDeleteUserFn,
}

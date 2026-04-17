// React Native Firebase – modular API (aligned with Firebase Web SDK)
import {
  FirebaseAuthTypes,
  getAuth,
  onAuthStateChanged as onAuthStateChangedMod,
  signOut as signOutMod,
} from '@react-native-firebase/auth'
import { getApp } from '@react-native-firebase/app'
import { getFunctions, httpsCallable } from '@react-native-firebase/functions'
import { initializeAppCheck } from '@react-native-firebase/app-check'
import { reportError } from '~/utilities/reportError'

const firebaseApp = getApp()

async function initAppCheck() {
  await initializeAppCheck(firebaseApp, {
    provider: {
      providerOptions: {
        android: {
          provider: __DEV__ ? 'debug' : 'playIntegrity',
          debugToken: process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN,
        },
        apple: {
          provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
          debugToken: process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN,
        },
      },
    },
    isTokenAutoRefreshEnabled: true,
  })
}

// Exported so callers (e.g. bootstrapSession) can await App Check readiness
// before invoking callable functions that enforce App Check.
export const appCheckReady = initAppCheck().catch((err: unknown) => {
  reportError(err, 'App Check initialization')
  throw err
})

const auth = getAuth(firebaseApp)

const getCurrentUser = () => auth.currentUser

const onAuthStateChanged = (callback: (user: FirebaseAuthTypes.User | null) => void) =>
  onAuthStateChangedMod(auth, callback)

const signOut = () => signOutMod(auth)

// Align Functions region with deployed backend (best practice per RNFirebase docs)
const functionsInstance = getFunctions(firebaseApp, 'us-central1')

const exchangeToken = httpsCallable(functionsInstance, 'exchangeToken')

const generateReplyFn = httpsCallable(functionsInstance, 'generateReply')

const generateImageFn = httpsCallable(functionsInstance, 'generateImage')

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

export type FirebaseUser = FirebaseAuthTypes.User

export {
  firebaseApp,
  auth,
  getCurrentUser,
  onAuthStateChanged,
  signOut,
  exchangeToken,
  generateReplyFn,
  generateImageFn,
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
}

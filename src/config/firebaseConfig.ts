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

// Mock user for local development sandbox
let mockUser: FirebaseAuthTypes.User | null = null

const getMockUser = (): FirebaseAuthTypes.User => ({
  uid: 'local_test_user_123',
  email: 'dev@localhost.com',
  getIdToken: async () => 'mock_token_123',
} as unknown as FirebaseAuthTypes.User)

const getCurrentUser = () => {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    return mockUser
  }
  return auth.currentUser
}

const onAuthStateChanged = (callback: (user: FirebaseAuthTypes.User | null) => void) => {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    mockUser = getMockUser()
    callback(mockUser)
    return () => {}
  }
  return onAuthStateChangedMod(auth, callback)
}

const signOut = () => {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    mockUser = null
    return Promise.resolve()
  }
  return signOutMod(auth)
}

// Align Functions region with deployed backend (best practice per RNFirebase docs)
const functionsInstance = getFunctions(firebaseApp, 'us-central1')

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
const generateEmbeddingFn = httpsCallable(functionsInstance, 'generateEmbedding')
const documentExtractFn = httpsCallable(functionsInstance, 'documentExtract')

export type FirebaseUser = FirebaseAuthTypes.User

export {
  firebaseApp,
  auth,
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
  documentExtractFn,
  deleteMyAccountFn,
  updateUserProfileFn,
  acceptTermsFn,
  syncCharacterFn,
  deleteCharacterFn,
  getUserCharactersFn,
  getPublicCharacterFn,
  wikiLlmFn,
  wikiSyncFn,
  generateEmbeddingFn,
}

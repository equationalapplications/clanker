// React Native Firebase - for iOS and Android platforms
import authModule, { FirebaseAuthTypes } from '@react-native-firebase/auth'
import { getApp } from '@react-native-firebase/app'
import { firebase as firebaseNamespace } from '@react-native-firebase/functions'
import appCheck from '@react-native-firebase/app-check'

const firebaseApp = getApp()

async function initAppCheck() {
    const provider = appCheck().newReactNativeFirebaseAppCheckProvider()
    await provider.configure({
        android: {
            provider: __DEV__ ? 'debug' : 'playIntegrity',
            debugToken: process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN,
        },
        apple: {
            provider: __DEV__ ? 'debug' : 'appAttestWithDeviceCheckFallback',
            debugToken: process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN,
        },
    })
    await appCheck().initializeAppCheck({ provider, isTokenAutoRefreshEnabled: true })
}

// Exported so callers (e.g. getSupabaseUserSession) can await App Check readiness
// before invoking callable functions that enforce App Check.
export const appCheckReady = initAppCheck().catch((err) => {
    console.error('❌ App Check initialization failed:', err)
})

const auth = authModule()

const getCurrentUser = () => auth.currentUser

const onAuthStateChanged = (callback: (user: FirebaseAuthTypes.User | null) => void) =>
    auth.onAuthStateChanged(callback)

const signOut = () => auth.signOut()

// Align Functions region with deployed backend (best practice per RNFirebase docs)
const functionsInstance = firebaseNamespace.app().functions('us-central1')

const exchangeToken = functionsInstance.httpsCallable('exchangeToken')

const generateReplyFn = functionsInstance.httpsCallable('generateReply')

const purchasePackageStripe = functionsInstance.httpsCallable('purchasePackageStripe')

const spendCreditsFn = functionsInstance.httpsCallable('spendCredits')

export type FirebaseUser = FirebaseAuthTypes.User

export {
    firebaseApp,
    auth,
    getCurrentUser,
    onAuthStateChanged,
    signOut,
    exchangeToken,
    generateReplyFn,
    purchasePackageStripe,
    spendCreditsFn,
}

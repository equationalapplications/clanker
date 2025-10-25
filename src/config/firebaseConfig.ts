// React Native Firebase - for iOS and Android platforms
import authModule, { FirebaseAuthTypes } from '@react-native-firebase/auth'
import { getApp } from '@react-native-firebase/app'
import { firebase as firebaseNamespace } from '@react-native-firebase/functions'

const firebaseApp = getApp()

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
}

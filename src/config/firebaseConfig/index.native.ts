// React Native Firebase - for iOS and Android platforms
// Using the modular API (v22+)
import authModule, { FirebaseAuthTypes } from '@react-native-firebase/auth'
import { getApp } from '@react-native-firebase/app'
import functionsModule from '@react-native-firebase/functions'

const firebaseApp = getApp()

const auth = authModule()

const getCurrentUser = () => auth.currentUser

const onAuthStateChanged = (callback: (user: FirebaseAuthTypes.User | null) => void) =>
    auth.onAuthStateChanged(callback)

const signOut = () => auth.signOut()

const functionsInstance = functionsModule()

const exchangeToken = functionsInstance.httpsCallable('exchangeToken')

const generateReplyFn = functionsInstance.httpsCallable('generateReply')

const purchasePackageStripe = functionsInstance.httpsCallable('purchasePackageStripe')

export type FirebaseUser = FirebaseAuthTypes.User

export {
    firebaseApp,
    getCurrentUser,
    onAuthStateChanged,
    signOut,
    exchangeToken,
    generateReplyFn,
    purchasePackageStripe,
}

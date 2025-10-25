// Firebase Web SDK - for web platform
import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import {
    getAuth,
    onAuthStateChanged as onAuthStateChangedInternal,
    signOut as signOutInternal,
    type User,
    type Unsubscribe,
} from 'firebase/auth'
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions'

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

const auth = getAuth(firebaseApp)

const getCurrentUser = () => auth.currentUser

const onAuthStateChanged = (callback: (user: User | null) => void): Unsubscribe =>
    onAuthStateChangedInternal(auth, callback)

const signOut = () => signOutInternal(auth)

const functionsInstance: Functions = getFunctions(firebaseApp, 'us-central1')

const exchangeToken = httpsCallable(functionsInstance, 'exchangeToken')

const generateReplyFn = httpsCallable(functionsInstance, 'generateReply')

const purchasePackageStripe = httpsCallable(functionsInstance, 'purchasePackageStripe')

export type FirebaseUser = User

export {
    auth,
    firebaseApp,
    getCurrentUser,
    onAuthStateChanged,
    signOut,
    exchangeToken,
    generateReplyFn,
    purchasePackageStripe,
}

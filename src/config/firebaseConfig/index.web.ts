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

import {
    firebaseApiKey,
    firebaseAuthDomain,
    firebaseProjectId,
    firebaseStorageBucket,
    firebaseMessagingSenderId,
    firebaseAppId,
} from '../constants'

const config = {
    apiKey: firebaseApiKey,
    authDomain: firebaseAuthDomain,
    projectId: firebaseProjectId,
    storageBucket: firebaseStorageBucket,
    messagingSenderId: firebaseMessagingSenderId,
    appId: firebaseAppId,
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
    firebaseApp,
    getCurrentUser,
    onAuthStateChanged,
    signOut,
    exchangeToken,
    generateReplyFn,
    purchasePackageStripe,
}

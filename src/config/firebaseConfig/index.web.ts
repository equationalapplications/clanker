// Firebase Web SDK - for web platform
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithCredential as firebaseSignInWithCredential } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'

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

// Initialize Firebase
const app = initializeApp(config)

// Initialize Auth (web uses different persistence by default)
const authInstance = getAuth(app)

// Initialize Functions with us-central1 region
const functionsInstance = getFunctions(app, 'us-central1')

// Normalized API that matches both web and native
export const auth = {
    get currentUser() {
        return authInstance.currentUser
    },
    onAuthStateChanged: authInstance.onAuthStateChanged.bind(authInstance),
    signOut: authInstance.signOut.bind(authInstance),
    signInWithCredential: (credential: any) => firebaseSignInWithCredential(authInstance, credential),
    // Expose the full instance for other methods
    _instance: authInstance,
}

export const functions = {
    httpsCallable: (name: string) => httpsCallable(functionsInstance, name),
    // Expose the full instance for other methods
    _instance: functionsInstance,
}

export { app }

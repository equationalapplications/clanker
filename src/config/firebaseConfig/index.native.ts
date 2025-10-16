// React Native Firebase - for iOS and Android platforms
// Using the new modular API (v22+)
import authModule from '@react-native-firebase/auth'
import { getApp } from '@react-native-firebase/app'
import functionsModule from '@react-native-firebase/functions'

// Get the default app instance using modular API
const app = getApp()

// Get the default instances using modular API
const authInstance = authModule()
const functionsInstance = functionsModule()

// Normalized API that matches both web and native
export const auth = {
    get currentUser() {
        return authInstance.currentUser
    },
    onAuthStateChanged: (callback: (user: any) => void) => authInstance.onAuthStateChanged(callback),
    signOut: () => authInstance.signOut(),
    signInWithCredential: (credential: any) => authInstance.signInWithCredential(credential),
    // Expose the full instance for other methods
    _instance: authInstance,
}

export const functions = {
    httpsCallable: (name: string) => functionsInstance.httpsCallable(name),
    // Expose the full instance for other methods
    _instance: functionsInstance,
}

export { app }

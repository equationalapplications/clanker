import Constants from "expo-constants"
import { initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"

// Initialize Firebase
const firebase = initializeApp({
  apiKey: Constants.expoConfig?.extra?.firebaseApiKey,
  authDomain: Constants.expoConfig?.extra?.firebaseAuthDomain,
  projectId: Constants.expoConfig?.extra?.firebaseProjectId,
  storageBucket: Constants.expoConfig?.extra?.firebaseStorageBucket,
  messagingSenderId: Constants.expoConfig?.extra?.firebaseMessagingSenderId,
  appId: Constants.expoConfig?.extra?.firebaseAppId,
})

export const auth = getAuth(firebase)

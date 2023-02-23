import Constants from "expo-constants"
import { initializeApp } from "firebase/app"
import { getAuth, connectAuthEmulator } from "firebase/auth"
import { initializeFirestore, connectFirestoreEmulator } from "firebase/firestore"
import { getFunctions, connectFunctionsEmulator } from "firebase/functions"

const config = {
  apiKey: Constants.expoConfig?.extra?.firebaseApiKey,
  authDomain: Constants.expoConfig?.extra?.firebaseAuthDomain,
  projectId: Constants.expoConfig?.extra?.firebaseProjectId,
  storageBucket: Constants.expoConfig?.extra?.firebaseStorageBucket,
  messagingSenderId: Constants.expoConfig?.extra?.firebaseMessagingSenderId,
  appId: Constants.expoConfig?.extra?.firebaseAppId,
}

// Initialize Firebase
const firebase = initializeApp(config)

const auth = getAuth(firebase)

const firestore = initializeFirestore(firebase, {
  experimentalForceLongPolling: true,
})

const functions = getFunctions(firebase)

if (__DEV__) {
  console.log("dev")
 // rconnectAuthEmulator(auth, "http://localhost:9099")
 // connectFirestoreEmulator(firestore, "localhost", 8080)
 // rconnectFunctionsEmulator(functions, "localhost", 5001)
}

export { auth, firestore, functions }
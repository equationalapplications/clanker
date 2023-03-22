import { initializeApp } from "firebase/app"
import { getAuth, connectAuthEmulator } from "firebase/auth"
import { initializeFirestore, connectFirestoreEmulator } from "firebase/firestore"
import { getFunctions, connectFunctionsEmulator } from "firebase/functions"

import {
  firebaseApiKey,
  firebaseAuthDomain,
  firebaseProjectId,
  firebaseStorageBucket,
  firebaseMessagingSenderId,
  firebaseAppId,
} from "./constants"

const config = {
  apiKey: firebaseApiKey,
  authDomain: firebaseAuthDomain,
  projectId: firebaseProjectId,
  storageBucket: firebaseStorageBucket,
  messagingSenderId: firebaseMessagingSenderId,
  appId: firebaseAppId,
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

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
const app = initializeApp(config)

const auth = getAuth(app)

const firestore = initializeFirestore(app, {
  experimentalForceLongPolling: true,
})

const functions = getFunctions(app, "us-central1")

if (__DEV__) {
  console.log("dev")
  // connectAuthEmulator(auth, "http://localhost:9099")
  // connectFirestoreEmulator(firestore, "localhost", 8080)
  // connectFunctionsEmulator(functions, "localhost", 5001)
}

export { app, auth, firestore, functions }

import { initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"
import { getFunctions } from "firebase/functions"

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
const functions = getFunctions(app, "us-central1")

export { app, auth, functions }

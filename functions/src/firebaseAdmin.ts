// Centralizes the firebase-admin v14 modularization in one place.
//
// v14 removed the `admin.auth()`, `admin.firestore()`, `admin.messaging()`
// helpers from the top-level default export. The replacement subpath exports
// (`firebase-admin/auth`, etc.) return the same Auth/Firestore/Messaging
// instances but require an `App` to bind to. This module initializes the
// default app lazily and re-exports the services via `services.*` getters
// so call sites stay one expression (`services.auth.getUser(uid)`).
//
// The internal state is mutable so tests can swap in fakes — see
// `__setAuthForTest` etc. and the `withAdminAuthStub` helper in testHelpers.ts.
import { getApps, getApp, initializeApp, type App } from 'firebase-admin/app'
import { getAuth as getAuthFromAdmin, type Auth } from 'firebase-admin/auth'
import {
  getFirestore as getFirestoreFromAdmin,
  Timestamp,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore'
import { getMessaging as getMessagingFromAdmin, type Messaging } from 'firebase-admin/messaging'

let appInstance: App | null = null
let authInstance: Auth | null = null
let firestoreInstance: Firestore | null = null
let messagingInstance: Messaging | null = null

function ensureApp(): App {
  if (!appInstance) {
    appInstance = getApps().length > 0 ? getApp() : initializeApp()
  }
  return appInstance
}

export const services = {
  get auth(): Auth {
    return (authInstance ??= getAuthFromAdmin(ensureApp()))
  },
  get firestore(): Firestore {
    return (firestoreInstance ??= getFirestoreFromAdmin(ensureApp()))
  },
  get messaging(): Messaging {
    return (messagingInstance ??= getMessagingFromAdmin(ensureApp()))
  },
}

export { Timestamp, FieldValue }

// Test hooks. Production code MUST NOT call these — they exist so tests can
// substitute fakes for the cached services. The getters above short-circuit
// to whatever was set most recently, so a `__setAuthForTest(stub)` followed
// by `services.auth` returns the stub until the next `__setAuthForTest(null)`.
export function __setAuthForTest(auth: Auth | null): void {
  authInstance = auth
}
export function __getAuthRawForTest(): Auth | null {
  return authInstance
}
export function __setFirestoreForTest(firestore: Firestore | null): void {
  firestoreInstance = firestore
}
export function __setMessagingForTest(messaging: Messaging | null): void {
  messagingInstance = messaging
}

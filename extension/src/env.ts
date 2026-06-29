// FIREBASE_API_KEY is a public identifier, safe to embed.
// Values are injected at build time by esbuild.mjs from repo-root .env (EXPO_PUBLIC_*).
// Falls back to REPLACE_* placeholders when env vars are unset.

interface ExtensionEnv {
  FIREBASE_API_KEY: string
  FIREBASE_AUTH_DOMAIN: string
  FIREBASE_PROJECT_ID: string
  FIREBASE_APP_ID: string
  FIREBASE_SENDER_ID: string
  CLOUD_BASE_URL: string
  CLOUD_WS_URL: string
}

declare const __EXTENSION_ENV__: ExtensionEnv | undefined

if (!__EXTENSION_ENV__) {
  throw new Error('Extension must be built before loading: run `npm run build` in extension/')
}

const ENV: ExtensionEnv = __EXTENSION_ENV__

export const FIREBASE_CONFIG = {
  apiKey: ENV.FIREBASE_API_KEY,
  authDomain: ENV.FIREBASE_AUTH_DOMAIN,
  projectId: ENV.FIREBASE_PROJECT_ID,
  appId: ENV.FIREBASE_APP_ID,
}
export const FIREBASE_SENDER_ID = ENV.FIREBASE_SENDER_ID
export const CLOUD_BASE_URL = ENV.CLOUD_BASE_URL
export const CLOUD_WS_URL = ENV.CLOUD_WS_URL

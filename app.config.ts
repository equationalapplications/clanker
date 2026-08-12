import dotenv from 'dotenv'
import { ExpoConfig, ConfigContext } from 'expo/config'
import fs from 'fs'
import path from 'path'

import * as pkg from './package.json'
import { CHARACTER_SHARE_PATH_PREFIX, SITE_HOST } from './src/config/siteConfig'

dotenv.config({ quiet: true })
// .env.development.local (gitignored, dev-only) carries dev-sandbox flags like
// EXPO_PUBLIC_USE_MOCK_AUTH. Expo's own env loader applies it for dev builds only,
// so it never overrides production values during `expo export`/EAS production builds.

/**
 * Native app-link host. Mirrors the share-origin override in
 * src/utilities/characterShare.ts so generated share links and the iOS/Android
 * app-link manifests always agree. A custom origin still needs its own
 * .well-known/assetlinks.json and apple-app-site-association served on that
 * host for links to open the app. Defaults to SITE_HOST when unset.
 */
const getCharacterShareHost = () => {
  const configured = process.env.EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL?.trim()
  if (!configured) {
    return SITE_HOST
  }
  try {
    return new URL(configured).host
  } catch {
    throw new Error(
      `Invalid EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL (must be a full URL): ${configured}`,
    )
  }
}

const characterShareHost = getCharacterShareHost()

const breakingChangeVersion = pkg.version.split('.')[0]

const runtimeVer = breakingChangeVersion + '.0.0'

const formatError = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** EAS local/cloud builds set EAS_BUILD_PROFILE; dev client runs omit it. */
const isProductionPushBuild =
  process.env.EAS_BUILD_PROFILE === 'production' ||
  process.env.EAS_BUILD_PROFILE === 'staging' ||
  process.env.EAS_BUILD_PROFILE === 'preview'

const getGoogleServicesJson = () => {
  // Extract from base64 if provided via environment variable (local builds)
  if (process.env.GOOGLE_SERVICES_JSON_BASE64) {
    const tmpPath = path.join('./temp', 'google-services.json')
    try {
      fs.mkdirSync('./temp', { recursive: true })
      fs.writeFileSync(tmpPath, Buffer.from(process.env.GOOGLE_SERVICES_JSON_BASE64, 'base64'), {
        mode: 0o600,
      })
      return tmpPath
    } catch (err) {
      throw new Error(
        `Failed to write GOOGLE_SERVICES_JSON_BASE64 to ${tmpPath}: ${formatError(err)}`,
      )
    }
  }
  // EAS cloud builds: GOOGLE_SERVICES_JSON is a file env var resolved to a path
  if (process.env.GOOGLE_SERVICES_JSON) {
    return process.env.GOOGLE_SERVICES_JSON
  }
  // for local development from root
  if (fs.existsSync('./google-services.json')) {
    return './google-services.json'
  }
  return undefined
}

const getGoogleServiceInfoPlist = () => {
  // Extract from base64 if provided via environment variable (local builds)
  if (process.env.GOOGLE_SERVICE_INFO_PLIST_BASE64) {
    const tmpPath = path.join('./temp', 'GoogleService-Info.plist')
    try {
      fs.mkdirSync('./temp', { recursive: true })
      fs.writeFileSync(
        tmpPath,
        Buffer.from(process.env.GOOGLE_SERVICE_INFO_PLIST_BASE64, 'base64'),
        { mode: 0o600 },
      )
      return tmpPath
    } catch (err) {
      throw new Error(
        `Failed to write GOOGLE_SERVICE_INFO_PLIST_BASE64 to ${tmpPath}: ${formatError(err)}`,
      )
    }
  }
  // EAS cloud builds: GOOGLE_SERVICE_INFO_PLIST is a file env var resolved to a path
  if (process.env.GOOGLE_SERVICE_INFO_PLIST) {
    return process.env.GOOGLE_SERVICE_INFO_PLIST
  }
  // for local development from root
  if (fs.existsSync('./GoogleService-Info.plist')) {
    return './GoogleService-Info.plist'
  }
  return undefined
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  scheme: 'com.equationalapplications.clanker',
  name: 'Clanker',
  slug: 'yours-brightly-ai',
  version: pkg.version,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  // @ts-expect-error: splash is valid for expo-splash-screen plugin config
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
    dark: {
      image: './assets/splash.png',
      backgroundColor: '#000000',
    },
  },
  updates: {
    url: 'https://u.expo.dev/2333eead-a87c-4a6f-adea-b1b433f4740e',
    fallbackToCacheTimeout: 5000,
  },
  runtimeVersion: runtimeVer,
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'com.equationalapplications.clanker',
    deploymentTarget: '16.4',
    googleServicesFile: getGoogleServiceInfoPlist(),
    supportsTablet: true,
    usesAppleSignIn: true,
    infoPlist: {
      NSPhotoLibraryUsageDescription:
        'Allow Clanker to access your photo library to set a character avatar.',
      // Microphone permission was previously supplied by the expo-speech-recognition
      // config plugin (deleted in c695ab0e). @speechmatics/expo-two-way-audio, the
      // current Talk-tab voice stack, ships no config plugin and hard-fatalErrors
      // on iOS when NSMicrophoneUsageDescription is absent — see memory notes.
      NSMicrophoneUsageDescription:
        'Allow Clanker to access your microphone for voice conversations.',
    },
    associatedDomains: [`applinks:${characterShareHost}`],
    config: {
      usesNonExemptEncryption: false,
    },
    entitlements: {
      'com.apple.developer.declared-age-range': true,
    },
  },
  android: {
    package: 'com.equationalapplications.clanker',
    googleServicesFile: getGoogleServicesJson(),
    // RECORD_AUDIO was previously supplied by the expo-speech-recognition
    // config plugin (deleted in c695ab0e). @speechmatics/expo-two-way-audio,
    // the current Talk-tab voice stack, requires this permission.
    permissions: ['android.permission.RECORD_AUDIO'],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundImage: './assets/adaptive-icon-background.png',
    },
    intentFilters: [
      {
        action: 'VIEW',
        data: [
          {
            scheme: 'fb1503390336819593',
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
      {
        action: 'VIEW',
        autoVerify: true,
        data: [
          {
            scheme: 'https',
            host: characterShareHost,
            pathPrefix: CHARACTER_SHARE_PATH_PREFIX,
          },
        ],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
    buildScript: {
      baseUrl: '/',
    },
  },
  notification: {
    vapidPublicKey: process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY,
    serviceWorkerPath: '/expo-service-worker.js',
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  plugins: [
    [
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
          forceStaticLinking: [
            'RNFBApp',
            'RNFBAuth',
            'RNFBCrashlytics',
            'RNFBFunctions',
            'RNFBAppCheck',
            'RNFBAnalytics',
          ],
        },
      },
    ],
    'expo-secure-store',
    'expo-sharing',
    'expo-router',
    'expo-sqlite',
    'expo-asset',
    'expo-apple-authentication',
    // RNFB v26 resolves firebase-ios-sdk via SPM by default, which requires dynamic
    // framework linkage; this project pins static linkage (expo-build-properties
    // above), so keep Firebase on CocoaPods to avoid duplicate-symbol link errors.
    ['@react-native-firebase/app', { ios: { disableSPM: true } }],
    '@react-native-firebase/auth',
    '@react-native-firebase/crashlytics',
    '@react-native-firebase/app-check',
    // Analytics autolinks via RNFBAnalytics (forceStaticLinking); no separate Expo plugin.
    'expo-font',
    'expo-image',
    'expo-splash-screen',
    'expo-status-bar',
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow Clanker to access your photo library to set a character avatar.',
        cameraPermission: 'Allow Clanker to access your camera to take a photo to send in chat.',
      },
    ],
    [
      '@react-native-google-signin/google-signin',
      {
        iosUrlScheme: process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME,
      },
    ],
    [
      'expo-notifications',
      {
        mode: isProductionPushBuild ? 'production' : 'development',
        enableBackgroundRemoteNotifications: true,
        color: '#1f9d55',
      },
    ],
  ],
  extra: {
    eas: {
      projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
    },
  },
})

import 'dotenv/config'
import { ExpoConfig, ConfigContext } from 'expo/config'

import * as pkg from './package.json'

const breakingChangeVersion = pkg.version.split('.')[0]

const runtimeVer = breakingChangeVersion + '.0.0'

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  scheme: 'com.equationalapplications.yoursbrightlyai',
  name: 'Yours Brightly AI',
  slug: 'yours-brightly-ai',
  version: pkg.version,
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  updates: {
    url: 'https://u.expo.dev/2333eead-a87c-4a6f-adea-b1b433f4740e',
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: runtimeVer,
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'com.equationalapplications.yoursbrightlyai',
    googleServicesFile: './GoogleService-Info.plist',
    supportsTablet: true,
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.equationalapplications.yoursbrightlyai',
    googleServicesFile: './google-services.json',
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
    ],
  },
  web: {
    favicon: './assets/favicon.png',
    bundler: 'metro',
    buildScript: {
      baseUrl: '/',
    },
  },
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    "@react-native-firebase/app",
    "@react-native-firebase/auth",
    "@react-native-firebase/crashlytics",
    [
      '@react-native-google-signin/google-signin',
      {
        webClientId: process.env.GOOGLE_WEB_CLIENT_ID,
        iosUrlScheme: 'com.googleusercontent.apps.790870307455-5bsmcehb8mqdsl6vb3mal1nnq2jkk730',
      },
    ],
    [
      "expo-build-properties",
      {
        "ios": {
          "useFrameworks": "static"
        }
      }
    ]
  ],
  extra: {
    eas: {
      projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
    },
    firebaseApiKey: process.env.FIREBASE_API_KEY,
    firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
    firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    firebaseAppId: process.env.FIREBASE_APP_ID,
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
    googleAndroidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID,
    googleIosClientId: process.env.GOOGLE_IOS_CLIENT_ID,
    facebookAuthAppId: process.env.FACEBOOK_AUTH_APP_ID,
    revenueCatPurchasesAndroidApiKey: process.env.REVENUECAT_PURCHASES_ANDROID_API_KEY,
    revenueCatPurchasesIosApiKey: process.env.REVENUECAT_PURCHASES_IOS_API_KEY,
    revenueCatPurchasesStripeApiKey: process.env.REVENUECAT_PURCHASES_STRIPE_API_KEY,
  },
})

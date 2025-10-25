import 'dotenv/config'
import { ExpoConfig, ConfigContext } from 'expo/config'

import * as pkg from './package.json'

const breakingChangeVersion = pkg.version.split('.')[0]

const runtimeVer = breakingChangeVersion + '.0.0'

const fs = require('fs')

const getGoogleServicesJson = () => {
  // for EAS build from environment variable
  if (process.env.GOOGLE_SERVICES_JSON) {
    return process.env.GOOGLE_SERVICES_JSON
  }
  // for local build from temp file
  if (fs.existsSync('./temp/google-services.json')) {
    return './temp/google-services.json'
  }
  // for local development from root
  if (fs.existsSync('./google-services.json')) {
    return './google-services.json'
  }
  // for local build when no file is present
  return undefined
}

const getGoogleServiceInfoPlist = () => {
  // for EAS build from environment variable
  if (process.env.GOOGLE_SERVICE_INFO_PLIST) {
    return process.env.GOOGLE_SERVICE_INFO_PLIST
  }
  // for local build from temp file
  if (fs.existsSync('./temp/GoogleService-Info.plist')) {
    return './temp/GoogleService-Info.plist'
  }
  // for local development from root
  if (fs.existsSync('./GoogleService-Info.plist')) {
    return './GoogleService-Info.plist'
  }
  // for local build when no file is present
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
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  updates: {
    url: 'https://u.expo.dev/2333eead-a87c-4a6f-adea-b1b433f4740e',
    fallbackToCacheTimeout: 5000,
  },
  runtimeVersion: runtimeVer,
  assetBundlePatterns: ['**/*'],
  ios: {
    bundleIdentifier: 'com.equationalapplications.clanker',
    googleServicesFile: getGoogleServiceInfoPlist(),
    supportsTablet: true,
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.equationalapplications.clanker',
    googleServicesFile: getGoogleServicesJson(),
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
    'expo-secure-store',
    'expo-router',
    'expo-sqlite',
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    '@react-native-firebase/crashlytics',
    '@react-native-google-signin/google-signin',
    [
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
          forceStaticLinking: ['RNFBApp', 'RNFBAuth', 'RNFBCrashlytics', 'RNFBFunctions'],
        },
      },
    ],
  ],
  extra: {
    eas: {
      projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
    },
  },
})

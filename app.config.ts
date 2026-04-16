import 'dotenv/config'
import { ExpoConfig, ConfigContext } from 'expo/config'
import fs from 'fs'
import path from 'path'

import * as pkg from './package.json'

const breakingChangeVersion = pkg.version.split('.')[0]

const runtimeVer = breakingChangeVersion + '.0.0'

const formatError = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

const getGoogleServicesJson = () => {
  // Extract from base64 if provided by EAS (e.g. during CLI config introspection in GitHub Actions)
  if (process.env.GOOGLE_SERVICES_JSON_BASE64) {
    const tmpPath = path.join('./temp', `google-services.${process.pid}.json`)
    try {
      fs.mkdirSync('./temp', { recursive: true })
      fs.writeFileSync(
        tmpPath,
        Buffer.from(process.env.GOOGLE_SERVICES_JSON_BASE64, 'base64'),
        { mode: 0o600 }
      )
      return tmpPath
    } catch (err) {
      throw new Error(
        `Failed to write GOOGLE_SERVICES_JSON_BASE64 to ${tmpPath}: ${formatError(err)}`
      )
    }
  }
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
  // Extract from base64 if provided by EAS (e.g. during CLI config introspection in GitHub Actions)
  if (process.env.GOOGLE_SERVICE_INFO_PLIST_BASE64) {
    const tmpPath = path.join('./temp', `GoogleService-Info.${process.pid}.plist`)
    try {
      fs.mkdirSync('./temp', { recursive: true })
      fs.writeFileSync(
        tmpPath,
        Buffer.from(process.env.GOOGLE_SERVICE_INFO_PLIST_BASE64, 'base64'),
        { mode: 0o600 }
      )
      return tmpPath
    } catch (err) {
      throw new Error(
        `Failed to write GOOGLE_SERVICE_INFO_PLIST_BASE64 to ${tmpPath}: ${formatError(err)}`
      )
    }
  }
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
    googleServicesFile: getGoogleServiceInfoPlist(),
    supportsTablet: true,
    usesAppleSignIn: true,
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
    [
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
          forceStaticLinking: ['RNFBApp', 'RNFBAuth', 'RNFBCrashlytics', 'RNFBFunctions', 'RNFBAppCheck'],
        },
      },
    ],
    'expo-secure-store',
    'expo-router',
    'expo-sqlite',
    'expo-apple-authentication',
    '@react-native-firebase/app',
    '@react-native-firebase/auth',
    '@react-native-firebase/crashlytics',
    '@react-native-firebase/app-check',
    'expo-font',
    'expo-image',
    [
      "@react-native-google-signin/google-signin",
      {
        "iosUrlScheme": "com.googleusercontent.apps.790870307455-eec2ci25b9amdrm52d7067jkmocovdbd"
      }
    ],
  ],
  extra: {
    eas: {
      projectId: '2333eead-a87c-4a6f-adea-b1b433f4740e',
    },
  },
})

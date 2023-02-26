import "dotenv/config"
import * as pkg from "./package.json"

const breakingChangeVersion = pkg.version.split(".")[0]

const runtimeVer = breakingChangeVersion + ".0.0"

export default {
  expo: {
    scheme: "com.equationalapplications.yoursbrightlyai",
    name: "Yours Brightly AI",
    slug: "yours-brightly-ai",
    version: pkg.version,
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    updates: {
      url: "https://u.expo.dev/2333eead-a87c-4a6f-adea-b1b433f4740e",
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: runtimeVer,
    assetBundlePatterns: ["**/*"],
    ios: {
      bundleIdentifier: "com.equationalapplications.yoursbrightlyai",
      supportsTablet: true,
    },
    android: {
      package: "com.equationalapplications.yoursbrightlyai",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundImage: "./assets/adaptive-icon-background.png",
      },
    },
    web: {
      favicon: "./assets/favicon.png",
    },
    extra: {
      eas: {
        projectId: "2333eead-a87c-4a6f-adea-b1b433f4740e",
      },
      firebaseApiKey: process.env.FIREBASE_API_KEY,
      firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN,
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
      firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      firebaseAppId: process.env.FIREBASE_APP_ID,
      googleWebClientId: process.env.GOOGLE_WEB_CLIENT_ID,
      googleAndroidClientId: process.env.GOOGLE_ANDROID_CLIENT_ID,
      facebookAuthAppId: process.env.FACEBOOK_AUTH_APP_ID,
      revenueCatPurchasesApiKey: process.env.REVENUECAT_PURCHASES_API_KEY,
      revenueCatPurchasesEntitlementId: "premium",
    },
  },
}

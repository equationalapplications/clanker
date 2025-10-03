import Constants from "expo-constants"
import { Platform, Dimensions } from "react-native"
import { PurchasesPackage } from "react-native-purchases"

export const scheme = "com.equationalapplications.yoursbrightlyai"
export const appBaseUrl = "https://yours-brightly-ai.equationalapplications.com"
export const appChatUrl = appBaseUrl + "/chat"

export const defaultAvatarUrl = "https://www.gravatar.com/avatar?d=mp"

export const { width, height } = Dimensions.get("window")
export const largeScreenWidth = 600
export const isLargeScreen = width >= largeScreenWidth

export const platform =
  Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web"

export const googleWebClientId = Constants.expoConfig?.extra?.googleWebClientId
export const googleAndroidClientId = Constants.expoConfig?.extra?.googleAndroidClientId
export const googleIosClientId = Constants.expoConfig?.extra?.googleIosClientId
export const facebookAuthAppId = Constants.expoConfig?.extra?.facebookAuthAppId

export const firebaseApiKey = Constants.expoConfig?.extra?.firebaseApiKey
export const firebaseAuthDomain = Constants.expoConfig?.extra?.firebaseAuthDomain
export const firebaseProjectId = Constants.expoConfig?.extra?.firebaseProjectId
export const firebaseStorageBucket = Constants.expoConfig?.extra?.firebaseStorageBucket
export const firebaseMessagingSenderId = Constants.expoConfig?.extra?.firebaseMessagingSenderId
export const firebaseAppId = Constants.expoConfig?.extra?.firebaseAppId

export const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || 'https://eksnwbwpmsjbuouftqur.supabase.co'
export const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrc253YndwbXNqYnVvdWZ0cXVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY2ODI3NjksImV4cCI6MjA3MjI1ODc2OX0.tomQiadGBwWQBTwT5kkK8_jSXDWAMhnOXRabycMzntY'

// Revenue Cat & Purchases configuration

export const publicChatRoomsCollection = "public_chat_rooms"
export const charactersCollection = "characters"
export const userCharactersCollection = "user_characters"
export const userChatsCollection = "user_chats"
export const messagesCollection = "messages"
export const usersPublicCollection = "users_public"
export const usersPrivateCollection = "users_private"

export const revenueCatPurchasesIosApiKey =
  Constants.expoConfig?.extra?.revenueCatPurchasesIosApiKey
export const revenueCatPurchasesAndroidApiKey =
  Constants.expoConfig?.extra?.revenueCatPurchasesAndroidApiKey
export const revenueCatPurchasesStripeApiKey =
  Constants.expoConfig?.extra?.revenueCatPurchasesStripeApiKey
export const revenueCatPurchasesEntitlementId = "premium"
export const purchasesRevenueCatStripeUrl =
  "https://us-central1-your-brightly-ai.cloudfunctions.net/getCustomerInfoRevenueCatStripe"

export const revenueCatBaseApi = "https://api.revenuecat.com/v1"
export const revenueCatReceiptsApi = revenueCatBaseApi + "/receipts"
export const revenueCatSubscribersApi = revenueCatBaseApi + "/subscribers"

export const stripeCustomerPortal = "https://billing.stripe.com/p/login/28obLIehA711btKcMM"
export const stripeMontlySubscriptionPriceId = "price_1MVejqDTb0norRA06zwoexic"
export const AndroidIosMonthlySubscriptionPurchasePackage: PurchasesPackage = ({
  identifier: "$rc_monthly",
  offeringIdentifier: "premium",
  packageType: "MONTHLY",
  product: {
    currencyCode: "USD",
    description: "",
    discounts: null,
    identifier: "premium",
    introPrice: null,
    price: 4.99,
    priceString: "$4.99",
    productCategory: "SUBSCRIPTION",
    productType: "AUTO_RENEWABLE_SUBSCRIPTION",
    subscriptionPeriod: "P1M",
    title: "Yours Brightly AI Subscription (Yours Brightly AI)",
  },
} as unknown) as PurchasesPackage

export const colorsLight = {
  primary: "rgb(131, 84, 0)",
  onPrimary: "rgb(255, 255, 255)",
  primaryContainer: "rgb(255, 221, 181)",
  onPrimaryContainer: "rgb(42, 24, 0)",
  secondary: "rgb(112, 91, 64)",
  onSecondary: "rgb(255, 255, 255)",
  secondaryContainer: "rgb(251, 222, 188)",
  onSecondaryContainer: "rgb(39, 25, 5)",
  tertiary: "rgb(82, 100, 63)",
  onTertiary: "rgb(255, 255, 255)",
  tertiaryContainer: "rgb(213, 234, 186)",
  onTertiaryContainer: "rgb(17, 31, 3)",
  error: "rgb(186, 26, 26)",
  onError: "rgb(255, 255, 255)",
  errorContainer: "rgb(255, 218, 214)",
  onErrorContainer: "rgb(65, 0, 2)",
  background: "rgb(255, 251, 255)",
  onBackground: "rgb(31, 27, 22)",
  surface: "rgb(255, 251, 255)",
  onSurface: "rgb(31, 27, 22)",
  surfaceVariant: "rgb(240, 224, 208)",
  onSurfaceVariant: "rgb(79, 69, 57)",
  outline: "rgb(129, 117, 104)",
  outlineVariant: "rgb(211, 196, 180)",
  shadow: "rgb(0, 0, 0)",
  scrim: "rgb(0, 0, 0)",
  inverseSurface: "rgb(53, 48, 42)",
  inverseOnSurface: "rgb(249, 239, 231)",
  inversePrimary: "rgb(255, 185, 87)",
  elevation: {
    level0: "transparent",
    level1: "rgb(249, 243, 242)",
    level2: "rgb(245, 238, 235)",
    level3: "rgb(241, 233, 227)",
    level4: "rgb(240, 231, 224)",
    level5: "rgb(238, 228, 219)",
  },
  surfaceDisabled: "rgba(31, 27, 22, 0.12)",
  onSurfaceDisabled: "rgba(31, 27, 22, 0.38)",
  backdrop: "rgba(56, 47, 36, 0.4)",
}

export const colorsDark = {
  primary: "rgb(255, 185, 87)",
  onPrimary: "rgb(70, 43, 0)",
  primaryContainer: "rgb(100, 63, 0)",
  onPrimaryContainer: "rgb(255, 221, 181)",
  secondary: "rgb(222, 194, 162)",
  onSecondary: "rgb(62, 45, 22)",
  secondaryContainer: "rgb(87, 67, 43)",
  onSecondaryContainer: "rgb(251, 222, 188)",
  tertiary: "rgb(185, 205, 160)",
  onTertiary: "rgb(37, 53, 20)",
  tertiaryContainer: "rgb(59, 76, 41)",
  onTertiaryContainer: "rgb(213, 234, 186)",
  error: "rgb(255, 180, 171)",
  onError: "rgb(105, 0, 5)",
  errorContainer: "rgb(147, 0, 10)",
  onErrorContainer: "rgb(255, 180, 171)",
  background: "rgb(31, 27, 22)",
  onBackground: "rgb(235, 225, 217)",
  surface: "rgb(31, 27, 22)",
  onSurface: "rgb(235, 225, 217)",
  surfaceVariant: "rgb(79, 69, 57)",
  onSurfaceVariant: "rgb(211, 196, 180)",
  outline: "rgb(156, 142, 128)",
  outlineVariant: "rgb(79, 69, 57)",
  shadow: "rgb(0, 0, 0)",
  scrim: "rgb(0, 0, 0)",
  inverseSurface: "rgb(235, 225, 217)",
  inverseOnSurface: "rgb(53, 48, 42)",
  inversePrimary: "rgb(131, 84, 0)",
  elevation: {
    level0: "transparent",
    level1: "rgb(42, 35, 25)",
    level2: "rgb(49, 40, 27)",
    level3: "rgb(56, 44, 29)",
    level4: "rgb(58, 46, 30)",
    level5: "rgb(62, 49, 31)",
  },
  surfaceDisabled: "rgba(235, 225, 217, 0.12)",
  onSurfaceDisabled: "rgba(235, 225, 217, 0.38)",
  backdrop: "rgba(56, 47, 36, 0.4)",
}

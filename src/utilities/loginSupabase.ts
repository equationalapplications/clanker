import { getFunctions, httpsCallable } from "firebase/functions"
import { supabaseClient } from "../config/supabaseClient"
import { app, auth } from "../config/firebaseConfig"
import type { AuthResponse } from "@supabase/supabase-js"
import { YOURS_BRIGHTLY_TERMS } from "../config/termsConfig"
import { router } from "expo-router"

// Type for the response from the Firebase function
interface ExchangeTokenResponse {
  supabaseAccessToken: string
  supabaseRefreshToken: string
  expiresIn: number
  refreshExpiresIn: number
}

// Create functions instance and connect to emulator at module level
const functions = getFunctions(app, "us-central1")

/**
 * Check if user has accepted current terms version for the app
 */
function checkTermsVersion(plans: any[]): {
  hasAccess: boolean
  hasAcceptedTerms: boolean
  needsTermsUpdate: boolean
  currentVersion?: string
} {
  const appPlan = plans.find((plan: any) => plan.app === 'yours-brightly')

  if (!appPlan) {
    return {
      hasAccess: false,
      hasAcceptedTerms: false,
      needsTermsUpdate: false
    }
  }

  const hasAcceptedTerms = !!appPlan.terms_accepted
  const needsTermsUpdate = hasAcceptedTerms && appPlan.terms_version !== YOURS_BRIGHTLY_TERMS.version

  return {
    hasAccess: true,
    hasAcceptedTerms,
    needsTermsUpdate,
    currentVersion: appPlan.terms_version
  }
}

/**
 * Handle terms acceptance by showing the modal
 * Returns a promise that resolves when the user accepts/declines
 */
async function handleTermsAcceptance(isUpdate: boolean = false): Promise<void> {
  console.log(`📄 Navigating to terms acceptance (isUpdate: ${isUpdate})`);

  // Navigate to the terms modal
  router.push({
    pathname: '/accept-terms',
    params: { isUpdate: isUpdate.toString() }
  });

  // Don't throw - let the modal handle acceptance/decline
  // The app will stay on the terms page until user accepts
}

export async function loginToSupabaseAfterFirebase(): Promise<AuthResponse["data"]> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("No Firebase user is currently signed in");
  }

  console.log('🔐 Starting Supabase authentication for Firebase user:', currentUser.email);

  const exchangeToken = httpsCallable(functions, "exchangeToken") as unknown as () => Promise<{ data: ExchangeTokenResponse }>;
  console.log("Callable function reference created");

  try {
    console.log("Calling Firebase function with region us-central1");

    // Get the token response from Firebase function
    const { data: tokenResponse } = await exchangeToken();
    console.log("Firebase function response:", tokenResponse);

    // Set the session using both access and refresh tokens
    const authResponse = await supabaseClient.auth.setSession({
      access_token: tokenResponse.supabaseAccessToken,
      refresh_token: tokenResponse.supabaseRefreshToken,
    });

    if (authResponse.error) {
      throw new Error("Failed to set Supabase session: " + authResponse.error.message);
    }

    console.log("Supabase session set successfully");

    // Parse JWT to check terms acceptance
    const payload = JSON.parse(atob(tokenResponse.supabaseAccessToken.split('.')[1]));
    const plans = payload.plans || [];

    console.log('📋 JWT plans:', plans);

    // Check terms acceptance for yours-brightly
    const termsStatus = checkTermsVersion(plans);
    console.log('📄 Terms status:', termsStatus);

    if (!termsStatus.hasAccess) {
      // No subscription exists - need to accept terms and create free subscription
      console.log('❌ No access to yours-brightly, showing terms acceptance');
      await handleTermsAcceptance(false);

      // Return a partial auth response - user will be stuck on terms page
      // until they accept, at which point the session will be refreshed
      return {
        user: authResponse.data.user,
        session: null // No valid session until terms accepted
      };

    } else if (!termsStatus.hasAcceptedTerms || termsStatus.needsTermsUpdate) {
      // Has subscription but terms not accepted or outdated
      const isUpdate = termsStatus.needsTermsUpdate;
      console.log(`📄 ${isUpdate ? 'Terms update' : 'Terms acceptance'} required`);

      await handleTermsAcceptance(isUpdate);

      // Return a partial auth response - user will be stuck on terms page
      // until they accept, at which point the session will be refreshed
      return {
        user: authResponse.data.user,
        session: null // No valid session until terms accepted
      };
    }

    console.log('✅ Terms validation complete, user has access');
    return authResponse.data;

  } catch (err: any) {
    console.error("Authentication failed:", err);
    throw new Error("Failed to authenticate: " + (err.message || err));
  }
}
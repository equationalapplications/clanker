import { getFunctions, httpsCallable } from "firebase/functions";
import { supabaseClient } from "../config/supabaseClient";
import { app, auth } from "../config/firebaseConfig";
import type { AuthResponse } from "@supabase/supabase-js";

// Type for the response from the Firebase function
interface ExchangeTokenResponse {
  supabaseAccessToken: string;
  supabaseRefreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

// Create functions instance and connect to emulator at module level
const functions = getFunctions(app, "us-central1");

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
    return authResponse.data;

  } catch (err: any) {
    console.error("Authentication failed:", err);
    throw new Error("Failed to authenticate: " + (err.message || err));
  }
}
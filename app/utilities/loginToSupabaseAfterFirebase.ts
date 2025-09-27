import { getFunctions, httpsCallable } from "firebase/functions"
import { supabase } from "../config/supabaseClient"
import { app, auth } from "../config/firebaseConfig"

// Create functions instance and connect to emulator at module level
const functions = getFunctions(app, "us-central1")

export async function loginToSupabaseAfterFirebase(): Promise<any | null> {
  // Ensure we have a current user
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("No authenticated Firebase user found");
  }

  const exchangeToken = httpsCallable(functions, "exchangeToken");
  console.log("Callable function reference created");

  let supabaseToken: string | undefined;
  try {
    console.log("Calling Firebase function with region us-central1");

    // Get the Supabase token
    const result = await exchangeToken();
    console.log("Firebase function response:", result);

    // Check for errors and extract token
    if (result.data && typeof result.data === "object" && "supabaseAccessToken" in result.data) {
      supabaseToken = (result.data as { supabaseAccessToken: string }).supabaseAccessToken;
      console.log("Successfully extracted Supabase token");
    } else {
      console.error("Unexpected function response:", result);
      throw new Error("No Supabase token returned.");
    }
  } catch (err: any) {
    console.error("Firebase function call failed:", err);
    // Handle error from function
    throw new Error("Failed to exchange token: " + (err.message || err));
  }

  // Log into Supabase with the returned token
  if (supabaseToken) {
    const authResponse = await supabase.auth.setSession({
      access_token: supabaseToken,
      refresh_token: "", // Not used for custom JWT
    });
    // Now you are authenticated with Supabase!
    return authResponse;
  } else {
    return null;
  }
}

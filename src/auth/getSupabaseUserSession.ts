import { getFunctions, httpsCallable } from "firebase/functions";
import { app, auth } from "~/config/firebaseConfig";
import type { Session } from "@supabase/supabase-js";

// Create functions instance and connect to emulator at module level
const functions = getFunctions(app, "us-central1");

export async function getSupabaseUserSession() {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("No Firebase user is currently signed in");
  }

  console.log('🔐 Starting Supabase authentication for Firebase user:', currentUser.email);

  const exchangeToken = httpsCallable(functions, "exchangeToken") as unknown as () => Promise<{ data: Session }>;
  console.log("Callable function reference created");

  try {
    console.log("Calling Firebase function with region us-central1");

    // Get the token response from Firebase function
    const response = await exchangeToken();
    console.log("Firebase function response:", response.data);
    return response.data;
  } catch (err: any) {
    console.error("Authentication failed:", err);
    throw new Error("Failed to authenticate: " + (err.message || err));
  }
}
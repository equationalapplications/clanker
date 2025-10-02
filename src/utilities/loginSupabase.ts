import { getFunctions, httpsCallable } from "firebase/functions"
import { supabaseClient } from "../config/supabaseClient"
import { app, auth } from "../config/firebaseConfig"

// Create functions instance and connect to emulator at module level
const functions = getFunctions(app, "us-central1")

export async function loginSupabase(): Promise<any | null> {
  // Ensure we have a current user
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("No authenticated Firebase user found");
  }

  const exchangeToken = httpsCallable(functions, "exchangeToken");
  console.log("Callable function reference created");

  let supabaseAccessToken: string | undefined;
  let supabaseRefreshToken: string | undefined;
  try {
    console.log("Calling Firebase function with region us-central1");

    // Get the Supabase tokens
    const result = await exchangeToken();
    console.log("Firebase function response:", result);

    // Check for errors and extract both tokens
    if (result.data && typeof result.data === "object" &&
      "supabaseAccessToken" in result.data &&
      "supabaseRefreshToken" in result.data) {
      const data = result.data as {
        supabaseAccessToken: string;
        supabaseRefreshToken: string;
        expiresIn: number;
        refreshExpiresIn: number;
      };
      supabaseAccessToken = data.supabaseAccessToken;
      supabaseRefreshToken = data.supabaseRefreshToken;
      console.log("Successfully extracted both access and refresh tokens", {
        accessExpiresIn: data.expiresIn,
        refreshExpiresIn: data.refreshExpiresIn
      });
    } else {
      console.error("Unexpected function response:", result);
      throw new Error("No Supabase tokens returned.");
    }
  } catch (err: any) {
    console.error("Firebase function call failed:", err);
    // Handle error from function
    throw new Error("Failed to exchange token: " + (err.message || err));
  }

  // Sign into Supabase with the pre-signed JWT tokens
  if (supabaseAccessToken && supabaseRefreshToken) {
    try {
      console.log("🔐 Setting Supabase session with dual tokens");

      // Parse the access token payload for debugging
      let tokenPayload;
      try {
        tokenPayload = JSON.parse(atob(supabaseAccessToken.split('.')[1]));
        console.log("📋 Access token JWT payload analysis:", {
          sub: tokenPayload.sub,
          role: tokenPayload.role,
          aud: tokenPayload.aud,
          exp: tokenPayload.exp,
          apps: tokenPayload.apps,
          hasApps: !!tokenPayload.apps,
          appsCount: tokenPayload.apps?.length || 0,
          tokenType: tokenPayload.token_type
        });
      } catch (parseError) {
        console.error("Failed to parse access token JWT payload:", parseError);
        throw new Error("Invalid access token JWT format received from exchangeToken");
      }

      // Set the session using both access and refresh tokens
      const authResponse = await supabaseClient.auth.setSession({
        access_token: supabaseAccessToken,
        refresh_token: supabaseRefreshToken,
      });

      console.log("Supabase setSession response:", {
        error: authResponse.error,
        user: !!authResponse.data.user,
        session: !!authResponse.data.session
      });

      if (authResponse.error) {
        throw new Error(`Supabase setSession failed: ${authResponse.error.message}`);
      }

      // Verify the session was set correctly
      const { data: { session }, error: sessionError } = await supabaseClient.auth.getSession();

      if (sessionError) {
        console.error("Failed to verify Supabase session:", sessionError);
      } else if (session) {
        console.log("✅ Supabase session verified successfully:", {
          user: !!session.user,
          expires_at: session.expires_at,
          userId: session.user?.id,
          email: session.user?.email
        });

        // Log the active session JWT claims for debugging
        if (session.access_token) {
          try {
            const sessionPayload = JSON.parse(atob(session.access_token.split('.')[1]));
            console.log("🎯 Active session JWT claims:", {
              sub: sessionPayload.sub,
              role: sessionPayload.role,
              apps: sessionPayload.apps,
              exp: sessionPayload.exp,
              hasCustomClaims: !!sessionPayload.apps,
              appsArray: sessionPayload.apps || []
            });
          } catch (parseError) {
            console.error("Failed to parse session JWT:", parseError);
          }
        }
      } else {
        console.warn("No active Supabase session found after setSession");
      }

      console.log("🚀 Ready for authenticated Supabase operations");
      return authResponse;
    } catch (sessionError: any) {
      console.error("🚨 Failed to set Supabase session:", sessionError);
      throw new Error(`Supabase session error: ${sessionError.message}`);
    }
  } else {
    throw new Error("No Supabase tokens available to set session");
  }
}

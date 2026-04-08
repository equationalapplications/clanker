import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import {findSupabaseUserByEmail, callSupabaseRpc} from "./supabaseAdmin.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

interface SpendCreditsData {
  amount: number;
  description: string;
  referenceId?: string;
}

const handler = async (request: CallableRequest) => {
  // Require authentication
  if (!request.auth) {
    logger.error("Unauthenticated request to spendCredits");
    throw new HttpsError("unauthenticated", "Authentication required.");
  }

  const decoded: DecodedIdToken = request.auth.token as DecodedIdToken;
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError("unauthenticated", "Invalid Firebase authentication token.");
  }

  const email = decoded.email;
  if (!email) {
    throw new HttpsError(
      "failed-precondition",
      "Firebase user email is required."
    );
  }

  // Validate input
  const data = request.data as SpendCreditsData;

  if (!data || typeof data.amount !== "number" || data.amount <= 0) {
    throw new HttpsError(
      "invalid-argument",
      "amount must be a positive number."
    );
  }

  const descriptionIsInvalid = !data.description ||
    typeof data.description !== "string" ||
    data.description.trim().length === 0;
  if (descriptionIsInvalid) {
    throw new HttpsError(
      "invalid-argument",
      "description must be a non-empty string."
    );
  }

  const amount = Math.floor(data.amount);
  if (amount <= 0) {
    throw new HttpsError(
      "invalid-argument",
      "amount must be at least 1 after rounding down."
    );
  }
  const description = data.description.trim();
  const referenceId = data.referenceId && typeof data.referenceId === "string"
    ? data.referenceId.trim()
    : null;

  // Look up Supabase user by email
  const supabaseUser = await findSupabaseUserByEmail(email);
  if (!supabaseUser) {
    logger.error("Supabase user not found for email", {email});
    throw new HttpsError("not-found", "User not found.");
  }

  // Call the server-side spend_user_credits RPC
  const result = await callSupabaseRpc("spend_user_credits", {
    p_user_id: supabaseUser.id,
    p_app_name: "clanker",
    p_credit_amount: amount,
    p_description: description,
    p_reference_id: referenceId,
  });

  logger.info("spendCredits succeeded", {
    email,
    supabaseUserId: supabaseUser.id,
    amount,
    description,
  });

  return {success: true, result};
};

export const spendCredits = onCall(
  {
    region: "us-central1",
    secrets: ["SUPABASE_SERVICE_ROLE_KEY"]
  },
  (request) => {
    return handler(request);
  }
);

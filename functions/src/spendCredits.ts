import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { userRepository } from "./services/userRepository.js";
import { creditService } from "./services/creditService.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

interface SpendCreditsData {
  amount: number;
  description: string;
  referenceId?: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function isIdentityConflictError(error: unknown): boolean {
  const normalized = toErrorMessage(error).toLowerCase();
  return normalized.includes("different firebase uid");
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

  if (!data || typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount <= 0) {
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
  const trimmedReferenceId = data.referenceId && typeof data.referenceId === "string"
    ? data.referenceId.trim()
    : "";
  const referenceId = trimmedReferenceId.length > 0 ? trimmedReferenceId : null;

  let user: Awaited<ReturnType<typeof userRepository.getOrCreateUserByFirebaseIdentity>>;
  try {
    user = await userRepository.getOrCreateUserByFirebaseIdentity({
      firebaseUid: request.auth.uid,
      email,
    });
  } catch (error: unknown) {
    logger.error("Failed to bootstrap user identity in spendCredits", {
      firebaseUid: request.auth.uid,
      email,
      error,
    });

    if (isIdentityConflictError(error)) {
      throw new HttpsError(
        "failed-precondition",
        "User identity is already linked to another account."
      );
    }

    throw new HttpsError("internal", "Failed to bootstrap user.");
  }

  const success = await creditService.spendCredits(user.id, amount, description, referenceId ?? undefined);

  if (!success) {
    logger.warn("spendCredits failed - insufficient credits or user subscription missing", {
      userId: user.id,
      amount,
      description,
    });
    throw new HttpsError("resource-exhausted", "Insufficient credits.");
  }

  logger.info("spendCredits succeeded", {
    email,
    userId: user.id,
    amount,
    description,
  });

  return {success: true};
};

export const spendCreditsHandler = handler;

export const spendCredits = onCall(
  {
    region: "us-central1",
    enforceAppCheck: true,
    invoker: "public",
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => {
    return handler(request);
  }
);

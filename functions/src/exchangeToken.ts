import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import {
    exchangeFirebaseTokenForSupabaseSession,
    AuthBridgeError,
} from "@equationalapplications/firebase-auth-supabase-bridge";
import {getSupabaseUrl} from "./runtimeConfig.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps?.length) {
    admin.initializeApp();
}

const HTTPS_ERROR_CODES = [
    "cancelled",
    "unknown",
    "invalid-argument",
    "deadline-exceeded",
    "not-found",
    "already-exists",
    "permission-denied",
    "resource-exhausted",
    "failed-precondition",
    "aborted",
    "out-of-range",
    "unimplemented",
    "internal",
    "unavailable",
    "data-loss",
    "unauthenticated",
] as const;

type HttpsErrorCode = typeof HTTPS_ERROR_CODES[number];

const HTTPS_ERROR_CODE_SET = new Set<string>(HTTPS_ERROR_CODES);

function getSupabaseServiceRoleKey(): string | undefined {
    const value = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    return value ? value : undefined;
}

function toHttpsErrorCode(code: string): HttpsErrorCode {
    return HTTPS_ERROR_CODE_SET.has(code) ? code as HttpsErrorCode : "internal";
}

/**
 * exchangeToken (2nd Gen callable)
 *
 * Authenticates a Firebase user with Supabase by:
 * 1. Verifying Firebase auth context
 * 2. Finding or creating the corresponding Supabase user
 * 3. Generating a real Supabase session (with auth hook enrichment)
 */
const handler = async (request: CallableRequest) => {
    if (!request.auth) {
        logger.error("Unauthenticated request");
        throw new HttpsError(
            "unauthenticated",
            "Authentication required."
        );
    }

    const uid = request.auth.uid;
    const decoded = request.auth.token as DecodedIdToken | undefined;

    if (!decoded || decoded.uid !== uid) {
        logger.error("Context token missing or UID mismatch", {
            contextUid: uid,
            tokenUid: decoded?.uid,
        });
        throw new HttpsError(
            "unauthenticated",
            "Invalid or missing Firebase authentication token."
        );
    }

    const email = decoded.email;
    if (!email) {
        logger.error("No email in Firebase token");
        throw new HttpsError(
            "failed-precondition",
            "Firebase user email is required."
        );
    }

    const supabaseUrl = getSupabaseUrl();
    const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
    if (!supabaseUrl || !supabaseServiceRoleKey) {
        logger.error("Missing Supabase configuration for token exchange", {
            hasSupabaseUrl: Boolean(supabaseUrl),
            hasServiceRoleKey: Boolean(supabaseServiceRoleKey),
        });
        throw new HttpsError(
            "failed-precondition",
            "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL."
        );
    }

    try {
        const session = await exchangeFirebaseTokenForSupabaseSession({
            supabaseUrl,
            supabaseServiceRoleKey,
            firebaseUid: uid,
            email,
        });

        logger.info("Token exchange successful", {
            email,
            expiresIn: session.expires_in,
        });

        return session;
    } catch (err) {
        if (err instanceof AuthBridgeError) {
            throw new HttpsError(toHttpsErrorCode(err.code), err.message);
        }
        logger.error("Token exchange failed", { err, email });
        throw new HttpsError("internal", "Failed to exchange token.");
    }
};

export const exchangeTokenHandler = handler;

// 2nd Gen callable function
export const exchangeToken = onCall(
    {
        region: "us-central1",
        secrets: ["SUPABASE_SERVICE_ROLE_KEY"],
        enforceAppCheck: true,
        invoker: "public",
    },
    (request) => {
        return handler(request);
    }
);
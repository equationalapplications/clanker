import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getSupabaseAdminClient, findSupabaseUserByEmail, findSupabaseUserByEmailIncludeDeleted } from "./supabaseAdmin.js";

const APP_NAME = "clanker";
const INITIAL_FREE_CREDITS = 50;

// Initialize the Admin SDK if not already initialized
if (!admin.apps?.length) {
    admin.initializeApp();
}

/**
 * Create a Supabase user via the Admin API using the service role key.
 * Returns the created user's id or null on failure.
 */
async function createSupabaseUser(
    email: string,
    firebaseUid: string
): Promise<{ id: string } | null> {
    const supabase = getSupabaseAdminClient();

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { firebaseUid },
    });

    if (error) {
        logger.error("Failed to create Supabase user", {
            message: error.message,
            status: error.status,
            email,
        });

        // If creation failed because the email already exists (e.g.
        // soft-deleted user), find the stale auth user, hard-delete it,
        // and recreate a fresh auth user.
        if (error.status === 422) {
            logger.info("Attempting fallback for existing/soft-deleted user", { email });
            const existing = await findSupabaseUserByEmailIncludeDeleted(email);
            if (!existing) {
                return null;
            }

            if (!existing.deletedAt) {
                logger.info("Existing active Supabase user found; using existing account", {
                    existingUserId: existing.id,
                    email,
                });
                return { id: existing.id };
            }

            const { error: deleteError } = await supabase.auth.admin.deleteUser(existing.id);
            if (deleteError) {
                logger.error("Failed to delete stale Supabase user during recreate", {
                    existingUserId: existing.id,
                    message: deleteError.message,
                    email,
                });
                return null;
            }

            const { data: recreated, error: recreateError } = await supabase.auth.admin.createUser({
                email,
                email_confirm: true,
                user_metadata: { firebaseUid },
            });

            if (recreateError || !recreated?.user) {
                logger.error("Failed to recreate Supabase user after deleting stale user", {
                    existingUserId: existing.id,
                    message: recreateError?.message,
                    email,
                });
                return null;
            }

            logger.info("Recreated Supabase user after stale-user cleanup", {
                previousUserId: existing.id,
                newUserId: recreated.user.id,
                email,
            });
            return { id: recreated.user.id };
        }

        return null;
    }

    if (!data?.user) {
        return null;
    }

    logger.info("Supabase user created", { userId: data.user.id, email });
    return { id: data.user.id };
}

/**
 * Generate a real Supabase session for a user via the Admin API.
 * Uses generate_link (magiclink) + verify to produce a proper session
 * with access_token, refresh_token, and auth hook enrichment (plans).
 */
async function getSupabaseUserSession(
    email: string
): Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
}> {
    const supabase = getSupabaseAdminClient();

    // Step 1: Generate a magic link token via Admin API (no email sent)
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: email.toLowerCase(),
    });

    if (linkError || !linkData?.properties?.hashed_token) {
        logger.error("Failed to generate magic link", {
            message: linkError?.message,
            email,
        });
        throw new HttpsError(
            "internal",
            "Failed to generate Supabase session link."
        );
    }

    // Step 2: Verify the token to get a real session (triggers auth hooks)
    const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: linkData.properties.hashed_token,
    });

    if (verifyError || !sessionData?.session) {
        logger.error("Failed to verify magic link token", {
            message: verifyError?.message,
            email,
        });
        throw new HttpsError(
            "internal",
            "Failed to verify Supabase session token."
        );
    }

    const session = sessionData.session;

    return {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: session.token_type,
    };
}

/**
 * Ensure the user has a free-tier subscription row for this app.
 * This is an idempotent insert and will not overwrite existing rows.
 */
async function ensureFreeTierSubscription(supabaseUserId: string): Promise<void> {
    const supabase = getSupabaseAdminClient();

    const { error } = await supabase
        .from("user_app_subscriptions")
        .upsert(
            {
                user_id: supabaseUserId,
                app_name: APP_NAME,
                plan_tier: "free",
                plan_status: "active",
                current_credits: INITIAL_FREE_CREDITS,
                updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id,app_name", ignoreDuplicates: true }
        );

    if (error) {
        logger.error("Failed to ensure free-tier subscription", {
            supabaseUserId,
            message: error.message,
            code: error.code,
        });
        throw new HttpsError(
            "internal",
            "Failed to ensure initial free-tier subscription."
        );
    }
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
    // Ensure caller is authenticated via Firebase Auth
    if (!request.auth) {
        logger.error("Unauthenticated request");
        throw new HttpsError(
            "unauthenticated",
            "Authentication required."
        );
    }

    const uid = request.auth.uid;
    let decoded: DecodedIdToken;

    try {
        decoded = request.auth.token as DecodedIdToken;
        if (!decoded || decoded.uid !== uid) {
            logger.error("Context token missing or UID mismatch", {
                contextUid: uid,
                tokenUid: decoded ? decoded.uid : null,
            });
            throw new HttpsError(
                "unauthenticated",
                "Invalid or missing Firebase authentication token."
            );
        }
    } catch (error) {
        logger.error("Token extraction/verification failed", { error });
        throw new HttpsError(
            "unauthenticated",
            "Invalid Firebase authentication token."
        );
    }

    // Determine the corresponding Supabase user id. If the Supabase user does
    // not exist, create it via the Admin API using the service role key.
    // The resolved Supabase user id is retained for logging/traceability,
    // while the Supabase session itself is requested later using the email.
    const email = decoded.email;
    if (!email) {
        logger.error("No email in Firebase token");
        throw new HttpsError(
            "failed-precondition",
            "Firebase user email is required to create or find Supabase user."
        );
    }

    let supabaseUserId: string | null = null;
    try {
        const found = await findSupabaseUserByEmail(email);
        if (found) {
            supabaseUserId = found.id;
        } else {
            const created = await createSupabaseUser(email, decoded.uid);
            if (created) {
                supabaseUserId = created.id;
            }
            logger.info("Supabase user not found, attempted creation", { email });
        }
    } catch (err) {
        logger.error("Supabase admin API check/create user failed", {err, email});
        if (err instanceof HttpsError) {
            throw err;
        }
        throw new HttpsError(
            "internal",
            "Failed to find or create corresponding Supabase user."
        );
    }

    if (!supabaseUserId) {
        logger.error("Unable to determine or create Supabase user ID for email", { email });
        throw new HttpsError(
            "internal",
            "Failed to find or create corresponding Supabase user."
        );
    }

    await ensureFreeTierSubscription(supabaseUserId);

    // Generate a real Supabase session via Admin API (triggers auth hooks)
    const session = await getSupabaseUserSession(email);

    logger.info("Token exchange successful", {
        email,
        sub: supabaseUserId,
        expiresIn: session.expires_in,
    });

    return session;
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
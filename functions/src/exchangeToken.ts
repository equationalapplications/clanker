import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import { createHash } from "crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import {
  getSupabaseAdminClient,
  getFreshSupabaseAdminClient,
  findSupabaseUserByEmail,
  findSupabaseUserByEmailIncludeDeleted,
} from "./supabaseAdmin.js";

const SESSION_EXCHANGE_WINDOW_MS = 30_000;
const sessionExchangeRateLimitCollection = "sessionExchangeRateLimits";
const sessionExchangeLastAtByEmail = new Map<string, number>();

function getSessionExchangeRateLimitDocId(email: string): string {
    // Hash email for PII safety: avoid logging/leaking raw email in doc IDs
    const normalized = email.trim().toLowerCase();
    return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Atomically enforces the per-email exchange window across all function instances via Firestore.
 * Falls back to in-memory Map if Firestore is unavailable.
 * Returns the last exchange timestamp when the request should be rate-limited,
 * otherwise records the current exchange time and returns null.
 */
async function checkAndRecordSessionExchange(email: string): Promise<number | null> {
    const rateLimitDocId = getSessionExchangeRateLimitDocId(email);
    const now = Date.now();

    // Try Firestore-based rate limiting (cross-instance)
    try {
        const db = admin.firestore();
        const docRef = db.collection(sessionExchangeRateLimitCollection).doc(rateLimitDocId);

        return await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(docRef);
            const lastAt = snapshot.exists ? snapshot.get("lastAt") : undefined;
            const lastAtNumber = typeof lastAt === "number" ? lastAt : null;

            if (
                lastAtNumber !== null &&
                now - lastAtNumber < SESSION_EXCHANGE_WINDOW_MS
            ) {
                return lastAtNumber;
            }

            transaction.set(
                docRef,
                {
                    lastAt: now,
                    // Requires Firestore TTL policy on this collection's
                    // `expireAt` field; otherwise docs accumulate forever.
                    // Console → Firestore → TTL → collection:
                    //   sessionExchangeRateLimits, field: expireAt
                    expireAt: new Date(now + 24 * 60 * 60 * 1000),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
            );

            return null;
        });
    } catch (err) {
        // Firestore unavailable; fall back to in-memory Map
        logger.warn("Firestore rate-limit check failed, falling back to in-memory map", {
            emailHash: rateLimitDocId,
            error: err instanceof Error ? err.message : String(err),
        });

        const lastAttemptAt = sessionExchangeLastAtByEmail.get(rateLimitDocId) ?? 0;
        if (now - lastAttemptAt < SESSION_EXCHANGE_WINDOW_MS) {
            return lastAttemptAt;
        }

        sessionExchangeLastAtByEmail.set(rateLimitDocId, now);

        // Keep map bounded for warm instances.
        if (sessionExchangeLastAtByEmail.size > 5000) {
            const cutoff = now - (10 * SESSION_EXCHANGE_WINDOW_MS);
            for (const [key, timestamp] of sessionExchangeLastAtByEmail) {
                if (timestamp < cutoff) {
                    sessionExchangeLastAtByEmail.delete(key);
                }
            }
        }

        return null;
    }
}

/**
 * Best-effort clear of the rate-limit record so a user is not blocked
 * after a transient generateLink / verifyOtp failure.
 */
async function clearSessionExchangeRecord(email: string): Promise<void> {
    const rateLimitDocId = getSessionExchangeRateLimitDocId(email);
    sessionExchangeLastAtByEmail.delete(rateLimitDocId);
    try {
        const db = admin.firestore();
        await db.collection(sessionExchangeRateLimitCollection).doc(rateLimitDocId).delete();
    } catch {
        // best-effort: in-memory already cleared
    }
}

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
                logger.error("422 fallback: findSupabaseUserByEmailIncludeDeleted returned null", {
                    email,
                    hint: "RPC get_auth_user_by_email found no record — possible data inconsistency",
                });
                return null;
            }

            if (!existing.deletedAt) {
                logger.info("Existing active Supabase user found; using existing account", {
                    existingUserId: existing.id,
                    email,
                });
                return { id: existing.id };
            }

            // Hard-delete (shouldSoftDelete = false) so the email is fully
            // released and a fresh user can be created.  A soft-delete only
            // sets deleted_at and the subsequent createUser would 422 again.
            const { error: deleteError } = await supabase.auth.admin.deleteUser(
                existing.id,
                false,
            );
            if (deleteError) {
                // Tolerate 404 (user already deleted, possibly by concurrent request)
                if (deleteError.status !== 404) {
                    logger.error("Failed to delete stale Supabase user during recreate", {
                        existingUserId: existing.id,
                        message: deleteError.message,
                        status: deleteError.status,
                        email,
                    });
                    return null;
                }
                logger.info("Stale Supabase user already deleted (404), continuing recreate", {
                    existingUserId: existing.id,
                    email,
                });
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
        logger.error("Supabase createUser returned 200 but no user object", { email });
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
    const lastAttemptAt = await checkAndRecordSessionExchange(email);

    if (lastAttemptAt !== null) {
        throw new HttpsError(
            "resource-exhausted",
            "Token exchange rate-limited. Retry shortly."
        );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const supabase = getFreshSupabaseAdminClient();

    try {
        // Step 1: Generate a magic link token via Admin API (no email sent)
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: "magiclink",
            email: normalizedEmail,
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
    } catch (err) {
        // Release rate-limit lock so user can retry immediately
        // after a transient generateLink / verifyOtp failure.
        await clearSessionExchangeRecord(email);
        throw err;
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
    const decoded = request.auth.token as DecodedIdToken | undefined;
    if (!decoded || decoded.uid !== uid) {
        logger.error("Context token missing or UID mismatch", {
            contextUid: uid,
            tokenUid: decoded?.uid ?? null,
        });
        throw new HttpsError(
            "unauthenticated",
            "Invalid or missing Firebase authentication token."
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
            logger.info("Supabase user found for email", {
                email,
                supabaseUserId,
            });
        } else {
            const created = await createSupabaseUser(email, decoded.uid);
            if (created) {
                supabaseUserId = created.id;
                logger.info("Supabase user not found; created user", {
                    email,
                    supabaseUserId,
                });
            } else {
                logger.error("Supabase user not found; creation failed", { email });
            }
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
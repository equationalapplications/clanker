import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getSupabaseUrl } from "./runtimeConfig.js";
import { findSupabaseUserByEmail } from "./supabaseAdmin.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps?.length) {
    admin.initializeApp();
}

function getSupabaseServiceRoleKey(): string | undefined {
    return process.env.SUPABASE_SERVICE_ROLE_KEY;
}


type UnknownRecord = Record<string, unknown>;

/**
 * Create a Supabase user via the Admin API using the service role key.
 * Returns the created user's id or null on failure.
 */
async function createSupabaseUser(
    email: string,
    firebaseUid: string
): Promise<{ id: string } | null> {
    const supabaseUrl = getSupabaseUrl();
    const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
    if (!supabaseServiceRoleKey || !supabaseUrl) {
        logger.warn("Missing Supabase service role key or URL for user creation");
        return null;
    }

    const url = `${supabaseUrl.replace(/\/+$/, "")}/auth/v1/admin/users`;

    try {
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${supabaseServiceRoleKey}`,
                "apikey": supabaseServiceRoleKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email,
                email_confirm: true,
                user_metadata: { firebaseUid },
            }),
        });

        if (!res.ok) {
            const errorText = await res.text();
            logger.error("Failed to create Supabase user", {
                status: res.status,
                statusText: res.statusText,
                error: errorText,
                email
            });
            return null;
        }

        const body: unknown = await res.json();
        logger.info("Supabase user created", { body });

        if (body && typeof body === "object" && "id" in body) {
            const obj = body as UnknownRecord;
            const id = obj["id"] as unknown;
            if (typeof id === "string") return { id };
        }
        return null;
    } catch (error) {
        logger.error("Error creating Supabase user", { error, email });
        return null;
    }
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
    const supabaseUrl = getSupabaseUrl();
    const supabaseServiceRoleKey = getSupabaseServiceRoleKey();
    if (!supabaseServiceRoleKey || !supabaseUrl) {
        throw new HttpsError(
            "failed-precondition",
            "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL."
        );
    }

    const base = supabaseUrl.replace(/\/+$/, "");

    // Step 1: Generate a magic link token via Admin API (no email sent)
    const linkRes = await fetch(`${base}/auth/v1/admin/generate_link`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${supabaseServiceRoleKey}`,
            "apikey": supabaseServiceRoleKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            type: "magiclink",
            email: email.toLowerCase(),
        }),
    });

    if (!linkRes.ok) {
        const errorText = await linkRes.text();
        logger.error("Failed to generate magic link", {
            status: linkRes.status,
            error: errorText,
            email,
        });
        throw new HttpsError(
            "internal",
            "Failed to generate Supabase session link."
        );
    }

    const linkBody = await linkRes.json() as Record<string, unknown>;
    const hashedToken = linkBody["hashed_token"] as string | undefined;

    if (!hashedToken) {
        logger.error("No hashed_token in generate_link response", { linkBody });
        throw new HttpsError(
            "internal",
            "Failed to extract token from Supabase link."
        );
    }

    // Step 2: Verify the token to get a real session (triggers auth hooks)
    const verifyRes = await fetch(`${base}/auth/v1/verify`, {
        method: "POST",
        headers: {
            "apikey": supabaseServiceRoleKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            type: "magiclink",
            token_hash: hashedToken,
        }),
    });

    if (!verifyRes.ok) {
        const errorText = await verifyRes.text();
        logger.error("Failed to verify magic link token", {
            status: verifyRes.status,
            error: errorText,
            email,
        });
        throw new HttpsError(
            "internal",
            "Failed to verify Supabase session token."
        );
    }

    const session = await verifyRes.json() as Record<string, unknown>;

    if (
        typeof session["access_token"] !== "string" ||
        typeof session["refresh_token"] !== "string"
    ) {
        logger.error("Invalid session from verify response", { session });
        throw new HttpsError(
            "internal",
            "Failed to get valid Supabase session."
        );
    }

    return {
        access_token: session["access_token"] as string,
        refresh_token: session["refresh_token"] as string,
        expires_in: (session["expires_in"] as number) || 3600,
        token_type: (session["token_type"] as string) || "bearer",
    };
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
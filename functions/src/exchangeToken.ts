import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import type {DecodedIdToken} from "firebase-admin/auth";
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
import { CLOUD_SQL_SECRETS } from "./cloudSqlSecrets.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps?.length) {
    admin.initializeApp();
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && typeof error.message === "string") {
        return error.message;
    }

    return String(error);
}

function isIdentityConflictError(error: unknown): boolean {
    return toErrorMessage(error).toLowerCase().includes("different firebase uid");
}

function isCloudSqlConfigError(error: unknown): boolean {
    const normalized = toErrorMessage(error).toLowerCase();
    return normalized.includes("missing required cloud sql environment variable");
}

/**
 * exchangeToken (2nd Gen callable)
 *
 * Bootstraps a Firebase user in the Clanker Cloud SQL database.
 * 1. Verifies Firebase auth context
 * 2. Finds or creates the corresponding user in Cloud SQL
 * 3. Ensures a default subscription exists (onboarding credits if new)
 * 4. Returns the user snapshot + subscription data
 */
const handler = async (
    request: CallableRequest,
    deps = { userRepository, subscriptionService }
) => {
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

    try {
        // 1. Get or create user
        const user = await deps.userRepository.getOrCreateUserByFirebaseIdentity({
            firebaseUid: uid,
            email,
            displayName: decoded.name || null,
            avatarUrl: decoded.picture || null,
        });

        // 2. Get or create subscription
        let subscription = await deps.subscriptionService.getSubscription(user.id);
        
        if (!subscription) {
            logger.info("Creating default subscription for new user", { userId: user.id });
            subscription = await deps.subscriptionService.getOrCreateDefaultSubscription(user.id);
        }

        logger.info("Token exchange/bootstrap successful", {
            email,
            userId: user.id,
        });

        // Convert Date objects to ISO strings before returning.
        // Firebase callable encode() treats Date as a plain object and
        // serialises it to {} via Object.entries (which is empty for Date).
        const toISO = (v: unknown): string | null => {
            if (v === null || v === undefined) {
                return null;
            }

            if (v instanceof Date) {
                return v.toISOString();
            }

            if (typeof v === "string") {
                return v;
            }

            throw new Error("Invalid timestamp value in exchangeToken response payload.");
        };

        const toRequiredISO = (v: unknown, field: string): string => {
            const iso = toISO(v);
            if (!iso) {
                throw new Error(`Missing required timestamp field in exchangeToken response payload: ${field}`);
            }

            return iso;
        };

        return {
            user: {
                id: user.id,
                firebaseUid: user.firebaseUid,
                email: user.email,
                displayName: user.displayName,
                avatarUrl: user.avatarUrl,
                isProfilePublic: user.isProfilePublic,
                defaultCharacterId: user.defaultCharacterId,
                createdAt: toRequiredISO(user.createdAt, "user.createdAt"),
                updatedAt: toRequiredISO(user.updatedAt, "user.updatedAt"),
            },
            subscription: {
                planTier: subscription.planTier,
                planStatus: subscription.planStatus,
                currentCredits: subscription.currentCredits,
                termsVersion: subscription.termsVersion,
                termsAcceptedAt: toISO(subscription.termsAcceptedAt),
            },
        };
    } catch (err: unknown) {
        logger.error("Token exchange failed", { err, email });
        if (err instanceof HttpsError) {
            throw err;
        }

        if (isCloudSqlConfigError(err)) {
            throw new HttpsError(
                "failed-precondition",
                "Server configuration is incomplete."
            );
        }

        if (isIdentityConflictError(err)) {
            throw new HttpsError(
                "failed-precondition",
                "User identity is already linked to another account."
            );
        }

        throw new HttpsError("internal", "Failed to bootstrap user.");
    }
};

export const exchangeTokenHandler = handler;

// 2nd Gen callable function
export const exchangeToken = onCall(
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

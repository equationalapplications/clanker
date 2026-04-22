import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import Stripe from "stripe";
import { getStripePriceIds, getStripeCheckoutUrls } from "./runtimeConfig.js";
import { validateAndNormalizeStripeSecretKey } from "./stripeConfig.js";

type LoggerLike = Pick<typeof logger, "error" | "warn" | "info">;
const defaultLogger: LoggerLike = logger;
let activeLogger: LoggerLike = defaultLogger;
const MAX_ATTEMPT_ID_LENGTH = 128;

export function setPurchasePackageStripeLoggerForTests(next?: LoggerLike): void {
    activeLogger = next ?? defaultLogger;
}

// Initialize the Admin SDK if not already initialized
if (!admin.apps?.length) {
    admin.initializeApp();
}

function getStripeClient() {
    const secretKey = validateAndNormalizeStripeSecretKey(
        process.env.STRIPE_SECRET_KEY,
        (message) => new HttpsError("failed-precondition", message)
    );

    return new Stripe(secretKey);
}

function getRequiredValue(name: string, value?: string): string {
    if (!value) {
        throw new HttpsError(
            "failed-precondition",
            `${name} configuration value is not set`
        );
    }
    return value;
}

function appendAttemptId(url: string, attemptId?: string): string {
    if (!attemptId) {
        return url;
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        throw new HttpsError(
            "failed-precondition",
            `Invalid checkout URL configuration: ${url}`
        );
    }

    parsedUrl.searchParams.set("attemptId", attemptId);
    return parsedUrl.toString();
}

export function resolveCheckoutModeFromPriceType(
    priceType: Stripe.Price.Type
): "subscription" | "payment" {
    return priceType === "recurring" ? "subscription" : "payment";
}

async function getOrCreateStripeCustomer(
    stripe: Stripe,
    email: string,
    firebaseUid: string
): Promise<string> {
    const existing = await stripe.customers.list({ email, limit: 1 });
    if (existing.data.length > 0) {
        return existing.data[0].id;
    }
    const customer = await stripe.customers.create({
        email,
        metadata: { firebase_uid: firebaseUid },
    });
    return customer.id;
}

const handler = async (request: CallableRequest) => {
    if (!request.auth) {
        activeLogger.error("Unauthenticated request to purchasePackageStripe");
        throw new HttpsError("unauthenticated", "Authentication required.");
    }

    // Validate per-request so missing Stripe env vars only fail this function,
    // not the entire Functions bundle (which would take down exchangeToken too).
    const { monthly20, monthly50, creditPack } = getStripePriceIds();
    const { successUrl, cancelUrl } = getStripeCheckoutUrls();
    const STRIPE_MONTHLY_20_PRICE_ID = getRequiredValue("STRIPE_MONTHLY_20_PRICE_ID", monthly20);
    const STRIPE_MONTHLY_50_PRICE_ID = getRequiredValue("STRIPE_MONTHLY_50_PRICE_ID", monthly50);
    const STRIPE_CREDIT_PACK_PRICE_ID = getRequiredValue("STRIPE_CREDIT_PACK_PRICE_ID", creditPack);
    const STRIPE_SUCCESS_URL = getRequiredValue("STRIPE_SUCCESS_URL", successUrl);
    const STRIPE_CANCEL_URL = getRequiredValue("STRIPE_CANCEL_URL", cancelUrl);
    const ALLOWED_PRICE_IDS = new Set([
        STRIPE_MONTHLY_20_PRICE_ID,
        STRIPE_MONTHLY_50_PRICE_ID,
        STRIPE_CREDIT_PACK_PRICE_ID,
    ]);
    const SUBSCRIPTION_PRICE_IDS = new Set([
        STRIPE_MONTHLY_20_PRICE_ID,
        STRIPE_MONTHLY_50_PRICE_ID,
    ]);

    const data = request.data;
    if (!data?.priceId || typeof data.priceId !== "string") {
        throw new HttpsError(
            "invalid-argument",
            "priceId must be a non-empty string."
        );
    }

    if (typeof data.attemptId !== "undefined" && typeof data.attemptId !== "string") {
        throw new HttpsError(
            "invalid-argument",
            "attemptId must be a non-empty trimmed string when provided."
        );
    }

    if (typeof data.attemptId === "string") {
        const trimmedAttemptId = data.attemptId.trim();
        if (trimmedAttemptId.length === 0) {
            throw new HttpsError(
                "invalid-argument",
                "attemptId must be a non-empty trimmed string when provided."
            );
        }

        if (trimmedAttemptId.length > MAX_ATTEMPT_ID_LENGTH) {
            throw new HttpsError(
                "invalid-argument",
                `attemptId must be at most ${MAX_ATTEMPT_ID_LENGTH} characters when provided.`
            );
        }
    }

    const { priceId } = data;
    const attemptId = typeof data.attemptId === "string" ? data.attemptId.trim() : undefined;
    if (!ALLOWED_PRICE_IDS.has(priceId)) {
        throw new HttpsError("invalid-argument", `Unknown priceId: ${priceId}`);
    }

    const stripe = getStripeClient();

    const firebaseUser = await admin.auth().getUser(request.auth.uid);
    const email = firebaseUser.email;
    if (!email) {
        throw new HttpsError(
            "failed-precondition",
            "Firebase user has no email address."
        );
    }

    const stripeCustomerId = await getOrCreateStripeCustomer(
        stripe,
        email,
        request.auth.uid
    );

    const price = await stripe.prices.retrieve(priceId);
    const mode = resolveCheckoutModeFromPriceType(price.type);
    const expectedMode: "subscription" | "payment" = SUBSCRIPTION_PRICE_IDS.has(priceId)
        ? "subscription"
        : "payment";

    if (mode !== expectedMode) {
        activeLogger.warn("Stripe price type differs from configured checkout mode", {
            priceId,
            priceType: price.type,
            configuredMode: expectedMode,
            resolvedMode: mode,
        });
    }

    const metadata: Stripe.MetadataParam = {
        firebase_uid: request.auth.uid,
        email,
    };
    if (attemptId) {
        metadata.attemptId = attemptId;
    }

    const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: appendAttemptId(STRIPE_SUCCESS_URL, attemptId),
        cancel_url: appendAttemptId(STRIPE_CANCEL_URL, attemptId),
        metadata,
        client_reference_id: request.auth.uid,
    });

    if (!session.url) {
        activeLogger.error("Stripe Checkout Session missing URL", {
            sessionId: session.id,
            email,
            priceId,
            mode,
        });
        throw new HttpsError(
            "internal",
            "Stripe Checkout Session did not include a checkout URL."
        );
    }

    activeLogger.info("Stripe Checkout Session created", {
        sessionId: session.id,
        email,
        priceId,
        mode,
    });

    return session.url;
};

export const purchasePackageStripeHandler = handler;

export const purchasePackageStripe = onCall(
    {
        region: "us-central1",
        invoker: "public",
        enforceAppCheck: true,
        secrets: ["STRIPE_SECRET_KEY"],
    },
    handler
);
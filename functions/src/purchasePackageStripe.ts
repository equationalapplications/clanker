import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import Stripe from "stripe";
import { getStripePriceIds, getStripeCheckoutUrls } from "./runtimeConfig.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps?.length) {
    admin.initializeApp();
}

function getStripeClient() {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        throw new Error("STRIPE_SECRET_KEY environment variable is not set");
    }
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
    // Validate per-request so missing Stripe env vars only fail this function,
    // not the entire Functions bundle (which would take down exchangeToken too).
    const { monthly20, monthly50, creditPack } = getStripePriceIds();
    const { successUrl, cancelUrl } = getStripeCheckoutUrls();
    const STRIPE_MONTHLY_20_PRICE_ID = getRequiredValue("STRIPE_MONTHLY_20_PRICE_ID", monthly20);
    const STRIPE_MONTHLY_50_PRICE_ID = getRequiredValue("STRIPE_MONTHLY_50_PRICE_ID", monthly50);
    const STRIPE_CREDIT_PACK_PRICE_ID = getRequiredValue("STRIPE_CREDIT_PACK_PRICE_ID", creditPack);
    const ALLOWED_PRICE_IDS = new Set([
        STRIPE_MONTHLY_20_PRICE_ID,
        STRIPE_MONTHLY_50_PRICE_ID,
        STRIPE_CREDIT_PACK_PRICE_ID,
    ]);
    const SUBSCRIPTION_PRICE_IDS = new Set([
        STRIPE_MONTHLY_20_PRICE_ID,
        STRIPE_MONTHLY_50_PRICE_ID,
    ]);

    if (!request.auth) {
        logger.error("Unauthenticated request to purchasePackageStripe");
        throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const data = request.data;
    if (!data?.priceId || typeof data.priceId !== "string") {
        throw new HttpsError(
            "invalid-argument",
            "priceId must be a non-empty string."
        );
    }

    const { priceId } = data;
    if (!ALLOWED_PRICE_IDS.has(priceId)) {
        throw new HttpsError("invalid-argument", `Unknown priceId: ${priceId}`);
    }

    const firebaseUser = await admin.auth().getUser(request.auth.uid);
    const email = firebaseUser.email;
    if (!email) {
        throw new HttpsError(
            "failed-precondition",
            "Firebase user has no email address."
        );
    }

    const stripe = getStripeClient();
    const stripeCustomerId = await getOrCreateStripeCustomer(
        stripe,
        email,
        request.auth.uid
    );

    const mode: "subscription" | "payment" = SUBSCRIPTION_PRICE_IDS.has(priceId)
        ? "subscription"
        : "payment";

    const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode,
        line_items: [{ price: priceId, quantity: 1 }],
        success_url:
            successUrl ||
            "https://clanker-ai.com/checkout/success",
        cancel_url:
            cancelUrl ||
            "https://clanker-ai.com/checkout/cancel",
        metadata: {
            firebase_uid: request.auth.uid,
            email,
        },
        client_reference_id: request.auth.uid,
    });

    if (!session.url) {
        logger.error("Stripe Checkout Session missing URL", {
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

    logger.info("Stripe Checkout Session created", {
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
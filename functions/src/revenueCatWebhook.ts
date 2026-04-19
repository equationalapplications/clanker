import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import {timingSafeEqual} from "crypto";
import type {Request, Response} from "express";
import {findSupabaseUserByEmail, callSupabaseRpc, upsertUserSubscription} from "./supabaseAdmin.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

// RevenueCat product identifier → DB tier mapping
const REVENUECAT_PRODUCT_TO_TIER: Record<string, string> = {
  "monthly_20_subscription": "monthly_20",
  "monthly_50_subscription": "monthly_50",
};

// Support iOS (credit_100) and Android (credit_pack_100) credit-pack product IDs
const REVENUECAT_CREDIT_PACK_IDS = new Set([
  "credit_pack_100",
  "credit_100",
]);

function constantTimeEquals(provided: string | null, expected: string): boolean {
  if (typeof provided !== "string") {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  try {
    return timingSafeEqual(providedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
const CREDIT_PACK_AMOUNT = 100;
const APP_NAME = "clanker";

function isRevenueCatCreditPackProduct(productId: string): boolean {
  return REVENUECAT_CREDIT_PACK_IDS.has(productId);
}

// Shape of RevenueCat webhook event payload (abbreviated)
interface RevenueCatEvent {
  event: {
    type: string;
    app_user_id: string; // Firebase UID
    product_id: string;
    expiration_at_ms?: number;
    original_transaction_id?: string;
  };
}

export function parseRevenueCatEvent(body: unknown): RevenueCatEvent {
  let parsedBody: unknown = body;
  const parseTextBody = (textBody: string): unknown => {
    const trimmed = textBody.trim();
    if (trimmed.length === 0) {
      return {};
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      // RevenueCat or proxies may deliver as application/x-www-form-urlencoded.
      const params = new URLSearchParams(trimmed);
      if (params.size > 0) {
        const eventParam = params.get("event");
        if (!eventParam) {
          throw new Error("Missing form event payload");
        }

        try {
          const parsedEvent = JSON.parse(eventParam);
          const apiVersion = params.get("api_version");
          return {
            ...(apiVersion ? {api_version: apiVersion} : {}),
            event: parsedEvent,
          };
        } catch {
          throw new Error("Invalid form event payload");
        }
      }

      throw new Error("Invalid JSON body");
    }
  };

  if (typeof body === "string") {
    parsedBody = parseTextBody(body);
  } else if (Buffer.isBuffer(body)) {
    parsedBody = parseTextBody(body.toString("utf8"));
  } else if (body instanceof Uint8Array) {
    parsedBody = parseTextBody(Buffer.from(body).toString("utf8"));
  }

  const payload = typeof parsedBody === "object" && parsedBody !== null ?
    parsedBody as Record<string, unknown> :
    null;
  const rawEvent = payload?.event ?? payload;
  const event = typeof rawEvent === "object" && rawEvent !== null ?
    rawEvent as Record<string, unknown> :
    (() => {
      if (typeof rawEvent !== "string") {
        return null;
      }

      try {
        const parsed = JSON.parse(rawEvent);
        return typeof parsed === "object" && parsed !== null ?
          parsed as Record<string, unknown> :
          null;
      } catch {
        return null;
      }
    })();
  const type = typeof event?.type === "string" ? event.type.trim() : "";
  const appUserId = typeof event?.app_user_id === "string" ? event.app_user_id.trim() : "";
  const productId = typeof event?.product_id === "string" ? event.product_id.trim() : "";

  if (!event || type.length === 0) {
    throw new Error("Missing event.type");
  }

  if (appUserId.length === 0) {
    throw new Error("Missing or invalid event.app_user_id");
  }

  if (productId.length === 0) {
    throw new Error("Missing or invalid event.product_id");
  }

  const expirationAtMs = event.expiration_at_ms;
  if (
    expirationAtMs !== undefined &&
    expirationAtMs !== null &&
    (typeof expirationAtMs !== "number" || !Number.isFinite(expirationAtMs))
  ) {
    throw new Error("Invalid event.expiration_at_ms");
  }

  const originalTransactionId = event.original_transaction_id;
  if (
    originalTransactionId !== undefined &&
    originalTransactionId !== null &&
    typeof originalTransactionId !== "string"
  ) {
    throw new Error("Invalid event.original_transaction_id");
  }

  const normalizedOriginalTransactionId =
    typeof originalTransactionId === "string" ? originalTransactionId.trim() : undefined;

  return {
    event: {
      type,
      app_user_id: appUserId,
      product_id: productId,
      ...(expirationAtMs !== undefined && expirationAtMs !== null ?
        {expiration_at_ms: expirationAtMs} : {}),
      ...(normalizedOriginalTransactionId && normalizedOriginalTransactionId.length > 0 ?
        {original_transaction_id: normalizedOriginalTransactionId} : {}),
    },
  };
}

export const revenueCatWebhookHandler = async (req: Request, res: Response) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // Verify the shared secret
    const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;
    if (!webhookSecret) {
      logger.error("REVENUECAT_WEBHOOK_SECRET is not configured");
      res.status(500).send("Webhook secret not configured");
      return;
    }

    const authHeader = req.headers["authorization"];
    const normalizedHeader = typeof authHeader === "string" ? authHeader.trim() : null;
    const bearerPrefix = "Bearer ";
    const providedSecret =
      typeof normalizedHeader === "string" && normalizedHeader.startsWith(bearerPrefix)
        ? normalizedHeader.slice(bearerPrefix.length)
        : normalizedHeader;

    // Accept both "Authorization: Bearer <secret>" and "Authorization: <secret>".
    const isValid = constantTimeEquals(providedSecret, webhookSecret);

    if (!isValid) {
      logger.warn("RevenueCat webhook: invalid Authorization header");
      res.status(401).send("Unauthorized");
      return;
    }

    const reqWithRawBody = req as Request & {rawBody?: Buffer | Uint8Array | string};
    const bodyForParsing = req.body ?? reqWithRawBody.rawBody;

    let payload: RevenueCatEvent;
    try {
      payload = parseRevenueCatEvent(bodyForParsing);
    } catch (err) {
      const bodyForDiagnostics = bodyForParsing;
      const bodyType = bodyForDiagnostics === null ? "null" : typeof bodyForDiagnostics;
      const bodyConstructor =
        bodyForDiagnostics !== null && bodyForDiagnostics !== undefined && "constructor" in Object(bodyForDiagnostics) ?
          (Object(bodyForDiagnostics).constructor?.name ?? "unknown") :
          "none";
      const topLevelKeys =
        bodyForDiagnostics && typeof bodyForDiagnostics === "object" && !Buffer.isBuffer(bodyForDiagnostics) ?
          Object.keys(bodyForDiagnostics as Record<string, unknown>).slice(0, 20) :
          [];
      const errMessage = err instanceof Error ? err.message : String(err);
      logger.warn("RevenueCat webhook: failed to parse body", {
        errMessage,
        bodyType,
        bodyConstructor,
        topLevelKeys,
      });
      res.status(400).send("Invalid payload");
      return;
    }

    const {type, app_user_id, product_id, expiration_at_ms, original_transaction_id} =
      payload.event;

    logger.info("Received RevenueCat event", {type, app_user_id, product_id});

    // RevenueCat dashboard test events are connectivity checks and do not need user-side effects.
    if (type === "TEST") {
      res.status(200).json({received: true});
      return;
    }

    try {
      // Resolve Supabase user via Firebase UID → email → Supabase user lookup
      const supabaseUserId = await resolveSupabaseUserId(app_user_id);
      if (!supabaseUserId) {
        logger.warn("RevenueCat webhook: Supabase user not found", {app_user_id, type});
        // Return 200 to prevent RevenueCat from retrying unknowable events
        res.status(200).json({received: true});
        return;
      }

      switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL":
      case "PRODUCT_CHANGE": {
        if (REVENUECAT_PRODUCT_TO_TIER[product_id]) {
          const tier = REVENUECAT_PRODUCT_TO_TIER[product_id];
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ?
            expirationDate.toISOString() : null;
          await upsertUserSubscription(supabaseUserId, APP_NAME, tier, "active", {
            billing_provider_id: original_transaction_id ?? null,
            plan_renewal_at: renewalAt,
          });
          logger.info("RevenueCat: subscription upserted", {
            app_user_id,
            tier,
            type,
          });
        } else if (isRevenueCatCreditPackProduct(product_id)) {
          await callSupabaseRpc("add_user_credits", {
            p_user_id: supabaseUserId,
            p_app_name: APP_NAME,
            p_credit_amount: CREDIT_PACK_AMOUNT,
            p_description: "revenuecat_credit_pack_purchase",
            p_reference_id: original_transaction_id ?? null,
          });
          logger.info("RevenueCat: credits added", {app_user_id, credits: CREDIT_PACK_AMOUNT});
        }
        break;
      }
      case "NON_RENEWING_PURCHASE": {
        if (isRevenueCatCreditPackProduct(product_id)) {
          await callSupabaseRpc("add_user_credits", {
            p_user_id: supabaseUserId,
            p_app_name: APP_NAME,
            p_credit_amount: CREDIT_PACK_AMOUNT,
            p_description: "revenuecat_non_renewing_purchase",
            p_reference_id: original_transaction_id ?? null,
          });
          logger.info("RevenueCat: non-renewing credits added", {app_user_id});
        }
        break;
      }
      case "CANCELLATION": {
        const tier = REVENUECAT_PRODUCT_TO_TIER[product_id] ?? "free";
        await upsertUserSubscription(supabaseUserId, APP_NAME, tier, "cancelled");
        logger.info("RevenueCat: subscription cancelled", {app_user_id, product_id});
        break;
      }
      case "EXPIRATION": {
        const tier = REVENUECAT_PRODUCT_TO_TIER[product_id] ?? "free";
        await upsertUserSubscription(supabaseUserId, APP_NAME, tier, "expired");
        logger.info("RevenueCat: subscription expired", {app_user_id, product_id});
        break;
      }
      default:
        logger.info("RevenueCat: unhandled event type", {type});
      }

      res.status(200).json({received: true});
    } catch (err) {
      logger.error("Error processing RevenueCat webhook", {err, type, app_user_id});
      // Return non-2xx for unexpected processing errors so RevenueCat can retry.
      res.status(500).json({received: false, error: "Internal processing error"});
    }
};

export const revenueCatWebhook = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    secrets: ["REVENUECAT_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY"]
  },
  revenueCatWebhookHandler
);

/**
 * Resolve a Supabase user ID from a Firebase UID.
 * Firebase UID is stored as the RevenueCat app_user_id.
 * We look up the Firebase user by UID to get their email, then
 * find the Supabase user by email.
 */
async function resolveSupabaseUserId(firebaseUid: string): Promise<string | null> {
  let email: string | undefined;
  try {
    const firebaseUser = await admin.auth().getUser(firebaseUid);
    email = firebaseUser.email;
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err ?
      String((err as {code?: unknown}).code) :
      undefined;
    if (code === "auth/user-not-found") {
      logger.warn("resolveSupabaseUserId: Firebase user not found", {firebaseUid});
      return null;
    }
    logger.error("resolveSupabaseUserId: Firebase lookup failed", {firebaseUid, err});
    throw err;
  }

  if (!email) {
    logger.warn("resolveSupabaseUserId: Firebase user has no email", {firebaseUid});
    return null;
  }

  const supabaseUser = await findSupabaseUserByEmail(email);
  return supabaseUser?.id ?? null;
}

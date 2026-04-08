import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import type {Request, Response} from "express";
import {findSupabaseUserByEmail, callSupabaseRpc, upsertUserSubscription} from "./supabaseAdmin.js";

// RevenueCat product identifier → DB tier mapping
const REVENUECAT_PRODUCT_TO_TIER: Record<string, string> = {
  "monthly_20_subscription": "monthly_20",
  "monthly_50_subscription": "monthly_50",
};

const REVENUECAT_CREDIT_PACK_ID = "credit_pack_100";
const CREDIT_PACK_AMOUNT = 100;
const APP_NAME = "clanker";

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
    if (!authHeader || authHeader !== `Bearer ${webhookSecret}`) {
      logger.warn("RevenueCat webhook: invalid Authorization header");
      res.status(401).send("Unauthorized");
      return;
    }

    let payload: RevenueCatEvent;
    try {
      payload = req.body as RevenueCatEvent;
      if (!payload?.event?.type) {
        throw new Error("Missing event.type");
      }
    } catch (err) {
      logger.warn("RevenueCat webhook: failed to parse body", {err});
      res.status(400).send("Invalid payload");
      return;
    }

    const {type, app_user_id, product_id, expiration_at_ms, original_transaction_id} =
      payload.event;

    logger.info("Received RevenueCat event", {type, app_user_id, product_id});

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
          const renewalAt = expiration_at_ms ?
            new Date(expiration_at_ms).toISOString() : null;
          await upsertUserSubscription(supabaseUserId, APP_NAME, tier, "active", {
            billing_provider_id: original_transaction_id ?? null,
            plan_renewal_at: renewalAt,
          });
          logger.info("RevenueCat: subscription upserted", {
            app_user_id,
            tier,
            type,
          });
        } else if (product_id === REVENUECAT_CREDIT_PACK_ID) {
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
        if (product_id === REVENUECAT_CREDIT_PACK_ID) {
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
  // Dynamically import firebase-admin to avoid circular init issues
  const adminModule = await import("firebase-admin");
  const admin = adminModule.default || adminModule;
  if (!admin.apps?.length) {
    admin.initializeApp();
  }

  let email: string | undefined;
  try {
    const firebaseUser = await admin.auth().getUser(firebaseUid);
    email = firebaseUser.email;
  } catch (err) {
    logger.error("resolveSupabaseUserId: Firebase user not found", {firebaseUid, err});
    return null;
  }

  if (!email) {
    logger.warn("resolveSupabaseUserId: Firebase user has no email", {firebaseUid});
    return null;
  }

  const supabaseUser = await findSupabaseUserByEmail(email);
  return supabaseUser?.id ?? null;
}

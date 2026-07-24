import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import {timingSafeEqual} from "crypto";
import type {Request, Response} from "express";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {creditService} from "./services/creditService.js";
import {CLOUD_SQL_SECRETS} from "./cloudSqlSecrets.js";
import {CREDIT_PACK_AMOUNT, CREDIT_PACK_EXPIRY_MS, SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT} from "./constants/credits.js";
import {sendPurchaseEvent as sendGa4PurchaseEvent, sendRefundEvent as sendGa4RefundEvent} from "./services/ga4MeasurementService.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

// RevenueCat product identifier → DB tier mapping
const REVENUECAT_PRODUCT_TO_TIER: Record<string, "monthly_20" | "monthly_50"> = {
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

export interface RevenueCatUpsertParams {
  userId: string;
  planTier: "free" | "monthly_20" | "monthly_50" | "payg";
  planStatus: "active" | "cancelled" | "expired";
  renewalAt?: Date | null;
  subscriptionProvider?: "stripe" | "revenuecat" | null;
  cancelAtPeriodEnd?: boolean;
}

interface ExistingSubscriptionLookup {
  planTier: string;
  planStatus: string;
  subscriptionProvider: string | null;
}

interface RevenueCatDeps {
  findUserByFirebaseUid: (firebaseUid: string) => Promise<{id: string} | null>;
  getOrCreateUserByFirebaseUid?: (firebaseUid: string) => Promise<{id: string} | null>;
  getSubscription: (userId: string) => Promise<ExistingSubscriptionLookup | null>;
  upsertSubscription: (params: RevenueCatUpsertParams) => Promise<void>;
  renewSubscriptionCredits: (userId: string, amount: number, expiresAt: Date, referenceId: string) => Promise<boolean>;
  addCredits: (userId: string, amount: number, expiresAt: Date | null, transactionType: 'one_time' | 'signup' | 'legacy', referenceId?: string) => Promise<void>;
  adjustCredits: (userId: string, delta: number, reason: string, referenceId?: string) => Promise<void>;
  sendPurchaseEvent: (params: {firebaseUid: string; transactionId: string; value?: number; currency: string; paymentProvider: "revenuecat"; items?: Array<{item_id: string; item_name: string}>; store?: string; periodType?: string}) => Promise<void>;
  sendRefundEvent: (params: {firebaseUid: string; transactionId: string; value?: number; currency: string; paymentProvider: "revenuecat"; items?: Array<{item_id: string; item_name: string}>; store?: string; periodType?: string}) => Promise<void>;
}

const defaultDeps: RevenueCatDeps = {
  async findUserByFirebaseUid(firebaseUid: string) {
    const user = await userRepository.findUserByFirebaseUid(firebaseUid);
    return user ? {id: user.id} : null;
  },
  async getOrCreateUserByFirebaseUid(firebaseUid: string) {
    try {
      const firebaseUser = await admin.auth().getUser(firebaseUid);
      const email = firebaseUser.email;

      if (!email) {
        logger.warn("RevenueCat webhook: Firebase user has no email", {firebaseUid});
        return null;
      }

      const user = await userRepository.getOrCreateUserByFirebaseIdentity({
        firebaseUid,
        email,
        displayName: firebaseUser.displayName ?? null,
        avatarUrl: firebaseUser.photoURL ?? null,
      });
      return {id: user.id};
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as {code?: unknown}).code === "auth/user-not-found"
      ) {
        logger.warn("RevenueCat webhook: Firebase user not found", {firebaseUid});
        return null;
      }

      throw err;
    }
  },
  async upsertSubscription(params: RevenueCatUpsertParams) {
    await subscriptionService.upsertSubscription({
      userId: params.userId,
      planTier: params.planTier,
      planStatus: params.planStatus,
      billingCycleEnd: params.renewalAt,
      subscriptionProvider: params.subscriptionProvider,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    });
  },
  async getSubscription(userId: string) {
    const sub = await subscriptionService.getSubscription(userId);
    if (!sub) return null;
    return {
      planTier: sub.planTier,
      planStatus: sub.planStatus,
      subscriptionProvider: sub.subscriptionProvider,
    };
  },
  async renewSubscriptionCredits(userId: string, amount: number, expiresAt: Date, referenceId: string) {
    return creditService.renewSubscriptionCredits(userId, amount, expiresAt, referenceId);
  },
  async addCredits(userId: string, amount: number, expiresAt: Date | null, transactionType: 'one_time' | 'signup' | 'legacy', referenceId?: string) {
    await creditService.addCredits(userId, amount, expiresAt, transactionType, referenceId);
  },
  async adjustCredits(userId: string, delta: number, reason: string, referenceId?: string) {
    await creditService.adjustCredits(userId, delta, reason, referenceId);
  },
  async sendPurchaseEvent(params) {
    await sendGa4PurchaseEvent(params);
  },
  async sendRefundEvent(params) {
    await sendGa4RefundEvent(params);
  },
};

function isRevenueCatCreditPackProduct(productId: string): boolean {
  return REVENUECAT_CREDIT_PACK_IDS.has(normalizeRevenueCatProductId(productId));
}

function normalizeRevenueCatProductId(productId: string): string {
  const trimmedProductId = productId.trim();
  const separatorIndex = trimmedProductId.indexOf(":");
  if (separatorIndex === -1) {
    return trimmedProductId;
  }

  return trimmedProductId.slice(0, separatorIndex);
}

// Resolve the transaction id used to key GA4 revenue events. Prefer RC's transaction_id,
// fall back to the per-cycle key for renewals.
function resolveGa4TransactionId(event: RevenueCatEvent["event"]): string | undefined {
  if (event.transaction_id) return event.transaction_id;
  if (event.original_transaction_id && typeof event.expiration_at_ms === "number") {
    return `${event.original_transaction_id}_${event.expiration_at_ms}`;
  }
  return undefined;
}

// Fire a GA4 purchase event from RC data. Never throws (isolation) and never guesses revenue.
async function emitRevenueCatPurchase(
  deps: RevenueCatDeps,
  event: RevenueCatEvent["event"],
  productName: string,
): Promise<void> {
  const transactionId = resolveGa4TransactionId(event);
  if (!transactionId || typeof event.price_in_purchased_currency !== "number" || !event.currency) {
    logger.info("RevenueCat: insufficient data for GA4 purchase, skipping", {
      app_user_id: event.app_user_id, product_id: event.product_id,
    });
    return;
  }
  try {
    await deps.sendPurchaseEvent({
      firebaseUid: event.app_user_id,
      transactionId,
      value: event.price_in_purchased_currency,
      currency: event.currency,
      paymentProvider: "revenuecat",
      items: [{item_id: normalizeRevenueCatProductId(event.product_id), item_name: productName}],
      ...(event.store ? {store: event.store} : {}),
      ...(event.period_type ? {periodType: event.period_type} : {}),
    });
  } catch (err) {
    logger.error("RevenueCat: GA4 purchase emission failed (ignored)", {err, transactionId});
  }
}

// Fire a GA4 refund event from RC data. Never throws (isolation) and never guesses revenue.
async function emitRevenueCatRefund(
  deps: RevenueCatDeps,
  event: RevenueCatEvent["event"],
  productName: string,
): Promise<void> {
  const transactionId = resolveGa4TransactionId(event);
  if (!transactionId || typeof event.price_in_purchased_currency !== "number" || !event.currency) {
    logger.info("RevenueCat: insufficient data for GA4 refund, skipping", {
      app_user_id: event.app_user_id, product_id: event.product_id,
    });
    return;
  }
  try {
    await deps.sendRefundEvent({
      firebaseUid: event.app_user_id,
      transactionId,
      value: event.price_in_purchased_currency,
      currency: event.currency,
      paymentProvider: "revenuecat",
      items: [{item_id: normalizeRevenueCatProductId(event.product_id), item_name: productName}],
      ...(event.store ? {store: event.store} : {}),
      ...(event.period_type ? {periodType: event.period_type} : {}),
    });
  } catch (err) {
    logger.error("RevenueCat: GA4 refund emission failed (ignored)", {err, transactionId});
  }
}

// Shape of RevenueCat webhook event payload (abbreviated)
interface RevenueCatEvent {
  event: {
    type: string;
    app_user_id: string; // Firebase UID
    product_id: string;
    expiration_at_ms?: number;
    original_transaction_id?: string;
    environment?: string;
    cancel_reason?: string;
    store?: string;
    transaction_id?: string;
    purchased_at_ms?: number;
    period_type?: string;
    price?: number;
    price_in_purchased_currency?: number;
    currency?: string;
    country_code?: string;
    transferred_from?: unknown;
    transferred_to?: unknown;
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
      // Only attempt form parse if the text looks like form data (contains = or &).
      const looksLikeFormData = trimmed.includes("=") || trimmed.includes("&");
      if (looksLikeFormData) {
        const params = new URLSearchParams(trimmed);
        if (params.has("event")) {
          const eventParam = params.get("event");
          if (eventParam === null) {
            throw new Error("Invalid form event payload");
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

  const optionalString = (raw: unknown, field: string): string | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "string") throw new Error(`Invalid event.${field}`);
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };
  const optionalNumber = (raw: unknown, field: string): number | undefined => {
    if (raw === undefined || raw === null) return undefined;
    if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error(`Invalid event.${field}`);
    return raw;
  };

  const environment = optionalString(event.environment, "environment");
  const cancelReason = optionalString(event.cancel_reason, "cancel_reason");
  const store = optionalString(event.store, "store");
  const transactionId = optionalString(event.transaction_id, "transaction_id");
  const purchasedAtMs = optionalNumber(event.purchased_at_ms, "purchased_at_ms");
  const periodType = optionalString(event.period_type, "period_type");
  const price = optionalNumber(event.price, "price");
  const priceInPurchasedCurrency = optionalNumber(event.price_in_purchased_currency, "price_in_purchased_currency");
  const currency = optionalString(event.currency, "currency");
  const countryCode = optionalString(event.country_code, "country_code");
  const transferredFrom = event.transferred_from;
  const transferredTo = event.transferred_to;

  return {
    event: {
      type,
      app_user_id: appUserId,
      product_id: productId,
      ...(expirationAtMs !== undefined && expirationAtMs !== null ?
        {expiration_at_ms: expirationAtMs} : {}),
      ...(normalizedOriginalTransactionId && normalizedOriginalTransactionId.length > 0 ?
        {original_transaction_id: normalizedOriginalTransactionId} : {}),
      ...(environment !== undefined ? {environment} : {}),
      ...(cancelReason !== undefined ? {cancel_reason: cancelReason} : {}),
      ...(store !== undefined ? {store} : {}),
      ...(transactionId !== undefined ? {transaction_id: transactionId} : {}),
      ...(purchasedAtMs !== undefined ? {purchased_at_ms: purchasedAtMs} : {}),
      ...(periodType !== undefined ? {period_type: periodType} : {}),
      ...(price !== undefined ? {price} : {}),
      ...(priceInPurchasedCurrency !== undefined ? {price_in_purchased_currency: priceInPurchasedCurrency} : {}),
      ...(currency !== undefined ? {currency} : {}),
      ...(countryCode !== undefined ? {country_code: countryCode} : {}),
      ...(transferredFrom !== undefined ? {transferred_from: transferredFrom} : {}),
      ...(transferredTo !== undefined ? {transferred_to: transferredTo} : {}),
    },
  };
}

export const revenueCatWebhookHandler = async (
  req: Request,
  res: Response,
  deps: RevenueCatDeps = defaultDeps
) => {
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
    const bearerMatch = typeof normalizedHeader === "string" ?
      normalizedHeader.match(/^Bearer\s+/i) :
      null;
    const providedSecret =
      typeof normalizedHeader === "string" && bearerMatch
        ? normalizedHeader.slice(bearerMatch[0].length)
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

    const rcEvent = payload.event;
    const {type, app_user_id, product_id, expiration_at_ms, original_transaction_id, transaction_id, environment, cancel_reason} =
      payload.event;
    const normalizedProductId = normalizeRevenueCatProductId(product_id);

    logger.info("Received RevenueCat event", {
      type,
      app_user_id,
      product_id,
      normalized_product_id: normalizedProductId,
    });

    // RevenueCat dashboard test events are connectivity checks and do not need user-side effects.
    if (type === "TEST") {
      res.status(200).json({received: true});
      return;
    }

    // Sandbox / TestFlight purchases must never grant production entitlements.
    // Respond 200 so RevenueCat does not retry.
    if (environment === "SANDBOX") {
      logger.info("RevenueCat webhook: ignoring sandbox event", {type, app_user_id, product_id});
      res.status(200).json({received: true, ignored: "sandbox"});
      return;
    }

    try {
      let cloudUser = await deps.findUserByFirebaseUid(app_user_id);
      if (!cloudUser && deps.getOrCreateUserByFirebaseUid) {
        cloudUser = await deps.getOrCreateUserByFirebaseUid(app_user_id);
      }

      if (!cloudUser) {
        logger.warn("RevenueCat webhook: Cloud SQL user not found", {app_user_id, type});
        // Return non-2xx so RevenueCat can retry once user identity is available.
        res.status(503).json({received: false, error: "Cloud SQL user not ready"});
        return;
      }

      switch (type) {
      case "INITIAL_PURCHASE":
      case "RENEWAL": {
        if (REVENUECAT_PRODUCT_TO_TIER[normalizedProductId]) {
          const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;

          const existingSubscription = await deps.getSubscription(cloudUser.id);
          if (
            existingSubscription &&
            existingSubscription.subscriptionProvider === "stripe" &&
            existingSubscription.planStatus === "active" &&
            existingSubscription.planTier !== "free"
          ) {
            logger.warn("billing_provider_collision: RevenueCat purchase granted while an active Stripe subscription exists", {
              app_user_id,
              existingTier: existingSubscription.planTier,
              newTier: tier,
            });
          }

          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: tier,
            planStatus: "active",
            renewalAt,
            subscriptionProvider: "revenuecat",
            cancelAtPeriodEnd: false,
          });

          if (renewalAt && original_transaction_id && typeof expiration_at_ms === 'number') {
            // Use a per-cycle key: original_transaction_id alone would block all future renewals
            // since it is stable for the lifetime of the subscription.
            const referenceId = `${original_transaction_id}_${expiration_at_ms}`;
            await deps.renewSubscriptionCredits(cloudUser.id, SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT, renewalAt, referenceId);
          }

          logger.info("RevenueCat: subscription upserted + credits renewed", {
            app_user_id,
            tier,
            type,
          });
          await emitRevenueCatPurchase(deps, rcEvent, tier);
        } else if (isRevenueCatCreditPackProduct(product_id)) {
          if (!original_transaction_id) {
            logger.warn("RevenueCat: credit-pack event missing original_transaction_id, rejecting so RevenueCat retries", {
              app_user_id,
              product_id,
              type,
            });
            res.status(503).json({received: false, error: "Missing original_transaction_id"});
            return;
          }
          const expiresAt = new Date(Date.now() + CREDIT_PACK_EXPIRY_MS);
          await deps.addCredits(
            cloudUser.id,
            CREDIT_PACK_AMOUNT,
            expiresAt,
            'one_time',
            original_transaction_id
          );
          logger.info("RevenueCat: credits added", {app_user_id, credits: CREDIT_PACK_AMOUNT});
          await emitRevenueCatPurchase(deps, rcEvent, "Credit Pack");
        }
        break;
      }
      case "PRODUCT_CHANGE": {
        if (REVENUECAT_PRODUCT_TO_TIER[normalizedProductId]) {
          const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;

          const existingSubscription = await deps.getSubscription(cloudUser.id);
          if (
            existingSubscription &&
            existingSubscription.subscriptionProvider === "stripe" &&
            existingSubscription.planStatus === "active" &&
            existingSubscription.planTier !== "free"
          ) {
            logger.warn("billing_provider_collision: RevenueCat product change granted while an active Stripe subscription exists", {
              app_user_id,
              existingTier: existingSubscription.planTier,
              newTier: tier,
            });
          }

          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: tier,
            planStatus: "active",
            renewalAt,
            subscriptionProvider: "revenuecat",
            cancelAtPeriodEnd: false,
          });

          // No credit renewal on plan change — credits are granted on RENEWAL events.
          // Granting here would double-credit users who change plans mid-cycle.
          logger.info("RevenueCat: subscription product change upserted", {
            app_user_id,
            tier,
            type,
          });
        }
        break;
      }
      case "NON_RENEWING_PURCHASE": {
        if (isRevenueCatCreditPackProduct(product_id)) {
          if (!original_transaction_id) {
            logger.warn("RevenueCat: non-renewing credit-pack event missing original_transaction_id, rejecting so RevenueCat retries", {
              app_user_id,
              product_id,
              type,
            });
            res.status(503).json({received: false, error: "Missing original_transaction_id"});
            return;
          }
          const expiresAt = new Date(Date.now() + CREDIT_PACK_EXPIRY_MS);
          await deps.addCredits(
            cloudUser.id,
            CREDIT_PACK_AMOUNT,
            expiresAt,
            'one_time',
            original_transaction_id
          );
          logger.info("RevenueCat: non-renewing credits added", {app_user_id});
          await emitRevenueCatPurchase(deps, rcEvent, "Credit Pack");
        }
        break;
      }
      case "CANCELLATION": {
        const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
        if (tier) {
          if (cancel_reason === "CUSTOMER_SUPPORT") {
            // Refund: downgrade immediately and claw back this cycle's renewal credits.
            await deps.upsertSubscription({
              userId: cloudUser.id,
              planTier: "free",
              planStatus: "cancelled",
              subscriptionProvider: null,
              cancelAtPeriodEnd: false,
            });
            // Clawback key: prefer the per-cycle key used to grant renewal credits
            // (`${original_transaction_id}_${expiration_at_ms}`, see INITIAL_PURCHASE/RENEWAL).
            // Some store refunds void the sub immediately and omit `expiration_at_ms`; fall
            // back to `transaction_id` so the clawback still fires (still deterministic +
            // idempotent via the `_refund` suffix). Only skip if we have no key at all.
            const clawbackKey =
              typeof expiration_at_ms === "number" ? String(expiration_at_ms) :
              transaction_id ? String(transaction_id) : null;
            if (original_transaction_id && clawbackKey) {
              const referenceId = `${original_transaction_id}_${clawbackKey}_refund`;
              await deps.adjustCredits(
                cloudUser.id,
                -SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT,
                "revenuecat_refund",
                referenceId
              );
            } else {
              logger.warn("RevenueCat: subscription refund missing both expiration_at_ms and transaction_id, cannot claw back", {app_user_id, product_id, tier});
            }
            await emitRevenueCatRefund(deps, rcEvent, tier);
            logger.info("RevenueCat: subscription refund — downgraded and clawed back", {app_user_id, product_id, tier});
          } else {
            // Benign auto-renew-off: entitlement stays active until EXPIRATION.
            const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
              new Date(expiration_at_ms) : null;
            const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;
            await deps.upsertSubscription({
              userId: cloudUser.id,
              planTier: tier,
              planStatus: "active",
              renewalAt,
              subscriptionProvider: "revenuecat",
              cancelAtPeriodEnd: true,
            });
            logger.info("RevenueCat: subscription cancellation recorded (auto-renew off, entitlement still active)", {
              app_user_id, product_id, tier,
            });
          }
        } else if (isRevenueCatCreditPackProduct(product_id)) {
          // A credit-pack "cancellation" is a pack refund. Deduct the granted pack credits
          // (floored at zero by syncSubscriptionCache) and leave the subscription row alone.
          if (original_transaction_id) {
            await deps.adjustCredits(
              cloudUser.id,
              -CREDIT_PACK_AMOUNT,
              "revenuecat_refund",
              `${original_transaction_id}_refund`
            );
            await emitRevenueCatRefund(deps, rcEvent, "Credit Pack");
            logger.info("RevenueCat: credit-pack refund deducted", {app_user_id, product_id, credits: CREDIT_PACK_AMOUNT});
          } else {
            logger.warn("RevenueCat: credit-pack cancellation missing original_transaction_id, cannot deduct", {app_user_id, product_id});
          }
        } else {
          // Neither a known tier nor a known pack — log only, never downgrade.
          logger.warn("RevenueCat: cancellation for unknown product, no state change", {app_user_id, product_id});
        }
        break;
      }
      case "EXPIRATION": {
        if (REVENUECAT_PRODUCT_TO_TIER[normalizedProductId]) {
          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: "free",
            planStatus: "expired",
            subscriptionProvider: null,
            cancelAtPeriodEnd: false,
          });
          logger.info("RevenueCat: subscription expired", {app_user_id, product_id});
        } else {
          logger.info("RevenueCat: expiration for non-subscription product, no state change", {app_user_id, product_id});
        }
        break;
      }
      case "UNCANCELLATION": {
        const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
        if (tier) {
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;
          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: tier,
            planStatus: "active",
            renewalAt,
            subscriptionProvider: "revenuecat",
            cancelAtPeriodEnd: false,
          });
          logger.info("RevenueCat: uncancellation — auto-renew re-enabled", {app_user_id, product_id, tier});
        } else {
          logger.info("RevenueCat: uncancellation for non-subscription product, no state change", {app_user_id, product_id});
        }
        break;
      }
      case "BILLING_ISSUE": {
        // Grace period: entitlement stays active until EXPIRATION. Log for visibility.
        logger.warn("RevenueCat: billing issue (grace period, entitlement still active)", {app_user_id, product_id});
        break;
      }
      case "TRANSFER": {
        // Full re-pointing of entitlements between users is backlog; make occurrences visible.
        logger.warn("RevenueCat: TRANSFER event received (not fully handled)", {
          app_user_id, product_id,
          transferredFrom: payload.event.transferred_from,
          transferredTo: payload.event.transferred_to,
        });
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
    secrets: [...CLOUD_SQL_SECRETS, "REVENUECAT_WEBHOOK_SECRET", "GA4_MEASUREMENT_ID", "GA4_MP_API_SECRET"]
  },
  revenueCatWebhookHandler
);

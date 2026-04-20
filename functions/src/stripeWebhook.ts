import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import Stripe from "stripe";
import type {Request, Response} from "express";
import {getStripePriceIds} from "./runtimeConfig.js";
import {validateAndNormalizeStripeSecretKey} from "./stripeConfig.js";
import {userRepository} from "./services/userRepository.js";
import {subscriptionService} from "./services/subscriptionService.js";
import {creditService} from "./services/creditService.js";
import {CLOUD_SQL_SECRETS} from "./cloudSqlSecrets.js";
import type {UpsertSubscriptionParams} from "./services/subscriptionService.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const CREDIT_PACK_AMOUNT = 100;

type UserLookup = {
  id: string;
  email: string;
};

interface StripeWebhookDeps {
  findUserByEmail: (email: string) => Promise<UserLookup | null>;
  findUserByFirebaseUid: (firebaseUid: string) => Promise<UserLookup | null>;
  upsertSubscription: (params: UpsertSubscriptionParams) => Promise<void>;
  addCredits: (userId: string, amount: number, reason: string, referenceId?: string) => Promise<void>;
  adjustCredits: (userId: string, delta: number, reason: string, referenceId?: string) => Promise<void>;
}

const defaultDeps: StripeWebhookDeps = {
  async findUserByEmail(email: string) {
    const user = await userRepository.findUserByEmail(email);
    if (!user) {
      return null;
    }
    return {id: user.id, email: user.email};
  },
  async findUserByFirebaseUid(firebaseUid: string) {
    const user = await userRepository.findUserByFirebaseUid(firebaseUid);
    if (!user) {
      return null;
    }
    return {id: user.id, email: user.email};
  },
  async upsertSubscription(params: UpsertSubscriptionParams) {
    await subscriptionService.upsertSubscription(params);
  },
  async addCredits(userId: string, amount: number, reason: string, referenceId?: string) {
    await creditService.addCredits(userId, amount, reason, referenceId);
  },
  async adjustCredits(userId: string, delta: number, reason: string, referenceId?: string) {
    await creditService.adjustCredits(userId, delta, reason, referenceId);
  },
};

type StripeExpandableId = string | {id?: string} | null | undefined;
type StripePriceIds = {
  monthly20: string;
  monthly50: string;
  creditPack: string;
};

type StripeWebhookRequest = Request & {rawBody: Buffer};

function getStripeId(value: StripeExpandableId): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function getRequiredStripePriceIds(): StripePriceIds {
  const {monthly20, monthly50, creditPack} = getStripePriceIds();
  const missing: string[] = [];

  if (!monthly20) missing.push("STRIPE_MONTHLY_20_PRICE_ID");
  if (!monthly50) missing.push("STRIPE_MONTHLY_50_PRICE_ID");
  if (!creditPack) missing.push("STRIPE_CREDIT_PACK_PRICE_ID");

  if (missing.length > 0) {
    logger.error("Missing Stripe price ID configuration", {missing});
    throw new Error(`Missing required Stripe price IDs: ${missing.join(", ")}`);
  }

  return {
    monthly20: monthly20 as string,
    monthly50: monthly50 as string,
    creditPack: creditPack as string,
  };
}

function getTierByPriceId(
  priceId: string,
  priceIds: StripePriceIds
): "monthly_20" | "monthly_50" | undefined {
  const {monthly20, monthly50} = priceIds;
  if (priceId === monthly20) return "monthly_20";
  if (priceId === monthly50) return "monthly_50";
  return undefined;
}

function isCreditPackPriceId(priceId: string | undefined, priceIds: StripePriceIds): boolean {
  if (!priceId) return false;
  const {creditPack} = priceIds;
  return priceId === creditPack;
}

export function getInvoiceLineItemPriceId(item: Stripe.InvoiceLineItem): string | undefined {
  const priceRef = item.pricing?.price_details?.price;
  if (typeof priceRef === "string") {
    return priceRef;
  }
  return priceRef?.id;
}

export function getCreditPackQuantityFromInvoice(
  invoice: Stripe.Invoice,
  priceIds: StripePriceIds
): number {
  let quantity = 0;
  for (const item of invoice.lines.data) {
    const priceId = getInvoiceLineItemPriceId(item);
    if (isCreditPackPriceId(priceId, priceIds)) {
      quantity += item.quantity ?? 1;
    }
  }
  return quantity;
}

function getStripeClient(): Stripe {
  const secretKey = validateAndNormalizeStripeSecretKey(process.env.STRIPE_SECRET_KEY);

  return new Stripe(secretKey);
}

export function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status):
"active" | "cancelled" | "expired" {
  switch (status) {
  case "active":
  case "trialing":
  case "past_due":
  case "unpaid":
  case "incomplete":
    return "active";
  case "canceled":
    return "cancelled";
  case "incomplete_expired":
  case "paused":
    return "expired";
  default:
    logger.warn("customer.subscription.updated: unknown Stripe status", {status});
    return "active";
  }
}

export const stripeWebhookHandler = async (
  req: StripeWebhookRequest,
  res: Response,
  deps: StripeWebhookDeps = defaultDeps
) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error("STRIPE_WEBHOOK_SECRET is not configured");
    res.status(500).send("Webhook secret not configured");
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string" || sig.trim().length === 0) {
    logger.warn("Missing or invalid stripe-signature header", {
      headerType: Array.isArray(sig) ? "array" : typeof sig,
    });
    res.status(400).send("Missing or invalid Stripe signature header");
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    logger.error("STRIPE_SECRET_KEY is not configured", {err});
    res.status(500).send("Stripe configuration error");
    return;
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      webhookSecret
    );
  } catch (err) {
    logger.warn("Stripe signature verification failed", {err});
    res.status(400).send("Webhook signature verification failed");
    return;
  }

  logger.info("Received Stripe event", {type: event.type, id: event.id});

  try {
    const priceIds = getRequiredStripePriceIds();

    switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(stripe, session, priceIds, deps);
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdated(sub, stripe, priceIds, deps);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(sub, stripe, priceIds, deps);
      break;
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      await handleInvoicePaymentSucceeded(stripe, invoice, priceIds, deps);
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      await handleChargeRefunded(stripe, charge, priceIds, deps);
      break;
    }
    default:
      logger.info("Unhandled Stripe event type", {type: event.type});
    }

    res.status(200).json({received: true});
  } catch (err) {
    logger.error("Error processing Stripe webhook", {err, eventType: event.type});
    // Return a non-2xx status for unexpected processing failures so Stripe retries.
    res.status(500).json({received: false, error: "Processing error logged"});
  }
};

export const stripeWebhook = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    secrets: [
      ...CLOUD_SQL_SECRETS,
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]
  },
  stripeWebhookHandler
);

async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
  priceIds: StripePriceIds,
  deps: StripeWebhookDeps
): Promise<void> {
  const customerEmail = session.customer_details?.email ?? session.customer_email;

  // Primary lookup: by email
  let user = customerEmail
    ? await deps.findUserByEmail(customerEmail)
    : null;

  // Fallback: resolve via Firebase UID set in client_reference_id
  if (!user && session.client_reference_id) {
    user = await deps.findUserByFirebaseUid(session.client_reference_id);
  }

  if (!user) {
    logger.warn("checkout.session.completed: Cloud SQL user not found", {
      customerEmail,
      clientReferenceId: session.client_reference_id,
    });
    return;
  }

  // Expand line items to get price IDs
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {limit: 10});

  for (const item of lineItems.data) {
    const priceId = item.price?.id;
    if (!priceId) continue;

    const tier = getTierByPriceId(priceId, priceIds);
    if (tier) {
      // Subscription product → upsert subscription row
      const subscriptionId = getStripeId(session.subscription as StripeExpandableId);
      const customerId = getStripeId(session.customer as StripeExpandableId);
      await deps.upsertSubscription({
        userId: user.id,
        planTier: tier,
        planStatus: "active",
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: customerId,
      });
      logger.info("checkout.session.completed: subscription upserted", {
        email: customerEmail,
        tier,
      });
    } else if (isCreditPackPriceId(priceId, priceIds)) {
      // Credit pack → add credits
      const qty = item.quantity ?? 1;
      await deps.addCredits(
        user.id,
        CREDIT_PACK_AMOUNT * qty,
        "stripe_credit_pack_purchase",
        session.id
      );
      logger.info("checkout.session.completed: credits added", {
        email: customerEmail,
        credits: CREDIT_PACK_AMOUNT * qty,
      });
    }
  }
}

async function handleSubscriptionUpdated(
  sub: Stripe.Subscription,
  stripe: Stripe,
  priceIds: StripePriceIds,
  deps: StripeWebhookDeps
): Promise<void> {
  const customerId = getStripeId(sub.customer as StripeExpandableId);
  if (!customerId) {
    logger.warn("customer.subscription.updated: missing customer id", {subId: sub.id});
    return;
  }
  // Get price ID from the first subscription item
  const priceId = sub.items.data[0]?.price?.id;
  if (!priceId) return;

  const tier = getTierByPriceId(priceId, priceIds);
  if (!tier) {
    logger.info("customer.subscription.updated: unknown price, skipping", {priceId});
    return;
  }

  // Fetch customer to get their email
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || !customer.email) {
    logger.warn("customer.subscription.updated: no customer email", {customerId});
    return;
  }

  const user = await deps.findUserByEmail(customer.email);
  if (!user) return;

  const planStatus = mapStripeSubscriptionStatus(sub.status);

  await deps.upsertSubscription({
    userId: user.id,
    planTier: tier,
    planStatus,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
  });

  logger.info("customer.subscription.updated: subscription synced", {
    email: customer.email,
    tier,
    planStatus,
  });
}

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  stripe: Stripe,
  priceIds: StripePriceIds,
  deps: StripeWebhookDeps
): Promise<void> {
  const customerId = getStripeId(sub.customer as StripeExpandableId);
  if (!customerId) {
    logger.warn("customer.subscription.deleted: missing customer id", {subId: sub.id});
    return;
  }
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || !customer.email) {
    logger.warn("customer.subscription.deleted: no customer email", {subId: sub.id});
    return;
  }

  const user = await deps.findUserByEmail(customer.email);
  if (!user) return;

  const priceId = sub.items.data[0]?.price?.id;
  const resolvedTier = priceId ? getTierByPriceId(priceId, priceIds) : undefined;
  const tier = resolvedTier ?? "free";

  await deps.upsertSubscription({
    userId: user.id,
    planTier: tier,
    planStatus: "cancelled",
    stripeSubscriptionId: sub.id,
  });

  logger.info("customer.subscription.deleted: subscription cancelled", {
    email: customer.email,
  });
}

async function handleInvoicePaymentSucceeded(
  stripe: Stripe,
  invoice: Stripe.Invoice,
  priceIds: StripePriceIds,
  deps: StripeWebhookDeps
): Promise<void> {
  // Only handle non-subscription invoices (one-time PAYG credit pack purchases)
  const subscriptionId = invoice.parent?.subscription_details?.subscription;
  if (subscriptionId || !invoice.customer_email) return;

  const user = await deps.findUserByEmail(invoice.customer_email);
  if (!user) return;

  // Check if any line item is a credit pack.
  for (const item of invoice.lines.data) {
    const priceId = getInvoiceLineItemPriceId(item);
    if (isCreditPackPriceId(priceId, priceIds)) {
      const qty = item.quantity ?? 1;
      await deps.addCredits(
        user.id,
        CREDIT_PACK_AMOUNT * qty,
        "stripe_invoice_payment",
        invoice.id
      );
      logger.info("invoice.payment_succeeded: credits added", {
        email: invoice.customer_email,
        credits: CREDIT_PACK_AMOUNT * qty,
      });
    }
  }
}

async function handleChargeRefunded(
  stripe: Stripe,
  charge: Stripe.Charge,
  priceIds: StripePriceIds,
  deps: StripeWebhookDeps
): Promise<void> {
  const customerEmail = charge.billing_details?.email;
  if (!customerEmail) {
    logger.warn("charge.refunded: no customer email", {chargeId: charge.id});
    return;
  }

  const user = await deps.findUserByEmail(customerEmail);
  if (!user) return;

  let creditPackQty = 0;
  let isSubscriptionRefund = false;
  type ChargeWithInvoice = {invoice?: string | {id: string}};
  const invoiceRef = (charge as unknown as ChargeWithInvoice).invoice;

  if (invoiceRef) {
    const invoiceId = typeof invoiceRef === "string" ? invoiceRef : invoiceRef.id;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    isSubscriptionRefund = !!invoice.parent?.subscription_details?.subscription;
    creditPackQty = getCreditPackQuantityFromInvoice(invoice, priceIds);
  }

  // Backward-compatible fallback for older charges that may have metadata set directly.
  if (creditPackQty === 0 && isCreditPackPriceId(charge.metadata?.price_id, priceIds)) {
    creditPackQty = Number(charge.metadata?.quantity ?? 1);
  }

  if (creditPackQty > 0) {
    await deps.adjustCredits(
      user.id,
      -(CREDIT_PACK_AMOUNT * creditPackQty),
      "stripe_refund",
      charge.id
    );
    logger.info("charge.refunded: credits deducted", {
      email: customerEmail,
      credits: CREDIT_PACK_AMOUNT * creditPackQty,
    });
  } else if (isSubscriptionRefund) {
    // For subscription refunds, cancel the subscription
    await deps.upsertSubscription({
      userId: user.id,
      planTier: "free",
      planStatus: "cancelled",
    });
    logger.info("charge.refunded: subscription cancelled", {email: customerEmail});
  } else {
    logger.warn("charge.refunded: unable to classify refund", {
      email: customerEmail,
      chargeId: charge.id,
      invoice: typeof invoiceRef === "string" ? invoiceRef : invoiceRef?.id,
    });
  }
}

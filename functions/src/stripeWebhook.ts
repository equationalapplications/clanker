import {onRequest} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import Stripe from "stripe";
import {getStripePriceIds} from "./runtimeConfig.js";
import {
  findSupabaseUserByEmail, callSupabaseRpc, upsertUserSubscription, findSupabaseUserByFirebaseUid,
} from "./supabaseAdmin.js";

// Initialize the Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const CREDIT_PACK_AMOUNT = 100;
const APP_NAME = "clanker";

type StripeExpandableId = string | {id?: string} | null | undefined;

function getStripeId(value: StripeExpandableId): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && typeof value.id === "string") return value.id;
  return null;
}

function getTierByPriceId(priceId: string): string | undefined {
  const {monthly20, monthly50} = getStripePriceIds();
  const monthly20PriceId = monthly20 || "price_TODO_monthly_20";
  const monthly50PriceId = monthly50 || "price_TODO_monthly_50";

  if (priceId === monthly20PriceId) return "monthly_20";
  if (priceId === monthly50PriceId) return "monthly_50";
  return undefined;
}

function isCreditPackPriceId(priceId?: string): boolean {
  if (!priceId) return false;
  const {creditPack} = getStripePriceIds();
  const expectedPriceId = creditPack || "price_TODO_credit_pack";
  return priceId === expectedPriceId;
}

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set");
  }
  return new Stripe(secretKey, {apiVersion: "2026-02-25.clover"});
}

export const stripeWebhook = onRequest(
  {
    region: "us-central1",
    secrets: [
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]
  },
  async (req, res) => {
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

    const stripe = getStripeClient();
    const sig = req.headers["stripe-signature"];

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig as string,
        webhookSecret
      );
    } catch (err) {
      logger.warn("Stripe signature verification failed", {err});
      res.status(400).send("Webhook signature verification failed");
      return;
    }

    logger.info("Received Stripe event", {type: event.type, id: event.id});

    try {
      switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(stripe, session);
        break;
      }
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdated(sub, stripe);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(sub, stripe);
        break;
      }
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentSucceeded(stripe, invoice);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        await handleChargeRefunded(stripe, charge);
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
  }
);

async function handleCheckoutCompleted(
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<void> {
  const customerEmail = session.customer_details?.email ?? session.customer_email;

  // Primary lookup: by email
  let supabaseUser = customerEmail
    ? await findSupabaseUserByEmail(customerEmail)
    : null;

  // Fallback: resolve via Firebase UID set in client_reference_id
  if (!supabaseUser && session.client_reference_id) {
    try {
      const firebaseUser = await admin.auth().getUser(session.client_reference_id);
      if (firebaseUser.email) {
        supabaseUser = await findSupabaseUserByEmail(firebaseUser.email);
      }
      if (!supabaseUser) {
        supabaseUser = await findSupabaseUserByFirebaseUid(session.client_reference_id);
      }
    } catch (err) {
      logger.warn("checkout.session.completed: Firebase UID fallback lookup failed", {
        clientReferenceId: session.client_reference_id,
        err,
      });
    }
  }

  if (!supabaseUser) {
    logger.warn("checkout.session.completed: Supabase user not found", {
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

    const tier = getTierByPriceId(priceId);
    if (tier) {
      // Subscription product → upsert subscription row
      const subscriptionId = getStripeId(session.subscription as StripeExpandableId);
      const customerId = getStripeId(session.customer as StripeExpandableId);
      await upsertUserSubscription(supabaseUser.id, APP_NAME, tier, "active", {
        stripe_subscription_id: subscriptionId,
        stripe_customer_id: customerId,
      });
      logger.info("checkout.session.completed: subscription upserted", {
        email: customerEmail,
        tier,
      });
    } else if (isCreditPackPriceId(priceId)) {
      // Credit pack → add credits
      const qty = item.quantity ?? 1;
      await callSupabaseRpc("add_user_credits", {
        p_user_id: supabaseUser.id,
        p_app_name: APP_NAME,
        p_credit_amount: CREDIT_PACK_AMOUNT * qty,
        p_description: "stripe_credit_pack_purchase",
        p_reference_id: session.id,
      });
      logger.info("checkout.session.completed: credits added", {
        email: customerEmail,
        credits: CREDIT_PACK_AMOUNT * qty,
      });
    }
  }
}

async function handleSubscriptionUpdated(
  sub: Stripe.Subscription,
  stripe: Stripe
): Promise<void> {
  const customerId = sub.customer as string;
  // Get price ID from the first subscription item
  const priceId = sub.items.data[0]?.price?.id;
  if (!priceId) return;

  const tier = getTierByPriceId(priceId);
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

  const supabaseUser = await findSupabaseUserByEmail(customer.email);
  if (!supabaseUser) return;

  const planStatus = sub.status === "active" ? "active" :
    sub.status === "canceled" ? "cancelled" : "expired";

  await upsertUserSubscription(supabaseUser.id, APP_NAME, tier, planStatus, {
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId,
  });

  logger.info("customer.subscription.updated: subscription synced", {
    email: customer.email,
    tier,
    planStatus,
  });
}

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  stripe: Stripe
): Promise<void> {
  const customerId = sub.customer as string;
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || !customer.email) {
    logger.warn("customer.subscription.deleted: no customer email", {subId: sub.id});
    return;
  }

  const supabaseUser = await findSupabaseUserByEmail(customer.email);
  if (!supabaseUser) return;

  const priceId = sub.items.data[0]?.price?.id;
  const resolvedTier = priceId ? getTierByPriceId(priceId) : undefined;
  const tier = resolvedTier ?? "free";

  await upsertUserSubscription(supabaseUser.id, APP_NAME, tier, "cancelled", {
    stripe_subscription_id: sub.id,
  });

  logger.info("customer.subscription.deleted: subscription cancelled", {
    email: customer.email,
  });
}

async function handleInvoicePaymentSucceeded(
  stripe: Stripe,
  invoice: Stripe.Invoice
): Promise<void> {
  // Only handle non-subscription invoices (one-time PAYG credit pack purchases)
  const subDetails = (invoice as unknown as {subscription_details?: {subscription?: string}});
  if (subDetails.subscription_details?.subscription || !invoice.customer_email) return;

  const supabaseUser = await findSupabaseUserByEmail(invoice.customer_email);
  if (!supabaseUser) return;

  // Check if any line item is a credit pack by inspecting pricing
  for (const item of invoice.lines.data) {
    type LineItemShape = {pricing?: {price_details?: {price?: string | {id: string}}}};
    const lineItem = item as unknown as LineItemShape;
    const priceRef = lineItem.pricing?.price_details?.price;
    const priceId = typeof priceRef === "string" ? priceRef : priceRef?.id;
    if (isCreditPackPriceId(priceId)) {
      const qty = item.quantity ?? 1;
      await callSupabaseRpc("add_user_credits", {
        p_user_id: supabaseUser.id,
        p_app_name: APP_NAME,
        p_credit_amount: CREDIT_PACK_AMOUNT * qty,
        p_description: "stripe_invoice_payment",
        p_reference_id: invoice.id,
      });
      logger.info("invoice.payment_succeeded: credits added", {
        email: invoice.customer_email,
        credits: CREDIT_PACK_AMOUNT * qty,
      });
    }
  }
}

async function handleChargeRefunded(
  stripe: Stripe,
  charge: Stripe.Charge
): Promise<void> {
  const customerEmail = charge.billing_details?.email;
  if (!customerEmail) {
    logger.warn("charge.refunded: no customer email", {chargeId: charge.id});
    return;
  }

  const supabaseUser = await findSupabaseUserByEmail(customerEmail);
  if (!supabaseUser) return;

  let creditPackQty = 0;
  let isSubscriptionRefund = false;
  type ChargeWithInvoice = {invoice?: string | {id: string}};
  const invoiceRef = (charge as unknown as ChargeWithInvoice).invoice;

  if (invoiceRef) {
    const invoiceId = typeof invoiceRef === "string" ? invoiceRef : invoiceRef.id;
    const invoice = await stripe.invoices.retrieve(invoiceId);
    const subDetails = (invoice as unknown as {subscription_details?: {subscription?: string}});
    isSubscriptionRefund = !!subDetails.subscription_details?.subscription;

    for (const item of invoice.lines.data) {
      type LineItemShape = {pricing?: {price_details?: {price?: string | {id: string}}}};
      const lineItem = item as unknown as LineItemShape;
      const priceRef = lineItem.pricing?.price_details?.price;
      const priceId = typeof priceRef === "string" ? priceRef : priceRef?.id;
      if (isCreditPackPriceId(priceId)) {
        creditPackQty += item.quantity ?? 1;
      }
    }
  }

  // Backward-compatible fallback for older charges that may have metadata set directly.
  if (creditPackQty === 0 && isCreditPackPriceId(charge.metadata?.price_id)) {
    creditPackQty = Number(charge.metadata?.quantity ?? 1);
  }

  if (creditPackQty > 0) {
    await callSupabaseRpc("update_user_credits", {
      p_user_id: supabaseUser.id,
      p_app_name: APP_NAME,
      p_credit_change: -(CREDIT_PACK_AMOUNT * creditPackQty),
      p_description: "stripe_refund",
      p_reference_id: charge.id,
    });
    logger.info("charge.refunded: credits deducted", {
      email: customerEmail,
      credits: CREDIT_PACK_AMOUNT * creditPackQty,
    });
  } else if (isSubscriptionRefund) {
    // For subscription refunds, cancel the subscription
    await upsertUserSubscription(supabaseUser.id, APP_NAME, "free", "cancelled", {});
    logger.info("charge.refunded: subscription cancelled", {email: customerEmail});
  } else {
    logger.warn("charge.refunded: unable to classify refund", {
      email: customerEmail,
      chargeId: charge.id,
      invoice: typeof invoiceRef === "string" ? invoiceRef : invoiceRef?.id,
    });
  }
}

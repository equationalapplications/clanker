import { createHash } from "crypto";
import * as logger from "firebase-functions/logger";

const GA4_MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

export function buildClientId(firebaseUid: string): string {
  const hash = createHash("sha256").update(firebaseUid).digest();
  const a = hash.readUInt32BE(0);
  const b = hash.readUInt32BE(4);
  return `${a}.${b}`;
}

export interface PurchaseEventParams {
  firebaseUid: string;
  transactionId: string;
  valueCents: number;
  currency: string;
}

export async function sendPurchaseEvent(
  params: PurchaseEventParams,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_MP_API_SECRET;

  if (!measurementId || !apiSecret) {
    logger.warn("GA4 Measurement Protocol not configured, skipping purchase event", {
      transactionId: params.transactionId,
    });
    return;
  }

  try {
    const url = `${GA4_MP_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: buildClientId(params.firebaseUid),
        user_id: params.firebaseUid,
        events: [
          {
            name: "purchase",
            params: {
              transaction_id: params.transactionId,
              value: params.valueCents / 100,
              currency: params.currency,
              items: [{ item_id: "credit_pack", item_name: "Credit Pack" }],
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      logger.error("GA4 Measurement Protocol request failed", {
        transactionId: params.transactionId,
        status: response.status,
      });
    }
  } catch (error) {
    logger.error("GA4 Measurement Protocol request threw", {
      transactionId: params.transactionId,
      error,
    });
  }
}

import { createHash } from "crypto";
import * as logger from "firebase-functions/logger";

const GA4_MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

// Stripe currencies with no minor unit (amount is already a whole-currency value).
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
  "rwf", "vnd", "vuv", "xaf", "xof", "xpf",
]);

// Stripe currencies whose minor unit is a thousandth rather than a hundredth.
const THREE_DECIMAL_CURRENCIES = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function minorUnitsToDecimal(amountMinorUnits: number, currency: string): number {
  const normalized = currency.toLowerCase();
  if (ZERO_DECIMAL_CURRENCIES.has(normalized)) return amountMinorUnits;
  if (THREE_DECIMAL_CURRENCIES.has(normalized)) return amountMinorUnits / 1000;
  return amountMinorUnits / 100;
}

export function buildClientId(firebaseUid: string): string {
  const hash = createHash("sha256").update(firebaseUid).digest();
  const a = hash.readUInt32BE(0);
  const b = hash.readUInt32BE(4);
  return `${a}.${b}`;
}

export interface PurchaseEventParams {
  firebaseUid: string;
  transactionId: string;
  valueMinorUnits: number;
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          client_id: buildClientId(params.firebaseUid),
          user_id: params.firebaseUid,
          events: [
            {
              name: "purchase",
              params: {
                transaction_id: params.transactionId,
                value: minorUnitsToDecimal(params.valueMinorUnits, params.currency),
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
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    logger.error("GA4 Measurement Protocol request threw", {
      transactionId: params.transactionId,
      error,
    });
  }

}

import {defineString} from "firebase-functions/params";

const STRIPE_MONTHLY_20_PRICE_ID_PARAM = defineString("STRIPE_MONTHLY_20_PRICE_ID");
const STRIPE_MONTHLY_50_PRICE_ID_PARAM = defineString("STRIPE_MONTHLY_50_PRICE_ID");
const STRIPE_CREDIT_PACK_PRICE_ID_PARAM = defineString("STRIPE_CREDIT_PACK_PRICE_ID");
const STRIPE_SUCCESS_URL_PARAM = defineString("STRIPE_SUCCESS_URL");
const STRIPE_CANCEL_URL_PARAM = defineString("STRIPE_CANCEL_URL");

function readParamOrEnv(
  param: {value: () => string},
  envName: string
): string | undefined {
  // Prioritize environment variable to avoid throwing when param is not set
  const envValue = process.env[envName]?.trim();
  if (envValue) {
    return envValue;
  }

  // Fallback to Firebase param, with error handling for missing values
  let raw: string | undefined;
  try {
    raw = param.value();
  } catch {
    raw = undefined;
  }
  const value = raw?.trim();
  return value ? value : undefined;
}

export function getStripePriceIds(): {
  monthly20?: string;
  monthly50?: string;
  creditPack?: string;
} {
  return {
    monthly20: readParamOrEnv(STRIPE_MONTHLY_20_PRICE_ID_PARAM, "STRIPE_MONTHLY_20_PRICE_ID"),
    monthly50: readParamOrEnv(STRIPE_MONTHLY_50_PRICE_ID_PARAM, "STRIPE_MONTHLY_50_PRICE_ID"),
    creditPack: readParamOrEnv(STRIPE_CREDIT_PACK_PRICE_ID_PARAM, "STRIPE_CREDIT_PACK_PRICE_ID"),
  };
}

export function getStripeCheckoutUrls(): {
  successUrl?: string;
  cancelUrl?: string;
} {
  return {
    successUrl: readParamOrEnv(STRIPE_SUCCESS_URL_PARAM, "STRIPE_SUCCESS_URL"),
    cancelUrl: readParamOrEnv(STRIPE_CANCEL_URL_PARAM, "STRIPE_CANCEL_URL"),
  };
}

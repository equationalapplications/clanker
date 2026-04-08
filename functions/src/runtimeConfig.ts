import {defineString} from "firebase-functions/params";

const SUPABASE_URL_PARAM = defineString("SUPABASE_URL");
const STRIPE_MONTHLY_20_PRICE_ID_PARAM = defineString("STRIPE_MONTHLY_20_PRICE_ID");
const STRIPE_MONTHLY_50_PRICE_ID_PARAM = defineString("STRIPE_MONTHLY_50_PRICE_ID");
const STRIPE_CREDIT_PACK_PRICE_ID_PARAM = defineString("STRIPE_CREDIT_PACK_PRICE_ID");

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

export function getSupabaseUrl(): string | undefined {
  return readParamOrEnv(SUPABASE_URL_PARAM, "SUPABASE_URL");
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

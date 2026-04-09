type StripeSecretKeyErrorFactory = (message: string) => Error;

const STRIPE_SECRET_KEY_NON_PRINTABLE_REGEX = /[^\u0020-\u007E]/;

export function validateAndNormalizeStripeSecretKey(
  rawSecretKey: string | undefined,
  createError: StripeSecretKeyErrorFactory = (message) => new Error(message)
): string {
  const secretKey = rawSecretKey?.trim();
  if (!secretKey) {
    throw createError("STRIPE_SECRET_KEY environment variable is not set");
  }

  if (STRIPE_SECRET_KEY_NON_PRINTABLE_REGEX.test(secretKey)) {
    throw createError("STRIPE_SECRET_KEY contains invalid characters");
  }

  return secretKey;
}
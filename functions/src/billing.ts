/**
 * Shared billing and credit-spend utilities
 */

/**
 * Extract remaining credit balance from Supabase RPC response.
 * Handles multiple response shapes (number, string, array, object with nested fields).
 */
export function extractRemainingCredits(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? extractRemainingCredits(value[0]) : null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    remaining_credits?: unknown;
    remainingCredits?: unknown;
  };

  if (record.remaining_credits !== undefined) {
    return extractRemainingCredits(record.remaining_credits);
  }

  if (record.remainingCredits !== undefined) {
    return extractRemainingCredits(record.remainingCredits);
  }

  return null;
}

/**
 * Check if an RPC response indicates successful credit spending.
 * Handles boolean, array, and object responses with success/ok/spent fields.
 */
export function isAcknowledgedSpend(value: unknown): boolean {
  if (value === true) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => isAcknowledgedSpend(entry));
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as {
    success?: unknown;
    ok?: unknown;
    spent?: unknown;
  };

  return record.success === true || record.ok === true || record.spent === true;
}

/**
 * Plan tiers that unlock unlimited features (document ingest, memory heal,
 * cloud characters, etc.). Kept in one place so adding a new tier only
 * requires a change here + a redeploy — not a grep across every callable.
 */
export const PREMIUM_TIERS = new Set(['monthly_20', 'monthly_50']);

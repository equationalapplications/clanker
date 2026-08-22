/**
 * Authoritative apply order for Cloud SQL migrations, shared by both runners
 * (scripts/migrate.mjs for production, scripts/migrate-dev.mjs for local docker).
 *
 * Add every new migration here, in the order it must run. Both runners refuse to
 * apply a file that is not listed, so this is the single place to update.
 */
export const MIGRATION_ORDER = [
  '0000_dazzling_kid_colt.sql',
  '0001_credit_transactions_idempotency.sql',
  '0002_users_timestamps_not_null.sql',
  '0003_character_voice.sql',
  '0004_wiki_memory.sql',
  '0004_lame_gwen_stacy.sql',
  '0005_subscriptions_document_counter.sql',
  '0006_partial_source_hash_index.sql',
  '0007_source_ref_idx.sql',
  '0008_wiki_memory_v2.sql',
  '0009_odd_sandman.sql',
  '0010_fix_source_type_check.sql',
  '0011_credits_redesign.sql',
  '0012_update_handle_new_user_trigger.sql',
  '0013_cloud_agent_tasks.sql',
  '0014_pgvector_wiki_embeddings.sql',
  '0015_organizations.sql',
  '0016_llm_wiki_graph.sql',
  '0017_expo_push_token.sql',
  '0018_billing_hardening.sql',
  '0019_character_voice_default_fix.sql',
  '0020_credit_power_scale.sql',
  '0021_fix_handle_new_user_trigger_power_scale.sql',
  '0022_character_images.sql',
  '0023_character_images_chat.sql',
  '0024_credit_spend_events.sql',
];

/** Index of a migration in the canonical order, or -1 if untracked. */
export function migrationIndex(filename) {
  return MIGRATION_ORDER.indexOf(filename);
}

/**
 * Migrations that must run before `filename` but are neither already applied nor
 * scheduled earlier in the current batch. Empty means it is safe to apply.
 *
 * This encodes the 2026-08-01 incident: 0021 redefines handle_new_user() to use
 * `ON CONFLICT (user_id, reason, reference_id) WHERE reference_id IS NOT NULL`,
 * which requires the partial unique index created by 0001. Production had 0021
 * but never 0001, so every signup failed with Postgres 42P10 until it was found.
 *
 * @param {string} filename         migration being considered
 * @param {Set<string>} applied     filenames already recorded as applied
 * @param {string[]} batch          filenames being applied in this same run
 * @returns {string[]} missing prerequisites, in apply order
 */
export function missingPrerequisites(filename, applied, batch = []) {
  const idx = migrationIndex(filename);
  if (idx === -1) return [];

  const posInBatch = batch.indexOf(filename);

  return MIGRATION_ORDER.slice(0, idx).filter((earlier) => {
    if (applied.has(earlier)) return false;
    const earlierPos = batch.indexOf(earlier);
    // Only counts as satisfied if it's scheduled strictly before `filename` in
    // this batch. A prerequisite present but scheduled *after* is still missing —
    // otherwise a mis-ordered batch (e.g. the full MIGRATION_ORDER passed as-is
    // when `filename` isn't first) would slip past this guard.
    return earlierPos === -1 || (posInBatch !== -1 && earlierPos > posInBatch);
  });
}

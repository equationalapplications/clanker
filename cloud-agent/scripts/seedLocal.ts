import { sql } from 'drizzle-orm'
import { getDb } from '../src/db/client.js'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const CHARACTER_ID = '22222222-2222-4222-8222-222222222222'

/** Generate a deterministic 768‑dimensional mock embedding vector as a pgvector‑compatible SQL literal string. */
function mockEmbedding(seed: number): string {
  const dims: string[] = []
  for (let i = 0; i < 768; i++) {
    // Deterministic-ish float in [-0.5, 0.5] so the cosine distance is non‑trivial
    const val = Math.sin(i * seed * 0.01) * 0.5
    dims.push(val.toFixed(8))
  }
  return `'[${dims.join(',')}]'::vector`
}

async function seed() {
  const db = await getDb()
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`)
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`)
  console.log('Creating tables...')
  // ── Tables mirrored from cloud-agent/src/db/schema.ts ─────────────────────

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      firebase_uid TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS characters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      appearance TEXT,
      traits TEXT,
      emotions TEXT,
      context TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      character_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      CONSTRAINT tasks_status_check CHECK (status IN ('open', 'done', 'abandoned'))
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS llm_wiki_events (
      id TEXT NOT NULL,
      entity_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (id, user_id),
      CONSTRAINT llm_wiki_events_event_type_check
        CHECK (event_type IN ('observation', 'decision', 'action', 'outcome'))
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS llm_wiki_entries (
      id TEXT NOT NULL,
      entity_id UUID NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      tags JSONB NOT NULL DEFAULT '[]',
      confidence TEXT NOT NULL DEFAULT 'inferred',
      source_type TEXT NOT NULL DEFAULT 'agent_inferred',
      source_ref TEXT,
      source_hash TEXT,
      last_accessed_at BIGINT,
      access_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      deleted_at BIGINT,
      embedding vector(768),
      PRIMARY KEY (id, user_id)
    )
  `)

  // ivfflat index for approximate nearest-neighbor search on embeddings.
  // Lists = sqrt(rows) is a reasonable starting point; adjust as the table grows.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS llm_wiki_entries_embedding_idx
      ON llm_wiki_entries
      USING hnsw (embedding vector_cosine_ops)
  `)

  // ── Tables NOT in cloud-agent schema (from functions/src/db/schema.ts) ─────
  // creditService.ts queries these via raw SQL.

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_tier TEXT NOT NULL DEFAULT 'free',
      plan_status TEXT NOT NULL DEFAULT 'active',
      current_credits INTEGER NOT NULL DEFAULT 0,
      terms_version TEXT,
      terms_accepted_at TIMESTAMP WITH TIME ZONE,
      stripe_subscription_id TEXT,
      stripe_customer_id TEXT,
      billing_cycle_start TIMESTAMP WITH TIME ZONE,
      billing_cycle_end TIMESTAMP WITH TIME ZONE,
      next_expiry_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
      documents_ingested_count INTEGER NOT NULL DEFAULT 0,
      documents_ingested_date TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT plan_tier_check
        CHECK (plan_tier IN ('free', 'monthly_20', 'monthly_50', 'payg')),
      CONSTRAINT plan_status_check
        CHECK (plan_status IN ('active', 'cancelled', 'expired'))
    )
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS credit_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference_id TEXT,
      initial_amount INTEGER NOT NULL,
      remaining_balance INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      expires_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      CONSTRAINT credit_transactions_transaction_type_check
        CHECK (transaction_type IN ('signup', 'subscription', 'one_time', 'legacy'))
    )
  `)

  console.log('Seeding test data...')

  await db.execute(sql`
    DELETE FROM users WHERE firebase_uid = 'local_test_user_123' AND id != ${USER_ID}::uuid
  `)
  await db.execute(sql`
    INSERT INTO users (id, firebase_uid, email, display_name)
    VALUES (${USER_ID}, 'local_test_user_123', 'dev@localhost.com', 'Dev User')
    ON CONFLICT (id) DO UPDATE
      SET firebase_uid = EXCLUDED.firebase_uid,
          email = EXCLUDED.email,
          display_name = EXCLUDED.display_name
  `)

  await db.execute(sql`
    INSERT INTO characters (id, user_id, name, traits)
    VALUES (${CHARACTER_ID}, ${USER_ID}, 'Dev Character', 'Friendly, helpful')
    ON CONFLICT (id) DO NOTHING
  `)

  // ── Seed a mock wiki entry so pgvector similarity search is testable ──────
  const now = Date.now()
  await db.execute(sql`
    INSERT INTO llm_wiki_entries (id, entity_id, user_id, title, body, tags, confidence, source_type, created_at, updated_at, embedding)
    VALUES (
      'wiki-entry-001',
      ${CHARACTER_ID},
      ${USER_ID},
      'User Likes Dogs',
      'The user mentioned they have two golden retrievers named Sunny and Scout. They love taking them to the park on weekends.',
      '["pets", "dogs", "personal"]',
      'certain',
      'agent_inferred',
      ${now},
      ${now},
      ${sql.raw(mockEmbedding(1))}
    )
    ON CONFLICT (id, user_id) DO NOTHING
  `)
  console.log('  + Mock wiki entry: User Likes Dogs')

  await db.execute(sql`
    INSERT INTO subscriptions (user_id, plan_tier, plan_status, current_credits)
    VALUES (${USER_ID}, 'free', 'active', 100)
    ON CONFLICT (user_id) DO NOTHING
  `)

  // Only insert credit grant if this user has no transactions yet
  await db.execute(sql`
    INSERT INTO credit_transactions
      (user_id, delta, reason, initial_amount, remaining_balance, transaction_type, expires_at)
    SELECT ${USER_ID}, 100, 'local_dev_grant', 100, 100, 'legacy', NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM credit_transactions WHERE user_id = ${USER_ID}
    )
  `)

  console.log('Seed complete!')
  console.log(`  User ID:      ${USER_ID}`)
  console.log(`  Character ID: ${CHARACTER_ID}`)
  console.log(`  firebase_uid: local_test_user_123`)
  process.exit(0)
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})

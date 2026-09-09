// Minimal schema mirror — cloud agent bounded context only.
// Source of truth: functions/src/db/schema.ts
// Tables omitted: subscriptions, credit_transactions, legacy wiki tables, stripe tables.
// messages: mirrored narrowly for proactive wake-up inserts (Phase 2). Columns
// not written by the cloud agent (id, recipient_user_id, pending, sent, error,
// edited, synced_at) are intentionally absent — see proactiveWakeupHandler.ts.
import {
  pgTable,
  uuid,
  text,
  timestamp,
  bigint,
  integer,
  jsonb,
  index,
  check,
  uniqueIndex,
  primaryKey,
  vector,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').unique().notNull(),
  email: text('email').unique().notNull(),
  displayName: text('display_name'),
  expoPushToken: text('expo_push_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    appearance: text('appearance'),
    traits: text('traits'),
    emotions: text('emotions'),
    context: text('context'),
    voice: text('voice'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdIdx: index('characters_user_id_idx').on(table.userId),
  }),
)

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    characterUserIdx: index('tasks_character_user_idx').on(table.characterId, table.userId),
    statusCheck: check('tasks_status_check', sql`${table.status} IN ('open', 'done', 'abandoned')`),
  }),
)

export const llmWikiEvents = pgTable(
  'llm_wiki_events',
  {
    id: text('id').notNull(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    summary: text('summary').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.userId] }),
    entityCreatedIdx: index('llm_wiki_events_entity_created_idx').on(
      table.entityId,
      table.userId,
      table.createdAt,
    ),
    eventTypeCheck: check(
      'llm_wiki_events_event_type_check',
      sql`${table.eventType} IN ('observation', 'decision', 'action', 'outcome')`,
    ),
  }),
)

export const llmWikiEntries = pgTable(
  'llm_wiki_entries',
  {
    id: text('id').notNull(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    tags: jsonb('tags').notNull().default([]),
    confidence: text('confidence').notNull().default('inferred'),
    sourceType: text('source_type').notNull().default('agent_inferred'),
    sourceRef: text('source_ref'),
    sourceHash: text('source_hash'),
    lastAccessedAt: bigint('last_accessed_at', { mode: 'number' }),
    accessCount: integer('access_count').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    deletedAt: bigint('deleted_at', { mode: 'number' }),
    embedding: vector('embedding', { dimensions: 768 }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.userId] }),
    entityUserIdx: index('llm_wiki_entries_entity_user_idx').on(table.entityId, table.userId),
    // NOTE: embedding index is created via SQL migration (HNSW + vector_cosine_ops); keep schema mirror declarative only.
  }),
)

export const llmWikiEdges = pgTable(
  'llm_wiki_edges',
  {
    id: text('id').notNull(),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    targetId: text('target_id').notNull(),
    edgeType: text('edge_type').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.userId] }),
    entityUserIdx: index('llm_wiki_edges_entity_user_idx').on(table.entityId, table.userId),
    sourceIdx: index('llm_wiki_edges_source_idx').on(table.sourceId, table.userId),
    targetIdx: index('llm_wiki_edges_target_idx').on(table.targetId, table.userId),
  }),
)

export const llmWikiOntology = pgTable(
  'llm_wiki_ontology',
  {
    entityId: uuid('entity_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('off'),
    manifest: jsonb('manifest'),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.entityId, table.userId] }),
    modeCheck: check(
      'llm_wiki_ontology_mode_check',
      sql`${table.mode} IN ('strict', 'emergent', 'off')`,
    ),
  }),
)

export const scheduledWakeups = pgTable(
  'scheduled_wakeups',
  {
    id: text('id').primaryKey(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    priority: integer('priority').notNull().default(0),
    status: text('status').notNull().default('pending'),
    runKey: text('run_key').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    spentAmount: integer('spent_amount').notNull().default(0),
    outcome: text('outcome'),
    deliveryMode: text('delivery_mode'),
    chosenDeliveryMode: text('chosen_delivery_mode'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusDueIdx: index('scheduled_wakeups_status_due_idx').on(table.status, table.dueAt),
    characterStatusIdx: index('scheduled_wakeups_character_status_idx').on(
      table.characterId,
      table.status,
    ),
    resolvedAtIdx: index('scheduled_wakeups_resolved_at_idx').on(table.resolvedAt),
    // Partial, matching migration 0027: 'claimed'/'running' rows have a NULL
    // resolved_at, so the retention delete (which filters on resolved_at) can
    // never reach them. The stale-claim reaper finds them by claimed_at.
    claimedAtIdx: index('scheduled_wakeups_claimed_at_idx')
      .on(table.claimedAt)
      .where(sql`${table.resolvedAt} IS NULL`),
    runKeyUniqueIdx: uniqueIndex('scheduled_wakeups_run_key_unique_idx').on(table.runKey),
    statusCheck: check(
      'scheduled_wakeups_status_check',
      sql`${table.status} IN ('pending', 'claimed', 'running', 'done', 'skipped', 'cancelled')`,
    ),
  }),
)

export const messages = pgTable('messages', {
  characterId: uuid('character_id')
    .notNull()
    .references(() => characters.id, { onDelete: 'cascade' }),
  senderUserId: uuid('sender_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull(),
  text: text('text').notNull(),
  messageData: jsonb('message_data').notNull().default({}),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

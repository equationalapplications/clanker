import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, bigint, check, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { DEFAULT_VOICE } from '../constants/voiceDefaults.js';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').unique().notNull(),
  email: text('email').unique().notNull(),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  isProfilePublic: boolean('is_profile_public').notNull().default(false),
  defaultCharacterId: uuid('default_character_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').unique().notNull().references(() => users.id, { onDelete: 'cascade' }),
  planTier: text('plan_tier').notNull().default('free'),
  planStatus: text('plan_status').notNull().default('active'),
  currentCredits: integer('current_credits').notNull().default(0),
  termsVersion: text('terms_version'),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeCustomerId: text('stripe_customer_id'),
  billingCycleStart: timestamp('billing_cycle_start', { withTimezone: true }),
  billingCycleEnd: timestamp('billing_cycle_end', { withTimezone: true }),
  documentsIngestedCount: integer('documents_ingested_count').notNull().default(0),
  documentsIngestedDate: text('documents_ingested_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  planTierCheck: check('plan_tier_check', sql`${table.planTier} IN ('free', 'monthly_20', 'monthly_50', 'payg')`),
  planStatusCheck: check('plan_status_check', sql`${table.planStatus} IN ('active', 'cancelled', 'expired')`),
}));

export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  referenceId: text('reference_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('credit_transactions_user_id_idx').on(table.userId),
  idempotencyIdx: uniqueIndex('credit_transactions_idempotency_idx')
    .on(table.userId, table.reason, table.referenceId)
    .where(sql`${table.referenceId} IS NOT NULL`),
}));

export const characters = pgTable('characters', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  avatar: text('avatar'),
  appearance: text('appearance'),
  traits: text('traits'),
  emotions: text('emotions'),
  context: text('context'),
  voice: text('voice').notNull().default(DEFAULT_VOICE),
  isPublic: boolean('is_public').notNull().default(false),
  saveToCloud: boolean('save_to_cloud').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('characters_user_id_idx').on(table.userId),
}));

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  senderUserId: uuid('sender_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull(),
  text: text('text').notNull(),
  senderName: text('sender_name'),
  senderAvatar: text('sender_avatar'),
  messageData: jsonb('message_data').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  characterIdIdx: index('messages_character_id_idx').on(table.characterId),
  senderUserIdIdx: index('messages_sender_user_id_idx').on(table.senderUserId),
  characterIdCreatedAtIdx: index('messages_character_id_created_at_idx').on(table.characterId, table.createdAt.desc()),
}));

export const wikiEntries = pgTable('llm_wiki_entries', {
  id: text('id').notNull(),
  entityId: text('entity_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tags: jsonb('tags').notNull().default([]),
  confidence: text('confidence').notNull().default('inferred'),
  sourceRef: text('source_ref'),
  sourceHash: text('source_hash'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.userId] }),
  entityUserIdx: index('llm_wiki_entries_entity_user_idx').on(table.entityId, table.userId),
  updatedAtIdx: index('llm_wiki_entries_updated_at_idx').on(table.updatedAt),
}));

export const wikiTasks = pgTable('llm_wiki_tasks', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  status: text('status').notNull().default('pending'),
  priority: integer('priority').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  resolvedAt: bigint('resolved_at', { mode: 'number' }),
}, (table) => ({  pk: primaryKey({ columns: [table.id, table.userId] }),  entityStatusIdx: index('llm_wiki_tasks_entity_status_idx').on(table.entityId, table.userId, table.status),
}));

export const wikiEvents = pgTable('llm_wiki_events', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  summary: text('summary').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({  pk: primaryKey({ columns: [table.id, table.userId] }),  entityCreatedIdx: index('llm_wiki_events_entity_created_idx').on(table.entityId, table.userId, table.createdAt),
}));

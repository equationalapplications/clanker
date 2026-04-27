import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, check, index, uniqueIndex } from 'drizzle-orm/pg-core';
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

export const wikiEntries = pgTable('wiki_entries', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  tags: jsonb('tags').notNull().default([]),
  confidence: text('confidence').notNull().default('inferred'),
  sourceType: text('source_type').notNull().default('agent_inferred'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  accessCount: integer('access_count').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  characterUserIdx: index('wiki_entries_character_user_idx').on(table.characterId, table.userId),
  characterDeletedIdx: index('wiki_entries_character_deleted_idx').on(table.characterId, table.deletedAt),
  updatedAtIdx: index('wiki_entries_updated_at_idx').on(table.updatedAt.desc()),
  confidenceCheck: check('wiki_entries_confidence_check', sql`${table.confidence} IN ('certain', 'inferred', 'tentative')`),
  sourceTypeCheck: check('wiki_entries_source_type_check', sql`${table.sourceType} IN ('user_stated', 'agent_inferred', 'user_confirmed')`),
}));

export const agentTasks = pgTable('agent_tasks', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  status: text('status').notNull().default('pending'),
  priority: integer('priority').notNull().default(0),
  dueContext: text('due_context'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  resolutionNote: text('resolution_note'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  characterStatusIdx: index('agent_tasks_character_status_idx').on(table.characterId, table.userId, table.status),
  priorityIdx: index('agent_tasks_priority_idx').on(table.priority.desc()),
  statusCheck: check('agent_tasks_status_check', sql`${table.status} IN ('pending', 'in_progress', 'done', 'abandoned')`),
}));

export const memoryEvents = pgTable('memory_events', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  summary: text('summary').notNull(),
  relatedEntryId: text('related_entry_id').references(() => wikiEntries.id, { onDelete: 'set null' }),
  relatedTaskId: text('related_task_id').references(() => agentTasks.id, { onDelete: 'set null' }),
  sourceRef: text('source_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  characterCreatedIdx: index('memory_events_character_created_idx').on(table.characterId, table.userId, table.createdAt.desc()),
  eventTypeCheck: check('memory_events_event_type_check', sql`${table.eventType} IN ('observation', 'decision', 'action', 'outcome')`),
}));

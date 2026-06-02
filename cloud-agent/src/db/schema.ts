// Minimal schema mirror — cloud agent bounded context only.
// Source of truth: functions/src/db/schema.ts
// Tables omitted: subscriptions, credit_transactions, messages, legacy wiki tables, stripe tables.
import {
  pgTable, uuid, text, timestamp, bigint,
  index, check, primaryKey,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').unique().notNull(),
  email: text('email').unique().notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const characters = pgTable('characters', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  appearance: text('appearance'),
  traits: text('traits'),
  emotions: text('emotions'),
  context: text('context'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('characters_user_id_idx').on(table.userId),
}))

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  characterUserIdx: index('tasks_character_user_idx').on(table.characterId, table.userId),
  statusCheck: check('tasks_status_check', sql`${table.status} IN ('open', 'done', 'abandoned')`),
}))

export const llmWikiEvents = pgTable('llm_wiki_events', {
  id: text('id').notNull(),
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  summary: text('summary').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.userId] }),
  entityCreatedIdx: index('llm_wiki_events_entity_created_idx').on(table.entityId, table.userId, table.createdAt),
  eventTypeCheck: check(
    'llm_wiki_events_event_type_check',
    sql`${table.eventType} IN ('observation', 'decision', 'action', 'outcome')`
  ),
}))

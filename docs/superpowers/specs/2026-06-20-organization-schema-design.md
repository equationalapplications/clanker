# Organization Database Schema — Design Spec

Date: 2026-06-20
Status: Implemented

## Goal

Add `organizations` and `organization_members` tables to the Drizzle ORM schema (`functions/src/db/schema.ts`) to future-proof the Cloud SQL backend for multi-tenant B2B features. Backend groundwork only — no frontend UI, no app-level authorization logic, no invitation flow. Just the schema, migration, and typecheck.

## Schema

### `organizations`

```ts
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

Matches the `users` table's column style (`withTimezone`, `.notNull().defaultNow()` on both timestamps).

### `organization_members`

```ts
export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgUserUniqueIdx: uniqueIndex('organization_members_org_user_unique_idx').on(table.organizationId, table.userId),
  userIdIdx: index('organization_members_user_id_idx').on(table.userId),
}));
```

Decisions:
- **Standalone `uuid` PK** instead of a composite PK on `(organization_id, user_id)`. Matches the `id`-per-row pattern used by `users`, `subscriptions`, `characters`, etc., and leaves room for future per-membership state (e.g. invitation status, soft-delete) without a PK migration.
- **Unique index on `(organization_id, user_id)`** enforces one membership row per user/org pair — equivalent protection to a composite PK, without making it the primary key.
- **Separate index on `user_id` alone** — the unique index covers "members of an org" lookups (org_id is the leading column); a standalone `user_id` index covers the reverse direction ("orgs a user belongs to").
- **`role` is plain `text`, no check constraint.** Existing patterns like `plan_tier`/`plan_status` use check constraints for closed enums, but `role` here is expected to grow (e.g. future custom roles), so it's left unconstrained at the DB level. App-level validation can enforce `'admin' | 'member'` for now.
- **`onDelete: 'cascade'` on both FKs.** Deleting a user or an organization removes the associated membership rows automatically. Matches the cascade pattern used throughout the schema (e.g. `characters.userId`, `messages.characterId`).
- **No `updatedAt`** on `organization_members` — membership rows are created and deleted, not edited in place (role changes are out of scope here).

### Relationships

The codebase has no existing Drizzle `relations()` helper usage anywhere in `schema.ts` — every relationship today is expressed via `.references()` foreign keys plus manual joins in query code. This spec follows the same convention rather than introducing the `relations()` API for the first time. The many-to-many (user ↔ organizations via `organization_members`) is fully expressed through the two FK columns and their indexes; consuming code joins through `organization_members` the same way it already joins through `characters`, `subscriptions`, etc.

## Migration

1. Add the two table definitions to `functions/src/db/schema.ts`.
2. Create a hand-written migration SQL file in `functions/drizzle/`. The Drizzle journal (`functions/drizzle/meta/_journal.json`) currently stops at `0011_credits_redesign`, while hand-written migrations `0012`–`0014` already exist on disk — so **`npx drizzle-kit generate` would assign a conflicting number/tag** until the journal is re-synced. Use the next on-disk sequential index (`0015_organizations.sql` after `0014_pgvector_wiki_embeddings.sql`). Match the style of existing hand-written migrations: `CREATE TABLE`, `ALTER TABLE ... ADD CONSTRAINT` for FKs, and explicit `CREATE INDEX` / `CREATE UNIQUE INDEX` statements. Do **not** update `_journal.json` or add snapshot files unless the journal is being re-synced project-wide.
3. Verify with a typecheck (e.g. `npm run typecheck` / `tsc --noEmit` in `functions/`) — no compile errors expected since no other file references these new exports yet.

> **Note:** If the Drizzle journal is brought back in sync with on-disk migrations, `drizzle-kit generate` can be used again for future schema changes. Until then, follow the hand-written migration workflow documented in [architecture-and-data.md](../../architecture-and-data.md).

## Out of scope

- Frontend UI for organizations/members.
- Invitation/onboarding flow.
- Role-based authorization logic in callables/services.
- Soft-delete (`deleted_at`) or audit-trail columns on either table.
- Drizzle `relations()` helpers (not used elsewhere in this schema).

# Organization Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `organizations` and `organization_members` tables to the Drizzle ORM schema, add the migration SQL, and verify the project typechecks.

**Architecture:** Two new `pgTable` definitions appended to the existing `functions/src/db/schema.ts` (single-file schema, matching current codebase convention — no `relations()` helpers, no separate file). `organizations` holds tenant records; `organization_members` is a junction table with its own `uuid` PK, a unique index on `(organization_id, user_id)` to prevent duplicate memberships, and a secondary index on `user_id` for reverse lookups. Migration is hand-written because the Drizzle journal (`functions/drizzle/meta/_journal.json`) stops at `0011` while migrations `0012`–`0014` already exist on disk — running `drizzle-kit generate` would produce a conflicting number/tag until the journal is re-synced.

**Tech Stack:** Drizzle ORM (`drizzle-orm/pg-core`), drizzle-kit, TypeScript, PostgreSQL (Cloud SQL).

---

This is a single-file schema change with no application logic, so there is no behavior to drive with a failing test. The verification loop here is: schema compiles → migration SQL written → typecheck passes.

## Task 1: Add `organizations` and `organization_members` tables to schema

**Files:**
- Modify: `functions/src/db/schema.ts:1` (import line), end of file (new exports after line 237's `tasks` table)

- [ ] **Step 1: Add `uniqueIndex` to the existing import if not already present**

Check line 1 of `functions/src/db/schema.ts`:

```ts
import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, bigint, check, index, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
```

`uniqueIndex` and `index` are already imported — no change needed to the import line. Confirm by reading the file; if for any reason they are missing, add them to the destructured import list.

- [ ] **Step 2: Append the `organizations` table definition**

Add to the end of `functions/src/db/schema.ts` (after the `tasks` table, which currently ends the file at line 237):

```ts

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Append the `organization_members` table definition**

Add directly below the `organizations` table:

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

- [ ] **Step 4: Typecheck**

Run: `cd functions && npm run typecheck`
Expected: exits 0, no errors. (`users` is already defined earlier in the same file at line 12, so the `references(() => users.id, ...)` call resolves with no new import needed.)

- [ ] **Step 5: Commit**

```bash
git add functions/src/db/schema.ts
git commit -m "feat(db): add organizations and organization_members tables"
```

---

## Task 2: Write migration SQL

**Files:**
- Create: `functions/drizzle/0015_organizations.sql` (next sequential index after `0014_pgvector_wiki_embeddings.sql`)
- Do **not** modify `functions/drizzle/meta/_journal.json` or add snapshot files — the journal stops at `0011` and is out of sync with on-disk migrations `0012`–`0014`. Updating the journal for this change alone would misrepresent prior migrations.

- [ ] **Step 1: Write the migration SQL file**

Create `functions/drizzle/0015_organizations.sql` by hand, matching the style of existing migrations (e.g. `0014_pgvector_wiki_embeddings.sql`). The file should contain:
- `CREATE TABLE "organizations" (...)` with `id`, `name`, `created_at`, `updated_at` columns
- `CREATE TABLE "organization_members" (...)` with `id`, `user_id`, `organization_id`, `role`, `created_at` columns
- Two `FOREIGN KEY` constraints on `organization_members` (`user_id` → `users.id`, `organization_id` → `organizations.id`), both `ON DELETE cascade`
- A `CREATE UNIQUE INDEX "organization_members_org_user_unique_idx" ... ("organization_id","user_id")`
- A `CREATE INDEX "organization_members_user_id_idx" ... ("user_id")`

If any of the above is missing or incorrect, fix the table definitions in `functions/src/db/schema.ts` from Task 1 and update the SQL file accordingly.

> **Alternative (journal re-synced):** If `functions/drizzle/meta/_journal.json` is brought back in sync with all on-disk migrations first, `cd functions && npx drizzle-kit generate` can produce the migration and update journal/snapshots automatically. Until then, use the hand-written path above.

- [ ] **Step 2: Re-run typecheck**

Run: `cd functions && npm run typecheck`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add functions/drizzle/0015_organizations.sql
git commit -m "feat(db): add migration for organizations and organization_members"
```

---

## Out of scope (per spec)

- Frontend UI for organizations/members.
- Invitation/onboarding flow.
- Role-based authorization logic in callables/services.
- Soft-delete (`deleted_at`) or audit-trail columns.
- Drizzle `relations()` helpers.
- Running the migration against a live database (`drizzle-kit migrate`/`push`) — generating the SQL file is the deliverable; applying it is a deploy-time step outside this plan.

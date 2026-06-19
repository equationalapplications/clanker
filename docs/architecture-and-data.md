# Architecture & Data

## State Management Architecture

### Layer Overview

| Layer | Technology | Responsibility |
|---|---|---|
| Complex async flows | xState (machines) | Auth lifecycle, CRUD with optimistic rollback, multi-step flows |
| Server state / cache | TanStack Query + kvStorePersister | API data, background refetch, 24-hour offline cache |
| Local-first data | Expo SQLite | Messages, characters (always available offline) |
| Cross-cutting access | React Context (`GlobalStateContext`) | Exposes xState actor refs to the component tree |
| UI-local state | `useState` / `useEffect` | Transient UI state (modal visibility, form errors) |

### xState Machines

| Machine | File | Responsibility |
|---|---|---|
| `authMachine` | `src/machines/authMachine.ts` | Firebase auth bootstrap, Cloud SQL user/subscription state, sign-out |
| `termsMachine` | `src/machines/termsMachine.ts` | Check and record Terms of Service acceptance |
| `characterMachine` | `src/machines/characterMachine.ts` | Character CRUD with optimistic updates and rollback |

**When to add a new machine:** Create for features with two or more of: multiple sequential async steps, optimistic updates with rollback, complex conditional transitions, long-running background work, explicit loading/idle/error/success states needing isolated testing. Simple one-shot operations should use TanStack Query mutations instead.

**How to add a new machine:**
1. Create `src/machines/<feature>Machine.ts` following `characterMachine.ts` structure
2. Register in `GlobalStateContext` (`src/hooks/useMachines.ts`)
3. Spawn in `GlobalStateProvider` (`app/_layout.tsx`)
4. Wire cross-machine events in `AppOrchestrator` (`app/_layout.tsx`)
5. Write tests in `__tests__/<feature>Machine.test.ts`

### Inter-Machine Coordination (`AppOrchestrator`)

`GlobalStateProvider` in `app/_layout.tsx` creates and publishes actor refs. All cross-machine event forwarding is centralized in the nested `AppOrchestrator` component:

```
authMachine ──► USER_CHANGED (deduped by userId) ──────► characterMachine
           └──► AUTH_STATE_CHANGED (deduped by snapshot) ► termsMachine
```

`AppOrchestrator` uses direct `authService.subscribe(...)` subscriptions. Deduplication uses refs so child machines only receive events when the relevant slice of auth state changes. The coordination is intentionally a thin React component, not a root machine, so individual machines remain independently testable.

### `useCurrentPlan`

Reads subscription tier from `authMachine.context.subscription` (populated from the `exchangeToken` bootstrap payload). Uses `useSelector` to react to auth machine updates.

---

## Navigation (Expo Router)

### High-Level Flow

1. `app/_layout.tsx` sets up global providers and wraps navigation with `Stack`
2. `Stack.Protected` gates the authenticated drawer `/(drawer)` behind the Firebase user from `useAuth()`
3. When a signed-in user needs to accept terms, `app/(drawer)/_layout.tsx` routes them to `/accept-terms`
4. The drawer hosts bottom tabs plus profile, settings, and subscription flows

### Root Layout (`app/_layout.tsx`)

- Renders React Query, Theme, Auth, and Subscription providers
- Uses `Stack` with `Stack.Protected` wrappers: `guard={!!user}` exposes `(drawer)`, `guard={!user}` exposes `sign-in`
- `privacy`, `terms`, and `support` modals are globally accessible regardless of auth state
- No root `index.tsx`; navigation starts from the drawer once the guard passes

### Drawer Layout (`app/(drawer)/_layout.tsx`)

- Checks `useSubscriptionStatus()` on mount; redirects to `/accept-terms` when `needsTermsAcceptance` is true
- Drawer items: `(tabs)` (Chats), `profile`, `settings`, `subscribe`, `accept-terms` (hidden)

### Tabs Layout (`app/(drawer)/(tabs)/_layout.tsx`)

- Two-tab bottom navigator: `index` (chats overview), `characters` (character management stack)

### Characters Stack

```
characters/
├── _layout.tsx        # Stack wrapper
├── index.tsx          # Character list + create flow
└── [id]/
    ├── chat.tsx       # Conversation UI
    └── edit.tsx       # Character editor
```

### Auth & Terms Flow

1. User opens app → providers initialize in `RootLayout`
2. Firebase user exists? Yes → `(drawer)` routes available. No → `sign-in`
3. Inside drawer layout: `needsTermsAcceptance` → redirect to `/accept-terms`
4. Acceptance modal is optimistic: UI proceeds immediately while backend persistence completes

### Deep Links

`/sign-in`, `/privacy`, `/support`, `/terms`, `/characters`, `/characters/<id>/edit`, `/characters/<id>/chat`, `/subscribe`, `/accept-terms`

### Best Practices

- Use `router.replace` for modal redirects to keep back stack clean
- Keep auth logic centralized in `useAuth`
- Reserve `.web.ts` / `.native.ts` files for true platform differences
- Regenerate Expo Router types after structural changes: `npx expo start --clear`

---

## Offline Support Architecture

### Architecture Overview

| Layer | Technology | Role |
|---|---|---|
| Local DB | expo-sqlite (SQLite) | Source of truth for characters + messages |
| Query cache | TanStack Query v5 | In-memory cache with `offlineFirst` for local queries |
| Cache persistence | expo-sqlite/kv-store | Survives app restarts |
| Network detection | @react-native-community/netinfo | Drives `onlineManager`, triggers reconnect sync |
| Cloud backup | Cloud SQL `characters` table | Backup/restore for characters only |

Messages are **never synced to cloud** (privacy by design).

### Key Files

| File | Purpose |
|---|---|
| `src/config/networkManager.ts` | Bridges NetInfo → `onlineManager`; calls optional reconnect callback |
| `src/config/queryPersister.ts` | `Persister` impl using `expo-sqlite/kv-store` |
| `src/config/queryClient.ts` | `gcTime: 24h`; queries default `online`, mutations `offlineFirst` |
| `app/_layout.tsx` | Wraps app in `PersistQueryClientProvider`; sets up network manager + reconnect sync |
| `src/hooks/useCharacters.ts` | `networkMode: offlineFirst` — reads from SQLite, always works offline |
| `src/hooks/useMessages.ts` | `networkMode: offlineFirst` — reads from SQLite, always works offline |
| `src/services/characterService.ts` | Canonical character CRUD; talks to SQLite via `characterDatabase.ts` |
| `src/services/characterSyncService.ts` | `syncAllToCloud()` / `restoreFromCloud()` on reconnect + explicitly |
| `src/components/NetworkStatusBanner.tsx` | Offline indicator bar |

### How Offline Works

**App restart while offline:**
1. `PersistQueryClientProvider` restores previous cache from kv-store
2. After hydration, previously fetched queries show cached data without network request
3. Online queries are paused; stale cache shown if available
4. Characters and messages (`offlineFirst`) re-read from SQLite immediately

**Characters:** `getUserCharacters` reads from SQLite filtered to exclude soft-deleted rows. Creating/updating works fully offline with optimistic UI. Changes stored with `synced_to_cloud = 0`. On reconnect → `syncAllToCloud()` runs automatically.

**Messages:** All messages live in local SQLite only, forever. `offlineFirst` means chat history always available. Sending while offline: message saved locally; AI generation attempted — if offline, placeholder reply saved, user retries when online. (Future: offline AI queueing.)

**User profile/credits:** Cloud SQL-backed (`networkMode: 'online'`). When offline, persisted cache from last successful fetch shown. No offline writes.

### Character Cloud Sync

Only characters (not messages). Direction: local → cloud (local is source of truth).

**Conflict resolution:** Last-write-wins by `updated_at`.

**Sync triggers:**
1. App startup — `RootLayoutNav` triggers `syncAllToCloud()` when auth resolves and device is online
2. Reconnect — `setupNetworkManager` calls `syncAllToCloud()` on offline→online transition
3. Explicit — `syncAllToCloud()` / `restoreFromCloud()` directly

**Deletion flow:** `deleteCharacter()` sets `deleted_at = now(), synced_to_cloud = 0` → character disappears from UI → on next sync, `syncDeletionsToCloud` deletes from Cloud SQL → `hardDeleteCharacterLocal` removes from SQLite.

**Restore from cloud:** `restoreFromCloud()` imports all characters from Cloud SQL into local SQLite. Only cloud records with newer `updated_at` than local records are written.

### Hook Reference

| Hook | Source | Network Mode | Notes |
|---|---|---|---|
| `useCharacters()` | SQLite | offlineFirst | Full CRUD + optimistic updates |
| `useCharacter(id)` | SQLite | offlineFirst | Seeded from list cache |
| `useMessages(charId, userId)` | SQLite | offlineFirst | Polls every 5s for AI responses |
| `useUserPublicData()` | Cloud SQL | online | Persisted cache shown offline |
| `useUserPrivateData()` | Cloud SQL | online | Cached data with periodic refetch |
| `useUserProfile()` | Cloud SQL | online | Cached profile data refreshed by polling |

---

## Cloud Character Save & Share

Credit-gated (1 credit per cloud sync), opt-in per character. Available to any user with sufficient credits — including active monthly subscribers (`monthly_20`/`monthly_50`) and Pay-As-You-Go (`payg`) users with a positive credit balance.

### Data Model

SQLite `characters` has a `save_to_cloud` flag (INTEGER DEFAULT 0, schema version 5). Existing rows default to cloud-save off after migration.

### Sync Filter

Rows with `synced_to_cloud = 0` AND `save_to_cloud = 1` AND not soft-deleted.

### UI

- Character edit screen: "Save to Cloud" toggle (credit-gated; helper text notes 1 credit per sync), "Make Character Shareable" toggle (disabled unless cloud-save enabled)
- Share button (shown for shareable characters) provides social card with avatar, name, and public share URL using cloud UUID (`/characters/shared/{id}`)
- Characters list: cloud sync icon — imports latest cloud characters (auth required; no per-call credit charge for restore)

### Shared Character Import

- App calls `getPublicCharacter(characterId)` → imports/updates in local SQLite → routes to chat
- Imported shared characters are local copies with cloud-save disabled by default (`save_to_cloud = 0`)

### Share URL

- Uses `EXPO_PUBLIC_CHARACTER_SHARE_BASE_URL` (optional, fallback: `https://clanker-ai.com`)
- Web share URL + native deep link (`com.equationalapplications.clanker://`)

### Access Control

| Callable | Gate |
|---|---|
| `syncCharacter` | 1 credit reserved via `creditService.spendCredits` before upsert; refunded on failure. Available to monthly subscribers and `payg` users with sufficient credits. |
| `getUserCharacters` | Firebase Auth + App Check only (no credit charge) |
| `getPublicCharacter` | Firebase Auth + App Check only (no credit charge) |

Backend enforcement lives in `functions/src/characterFunctions.ts`. Client UI surfaces credit cost on the "Save to Cloud" toggle rather than blocking on plan tier.

---

## Avatar Gallery Upload

### Flow

1. User taps "Upload Photo" on character edit screen
2. App opens gallery picker via `expo-image-picker`
3. Image validated → converted to WebP via `expo-image-manipulator`
4. Converted file read as base64 → saved to SQLite `avatar_data` via local image service
5. Returned data URI set as character avatar in UI

**No cloud call and no credit deduction.**

### Constraints

- Minimum source image size: `200×200`
- Maximum output dimensions: `1024×1024` (aspect ratio preserved)
- Output mime type: `image/webp`

### Error Handling

- Picker cancel → returns `null`, no error
- Permission error → "Photo library access denied"
- Below minimum size → "Image too small. Minimum size is 200×200 pixels."
- Manipulation or SQLite errors → raw message in edit screen helper text

### Platform Notes

- iOS usage strings in app config: `ios.infoPlist.NSPhotoLibraryUsageDescription`, `expo-image-picker` plugin `photosPermission`
- Web uses browser file picker provided by `expo-image-picker`

---

## Cloud SQL Design (PostgreSQL)

Single-tenant PostgreSQL instance managed by Google Cloud SQL. Driver: `pg` (node-postgres). Connector: `@google-cloud/cloud-sql-connector`. ORM: Drizzle ORM.

**Current strategy:** Public IP (Cloud SQL Connector authenticates via IAM + TLS).  
**Pool settings:** `max: 5`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 10000`.

### Schema Tables

#### `users`
Canonical identity is `firebase_uid`. Columns: `id` (uuid PK), `firebase_uid` (unique, not null), `email` (unique, not null), `display_name`, `avatar_url`, `is_profile_public` (default false), `default_character_id`, `created_at`, `updated_at`.

Indexes: `firebase_uid` (unique), `email` (unique).

#### `subscriptions`
One per user (unique `user_id`). Columns: `id` (uuid PK), `user_id` (FK → users, cascade), `plan_tier` (default 'free', check: free/monthly_20/monthly_50/payg), `plan_status` (default 'active', check: active/cancelled/expired), `current_credits` (default 0), `terms_version`, `terms_accepted_at`, `stripe_subscription_id`, `stripe_customer_id`, `billing_cycle_start`, `billing_cycle_end`, `documents_ingested_count`, `documents_ingested_date`, `created_at`, `updated_at`.

Indexes: `user_id` (unique).

#### `credit_transactions`
Ledger for all credit mutations. Columns: `id` (uuid PK), `user_id` (FK → users, cascade), `delta` (not null), `reason` (not null), `reference_id`, `created_at`. Additional columns from credits redesign: `initial_amount`, `remaining_balance`, `transaction_type`, `expires_at`.

Indexes: `user_id`, partial unique index on `(user_id, reason, reference_id)` where `reference_id IS NOT NULL` (idempotency).

#### `characters`
Columns: `id` (uuid PK), `user_id` (FK → users, cascade), `name`, `avatar`, `appearance`, `traits`, `emotions`, `context`, `voice` (default 'Umbriel'), `is_public`, `created_at`, `updated_at`.

Index: `user_id`.

#### `messages`
Columns: `id` (uuid PK), `character_id` (FK → characters, cascade), `sender_user_id` (FK → users, cascade), `message_id`, `text`, `sender_name`, `sender_avatar`, `message_data` (jsonb), `created_at`.

Indexes: `character_id`, `sender_user_id`, `(character_id, created_at DESC)`.

#### `wiki_entries`
Structured memory facts. Soft-deleted via `deleted_at`. Columns: `id` (text PK), `character_id` (FK), `user_id` (FK), `title`, `body`, `tags` (jsonb), `confidence` (certain/inferred/tentative), `source_type` (user_stated/agent_inferred/user_confirmed/user_document), `source_hash`, `source_ref`, `created_at`, `updated_at`, `last_accessed_at`, `access_count`, `deleted_at`.

Indexes: `(character_id, user_id)`, `(character_id, deleted_at)`, `(updated_at DESC)`, partial on `source_hash`, partial on `source_ref`, GIN on tsvector for full-text search.

#### `agent_tasks`
Volatile goals. Soft-deleted via `deleted_at`. Columns: `id` (text PK), `character_id`, `user_id`, `description`, `status` (pending/in_progress/done/abandoned), `priority` (default 0), `due_context`, `created_at`, `updated_at`, `resolved_at`, `resolution_note`, `deleted_at`.

Indexes: `(character_id, user_id, status)`, `(priority DESC)`.

#### `memory_events`
Episodic append-only log. Columns: `id` (text PK), `character_id`, `user_id`, `event_type` (observation/decision/action/outcome), `summary`, `related_entry_id`, `related_task_id`, `source_ref`, `created_at`.

Index: `(character_id, user_id, created_at DESC)`.

### Instance Sizing

| Phase | vCPU | RAM | Storage | Availability | Est. Monthly |
|---|---|---|---|---|---|
| Launch (0 users) | 1 | 3.75-4 GB | 10 GB SSD, no autoresize | Single-zone | ~$45-105 |
| Early (up to 50 users) | 1 | 3.75-4 GB | 20-30 GB SSD, autoresize | Single-zone | ~$70-140 |
| Growth (50-200 users) | 2 | 8 GB | 30-50 GB SSD | Single-zone or HA | ~$140-320 (SZ) / ~$260-520 (HA) |
| Reliability-first | 2+ | 8+ GB | 50+ GB SSD | Regional HA | ~$260-700+ |

### Scaling Triggers

Move from 1 → 2 vCPU when: sustained CPU > 60%, memory pressure > 75%, p95 query latency exceeds SLO after tuning, or connection wait events increase despite pool `max: 5`.

Enable HA when: single-zone maintenance/restart downtime is unacceptable, or revenue/user impact from downtime is meaningful.

### Private-Only Access (Future)

**Prerequisites:** Compute Engine API, Serverless VPC Access API, Service Networking API, private IP range allocation, Private Services connection, VPC connector.

**Changes:** Allocate private IP + disable public IP on Cloud SQL, update function configs for VPC connector egress, change `IpAddressTypes.PUBLIC` → `PRIVATE` in `functions/src/db/cloudSql.ts`, redeploy.

**Cost:** ~$7-10/month additional (VPC connector).

---

## Cloud SQL Migrations

### Architecture

- ORM: Drizzle ORM (TypeScript)
- Schema: `functions/src/db/schema.ts`
- Migrations: `functions/drizzle/`
- Config: `functions/drizzle.config.ts`

> **Important:** There is no `__drizzle_migrations` tracking table in production. Migrations must be applied manually. Keep the "Applied Migrations" list in this file up to date.
>
> Before generating or applying migrations, verify `CLOUD_SQL_CONNECTION_NAME` points to the intended instance.

### Applied Migrations

| # | File | Notes |
|---|---|---|
| initial | `0000_dazzling_kid_colt.sql` | Initial schema |
| 1 | `0001_credit_transactions_idempotency.sql` | Idempotency index |
| 2 | `0002_users_timestamps_not_null.sql` | NOT NULL constraints |
| 3 | `0003_character_voice.sql` | `characters.voice` (applied manually, not in Drizzle journal) |
| 4 | `0004_wiki_memory.sql` | Wiki memory tables |
| 5 | `0004_lame_gwen_stacy.sql` | `source_hash`/`source_ref`, updated constraint |
| 6 | `0005_subscriptions_document_counter.sql` | Document counter columns |
| 7 | `0006_partial_source_hash_index.sql` | Partial index |
| 8 | `0007_source_ref_idx.sql` | Index on source_ref |
| 9 | `0008_wiki_memory_v2.sql` | LLM wiki tables + `characters.save_to_cloud` |
| 10 | `0009_odd_sandman.sql` | LLM wiki columns |
| 11 | `0010_fix_source_type_check.sql` | Fix CHECK constraint |
| 12 | `0011_credits_redesign.sql` | Credit transactions redesign |
| 13 | `0012_update_handle_new_user_trigger.sql` | Update signup credit trigger |

### Prerequisites

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project "${GCP_PROJECT}"
```

### Apply Migrations

1. Set project: `export GCP_PROJECT="your-project-id"`
2. Fetch secrets from Secret Manager:
   ```bash
   export CLOUD_SQL_CONNECTION_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_CONNECTION_NAME --project="${GCP_PROJECT}")
   export CLOUD_SQL_DB_USER=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_USER --project="${GCP_PROJECT}")
   export CLOUD_SQL_DB_PASS=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_PASS --project="${GCP_PROJECT}")
   export CLOUD_SQL_DB_NAME=$(gcloud secrets versions access latest --secret=CLOUD_SQL_DB_NAME --project="${GCP_PROJECT}")
   ```
3. Apply: `cd functions && MIGRATIONS="0013_my_new_migration.sql" node /tmp/migrate.mjs`

### Workflow for Schema Changes

1. Edit `functions/src/db/schema.ts`
2. Generate: `cd functions && npx drizzle-kit generate`
3. Review the generated SQL
4. Apply following the steps above
5. Commit both `schema.ts` and the migration SQL

---

## Support Page

- **Route:** `/support` — public, not behind auth guards
- **File:** `app/support.tsx`
- **Entry point:** Settings screen About section

### Content

- Contact: `info@equationalapplications.com`
- Direct Email Support button (`mailto:`)
- FAQ: credits/subscriptions, sign-in guidance, account deletion requests, how to contact support

### Maintenance Notes

- Keep FAQ answers short and user-facing
- Keep support email consistent with policy/compliance documents
- Update before App Store metadata updates if support workflows change
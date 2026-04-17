# Cloud SQL Design (PostgreSQL)

This document outlines the schema design for the dedicated Clanker Cloud SQL instance.

## Overview

The database is a single-tenant PostgreSQL instance managed by Google Cloud SQL. It replaces the previous Supabase multi-tenant architecture.

## Schema

### Tables

#### 1. `users`
Stores user profile information. Canonical identity is `firebase_uid`.

| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | `uuid` | PK, Default: `gen_random_uuid()` |
| `firebase_uid` | `text` | Unique, Not Null |
| `email` | `text` | Unique, Not Null |
| `display_name` | `text` | |
| `avatar_url` | `text` | |
| `is_profile_public` | `boolean` | Not Null, Default: `false` |
| `default_character_id` | `uuid` | |
| `created_at` | `timestamptz` | Default: `now()` |
| `updated_at` | `timestamptz` | Default: `now()` |

#### 2. `subscriptions`
Stores subscription state and credit balance.

| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | `uuid` | PK, Default: `gen_random_uuid()` |
| `user_id` | `uuid` | Unique, Not Null, FK: `users.id` (CASCADE) |
| `plan_tier` | `text` | Default: `'free'`, Check: `('free', 'monthly_20', 'monthly_50', 'payg')` |
| `plan_status` | `text` | Default: `'active'`, Check: `('active', 'cancelled', 'expired')` |
| `current_credits` | `integer` | Not Null, Default: `0` |
| `terms_version` | `text` | |
| `terms_accepted_at` | `timestamptz` | |
| `stripe_subscription_id`| `text` | |
| `stripe_customer_id` | `text` | |
| `billing_cycle_start` | `timestamptz` | |
| `billing_cycle_end` | `timestamptz` | |
| `created_at` | `timestamptz` | Default: `now()` |
| `updated_at` | `timestamptz` | Default: `now()` |

#### 3. `credit_transactions`
Ledger for all credit mutations.

| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | `uuid` | PK, Default: `gen_random_uuid()` |
| `user_id` | `uuid` | Not Null, FK: `users.id` (CASCADE) |
| `delta` | `integer` | Not Null |
| `reason` | `text` | Not Null |
| `reference_id` | `text` | |
| `created_at` | `timestamptz` | Default: `now()` |

#### 4. `characters`
User-created characters.

| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | `uuid` | PK, Default: `gen_random_uuid()` |
| `user_id` | `uuid` | Not Null, FK: `users.id` (CASCADE) |
| `name` | `text` | Not Null |
| `avatar` | `text` | |
| `appearance` | `text` | |
| `traits` | `text` | |
| `emotions` | `text` | |
| `context` | `text` | |
| `is_public` | `boolean` | Not Null, Default: `false` |
| `created_at` | `timestamptz` | Default: `now()` |
| `updated_at` | `timestamptz` | Default: `now()` |

#### 5. `messages`
Chat history between users and characters.

| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | `uuid` | PK, Default: `gen_random_uuid()` |
| `character_id` | `uuid` | Not Null, FK: `characters.id` (CASCADE) |
| `sender_user_id` | `uuid` | Not Null, FK: `users.id` (CASCADE) |
| `message_id` | `text` | Not Null |
| `text` | `text` | Not Null |
| `sender_name` | `text` | |
| `sender_avatar` | `text` | |
| `message_data` | `jsonb` | Not Null, Default: `'{}'` |
| `created_at` | `timestamptz` | Default: `now()` |

## Indexes

- `users.firebase_uid` (Unique)
- `users.email` (Unique)
- `subscriptions.user_id` (Unique)
- `characters.user_id`
- `messages.character_id`
- `messages.sender_user_id`
- `messages.(character_id, created_at DESC)`
- `credit_transactions.user_id`

## Connectivity

- Environment: Firebase Cloud Functions (Node.js 22)
- Driver: `pg` (node-postgres)
- Connector: `@google-cloud/cloud-sql-connector`
- ORM: Drizzle ORM
- Connection Strategy: Private IP via VPC Connector
- Pool Settings:
    - `max: 5`
    - `idleTimeoutMillis: 30000`
    - `connectionTimeoutMillis: 10000`

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
- Database version target: PostgreSQL 18
- Driver: `pg` (node-postgres)
- Connector: `@google-cloud/cloud-sql-connector`
- ORM: Drizzle ORM
- **Current strategy**: Public IP (Cloud SQL Connector authenticates via IAM + TLS)
- **Future strategy**: Private IP via VPC Connector (see [Private-Only Access](#private-only-access))
- Pool Settings:
    - `max: 5`
    - `idleTimeoutMillis: 30000`
    - `connectionTimeoutMillis: 10000`

## Private-Only Access (Future)

Currently the instance uses a public IP address. For production security hardening, migrate to private-only access:

### Prerequisites

- **Compute Engine API** — Enable for VPC infrastructure management
- **Serverless VPC Access API** — Enable for Cloud Functions ↔ VPC connectivity
- **Service Networking API** — Enable for Private Services Access (VPC peering)
- **Private IP range allocation** — 10.0.0.0/16 or similar on default VPC
- **Private Services connection** — Peer allocated range to Google-managed network
- **VPC connector** — Create Serverless VPC Access connector in `us-central1` (e2-micro, 2–4 instances)

### Changes Required

1. **Cloud SQL instance** — Allocate private IP address + disable public IP (brief restart ~1–2 min)
2. **Cloud Functions** — Update all function configs to use VPC connector egress
3. **Code** — Change `IpAddressTypes.PUBLIC` → `IpAddressTypes.PRIVATE` in [functions/src/db/cloudSql.ts](../functions/src/db/cloudSql.ts)
4. **Deploy** — Redeploy functions after infra and code changes

### Cost Implications

- **VPC Connector** — ~$7–$10/month (e2-micro instances, 2–4 replicas)
- **Cloud SQL** — No change (public/private IP at no additional cost)
- **Total monthly increase** — ~$7–$10

### Timing

Schedule for post-launch hardening once application stability is confirmed. Not required for MVP.

## Instance Sizing Recommendations

### Production (Launch, 0 users)

| Setting | Value |
| :--- | :--- |
| Edition | Cloud SQL Enterprise |
| Instance class | 1 vCPU, 3.75–4 GB RAM |
| Availability | Single-zone |
| Storage | 10 GB SSD with no autoresize enabled |
| PITR | 7 days |
| Backups | Daily automated + binary logging |
| Estimated monthly cost | ~$45–$105 |

### Early Production (Up to 50 light users, low concurrency)

| Setting | Value |
| :--- | :--- |
| Edition | Cloud SQL Enterprise |
| Instance class | 1 vCPU, 3.75–4 GB RAM |
| Availability | Single-zone initially |
| Storage | 20–30 GB SSD with autoresize enabled |
| PITR | 14–30 days |
| Backups | Daily automated + binary logging |
| Estimated monthly cost | ~$70–$140 |

### Growth Phase (50–200 users, noticeable concurrency spikes)

| Setting | Value |
| :--- | :--- |
| Edition | Cloud SQL Enterprise |
| Instance class | 2 vCPU, 8 GB RAM |
| Availability | Single-zone initially; HA if downtime < SLO |
| Storage | 30–50 GB SSD with autoresize enabled |
| PITR | 14–30 days |
| Backups | Daily automated + binary logging |
| Estimated monthly cost | ~$140–$320 (single-zone); ~$260–$520 (HA) |

### Reliability-First Production (Revenue-impacting downtime)

| Setting | Value |
| :--- | :--- |
| Edition | Cloud SQL Enterprise |
| Instance class | 2+ vCPU, 8+ GB RAM |
| Availability | Regional HA enabled |
| Storage | 50+ GB SSD with autoresize enabled |
| PITR | 30 days |
| Backups | Daily automated + binary logging |
| Estimated monthly cost | ~$260–$700+ |

## Scaling Triggers

Move from 1 vCPU to 2 vCPU when any of the following occur:

- **CPU**: Sustained CPU usage > 60% during peak windows
- **Memory**: Memory pressure > 75% or swap activity observed
- **Query latency**: p95 query latency exceeds SLO (e.g., > 150–200 ms) after query/index tuning
- **Connection contention**: Connection wait events increase despite small function pool (`max: 5`)

Enable HA when:

- Single-zone maintenance/restart downtime is unacceptable
- Recovery expectations are strict (business or compliance driven)
- Revenue or user impact from downtime is meaningful

## Connection Pool Sizing

The application uses a connection pool with `max: 5`. Cloud Functions can auto-scale independently, meaning multiple function instances may exist simultaneously. A 1 vCPU Cloud SQL instance typically supports ~100 connections.

- **Safe headroom**: Up to ~20 concurrent function instances before hitting the connection ceiling
- **For 5 users**: Connection exhaustion is effectively impossible under normal use
- **Monitoring**: Track `pg_stat_activity` connection count or Cloud SQL's `cloudsql.googleapis.com/database/postgresql/num_backends` metric. Scale if connections regularly exceed 60–70% of `max_connections`

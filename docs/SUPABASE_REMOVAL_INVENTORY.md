# Supabase Removal Inventory

This document tracks all files, functions, hooks, and tests that are coupled to Supabase and must be refactored or removed during the migration to Cloud SQL.

## Functions Layer

- `functions/src/supabaseAdmin.ts`
  - `findSupabaseUserByEmail`
  - `findSupabaseUserByFirebaseUid`
  - `callSupabaseRpc`
  - `upsertUserSubscription`
- `functions/src/exchangeToken.ts`
  - Depends on `@equationalapplications/firebase-auth-supabase-bridge`
  - Returns Supabase access/refresh session tokens
- `functions/src/spendCredits.ts`
  - Uses Supabase RPC `spend_user_credits`
- `functions/src/revenueCatWebhook.ts`
  - Use Supabase RPC and REST table upserts
- `functions/src/stripeWebhook.ts`
  - Use Supabase RPC and REST table upserts
- `functions/src/generateReply.ts`
  - Query subscription/credits state
  - Invoke Supabase-backed credit spend behavior
- `functions/src/generateImage.ts`
  - Query subscription/credits state
  - Invoke Supabase-backed credit spend behavior
- `functions/src/billing.ts`
  - Parses and validates Supabase-backed credit/subscription results
- `functions/src/runtimeConfig.ts`
  - Reads Supabase runtime configuration values

## Client Layer

- `src/config/supabaseClient.ts`
  - Central direct DB client
- `src/machines/authMachine.ts`
  - Relies on Supabase tokens
- `src/auth/getSupabaseUserSession.ts`
- `src/utilities/getSupabaseSession.ts`
- `src/utilities/getSupabaseUserId.ts`
- `src/hooks/useCurrentPlan.ts`
- `src/services/userService.ts`
- `src/services/characterSyncService.ts`
- `src/machines/termsMachine.ts`
- `src/utilities/getUserCredits.ts`
- `src/hooks/useUser.ts` (Realtime profile subscription)
- `src/utilities/deleteUser.ts` (calls `deleteUserSupabase()`)
- `src/services/characterService.ts`
- `src/database/characterDatabase.ts` (`cloud_id` field)
- `src/database/messageDatabase.ts` (Comments)
- `src/services/messageService.ts` (Comments)

## App Routes/Screens

- `app/_layout.tsx`
- `app/index.tsx`
- `app/sign-in.tsx`
- `app/checkout/success.tsx`
- `app/(drawer)/subscribe.tsx`
- `app/(drawer)/profile.tsx`

## Tests

- `__tests__/creditsDisplayPurchase.test.tsx` (mocks `supabaseClient`)
- `__tests__/useCurrentPlan.test.tsx` (uses `supabaseSession` in fixtures)

## Dependencies

- `@equationalapplications/firebase-auth-supabase-bridge` (functions)
- `@supabase/supabase-js` (app + functions)

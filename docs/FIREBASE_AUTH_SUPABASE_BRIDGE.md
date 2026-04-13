# firebase-auth-supabase-bridge

The `exchangeToken` Cloud Function delegates all generic Firebase-to-Supabase
session logic to the [`@equationalapplications/firebase-auth-supabase-bridge`](https://github.com/equationalapplications/firebase-auth-supabase-bridge)
npm package.

## What the library does

- Finds or creates the Supabase user corresponding to the Firebase UID/email
- Handles soft-deleted user recreation (422 path)
- Generates a Supabase session via Admin magic-link + OTP verify
- Provides an optional `onUserReady` hook called once when a user is first created

## What stays in this repo

- The `onCall` wrapper with Firebase-specific error mapping, `enforceAppCheck`,
  and secrets config

See the library README for full API docs and usage examples.

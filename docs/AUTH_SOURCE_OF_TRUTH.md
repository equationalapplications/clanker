# Auth: Source of Truth (Firebase) and Supabase as Secondary

Summary

Firebase Auth is the canonical identity provider for the Yours Brightly application. Supabase is used downstream for application sessions, Row Level Security, and data storage.

How it works (concise)

1. Client authenticates with Firebase.
2. Client calls callable function `exchangeToken`.
3. Function maps Firebase email → Supabase user (find or create).
4. Function returns Supabase access & refresh tokens.
5. Client calls `supabaseClient.auth.setSession(...)` to establish the Supabase session.

See `docs/AUTH_FLOW.md` for a full, step-by-step flow and troubleshooting.

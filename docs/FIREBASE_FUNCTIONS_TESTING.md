# Firebase Functions Testing

This document describes the test strategy and local test commands for Cloud Functions in this repository.

## Scope

The tests in `functions/src/*.test.ts` focus on function-level behavior:

- Callable auth and input validation (`exchangeToken`, `spendCredits`, `purchasePackageStripe`)
- Webhook request validation (`stripeWebhook`, `revenueCatWebhook`)
- Happy-path Supabase RPC/session flow for key callables using mocked `fetch`

The suite intentionally avoids live network calls to Stripe, Supabase, and Firebase Auth.

## Commands

Run from the `functions/` directory:

```bash
npm run typecheck
npm run lint
npm run test
```

- `typecheck` validates TypeScript without emitting output.
- `lint` runs ESLint for Functions sources and tests.
- `test` compiles TypeScript into `functions/lib` and executes Node's built-in test runner.

## Runtime Config Reference

Checkout-related function flows depend on these non-sensitive params being set in your target environment:

- `STRIPE_SUCCESS_URL=https://clanker-ai.com/checkout/success`
- `STRIPE_CANCEL_URL=https://clanker-ai.com/checkout/cancel`

Stripe checkout tests also assume `STRIPE_SECRET_KEY` is set to a valid key-like value (for example `sk_test_...`).
The callable now fails fast with `failed-precondition` if `STRIPE_SECRET_KEY` is missing or contains non-printable characters.

## Test Design Notes

- Tests call exported internal handlers directly (`*Handler`) so they can assert behavior without emulator setup.
- For Supabase flows, tests replace `globalThis.fetch` with deterministic responses and restore it after each test.
- Webhook tests use in-memory request/response recorders to validate status codes and response bodies for guard-rail logic.
- Stripe purchase tests include fail-fast coverage for missing checkout URL config and malformed Stripe secret values.

## Adding New Function Tests

1. Add or expose a handler symbol in the function module when needed.
2. Create a sibling `*.test.ts` file in `functions/src`.
3. Keep external systems mocked and assert both returned payloads and validation errors.
4. Re-run `npm run typecheck && npm run lint && npm run test` from `functions/`.

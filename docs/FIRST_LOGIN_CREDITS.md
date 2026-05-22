# First Login Credits

New users receive **50 free credits** upon their first login (via `exchangeToken`).

## How it works

1. `exchangeToken` calls `subscriptionService.getOrCreateDefaultSubscription(userId)`.
2. That function checks whether a `credit_transactions` row with `transaction_type = 'signup'` exists.
3. If the user is new (no existing credits), it calls `creditService.addCredits(userId, 50, null, 'signup')`.
4. This inserts a `credit_transactions` row with:
   - `initial_amount = 50`
   - `remaining_balance = 50`
   - `transaction_type = 'signup'`
   - `expires_at = NULL` (never expires)

## Properties of signup credits

- **Never expire.** `expires_at = NULL` — these credits remain available indefinitely.
- **Spent last.** The spend algorithm orders by `expires_at NULLS LAST`, so expiring credits are spent before signup credits.
- **Not affected by subscription expiry.** The expiry `UPDATE` that runs on subscription renewal targets `transaction_type = 'subscription'` only — signup credits are never touched.

## Credit model reference

| Grant type | Amount | Expiry |
|---|---|---|
| Free signup | 50 | Never |
| Monthly subscription | 300/cycle | End of billing cycle |
| One-time pack | 100 | 31 days from purchase |

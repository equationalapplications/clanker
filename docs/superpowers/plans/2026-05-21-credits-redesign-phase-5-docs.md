# Credits Redesign Phase 5: Documentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update all documentation to reflect the new credit model: no unlimited tier, 300 credits/month subscription, 100 credits one-time, 31-day expiry for paid credits, free signup credits never expire, all features open to any user with sufficient credits.

**Architecture:** Documentation-only changes. No code changes. Every doc that mentions "unlimited", "premium only", "credits never expire", or "credits not consumed for subscribers" must be updated.

**Tech Stack:** Markdown

**Branches:**
origin branch for PR: feat/credits-phase-5-docs
local worktree branch for PR: feat/credits-phase-5-docs

---

## Prerequisite

Phases 1–4 merged to staging.

---

## File Structure

- Modify: `docs/PAYMENT_INTEGRATION.md`
- Modify: `docs/PAYMENT_API.md`
- Modify: `docs/FIRST_LOGIN_CREDITS.md`
- Modify: `app/support.tsx` (in-app FAQ)
- Modify: any other docs found by grep

---

## Task 1: Audit All Docs for Outdated Language

- [ ] **Step 1: Find all occurrences of outdated terms**

```bash
grep -rn \
  "unlimited\|premium only\|credits never expire\|credits not consumed\|UNLIMITED_TIERS\|PREMIUM_TIERS\|monthly subscription.*unlimited\|subscription.*unlimited" \
  ./docs/ \
  ./app/support.tsx \
  2>/dev/null
```

Record every file and line that matches. These are all the locations that need updating.

- [ ] **Step 2: Commit the audit findings as a note (optional)**

If there are many files, you may want to note them in a scratch comment at the top of this checklist before proceeding.

---

## Task 2: Update `docs/PAYMENT_INTEGRATION.md`

- [ ] **Step 1: Update product and credit descriptions**

Find and replace all occurrences of:

| Old text | New text |
|---|---|
| "unlimited credits at $20/month" | "300 credits per billing cycle at $20/month" |
| "credits not consumed if user has monthly subscription" | "all features consume credits; monthly subscription grants 300 credits/cycle" |
| "credits never expire" | "free signup credits never expire; subscription credits expire at billing cycle end; one-time credits expire 31 days after purchase" |

- [ ] **Step 2: Update webhook event→action mapping table**

If `PAYMENT_INTEGRATION.md` has a table like:

| Event | Action |
|---|---|
| `checkout.session.completed` (subscription) | Grant unlimited credits |
| `customer.subscription.updated` | (no credit action) |

Replace with:

| Event | Action |
|---|---|
| `checkout.session.completed` (subscription) | Expire old subscription credits; grant 300 credits expiring at `current_period_end` |
| `checkout.session.completed` (credit pack) | Grant 100 credits expiring 31 days from now |
| `customer.subscription.updated` (renewal) | `renewSubscriptionCredits(userId, 300, cycleEnd, eventId)` — atomic: idempotency check → expire old → grant new |
| `invoice.payment_succeeded` (credit pack fallback) | Grant 100 credits expiring 31 days from now |
| `charge.refunded` | Deduct credits as before |
| `customer.subscription.deleted` | No credit action — credits expire naturally at `expires_at` |

Add note: "Idempotency check MUST run before any DB writes (including the expiry UPDATE). Guard first, write second."

- [ ] **Step 3: Commit**

```bash
git add docs/PAYMENT_INTEGRATION.md
git commit -m "docs: update PAYMENT_INTEGRATION for new credit model"
```

---

## Task 3: Update `docs/PAYMENT_API.md`

- [ ] **Step 1: Update product descriptions**

Find and update product listings:

```markdown
## Products

### Monthly Subscription — $20/month
- Grants **300 credits** per billing cycle
- Credits expire at the end of each billing cycle
- Renewing the subscription expires old subscription credits and grants a fresh 300

### Credit Pack — $10 one-time
- Grants **100 credits**
- Expires **31 days** from purchase date

### Free Signup
- New users receive **50 credits** on first login
- These credits **never expire** (`expires_at = NULL`)
```

Remove any "unlimited" product tier description.

- [ ] **Step 2: Update `addCredits` API docs**

If the doc describes the `addCredits` function signature, update it:

```markdown
## creditService.addCredits

**Signature:** `addCredits(userId, amount, expiresAt, transactionType, referenceId?)`

- `expiresAt`: `Date | null` — `null` means never expires (signup credits only)
- `transactionType`: `'signup' | 'subscription' | 'one_time' | 'legacy'`
- `referenceId`: optional idempotency key (Stripe/RevenueCat event ID)
```

- [ ] **Step 3: Update `spendCredits` API docs**

```markdown
## creditService.spendCredits

**Signature:** `spendCredits(userId, amount): Promise<string | null>`

Spends `amount` credits from the earliest-expiring qualifying row. Returns the
`transactionId` of the decremented row (used for `refundCredit` on failure), or
`null` if no row has sufficient `remaining_balance`.

Spend order: earliest `expires_at` first. Free credits (`expires_at = NULL`) are
spent last.
```

- [ ] **Step 4: Add `refundCredit` docs**

```markdown
## creditService.refundCredit

**Signature:** `refundCredit(userId, transactionId, amount): Promise<void>`

Atomically increments `remaining_balance` on the specified `credit_transactions`
row. Called when an API invocation fails after credits were spent. Credits are
restored to the original grant row — `expires_at` is unchanged, no extension granted.
```

- [ ] **Step 5: Commit**

```bash
git add docs/PAYMENT_API.md
git commit -m "docs: update PAYMENT_API for new creditService signatures and product model"
```

---

## Task 4: Update `docs/FIRST_LOGIN_CREDITS.md`

- [ ] **Step 1: Update to reflect signup credit design**

Replace the existing content with accurate information:

```markdown
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
- **Not affected by subscription expiry.** The expiry UPDATE that runs on subscription renewal targets `transaction_type = 'subscription'` only — signup credits are never touched.

## Credit model reference

| Grant type | Amount | Expiry |
|---|---|---|
| Free signup | 50 | Never |
| Monthly subscription | 300/cycle | End of billing cycle |
| One-time pack | 100 | 31 days from purchase |
```

- [ ] **Step 2: Commit**

```bash
git add docs/FIRST_LOGIN_CREDITS.md
git commit -m "docs: update FIRST_LOGIN_CREDITS for new credit_transactions model"
```

---

## Task 5: Update In-App Support / FAQ (`app/support.tsx`)

- [ ] **Step 1: Update FAQ entries**

Open `app/support.tsx`. Find FAQ entries related to credits and subscriptions. Update or replace:

**"How do credits work?"**
```
Clanker uses a credit system. Every AI feature costs credits:
• Chat replies: 1 credit
• Image generation: 1 credit
• Voice replies: 2 credits
• Document import: 1 credit
• Memory / wiki: 1 credit

You start with 50 free credits that never expire.
```

**"How do I get more credits?"**
```
Two options:
• Monthly subscription ($20/month): 300 credits per billing cycle, renewed automatically
• One-time pack ($10): 100 credits, valid for 31 days

Purchase from the Subscribe screen in the app.
```

**"Do credits expire?"**
```
• Free signup credits (50 credits): never expire
• Monthly subscription credits: expire at the end of each billing cycle
• One-time credit pack credits: expire 31 days after purchase

Your credit balance and next expiry date are shown in the Credits section.
```

**"What happened to unlimited credits?"**
```
The unlimited credits plan has been retired. Monthly subscribers now receive
300 credits per billing cycle. Your existing credits remain unaffected.
```

Remove any FAQ entries referencing "unlimited access", "premium-only features", or "credits never run out for subscribers".

- [ ] **Step 2: Commit**

```bash
git add app/support.tsx
git commit -m "docs(in-app): update FAQ for new credit model, remove unlimited references"
```

---

## Task 6: Final Audit

- [ ] **Step 1: Final grep across all docs and app content**

```bash
grep -rni "unlimited\|premium only\|credits not consumed\|credits never expire" \
  ./docs/ \
  ./app/ \
  2>/dev/null
```

For each result:
- If it's in a file already updated, fix the remaining instance
- If it's in a new file not yet addressed, update it now

- [ ] **Step 2: Final commit**

```bash
git add -A
git commit -m "docs: final cleanup — remove all unlimited/premium-only references from docs and app content"
```

---

## Phase 5 Complete

All 5 phases are now merged to staging. The system is ready for a single production release.

**Pre-release checklist:**
- [ ] All 5 phase PRs merged to `staging`
- [ ] Full CI test suite passes on `staging`
- [ ] DB migration 0011 has been applied to production DB (coordinate with deploy)
- [ ] Admin script run for existing `monthly_20` subscribers: expire old credits, grant 300 new
- [ ] Staging smoke test: new user signup gets 50 credits, purchase flow grants credits with expiry
- [ ] Merge `staging` → `main` and deploy

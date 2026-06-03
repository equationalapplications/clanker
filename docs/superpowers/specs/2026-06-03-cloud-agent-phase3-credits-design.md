# Cloud Agent — Phase 3: Metered Billing & Credit Sync

**Date:** 2026-06-03
**Status:** Spec
**Epic:** Epic 2 — Cloud Agent
**Goal:** Deduct 1 credit per successful cloud-agent run, return the updated balance in `usageSnapshot`, and sync it to the Expo frontend's auth machine state in real time.

---

## 1. Context & Motivation

Phase 2 shipped the Expo → Cloud Agent HTTP bridge. Every `POST /agent/run` call returns `{ usageSnapshot: null }` — cloud-agent access is currently free. Phase 3 closes the billing gap by wiring the existing credit economy (per `2026-05-21-credits-model-redesign.md`) into the cloud-agent path.

**Key constraints from the credits redesign spec:**

- No "unlimited" bypass. Every feature call costs 1 credit.
- Spend order: earliest-expiring grant first (`ORDER BY expires_at ASC NULLS LAST`).
- Pattern for callables: **spend → execute → refund on failure** (the Saga pattern). Never execute before spending.
- UI gates on `remainingCredits <= 0`, not on `planTier`. The cloud-agent does not need to know or return `planTier`/`planStatus`.

---

## 2. Architecture

### Data flow

```
Expo: ChatView credits <= 0 → router.push('/subscribe')  [pre-flight, no change needed]

Expo: callCloudAgent()
  → POST /agent/run (Bearer token)

cloud-agent: requireFirebaseAuth → userId
  → creditService.spendCredit(userId)
      → INSUFFICIENT_CREDITS → 402
  → runAgentFn()
      → ADK error → creditService.refundCredit(userId, txId) → 500
  → creditService.getBalance(userId)  [graceful degrade on failure → null]
  → res.json({ reply, toolCalls, usageSnapshot: { remainingCredits } | null })

Expo: cloudAgentService parses usageSnapshot
  → authService.send(USAGE_SNAPSHOT_RECEIVED, { remainingCredits, planTier: null, planStatus: null })
  → auth machine partial-patches subscription.currentCredits
  → header badge ticks down immediately

Expo catch (402):
  → authService.send(USAGE_SNAPSHOT_RECEIVED, { remainingCredits: 0 })  [self-heal stale UI]
  → rethrow → mutation onError (no rollback, same as failed-precondition)
```

### What does NOT change

- `cloud-agent/src/db/schema.ts` — no new tables added
- `functions/` — untouched
- `ChatView.tsx` — already gates on `credits <= 0 → /subscribe`
- `AppOptions` / `runAgentFn` interface — unchanged
- The Firebase `generateReply` path — unchanged

---

## 3. Files

| Action | Path | Change |
|--------|------|--------|
| **Create** | `cloud-agent/src/services/creditService.ts` | Three raw SQL functions |
| **Modify** | `cloud-agent/src/index.ts` | Wrap `runAgentFn` with spend/refund, return `usageSnapshot` |
| **Modify** | `cloud-agent/src/index.test.ts` | Tests for 402, spend/refund, usageSnapshot |
| **Create** | `cloud-agent/src/services/creditService.test.ts` | Unit tests for creditService |
| **Modify** | `src/services/cloudAgentService.ts` | Handle 402, parse `usageSnapshot`, update `CloudAgentResult` type |
| **Modify** | `src/hooks/useAIChat.ts` | Send `USAGE_SNAPSHOT_RECEIVED` from cloud agent response and on 402 |
| **Modify** | `__tests__/cloudAgentService.test.ts` | Tests for 402 throw and usageSnapshot parsing |
| **Modify** | `__tests__/useAIChat.test.tsx` | Tests for USAGE_SNAPSHOT_RECEIVED dispatch and 402 self-heal |

---

## 4. `cloud-agent/src/services/creditService.ts`

Three raw SQL functions. No Drizzle schema additions — queries target `credit_transactions` and `subscriptions` tables directly via `db.execute(sql`...`)`.

### `spendCredit(userId: string): Promise<string>`

```sql
UPDATE credit_transactions
SET remaining_balance = remaining_balance - 1
WHERE id = (
  SELECT id FROM credit_transactions
  WHERE user_id = $userId
    AND remaining_balance >= 1
    AND (expires_at IS NULL OR expires_at > NOW())
  ORDER BY expires_at ASC NULLS LAST
  LIMIT 1
  FOR UPDATE
)
RETURNING id
```

Also decrements `subscriptions.current_credits` by 1 to keep the Firebase-side cache in sync:

```sql
UPDATE subscriptions SET current_credits = current_credits - 1 WHERE user_id = $userId
```

Throws `"INSUFFICIENT_CREDITS"` if no qualifying row (0 rows returned).
Returns the `id` of the decremented row (`txId`) for use by `refundCredit`.

### `refundCredit(userId: string, txId: string): Promise<void>`

```sql
UPDATE credit_transactions
SET remaining_balance = remaining_balance + 1
WHERE id = $txId AND user_id = $userId
```

Also increments `subscriptions.current_credits` by 1.

The `userId` guard prevents cross-user spoofing of `txId`.

### `getBalance(userId: string): Promise<number>`

```sql
SELECT COALESCE(SUM(remaining_balance), 0) AS total
FROM credit_transactions
WHERE user_id = $userId
  AND (expires_at IS NULL OR expires_at > NOW())
```

Returns `0` on null (no rows). Safe to call after `spendCredit` — returns the authoritative post-spend balance for the `usageSnapshot`.

---

## 5. `cloud-agent/src/index.ts` — route changes

The `POST /agent/run` handler wraps the existing `runAgentFn` call. No other route logic changes. `AppOptions`/`runAgentFn` interface is unchanged (credit logic lives at the route level, not in the factory, so `runAgentFn` unit tests remain isolated).

**Execution order (replaces current `result = await runAgentFn(...)` block):**

```typescript
// 1. SPEND FIRST
let txId: string
try {
  txId = await creditService.spendCredit(userId)
} catch (err: any) {
  if (err.message === 'INSUFFICIENT_CREDITS') {
    res.status(402).json({ error: 'Insufficient credits' })
    return
  }
  throw err  // real DB error → existing 500 handler
}

// 2. EXECUTE
let result: { reply: string; toolCalls: string[] }
try {
  result = await runAgentFn({ db, userId, characterId, systemInstruction, message, history })
} catch (adkErr) {
  try {
    await creditService.refundCredit(userId, txId)
  } catch (refundErr) {
    // Log + swallow — don't mask the original ADK error
    console.error(`[CRITICAL] refundCredit failed for user ${userId} txId ${txId}`, refundErr)
  }
  throw adkErr  // → existing 500 handler
}

// 3. GET BALANCE (graceful degrade)
let newBalance: number | null = null
try {
  newBalance = await creditService.getBalance(userId)
} catch (balErr) {
  console.warn(`getBalance failed for user ${userId}, returning null snapshot`, balErr)
}

// 4. RESPOND
res.json({
  reply: result.reply,
  toolCalls: result.toolCalls,
  usageSnapshot: newBalance !== null ? { remainingCredits: newBalance } : null,
})
```

**Error handling decisions:**

| Failure point | Behavior | Reason |
|---|---|---|
| `spendCredit` → `INSUFFICIENT_CREDITS` | 402, halt | User has no credits |
| `spendCredit` → DB error | rethrow → 500 | Real infra failure |
| `runAgentFn` throws | refund then rethrow → 500 | User paid; must restore credit |
| `refundCredit` throws | log + swallow, rethrow ADK error | Don't mask root cause; credit manually recoverable via admin |
| `getBalance` throws | log + swallow, `usageSnapshot: null` | User already got their reply; client uses cached balance |

---

## 6. `src/services/cloudAgentService.ts` — frontend changes

**Type change:**

```typescript
export interface CloudAgentResult {
  reply: string
  toolCalls: string[]
  usageSnapshot: { remainingCredits: number } | null  // added
}
```

**Response handling** (after existing auth header, before `!response.ok`):

```typescript
if (response.status === 402) {
  throw new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS')
}
if (!response.ok) {
  throw new Error(`Cloud Agent responded with ${response.status}`)
}
const data = await response.json() as { reply?: string; toolCalls?: string[]; usageSnapshot?: { remainingCredits?: number } | null }
// ...existing reply validation...
return {
  reply: data.reply,
  toolCalls: data.toolCalls ?? [],
  usageSnapshot: typeof data.usageSnapshot?.remainingCredits === 'number'
    ? { remainingCredits: data.usageSnapshot.remainingCredits }
    : null,
}
```

---

## 7. `src/hooks/useAIChat.ts` — frontend changes

**On success** (after `callCloudAgent`, before existing `return { usageSnapshot: null }`):

```typescript
if (agentResult.usageSnapshot) {
  authService.send({
    type: 'USAGE_SNAPSHOT_RECEIVED',
    source: 'cloudAgent',
    remainingCredits: agentResult.usageSnapshot.remainingCredits,
    planTier: null,      // preserve existing value in auth machine
    planStatus: null,    // preserve existing value
    verifiedAt: new Date().toISOString(),
  })
}
```

**On 402 in catch block** (before rethrowing):

```typescript
if (err instanceof Error && err.message === 'CLOUD_AGENT_INSUFFICIENT_CREDITS') {
  authService.send({
    type: 'USAGE_SNAPSHOT_RECEIVED',
    source: 'cloudAgent',
    remainingCredits: 0,
    planTier: null,
    planStatus: null,
    verifiedAt: new Date().toISOString(),
  })
  // No rollback — same behavior as functions/failed-precondition
  queryClient.invalidateQueries({ queryKey: messageKeys.list(characterId, userId) })
}
throw err
```

**Pre-flight check:** `ChatView.tsx` already handles `credits <= 0 → router.push('/subscribe')` before `sendMessage` is called. No changes needed.

---

## 8. Testing

### `cloud-agent/src/services/creditService.test.ts`

- `spendCredit`: qualifying row exists → decrements, returns txId
- `spendCredit`: no qualifying row → throws `INSUFFICIENT_CREDITS`
- `spendCredit`: expired row ignored (past `expires_at`)
- `refundCredit`: increments the correct row; userId guard prevents wrong-user update
- `getBalance`: sum of non-expired rows; expired rows excluded; no rows → 0

### `cloud-agent/src/index.test.ts` additions

- 402 when `spendCredit` throws `INSUFFICIENT_CREDITS`
- Calls `refundCredit` when `runAgentFn` throws; then returns 500
- Returns `usageSnapshot: { remainingCredits: N }` on success
- Returns `usageSnapshot: null` when `getBalance` throws (graceful degrade)

### `__tests__/cloudAgentService.test.ts` additions

- 402 response → throws `CLOUD_AGENT_INSUFFICIENT_CREDITS`
- Valid `usageSnapshot` in response → parsed into result
- Missing/malformed `usageSnapshot` → returns `null`

### `__tests__/useAIChat.test.tsx` additions

- Successful cloud agent call with `usageSnapshot` → `USAGE_SNAPSHOT_RECEIVED` sent with `remainingCredits`
- Successful call with `usageSnapshot: null` → no `USAGE_SNAPSHOT_RECEIVED` sent
- `CLOUD_AGENT_INSUFFICIENT_CREDITS` error → `USAGE_SNAPSHOT_RECEIVED` sent with `remainingCredits: 0`; query invalidated; error rethrown

---

## 9. Non-Goals (Phase 3)

- No streaming / SSE
- No per-tool credit costs (flat 1 credit per `/agent/run` call regardless of tools invoked)
- No admin refund tooling for `refundCredit` failures — manual recovery via admin panel
- No `subscriptions.next_expiry_date` sync from cloud-agent (Firebase path handles this on next webhook/callable)
- No changes to Firebase Functions

---

## 10. Acceptance Criteria

| Scenario | Expected |
|---|---|
| User has ≥ 1 credit, cloud agent call succeeds | Credit deducted; `usageSnapshot.remainingCredits` returned; auth machine updated; header badge ticks down |
| User has 0 credits, hits `/agent/run` directly | 402 `{ error: 'Insufficient credits' }` |
| Frontend: user has stale credits > 0, backend returns 402 | Auth machine forced to `remainingCredits: 0`; ChatView gates future sends |
| ADK / Vertex AI error mid-run | `refundCredit` called; 500 returned; credit restored |
| `getBalance` fails after successful ADK run | 500 NOT returned; `usageSnapshot: null` returned; user receives reply |
| Two simultaneous requests with 1 credit remaining | `SELECT FOR UPDATE` serializes; first succeeds, second gets 402 |
| Expired credits only | `spendCredit` throws `INSUFFICIENT_CREDITS`; 402 returned |
| Free signup credits (expires_at = NULL) | Spent last (NULLS LAST ordering); correctly deducted |

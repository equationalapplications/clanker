# Cloud Agent Phase 3: Metered Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduct 1 credit per successful `/agent/run` call using the Saga pattern (spend → execute → refund on failure), return `usageSnapshot: { remainingCredits: N }` to the Expo frontend, and sync the balance into the auth machine in real time.

**Architecture:** Raw SQL creditService in cloud-agent (no schema additions) handles three operations — spend, refund, getBalance — with the spend operation atomically selecting the earliest-expiring credit row. The Express route wraps `runAgentFn` with spend/refund, then returns `usageSnapshot`. The Expo frontend parses `usageSnapshot` from cloud-agent responses and dispatches `USAGE_SNAPSHOT_RECEIVED` to the auth machine, exactly matching the existing Firebase path pattern.

**Tech Stack:** Node.js + TypeScript + drizzle-orm (sql tag + execute) + node:test (cloud-agent) + Jest/jest-expo (Expo) + supertest + React Test Renderer

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `cloud-agent/src/services/creditService.ts` | **Create** | `CreditService` type + `createCreditService(db)` factory — three raw SQL ops |
| `cloud-agent/src/services/creditService.test.ts` | **Create** | Unit tests for all three creditService methods |
| `cloud-agent/src/index.ts` | **Modify** | Add `creditService?: CreditService` to `AppOptions`; wrap route with spend/refund; return `usageSnapshot` |
| `cloud-agent/src/index.test.ts` | **Modify** | Add `execute` to `makeMockDb`; add 402, refund-on-ADK-error, usageSnapshot, graceful-degrade tests |
| `src/services/cloudAgentService.ts` | **Modify** | Add `usageSnapshot` to `CloudAgentResult`; handle 402; parse snapshot from response |
| `__tests__/cloudAgentService.test.ts` | **Modify** | Tests for 402 throw and usageSnapshot parsing/null fallback |
| `src/hooks/useAIChat.ts` | **Modify** | Dispatch `USAGE_SNAPSHOT_RECEIVED` on cloud-agent success and 402 |
| `__tests__/useAIChat.test.tsx` | **Modify** | Tests for snapshot dispatch on success, null snapshot, 402 self-heal, query invalidation |

---

## Task 1: creditService — failing tests

**Files:**
- Create: `cloud-agent/src/services/creditService.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// cloud-agent/src/services/creditService.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

// Creates a mock DrizzleClient whose execute() returns from a preset queue.
// Pass one { rows } entry per execute() call creditService will make.
function makeExecuteDb(responses: Array<{ rows: unknown[] }>): DrizzleClient {
  let callIndex = 0
  return {
    execute: async (_query: unknown) => responses[callIndex++] ?? { rows: [] },
  } as unknown as DrizzleClient
}

const { createCreditService } = await import('./creditService.js')

// ── spendCredit ───────────────────────────────────────────────────────────────

test('spendCredit returns txId when a qualifying row exists', async () => {
  // Call 1: UPDATE credit_transactions RETURNING id
  // Call 2: UPDATE subscriptions SET current_credits - 1
  const db = makeExecuteDb([{ rows: [{ id: 'tx-abc' }] }, { rows: [] }])
  const cs = createCreditService(db)
  const txId = await cs.spendCredit('user-1')
  assert.equal(txId, 'tx-abc')
})

test('spendCredit throws INSUFFICIENT_CREDITS when no qualifying row', async () => {
  const db = makeExecuteDb([{ rows: [] }])
  const cs = createCreditService(db)
  await assert.rejects(
    () => cs.spendCredit('user-1'),
    (err: Error) => {
      assert.equal(err.message, 'INSUFFICIENT_CREDITS')
      return true
    },
  )
})

test('spendCredit does not update subscriptions when spend fails', async () => {
  let executeCalls = 0
  const db = {
    execute: async (_query: unknown) => {
      executeCalls++
      return { rows: [] }  // always returns empty (insufficient)
    },
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await assert.rejects(() => cs.spendCredit('user-1'))
  assert.equal(executeCalls, 1)  // only the UPDATE RETURNING — no subscriptions UPDATE
})

// ── refundCredit ──────────────────────────────────────────────────────────────

test('refundCredit resolves without throwing', async () => {
  // Call 1: UPDATE credit_transactions SET remaining_balance + 1
  // Call 2: UPDATE subscriptions SET current_credits + 1
  const db = makeExecuteDb([{ rows: [] }, { rows: [] }])
  const cs = createCreditService(db)
  await assert.doesNotReject(() => cs.refundCredit('user-1', 'tx-abc'))
})

test('refundCredit makes exactly two execute calls', async () => {
  let executeCalls = 0
  const db = {
    execute: async (_query: unknown) => { executeCalls++; return { rows: [] } },
  } as unknown as DrizzleClient
  const cs = createCreditService(db)
  await cs.refundCredit('user-1', 'tx-abc')
  assert.equal(executeCalls, 2)
})

// ── getBalance ────────────────────────────────────────────────────────────────

test('getBalance returns numeric balance from SUM result', async () => {
  const db = makeExecuteDb([{ rows: [{ total: '5' }] }])
  const cs = createCreditService(db)
  const balance = await cs.getBalance('user-1')
  assert.equal(balance, 5)
})

test('getBalance returns 0 when total is null (no credit rows)', async () => {
  const db = makeExecuteDb([{ rows: [{ total: null }] }])
  const cs = createCreditService(db)
  const balance = await cs.getBalance('user-1')
  assert.equal(balance, 0)
})

test('getBalance returns 0 when execute returns no rows', async () => {
  const db = makeExecuteDb([{ rows: [] }])
  const cs = createCreditService(db)
  const balance = await cs.getBalance('user-1')
  assert.equal(balance, 0)
})
```

- [ ] **Step 2: Run to verify tests fail (module not found)**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "FAIL|PASS|Error|creditService" | head -20
```

Expected: compilation failure or `Cannot find module './creditService.js'`

---

## Task 2: creditService — implementation

**Files:**
- Create: `cloud-agent/src/services/creditService.ts`

- [ ] **Step 1: Create creditService.ts**

```typescript
// cloud-agent/src/services/creditService.ts
import { sql } from 'drizzle-orm'
import type { DrizzleClient } from '../db/client.js'

export type CreditService = {
  spendCredit: (userId: string) => Promise<string>
  refundCredit: (userId: string, txId: string) => Promise<void>
  getBalance: (userId: string) => Promise<number>
}

export function createCreditService(db: DrizzleClient): CreditService {
  return {
    async spendCredit(userId: string): Promise<string> {
      // Atomically selects the earliest-expiring row with remaining_balance >= 1
      // and decrements it. Returns 0 rows if no qualifying row exists.
      // Two concurrent requests with 1 credit: PostgreSQL row locking ensures
      // only one succeeds; the second sees remaining_balance = 0 and returns 0 rows.
      const spendResult = await db.execute<{ id: string }>(sql`
        UPDATE credit_transactions
        SET remaining_balance = remaining_balance - 1
        WHERE user_id = ${userId}
          AND remaining_balance >= 1
          AND (expires_at IS NULL OR expires_at > NOW())
          AND id = (
            SELECT id FROM credit_transactions
            WHERE user_id = ${userId}
              AND remaining_balance >= 1
              AND (expires_at IS NULL OR expires_at > NOW())
            ORDER BY expires_at ASC NULLS LAST
            LIMIT 1
          )
        RETURNING id
      `)

      if (spendResult.rows.length === 0) {
        throw new Error('INSUFFICIENT_CREDITS')
      }

      const txId = spendResult.rows[0].id

      await db.execute(sql`
        UPDATE subscriptions
        SET current_credits = current_credits - 1
        WHERE user_id = ${userId}
      `)

      return txId
    },

    async refundCredit(userId: string, txId: string): Promise<void> {
      await db.execute(sql`
        UPDATE credit_transactions
        SET remaining_balance = remaining_balance + 1
        WHERE id = ${txId}
          AND user_id = ${userId}
      `)

      await db.execute(sql`
        UPDATE subscriptions
        SET current_credits = current_credits + 1
        WHERE user_id = ${userId}
      `)
    },

    async getBalance(userId: string): Promise<number> {
      const result = await db.execute<{ total: string | null }>(sql`
        SELECT COALESCE(SUM(remaining_balance), 0) AS total
        FROM credit_transactions
        WHERE user_id = ${userId}
          AND (expires_at IS NULL OR expires_at > NOW())
      `)
      const total = result.rows[0]?.total
      return total !== null && total !== undefined ? Number(total) : 0
    },
  }
}
```

- [ ] **Step 2: Run creditService tests**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "✓|✗|PASS|FAIL|creditService" | head -20
```

Expected: all 8 creditService tests pass.

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/services/creditService.ts cloud-agent/src/services/creditService.test.ts
git commit -m "feat(cloud-agent): add creditService with spend/refund/getBalance raw SQL"
```

---

## Task 3: Wire creditService into index.ts

**Files:**
- Modify: `cloud-agent/src/index.test.ts` — extend `makeMockDb` + add credit integration tests
- Modify: `cloud-agent/src/index.ts` — add `CreditService` to `AppOptions`, update route

- [ ] **Step 1: Write failing tests in index.test.ts**

Add these changes to `cloud-agent/src/index.test.ts`:

**a) Add `execute` to the returned object in `makeMockDb`.**

The returned object currently starts with `_inserted: inserted`. Add `execute` as the second property, directly after `_inserted`:

```typescript
    execute: async (_query: unknown) => ({ rows: [{ id: 'mock-txid', total: '99' }] }),
```

This single-response mock makes `spendCredit` succeed (returns a row with `id`), `getBalance` return 99 (parses `total`), and `refundCredit` pass silently (ignores rows). No existing test assertions break.

**c) Add a `mockCreditService` constant after the existing `mockRunAgent` constant:**

```typescript
// After const mockRunAgent definition, add:
const mockCreditService = {
  spendCredit: async (_userId: string): Promise<string> => 'mock-txid',
  refundCredit: async (_userId: string, _txId: string): Promise<void> => {},
  getBalance: async (_userId: string): Promise<number> => 42,
}
```

**d) Add new test cases at the end of the file (before the last closing brace):**

```typescript
// ── Credit service integration ────────────────────────────────────────────────

test('POST /agent/run returns 402 when spendCredit throws INSUFFICIENT_CREDITS', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const cs = {
    ...mockCreditService,
    spendCredit: async (_userId: string): Promise<string> => {
      throw new Error('INSUFFICIENT_CREDITS')
    },
  }
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent, creditService: cs })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 402)
  assert.deepEqual(res.body, { error: 'Insufficient credits' })
})

test('POST /agent/run calls refundCredit and returns 500 when runAgentFn throws', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  let refundCalled = false
  const cs = {
    ...mockCreditService,
    refundCredit: async (_userId: string, _txId: string): Promise<void> => { refundCalled = true },
  }
  const failingAgent = async (_params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> => {
    throw new Error('ADK error (unknown): vertex safety block')
  }
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: failingAgent, creditService: cs })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 500)
  assert.ok(refundCalled, 'expected refundCredit to be called')
  assert.match((res.body as { error: string }).error, /ADK error/)
})

test('POST /agent/run swallows refundCredit failure and still returns 500 with ADK error', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const cs = {
    ...mockCreditService,
    refundCredit: async (_userId: string, _txId: string): Promise<void> => {
      throw new Error('connection lost during refund')
    },
  }
  const failingAgent = async (_params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> => {
    throw new Error('ADK error (unknown): vertex failed')
  }
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: failingAgent, creditService: cs })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 500)
  assert.match((res.body as { error: string }).error, /ADK error/)
})

test('POST /agent/run returns usageSnapshot.remainingCredits on success', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const cs = { ...mockCreditService, getBalance: async (_userId: string) => 27 }
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent, creditService: cs })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.deepEqual((res.body as { usageSnapshot: unknown }).usageSnapshot, { remainingCredits: 27 })
})

test('POST /agent/run returns usageSnapshot: null and 200 when getBalance throws', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const cs = {
    ...mockCreditService,
    getBalance: async (_userId: string): Promise<number> => { throw new Error('db connection lost') },
  }
  const app = createApp({ verifyToken: mockVerify, db, runAgentFn: mockRunAgent, creditService: cs })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.equal((res.body as { usageSnapshot: unknown }).usageSnapshot, null)
})

test('POST /agent/run does not call runAgentFn when spendCredit throws INSUFFICIENT_CREDITS', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const cs = {
    ...mockCreditService,
    spendCredit: async (_userId: string): Promise<string> => { throw new Error('INSUFFICIENT_CREDITS') },
  }
  let agentCalled = false
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async (params) => { agentCalled = true; return { reply: 'ok', toolCalls: [] } },
    creditService: cs,
  })
  await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.ok(!agentCalled, 'runAgentFn must not be called when credits are insufficient')
})
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "creditService|402|refund|usageSnapshot|FAIL|Error" | head -20
```

Expected: TypeScript errors about missing `creditService` in `AppOptions`, or runtime failures if compiled.

- [ ] **Step 3: Update index.ts**

**a) Add `CreditService` import at the top of `cloud-agent/src/index.ts`:**

```typescript
import { createCreditService } from './services/creditService.js'
import type { CreditService } from './services/creditService.js'
```

**b) Add `creditService?: CreditService` to `AppOptions` interface:**

```typescript
interface AppOptions {
  verifyToken: (token: string) => Promise<{ uid: string }>
  db: DrizzleClient
  runAgentFn: (params: RunAgentParams) => Promise<{ reply: string; toolCalls: string[] }>
  creditService?: CreditService
}
```

**c) In `createApp`, derive `cs` from `options` (add at the top of the `createApp` function body, before `const app = express()`):**

```typescript
const cs = options.creditService ?? createCreditService(options.db)
```

**d) In the `POST /agent/run` handler, replace the existing `const result = await runAgentFn(...)` block with the spend/refund wrapper:**

Find this block in the handler (after `const systemInstruction = assembleSystemInstruction(...)`):

```typescript
      const result = await runAgentFn({ db, userId, characterId, systemInstruction, message, history })
      res.json(result)
```

Replace with:

```typescript
      // 1. SPEND FIRST — 402 if no qualifying credit row
      let txId: string
      try {
        txId = await cs.spendCredit(userId)
      } catch (creditErr: unknown) {
        const msg = creditErr instanceof Error ? creditErr.message : ''
        if (msg === 'INSUFFICIENT_CREDITS') {
          res.status(402).json({ error: 'Insufficient credits' })
          return
        }
        throw creditErr
      }

      // 2. EXECUTE — refund on ADK failure
      let result: { reply: string; toolCalls: string[] }
      try {
        result = await runAgentFn({ db, userId, characterId, systemInstruction, message, history })
      } catch (adkErr) {
        try {
          await cs.refundCredit(userId, txId)
        } catch (refundErr) {
          console.error(`[CRITICAL] refundCredit failed user=${userId} txId=${txId}`, refundErr)
        }
        throw adkErr
      }

      // 3. GET BALANCE — graceful degrade if this fails
      let newBalance: number | null = null
      try {
        newBalance = await cs.getBalance(userId)
      } catch (balErr) {
        console.warn(`getBalance failed user=${userId}, returning null snapshot`, balErr)
      }

      // 4. RESPOND
      res.json({
        reply: result.reply,
        toolCalls: result.toolCalls,
        usageSnapshot: newBalance !== null ? { remainingCredits: newBalance } : null,
      })
```

- [ ] **Step 4: Run all cloud-agent tests**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "✓|✗|PASS|FAIL|Error" | head -40
```

Expected: all existing tests pass + all 6 new credit integration tests pass.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/index.ts cloud-agent/src/index.test.ts
git commit -m "feat(cloud-agent): add credit deduction to /agent/run with spend-execute-refund pattern"
```

---

## Task 4: Frontend — cloudAgentService.ts

**Files:**
- Modify: `__tests__/cloudAgentService.test.ts`
- Modify: `src/services/cloudAgentService.ts`

- [ ] **Step 1: Write failing tests**

Add to `__tests__/cloudAgentService.test.ts`, inside the `describe('callCloudAgent', ...)` block (after the existing `'throws when response is not ok'` test):

```typescript
  it('throws CLOUD_AGENT_INSUFFICIENT_CREDITS when server returns 402', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 402 })
    const { callCloudAgent } = loadWithMocks()
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')
  })

  it('does not throw generic HTTP error for 402 — only CLOUD_AGENT_INSUFFICIENT_CREDITS', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 402 })
    const { callCloudAgent } = loadWithMocks()
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.not.toThrow('Cloud Agent responded with 402')
  })

  it('returns usageSnapshot with remainingCredits when present in response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hi!', toolCalls: [], usageSnapshot: { remainingCredits: 42 } }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.usageSnapshot).toEqual({ remainingCredits: 42 })
  })

  it('returns usageSnapshot: null when usageSnapshot is absent from response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hi!', toolCalls: [] }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.usageSnapshot).toBeNull()
  })

  it('returns usageSnapshot: null when remainingCredits is not a number', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hi!', toolCalls: [], usageSnapshot: { remainingCredits: 'bad' } }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.usageSnapshot).toBeNull()
  })

  it('returns usageSnapshot: null when usageSnapshot.remainingCredits is null', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hi!', toolCalls: [], usageSnapshot: { remainingCredits: null } }),
    })
    const { callCloudAgent } = loadWithMocks()
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.usageSnapshot).toBeNull()
  })
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
npm test -- __tests__/cloudAgentService.test.ts 2>&1 | grep -E "✓|✗|PASS|FAIL|●" | head -20
```

Expected: new tests fail — no 402 handling, `usageSnapshot` not returned.

- [ ] **Step 3: Update cloudAgentService.ts**

Replace the full contents of `src/services/cloudAgentService.ts`:

```typescript
import { auth } from '~/config/firebaseConfig'
import type { Content } from '@google/genai'

export interface CloudAgentUnsyncedTask {
  type: 'task'
  id: string
  title: string
  status: string
  createdAt: number
}

export interface CloudAgentPayload {
  message: string
  characterId: string
  history?: Content[]
  unsyncedHistory?: CloudAgentUnsyncedTask[]
}

export interface CloudAgentResult {
  reply: string
  toolCalls: string[]
  usageSnapshot: { remainingCredits: number } | null
}

export async function callCloudAgent(payload: CloudAgentPayload): Promise<CloudAgentResult> {
  const baseUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL?.trim()
  if (!baseUrl) throw new Error('EXPO_PUBLIC_CLOUD_AGENT_URL is not configured')
  const url = `${baseUrl.replace(/\/agent\/run\/?$/, '').replace(/\/$/, '')}/agent/run`

  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('No authenticated user')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  if (response.status === 402) {
    throw new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS')
  }

  if (!response.ok) {
    throw new Error(`Cloud Agent responded with ${response.status}`)
  }

  const data = (await response.json()) as {
    reply?: string
    toolCalls?: string[]
    usageSnapshot?: { remainingCredits?: unknown } | null
  }

  if (!data.reply || typeof data.reply !== 'string') {
    throw new Error('Invalid Cloud Agent response')
  }

  const rawSnapshot = data.usageSnapshot
  const usageSnapshot =
    rawSnapshot !== null &&
    rawSnapshot !== undefined &&
    typeof rawSnapshot.remainingCredits === 'number'
      ? { remainingCredits: rawSnapshot.remainingCredits }
      : null

  return {
    reply: data.reply,
    toolCalls: data.toolCalls ?? [],
    usageSnapshot,
  }
}
```

- [ ] **Step 4: Run all cloudAgentService tests**

```bash
npm test -- __tests__/cloudAgentService.test.ts 2>&1 | grep -E "✓|✗|PASS|FAIL|●" | head -20
```

Expected: all tests pass including the 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/services/cloudAgentService.ts __tests__/cloudAgentService.test.ts
git commit -m "feat(expo): handle 402 and parse usageSnapshot in cloudAgentService"
```

---

## Task 5: Frontend — useAIChat.ts

**Files:**
- Modify: `__tests__/useAIChat.test.tsx`
- Modify: `src/hooks/useAIChat.ts`

- [ ] **Step 1: Write failing tests**

Add to `__tests__/useAIChat.test.tsx`, inside the `describe('Cloud Agent path', ...)` block (after the existing `'propagates Cloud Agent errors...'` test):

```typescript
    it('dispatches USAGE_SNAPSHOT_RECEIVED to authService when cloud agent returns usageSnapshot', async () => {
      mockCallCloudAgent.mockResolvedValue({
        reply: 'Cloud says hi!',
        toolCalls: [],
        usageSnapshot: { remainingCredits: 26 },
      })
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-snapshot-1',
          text: 'Use cloud agent',
          createdAt: new Date('2026-06-03T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'cloudAgent',
          remainingCredits: 26,
          planTier: null,
          planStatus: null,
        }),
      )
    })

    it('does NOT dispatch USAGE_SNAPSHOT_RECEIVED when usageSnapshot is null', async () => {
      mockCallCloudAgent.mockResolvedValue({
        reply: 'Cloud says hi!',
        toolCalls: [],
        usageSnapshot: null,
      })
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await act(async () => {
        await hook.sendMessage({
          _id: 'msg-snapshot-2',
          text: 'Use cloud agent',
          createdAt: new Date('2026-06-03T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any)
      })

      const cloudAgentSnapshots = mockSend.mock.calls.filter(
        (call: unknown[]) =>
          typeof call[0] === 'object' &&
          call[0] !== null &&
          (call[0] as { type?: string; source?: string }).type === 'USAGE_SNAPSHOT_RECEIVED' &&
          (call[0] as { type?: string; source?: string }).source === 'cloudAgent',
      )
      expect(cloudAgentSnapshots).toHaveLength(0)
    })

    it('dispatches USAGE_SNAPSHOT_RECEIVED with remainingCredits: 0 on CLOUD_AGENT_INSUFFICIENT_CREDITS', async () => {
      mockCallCloudAgent.mockRejectedValue(new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS'))
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await expect(
        act(async () => {
          await hook.sendMessage({
            _id: 'msg-402-1',
            text: 'No credits',
            createdAt: new Date('2026-06-03T00:00:00.000Z'),
            user: { _id: 'user-1' },
          } as any)
        }),
      ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'cloudAgent',
          remainingCredits: 0,
          planTier: null,
          planStatus: null,
        }),
      )
    })

    it('invalidates message query on CLOUD_AGENT_INSUFFICIENT_CREDITS', async () => {
      mockCallCloudAgent.mockRejectedValue(new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS'))
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await expect(
        act(async () => {
          await hook.sendMessage({
            _id: 'msg-402-2',
            text: 'No credits',
            createdAt: new Date('2026-06-03T00:00:00.000Z'),
            user: { _id: 'user-1' },
          } as any)
        }),
      ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')

      expect(mockInvalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: expect.arrayContaining(['messages']) }),
      )
    })

    it('rethrows CLOUD_AGENT_INSUFFICIENT_CREDITS so mutation onError still runs', async () => {
      mockCallCloudAgent.mockRejectedValue(new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS'))
      const hook = renderUseAIChat({ save_to_cloud: 1 })

      await expect(
        act(async () => {
          await hook.sendMessage({
            _id: 'msg-402-3',
            text: 'No credits',
            createdAt: new Date('2026-06-03T00:00:00.000Z'),
            user: { _id: 'user-1' },
          } as any)
        }),
      ).rejects.toThrow('CLOUD_AGENT_INSUFFICIENT_CREDITS')
    })
```

- [ ] **Step 2: Run to verify new tests fail**

```bash
npm test -- __tests__/useAIChat.test.tsx 2>&1 | grep -E "✓|✗|PASS|FAIL|●" | head -20
```

Expected: 5 new tests fail — USAGE_SNAPSHOT_RECEIVED not dispatched, no 402 handling.

- [ ] **Step 3: Update useAIChat.ts — success path**

In `src/hooks/useAIChat.ts`, find the cloud agent success block. It currently ends with:

```typescript
        return { usageSnapshot: null }
      }
```

(This is the `return` that comes right after the `onWriteObservation` try/catch block inside the `if (isCloudSynced && character.cloud_id && ...)` branch.)

Replace **only** the final `return { usageSnapshot: null }` inside that block with:

```typescript
        if (agentResult.usageSnapshot) {
          authService.send({
            type: 'USAGE_SNAPSHOT_RECEIVED',
            source: 'cloudAgent',
            remainingCredits: agentResult.usageSnapshot.remainingCredits,
            planTier: null,
            planStatus: null,
            verifiedAt: new Date().toISOString(),
          })
        }

        return { usageSnapshot: null }
      }
```

- [ ] **Step 4: Update useAIChat.ts — 402 catch path**

In `src/hooks/useAIChat.ts`, find the `onError` handler in the mutation. It currently has a block that checks `firebaseCode === 'functions/failed-precondition'`:

```typescript
      if (firebaseCode === 'functions/failed-precondition') {
        queryClient.invalidateQueries({
          queryKey: messageKeys.list(characterId, userId),
        })
      }
```

Add a sibling `if` block for the cloud agent 402 error, immediately after the `failed-precondition` block:

```typescript
      const isInsufficientCredits =
        err instanceof Error && err.message === 'CLOUD_AGENT_INSUFFICIENT_CREDITS'
      if (isInsufficientCredits) {
        authService.send({
          type: 'USAGE_SNAPSHOT_RECEIVED',
          source: 'cloudAgent',
          remainingCredits: 0,
          planTier: null,
          planStatus: null,
          verifiedAt: new Date().toISOString(),
        })
        queryClient.invalidateQueries({
          queryKey: messageKeys.list(characterId, userId),
        })
      }
```

Also update the rollback guard to not roll back on insufficient credits (same as `failed-precondition`). Find:

```typescript
      if (firebaseCode !== 'functions/failed-precondition' && context?.previousMessages) {
        queryClient.setQueryData(messageKeys.list(characterId, userId), context.previousMessages)
      }
```

Replace with:

```typescript
      if (
        firebaseCode !== 'functions/failed-precondition' &&
        !isInsufficientCredits &&
        context?.previousMessages
      ) {
        queryClient.setQueryData(messageKeys.list(characterId, userId), context.previousMessages)
      }
```

- [ ] **Step 5: Run all useAIChat tests**

```bash
npm test -- __tests__/useAIChat.test.tsx 2>&1 | grep -E "✓|✗|PASS|FAIL|●" | head -30
```

Expected: all existing tests pass + all 5 new tests pass.

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
npm test 2>&1 | grep -E "PASS|FAIL|Tests:" | tail -15
```

Expected: no FAIL lines.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAIChat.ts __tests__/useAIChat.test.tsx
git commit -m "feat(expo): dispatch USAGE_SNAPSHOT_RECEIVED from cloud agent responses and handle 402"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run all cloud-agent tests**

```bash
cd cloud-agent && npm test 2>&1 | grep -E "✓|✗|pass|fail" | tail -20
```

Expected: all tests pass (existing + new creditService tests + new index tests).

- [ ] **Step 2: Run all Expo tests**

```bash
cd .. && npm test 2>&1 | grep -E "PASS|FAIL|Tests:" | tail -15
```

Expected: no FAIL lines.

- [ ] **Step 3: TypeScript check on cloud-agent**

```bash
cd cloud-agent && npm run build 2>&1 | tail -10
```

Expected: `Found 0 errors.`

- [ ] **Step 4: Final commit if any cleanup needed, then tag**

```bash
git log --oneline -5
```

Verify all 4 feature commits are present:
1. `feat(cloud-agent): add creditService with spend/refund/getBalance raw SQL`
2. `feat(cloud-agent): add credit deduction to /agent/run with spend-execute-refund pattern`
3. `feat(expo): handle 402 and parse usageSnapshot in cloudAgentService`
4. `feat(expo): dispatch USAGE_SNAPSHOT_RECEIVED from cloud agent responses and handle 402`

# Phase 2 Browser Bridge — Stateful Actions & Approval Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable stateful browser actions (`fill_field`, `click`) behind a mobile approval flow — extension halts at destructive steps, Cloud Agent fires Expo Push approval card, mobile approves, extension resumes.

**Architecture:** Extension Layer 2 classifier halts on destructive elements → Cloud Agent writes auth doc + fires Expo Push → mobile REST-approves (Cloud Agent writes to Firestore) → Cloud Agent FCM-wakes extension with sliced resume intent.

**Tech Stack:** `expo-notifications`, `expo-task-manager`, `@react-native-firebase/auth` (existing), Firestore Admin SDK, Firebase Cloud Messaging, Expo Push REST API, node:test (cloud-agent + extension), Jest (mobile).

**Phase 2 gate:** Approval flow validated on staging payment form — `fill_field` + `click` submit sequenced through mobile APPROVE tap.

**Test runners (verified):** cloud-agent + extension both have `tsx` as a devDep — run a single suite with `node --test --import tsx/esm <file>.test.ts`. Full suites: cloud-agent `npm test` (builds to `dist/` first), extension `npm test`, mobile `npx jest`. Extension DOM tests use `jsdom` (no global `document`). Mobile has **no** `@react-native-firebase/firestore` — approval writes go through a Cloud Agent REST endpoint, not a direct client Firestore write (see Task 5).

---

## File Map

| File | Change |
|------|--------|
| `shared/dsl-types.ts` | Add `AuthDoc` type; add optional `requiresAuth: false` semantics for resume |
| `cloud-agent/src/services/firestoreSession.ts` | Add `haltForAuth`, `watchAuth` |
| `cloud-agent/src/services/firestoreSession.test.ts` | Tests for new helpers |
| `cloud-agent/src/services/fcmDispatcher.ts` | Add `sendApprovalCard`, `sendTaskComplete` |
| `cloud-agent/src/services/fcmDispatcher.test.ts` | Tests for Expo Push methods |
| `functions/drizzle/0017_expo_push_token.sql` | Postgres migration: add `expo_push_token` to `users` |
| `cloud-agent/src/db/schema.ts` | Add `expoPushToken` column to `users` table |
| `cloud-agent/src/handlers/wsBrowserAgentHandler.ts` | Handle `awaiting_auth` frame, approval flow, resume intent slicing |
| `cloud-agent/src/handlers/wsBrowserAgentHandler.test.ts` | Tests for approval flow |
| `cloud-agent/src/index.ts` | Add `POST /agent/browser/approve-action` endpoint; wire `getExpoPushToken` dep |
| `cloud-agent/src/tools/browserAction.ts` | Voice narration on `awaiting_auth` status |
| `cloud-agent/src/tools/browserAction.test.ts` | Test awaiting_auth voice narration |
| `extension/src/content/executor.ts` | Implement `fill_field`, `click`; wire `classifyElement` (Layer 2) |
| `extension/src/content/executor.test.ts` | Tests for stateful actions + classifier |
| `extension/src/background/task-dispatcher.ts` | New `DispatchOutcome` type; halt on AWAITING_AUTH |
| `extension/src/background/task-dispatcher.test.ts` | Tests for halt path |
| `extension/src/background/ws-client.ts` | Add `sendAwaitingAuth` |
| `extension/src/background/ws-client.test.ts` | Test new frame |
| `extension/src/background/service-worker.ts` | Handle `awaiting_auth` outcome; close WS and suspend |
| `src/hooks/useRegisterExpoPushToken.ts` | New: register Expo push token on sign-in |
| `src/hooks/useBrowserActionApproval.ts` | New: background task def + notification category setup |
| `app/_layout.tsx` | Wire push token + notification hooks |
| `firestore.rules` | Update auth doc write rules |

---

### Task 1: AuthDoc Type + Firestore Phase 2 Helpers

**Files:**
- Modify: `shared/dsl-types.ts`
- Modify: `cloud-agent/src/services/firestoreSession.ts`
- Modify: `cloud-agent/src/services/firestoreSession.test.ts`

- [ ] **Step 1: Add `AuthDoc` to `shared/dsl-types.ts`**

Add after the `DeviceDoc` export:

```typescript
export type AuthStatus = 'pending' | 'approved' | 'denied'

export interface AuthDoc {
  status: AuthStatus
  actionSummary: string
  expiresAt: unknown // Firestore Timestamp
  approvedAt: unknown | null
  approvalToken: string | null
}
```

- [ ] **Step 2: Write failing tests for `haltForAuth` and `watchAuth`**

In `cloud-agent/src/services/firestoreSession.test.ts`, add after the existing tests:

```typescript
test('haltForAuth writes task awaiting_auth + session pending_auth + auth doc pending', async () => {
  const calls: Array<{ path: string; data: Record<string, unknown>; opts?: unknown }> = []
  const db = makeFakeDb(calls)
  const fs = createFirestoreSession(db)

  await fs.haltForAuth('uid1', 'sid1', 'tid1', 2, 'Submit payment')

  const taskCall = calls.find((c) => c.path === 'users/uid1/sessions/sid1/tasks/tid1')
  const sessionCall = calls.find((c) => c.path === 'users/uid1/sessions/sid1')
  const authCall = calls.find((c) => c.path === 'users/uid1/sessions/sid1/auth/tid1')

  assert.equal(taskCall?.data.status, 'awaiting_auth')
  assert.equal(taskCall?.data.haltedStepIndex, 2)
  assert.equal(sessionCall?.data.status, 'pending_auth')
  assert.equal(authCall?.data.status, 'pending')
  assert.equal(authCall?.data.actionSummary, 'Submit payment')
  assert.ok(authCall?.data.expiresAt)
})

test('watchAuth calls callback when auth doc snapshot fires', async () => {
  let snapCb: ((s: { exists: boolean; data(): Record<string, unknown> }) => void) | null = null
  const db = {
    doc: (path: string) => ({
      set: async () => {},
      get: async () => ({ exists: false, data: () => undefined }),
      update: async () => {},
      onSnapshot: (cb: typeof snapCb) => { snapCb = cb; return () => {} },
    }),
    collection: (_path: string) => ({ where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) }) },
  } as unknown as import('./firestoreSession.js').FirestoreLike

  const fs = createFirestoreSession(db)
  const received: unknown[] = []
  const unsub = fs.watchAuth('uid1', 'sid1', 'tid1', (auth) => received.push(auth))

  snapCb!({ exists: true, data: () => ({ status: 'approved', approvalToken: 'tok', approvedAt: null, actionSummary: 'x', expiresAt: 0 }) })
  assert.equal(received.length, 1)
  unsub()
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd cloud-agent && node --test --import tsx/esm src/services/firestoreSession.test.ts
```

Expected: FAIL — `fs.haltForAuth is not a function`, `fs.watchAuth is not a function`.

- [ ] **Step 4: Implement `haltForAuth` and `watchAuth` in `firestoreSession.ts`**

Add to the return object of `createFirestoreSession`:

```typescript
async haltForAuth(uid: string, sid: string, tid: string, haltedStepIndex: number, actionSummary: string): Promise<void> {
  const AUTH_TTL_MS = 5 * 60 * 1000
  const authPath = `users/${uid}/sessions/${sid}/auth/${tid}`
  const expiresAt = admin.firestore?.Timestamp
    ? admin.firestore.Timestamp.fromMillis(Date.now() + AUTH_TTL_MS)
    : (Date.now() + AUTH_TTL_MS as unknown)

  if (db.batch) {
    const batch = db.batch()
    batch.update(taskPath(uid, sid, tid), { status: 'awaiting_auth', haltedStepIndex, updatedAt: now() })
    batch.update(sessionPath(uid, sid), { status: 'pending_auth' })
    await batch.commit()
  } else {
    await db.doc(taskPath(uid, sid, tid)).update({ status: 'awaiting_auth', haltedStepIndex, updatedAt: now() })
    await db.doc(sessionPath(uid, sid)).update({ status: 'pending_auth' })
  }
  await db.doc(authPath).set({
    status: 'pending', actionSummary, expiresAt,
    approvedAt: null, approvalToken: null,
  })
},

watchAuth(uid: string, sid: string, tid: string, cb: (auth: import('../../../shared/dsl-types.js').AuthDoc) => void): () => void {
  const authPath = `users/${uid}/sessions/${sid}/auth/${tid}`
  const ref = db.doc(authPath)
  if (!ref.onSnapshot) throw new Error('watchAuth requires onSnapshot support')
  return ref.onSnapshot((snap) => {
    if (snap.exists) cb(snap.data() as unknown as import('../../../shared/dsl-types.js').AuthDoc)
  })
},
```

Also add `AuthDoc` to the imports from `dsl-types.ts`:

```typescript
import type { TaskIntent, TaskResult, SessionDoc, TaskDoc, DeviceDoc, AuthDoc } from '../../../shared/dsl-types.js'
```

And update the `FirestoreSession` type export at the end of the file (no action needed — `ReturnType` picks it up automatically).

- [ ] **Step 5: Run tests and verify pass**

```bash
cd cloud-agent && node --test --import tsx/esm src/services/firestoreSession.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/dsl-types.ts cloud-agent/src/services/firestoreSession.ts cloud-agent/src/services/firestoreSession.test.ts
git commit -m "feat(bridge/p2): add AuthDoc type and haltForAuth/watchAuth to firestoreSession"
```

---

### Task 2: FCM Dispatcher — Expo Push Methods

**Files:**
- Modify: `cloud-agent/src/services/fcmDispatcher.ts`
- Modify: `cloud-agent/src/services/fcmDispatcher.test.ts`

- [ ] **Step 1: Write failing tests for `sendApprovalCard` and `sendTaskComplete`**

Add to `cloud-agent/src/services/fcmDispatcher.test.ts`:

```typescript
test('sendApprovalCard POSTs correct Expo Push payload', async () => {
  const fetched: Array<{ url: string; body: unknown }> = []
  const fakeFetch = async (url: string, opts: RequestInit) => {
    fetched.push({ url, body: JSON.parse(opts.body as string) })
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
  }

  const { createFcmDispatcher } = await import('./fcmDispatcher.js')
  const dispatcher = createFcmDispatcher(
    { send: async () => 'msg-id' },
    fakeFetch as unknown as typeof fetch,
  )

  await dispatcher.sendApprovalCard('ExponentPushToken[abc]', 'sid1', 'tid1', 'Submit $42')

  assert.equal(fetched.length, 1)
  assert.equal(fetched[0].url, 'https://exp.host/--/api/v2/push/send')
  const body = fetched[0].body as Record<string, unknown>
  assert.equal(body.to, 'ExponentPushToken[abc]')
  assert.equal(body.categoryIdentifier, 'BROWSER_ACTION_APPROVAL')
  assert.equal((body.data as Record<string, string>).sessionId, 'sid1')
  assert.equal((body.data as Record<string, string>).taskId, 'tid1')
  assert.equal(body.ttl, 300)
})

test('sendTaskComplete POSTs correct Expo Push payload', async () => {
  const fetched: Array<{ body: unknown }> = []
  const fakeFetch = async (_url: string, opts: RequestInit) => {
    fetched.push({ body: JSON.parse(opts.body as string) })
    return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }
  }

  const { createFcmDispatcher } = await import('./fcmDispatcher.js')
  const dispatcher = createFcmDispatcher(
    { send: async () => 'msg-id' },
    fakeFetch as unknown as typeof fetch,
  )

  await dispatcher.sendTaskComplete('ExponentPushToken[xyz]', 'tid1', 'Article summary ready.')

  const body = fetched[0].body as Record<string, unknown>
  assert.equal(body.to, 'ExponentPushToken[xyz]')
  assert.equal(body.priority, 'normal')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd cloud-agent && node --test --import tsx/esm src/services/fcmDispatcher.test.ts
```

Expected: FAIL — `sendApprovalCard is not a function`.

- [ ] **Step 3: Implement Expo Push methods in `fcmDispatcher.ts`**

Replace the entire file:

```typescript
import admin from 'firebase-admin'

export interface MessagingLike {
  send(message: { token: string; data: Record<string, string> }): Promise<string>
}

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

export function createFcmDispatcher(messaging: MessagingLike, fetchImpl: typeof fetch = fetch) {
  async function expoPush(payload: Record<string, unknown>): Promise<void> {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`Expo Push failed: ${res.status}`)
  }

  return {
    async wakeExtension(fcmToken: string, sessionId: string, taskId: string, resume = false): Promise<void> {
      await messaging.send({
        token: fcmToken,
        data: { type: 'WAKE_AND_CONNECT', sessionId, taskId, resume: String(resume) },
      })
    },

    async sendApprovalCard(expoPushToken: string, sessionId: string, taskId: string, actionSummary: string): Promise<void> {
      await expoPush({
        to: expoPushToken,
        title: 'Clanker needs your approval',
        body: actionSummary,
        data: { type: 'PENDING_AUTH', sessionId, taskId, actionSummary },
        categoryIdentifier: 'BROWSER_ACTION_APPROVAL',
        priority: 'high',
        ttl: 300,
      })
    },

    async sendTaskComplete(expoPushToken: string, taskId: string, summary: string): Promise<void> {
      await expoPush({
        to: expoPushToken,
        title: 'Clanker finished',
        body: summary,
        data: { type: 'TASK_COMPLETE', taskId },
        priority: 'normal',
      })
    },
  }
}

export type FcmDispatcher = ReturnType<typeof createFcmDispatcher>

export function defaultFcmDispatcher(): FcmDispatcher {
  return createFcmDispatcher(admin.messaging() as unknown as MessagingLike)
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
cd cloud-agent && node --test --import tsx/esm src/services/fcmDispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/fcmDispatcher.ts cloud-agent/src/services/fcmDispatcher.test.ts
git commit -m "feat(bridge/p2): add sendApprovalCard and sendTaskComplete to fcmDispatcher"
```

---

### Task 3: Expo Push Token Storage

**Files:**
- Create: `functions/drizzle/0017_expo_push_token.sql`
- Modify: `cloud-agent/src/db/schema.ts`
- Modify: `cloud-agent/src/index.ts`

- [ ] **Step 1: Write the Postgres migration**

Create `functions/drizzle/0017_expo_push_token.sql`:

```sql
ALTER TABLE "users" ADD COLUMN "expo_push_token" text;
```

- [ ] **Step 2: Update `cloud-agent/src/db/schema.ts`**

Add `expoPushToken` to the `users` table:

```typescript
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  firebaseUid: text('firebase_uid').unique().notNull(),
  email: text('email').unique().notNull(),
  displayName: text('display_name'),
  expoPushToken: text('expo_push_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

- [ ] **Step 3: Write test for `POST /agent/user/expo-push-token` endpoint**

In `cloud-agent/src/index.test.ts` (or a new `expoPushToken.test.ts`), add:

```typescript
// cloud-agent/src/handlers/expoPushToken.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { upsertExpoPushToken } from './expoPushToken.js'

test('upsertExpoPushToken updates user row', async () => {
  const updates: Array<{ uid: string; token: string }> = []
  const fakeDb = {
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          updates.push({ uid: String(cond), token: data.expoPushToken as string })
          return Promise.resolve()
        },
      }),
    }),
  }
  await upsertExpoPushToken(fakeDb as never, 'firebase-uid-1', 'ExponentPushToken[abc]')
  assert.equal(updates.length, 1)
  assert.equal(updates[0].token, 'ExponentPushToken[abc]')
})
```

- [ ] **Step 4: Create `cloud-agent/src/handlers/expoPushToken.ts`**

```typescript
import { eq } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { users } from '../db/schema.js'
import type * as schema from '../db/schema.js'

export async function upsertExpoPushToken(
  db: NodePgDatabase<typeof schema>,
  firebaseUid: string,
  expoPushToken: string,
): Promise<void> {
  await db.update(users).set({ expoPushToken }).where(eq(users.firebaseUid, firebaseUid))
}

export async function getExpoPushToken(
  db: NodePgDatabase<typeof schema>,
  firebaseUid: string,
): Promise<string | null> {
  const rows = await db.select({ expoPushToken: users.expoPushToken })
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1)
  return rows[0]?.expoPushToken ?? null
}
```

- [ ] **Step 5: Run test**

```bash
cd cloud-agent && node --test --import tsx/esm src/handlers/expoPushToken.test.ts
```

Expected: PASS.

- [ ] **Step 6: Register endpoint in `cloud-agent/src/index.ts`**

Import the new handler:

```typescript
import { upsertExpoPushToken, getExpoPushToken } from './handlers/expoPushToken.js'
```

Add endpoint (alongside `/agent/browser/register-device`):

```typescript
app.post('/agent/user/expo-push-token', requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
  const parsed = z.object({ expoPushToken: z.string().min(1) }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request body' }); return }
  try {
    await upsertExpoPushToken(db, req.uid!, parsed.data.expoPushToken)
    res.json({ ok: true })
  } catch (err) {
    console.error('expo-push-token upsert error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

Also make `getExpoPushToken` accessible as a dep (export it from this module scope):

```typescript
// near the top of attachBrowserWsRoutes or wherever wsHandlerOptions is built:
const getExpoPushTokenForUser = (firebaseUid: string) => getExpoPushToken(db, firebaseUid)
// pass as: wsHandlerOptions.getExpoPushToken = getExpoPushTokenForUser
```

(Exact wiring covered in Task 4.)

- [ ] **Step 7: Commit**

```bash
git add functions/drizzle/0017_expo_push_token.sql cloud-agent/src/db/schema.ts \
  cloud-agent/src/handlers/expoPushToken.ts cloud-agent/src/handlers/expoPushToken.test.ts \
  cloud-agent/src/index.ts
git commit -m "feat(bridge/p2): add expo_push_token column, upsert endpoint, and getExpoPushToken helper"
```

---

### Task 4: wsBrowserAgentHandler — awaiting_auth Frame + Approval Flow

**Files:**
- Modify: `cloud-agent/src/handlers/wsBrowserAgentHandler.ts`
- Modify: `cloud-agent/src/handlers/wsBrowserAgentHandler.test.ts`

- [ ] **Step 1: Write failing tests for the approval flow**

Add to `cloud-agent/src/handlers/wsBrowserAgentHandler.test.ts`:

```typescript
test('awaiting_auth frame calls haltForAuth and sendApprovalCard', async () => {
  const ws = new FakeWs()
  const calls: Record<string, unknown[]> = { halt: [], approval: [] }
  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit payment', action: { type: 'sequence', steps: [
      { type: 'open_tab', url: 'https://shop.com' },
      { type: 'click', selector: '#buy', label: 'Buy Now', tier: 'stateful' },
    ] },
  }
  const { options } = deps({
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async () => {},
      closeSession: async () => {},
      haltForAuth: async (...a: unknown[]) => { calls.halt.push(a) },
      watchAuth: () => () => {},
    },
    fcmDispatcher: {
      wakeExtension: async () => {},
      sendApprovalCard: async (...a: unknown[]) => { calls.approval.push(a) },
      sendTaskComplete: async () => {},
    },
    getExpoPushToken: async () => 'ExponentPushToken[mobile]',
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 't1', haltedStepIndex: 1 })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(calls.halt.length, 1)
  assert.equal(calls.approval.length, 1)
  const [, , , haltIdx, summary] = calls.halt[0] as [string, string, string, number, string]
  assert.equal(haltIdx, 1)
  assert.equal(summary, 'Submit payment')
})

test('watchAuth approved → verifies token → sends FCM wake with resume', async () => {
  const ws = new FakeWs()
  let authWatcher: ((auth: Record<string, unknown>) => void) | null = null
  const fcmWakes: unknown[] = []
  const verifyTokenCalls: string[] = []

  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit payment', action: { type: 'sequence', steps: [
      { type: 'click', selector: '#buy', tier: 'stateful' },
    ] },
  }
  const { options } = deps({
    verifyToken: async (t: string) => { verifyTokenCalls.push(t); return { uid: 'fb-uid' } },
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async () => {},
      closeSession: async () => {},
      haltForAuth: async () => {},
      watchAuth: (_u: string, _s: string, _t: string, cb: (a: Record<string, unknown>) => void) => {
        authWatcher = cb; return () => {}
      },
    },
    fcmDispatcher: {
      wakeExtension: async (...a: unknown[]) => { fcmWakes.push(a) },
      sendApprovalCard: async () => {},
      sendTaskComplete: async () => {},
    },
    getExpoPushToken: async () => 'ExponentPushToken[mobile]',
    getDeviceFcmToken: async () => 'gcm-tok-123',
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 't1', haltedStepIndex: 0 })
  await new Promise((r) => setTimeout(r, 20))

  authWatcher!({ status: 'approved', approvalToken: 'approval-id-token', approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 20))

  assert.ok(verifyTokenCalls.includes('approval-id-token'))
  assert.equal(fcmWakes.length, 1)
  const [, , , resume] = fcmWakes[0] as [string, string, string, boolean]
  assert.equal(resume, true)
})

test('watchAuth denied → aborts task and sends session_end', async () => {
  const ws = new FakeWs()
  let authWatcher: ((auth: Record<string, unknown>) => void) | null = null
  const results: unknown[] = []

  const pendingIntent = {
    version: '1', taskId: 't1', sessionId: SESSION_ID, requiresAuth: true,
    actionSummary: 'Submit', action: { type: 'click', selector: '#s', tier: 'stateful' },
  }
  const { options } = deps({
    firestoreSession: {
      getSession: async () => ({ status: 'pending' }),
      getFirstTask: async () => ({ status: 'pending', intent: pendingIntent }),
      getTask: async () => ({ status: 'pending', intent: pendingIntent }),
      markBrowserConnected: async () => {},
      writeTaskResult: async (...a: unknown[]) => { results.push(a) },
      closeSession: async () => {},
      haltForAuth: async () => {},
      watchAuth: (_u: string, _s: string, _t: string, cb: (a: Record<string, unknown>) => void) => {
        authWatcher = cb; return () => {}
      },
    },
    fcmDispatcher: { wakeExtension: async () => {}, sendApprovalCard: async () => {}, sendTaskComplete: async () => {} },
    getExpoPushToken: async () => null,
    getDeviceFcmToken: async () => null,
  })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: SESSION_ID, deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'awaiting_auth', taskId: 't1', haltedStepIndex: 0 })
  await new Promise((r) => setTimeout(r, 20))

  authWatcher!({ status: 'denied', approvalToken: null, approvedAt: null, expiresAt: 0, actionSummary: '' })
  await new Promise((r) => setTimeout(r, 20))

  const sent = ws.sent.map((s: string) => JSON.parse(s) as { type: string })
  assert.ok(sent.some((s) => s.type === 'session_end'))
  const writeResult = (results[0] as unknown[])[3] as { status: string }
  assert.equal(writeResult.status, 'aborted')
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd cloud-agent && node --test --import tsx/esm src/handlers/wsBrowserAgentHandler.test.ts
```

Expected: FAIL — awaiting_auth handler not implemented.

- [ ] **Step 3: Implement `awaiting_auth` handling in `wsBrowserAgentHandler.ts`**

Replace the file with:

```typescript
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import admin from 'firebase-admin'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'
import type { FcmDispatcher } from '../services/fcmDispatcher.js'
import { sessionBridge } from '../services/sessionBridge.js'
import type { TaskResult, TaskIntent } from '../../../shared/dsl-types.js'
import { taskErrorFrameSchema } from '../../../shared/dsl-schema.js'

const browserAuthSchema = z.object({
  type: z.literal('auth'),
  idToken: z.string().min(1),
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
})

const resultFrameSchema = z.object({
  type: z.literal('task_result'),
  taskId: z.string(),
  data: z.record(z.string(), z.string()),
  activeUrl: z.string(),
})

const awaitingAuthFrameSchema = z.object({
  type: z.literal('awaiting_auth'),
  taskId: z.string(),
  haltedStepIndex: z.number().int().nonnegative(),
})

export interface BrowserWsOptions {
  firestoreSession: FirestoreSession
  fcmDispatcher?: FcmDispatcher
  verifyToken?: (token: string) => Promise<{ uid: string }>
  resolveUserId?: (firebaseUid: string) => Promise<string | null>
  validateDevice?: (firebaseUid: string, deviceId: string) => Promise<boolean>
  getDeviceFcmToken?: (uid: string, deviceId: string) => Promise<string | null>
  getExpoPushToken?: (uid: string) => Promise<string | null>
  instanceId: string
  authTimeoutMs?: number
}

export function handleBrowserWsUpgrade(
  ws: WebSocket,
  _req: IncomingMessage,
  options: BrowserWsOptions,
): void {
  const verifyToken = options.verifyToken ??
    ((t: string) => admin.auth().verifyIdToken(t).then((d) => ({ uid: d.uid })))
  const resolveUserId = options.resolveUserId ?? (async (u: string) => u)
  const validateDevice = options.validateDevice ?? (async () => true)
  const fs = options.firestoreSession
  const fwd = options.fcmDispatcher
  const authTimeoutMs = options.authTimeoutMs ?? 5000

  let authed = false
  let firebaseUid: string | null = null
  let sessionId: string | null = null
  let deviceId: string | null = null
  let dispatchedIntent: TaskIntent | null = null
  let authUnsub: (() => void) | null = null
  let isResume = false  // true when this WS connection resumes an approved, previously-halted task

  const authTimer = setTimeout(() => {
    if (!authed && ws.readyState === ws.OPEN) ws.close(4001, 'Auth timeout')
  }, authTimeoutMs)

  async function onAuth(raw: unknown): Promise<void> {
    const parsed = browserAuthSchema.safeParse(raw)
    if (!parsed.success) { ws.close(4001, 'Invalid auth frame'); return }
    const { idToken, sessionId: sid, deviceId: did } = parsed.data
    let fbUid: string
    try { fbUid = (await verifyToken(idToken)).uid } catch { ws.close(4001, 'Token verification failed'); return }
    const resolved = await resolveUserId(fbUid)
    if (!resolved) { ws.close(4001, 'User not found'); return }
    if (!(await validateDevice(resolved, did))) { ws.close(4001, 'Unknown device'); return }

    const session = await fs.getSession(resolved, sid)
    if (session.status === 'closed' || session.status === 'aborted') {
      ws.close(4001, 'Session closed')
      return
    }

    firebaseUid = resolved; sessionId = sid; deviceId = did; authed = true
    clearTimeout(authTimer)

    const pendingTask = await fs.getFirstTask(firebaseUid, sid)
    if (!pendingTask) { ws.close(4001, 'No pending task'); return }

    dispatchedIntent = pendingTask.intent

    // On resume from approval, slice sequence to start at haltedStepIndex with requiresAuth:false
    let resumeIntent = pendingTask.intent
    if (pendingTask.status === 'awaiting_auth' && pendingTask.haltedStepIndex != null) {
      isResume = true
      const orig = pendingTask.intent.action
      if (orig.type === 'sequence') {
        resumeIntent = {
          ...pendingTask.intent,
          requiresAuth: false, // approved — extension Layer 2 skips for first step
          action: { type: 'sequence', steps: orig.steps.slice(pendingTask.haltedStepIndex) },
        }
      }
    }

    await fs.markBrowserConnected(firebaseUid, sid, options.instanceId, pendingTask.intent.taskId)
    sessionBridge.registerBrowser(firebaseUid, sid, ws)
    ws.send(JSON.stringify({ type: 'session_ready', sessionId: sid }))
    ws.send(JSON.stringify({ type: 'task', intent: resumeIntent }))
  }

  async function onResult(raw: unknown): Promise<void> {
    if (!authed || !firebaseUid || !sessionId) return
    const r = resultFrameSchema.safeParse(raw)
    if (r.success) {
      const result: TaskResult = { taskId: r.data.taskId, status: 'complete', data: r.data.data, activeUrl: r.data.activeUrl }
      await fs.writeTaskResult(firebaseUid, sessionId, r.data.taskId, result)
      // Async delivery: the voice/text turn already ended at the approval pause,
      // so push the completed result to the user's phone (decision: teardown + async push).
      if (isResume && fwd && options.getExpoPushToken) {
        const expoPushToken = await options.getExpoPushToken(firebaseUid)
        if (expoPushToken) {
          await fwd.sendTaskComplete(expoPushToken, r.data.taskId, 'Your browser task finished.').catch(
            (err) => console.error('sendTaskComplete failed:', err)
          )
        }
      }
      ws.send(JSON.stringify({ type: 'session_end' }))
      return
    }
    const e = taskErrorFrameSchema.safeParse(raw)
    if (e.success) {
      const result: TaskResult = {
        taskId: e.data.taskId, status: 'failed', data: {}, activeUrl: '',
        error: { code: e.data.code, message: e.data.message, failedAction: e.data.failedAction },
      }
      await fs.writeTaskResult(firebaseUid, sessionId, e.data.taskId, result)
      ws.send(JSON.stringify({ type: 'session_end' }))
    }
  }

  async function onAwaitingAuth(raw: unknown): Promise<void> {
    if (!authed || !firebaseUid || !sessionId || !dispatchedIntent) return
    const parsed = awaitingAuthFrameSchema.safeParse(raw)
    if (!parsed.success) return
    const { taskId, haltedStepIndex } = parsed.data
    const actionSummary = dispatchedIntent.actionSummary

    // Write awaiting_auth to Firestore
    await fs.haltForAuth(firebaseUid, sessionId, taskId, haltedStepIndex, actionSummary)

    // Fire Expo Push approval card (best effort)
    if (fwd && options.getExpoPushToken) {
      const expoPushToken = await options.getExpoPushToken(firebaseUid)
      if (expoPushToken) {
        await fwd.sendApprovalCard(expoPushToken, sessionId, taskId, actionSummary).catch(
          (err) => console.error('sendApprovalCard failed:', err)
        )
      }
    }

    // Store device FCM token for re-wake
    const deviceFcmToken = options.getDeviceFcmToken
      ? await options.getDeviceFcmToken(firebaseUid, deviceId!)
      : null

    // Watch auth doc — resolve approval or denial
    authUnsub = fs.watchAuth(firebaseUid, sessionId, taskId, async (auth) => {
      if (auth.status === 'pending') return

      authUnsub?.()
      authUnsub = null

      if (auth.status === 'approved') {
        // Verify approvalToken — prove the correct user tapped Approve
        try {
          const decoded = await verifyToken(auth.approvalToken ?? '')
          if (decoded.uid !== firebaseUid) throw new Error('UID mismatch')
        } catch {
          // Invalid token → treat as denied
          await fs.writeTaskResult(firebaseUid!, sessionId!, taskId, {
            taskId, status: 'aborted', data: {}, activeUrl: '',
            error: { code: 'AUTH_TIMEOUT', message: 'Approval token invalid', failedAction: dispatchedIntent!.action as never },
          })
          ws.send(JSON.stringify({ type: 'session_end' }))
          return
        }

        // Re-wake extension via FCM (resume: true)
        if (fwd && deviceFcmToken) {
          await fwd.wakeExtension(deviceFcmToken, sessionId!, taskId, true).catch(
            (err) => console.error('FCM resume wake failed:', err)
          )
        }
        // Extension will reconnect with a new WS; this socket can close
        ws.send(JSON.stringify({ type: 'session_end' }))
      } else {
        // Denied
        await fs.writeTaskResult(firebaseUid!, sessionId!, taskId, {
          taskId, status: 'aborted', data: {}, activeUrl: '',
          error: { code: 'AUTH_TIMEOUT', message: 'Action was denied', failedAction: dispatchedIntent!.action as never },
        })
        ws.send(JSON.stringify({ type: 'session_end' }))
      }
    })
  }

  ws.on('message', (data: Buffer) => {
    let parsed: unknown
    try { parsed = JSON.parse(data.toString()) } catch { return }
    const type = (parsed as { type?: string }).type
    if (type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }
    if (!authed) {
      void onAuth(parsed).catch(() => ws.close(1011, 'Internal error'))
      return
    }
    if (type === 'task_result' || type === 'task_error') {
      void onResult(parsed).catch(() => ws.close(1011, 'Internal error'))
      return
    }
    if (type === 'awaiting_auth') {
      void onAwaitingAuth(parsed).catch(() => ws.close(1011, 'Internal error'))
      return
    }
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    authUnsub?.()
    if (firebaseUid && sessionId) sessionBridge.deregisterBrowser(firebaseUid, sessionId)
  })
  ws.on('error', () => { clearTimeout(authTimer) })
}
```

- [ ] **Step 4: Wire deps in `cloud-agent/src/index.ts`**

In `attachWebSocketRoutes`, update the browser WS handler options:

```typescript
} else if (pathname === '/agent/browser') {
  if (!browserBridgeAvailable) { socket.destroy(); return }
  browserWss.handleUpgrade(req, socket, head, (ws) => {
    handleBrowserWsUpgrade(ws, req, {
      firestoreSession: defaultFirestoreSession(),
      fcmDispatcher: defaultFcmDispatcher(),
      verifyToken,
      resolveUserId: async (fbUid: string) => {
        const rows = await db.select({ id: users.firebaseUid }).from(users)
          .where(eq(users.firebaseUid, fbUid)).limit(1)
        return rows[0]?.id ?? null
      },
      getExpoPushToken: (firebaseUid: string) => getExpoPushToken(db, firebaseUid),
      getDeviceFcmToken: async (uid: string, deviceId: string) => {
        const snap = await admin.firestore().doc(`users/${uid}/devices/${deviceId}`).get()
        if (!snap.exists) return null
        return (snap.data()?.fcmToken as string) ?? null
      },
      instanceId: INSTANCE_ID,
    })
  })
}
```

Add required imports at the top of `index.ts`:

```typescript
import { getExpoPushToken } from './handlers/expoPushToken.js'
import { eq } from 'drizzle-orm'
import { users } from './db/schema.js'
```

- [ ] **Step 5: Run tests and verify pass**

```bash
cd cloud-agent && node --test --import tsx/esm src/handlers/wsBrowserAgentHandler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/src/handlers/wsBrowserAgentHandler.ts \
  cloud-agent/src/handlers/wsBrowserAgentHandler.test.ts \
  cloud-agent/src/index.ts
git commit -m "feat(bridge/p2): handle awaiting_auth frame — haltForAuth, Expo Push, watchAuth approval loop"
```

---

### Task 5: Cloud Agent Approve-Action Endpoint

> **Spec deviation (intentional):** The spec shows the mobile app writing the approval decision *directly* to the Firestore auth doc. The mobile app does **not** depend on `@react-native-firebase/firestore` (verified — only `auth`, `app`, `app-check`, `functions`, `crashlytics`). Adding a Firestore client SDK to mobile for one write is unjustified. Instead, mobile POSTs to this Cloud Agent endpoint (behind existing `requireAuth`), and the Admin SDK performs the auth-doc write. The Firestore rules in Task 12 remain as defense-in-depth for any future direct-write path but are not the write path used here.

**Files:**
- Modify: `cloud-agent/src/index.ts`

- [ ] **Step 1: Write test for `POST /agent/browser/approve-action`**

Create `cloud-agent/src/handlers/approveAction.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { handleApproveAction } from './approveAction.js'

test('handleApproveAction writes approved to auth doc', async () => {
  const updates: Array<{ path: string; data: Record<string, unknown> }> = []
  const fakeDb = {
    doc: (path: string) => ({
      update: async (data: Record<string, unknown>) => { updates.push({ path, data }) },
    }),
  }

  await handleApproveAction(fakeDb as never, 'uid1', {
    sessionId: 'sid1', taskId: 'tid1', approve: true, idToken: 'raw-token',
  })

  assert.equal(updates.length, 1)
  assert.equal(updates[0].path, 'users/uid1/sessions/sid1/auth/tid1')
  assert.equal(updates[0].data.status, 'approved')
  assert.equal(updates[0].data.approvalToken, 'raw-token')
})

test('handleApproveAction writes denied to auth doc', async () => {
  const updates: Array<{ path: string; data: Record<string, unknown> }> = []
  const fakeDb = {
    doc: (path: string) => ({
      update: async (data: Record<string, unknown>) => { updates.push({ path, data }) },
    }),
  }

  await handleApproveAction(fakeDb as never, 'uid1', {
    sessionId: 'sid1', taskId: 'tid1', approve: false, idToken: '',
  })

  assert.equal(updates[0].data.status, 'denied')
})
```

- [ ] **Step 2: Create `cloud-agent/src/handlers/approveAction.ts`**

```typescript
import admin from 'firebase-admin'

interface ApproveActionBody {
  sessionId: string
  taskId: string
  approve: boolean
  idToken: string
}

interface FirestoreLite {
  doc(path: string): { update(data: Record<string, unknown>): Promise<void> }
}

export async function handleApproveAction(
  db: FirestoreLite,
  uid: string,
  body: ApproveActionBody,
): Promise<void> {
  const authPath = `users/${uid}/sessions/${body.sessionId}/auth/${body.taskId}`
  if (body.approve) {
    await db.doc(authPath).update({
      status: 'approved',
      approvalToken: body.idToken,
      approvedAt: admin.firestore?.Timestamp?.now?.() ?? new Date(),
    })
  } else {
    await db.doc(authPath).update({ status: 'denied' })
  }
}
```

- [ ] **Step 3: Run test**

```bash
cd cloud-agent && node --test --import tsx/esm src/handlers/approveAction.test.ts
```

Expected: PASS.

- [ ] **Step 4: Register endpoint in `cloud-agent/src/index.ts`**

```typescript
import { handleApproveAction } from './handlers/approveAction.js'
```

Add endpoint:

```typescript
app.post('/agent/browser/approve-action', requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
  const parsed = z.object({
    sessionId: z.string().uuid(),
    taskId: z.string().min(1),
    approve: z.boolean(),
  }).safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Invalid request body' }); return }

  const rawToken = req.headers.authorization?.replace('Bearer ', '') ?? ''
  try {
    await handleApproveAction(
      admin.firestore() as unknown as { doc(p: string): { update(d: Record<string, unknown>): Promise<void> } },
      req.uid!,
      { ...parsed.data, idToken: rawToken },
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('approve-action error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})
```

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/handlers/approveAction.ts cloud-agent/src/handlers/approveAction.test.ts \
  cloud-agent/src/index.ts
git commit -m "feat(bridge/p2): add POST /agent/browser/approve-action endpoint"
```

---

### Task 6: browserAction Tool — Teardown + Async Push on awaiting_auth

**Decision (resolved):** When a task halts for approval, the voice/text turn does **not** block waiting for the (possibly multi-minute) approval. The tool narrates the pause, resumes billing, tears down the 30s wait, and ends the turn. The final result is delivered later via `sendTaskComplete` Expo Push (wired in Task 4 `onResult`, `isResume` branch). This avoids the 30s `textTimeoutMs` misfiring `EXECUTION_TIMEOUT` and resuming billing while the user is still deciding.

`TaskDoc.status` already includes `awaiting_auth`, so `awaiting_auth` is treated as a terminal-for-this-turn status inside `waitForTerminalTask`.

**Files:**
- Modify: `cloud-agent/src/tools/browserAction.ts`
- Modify: `cloud-agent/src/tools/browserAction.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `cloud-agent/src/tools/browserAction.test.ts`:

```typescript
test('voice path: awaiting_auth narrates pause, resumes billing, ends turn (no EXECUTION_TIMEOUT)', async () => {
  const pushed: string[] = []
  let resumed = false
  let taskWatcher: ((t: Record<string, unknown>) => void) | null = null
  let unsubbed = false

  const tool = browserActionTool({
    firebaseUid: 'fb-uid',
    userId: 'user-id',
    firestoreSession: {
      getActiveDevice: async () => ({ deviceId: 'd1', fcmToken: 'tok', deviceName: 'Mac' }),
      createSession: async () => {},
      writeTask: async () => {},
      closeSession: async () => {},
      getTask: async () => ({ status: 'awaiting_auth', intent: {} as never }),
      getSession: async () => ({ status: 'routing', browserInstanceId: 'i' }),
      watchTask: (_u: string, _s: string, _t: string, cb) => { taskWatcher = cb as never; return () => { unsubbed = true } },
    } as never,
    fcmDispatcher: { wakeExtension: async () => {} } as never,
    creditService: { spendCredit: async () => 'tx1', refundCredit: async () => {} } as never,
    instanceId: 'i-test',
    pushToLive: (msg: string) => { pushed.push(msg) },
    pauseBilling: () => {},
    resumeBilling: () => { resumed = true },
    wakeTimeoutMs: 50,
    textTimeoutMs: 200,
  }, { trigger: 'voice', preBilled: false })

  await tool.execute({ actionSummary: 'Submit form', intent: { action: { type: 'click', selector: '#s', tier: 'stateful' } } })

  await new Promise((r) => setTimeout(r, 20))
  taskWatcher!({ status: 'awaiting_auth' })
  await new Promise((r) => setTimeout(r, 20))

  assert.ok(pushed.some((m) => m.toLowerCase().includes('pause') || m.toLowerCase().includes('phone')))
  assert.ok(resumed, 'billing must resume at the pause')
  assert.ok(unsubbed, 'watchTask listener must be torn down')

  // Past the 200ms cap: no EXECUTION_TIMEOUT message should appear.
  await new Promise((r) => setTimeout(r, 250))
  assert.ok(!pushed.some((m) => m.toLowerCase().includes('timeout') || m.toLowerCase().includes('30s')))
})

test('text path: awaiting_auth returns a phone-approval message', async () => {
  let taskWatcher: ((t: Record<string, unknown>) => void) | null = null
  const tool = browserActionTool({
    firebaseUid: 'fb-uid',
    userId: 'user-id',
    firestoreSession: {
      getActiveDevice: async () => ({ deviceId: 'd1', fcmToken: 'tok', deviceName: 'Mac' }),
      createSession: async () => {},
      writeTask: async () => {},
      closeSession: async () => {},
      getTask: async () => ({ status: 'awaiting_auth', intent: {} as never }),
      getSession: async () => ({ status: 'routing', browserInstanceId: 'i' }),
      watchTask: (_u: string, _s: string, _t: string, cb) => { taskWatcher = cb as never; return () => {} },
    } as never,
    fcmDispatcher: { wakeExtension: async () => {} } as never,
    creditService: { spendCredit: async () => 'tx1', refundCredit: async () => {} } as never,
    instanceId: 'i-test',
    wakeTimeoutMs: 50,
    textTimeoutMs: 200,
  }, { trigger: 'text', preBilled: true })

  const p = tool.execute({ actionSummary: 'Submit form', intent: { action: { type: 'click', selector: '#s', tier: 'stateful' } } })
  await new Promise((r) => setTimeout(r, 20))
  taskWatcher!({ status: 'awaiting_auth' })
  const out = await p
  assert.match(out, /phone|approve/i)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd cloud-agent && node --test --import tsx/esm src/tools/browserAction.test.ts
```

Expected: FAIL — awaiting_auth currently is not a recognized terminal status; the 30s cap governs instead.

- [ ] **Step 3: Patch `waitForTerminalTask` in `browserAction.ts`**

Treat `awaiting_auth` as terminal-for-this-turn so the wait resolves immediately and the 30s timer never fires after a halt:

```typescript
const unsub = fs.watchTask(deps.firebaseUid, sessionId, taskId, (task) => {
  if (
    task.status === 'awaiting_auth' ||
    task.status === 'complete' ||
    task.status === 'failed' ||
    task.status === 'aborted'
  ) {
    settled = true
    clearTimeout(timeout)
    clearTimeout(wakeTimer)
    unsub()
    resolve(task)
  }
})
```

- [ ] **Step 4: Update `formatResult` to handle the halt status**

```typescript
function formatResult(task: TaskDoc): string {
  if (task.status === 'awaiting_auth') {
    return "I've paused this action. Approve it on your phone and I'll finish — I'll let you know when it's done."
  }
  if (task.status === 'complete' && task.result) {
    const data = task.result.data ?? {}
    const body = Object.keys(data).length ? JSON.stringify(data) : '(no extracted data)'
    return `Browser task complete on ${task.result.activeUrl}: ${body}`
  }
  const code = task.error?.code ?? task.result?.error?.code ?? 'EXECUTION_ERROR'
  if (code === 'EXTENSION_OFFLINE') return 'Your browser extension appears to be offline.'
  return `Browser task failed (${code}): ${task.error?.message ?? task.result?.error?.message ?? 'unknown error'}`
}
```

Both the text path (`return formatResult(await waitForTerminalTask())`) and the voice path (`.then((task) => { deps.resumeBilling?.(); deps.pushToLive?.(formatResult(task)) })`) reuse this — no further branching needed. The voice `.then` already calls `resumeBilling()` before narrating, satisfying the teardown-resumes-billing requirement for the halt case.

- [ ] **Step 5: Run tests and verify pass**

```bash
cd cloud-agent && node --test --import tsx/esm src/tools/browserAction.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/src/tools/browserAction.ts cloud-agent/src/tools/browserAction.test.ts
git commit -m "feat(bridge/p2): teardown + async-push on awaiting_auth; no 30s misfire after halt"
```

---

### Task 7: Extension — Stateful Actions in Executor

**Files:**
- Modify: `extension/src/content/executor.ts`
- Modify: `extension/src/content/executor.test.ts`

- [ ] **Step 1: Write failing tests for `fill_field`, `click`, and classifier wiring**

Add to `extension/src/content/executor.test.ts`:

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { runAction } from './executor.js'
import type { SingleAction } from '../shared/dsl-types.js'

// JSDOM document — matches the pattern in dom-extractor.test.ts.
// runAction uses doc.querySelector + el.dispatchEvent(new Event(...)),
// all of which the JSDOM document provides natively.
function dom(html: string) {
  const d = new JSDOM(html, { url: 'https://test.com' })
  return { doc: d.window.document, win: { scrollBy: () => {}, location: { href: 'https://test.com' } } }
}

test('fill_field sets input value and fires input + change events', async () => {
  const { doc, win } = dom('<input id="username" />')
  const events: string[] = []
  const el = doc.querySelector('#username')!
  el.addEventListener('input', () => events.push('input'))
  el.addEventListener('change', () => events.push('change'))

  const result = await runAction(
    { type: 'fill_field', selector: '#username', value: 'hello', tier: 'stateful' } as SingleAction,
    doc, win, { skipLayerTwo: true },
  )

  assert.ok(!('awaitingAuth' in result))
  assert.equal((el as HTMLInputElement).value, 'hello')
  assert.ok(events.includes('input'))
  assert.ok(events.includes('change'))
})

test('click executes click on element', async () => {
  const { doc, win } = dom('<button id="btn">Go</button>')
  let clicked = false
  doc.querySelector('#btn')!.addEventListener('click', () => { clicked = true })

  await runAction(
    { type: 'click', selector: '#btn', tier: 'stateful' } as SingleAction,
    doc, win, { skipLayerTwo: true },
  )

  assert.ok(clicked)
})

test('click returns awaitingAuth when classifier flags requires_auth (skipLayerTwo: false)', async () => {
  const { doc, win } = dom('<button id="pay">Submit Payment</button>')  // matches DESTRUCTIVE_ACTION_PATTERN
  const result = await runAction(
    { type: 'click', selector: '#pay', tier: 'stateful' } as SingleAction,
    doc, win, { skipLayerTwo: false },
  )
  assert.ok('awaitingAuth' in result)
})

test('fill_field on form submit input returns awaitingAuth', async () => {
  const { doc, win } = dom('<form><input id="s" type="submit" value="Pay Now" /></form>')
  const result = await runAction(
    { type: 'fill_field', selector: '#s', value: 'x', tier: 'stateful' } as SingleAction,
    doc, win, { skipLayerTwo: false },
  )
  assert.ok('awaitingAuth' in result)
})

test('fill_field throws SELECTOR_NOT_FOUND when element missing', async () => {
  const { doc, win } = dom('<div></div>')
  await assert.rejects(
    () => runAction({ type: 'fill_field', selector: '#missing', value: 'x', tier: 'stateful' } as SingleAction, doc, win, {}),
    /SELECTOR_NOT_FOUND/,
  )
})

test('click throws SELECTOR_NOT_FOUND when element missing', async () => {
  const { doc, win } = dom('<div></div>')
  await assert.rejects(
    () => runAction({ type: 'click', selector: '#missing', tier: 'stateful' } as SingleAction, doc, win, {}),
    /SELECTOR_NOT_FOUND/,
  )
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd extension && node --test --import tsx/esm src/content/executor.test.ts
```

Expected: FAIL — `fill_field` and `click` throw "not enabled in Phase 1".

- [ ] **Step 3: Implement stateful actions in `executor.ts`**

Replace the file:

```typescript
import type { SingleAction } from '../shared/dsl-types.js'
import { extract, readDom, summarizeVisibleText } from './dom-extractor.js'
import { classifyElement } from './safety-classifier.js'

export interface ActionOutcome { data: Record<string, string>; activeUrl: string }
export type ActionResult = ActionOutcome | { awaitingAuth: true }

interface WinLike { scrollBy(x: number, y: number): void; location: { href: string } }

export interface RunActionContext {
  skipLayerTwo?: boolean  // true on resume after explicit user approval
}

export async function runAction(
  action: SingleAction,
  doc: Document,
  win: WinLike,
  ctx: RunActionContext = {},
): Promise<ActionResult> {
  const activeUrl = win.location.href
  switch (action.type) {
    case 'extract':
      return { data: extract(doc, action.selector, action.label ?? 'value'), activeUrl }
    case 'read_dom':
      return { data: { read_dom: readDom(doc, action.selector) }, activeUrl }
    case 'summarize_visible_text':
      return { data: { summary: summarizeVisibleText(doc, action.filter ?? 'all') }, activeUrl }
    case 'scroll': {
      const delta = (action.pixels ?? 600) * (action.direction === 'up' ? -1 : 1)
      win.scrollBy(0, delta)
      return { data: {}, activeUrl }
    }
    case 'open_tab':
    case 'focus_tab':
      throw new Error('EXECUTION_ERROR: tab actions are handled by the service worker')
    case 'fill_field': {
      const el = doc.querySelector(action.selector)
      if (!el) throw new Error('SELECTOR_NOT_FOUND')
      if (!ctx.skipLayerTwo && classifyElement(el) === 'requires_auth') return { awaitingAuth: true }
      ;(el as HTMLInputElement).value = action.value
      // Build events from the element's own view so this works under JSDOM (tests)
      // and in the injected page context (runtime) alike.
      const EventCtor = (el.ownerDocument?.defaultView ?? globalThis).Event
      el.dispatchEvent(new EventCtor('input', { bubbles: true }))
      el.dispatchEvent(new EventCtor('change', { bubbles: true }))
      return { data: {}, activeUrl }
    }
    case 'click': {
      const el = doc.querySelector(action.selector)
      if (!el) throw new Error('SELECTOR_NOT_FOUND')
      if (!ctx.skipLayerTwo && classifyElement(el) === 'requires_auth') return { awaitingAuth: true }
      ;(el as HTMLElement).click()
      return { data: {}, activeUrl }
    }
    default:
      throw new Error('EXECUTION_ERROR: unknown action')
  }
}

export async function runActionInPage(action: SingleAction, ctx: RunActionContext = {}): Promise<ActionResult> {
  return runAction(action, document, window as unknown as WinLike, ctx)
}
```

- [ ] **Step 4: Run tests and verify pass**

```bash
cd extension && node --test --import tsx/esm src/content/executor.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/executor.ts extension/src/content/executor.test.ts
git commit -m "feat(bridge/p2): implement fill_field and click with Layer 2 safety classifier"
```

---

### Task 8: Extension — Task Dispatcher Halt + WsClient sendAwaitingAuth

**Files:**
- Modify: `extension/src/background/task-dispatcher.ts`
- Modify: `extension/src/background/task-dispatcher.test.ts`
- Modify: `extension/src/background/ws-client.ts`
- Modify: `extension/src/background/ws-client.test.ts`
- Modify: `extension/src/background/content-bridge.ts`

- [ ] **Step 1: Write failing tests**

Add to `extension/src/background/task-dispatcher.test.ts`:

```typescript
import { dispatchTask } from '../background/task-dispatcher.js'
import type { TaskIntent } from '../shared/dsl-types.js'

const baseIntent: TaskIntent = {
  version: '1', taskId: 't1', sessionId: 's1',
  requiresAuth: true, actionSummary: 'Submit',
  action: { type: 'sequence', steps: [
    { type: 'extract', selector: '.price', label: 'price' },
    { type: 'click', selector: '#buy', label: 'Buy', tier: 'stateful' },
  ] },
}

test('dispatchTask halts with awaiting_auth when step returns awaitingAuth', async () => {
  let stepIdx = 0
  const inj = {
    runInActiveTab: async () => {
      if (stepIdx++ === 1) return { awaitingAuth: true as const }
      return { data: { price: '$10' }, activeUrl: 'https://x.com' }
    },
    openTab: async () => {},
    focusTab: async () => {},
  } as never

  const outcome = await dispatchTask(baseIntent, inj)
  assert.equal(outcome.status, 'awaiting_auth')
  assert.equal((outcome as { haltedStepIndex: number }).haltedStepIndex, 1)
})

test('dispatchTask completes when no step requires auth', async () => {
  const inj = {
    runInActiveTab: async () => ({ data: { price: '$10' }, activeUrl: 'https://x.com' }),
    openTab: async () => {},
    focusTab: async () => {},
  } as never

  const intent: TaskIntent = { ...baseIntent, requiresAuth: false, action: { type: 'extract', selector: '.p', label: 'p' } }
  const outcome = await dispatchTask(intent, inj)
  assert.equal(outcome.status, 'complete')
})
```

Add to `extension/src/background/ws-client.test.ts`:

```typescript
test('sendAwaitingAuth sends correct frame', async () => {
  const sent: string[] = []
  const { createWsClient } = await import('./ws-client.js')
  const client = createWsClient({
    url: 'ws://test',
    idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    onTask: () => {}, onSessionEnd: () => {},
    WebSocketImpl: class {
      onopen: (() => void) | null = null
      onmessage: ((e: { data: string }) => void) | null = null
      onclose: (() => void) | null = null
      readyState = 1
      send(s: string) { sent.push(s) }
      close() {}
    } as never,
  })
  client.connect()
  client.sendAwaitingAuth('t1', 2)
  const frame = JSON.parse(sent.find((s) => JSON.parse(s).type === 'awaiting_auth') ?? '{}') as { type: string; taskId: string; haltedStepIndex: number }
  assert.equal(frame.type, 'awaiting_auth')
  assert.equal(frame.taskId, 't1')
  assert.equal(frame.haltedStepIndex, 2)
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd extension && node --test --import tsx/esm src/background/task-dispatcher.test.ts src/background/ws-client.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Update `task-dispatcher.ts`**

Replace the file:

```typescript
import type { TaskIntent, SingleAction, TaskResult, BridgeErrorCode } from '../shared/dsl-types.js'

export interface Injector {
  runInActiveTab(action: SingleAction, ctx?: { skipLayerTwo?: boolean }): Promise<{ data: Record<string, string>; activeUrl: string } | { awaitingAuth: true }>
  openTab(url: string): Promise<void>
  focusTab(host: string): Promise<void>
}

export type AwaitingAuthOutcome = { status: 'awaiting_auth'; taskId: string; haltedStepIndex: number }
export type DispatchOutcome = TaskResult | AwaitingAuthOutcome

function knownCode(msg: string): BridgeErrorCode {
  for (const c of ['SELECTOR_NOT_FOUND', 'HOST_NOT_ALLOWED', 'HOST_PERMISSION_REQUIRED', 'EXECUTION_TIMEOUT'] as const) {
    if (msg.includes(c)) return c
  }
  return 'EXECUTION_ERROR'
}

export async function dispatchTask(intent: TaskIntent, inj: Injector): Promise<DispatchOutcome> {
  const steps: SingleAction[] = intent.action.type === 'sequence' ? intent.action.steps : [intent.action]
  // On resume (requiresAuth: false from Cloud Agent sliced intent), first step is pre-approved
  const skipLayerTwoForFirst = !intent.requiresAuth && steps.length > 0 &&
    (steps[0].type === 'fill_field' || steps[0].type === 'click')

  const data: Record<string, string> = {}
  let activeUrl = ''
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (step.type === 'open_tab') { await inj.openTab(step.url); activeUrl = step.url; continue }
      if (step.type === 'focus_tab') { await inj.focusTab(step.host); continue }
      const ctx = { skipLayerTwo: skipLayerTwoForFirst && i === 0 }
      const out = await inj.runInActiveTab(step, ctx)
      if ('awaitingAuth' in out) {
        return { status: 'awaiting_auth', taskId: intent.taskId, haltedStepIndex: i }
      }
      Object.assign(data, out.data)
      activeUrl = out.activeUrl || activeUrl
    }
    return { taskId: intent.taskId, status: 'complete', data, activeUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'execution failed'
    return {
      taskId: intent.taskId, status: 'failed', data, activeUrl,
      error: { code: knownCode(msg), message: msg, failedAction: steps[0] },
    }
  }
}
```

- [ ] **Step 4: Update `content-bridge.ts` to propagate awaitingAuth from injected script**

In `content-bridge.ts`, update `runInActiveTab`:

```typescript
async runInActiveTab(action: SingleAction, ctx: { skipLayerTwo?: boolean } = {}) {
  const tab = await activeTab()
  if (tab.url) await ensureHost(tab.url)
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: runActionInPage as unknown as (...a: unknown[]) => unknown,
    args: [action, ctx],
  })
  const out = res?.result as { data: Record<string, string>; activeUrl: string } | { awaitingAuth: true } | undefined
  if (!out) throw new Error('EXECUTION_ERROR: empty injection result')
  if ('awaitingAuth' in out) return { awaitingAuth: true as const }
  return out
},
```

- [ ] **Step 5: Add `sendAwaitingAuth` to `ws-client.ts`**

In `ws-client.ts`, add to the returned object:

```typescript
sendAwaitingAuth(taskId: string, haltedStepIndex: number): void {
  sock?.send(JSON.stringify({ type: 'awaiting_auth', taskId, haltedStepIndex }))
},
```

- [ ] **Step 6: Run tests and verify pass**

```bash
cd extension && node --test --import tsx/esm \
  src/background/task-dispatcher.test.ts \
  src/background/ws-client.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/background/task-dispatcher.ts extension/src/background/task-dispatcher.test.ts \
  extension/src/background/ws-client.ts extension/src/background/ws-client.test.ts \
  extension/src/background/content-bridge.ts
git commit -m "feat(bridge/p2): task-dispatcher halt on awaiting_auth; ws-client sendAwaitingAuth"
```

---

### Task 9: Extension — Service Worker Handles awaiting_auth Outcome

**Files:**
- Modify: `extension/src/background/service-worker.ts`

- [ ] **Step 1: Review current `onTask` handler**

Open `extension/src/background/service-worker.ts`, find `onTask`:

```typescript
onTask: (intent) => {
  void (async () => {
    const result = await dispatchTask(intent, injector)
    await appendActionLog(intent, result.status)
    client.sendResult(result)
  })()
},
```

- [ ] **Step 2: Update service-worker.ts to handle awaiting_auth outcome and resume**

Replace the `chrome.gcm.onMessage.addListener` call and the `wakeAndConnect` function:

```typescript
chrome.gcm.onMessage.addListener((message) => {
  const data = message.data as { type?: string; sessionId?: string; taskId?: string; resume?: string }
  if (data.type !== 'WAKE_AND_CONNECT' || !data.sessionId) return
  void wakeAndConnect(data.sessionId)
})

async function wakeAndConnect(sessionId: string): Promise<void> {
  const { paused } = await chrome.storage.local.get('paused')
  if (paused) return
  await ensureOffscreen()
  let idToken: string
  try { idToken = await requestIdToken() } catch (e) { console.error('No auth for wake:', e); return }
  const deviceId = await getDeviceId()
  const injector = createInjector()

  const client = createWsClient({
    url: CLOUD_WS_URL, idToken, sessionId, deviceId,
    onSessionReady: () => {
      void chrome.storage.local.get('gcmToken').then(({ gcmToken }) => {
        if (gcmToken) void upsertDeviceRegistration(idToken, gcmToken as string)
      })
    },
    onTask: (intent) => {
      void (async () => {
        const outcome = await dispatchTask(intent, injector)
        if (outcome.status === 'awaiting_auth') {
          client.sendAwaitingAuth(outcome.taskId, outcome.haltedStepIndex)
          await appendActionLog(intent, 'awaiting_auth')
          // Close WS — service worker suspends; Cloud Agent will re-wake via FCM on approval
          client.close()
          void closeOffscreen()
          return
        }
        const result = outcome as import('../shared/dsl-types.js').TaskResult
        await appendActionLog(intent, result.status)
        client.sendResult(result)
      })()
    },
    onSessionEnd: () => { client.close(); void closeOffscreen() },
  })
  client.connect()
}
```

- [ ] **Step 3: Build extension to check for TypeScript errors**

```bash
cd extension && node esbuild.mjs
```

Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add extension/src/background/service-worker.ts
git commit -m "feat(bridge/p2): service worker handles awaiting_auth dispatch outcome and suspends"
```

---

### Task 10: Mobile App — Push Token Registration

**Files:**
- Create: `src/hooks/useRegisterExpoPushToken.ts`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Install expo-notifications**

```bash
npx expo install expo-notifications expo-task-manager
```

For bare workflow, run:

```bash
cd ios && pod install && cd ..
```

- [ ] **Step 2: Write test for `useRegisterExpoPushToken`**

Create `__tests__/useRegisterExpoPushToken.test.ts`:

```typescript
import { renderHook } from '@testing-library/react-hooks'
import { useRegisterExpoPushToken } from '~/hooks/useRegisterExpoPushToken'

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'undetermined' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[test]' }),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(true),
}))

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: jest.fn().mockReturnValue({ getIdToken: jest.fn().mockResolvedValue('id-tok') }),
}))

jest.mock('../shared/localCloudAgent', () => ({
  getCloudAgentBaseUrl: () => 'https://agent.test',
}))

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as jest.Mock

describe('useRegisterExpoPushToken', () => {
  it('registers token and POSTs to cloud agent', async () => {
    const { result } = renderHook(() => useRegisterExpoPushToken({ enabled: true, projectId: 'test-proj' }))
    await new Promise((r) => setTimeout(r, 50))
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/agent/user/expo-push-token'),
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
```

- [ ] **Step 3: Run test to confirm it fails**

```bash
npx jest __tests__/useRegisterExpoPushToken.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create `src/hooks/useRegisterExpoPushToken.ts`**

```typescript
import { useEffect } from 'react'
import * as Notifications from 'expo-notifications'
import { getCloudAgentBaseUrl } from '../../shared/localCloudAgent'
import { getCurrentUser } from '~/config/firebaseConfig'

interface Options {
  enabled: boolean
  projectId: string
}

export function useRegisterExpoPushToken({ enabled, projectId }: Options): void {
  useEffect(() => {
    if (!enabled) return
    void (async () => {
      const { status: existing } = await Notifications.getPermissionsAsync()
      const { status } = existing === 'granted'
        ? { status: 'granted' as const }
        : await Notifications.requestPermissionsAsync()
      if (status !== 'granted') return

      const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId })
      const user = getCurrentUser()
      if (!user) return
      const idToken = await user.getIdToken()

      await fetch(`${getCloudAgentBaseUrl()}/agent/user/expo-push-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ expoPushToken }),
      })
    })()
  }, [enabled, projectId])
}
```

- [ ] **Step 5: Run test and verify pass**

```bash
npx jest __tests__/useRegisterExpoPushToken.test.ts
```

Expected: PASS.

- [ ] **Step 6: Wire hook into `app/_layout.tsx`**

Add near other `useEffect` hooks in the app root (in `AppOrchestrator` or the root layout):

```typescript
import { useRegisterExpoPushToken } from '~/hooks/useRegisterExpoPushToken'
import Constants from 'expo-constants'

// Inside AppOrchestrator or root layout component:
const isSignedIn = useSelector(authService, (state) => state.matches('signedIn'))
useRegisterExpoPushToken({
  enabled: isSignedIn,
  projectId: Constants.expoConfig?.extra?.eas?.projectId ?? '',
})
```

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useRegisterExpoPushToken.ts __tests__/useRegisterExpoPushToken.test.ts app/_layout.tsx
git commit -m "feat(bridge/p2): register Expo push token on sign-in"
```

---

### Task 11: Mobile App — Notification Category + Background Approval Handler

**Files:**
- Create: `src/hooks/useBrowserActionApproval.ts`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Write test for background task definition and category registration**

Create `__tests__/useBrowserActionApproval.test.ts`:

```typescript
import { renderHook } from '@testing-library/react-hooks'

jest.mock('expo-notifications', () => ({
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(true),
}))

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskDefined: jest.fn().mockReturnValue(false),
}))

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: jest.fn().mockReturnValue({ currentUser: { getIdToken: jest.fn().mockResolvedValue('id-tok') } }),
}))

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }) as jest.Mock

import * as TaskManager from 'expo-task-manager'
import { setupBrowserActionApproval } from '~/hooks/useBrowserActionApproval'

describe('setupBrowserActionApproval', () => {
  it('registers BROWSER_ACTION_APPROVAL notification category', async () => {
    const Notifications = require('expo-notifications') as { setNotificationCategoryAsync: jest.Mock }
    await setupBrowserActionApproval()
    expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(
      'BROWSER_ACTION_APPROVAL',
      expect.arrayContaining([
        expect.objectContaining({ identifier: 'APPROVE' }),
        expect.objectContaining({ identifier: 'DENY' }),
      ]),
    )
    expect(TaskManager.defineTask).toHaveBeenCalledWith(
      'BROWSER_ACTION_APPROVAL_RESPONSE',
      expect.any(Function),
    )
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest __tests__/useBrowserActionApproval.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create `src/hooks/useBrowserActionApproval.ts`**

```typescript
import { useEffect } from 'react'
import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { getAuth } from '@react-native-firebase/auth'
import { getCloudAgentBaseUrl } from '../../shared/localCloudAgent'

export const APPROVAL_TASK = 'BROWSER_ACTION_APPROVAL_RESPONSE'

export async function setupBrowserActionApproval(): Promise<void> {
  // Register notification category with lock-screen APPROVE / DENY buttons
  await Notifications.setNotificationCategoryAsync('BROWSER_ACTION_APPROVAL', [
    {
      identifier: 'APPROVE',
      buttonTitle: 'Approve',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'DENY',
      buttonTitle: 'Deny',
      options: { opensAppToForeground: false },
    },
  ])

  // Define background task (safe to call multiple times — TaskManager deduplicates)
  if (!TaskManager.isTaskDefined(APPROVAL_TASK)) {
    TaskManager.defineTask(APPROVAL_TASK, async ({ data }: { data: { notification: Notifications.Notification; actionIdentifier: string } }) => {
      try {
        const { notification, actionIdentifier } = data
        const { sessionId, taskId } = notification.request.content.data as { sessionId: string; taskId: string }
        const user = getAuth().currentUser
        if (!user) return TaskManager.TaskExecutionResult.SUCCESS

        const idToken = await user.getIdToken()
        await fetch(`${getCloudAgentBaseUrl()}/agent/browser/approve-action`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            sessionId,
            taskId,
            approve: actionIdentifier === 'APPROVE',
          }),
        })
      } catch (err) {
        console.error('Browser action approval handler error:', err)
      }
      return TaskManager.TaskExecutionResult.SUCCESS
    })
  }

  // Register task to fire on notification action responses
  await Notifications.registerTaskAsync(APPROVAL_TASK)
}

export function useBrowserActionApproval(): void {
  useEffect(() => {
    void setupBrowserActionApproval()
  }, [])
}
```

- [ ] **Step 4: Run test and verify pass**

```bash
npx jest __tests__/useBrowserActionApproval.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire hook into `app/_layout.tsx`**

```typescript
import { useBrowserActionApproval } from '~/hooks/useBrowserActionApproval'

// Inside root layout component (runs once on app startup):
useBrowserActionApproval()
```

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useBrowserActionApproval.ts __tests__/useBrowserActionApproval.test.ts app/_layout.tsx
git commit -m "feat(bridge/p2): notification category BROWSER_ACTION_APPROVAL + background handler"
```

---

### Task 12: Firestore Security Rules Update

**Files:**
- Modify: `firestore.rules` (path in repo root or `firebase/firestore.rules`)

- [ ] **Step 1: Locate the rules file**

```bash
find /Users/equationalapplications/code/src/github.com/equationalapplications/clanker -name "firestore.rules" | grep -v node_modules
```

- [ ] **Step 2: Update the auth doc rules**

Find the `match /users/{uid}/sessions/{sessionId}/auth/{taskId}` block and replace with:

```
match /users/{uid}/sessions/{sessionId}/auth/{taskId} {
  allow read: if request.auth.uid == uid;
  // Admin SDK creates the auth doc (haltForAuth). Mobile writes approval decision only.
  allow update: if request.auth.uid == uid
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['status', 'approvalToken', 'approvedAt']);
}
```

If the auth doc block doesn't exist yet, add it inside `match /users/{uid} {`.

- [ ] **Step 3: Deploy rules to staging**

```bash
firebase deploy --only firestore:rules --project staging
```

- [ ] **Step 4: Commit**

```bash
git add firestore.rules
git commit -m "feat(bridge/p2): Firestore rules — allow mobile to write auth doc approval fields"
```

---

### Task 13: Phase Gate — E2E Validation on Staging Payment Form

**Manual test. No code changes.**

- [ ] **Step 1: Build and load the extension unpacked**

```bash
cd extension && node esbuild.mjs
```

Load `extension/dist` as unpacked extension in Chrome. Sign in via side panel.

- [ ] **Step 2: Prepare the staging payment form**

Open a staging form with a payment submit button (e.g., Stripe test checkout). Confirm the form has a `#submit-order-btn` or equivalent selector.

- [ ] **Step 3: Send a mixed-tier task via voice**

In the mobile app, say:
> "Fill in the shipping address and submit the order on the checkout page."

Expected:
1. Extension opens; extracts form fields; fills shipping address.
2. Extension halts at submit button — Layer 2 classifier triggers.
3. Mobile receives Expo Push notification: "Clanker needs your approval — Submit payment of $XX."
4. Voice says: "I've paused the browser action. Check your phone to approve."

- [ ] **Step 4: Tap Approve on the mobile notification**

Expected:
1. Mobile sends `POST /agent/browser/approve-action { approve: true }`.
2. Cloud Agent watchAuth fires, verifies token, sends FCM WAKE_AND_CONNECT resume.
3. Extension reconnects, receives sliced intent (starting at submit step with `requiresAuth: false`).
4. Extension clicks the submit button (Layer 2 skipped for first step on resume).
5. Extension sends `task_result` with completion.
6. Voice narrates the result.

- [ ] **Step 5: Test denial flow**

Repeat and tap Deny instead.

Expected:
1. Voice says "Action was denied." or "Browser task failed (AUTH_TIMEOUT)."
2. Extension receives `session_end` and suspends.

- [ ] **Step 6: Phase gate passed — tag**

```bash
git tag phase2-gate-passed
```

---

## Self-Review Against Spec

### Spec coverage check:

| Requirement | Task |
|-------------|------|
| `fill_field` + `click` execution | Task 7 |
| Layer 2 safety classifier wired | Task 7 |
| `haltedStepIndex` write on halt | Task 1, 4 |
| Expo Push approval card | Task 2, 4 |
| Auth doc lifecycle (pending→approved/denied) | Task 1, 5 |
| Mobile APPROVE/DENY lock-screen buttons | Task 11 |
| `approvalToken` verification | Task 4 |
| FCM WAKE_AND_CONNECT resume | Task 4 |
| Extension resumes from `haltedStepIndex` | Task 4 (Cloud Agent slices), Task 8 (dispatcher skip) |
| `requiresAuth: false` on sliced resume intent | Task 4 |
| Layer 2 skip on approved first step | Task 8 (skipLayerTwoForFirst) |
| Session → `pending_auth` on halt | Task 1 |
| Task → `awaiting_auth` on halt | Task 1, 8, 9 |
| Expo push token storage + registration | Task 3, 10 |
| `sendTaskComplete` async result push after approved task completes | Task 2 (impl), Task 4 (`onResult` `isResume` branch) |
| Auth TTL 5 min on auth doc | Task 1 (expiresAt written) |
| Voice/text behavior on awaiting_auth (teardown + async push, no 30s misfire) | Task 6 |
| WS close after sending awaiting_auth | Task 9 |
| Phase gate E2E test | Task 13 |

### Placeholder scan: none found.

### Type consistency:
- `DispatchOutcome` defined in Task 8 and used in Task 9 — consistent.
- `AwaitingAuthOutcome.haltedStepIndex` matches `awaitingAuthFrameSchema` field — consistent.
- `sendAwaitingAuth(taskId, haltedStepIndex)` in Task 8 matches Cloud Agent parse in Task 4 — consistent.
- `skipLayerTwo` context flows from `content-bridge.ts` → `executor.ts` → `classifyElement` — consistent.
- `AuthDoc.approvalToken` used as the verification token in Task 4 — consistent with Task 1 schema.

# MV3 Browser Extension Bridge — Phase 1 (Read-Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the read-only Wake-and-Connect bridge so a Clanker voice/text agent can instruct a paired MV3 desktop extension to read pages and return results.

**Architecture:** Three async nodes rendezvous through Firestore (no direct Cloud Run socket-to-socket). A new `browser_action` ADK `FunctionTool` mints a bridge `sessionId`/`taskId`, writes a task doc, FCM-wakes the extension, and awaits the result via a per-task Firestore listener (voice) or a synchronous `Promise.race` (text). The extension wakes from `chrome.gcm`, mints a Firebase ID token via an offscreen document, opens the `/agent/browser` WebSocket, executes the Task DSL in a per-task injected content script, and returns the result.

**Tech Stack:** Cloud Agent — TypeScript ESM, Express, `@google/adk`, `firebase-admin` (Firestore + Messaging), `ws`, Zod, `node:test`. Extension — TypeScript, `chrome.*` MV3 APIs, Firebase Web Auth SDK (offscreen), esbuild bundle, `node:test` + jsdom.

**Scope:** Phase 1 only — `extract`, `summarize_visible_text`, `read_dom`, `open_tab`, `focus_tab`, `scroll`; pairing; billing; fail-closed errors; pause kill switch; host-permission grant. **Out of scope (separate plans):** stateful actions (`fill_field`/`click`), FCM approval cards + Expo Push, `haltedStepIndex` resume, proactive/Cloud Scheduler, multi-device. The DSL types in Task 2 include the Phase 2 stateful shapes (so the wire format is stable) but no Phase 1 task executes or approves them.

**Conventions discovered in this repo (follow exactly):**
- cloud-agent is ESM (`"type": "module"`); all relative imports end in `.js`. Cross-package imports use repo-root relative paths, e.g. `import { clip } from '../../../shared/wiki-utils.js'`.
- cloud-agent tests use `node:test`: `import test from 'node:test'`, `import assert from 'node:assert/strict'`, dependency injection + mock objects, and `const { fn } = await import('./mod.js')`.
- cloud-agent test command builds first: `npm test` runs `tsc` then `node --test "dist/**/*.test.js"`. To run ONE file: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/<path>.test.js`.
- Tools are ADK `FunctionTool` instances with a Zod `parameters` schema and an `execute(args): Promise<string>` that returns a string (never throws to the model — catch and return an error string). See `cloud-agent/src/tools/tasks.ts`.

---

## File Structure

**Shared (repo root `shared/`, compiled into cloud-agent via its tsconfig `include: ["../shared"]`):**
- `shared/constants.ts` — `DESTRUCTIVE_ACTION_PATTERN` + `classifyActionLabel()` (single source of truth for both layers).
- `shared/dsl-types.ts` — `SingleAction`, `SequenceAction`, `TaskIntent`, `TaskResult`, `SessionDoc`, `TaskDoc`, `DeviceDoc`, error code union.
- `shared/dsl-schema.ts` — Zod schemas + `validateTaskIntent()` + `actionTier()` classifier.

**Cloud Agent (`cloud-agent/src/`):**
- `services/firestoreSession.ts` — Firestore Admin read/write/listen helpers (DI-friendly).
- `services/fcmDispatcher.ts` — `wakeExtension()` via Admin messaging.
- `services/sessionBridge.ts` — in-memory per-instance session map.
- `tools/browserAction.ts` — the `browser_action` ADK `FunctionTool` + contextual billing.
- `handlers/wsBrowserAgentHandler.ts` — `/agent/browser` WS upgrade handler.
- Modify `services/agentCore.ts`, `services/liveToolAdapter.ts` — inject `browser_action`.
- Modify `handlers/wsLiveAgentHandler.ts` — expose `pauseBilling()`/`resumeBilling()`.
- Modify `index.ts` — `INSTANCE_ID`, `/agent/browser` upgrade, `POST /agent/browser/register-device`.

**Extension (`extension/`):** greenfield npm package; layout per spec (`background/`, `offscreen/`, `content/`, `ui/`, `shared/`, `icons/`, `manifest.json`).

**Infra:**
- `firestore.rules`, `firestore.indexes.json`, `firebase.json` (add `firestore` block).

---

## PART A — Shared Contracts & Infrastructure

### Task 1: Firestore rules, indexes, and firebase.json wiring

**Files:**
- Create: `firestore.rules`
- Create: `firestore.indexes.json`
- Modify: `firebase.json`

This is config (no unit test). The verification step is the Firestore emulator dry-run / `firebase deploy --dry-run`.

- [ ] **Step 1: Write `firestore.rules`**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    match /users/{uid}/sessions/{sessionId} {
      allow read: if request.auth.uid == uid;
      allow write: if false; // Admin SDK only

      match /tasks/{taskId} {
        allow read: if request.auth.uid == uid;
        allow write: if false; // Admin SDK only
      }

      match /auth/{taskId} {
        allow read: if request.auth.uid == uid;
        // Phase 2 approval writes; created by Admin SDK only.
        allow update: if request.auth.uid == uid
          && request.resource.data.diff(resource.data).affectedKeys()
               .hasOnly(['status', 'approvalToken', 'approvedAt']);
      }
    }

    match /users/{uid}/devices/{deviceId} {
      allow read: if request.auth.uid == uid;
      allow write: if false; // Admin SDK only (register-device upsert)
    }
  }
}
```

- [ ] **Step 2: Write `firestore.indexes.json`**

`getActiveDevice` queries `devices` where `active == true AND isPaused == false` ordered by `lastSeenAt desc`. That composite query needs an index.

```json
{
  "indexes": [
    {
      "collectionGroup": "devices",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "active", "order": "ASCENDING" },
        { "fieldPath": "isPaused", "order": "ASCENDING" },
        { "fieldPath": "lastSeenAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": [
    {
      "collectionGroup": "sessions",
      "fieldPath": "expiresAt",
      "ttl": true,
      "indexes": []
    }
  ]
}
```

- [ ] **Step 3: Add the `firestore` block to `firebase.json`**

Add this key as a sibling of `"hosting"` and `"functions"` (keep existing content unchanged):

```json
  "firestore": {
    "rules": "firestore.rules",
    "indexes": "firestore.indexes.json"
  }
```

- [ ] **Step 4: Verify rules compile**

Run: `npx firebase deploy --only firestore:rules --dry-run`
Expected: `✔ rules file firestore.rules compiled successfully` (or auth prompt — if not logged in, run `firebase login` first via `! firebase login`). If `--dry-run` is unsupported in the installed CLI version, run `npx firebase emulators:exec --only firestore "true"` and expect a clean rules load with no parse error.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules firestore.indexes.json firebase.json
git commit -m "feat(firestore): add bridge security rules, device index, TTL"
```

> **Manual infra prerequisites (record in PR description, not code):** enable Firestore Native mode in the Firebase project; configure TTL policy on `users/{uid}/sessions/{sessionId}.expiresAt`; obtain the FCM Sender ID (Project Settings → Cloud Messaging) for the extension. These are console actions, not committable.

---

### Task 2: Shared DSL types

**Files:**
- Create: `shared/dsl-types.ts`

Pure type declarations — verification is `tsc`. No runtime test (types erase at runtime; the runtime validator is Task 3.

- [ ] **Step 1: Write `shared/dsl-types.ts`**

```typescript
// Canonical wire types for the browser bridge. Mirrored by extension/shared/dsl-types.ts.

export type SingleAction =
  | { type: 'open_tab'; url: string }
  | { type: 'focus_tab'; host: string }
  | { type: 'extract'; selector: string; label?: string }
  | { type: 'summarize_visible_text'; filter?: 'no_nav' | 'no_ads' | 'all' }
  | { type: 'read_dom'; selector: string }
  | { type: 'scroll'; direction: 'up' | 'down'; pixels?: number }
  // Phase 2 (wire-stable, never executed in Phase 1):
  | { type: 'fill_field'; selector: string; value: string; tier: 'stateful' }
  | { type: 'click'; selector: string; label?: string; tier: 'stateful' }

export interface SequenceAction {
  type: 'sequence'
  steps: SingleAction[] // no nested sequences
}

export interface TaskIntent {
  version: '1'
  taskId: string
  sessionId: string
  requiresAuth: boolean
  actionSummary: string
  action: SingleAction | SequenceAction
}

export type BridgeErrorCode =
  | 'SELECTOR_NOT_FOUND'
  | 'HOST_NOT_ALLOWED'
  | 'HOST_PERMISSION_REQUIRED'
  | 'EXTENSION_OFFLINE'
  | 'AUTH_TIMEOUT'
  | 'EXECUTION_ERROR'
  | 'EXECUTION_TIMEOUT'

export interface TaskResult {
  taskId: string
  status: 'complete' | 'failed' | 'aborted'
  data: Record<string, string> // keyed by `label` from extract steps
  activeUrl: string
  error?: {
    code: BridgeErrorCode
    message: string
    failedAction: SingleAction
  }
}

export type SessionStatus = 'pending' | 'routing' | 'pending_auth' | 'closed' | 'aborted'
export type TaskStatus = 'pending' | 'executing' | 'awaiting_auth' | 'complete' | 'failed' | 'aborted'

export interface SessionDoc {
  status: SessionStatus
  trigger: 'voice' | 'text' | 'scheduler'
  voiceInstanceId: string
  browserInstanceId?: string | null
  browserConnectedAt?: unknown | null // Firestore Timestamp
  createdAt: unknown
  expiresAt: unknown
}

export interface TaskDoc {
  status: TaskStatus
  intent: TaskIntent
  result: TaskResult | null
  error: TaskResult['error'] | null
  authRequired: boolean
  haltedStepIndex: number | null
  createdAt: unknown
  updatedAt: unknown
}

export interface DeviceDoc {
  deviceId: string
  fcmToken: string
  deviceName: string
  registeredAt?: unknown
  lastSeenAt?: unknown
  active: boolean
  isPaused: boolean
}
```

- [ ] **Step 2: Verify it typechecks under cloud-agent**

Run: `cd cloud-agent && npx tsc --noEmit`
Expected: no errors (the file is picked up via `include: ["../shared"]`).

- [ ] **Step 3: Commit**

```bash
git add shared/dsl-types.ts
git commit -m "feat(shared): add browser bridge DSL wire types"
```

---

### Task 3: Shared destructive-action constant + label classifier

**Files:**
- Create: `shared/constants.ts`
- Test: `shared/constants.test.ts`

> **Test placement note:** cloud-agent's tsconfig `exclude`s `../shared/**/*.test.ts` from the build, so `shared/constants.test.ts` will NOT run under `cloud-agent npm test`. Run shared tests directly with tsx: `node --import tsx/esm --test shared/constants.test.ts`. (tsx is already available as a cloud-agent dependency; invoke from repo root via `npx tsx` if not on PATH — use `node --import tsx/esm`.)

- [ ] **Step 1: Write the failing test**

```typescript
// shared/constants.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { DESTRUCTIVE_ACTION_PATTERN, classifyActionLabel } from './constants.js'

test('pattern matches destructive verbs case-insensitively', () => {
  for (const s of ['Submit Payment', 'DELETE account', 'pay now', 'Confirm order', 'Cancel subscription']) {
    assert.equal(DESTRUCTIVE_ACTION_PATTERN.test(s), true, s)
  }
})

test('pattern ignores benign labels', () => {
  for (const s of ['Read more', 'Show details', 'Next page', 'order_total']) {
    assert.equal(DESTRUCTIVE_ACTION_PATTERN.test(s), false, s)
  }
})

test('classifyActionLabel returns requires_auth for destructive text', () => {
  assert.equal(classifyActionLabel('Submit Payment'), 'requires_auth')
  assert.equal(classifyActionLabel('Read article'), 'safe')
  assert.equal(classifyActionLabel(undefined), 'safe')
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --import tsx/esm --test shared/constants.test.ts`
Expected: FAIL — cannot find module `./constants.js`.

- [ ] **Step 3: Write `shared/constants.ts`**

```typescript
// Single source of truth for the two-layer destructive-action classifier.
// Imported by cloud-agent (Layer 1) and the extension content script (Layer 2).
export const DESTRUCTIVE_ACTION_PATTERN =
  /submit|delete|pay|confirm|send|checkout|transfer|remove|cancel subscription/i

export function classifyActionLabel(label: string | undefined | null): 'safe' | 'requires_auth' {
  if (!label) return 'safe'
  return DESTRUCTIVE_ACTION_PATTERN.test(label) ? 'requires_auth' : 'safe'
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --import tsx/esm --test shared/constants.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/constants.ts shared/constants.test.ts
git commit -m "feat(shared): destructive-action pattern + label classifier"
```

---

### Task 4: Shared DSL Zod schema + tier classifier

**Files:**
- Create: `shared/dsl-schema.ts`
- Test: `shared/dsl-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// shared/dsl-schema.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { taskIntentSchema, validateTaskIntent, actionTier } from './dsl-schema.js'

const validReadOnly = {
  version: '1', taskId: 't1', sessionId: 's1', requiresAuth: false,
  actionSummary: 'Summarize', action: { type: 'summarize_visible_text', filter: 'no_nav' },
}

test('accepts a valid read-only intent', () => {
  assert.equal(taskIntentSchema.safeParse(validReadOnly).success, true)
})

test('rejects unknown action type', () => {
  const bad = { ...validReadOnly, action: { type: 'wipe_disk' } }
  assert.equal(taskIntentSchema.safeParse(bad).success, false)
})

test('rejects nested sequences', () => {
  const bad = {
    ...validReadOnly,
    action: { type: 'sequence', steps: [{ type: 'sequence', steps: [] }] },
  }
  assert.equal(taskIntentSchema.safeParse(bad).success, false)
})

test('validateTaskIntent returns typed value or throws', () => {
  assert.equal(validateTaskIntent(validReadOnly).taskId, 't1')
  assert.throws(() => validateTaskIntent({ version: '1' }))
})

test('actionTier classifies primitives', () => {
  assert.equal(actionTier({ type: 'extract', selector: '.x' }), 'read_only')
  assert.equal(actionTier({ type: 'open_tab', url: 'https://a.com' }), 'navigation')
  assert.equal(actionTier({ type: 'click', selector: '#b', tier: 'stateful' }), 'stateful')
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node --import tsx/esm --test shared/dsl-schema.test.ts`
Expected: FAIL — cannot find `./dsl-schema.js`.

- [ ] **Step 3: Write `shared/dsl-schema.ts`**

```typescript
import { z } from 'zod'
import type { SingleAction } from './dsl-types.js'

const singleActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open_tab'), url: z.string().url() }),
  z.object({ type: z.literal('focus_tab'), host: z.string().min(1) }),
  z.object({ type: z.literal('extract'), selector: z.string().min(1), label: z.string().optional() }),
  z.object({ type: z.literal('summarize_visible_text'), filter: z.enum(['no_nav', 'no_ads', 'all']).optional() }),
  z.object({ type: z.literal('read_dom'), selector: z.string().min(1) }),
  z.object({ type: z.literal('scroll'), direction: z.enum(['up', 'down']), pixels: z.number().int().positive().optional() }),
  z.object({ type: z.literal('fill_field'), selector: z.string().min(1), value: z.string(), tier: z.literal('stateful') }),
  z.object({ type: z.literal('click'), selector: z.string().min(1), label: z.string().optional(), tier: z.literal('stateful') }),
])

const sequenceActionSchema = z.object({
  type: z.literal('sequence'),
  steps: z.array(singleActionSchema).min(1), // singleActionSchema has no 'sequence' member → nesting rejected
})

export const taskIntentSchema = z.object({
  version: z.literal('1'),
  taskId: z.string().min(1),
  sessionId: z.string().min(1),
  requiresAuth: z.boolean(),
  actionSummary: z.string(),
  action: z.union([singleActionSchema, sequenceActionSchema]),
})

export type ValidatedTaskIntent = z.infer<typeof taskIntentSchema>

export function validateTaskIntent(input: unknown): ValidatedTaskIntent {
  return taskIntentSchema.parse(input)
}

const READ_ONLY = new Set(['extract', 'summarize_visible_text', 'read_dom'])
const NAVIGATION = new Set(['open_tab', 'focus_tab', 'scroll'])

export function actionTier(action: SingleAction): 'read_only' | 'navigation' | 'stateful' {
  if (READ_ONLY.has(action.type)) return 'read_only'
  if (NAVIGATION.has(action.type)) return 'navigation'
  return 'stateful'
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node --import tsx/esm --test shared/dsl-schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/dsl-schema.ts shared/dsl-schema.test.ts
git commit -m "feat(shared): DSL zod schema + tier classifier"
```

---

## PART B — Cloud Agent Coordinator

### Task 5: `firestoreSession.ts` — Firestore Admin helpers

**Files:**
- Create: `cloud-agent/src/services/firestoreSession.ts`
- Test: `cloud-agent/src/services/firestoreSession.test.ts`

The module takes a `Firestore`-like dependency so tests inject a fake. In production it defaults to `admin.firestore()`.

- [ ] **Step 1: Write the failing test**

```typescript
// cloud-agent/src/services/firestoreSession.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

// Minimal in-memory Firestore double. Path string → doc data.
function makeFakeDb() {
  const store = new Map<string, Record<string, unknown>>()
  function docRef(path: string) {
    return {
      path,
      async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
        store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...data } : data)
      },
      async get() {
        const data = store.get(path)
        return { exists: data !== undefined, data: () => data }
      },
      async update(data: Record<string, unknown>) {
        store.set(path, { ...(store.get(path) ?? {}), ...data })
      },
    }
  }
  const db = {
    doc: (path: string) => docRef(path),
    collection: (path: string) => ({
      where() { return this },
      orderBy() { return this },
      limit() { return this },
      async get() {
        // return device docs under this collection path, filtered active && !paused
        const docs = [...store.entries()]
          .filter(([k, v]) => k.startsWith(path + '/') && v.active === true && v.isPaused === false)
          .sort((a, b) => Number(b[1].lastSeenAt ?? 0) - Number(a[1].lastSeenAt ?? 0))
          .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }))
        return { empty: docs.length === 0, docs }
      },
    }),
  }
  return { db, store }
}

const { createFirestoreSession } = await import('./firestoreSession.js')

test('createSession + getSession round-trip', async () => {
  const { db } = makeFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.createSession('u1', 's1', { status: 'pending', trigger: 'voice', voiceInstanceId: 'i1' })
  const s = await fs.getSession('u1', 's1')
  assert.equal(s.status, 'pending')
  assert.equal(s.voiceInstanceId, 'i1')
})

test('markBrowserConnected sets routing + browserInstanceId and task executing', async () => {
  const { db } = makeFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.createSession('u1', 's1', { status: 'pending', trigger: 'voice', voiceInstanceId: 'i1' })
  await fs.writeTask('u1', 's1', 't1', {
    version: '1', taskId: 't1', sessionId: 's1', requiresAuth: false,
    actionSummary: 'x', action: { type: 'read_dom', selector: 'body' },
  })
  await fs.markBrowserConnected('u1', 's1', 'i2', 't1')
  const s = await fs.getSession('u1', 's1')
  const t = await fs.getTask('u1', 's1', 't1')
  assert.equal(s.status, 'routing')
  assert.equal(s.browserInstanceId, 'i2')
  assert.notEqual(s.browserConnectedAt, null)
  assert.equal(t.status, 'executing')
})

test('getActiveDevice returns null when none active', async () => {
  const { db } = makeFakeDb()
  const fs = createFirestoreSession(db as never)
  assert.equal(await fs.getActiveDevice('u1'), null)
})

test('getActiveDevice skips paused devices', async () => {
  const { db, store } = makeFakeDb()
  store.set('users/u1/devices/d1', { fcmToken: 'tok', deviceName: 'Mac', active: true, isPaused: true, lastSeenAt: 5 })
  const fs = createFirestoreSession(db as never)
  assert.equal(await fs.getActiveDevice('u1'), null)
})

test('getActiveDevice returns most-recent active unpaused device', async () => {
  const { db, store } = makeFakeDb()
  store.set('users/u1/devices/d1', { fcmToken: 'old', deviceName: 'Mac', active: true, isPaused: false, lastSeenAt: 1 })
  store.set('users/u1/devices/d2', { fcmToken: 'new', deviceName: 'PC', active: true, isPaused: false, lastSeenAt: 9 })
  const fs = createFirestoreSession(db as never)
  const d = await fs.getActiveDevice('u1')
  assert.equal(d?.fcmToken, 'new')
  assert.equal(d?.deviceId, 'd2')
})

test('writeTaskResult sets terminal status + result', async () => {
  const { db } = makeFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.writeTask('u1', 's1', 't1', {
    version: '1', taskId: 't1', sessionId: 's1', requiresAuth: false,
    actionSummary: 'x', action: { type: 'read_dom', selector: 'body' },
  })
  await fs.writeTaskResult('u1', 's1', 't1', { taskId: 't1', status: 'complete', data: { a: 'b' }, activeUrl: 'https://x' })
  const t = await fs.getTask('u1', 's1', 't1')
  assert.equal(t.status, 'complete')
  assert.deepEqual(t.result?.data, { a: 'b' })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/services/firestoreSession.test.js`
Expected: FAIL — cannot find `./firestoreSession.js`.

- [ ] **Step 3: Write `cloud-agent/src/services/firestoreSession.ts`**

```typescript
import admin from 'firebase-admin'
import type { TaskIntent, TaskResult, SessionDoc, TaskDoc, DeviceDoc } from '../../../shared/dsl-types.js'

// Structural subset of firebase-admin Firestore we use. Lets tests inject a fake.
export interface FirestoreLike {
  doc(path: string): {
    set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>
    get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
    update(data: Record<string, unknown>): Promise<unknown>
    onSnapshot?(cb: (snap: { exists: boolean; data(): Record<string, unknown> | undefined }) => void): () => void
  }
  collection(path: string): {
    where(field: string, op: string, value: unknown): unknown
    orderBy(field: string, dir: 'asc' | 'desc'): unknown
    limit(n: number): unknown
    get(): Promise<{ empty: boolean; docs: Array<{ id: string; data(): Record<string, unknown> }> }>
  }
}

export interface SessionMeta {
  status: SessionDoc['status']
  trigger: SessionDoc['trigger']
  voiceInstanceId: string
}

const SESSION_TTL_MS = 30 * 60 * 1000

function now() { return admin.firestore?.Timestamp ? admin.firestore.Timestamp.now() : (Date.now() as unknown) }
function ttl() {
  return admin.firestore?.Timestamp
    ? admin.firestore.Timestamp.fromMillis(Date.now() + SESSION_TTL_MS)
    : (Date.now() + SESSION_TTL_MS as unknown)
}

export function createFirestoreSession(db: FirestoreLike) {
  const sessionPath = (uid: string, sid: string) => `users/${uid}/sessions/${sid}`
  const taskPath = (uid: string, sid: string, tid: string) => `users/${uid}/sessions/${sid}/tasks/${tid}`
  const devicesPath = (uid: string) => `users/${uid}/devices`

  return {
    async getActiveDevice(uid: string): Promise<{ deviceId: string; fcmToken: string; deviceName: string } | null> {
      const q = db.collection(devicesPath(uid))
        .where('active', '==', true)
        .where('isPaused', '==', false) as ReturnType<FirestoreLike['collection']>
      const snap = await q.orderBy('lastSeenAt', 'desc').limit(1).get() as Awaited<ReturnType<ReturnType<FirestoreLike['collection']>['get']>>
      if (snap.empty) return null
      const d = snap.docs[0]
      const data = d.data() as DeviceDoc
      return { deviceId: d.id, fcmToken: data.fcmToken, deviceName: data.deviceName }
    },

    async createSession(uid: string, sid: string, meta: SessionMeta): Promise<void> {
      await db.doc(sessionPath(uid, sid)).set({
        status: meta.status, trigger: meta.trigger, voiceInstanceId: meta.voiceInstanceId,
        browserInstanceId: null, browserConnectedAt: null, createdAt: now(), expiresAt: ttl(),
      })
    },

    async getSession(uid: string, sid: string): Promise<SessionDoc> {
      const doc = await db.doc(sessionPath(uid, sid)).get()
      if (!doc.exists) throw new Error('SESSION_NOT_FOUND')
      return doc.data() as SessionDoc
    },

    async markBrowserConnected(uid: string, sid: string, browserInstanceId: string, taskId: string): Promise<void> {
      await db.doc(sessionPath(uid, sid)).update({
        status: 'routing', browserInstanceId, browserConnectedAt: now(),
      })
      await db.doc(taskPath(uid, sid, taskId)).update({ status: 'executing', updatedAt: now() })
    },

    async closeSession(uid: string, sid: string, status: 'closed' | 'aborted'): Promise<void> {
      await db.doc(sessionPath(uid, sid)).update({ status })
    },

    async writeTask(uid: string, sid: string, tid: string, intent: TaskIntent): Promise<void> {
      await db.doc(taskPath(uid, sid, tid)).set({
        status: 'pending', intent, result: null, error: null,
        authRequired: intent.requiresAuth, haltedStepIndex: null, createdAt: now(), updatedAt: now(),
      })
    },

    async getTask(uid: string, sid: string, tid: string): Promise<TaskDoc> {
      const doc = await db.doc(taskPath(uid, sid, tid)).get()
      if (!doc.exists) throw new Error('TASK_NOT_FOUND')
      return doc.data() as TaskDoc
    },

    async writeTaskResult(uid: string, sid: string, tid: string, result: TaskResult): Promise<void> {
      await db.doc(taskPath(uid, sid, tid)).update({
        status: result.status, result, error: result.error ?? null, updatedAt: now(),
      })
    },

    // Per-task listener. Returns unsubscribe. Used by the voice-side instance.
    watchTask(uid: string, sid: string, tid: string, cb: (task: TaskDoc) => void): () => void {
      const ref = db.doc(taskPath(uid, sid, tid))
      if (!ref.onSnapshot) throw new Error('watchTask requires onSnapshot support')
      return ref.onSnapshot((snap) => {
        if (snap.exists) cb(snap.data() as unknown as TaskDoc)
      })
    },
  }
}

export type FirestoreSession = ReturnType<typeof createFirestoreSession>

export function defaultFirestoreSession(): FirestoreSession {
  return createFirestoreSession(admin.firestore() as unknown as FirestoreLike)
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/services/firestoreSession.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/firestoreSession.ts cloud-agent/src/services/firestoreSession.test.ts
git commit -m "feat(cloud-agent): firestoreSession admin helpers"
```

---

### Task 6: `fcmDispatcher.ts` — silent wake push

**Files:**
- Create: `cloud-agent/src/services/fcmDispatcher.ts`
- Test: `cloud-agent/src/services/fcmDispatcher.test.ts`

Phase 1 needs only `wakeExtension`. (Expo Push helpers are Phase 2 — omitted here.)

- [ ] **Step 1: Write the failing test**

```typescript
// cloud-agent/src/services/fcmDispatcher.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { createFcmDispatcher } = await import('./fcmDispatcher.js')

test('wakeExtension sends WAKE_AND_CONNECT data payload to the token', async () => {
  const sent: unknown[] = []
  const messaging = { send: async (msg: unknown) => { sent.push(msg); return 'msg-id' } }
  const fcm = createFcmDispatcher(messaging as never)
  await fcm.wakeExtension('tok-123', 's1', 't1')
  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    token: 'tok-123',
    data: { type: 'WAKE_AND_CONNECT', sessionId: 's1', taskId: 't1', resume: 'false' },
  })
})

test('wakeExtension marks resume=true when requested', async () => {
  const sent: Array<{ data: { resume: string } }> = []
  const messaging = { send: async (msg: never) => { sent.push(msg); return 'm' } }
  const fcm = createFcmDispatcher(messaging as never)
  await fcm.wakeExtension('tok', 's', 't', true)
  assert.equal(sent[0].data.resume, 'true')
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/services/fcmDispatcher.test.js`
Expected: FAIL — cannot find `./fcmDispatcher.js`.

- [ ] **Step 3: Write `cloud-agent/src/services/fcmDispatcher.ts`**

```typescript
import admin from 'firebase-admin'

// FCM data messages require all values to be strings.
export interface MessagingLike {
  send(message: { token: string; data: Record<string, string> }): Promise<string>
}

export function createFcmDispatcher(messaging: MessagingLike) {
  return {
    async wakeExtension(fcmToken: string, sessionId: string, taskId: string, resume = false): Promise<void> {
      await messaging.send({
        token: fcmToken,
        data: { type: 'WAKE_AND_CONNECT', sessionId, taskId, resume: String(resume) },
      })
    },
  }
}

export type FcmDispatcher = ReturnType<typeof createFcmDispatcher>

export function defaultFcmDispatcher(): FcmDispatcher {
  return createFcmDispatcher(admin.messaging() as unknown as MessagingLike)
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/services/fcmDispatcher.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/fcmDispatcher.ts cloud-agent/src/services/fcmDispatcher.test.ts
git commit -m "feat(cloud-agent): fcmDispatcher wakeExtension"
```

---

### Task 7: `sessionBridge.ts` — in-memory per-instance map

**Files:**
- Create: `cloud-agent/src/services/sessionBridge.ts`
- Test: `cloud-agent/src/services/sessionBridge.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cloud-agent/src/services/sessionBridge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { createSessionBridge } = await import('./sessionBridge.js')

const fakeWs = () => ({ readyState: 1 }) as unknown as import('ws').WebSocket

test('registerBrowser then getSession returns the browserWs', () => {
  const b = createSessionBridge()
  const ws = fakeWs()
  b.registerBrowser('u1', 's1', ws)
  assert.equal(b.getSession('u1', 's1')?.browserWs, ws)
})

test('voice + browser co-registration on same key', () => {
  const b = createSessionBridge()
  const v = fakeWs(); const br = fakeWs()
  b.registerVoice('u1', 's1', v)
  b.registerBrowser('u1', 's1', br)
  const s = b.getSession('u1', 's1')
  assert.equal(s?.voiceWs, v)
  assert.equal(s?.browserWs, br)
})

test('deregister removes the entry', () => {
  const b = createSessionBridge()
  b.registerBrowser('u1', 's1', fakeWs())
  b.deregister('u1', 's1')
  assert.equal(b.getSession('u1', 's1'), undefined)
})

test('different uids/sessions are isolated', () => {
  const b = createSessionBridge()
  b.registerBrowser('u1', 's1', fakeWs())
  assert.equal(b.getSession('u2', 's1'), undefined)
  assert.equal(b.getSession('u1', 's2'), undefined)
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/services/sessionBridge.test.js`
Expected: FAIL — cannot find `./sessionBridge.js`.

- [ ] **Step 3: Write `cloud-agent/src/services/sessionBridge.ts`**

```typescript
import type { WebSocket } from 'ws'

export interface SessionState {
  sessionId: string
  voiceWs: WebSocket | null
  browserWs: WebSocket | null
  firestoreUnsub: (() => void) | null
}

const key = (uid: string, sessionId: string) => `${uid}:${sessionId}`

export function createSessionBridge() {
  const map = new Map<string, SessionState>()
  function ensure(uid: string, sessionId: string): SessionState {
    const k = key(uid, sessionId)
    let s = map.get(k)
    if (!s) { s = { sessionId, voiceWs: null, browserWs: null, firestoreUnsub: null }; map.set(k, s) }
    return s
  }
  return {
    registerBrowser(uid: string, sessionId: string, ws: WebSocket): void { ensure(uid, sessionId).browserWs = ws },
    registerVoice(uid: string, sessionId: string, ws: WebSocket): void { ensure(uid, sessionId).voiceWs = ws },
    getSession(uid: string, sessionId: string): SessionState | undefined { return map.get(key(uid, sessionId)) },
    deregister(uid: string, sessionId: string): void {
      const s = map.get(key(uid, sessionId))
      try { s?.firestoreUnsub?.() } catch { /* ignore */ }
      map.delete(key(uid, sessionId))
    },
  }
}

export type SessionBridge = ReturnType<typeof createSessionBridge>

// Module-level singleton — one map per Cloud Run instance.
export const sessionBridge: SessionBridge = createSessionBridge()
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/services/sessionBridge.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/sessionBridge.ts cloud-agent/src/services/sessionBridge.test.ts
git commit -m "feat(cloud-agent): in-memory sessionBridge"
```

---

### Task 8: `INSTANCE_ID` per-container constant

**Files:**
- Create: `cloud-agent/src/services/instanceId.ts`
- Modify: `cloud-agent/src/index.ts`

Define `INSTANCE_ID` in its own module (not `index.ts`). Both `index.ts` and `wsLiveAgentHandler.ts` import it; putting it in `index.ts` would create an import cycle (`index.ts` imports the handler, the handler imports `index.ts`).

- [ ] **Step 1: Write `cloud-agent/src/services/instanceId.ts`**

```typescript
// Per-container identity. K_REVISION identifies a deployment revision, not a
// container; this UUID is generated once per process for true per-instance tracking.
export const INSTANCE_ID = crypto.randomUUID()
```

- [ ] **Step 2: Re-export from `index.ts` for callers that import it from there**

Add to `index.ts` imports/exports:

```typescript
export { INSTANCE_ID } from './services/instanceId.js'
```

- [ ] **Step 3: Verify it compiles**

Run: `cd cloud-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add cloud-agent/src/services/instanceId.ts cloud-agent/src/index.ts
git commit -m "feat(cloud-agent): per-container INSTANCE_ID"
```

---

### Task 9: `POST /agent/browser/register-device` endpoint

**Files:**
- Modify: `cloud-agent/src/index.ts`
- Test: `cloud-agent/src/index.test.ts` (append cases; if the existing file does not exist as a supertest harness, create `cloud-agent/src/registerDevice.test.ts` using the createApp factory)

The endpoint upserts `users/{uid}/devices/{deviceId}` via Admin SDK. To keep it testable, accept an injectable device-writer in `AppOptions`.

- [ ] **Step 1: Write the failing test**

```typescript
// cloud-agent/src/registerDevice.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'

const { createApp } = await import('./index.js')

function startApp(overrides: Record<string, unknown> = {}) {
  const writes: unknown[] = []
  const app = createApp({
    verifyToken: async () => ({ uid: 'fb-uid-1' }),
    db: {} as never,
    runAgentFn: async () => ({ reply: 'x', toolCalls: [] }),
    upsertDevice: async (uid: string, body: unknown) => { writes.push({ uid, body }) },
    ...overrides,
  } as never)
  const server = app.listen(0)
  const port = (server.address() as AddressInfo).port
  return { server, port, writes }
}

test('register-device rejects unauthenticated requests', async () => {
  const { server, port } = startApp()
  const res = await fetch(`http://127.0.0.1:${port}/agent/browser/register-device`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fcmToken: 't', deviceId: 'd', deviceName: 'Mac' }),
  })
  assert.equal(res.status, 401)
  server.close()
})

test('register-device upserts on valid body', async () => {
  const { server, port, writes } = startApp()
  const res = await fetch(`http://127.0.0.1:${port}/agent/browser/register-device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer good' },
    body: JSON.stringify({ fcmToken: 'tok', deviceId: 'dev-1', deviceName: 'Home Mac — Chrome', isPaused: false }),
  })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
  assert.equal((writes[0] as { uid: string }).uid, 'fb-uid-1')
  server.close()
})

test('register-device 400 on missing fields', async () => {
  const { server, port } = startApp()
  const res = await fetch(`http://127.0.0.1:${port}/agent/browser/register-device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer good' },
    body: JSON.stringify({ deviceId: 'd' }),
  })
  assert.equal(res.status, 400)
  server.close()
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/registerDevice.test.js`
Expected: FAIL — `upsertDevice` not in `AppOptions` / route 404.

- [ ] **Step 3: Add `upsertDevice` to `AppOptions` and implement the route**

In `index.ts`, extend the interface:

```typescript
export interface AppOptions {
  verifyToken: (token: string) => Promise<{ uid: string }>
  db: DrizzleClient
  runAgentFn: (params: RunAgentParams) => Promise<{ reply: string; toolCalls: string[]; groundingMetadata?: GroundingMetadata }>
  creditService?: CreditService
  wsHandlerOptions?: Partial<WsHandlerOptions>
  wsLiveHandlerOptions?: Partial<WsLiveHandlerOptions>
  upsertDevice?: (uid: string, body: { fcmToken: string; deviceId: string; deviceName: string; isPaused?: boolean }) => Promise<void>
}
```

Add a default Admin-SDK implementation and the route inside `createApp` (after the `/agent/run` handler, before `return app`):

```typescript
  const upsertDevice = options.upsertDevice ?? (async (uid, body) => {
    const fs = admin.firestore()
    await fs.doc(`users/${uid}/devices/${body.deviceId}`).set({
      fcmToken: body.fcmToken,
      deviceName: body.deviceName,
      active: true,
      isPaused: body.isPaused ?? false,
      lastSeenAt: admin.firestore.Timestamp.now(),
      registeredAt: admin.firestore.Timestamp.now(),
    }, { merge: true })
  })

  app.post('/agent/browser/register-device', requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    const parsed = z.object({
      fcmToken: z.string().min(1),
      deviceId: z.string().min(1),
      deviceName: z.string().min(1),
      isPaused: z.boolean().optional(),
    }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid request body' }); return }
    try {
      await upsertDevice(req.uid!, parsed.data)
      res.json({ ok: true })
    } catch (err) {
      console.error('register-device error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })
```

> Note: `registeredAt` uses `merge: true` so re-registration keeps the earliest value only if you guard it; for Phase 1, overwriting on each upsert is acceptable. The `isPaused` field is also written here when the side panel toggles pause (same endpoint, see Task 25).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/registerDevice.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/index.ts cloud-agent/src/registerDevice.test.ts
git commit -m "feat(cloud-agent): POST /agent/browser/register-device"
```

---

### Task 10: `wsBrowserAgentHandler.ts` — `/agent/browser` protocol

**Files:**
- Create: `cloud-agent/src/handlers/wsBrowserAgentHandler.ts`
- Test: `cloud-agent/src/handlers/wsBrowserAgentHandler.test.ts`

The handler: enforce 5s auth-frame timeout (close 4001); verify idToken; validate deviceId; `markBrowserConnected`; send `session_ready`; register browserWs; dispatch the pending task; on `task_result`/`task_error` write to Firestore; on close deregister.

- [ ] **Step 1: Write the failing test (use a fake WebSocket)**

```typescript
// cloud-agent/src/handlers/wsBrowserAgentHandler.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const { handleBrowserWsUpgrade } = await import('./wsBrowserAgentHandler.js')

class FakeWs extends EventEmitter {
  readyState = 1
  sent: string[] = []
  closed: { code?: number; reason?: string } | null = null
  send(s: string) { this.sent.push(s) }
  close(code?: number, reason?: string) { this.readyState = 3; this.closed = { code, reason } }
  emitJson(obj: unknown) { this.emit('message', Buffer.from(JSON.stringify(obj))) }
}

function deps(over: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[]> = { mark: [], result: [] }
  return {
    calls,
    options: {
      verifyToken: async () => ({ uid: 'fb-uid' }),
      resolveUserId: async () => 'u1',
      firestoreSession: {
        getSession: async () => ({ status: 'pending' }),
        getTask: async () => ({ status: 'pending', intent: { version: '1', taskId: 't1', sessionId: 's1', requiresAuth: false, actionSummary: 'x', action: { type: 'read_dom', selector: 'body' } } }),
        markBrowserConnected: async (...a: unknown[]) => { calls.mark.push(a) },
        writeTaskResult: async (...a: unknown[]) => { calls.result.push(a) },
        closeSession: async () => {},
      },
      validateDevice: async () => true,
      instanceId: 'i-test',
      authTimeoutMs: 50,
      ...over,
    },
  }
}

test('closes 4001 when no auth frame within timeout', async () => {
  const ws = new FakeWs()
  const { options } = deps()
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(ws.closed?.code, 4001)
})

test('auth → markBrowserConnected → session_ready → dispatch task', async () => {
  const ws = new FakeWs()
  const { options, calls } = deps()
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: 's1', deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(calls.mark.length, 1)
  const types = ws.sent.map((s) => JSON.parse(s).type)
  assert.ok(types.includes('session_ready'))
  assert.ok(types.includes('task'))
})

test('task_result frame is persisted via writeTaskResult', async () => {
  const ws = new FakeWs()
  const { options, calls } = deps()
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: 's1', deviceId: 'd1' })
  await new Promise((r) => setTimeout(r, 20))
  ws.emitJson({ type: 'task_result', taskId: 't1', data: { k: 'v' }, activeUrl: 'https://x' })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(calls.result.length, 1)
  const result = (calls.result[0] as unknown[])[3] as { status: string; data: Record<string, string> }
  assert.equal(result.status, 'complete')
  assert.deepEqual(result.data, { k: 'v' })
})

test('rejects auth when deviceId invalid', async () => {
  const ws = new FakeWs()
  const { options } = deps({ validateDevice: async () => false })
  handleBrowserWsUpgrade(ws as never, {} as never, options as never)
  ws.emitJson({ type: 'auth', idToken: 'tok', sessionId: 's1', deviceId: 'bad' })
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(ws.closed?.code, 4001)
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/handlers/wsBrowserAgentHandler.test.js`
Expected: FAIL — cannot find `./wsBrowserAgentHandler.js`.

- [ ] **Step 3: Write `cloud-agent/src/handlers/wsBrowserAgentHandler.ts`**

```typescript
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import admin from 'firebase-admin'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'
import { sessionBridge } from '../services/sessionBridge.js'
import type { TaskResult, SingleAction, BridgeErrorCode } from '../../../shared/dsl-types.js'

const browserAuthSchema = z.object({
  type: z.literal('auth'),
  idToken: z.string().min(1),
  sessionId: z.string().uuid(),
  deviceId: z.string().min(1),
})

const resultFrameSchema = z.object({
  type: z.literal('task_result'),
  taskId: z.string(),
  data: z.record(z.string()),
  activeUrl: z.string(),
})

const errorFrameSchema = z.object({
  type: z.literal('task_error'),
  taskId: z.string(),
  code: z.string(),
  message: z.string(),
  failedAction: z.unknown(),
})

export interface BrowserWsOptions {
  firestoreSession: FirestoreSession
  verifyToken?: (token: string) => Promise<{ uid: string }>
  resolveUserId?: (firebaseUid: string) => Promise<string | null>
  validateDevice?: (uid: string, deviceId: string) => Promise<boolean>
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
  const authTimeoutMs = options.authTimeoutMs ?? 5000

  let authed = false
  let uid: string | null = null
  let sessionId: string | null = null

  const authTimer = setTimeout(() => {
    if (!authed && ws.readyState === ws.OPEN) ws.close(4001, 'Auth timeout')
  }, authTimeoutMs)

  async function onAuth(raw: unknown): Promise<void> {
    const parsed = browserAuthSchema.safeParse(raw)
    if (!parsed.success) { ws.close(4001, 'Invalid auth frame'); return }
    const { idToken, sessionId: sid, deviceId } = parsed.data
    let fbUid: string
    try { fbUid = (await verifyToken(idToken)).uid } catch { ws.close(4001, 'Token verification failed'); return }
    const resolved = await resolveUserId(fbUid)
    if (!resolved) { ws.close(4001, 'User not found'); return }
    if (!(await validateDevice(resolved, deviceId))) { ws.close(4001, 'Unknown device'); return }

    const session = await fs.getSession(resolved, sid)
    if (session.status === 'closed') { ws.close(4001, 'Session closed'); return }

    uid = resolved; sessionId = sid; authed = true
    clearTimeout(authTimer)

    // The extension echoes only sessionId in its auth frame. A Phase 1 bridge
    // session has exactly one task, so read it from Firestore.
    const pendingTask = await fs.getFirstTask(uid, sid)
    if (!pendingTask) { ws.close(4001, 'No pending task'); return }

    await fs.markBrowserConnected(uid, sid, options.instanceId, pendingTask.intent.taskId)
    sessionBridge.registerBrowser(uid, sid, ws)
    ws.send(JSON.stringify({ type: 'session_ready', sessionId: sid }))
    ws.send(JSON.stringify({ type: 'task', intent: pendingTask.intent }))
  }

  async function onResult(raw: unknown): Promise<void> {
    if (!authed || !uid || !sessionId) return
    const r = resultFrameSchema.safeParse(raw)
    if (r.success) {
      const result: TaskResult = { taskId: r.data.taskId, status: 'complete', data: r.data.data, activeUrl: r.data.activeUrl }
      await fs.writeTaskResult(uid, sessionId, r.data.taskId, result)
      ws.send(JSON.stringify({ type: 'session_end' }))
      return
    }
    const e = errorFrameSchema.safeParse(raw)
    if (e.success) {
      const result: TaskResult = {
        taskId: e.data.taskId, status: 'failed', data: {}, activeUrl: '',
        error: {
          code: e.data.code as BridgeErrorCode,
          message: e.data.message,
          failedAction: e.data.failedAction as SingleAction,
        },
      }
      await fs.writeTaskResult(uid, sessionId, e.data.taskId, result)
      ws.send(JSON.stringify({ type: 'session_end' }))
    }
  }

  ws.on('message', (data: Buffer) => {
    let parsed: unknown
    try { parsed = JSON.parse(data.toString()) } catch { return }
    const type = (parsed as { type?: string }).type
    if (type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }
    if (!authed) { void onAuth(parsed); return }
    if (type === 'task_result' || type === 'task_error') { void onResult(parsed); return }
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    if (uid && sessionId) sessionBridge.deregister(uid, sessionId)
  })
  ws.on('error', () => { clearTimeout(authTimer) })
}
```

- [ ] **Step 3b: Add `getFirstTask` to `firestoreSession.ts`**

The handler needs to find the session's single pending task without the extension echoing `taskId`. Add to the returned object in `createFirestoreSession` (Task 5) and to `FirestoreLike` a `collection(...).get()` over the tasks subcollection:

```typescript
    async getFirstTask(uid: string, sid: string): Promise<TaskDoc | null> {
      const snap = await db.collection(`users/${uid}/sessions/${sid}/tasks`).limit(1).get()
      if (snap.empty) return null
      return snap.docs[0].data() as unknown as TaskDoc
    },
```

> **Decision for Phase 1:** keep the auth frame minimal per spec (`idToken`, `sessionId`, `deviceId`) and read the pending task from Firestore via `getFirstTask`. In the `firestoreSession.test.ts` fake (Task 5), make `collection(path).limit(1).get()` return the task doc for the tasks subcollection path (the existing device-filtering `get()` only applies to the devices path — branch on whether `path` ends in `/tasks`), and add a `getFirstTask` test case there before re-running Task 5's suite.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/handlers/wsBrowserAgentHandler.test.js`
Expected: PASS (4 tests). Add a `getFirstTask` returning the stub task in the test's `firestoreSession` fake.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/handlers/wsBrowserAgentHandler.ts cloud-agent/src/handlers/wsBrowserAgentHandler.test.ts cloud-agent/src/services/firestoreSession.ts cloud-agent/src/services/firestoreSession.test.ts
git commit -m "feat(cloud-agent): /agent/browser WS handler"
```

---

### Task 11: Wire `/agent/browser` into `attachWebSocketRoutes`

**Files:**
- Modify: `cloud-agent/src/index.ts`

- [ ] **Step 1: Add the route in `attachWebSocketRoutes`**

Import at top:

```typescript
import { handleBrowserWsUpgrade } from './handlers/wsBrowserAgentHandler.js'
import { defaultFirestoreSession } from './services/firestoreSession.js'
import { eq } from 'drizzle-orm'
```

(`eq` and `users` are already imported.) Inside `attachWebSocketRoutes`, add a `browserWss` and branch:

```typescript
  const browserWss = new WebSocketServer({ noServer: true })
```

and inside `server.on('upgrade', ...)` add a branch alongside `/agent/stream` and `/agent/live`:

```typescript
    } else if (pathname === '/agent/browser') {
      browserWss.handleUpgrade(req, socket, head, (ws) => {
        handleBrowserWsUpgrade(ws, req, {
          firestoreSession: defaultFirestoreSession(),
          verifyToken,
          resolveUserId: async (firebaseUid: string) => {
            const [u] = await db.select({ id: users.id }).from(users).where(eq(users.firebaseUid, firebaseUid))
            return u?.id ?? null
          },
          validateDevice: async (uid: string, deviceId: string) => {
            const doc = await admin.firestore().doc(`users/${uid}/devices/${deviceId}`).get()
            return doc.exists && (doc.data()?.active === true)
          },
          instanceId: INSTANCE_ID,
        })
      })
```

- [ ] **Step 2: Verify it compiles**

Run: `cd cloud-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/index.ts
git commit -m "feat(cloud-agent): mount /agent/browser WS route"
```

---

### Task 12: `pauseBilling()` / `resumeBilling()` in the live handler

**Files:**
- Modify: `cloud-agent/src/handlers/wsLiveAgentHandler.ts`
- Test: `cloud-agent/src/handlers/wsLiveAgentHandler.test.ts` (append)

The voice billing timer must pause while a `browser_action` waits for the extension. Expose pause/resume on a controller object the tool can reach. For Phase 1 we make pause/resume process-reachable per session via a registry keyed by `${uid}:${liveSessionId}`; the tool calls them through the same `BrowserActionDeps`.

- [ ] **Step 1: Write the failing test (append to existing test file)**

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'

const { makeBillingController } = await import('./wsLiveAgentHandler.js')

test('pauseBilling stops the interval from spending; resume restarts', () => {
  let spends = 0
  const fakeSetInterval = (fn: () => void) => { ;(fakeSetInterval as unknown as { fn: () => void }).fn = fn; return 1 as unknown as ReturnType<typeof setInterval> }
  const ctrl = makeBillingController({
    spend: () => { spends++ },
    setIntervalFn: fakeSetInterval as never,
    clearIntervalFn: () => {},
    intervalMs: 1000,
  })
  ctrl.start()
  ;(fakeSetInterval as unknown as { fn: () => void }).fn() // tick → spend
  ctrl.pause()
  ;(fakeSetInterval as unknown as { fn: () => void }).fn() // tick while paused → no spend
  ctrl.resume()
  ;(fakeSetInterval as unknown as { fn: () => void }).fn() // tick → spend
  assert.equal(spends, 2)
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/handlers/wsLiveAgentHandler.test.js`
Expected: FAIL — `makeBillingController` not exported.

- [ ] **Step 3: Extract the timer into `makeBillingController` and add pause/resume**

Add this exported factory to `wsLiveAgentHandler.ts`:

```typescript
export interface BillingControllerOpts {
  spend: () => void
  intervalMs: number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
}

export function makeBillingController(opts: BillingControllerOpts) {
  const setI = opts.setIntervalFn ?? setInterval
  const clearI = opts.clearIntervalFn ?? clearInterval
  let timer: ReturnType<typeof setInterval> | null = null
  let paused = false
  return {
    start() { timer = setI(() => { if (!paused) opts.spend() }, opts.intervalMs) },
    pause() { paused = true },
    resume() { paused = false },
    stop() { if (timer !== null) { clearI(timer); timer = null } },
  }
}
export type BillingController = ReturnType<typeof makeBillingController>
```

Then, in `handleLiveWsUpgrade`, replace the inline `billingTimer = setInterval(...)` with a controller built from the same spend body, store the controller in a module-level registry keyed by `${userId}:${sessionId}` so the tool can pause/resume it, and call `controller.stop()` in `clearAndClose()`. Expose:

```typescript
const billingControllers = new Map<string, BillingController>()
export function getBillingController(key: string): BillingController | undefined { return billingControllers.get(key) }
```

> Keep the existing spend/INSUFFICIENT_CREDITS handling inside the `spend` callback. The live session's `sessionId` for the registry key is the bridge-independent live WS id; generate one at auth time (`const liveSessionKey = `${userId}:${crypto.randomUUID()}`) and pass it into `BrowserActionDeps` via the live tool set (Task 14 wiring).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/handlers/wsLiveAgentHandler.test.js`
Expected: PASS (existing tests + 1 new).

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/handlers/wsLiveAgentHandler.ts cloud-agent/src/handlers/wsLiveAgentHandler.test.ts
git commit -m "feat(cloud-agent): pausable billing controller for voice"
```

---

### Task 13: `browserAction.ts` — the `browser_action` tool

**Files:**
- Create: `cloud-agent/src/tools/browserAction.ts`
- Test: `cloud-agent/src/tools/browserAction.test.ts`

This is the heart. Owns `sessionId`/`taskId`; resolves device (no credit if none/paused); contextual billing; writes task; FCM wake; 12s durable wake timeout w/ refund; result delivery (voice = listener + interim, text = `Promise.race` 30s).

- [ ] **Step 1: Write the failing test**

```typescript
// cloud-agent/src/tools/browserAction.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { browserActionTool } = await import('./browserAction.js')

function baseDeps(over: Record<string, unknown> = {}) {
  const calls: Record<string, number> = { spend: 0, refund: 0, wake: 0, writeTask: 0 }
  return {
    calls,
    deps: {
      uid: 'u1',
      firestoreSession: {
        getActiveDevice: async () => ({ deviceId: 'd1', fcmToken: 'tok', deviceName: 'Mac' }),
        createSession: async () => {},
        writeTask: async () => { calls.writeTask++ },
        writeTaskResult: async () => {},
        getTask: async () => ({ status: 'pending' }),
        getSession: async () => ({ browserInstanceId: null, browserConnectedAt: null }),
        closeSession: async () => {},
        watchTask: (_u: string, _s: string, _t: string, cb: (d: unknown) => void) => {
          // simulate a completed task arriving shortly
          setTimeout(() => cb({ status: 'complete', result: { data: { price: '$5' }, activeUrl: 'https://x' } }), 5)
          return () => {}
        },
      },
      fcmDispatcher: { wakeExtension: async () => { calls.wake++ } },
      creditService: { spendCredit: async () => { calls.spend++; return 'tx1' }, refundCredit: async () => { calls.refund++ } },
      instanceId: 'i1',
      wakeTimeoutMs: 50,
      textTimeoutMs: 200,
      ...over,
    },
  }
}

test('no device → tool error, no credit spent', async () => {
  const { deps, calls } = baseDeps({
    firestoreSession: { ...baseDeps().deps.firestoreSession, getActiveDevice: async () => null },
  })
  const tool = browserActionTool(deps as never, { trigger: 'text', preBilled: true })
  const out = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'read_dom', selector: 'body' } },
  })
  assert.match(out, /not paired|Install/i)
  assert.equal(calls.spend, 0)
  assert.equal(calls.wake, 0)
})

test('text path is preBilled → skips spendCredit', async () => {
  const { deps, calls } = baseDeps()
  const tool = browserActionTool(deps as never, { trigger: 'text', preBilled: true })
  await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'extract', selector: '.p', label: 'price' } },
  })
  assert.equal(calls.spend, 0)
  assert.equal(calls.wake, 1)
  assert.equal(calls.writeTask, 1)
})

test('voice path spends a credit', async () => {
  const { deps, calls } = baseDeps()
  const tool = browserActionTool(deps as never, { trigger: 'voice', preBilled: false })
  await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'read_dom', selector: 'body' } },
  })
  assert.equal(calls.spend, 1)
})

test('text path returns the completed result string', async () => {
  const { deps } = baseDeps()
  const tool = browserActionTool(deps as never, { trigger: 'text', preBilled: true })
  const out = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'extract', selector: '.p', label: 'price' } },
  })
  assert.match(out, /\$5/)
})

test('voice wake timeout (no connect) refunds and reports offline', async () => {
  const fs = {
    ...baseDeps().deps.firestoreSession,
    getTask: async () => ({ status: 'pending' }),
    getSession: async () => ({ browserInstanceId: null, browserConnectedAt: null }),
    watchTask: (_u: string, _s: string, _t: string, cb: (d: unknown) => void) => {
      setTimeout(() => cb({ status: 'failed', result: null, error: { code: 'EXTENSION_OFFLINE', message: 'offline' } }), 60)
      return () => {}
    },
  }
  const { deps, calls } = baseDeps({ firestoreSession: fs })
  const tool = browserActionTool(deps as never, { trigger: 'voice', preBilled: false })
  const out = await (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute({
    actionSummary: 'x', intent: { action: { type: 'read_dom', selector: 'body' } },
  })
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(calls.refund, 1)
  assert.match(out, /sent|offline|browser/i)
})
```

> Note: the voice path returns an *interim* string immediately and resolves the final result through the live session push, which is out-of-band of the tool return. For unit-testing simplicity the tool's `execute` resolves with the interim string on voice and the final string on text. The interim-vs-final distinction is asserted by checking the text path returns data and voice returns the interim sentence.

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/tools/browserAction.test.js`
Expected: FAIL — cannot find `./browserAction.js`.

- [ ] **Step 3: Write `cloud-agent/src/tools/browserAction.ts`**

```typescript
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'
import type { FcmDispatcher } from '../services/fcmDispatcher.js'
import type { CreditService } from '../services/creditService.js'
import type { TaskIntent, TaskDoc } from '../../../shared/dsl-types.js'
import { DESTRUCTIVE_ACTION_PATTERN } from '../../../shared/constants.js'

export interface BrowserActionDeps {
  uid: string
  firestoreSession: FirestoreSession
  fcmDispatcher: FcmDispatcher
  creditService: CreditService
  instanceId: string
  // Voice-only: pause/resume the wall-clock billing timer while waiting.
  pauseBilling?: () => void
  resumeBilling?: () => void
  // Voice-only: push the final result into the live Gemini session.
  pushToLive?: (text: string) => void
  wakeTimeoutMs?: number  // default 12_000
  textTimeoutMs?: number  // default 30_000
}

const browserActionSchema = z.object({
  actionSummary: z.string().describe(
    'Human-readable description of what you are about to do (e.g. "Checking the article on your browser").',
  ),
  intent: z.object({
    action: z.record(z.unknown()).describe('SingleAction or SequenceAction — see Task DSL spec.'),
  }),
})

function formatResult(task: TaskDoc): string {
  if (task.status === 'complete' && task.result) {
    const data = task.result.data ?? {}
    const body = Object.keys(data).length ? JSON.stringify(data) : '(no extracted data)'
    return `Browser task complete on ${task.result.activeUrl}: ${body}`
  }
  const code = task.error?.code ?? task.result?.error?.code ?? 'EXECUTION_ERROR'
  if (code === 'EXTENSION_OFFLINE') return 'Your browser extension appears to be offline.'
  return `Browser task failed (${code}): ${task.error?.message ?? task.result?.error?.message ?? 'unknown error'}`
}

export function browserActionTool(
  deps: BrowserActionDeps,
  context: { trigger: 'voice' | 'text'; preBilled: boolean },
): FunctionTool {
  return new FunctionTool({
    name: 'browser_action',
    description:
      'Perform a web task on the user\'s paired desktop browser (read pages, extract data, navigate). ' +
      'Use only when the user asks you to look at or act on something in their browser.',
    parameters: browserActionSchema,
    execute: async (args: unknown): Promise<string> => {
      const { actionSummary, intent } = args as z.infer<typeof browserActionSchema>
      const fs = deps.firestoreSession
      const wakeTimeoutMs = deps.wakeTimeoutMs ?? 12_000
      const textTimeoutMs = deps.textTimeoutMs ?? 30_000

      const sessionId = crypto.randomUUID()
      const taskId = crypto.randomUUID()

      // 1. Resolve device BEFORE spending credit.
      const device = await fs.getActiveDevice(deps.uid)
      if (!device) {
        return 'No browser extension is paired. Install the Clanker Desktop Bridge extension, or it may be paused — enable it from the extension.'
      }

      // 2. Contextual billing.
      deps.pauseBilling?.()
      let txId: string | null = null
      if (!context.preBilled) {
        try { txId = await deps.creditService.spendCredit(deps.uid) }
        catch { deps.resumeBilling?.(); return 'You are out of credits for browser actions.' }
      }

      // 3. Build intent + persist.
      const action = intent.action as TaskIntent['action']
      const requiresAuth = DESTRUCTIVE_ACTION_PATTERN.test(actionSummary)
      const taskIntent: TaskIntent = { version: '1', taskId, sessionId, requiresAuth, actionSummary, action }
      await fs.createSession(deps.uid, sessionId, { status: 'pending', trigger: context.trigger, voiceInstanceId: deps.instanceId })
      await fs.writeTask(deps.uid, sessionId, taskId, taskIntent)

      // 4. Wake.
      await deps.fcmDispatcher.wakeExtension(device.fcmToken, sessionId, taskId)

      // 5. Durable wake timeout (queries Firestore, never sessionBridge).
      const wakeTimer = setTimeout(() => { void enforceWakeTimeout() }, wakeTimeoutMs)
      let settled = false
      async function enforceWakeTimeout(): Promise<void> {
        if (settled) return
        const task = await fs.getTask(deps.uid, sessionId, taskId)
        const session = await fs.getSession(deps.uid, sessionId)
        const connected = task.status === 'executing' || session.browserInstanceId != null || session.browserConnectedAt != null
        if (!connected && task.status === 'pending') {
          await fs.writeTaskResult(deps.uid, sessionId, taskId, {
            taskId, status: 'failed', data: {}, activeUrl: '',
            error: { code: 'EXTENSION_OFFLINE', message: 'Browser extension did not connect', failedAction: action as never },
          })
          if (txId) { try { await deps.creditService.refundCredit(deps.uid, txId) } catch { /* logged */ } }
          await fs.closeSession(deps.uid, sessionId, 'aborted')
        }
      }

      // 6. Result delivery.
      const watch = (resolve: (task: TaskDoc) => void) => {
        const unsub = fs.watchTask(deps.uid, sessionId, taskId, (task) => {
          if (task.status === 'complete' || task.status === 'failed' || task.status === 'aborted') {
            settled = true; clearTimeout(wakeTimer); unsub(); resolve(task)
          }
        })
        return unsub
      }

      if (context.trigger === 'text') {
        const result = await Promise.race<TaskDoc>([
          new Promise<TaskDoc>((resolve) => watch(resolve)),
          new Promise<TaskDoc>((_, reject) =>
            setTimeout(() => reject(new Error('EXECUTION_TIMEOUT')), textTimeoutMs)),
        ]).catch(() => ({
          status: 'failed', error: { code: 'EXECUTION_TIMEOUT', message: 'Browser task exceeded 30s' },
        } as unknown as TaskDoc))
        return formatResult(result)
      }

      // Voice: resolve final result out-of-band into the live session; return interim now.
      void new Promise<TaskDoc>((resolve) => watch(resolve)).then((task) => {
        deps.resumeBilling?.()
        deps.pushToLive?.(formatResult(task))
      })
      return 'Sent the task to your browser. I\'ll read the result aloud when it arrives.'
    },
  })
}
```

> The `failedAction: action as never` casts are because `action` may be a `SequenceAction`; for `failedAction` the extension always reports the specific `SingleAction` — Cloud-side timeout has no single action, so an empty/whole-action value is acceptable here. Tighten if `tsc` complains by narrowing to `SingleAction | undefined`.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/tools/browserAction.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/tools/browserAction.ts cloud-agent/src/tools/browserAction.test.ts
git commit -m "feat(cloud-agent): browser_action tool with contextual billing + durable wake timeout"
```

---

### Task 14: Inject `browser_action` into both agent entry points

**Files:**
- Modify: `cloud-agent/src/services/agentCore.ts` (text `/agent/run`)
- Modify: `cloud-agent/src/services/liveToolAdapter.ts` (voice `/agent/live`)
- Test: extend `agentCore.test.ts` / `liveToolAdapter.test.ts` if present, else add `cloud-agent/src/tools/browserActionWiring.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// cloud-agent/src/tools/browserActionWiring.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { buildLiveTools } = await import('../services/liveToolAdapter.js')

test('buildLiveTools registers browser_action when bridge deps provided', () => {
  const fakeDb = {} as never
  const embed = async () => [0]
  const { declarations } = buildLiveTools(fakeDb, 'u1', 'c1', embed, 'UTC', {
    firestoreSession: {} as never, fcmDispatcher: {} as never, creditService: {} as never,
    instanceId: 'i1', uid: 'u1',
  } as never)
  assert.ok(declarations.some((d) => d.name === 'browser_action'))
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd cloud-agent && NODE_ENV=test npm run build && node --test dist/cloud-agent/src/tools/browserActionWiring.test.js`
Expected: FAIL — `buildLiveTools` does not accept bridge deps / no `browser_action`.

- [ ] **Step 3a: Extend `buildLiveTools` in `liveToolAdapter.ts`**

Add an optional 6th param and push the tool:

```typescript
import { browserActionTool, type BrowserActionDeps } from '../tools/browserAction.js'

export function buildLiveTools(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  embed: EmbedFn,
  timezone: string,
  bridge?: Omit<BrowserActionDeps, 'pushToLive' | 'pauseBilling' | 'resumeBilling'> & {
    pushToLive?: (t: string) => void; pauseBilling?: () => void; resumeBilling?: () => void
  },
): LiveToolSet {
  const adkTools: FunctionTool[] = [
    // ...existing tools unchanged...
  ]
  if (bridge) {
    adkTools.push(browserActionTool(bridge, { trigger: 'voice', preBilled: false }))
  }
  // ...existing declarations/executors construction unchanged...
}
```

(Keep the existing tool list and the `declarations`/`executors` mapping exactly as-is; just append to `adkTools` before they're computed.)

- [ ] **Step 3b: Extend `buildAgent` in `agentCore.ts`**

```typescript
import { browserActionTool, type BrowserActionDeps } from '../tools/browserAction.js'

export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
  timezone: string,
  embed: (text: string) => Promise<number[]>,
  bridge?: BrowserActionDeps,
): LlmAgent {
  const tools = [
    // ...existing tools unchanged...
    GOOGLE_SEARCH,
  ]
  if (bridge) tools.push(browserActionTool(bridge, { trigger: 'text', preBilled: true }))
  return new LlmAgent({ name: 'clanker-cloud-agent', model: 'gemini-3.5-flash', instruction: systemInstruction, tools })
}
```

- [ ] **Step 3c: Pass bridge deps from the call sites**

In `index.ts` `runAgentReal`, build the bridge deps from defaults and pass to `buildAgent`:

```typescript
import { defaultFcmDispatcher } from './services/fcmDispatcher.js'
import { defaultFirestoreSession } from './services/firestoreSession.js'
// inside runAgentReal, after computing userId:
const bridge = {
  uid: userId,
  firestoreSession: defaultFirestoreSession(),
  fcmDispatcher: defaultFcmDispatcher(),
  creditService: createCreditService(db),
  instanceId: INSTANCE_ID,
}
const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embed, bridge)
```

In `wsLiveAgentHandler.ts` `handleAuthMessage`, pass bridge deps + pause/resume/push into `buildLiveTools`:

```typescript
const controller = makeBillingController({ spend: spendOnce, intervalMs: billingIntervalMs, clearIntervalFn: clearIntervalFn as never })
const { declarations, executors } = buildLiveTools(db, userId!, characterId, embedText, timezone, {
  uid: userId!,
  firestoreSession: defaultFirestoreSession(),
  fcmDispatcher: defaultFcmDispatcher(),
  creditService: cs,
  instanceId: INSTANCE_ID,
  pauseBilling: () => controller.pause(),
  resumeBilling: () => controller.resume(),
  pushToLive: (text: string) => {
    try { geminiSession?.sendToolResponse({ functionResponses: [{ id: crypto.randomUUID(), name: 'browser_action', response: { output: text } }] }) } catch { /* ignore */ }
  },
})
controller.start()
```

(Replace the old inline `billingTimer = setInterval(...)` block with the controller; move the existing spend body into a `spendOnce()` function. Import `INSTANCE_ID` from `../services/instanceId.js` — NOT from `../index.js`, which would create an import cycle — plus `defaultFcmDispatcher`/`defaultFirestoreSession`.)

- [ ] **Step 4: Run the wiring test + full suite to confirm pass**

Run: `cd cloud-agent && NODE_ENV=test npm test`
Expected: all tests PASS (existing + new browser bridge tests).

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src
git commit -m "feat(cloud-agent): wire browser_action into voice + text agents"
```

---

### Task 15: Cloud Agent gate — full typecheck + suite green

**Files:** none (verification gate).

- [ ] **Step 1: Typecheck**

Run: `cd cloud-agent && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `cd cloud-agent && NODE_ENV=test npm test`
Expected: all green, including `firestoreSession`, `fcmDispatcher`, `sessionBridge`, `wsBrowserAgentHandler`, `registerDevice`, `browserAction`, wiring, and live-handler billing controller.

- [ ] **Step 3: Commit (if any fixups were needed)**

```bash
git add -A && git commit -m "test(cloud-agent): green bridge suite" || echo "nothing to commit"
```

---

## PART C — MV3 Extension (greenfield)

### Task 16: Extension scaffold — package, build, manifest, test harness

**Files:**
- Create: `extension/package.json`, `extension/tsconfig.json`, `extension/esbuild.mjs`, `extension/manifest.json`
- Create: `extension/test/chrome-stub.ts`
- Create: `extension/icons/icon-16.png`, `icon-48.png`, `icon-128.png` (placeholder 1×1 PNGs OK for dev; replace before CWS)
- Create: `extension/src/env.ts` (Firebase config + sender id + cloud base URL)

- [ ] **Step 1: Write `extension/package.json`**

```json
{
  "name": "clanker-desktop-bridge",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node esbuild.mjs",
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx/esm --test \"src/**/*.test.ts\""
  },
  "dependencies": {
    "firebase": "^10.12.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "esbuild": "^0.21.0",
    "jsdom": "^24.0.0",
    "tsx": "^4.10.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Write `extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2022", "dom", "dom.iterable"],
    "types": ["chrome", "node"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src", "../shared"]
}
```

- [ ] **Step 3: Write `extension/esbuild.mjs`**

```javascript
import { build } from 'esbuild'
import { cpSync, mkdirSync } from 'node:fs'

const entries = {
  'background/service-worker': 'src/background/service-worker.ts',
  'offscreen/auth': 'src/offscreen/auth.ts',
  'content/executor': 'src/content/executor.ts',
  'ui/side-panel/panel': 'src/ui/side-panel/panel.ts',
  'ui/popup/popup': 'src/ui/popup/popup.ts',
}

mkdirSync('dist', { recursive: true })

await build({
  entryPoints: entries,
  outdir: 'dist',
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  sourcemap: true,
})

// Static assets
for (const f of ['manifest.json']) cpSync(f, `dist/${f}`)
cpSync('icons', 'dist/icons', { recursive: true })
cpSync('src/offscreen/auth.html', 'dist/offscreen/auth.html')
cpSync('src/ui/side-panel/index.html', 'dist/ui/side-panel/index.html')
cpSync('src/ui/popup/index.html', 'dist/ui/popup/index.html')
console.log('extension built → dist/')
```

- [ ] **Step 4: Write `extension/manifest.json`** (output paths reference the bundled `dist/` layout)

```json
{
  "manifest_version": 3,
  "name": "Clanker Desktop Bridge",
  "version": "0.1.0",
  "description": "Lets your Clanker agent perform web tasks you request on this browser.",
  "background": { "service_worker": "background/service-worker.js", "type": "module" },
  "content_scripts": [],
  "permissions": ["scripting", "storage", "sidePanel", "notifications", "gcm", "offscreen"],
  "optional_host_permissions": ["<all_urls>"],
  "side_panel": { "default_path": "ui/side-panel/index.html" },
  "action": {
    "default_popup": "ui/popup/index.html",
    "default_icon": { "16": "icons/icon-16.png", "48": "icons/icon-48.png" }
  }
}
```

> The `key` field (stable extension ID) is added before CWS submission in Phase 4; the private `.pem` is never committed.

- [ ] **Step 5: Write `extension/src/env.ts`**

```typescript
// FIREBASE_API_KEY is a public identifier, safe to embed. Replace placeholders
// with the project's real values before loading the extension.
export const FIREBASE_CONFIG = {
  apiKey: 'REPLACE_FIREBASE_API_KEY',
  authDomain: 'REPLACE.firebaseapp.com',
  projectId: 'REPLACE',
  appId: 'REPLACE',
}
export const FIREBASE_SENDER_ID = 'REPLACE_FCM_SENDER_ID'
export const CLOUD_BASE_URL = 'https://REPLACE-cloud-agent-url'
export const CLOUD_WS_URL = 'wss://REPLACE-cloud-agent-url/agent/browser'
```

- [ ] **Step 6: Write `extension/test/chrome-stub.ts`** (installed by tests that need `chrome`)

```typescript
type Listener = (...args: unknown[]) => void
export function installChromeStub(over: Record<string, unknown> = {}): void {
  const store: Record<string, unknown> = {}
  ;(globalThis as { chrome?: unknown }).chrome = {
    runtime: { sendMessage: async () => undefined, onMessage: { addListener: (_l: Listener) => {} }, getURL: (p: string) => p },
    storage: { local: {
      get: async (k: string) => ({ [k]: store[k] }),
      set: async (o: Record<string, unknown>) => { Object.assign(store, o) },
    } },
    gcm: { register: (_ids: string[], cb: (t: string) => void) => cb('gcm-token'), onMessage: { addListener: (_l: Listener) => {} } },
    offscreen: { hasDocument: async () => false, createDocument: async () => {}, closeDocument: async () => {} },
    scripting: { executeScript: async () => [{ result: undefined }] },
    permissions: { contains: async () => true, request: async () => true },
    notifications: { create: () => {} },
    tabs: { create: async () => ({ id: 1 }), query: async () => [{ id: 1, url: 'https://x' }], update: async () => ({}) },
    sidePanel: { open: async () => {} },
    ...over,
  }
}
```

- [ ] **Step 7: Verify scaffold installs and typechecks (no source yet → expect missing-entry errors only)**

Run: `cd extension && npm install && npx tsc --noEmit`
Expected: tsc reports missing source files referenced by esbuild only when built; `tsc --noEmit` with empty `src` (besides env.ts + test stub) passes. (If it errors on no inputs, add a temporary `src/index.ts` placeholder and remove it in Task 17.)

- [ ] **Step 8: Commit**

```bash
git add extension/package.json extension/tsconfig.json extension/esbuild.mjs extension/manifest.json extension/src/env.ts extension/test/chrome-stub.ts extension/icons
git commit -m "chore(extension): scaffold MV3 package, build, manifest, test harness"
```

---

### Task 17: Extension shared re-exports (single source of truth)

**Files:**
- Create: `extension/src/shared/constants.ts`
- Create: `extension/src/shared/dsl-types.ts`

These re-export the repo-root canonical modules so the destructive pattern and wire types never drift.

- [ ] **Step 1: Write `extension/src/shared/constants.ts`**

```typescript
export { DESTRUCTIVE_ACTION_PATTERN, classifyActionLabel } from '../../../shared/constants.js'
```

- [ ] **Step 2: Write `extension/src/shared/dsl-types.ts`**

```typescript
export type {
  SingleAction, SequenceAction, TaskIntent, TaskResult, BridgeErrorCode,
} from '../../../shared/dsl-types.js'
```

- [ ] **Step 3: Verify esbuild can resolve the cross-package path**

Run: `cd extension && node -e "import('esbuild').then(e=>e.build({entryPoints:['src/shared/constants.ts'],bundle:true,write:false,format:'esm'})).then(()=>console.log('ok'))"`
Expected: `ok` (esbuild bundles `../../../shared/constants.ts`).

- [ ] **Step 4: Commit**

```bash
git add extension/src/shared
git commit -m "chore(extension): re-export shared DSL constants/types"
```

---

### Task 18: `content/dom-extractor.ts` — read primitives (jsdom-tested)

**Files:**
- Create: `extension/src/content/dom-extractor.ts`
- Test: `extension/src/content/dom-extractor.test.ts`

Pure DOM functions operating on a passed `Document` so they're jsdom-testable.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/content/dom-extractor.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { extract, readDom, summarizeVisibleText } from './dom-extractor.js'

function doc(html: string) { return new JSDOM(html).window.document }

test('extract returns matched text keyed by label', () => {
  const d = doc('<div class="price">$42.99</div>')
  assert.deepEqual(extract(d, '.price', 'price'), { price: '$42.99' })
})

test('extract throws SELECTOR_NOT_FOUND when missing', () => {
  const d = doc('<div></div>')
  assert.throws(() => extract(d, '.nope', 'x'), /SELECTOR_NOT_FOUND/)
})

test('readDom returns innerHTML of the selector', () => {
  const d = doc('<section id="s"><b>hi</b></section>')
  assert.match(readDom(d, '#s'), /<b>hi<\/b>/)
})

test('summarizeVisibleText drops nav when filter=no_nav', () => {
  const d = doc('<nav>MENU</nav><article>Body text here.</article>')
  const out = summarizeVisibleText(d, 'no_nav')
  assert.match(out, /Body text here/)
  assert.doesNotMatch(out, /MENU/)
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extension && node --import tsx/esm --test src/content/dom-extractor.test.ts`
Expected: FAIL — cannot find `./dom-extractor.js`.

- [ ] **Step 3: Write `extension/src/content/dom-extractor.ts`**

```typescript
export function extract(doc: Document, selector: string, label = 'value'): Record<string, string> {
  const el = doc.querySelector(selector)
  if (!el) throw new Error('SELECTOR_NOT_FOUND')
  return { [label]: (el.textContent ?? '').trim() }
}

export function readDom(doc: Document, selector: string): string {
  const el = doc.querySelector(selector)
  if (!el) throw new Error('SELECTOR_NOT_FOUND')
  return el.innerHTML
}

export function summarizeVisibleText(doc: Document, filter: 'no_nav' | 'no_ads' | 'all' = 'all'): string {
  const drop = new Set<string>()
  if (filter === 'no_nav') ['nav', 'header', 'footer', 'aside'].forEach((t) => drop.add(t))
  if (filter === 'no_ads') ['aside', '[role=banner]'].forEach((t) => drop.add(t))
  const clone = doc.body.cloneNode(true) as HTMLElement
  for (const sel of drop) clone.querySelectorAll(sel).forEach((n) => n.remove())
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd extension && node --import tsx/esm --test src/content/dom-extractor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/dom-extractor.ts extension/src/content/dom-extractor.test.ts
git commit -m "feat(extension): DOM read primitives"
```

---

### Task 19: `content/safety-classifier.ts` — Layer 2 validator

**Files:**
- Create: `extension/src/content/safety-classifier.ts`
- Test: `extension/src/content/safety-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/content/safety-classifier.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { classifyElement } from './safety-classifier.js'

function el(html: string) { return new JSDOM(`<body>${html}</body>`).window.document.body.firstElementChild! }

test('destructive button text → requires_auth', () => {
  assert.equal(classifyElement(el('<button>Submit Payment</button>')), 'requires_auth')
})

test('benign link → safe', () => {
  assert.equal(classifyElement(el('<a>Read more</a>')), 'safe')
})

test('submit input inside a form → requires_auth', () => {
  const form = new JSDOM('<form><input type="submit" value="Go"></form>').window.document.querySelector('input')!
  assert.equal(classifyElement(form), 'requires_auth')
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extension && node --import tsx/esm --test src/content/safety-classifier.test.ts`
Expected: FAIL — cannot find `./safety-classifier.js`.

- [ ] **Step 3: Write `extension/src/content/safety-classifier.ts`**

```typescript
import { DESTRUCTIVE_ACTION_PATTERN } from '../shared/constants.js'

export function classifyElement(el: Element): 'safe' | 'requires_auth' {
  const text = (el.textContent ?? '').toLowerCase()
  if (DESTRUCTIVE_ACTION_PATTERN.test(text)) return 'requires_auth'
  if (el.closest('form') && el.matches('[type=submit]')) return 'requires_auth'
  return 'safe'
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd extension && node --import tsx/esm --test src/content/safety-classifier.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/safety-classifier.ts extension/src/content/safety-classifier.test.ts
git commit -m "feat(extension): Layer 2 destructive-element classifier"
```

---

### Task 20: `content/executor.ts` — action runner (injected per-task)

**Files:**
- Create: `extension/src/content/executor.ts`
- Test: `extension/src/content/executor.test.ts`

`runAction` takes a `Document`/`Window`-like context so it's jsdom-testable; the real injection wrapper reads `document`/`window`. Phase 1 supports read + navigation primitives; `fill_field`/`click` return an `EXECUTION_ERROR` (not implemented in Phase 1) — they never reach here because the cloud agent only emits read/nav actions, but fail-closed defensively.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/content/executor.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { runAction } from './executor.js'

function ctx(html: string) {
  const dom = new JSDOM(html, { url: 'https://example.com/' })
  let scrolled = 0
  return {
    doc: dom.window.document,
    win: { scrollBy: (_x: number, y: number) => { scrolled += y }, location: { href: dom.window.location.href }, get scrolled() { return scrolled } },
  }
}

test('extract action returns data record', async () => {
  const c = ctx('<span class="p">$9</span>')
  const r = await runAction({ type: 'extract', selector: '.p', label: 'price' }, c.doc, c.win as never)
  assert.deepEqual(r.data, { price: '$9' })
})

test('read_dom returns html under read_dom key', async () => {
  const c = ctx('<div id="x"><i>z</i></div>')
  const r = await runAction({ type: 'read_dom', selector: '#x' }, c.doc, c.win as never)
  assert.match(r.data.read_dom, /<i>z<\/i>/)
})

test('scroll down moves the viewport', async () => {
  const c = ctx('<body></body>')
  await runAction({ type: 'scroll', direction: 'down', pixels: 200 }, c.doc, c.win as never)
  assert.equal(c.win.scrolled, 200)
})

test('stateful action fails closed in Phase 1', async () => {
  const c = ctx('<button>Buy</button>')
  await assert.rejects(
    () => runAction({ type: 'click', selector: 'button', tier: 'stateful' }, c.doc, c.win as never),
    /EXECUTION_ERROR/,
  )
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extension && node --import tsx/esm --test src/content/executor.test.ts`
Expected: FAIL — cannot find `./executor.js`.

- [ ] **Step 3: Write `extension/src/content/executor.ts`**

```typescript
import type { SingleAction } from '../shared/dsl-types.js'
import { extract, readDom, summarizeVisibleText } from './dom-extractor.js'

export interface ActionOutcome { data: Record<string, string>; activeUrl: string }

interface WinLike { scrollBy(x: number, y: number): void; location: { href: string } }

export async function runAction(action: SingleAction, doc: Document, win: WinLike): Promise<ActionOutcome> {
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
    // open_tab / focus_tab are handled in the service worker (tabs API), not the page.
    case 'open_tab':
    case 'focus_tab':
      throw new Error('EXECUTION_ERROR: tab actions are handled by the service worker')
    case 'fill_field':
    case 'click':
      throw new Error('EXECUTION_ERROR: stateful actions are not enabled in Phase 1')
    default:
      throw new Error('EXECUTION_ERROR: unknown action')
  }
}

// Real entry point used by chrome.scripting.executeScript injection.
export async function runActionInPage(action: SingleAction): Promise<ActionOutcome> {
  return runAction(action, document, window as unknown as WinLike)
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd extension && node --import tsx/esm --test src/content/executor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/content/executor.ts extension/src/content/executor.test.ts
git commit -m "feat(extension): per-task action executor"
```

---

### Task 21: `background/task-dispatcher.ts` — route intent → tabs/content

**Files:**
- Create: `extension/src/background/task-dispatcher.ts`
- Test: `extension/src/background/task-dispatcher.test.ts`

Parses a `TaskIntent`, runs sequence steps in order, routes tab actions to `chrome.tabs`, and page actions to `chrome.scripting.executeScript`. Aggregates `data`. Phase 1: no halt (no stateful actions reach it).

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/background/task-dispatcher.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { dispatchTask } from './task-dispatcher.js'

function injector(results: Record<string, { data: Record<string, string>; activeUrl: string }>) {
  const seen: string[] = []
  return {
    seen,
    runInActiveTab: async (action: { type: string }) => { seen.push(action.type); return results[action.type] },
    openTab: async (_url: string) => { seen.push('open_tab') },
    focusTab: async (_host: string) => { seen.push('focus_tab') },
  }
}

test('single extract action returns aggregated data', async () => {
  const inj = injector({ extract: { data: { price: '$1' }, activeUrl: 'https://x' } })
  const res = await dispatchTask(
    { version: '1', taskId: 't', sessionId: 's', requiresAuth: false, actionSummary: 'x', action: { type: 'extract', selector: '.p', label: 'price' } },
    inj as never,
  )
  assert.equal(res.status, 'complete')
  assert.deepEqual(res.data, { price: '$1' })
})

test('sequence runs steps in order and merges data', async () => {
  const inj = injector({
    extract: { data: { total: '$9' }, activeUrl: 'https://x' },
    summarize_visible_text: { data: { summary: 'hi' }, activeUrl: 'https://x' },
  })
  const res = await dispatchTask(
    { version: '1', taskId: 't', sessionId: 's', requiresAuth: false, actionSummary: 'x',
      action: { type: 'sequence', steps: [
        { type: 'open_tab', url: 'https://x' },
        { type: 'extract', selector: '.t', label: 'total' },
        { type: 'summarize_visible_text', filter: 'no_nav' },
      ] } },
    inj as never,
  )
  assert.deepEqual(inj.seen, ['open_tab', 'extract', 'summarize_visible_text'])
  assert.deepEqual(res.data, { total: '$9', summary: 'hi' })
})

test('selector failure → failed result with code', async () => {
  const inj = { runInActiveTab: async () => { throw new Error('SELECTOR_NOT_FOUND') }, openTab: async () => {}, focusTab: async () => {} }
  const res = await dispatchTask(
    { version: '1', taskId: 't', sessionId: 's', requiresAuth: false, actionSummary: 'x', action: { type: 'extract', selector: '.x' } },
    inj as never,
  )
  assert.equal(res.status, 'failed')
  assert.equal(res.error?.code, 'SELECTOR_NOT_FOUND')
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extension && node --import tsx/esm --test src/background/task-dispatcher.test.ts`
Expected: FAIL — cannot find `./task-dispatcher.js`.

- [ ] **Step 3: Write `extension/src/background/task-dispatcher.ts`**

```typescript
import type { TaskIntent, SingleAction, TaskResult, BridgeErrorCode } from '../shared/dsl-types.js'

export interface Injector {
  runInActiveTab(action: SingleAction): Promise<{ data: Record<string, string>; activeUrl: string }>
  openTab(url: string): Promise<void>
  focusTab(host: string): Promise<void>
}

function knownCode(msg: string): BridgeErrorCode {
  for (const c of ['SELECTOR_NOT_FOUND', 'HOST_NOT_ALLOWED', 'HOST_PERMISSION_REQUIRED', 'EXECUTION_TIMEOUT'] as const) {
    if (msg.includes(c)) return c
  }
  return 'EXECUTION_ERROR'
}

export async function dispatchTask(intent: TaskIntent, inj: Injector): Promise<TaskResult> {
  const steps: SingleAction[] = intent.action.type === 'sequence' ? intent.action.steps : [intent.action]
  const data: Record<string, string> = {}
  let activeUrl = ''
  try {
    for (const step of steps) {
      if (step.type === 'open_tab') { await inj.openTab(step.url); activeUrl = step.url; continue }
      if (step.type === 'focus_tab') { await inj.focusTab(step.host); continue }
      const out = await inj.runInActiveTab(step)
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

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd extension && node --import tsx/esm --test src/background/task-dispatcher.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/task-dispatcher.ts extension/src/background/task-dispatcher.test.ts
git commit -m "feat(extension): task dispatcher with sequence + error mapping"
```

---

### Task 22: `background/ws-client.ts` — WS wrapper + heartbeat

**Files:**
- Create: `extension/src/background/ws-client.ts`
- Test: `extension/src/background/ws-client.test.ts`

WS wrapper that sends the auth frame on open, exposes `onTask`/`onSessionEnd` callbacks, and runs an internal `setInterval` ping loop (NOT `chrome.alarms`). Tests inject a fake `WebSocket` constructor + fake timers.

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/background/ws-client.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createWsClient } from './ws-client.js'

class FakeSocket extends EventEmitter {
  static OPEN = 1
  readyState = 1
  sent: string[] = []
  onopen?: () => void
  onmessage?: (e: { data: string }) => void
  onclose?: () => void
  send(s: string) { this.sent.push(s) }
  close() { this.readyState = 3; this.onclose?.() }
  fireOpen() { this.onopen?.() }
  fireMessage(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }) }
}

test('sends auth frame on open', () => {
  let sock!: FakeSocket
  const client = createWsClient({
    url: 'wss://x', idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    WebSocketImpl: (() => { sock = new FakeSocket(); return sock }) as never,
    onTask: () => {}, onSessionEnd: () => {},
  })
  client.connect()
  sock.fireOpen()
  assert.equal(JSON.parse(sock.sent[0]).type, 'auth')
  assert.equal(JSON.parse(sock.sent[0]).sessionId, 's1')
})

test('routes task and session_end frames', () => {
  let sock!: FakeSocket
  const tasks: unknown[] = []; let ended = false
  const client = createWsClient({
    url: 'wss://x', idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    WebSocketImpl: (() => { sock = new FakeSocket(); return sock }) as never,
    onTask: (t) => tasks.push(t), onSessionEnd: () => { ended = true },
  })
  client.connect(); sock.fireOpen()
  sock.fireMessage({ type: 'session_ready', sessionId: 's1' })
  sock.fireMessage({ type: 'task', intent: { taskId: 't1' } })
  sock.fireMessage({ type: 'session_end' })
  assert.equal(tasks.length, 1)
  assert.equal(ended, true)
})

test('sendResult emits task_result frame', () => {
  let sock!: FakeSocket
  const client = createWsClient({
    url: 'wss://x', idToken: 'tok', sessionId: 's1', deviceId: 'd1',
    WebSocketImpl: (() => { sock = new FakeSocket(); return sock }) as never,
    onTask: () => {}, onSessionEnd: () => {},
  })
  client.connect(); sock.fireOpen()
  client.sendResult({ taskId: 't1', status: 'complete', data: { a: 'b' }, activeUrl: 'https://x' })
  const frame = JSON.parse(sock.sent.find((s) => JSON.parse(s).type === 'task_result')!)
  assert.deepEqual(frame.data, { a: 'b' })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extension && node --import tsx/esm --test src/background/ws-client.test.ts`
Expected: FAIL — cannot find `./ws-client.js`.

- [ ] **Step 3: Write `extension/src/background/ws-client.ts`**

```typescript
import type { TaskIntent, TaskResult } from '../shared/dsl-types.js'

interface SocketLike {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((e: { data: string }) => void) | null
  onclose: (() => void) | null
  send(data: string): void
  close(): void
}

export interface WsClientOpts {
  url: string
  idToken: string
  sessionId: string
  deviceId: string
  onTask: (intent: TaskIntent) => void
  onSessionEnd: () => void
  WebSocketImpl?: new (url: string) => SocketLike
  pingIntervalMs?: number
}

export function createWsClient(opts: WsClientOpts) {
  const Impl = opts.WebSocketImpl ?? (WebSocket as unknown as new (url: string) => SocketLike)
  const pingMs = opts.pingIntervalMs ?? 20_000
  let sock: SocketLike | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null

  function stopPing() { if (pingTimer) { clearInterval(pingTimer); pingTimer = null } }

  return {
    connect() {
      sock = new Impl(opts.url)
      sock.onopen = () => {
        sock!.send(JSON.stringify({ type: 'auth', idToken: opts.idToken, sessionId: opts.sessionId, deviceId: opts.deviceId }))
        pingTimer = setInterval(() => { try { sock?.send(JSON.stringify({ type: 'ping' })) } catch { /* ignore */ } }, pingMs)
      }
      sock.onmessage = (e) => {
        let msg: { type?: string; intent?: TaskIntent }
        try { msg = JSON.parse(e.data) } catch { return }
        if (msg.type === 'task' && msg.intent) opts.onTask(msg.intent)
        else if (msg.type === 'session_end') { stopPing(); opts.onSessionEnd() }
      }
      sock.onclose = () => { stopPing() }
    },
    sendResult(result: TaskResult) {
      if (result.status === 'complete') {
        sock?.send(JSON.stringify({ type: 'task_result', taskId: result.taskId, data: result.data, activeUrl: result.activeUrl }))
      } else {
        sock?.send(JSON.stringify({ type: 'task_error', taskId: result.taskId, code: result.error?.code, message: result.error?.message, failedAction: result.error?.failedAction }))
      }
    },
    close() { stopPing(); try { sock?.close() } catch { /* ignore */ } },
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd extension && node --import tsx/esm --test src/background/ws-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/ws-client.ts extension/src/background/ws-client.test.ts
git commit -m "feat(extension): WS client with auth frame + heartbeat"
```

---

### Task 23: `background/auth-bridge.ts` + offscreen auth document

**Files:**
- Create: `extension/src/background/auth-bridge.ts`
- Create: `extension/src/offscreen/auth.html`
- Create: `extension/src/offscreen/auth.ts`
- Test: `extension/src/background/auth-bridge.test.ts`

`auth-bridge` is chrome-glue; unit-test the message round-trip with the chrome stub. The offscreen doc hosts the Firebase Web SDK — verified manually (Task 27).

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/background/auth-bridge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { installChromeStub } from '../../test/chrome-stub.js'

test('requestIdToken messages the offscreen doc and returns the token', async () => {
  installChromeStub({
    offscreen: { hasDocument: async () => true, createDocument: async () => {}, closeDocument: async () => {} },
    runtime: { sendMessage: async (msg: { type: string }) => (msg.type === 'GET_ID_TOKEN' ? { idToken: 'id-123' } : undefined) },
  })
  const { requestIdToken } = await import('./auth-bridge.js')
  assert.equal(await requestIdToken(), 'id-123')
})

test('ensureOffscreen creates a document only when absent', async () => {
  let created = 0
  installChromeStub({
    offscreen: { hasDocument: async () => false, createDocument: async () => { created++ }, closeDocument: async () => {} },
  })
  const { ensureOffscreen } = await import('./auth-bridge.js')
  await ensureOffscreen()
  assert.equal(created, 1)
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extension && node --import tsx/esm --test src/background/auth-bridge.test.ts`
Expected: FAIL — cannot find `./auth-bridge.js`.

- [ ] **Step 3: Write `extension/src/background/auth-bridge.ts`**

```typescript
const OFFSCREEN_PATH = 'offscreen/auth.html'

export async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['DOM_PARSER' as chrome.offscreen.Reason],
    justification: 'Required to host Firebase Web Auth SDK which relies on DOM storage APIs',
  })
}

export async function requestIdToken(): Promise<string> {
  await ensureOffscreen()
  const res = (await chrome.runtime.sendMessage({ target: 'offscreen-auth', type: 'GET_ID_TOKEN' })) as { idToken?: string; error?: string } | undefined
  if (!res?.idToken) throw new Error(res?.error ?? 'Not signed in. Open the side panel to sign in.')
  return res.idToken
}

export async function closeOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument()
}
```

- [ ] **Step 4: Write `extension/src/offscreen/auth.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"></head>
<body><script type="module" src="auth.js"></script></body></html>
```

- [ ] **Step 5: Write `extension/src/offscreen/auth.ts`**

```typescript
import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { FIREBASE_CONFIG } from '../env.js'

const app = initializeApp(FIREBASE_CONFIG)
const auth = getAuth(app)
void setPersistence(auth, browserLocalPersistence)

chrome.runtime.onMessage.addListener((msg: { target?: string; type?: string }, _sender, sendResponse) => {
  if (msg.target !== 'offscreen-auth') return
  if (msg.type === 'GET_ID_TOKEN') {
    const user = auth.currentUser
    if (!user) { sendResponse({ error: 'Not signed in' }); return true }
    user.getIdToken(false).then((idToken) => sendResponse({ idToken })).catch((e) => sendResponse({ error: String(e) }))
    return true // async response
  }
  return undefined
})
```

- [ ] **Step 6: Run the auth-bridge test to confirm it passes**

Run: `cd extension && node --import tsx/esm --test src/background/auth-bridge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add extension/src/background/auth-bridge.ts extension/src/background/auth-bridge.test.ts extension/src/offscreen
git commit -m "feat(extension): offscreen Firebase auth bridge"
```

---

### Task 24: `background/content-bridge.ts` — injection wrapper

**Files:**
- Create: `extension/src/background/content-bridge.ts`
- Test: `extension/src/background/content-bridge.test.ts`

Provides the `Injector` impl used by the dispatcher: runs page actions via `chrome.scripting.executeScript`, and tab actions via `chrome.tabs`. Includes host-permission preflight (returns `HOST_PERMISSION_REQUIRED`).

- [ ] **Step 1: Write the failing test**

```typescript
// extension/src/background/content-bridge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { installChromeStub } from '../../test/chrome-stub.js'

test('openTab requires host permission; throws HOST_PERMISSION_REQUIRED when absent', async () => {
  installChromeStub({
    permissions: { contains: async () => false, request: async () => false },
    notifications: { create: () => {} },
  })
  const { createInjector } = await import('./content-bridge.js')
  const inj = createInjector()
  await assert.rejects(() => inj.openTab('https://amazon.com/cart'), /HOST_PERMISSION_REQUIRED/)
})

test('runInActiveTab returns the injected script result', async () => {
  installChromeStub({
    permissions: { contains: async () => true, request: async () => true },
    tabs: { query: async () => [{ id: 7, url: 'https://x.com/a' }], create: async () => ({ id: 1 }), update: async () => ({}) },
    scripting: { executeScript: async () => [{ result: { data: { price: '$3' }, activeUrl: 'https://x.com/a' } }] },
  })
  const { createInjector } = await import('./content-bridge.js')
  const inj = createInjector()
  const out = await inj.runInActiveTab({ type: 'extract', selector: '.p', label: 'price' })
  assert.deepEqual(out.data, { price: '$3' })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd extension && node --import tsx/esm --test src/background/content-bridge.test.ts`
Expected: FAIL — cannot find `./content-bridge.js`.

- [ ] **Step 3: Write `extension/src/background/content-bridge.ts`**

```typescript
import type { SingleAction } from '../shared/dsl-types.js'
import type { Injector } from './task-dispatcher.js'
import { runActionInPage } from '../content/executor.js'

function originPattern(url: string): string {
  try { return new URL(url).origin + '/*' } catch { return url }
}

async function ensureHost(url: string): Promise<void> {
  const origins = [originPattern(url)]
  if (await chrome.permissions.contains({ origins })) return
  // Cannot call chrome.permissions.request() without a user gesture in the SW.
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon-48.png',
    title: 'Clanker needs access',
    message: `Clanker needs access to ${new URL(url).host}. Click to grant.`,
  })
  throw new Error('HOST_PERMISSION_REQUIRED')
}

async function activeTab(): Promise<{ id: number; url: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error('EXECUTION_ERROR: no active tab')
  return { id: tab.id, url: tab.url ?? '' }
}

export function createInjector(): Injector {
  return {
    async openTab(url: string) {
      await ensureHost(url)
      await chrome.tabs.create({ url, active: true })
    },
    async focusTab(host: string) {
      const tabs = await chrome.tabs.query({})
      const match = tabs.find((t) => { try { return new URL(t.url ?? '').host === host } catch { return false } })
      if (!match?.id) throw new Error('EXECUTION_ERROR: no tab for host')
      await chrome.tabs.update(match.id, { active: true })
    },
    async runInActiveTab(action: SingleAction) {
      const tab = await activeTab()
      if (tab.url) await ensureHost(tab.url)
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: runActionInPage as unknown as (...a: unknown[]) => unknown,
        args: [action],
      })
      const out = res?.result as { data: Record<string, string>; activeUrl: string } | undefined
      if (!out) throw new Error('EXECUTION_ERROR: empty injection result')
      return out
    },
  }
}
```

> `chrome.scripting.executeScript` with `func` serializes the function; because `runActionInPage` imports `dom-extractor`, the bundler must inline those imports into the injected function. esbuild bundles `content/executor.ts` as a separate entry (Task 16) so the injected code is self-contained at runtime — verify in Task 27 that extraction works on a real page. If serialization drops imports, switch to `files: ['content/executor.js']` injection. Note this caveat in the PR.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd extension && node --import tsx/esm --test src/background/content-bridge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/src/background/content-bridge.ts extension/src/background/content-bridge.test.ts
git commit -m "feat(extension): content-bridge injector + host preflight"
```

---

### Task 25: `background/service-worker.ts` — install, wake, orchestration

**Files:**
- Create: `extension/src/background/service-worker.ts`

Chrome-glue orchestration; verified end-to-end manually (Task 27). Structural code only, no unit test (it wires the already-tested units).

- [ ] **Step 1: Write `extension/src/background/service-worker.ts`**

```typescript
import { FIREBASE_SENDER_ID, CLOUD_BASE_URL, CLOUD_WS_URL } from '../env.js'
import { ensureOffscreen, requestIdToken, closeOffscreen } from './auth-bridge.js'
import { createWsClient } from './ws-client.js'
import { createInjector } from './content-bridge.js'
import { dispatchTask } from './task-dispatcher.js'

async function getDeviceId(): Promise<string> {
  const { deviceId } = await chrome.storage.local.get('deviceId')
  if (deviceId) return deviceId as string
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ deviceId: id })
  return id
}

async function registerDevice(gcmToken: string): Promise<void> {
  const deviceId = await getDeviceId()
  const idToken = await requestIdToken().catch(() => null)
  if (!idToken) return // not signed in yet; side panel will trigger registration after login
  await fetch(`${CLOUD_BASE_URL}/agent/browser/register-device`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fcmToken: gcmToken, deviceId, deviceName: `${navigator.platform} — Chrome` }),
  })
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.gcm.register([FIREBASE_SENDER_ID], (gcmToken) => {
    if (chrome.runtime.lastError) { console.error(chrome.runtime.lastError); return }
    void chrome.storage.local.set({ gcmToken })
    void registerDevice(gcmToken)
  })
})

chrome.gcm.onMessage.addListener((message) => {
  const data = message.data as { type?: string; sessionId?: string; taskId?: string }
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
    onTask: (intent) => {
      void (async () => {
        const result = await dispatchTask(intent, injector)
        await appendActionLog(intent, result.status)
        client.sendResult(result)
      })()
    },
    onSessionEnd: () => { client.close(); void closeOffscreen() },
  })
  client.connect()
}

async function appendActionLog(intent: { action: { type: string } }, status: string): Promise<void> {
  const { actionLog = [] } = await chrome.storage.local.get('actionLog')
  const next = [{ ts: Date.now(), action: intent.action.type, status }, ...(actionLog as unknown[])].slice(0, 50)
  await chrome.storage.local.set({ actionLog: next })
}

chrome.action?.onClicked?.addListener?.(() => { void chrome.sidePanel.open({ windowId: chrome.windows?.WINDOW_ID_CURRENT }) })
```

- [ ] **Step 2: Typecheck**

Run: `cd extension && npx tsc --noEmit`
Expected: no errors (chrome types resolve via `@types/chrome`).

- [ ] **Step 3: Commit**

```bash
git add extension/src/background/service-worker.ts
git commit -m "feat(extension): service worker install + wake orchestration"
```

---

### Task 26: Side panel + popup UI

**Files:**
- Create: `extension/src/ui/side-panel/index.html`, `extension/src/ui/side-panel/panel.ts`
- Create: `extension/src/ui/popup/index.html`, `extension/src/ui/popup/popup.ts`

Side panel: sign-in (`signInWithPopup`), account/device/status display, recent-actions log, Pause toggle, Sign Out, and a [Grant Access] button for the host-permission flow. Popup: status badge + link to side panel.

- [ ] **Step 1: Write `extension/src/ui/side-panel/index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><title>Clanker Desktop Bridge</title>
<style>body{font:14px system-ui;margin:12px;width:300px} .row{margin:6px 0} button{padding:6px 10px} ul{padding-left:16px}</style>
</head><body>
  <h3>Clanker Desktop Bridge</h3>
  <div class="row" id="status">Status: ○ Idle</div>
  <div class="row" id="account">Account: (signed out)</div>
  <div class="row" id="device">Device: —</div>
  <div class="row"><button id="signin">Sign In</button> <button id="signout" hidden>Sign Out</button></div>
  <div class="row"><button id="pause">Pause Remote Actions</button></div>
  <div class="row"><button id="grant" hidden>Grant Access</button></div>
  <h4>Recent Actions</h4>
  <ul id="log"></ul>
  <script type="module" src="panel.js"></script>
</body></html>
```

- [ ] **Step 2: Write `extension/src/ui/side-panel/panel.ts`**

```typescript
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth'
import { FIREBASE_CONFIG, CLOUD_BASE_URL, FIREBASE_SENDER_ID } from '../../env.js'

const app = initializeApp(FIREBASE_CONFIG)
const auth = getAuth(app)
const $ = (id: string) => document.getElementById(id)!

onAuthStateChanged(auth, (user) => {
  ;($('account')).textContent = `Account: ${user?.email ?? '(signed out)'}`
  ;($('signin') as HTMLButtonElement).hidden = !!user
  ;($('signout') as HTMLButtonElement).hidden = !user
  if (user) void registerThisDevice()
})

$('signin').addEventListener('click', () => { void signInWithPopup(auth, new GoogleAuthProvider()) })
$('signout').addEventListener('click', () => { void signOut(auth); void chrome.storage.local.remove('deviceId') })

$('pause').addEventListener('click', async () => {
  const { paused } = await chrome.storage.local.get('paused')
  const next = !paused
  await chrome.storage.local.set({ paused: next })
  ;($('pause')).textContent = next ? 'Resume Remote Actions' : 'Pause Remote Actions'
  await syncPauseToCloud(next)
})

$('grant').addEventListener('click', async () => {
  const { pendingHost } = await chrome.storage.local.get('pendingHost')
  if (pendingHost) await chrome.permissions.request({ origins: [`https://${pendingHost}/*`] })
})

async function registerThisDevice(): Promise<void> {
  const idToken = await auth.currentUser!.getIdToken()
  const { deviceId: existing, gcmToken } = await chrome.storage.local.get(['deviceId', 'gcmToken'])
  const deviceId = (existing as string) ?? crypto.randomUUID()
  if (!existing) await chrome.storage.local.set({ deviceId })
  let token = gcmToken as string | undefined
  if (!token) token = await new Promise<string>((res) => chrome.gcm.register([FIREBASE_SENDER_ID], (t) => res(t)))
  await fetch(`${CLOUD_BASE_URL}/agent/browser/register-device`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fcmToken: token, deviceId, deviceName: `${navigator.platform} — Chrome` }),
  })
  ;($('device')).textContent = `Device: ${navigator.platform} — Chrome`
}

async function syncPauseToCloud(isPaused: boolean): Promise<void> {
  const user = auth.currentUser; if (!user) return
  const idToken = await user.getIdToken()
  const { deviceId, gcmToken } = await chrome.storage.local.get(['deviceId', 'gcmToken'])
  await fetch(`${CLOUD_BASE_URL}/agent/browser/register-device`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fcmToken: gcmToken, deviceId, deviceName: `${navigator.platform} — Chrome`, isPaused }),
  })
}

async function renderLog(): Promise<void> {
  const { actionLog = [] } = await chrome.storage.local.get('actionLog')
  ;($('log')).innerHTML = (actionLog as Array<{ ts: number; action: string; status: string }>)
    .map((e) => `<li>${new Date(e.ts).toLocaleTimeString()} ${e.action} ${e.status === 'complete' ? '✓' : '✕'}</li>`).join('')
}
void renderLog()
chrome.storage.onChanged.addListener((c) => { if (c.actionLog) void renderLog() })
```

- [ ] **Step 3: Write `extension/src/ui/popup/index.html`**

```html
<!doctype html>
<html><head><meta charset="utf-8"><style>body{font:13px system-ui;margin:10px;width:200px}</style></head>
<body>
  <div id="badge">Clanker Bridge</div>
  <button id="open">Open Settings</button>
  <script type="module" src="popup.js"></script>
</body></html>
```

- [ ] **Step 4: Write `extension/src/ui/popup/popup.ts`**

```typescript
document.getElementById('open')!.addEventListener('click', () => {
  void chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT })
})
chrome.storage.local.get(['paused']).then(({ paused }) => {
  document.getElementById('badge')!.textContent = paused ? 'Clanker Bridge — Paused' : 'Clanker Bridge — Active'
})
```

- [ ] **Step 5: Build the extension**

Run: `cd extension && npm run build`
Expected: `extension built → dist/` with `background/service-worker.js`, `offscreen/auth.js`, `content/executor.js`, `ui/side-panel/panel.js`, `ui/popup/popup.js`, copied html/manifest/icons.

- [ ] **Step 6: Commit**

```bash
git add extension/src/ui
git commit -m "feat(extension): side panel + popup UI"
```

---

### Task 27: Phase 1 gate — build, load unpacked, manual E2E

**Files:** none (manual verification gate). Record results in the PR description.

> Requires real infra wired (Task 1 console steps done; `extension/src/env.ts` populated with real Firebase config, FCM Sender ID, and the deployed cloud-agent URL; cloud-agent deployed with the new code).

- [ ] **Step 1: Extension test suite + typecheck green**

Run: `cd extension && npm run typecheck && npm test`
Expected: all unit tests pass (`dom-extractor`, `safety-classifier`, `executor`, `task-dispatcher`, `ws-client`, `auth-bridge`, `content-bridge`).

- [ ] **Step 2: Load unpacked**

Open `chrome://extensions`, enable Developer mode, "Load unpacked" → `extension/dist`. Open the side panel, sign in with Google, confirm Account + Device render and a device doc appears under `users/{uid}/devices/{deviceId}` in Firestore.

- [ ] **Step 3: E2E — text extract**

From the Clanker text chat (`/agent/run`), with a product page open in the active tab, ask: "Extract the price from my open tab." Expected: extension wakes, executes `extract`, the price returns in chat. Confirm the task doc transitions `pending → executing → complete` in Firestore.

- [ ] **Step 4: E2E — voice summarize**

In a live voice call, open an article tab and ask: "What does the article say?" Expected: interim "Sent the task to your browser…" then the spoken summary. Confirm billing timer paused during the wait (no extra credit ticks while waiting).

- [ ] **Step 5: E2E — offline path**

Quit the browser (or toggle Pause). Ask a browser question by voice. Expected within ~12s: "Your browser extension appears to be offline." Confirm `EXTENSION_OFFLINE` task result + credit refund (voice path) in Firestore/credit ledger.

- [ ] **Step 6: E2E — host permission grant**

Ask Clanker to act on a site whose host has not been granted. Expected: desktop notification + side panel [Grant Access]; after granting and re-asking, the task succeeds.

- [ ] **Step 7: Phase 1 gate sign-off**

Confirm 5 real-world `extract` + `summarize_visible_text` tasks complete end-to-end (spec Phase 1 gate). Record the 5 runs in the PR description.

- [ ] **Step 8: Commit any fixups + finalize**

```bash
git add -A && git commit -m "chore(extension): Phase 1 E2E fixups" || echo "nothing to commit"
```

---

## Deferred to separate plans (out of scope here)

- **Phase 2** — `fill_field`/`click`, two-layer halt at stateful step, `haltedStepIndex` resume, FCM approval cards, Expo Push pipeline + mobile approval UI, `auth/{taskId}` doc lifecycle, `haltForAuth`, `sendApprovalCard`/`sendTaskComplete`/`sendProactive`.
- **Phase 3** — Cloud Scheduler proactive tasks + async Expo completion.
- **Phase 4** — CWS submission: manifest `key`, policy preflight checklist, store listing.

These each warrant their own dated plan under `docs/superpowers/plans/`.
</content>
</invoke>

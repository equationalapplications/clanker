# Desktop Vault Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Clanker side of the desktop vault bridge per `docs/superpowers/specs/2026-07-05-desktop-vault-bridge-design.md` (amended 2026-07-06): `/agent/desktop` persistent WebSocket with pairing-token auth, Firestore-routed task queue, and five `vault_*` ADK tools so the cloud agent can query a user's Curated Thoughts vault mid-turn.

**Amendments (2026-07-06) incorporated in this plan:**
- Per-connection device-doc snapshot listener (revoke/pause → close 4001 + disconnect path)
- `lastSeenAt` refresh cadence **40s** (every other 20s heartbeat), not 60s
- Per-turn vault call-cap **decay to 1** after first `DESKTOP_TIMEOUT` or `DESKTOP_DISCONNECTED`
- Injection-posture test: `browser_action` destructive classifier unchanged when vault precedes it in the same turn (spec §9)

**Architecture:** Curated Thoughts holds a persistent outbound WS to `/agent/desktop`. The socket-owning Cloud Run instance runs a Firestore listener on `users/{uid}/desktopTasks` (pending, per device) and dispatches over its local socket; tool-calling instances write task docs and watch for results (12s timeout). A generation-guarded `desktopBridge` registry prevents stale disconnects from shadowing live connections. No FCM, no sessions — fail-fast on device presence.

**Tech Stack:** Node 20 ESM TypeScript, `ws`, `zod`, `firebase-admin` (Firestore), `@google/adk` `FunctionTool`, `node:test` + `node:assert/strict` (tests compile to `dist/` then run). All work in `cloud-agent/` except `firestore.rules` and docs.

**Verify commands (run from `cloud-agent/`):** `npm run typecheck` · `npm test` (builds first — slow; per-task runs use `npm run build && node --test --test-reporter spec dist/<path>.test.js`).

---

## File map

| File | Role |
|---|---|
| Create `cloud-agent/src/services/desktopBridge.ts` | Per-instance registry: `uid:deviceId` → socket + generation |
| Modify `cloud-agent/src/services/firestoreSession.ts` | Desktop device queries, `desktopTasks` CRUD + watchers, `getActiveDevice` type filter |
| Create `cloud-agent/src/services/desktopPairing.ts` | Token generation/hash/resolve/revoke against `desktopPairings/{tokenHash}` |
| Create `cloud-agent/src/handlers/wsDesktopAgentHandler.ts` | `/agent/desktop` WS lifecycle |
| Create `cloud-agent/src/tools/vaultTools.ts` | Five `vault_*` ADK tools + shared dispatcher |
| Modify `cloud-agent/src/services/agentCore.ts` | `buildAgent` accepts `vault?: VaultToolDeps` |
| Modify `cloud-agent/src/services/liveToolAdapter.ts` | `buildLiveTools` accepts `vault` |
| Modify `cloud-agent/src/index.ts` | Routes `/agent/desktop/pair`, `/agent/desktop/revoke`, WS upgrade path, thread vault deps in `runAgentReal` |
| Modify `firestore.rules` | Explicit client deny for `desktopTasks`; comment for top-level `desktopPairings` |
| Create `docs/desktop-vault-bridge.md` | Operator/developer doc |

Task-doc status vocabulary (used everywhere): `'pending' | 'executing' | 'complete' | 'failed'`. Error codes: `DESKTOP_OFFLINE`, `DESKTOP_TIMEOUT`, `DESKTOP_DISCONNECTED`, `TOOL_ERROR`.

---

### Task 1: `desktopBridge` registry with generation guard

**Files:**
- Create: `cloud-agent/src/services/desktopBridge.ts`
- Test: `cloud-agent/src/services/desktopBridge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// cloud-agent/src/services/desktopBridge.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { createDesktopBridge } = await import('./desktopBridge.js')

function fakeWs() { return { closed: false, close() { this.closed = true } } }

test('register returns increasing generations and get returns latest', () => {
  const bridge = createDesktopBridge()
  const ws1 = fakeWs()
  const gen1 = bridge.register('u1', 'd1', ws1 as never)
  const ws2 = fakeWs()
  const gen2 = bridge.register('u1', 'd1', ws2 as never)
  assert.ok(gen2 > gen1)
  assert.equal(bridge.get('u1', 'd1')?.ws, ws2)
})

test('register closes the previous socket for the same uid:deviceId', () => {
  const bridge = createDesktopBridge()
  const ws1 = fakeWs()
  bridge.register('u1', 'd1', ws1 as never)
  bridge.register('u1', 'd1', fakeWs() as never)
  assert.equal(ws1.closed, true)
})

test('deregister with stale generation is a no-op and returns false', () => {
  const bridge = createDesktopBridge()
  const gen1 = bridge.register('u1', 'd1', fakeWs() as never)
  bridge.register('u1', 'd1', fakeWs() as never) // replacement
  assert.equal(bridge.deregister('u1', 'd1', gen1), false)
  assert.ok(bridge.get('u1', 'd1')) // live connection still registered
})

test('deregister with current generation removes entry and returns true', () => {
  const bridge = createDesktopBridge()
  const gen = bridge.register('u1', 'd1', fakeWs() as never)
  assert.equal(bridge.deregister('u1', 'd1', gen), true)
  assert.equal(bridge.get('u1', 'd1'), undefined)
})

test('connections are isolated per uid:deviceId key', () => {
  const bridge = createDesktopBridge()
  bridge.register('u1', 'd1', fakeWs() as never)
  assert.equal(bridge.get('u1', 'd2'), undefined)
  assert.equal(bridge.get('u2', 'd1'), undefined)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `cloud-agent/`): `npm run build 2>&1 | head -20`
Expected: TypeScript build error — `desktopBridge.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
// cloud-agent/src/services/desktopBridge.ts
import type { WebSocket } from 'ws'

export interface DesktopConnection {
  ws: WebSocket
  generation: number
}

const key = (uid: string, deviceId: string) => `${uid}:${deviceId}`

// Mirrors sessionBridge.ts: per-instance module singleton, no cross-instance state.
// The generation guard exists so a stale socket's deferred `close` event cannot
// deregister (and mark offline) a connection that has already been replaced.
export function createDesktopBridge() {
  const map = new Map<string, DesktopConnection>()
  let nextGeneration = 1
  return {
    /** Registers ws for uid:deviceId, closing any previous socket. Returns the generation. */
    register(uid: string, deviceId: string, ws: WebSocket): number {
      const k = key(uid, deviceId)
      const prev = map.get(k)
      if (prev) { try { prev.ws.close(4000, 'Replaced by new connection') } catch { /* ignore */ } }
      const generation = nextGeneration++
      map.set(k, { ws, generation })
      return generation
    },
    get(uid: string, deviceId: string): DesktopConnection | undefined {
      return map.get(key(uid, deviceId))
    },
    /** Removes the entry only if `generation` still owns it. Returns whether removed. */
    deregister(uid: string, deviceId: string, generation: number): boolean {
      const k = key(uid, deviceId)
      const cur = map.get(k)
      if (!cur || cur.generation !== generation) return false
      map.delete(k)
      return true
    },
  }
}

export type DesktopBridge = ReturnType<typeof createDesktopBridge>

// Module-level singleton — one map per Cloud Run instance.
export const desktopBridge: DesktopBridge = createDesktopBridge()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test --test-reporter spec dist/services/desktopBridge.test.js`
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/desktopBridge.ts cloud-agent/src/services/desktopBridge.test.ts
git commit -m "feat(cloud-agent): add generation-guarded desktopBridge registry"
```

---

### Task 2: `firestoreSession` desktop additions

**Files:**
- Modify: `cloud-agent/src/services/firestoreSession.ts` (interfaces at top; new methods inside `createFirestoreSession`; `defaultFirestoreSession` wiring at bottom)
- Test: `cloud-agent/src/services/firestoreSession.test.ts` (append tests)

- [ ] **Step 1: Write the failing tests**

Append to `cloud-agent/src/services/firestoreSession.test.ts` (it already builds a fake `FirestoreLike`; add a self-contained fake here so the new tests don't depend on the existing fixture's shape):

```ts
// ── Desktop vault bridge additions ─────────────────────────────────────────
function desktopFakeDb() {
  const docs = new Map<string, Record<string, unknown>>()
  const docWatchers = new Map<string, Array<(s: { exists: boolean; data(): Record<string, unknown> | undefined }) => void>>()
  type ColWatcher = { filters: Array<[string, string, unknown]>; cb: (rows: Array<{ id: string; data(): Record<string, unknown> }>) => void }
  const collectionWatchers = new Map<string, ColWatcher[]>()

  function snapshotFor(path: string) {
    const d = docs.get(path)
    return { exists: d !== undefined, data: () => d }
  }
  function fireDoc(path: string) { for (const cb of docWatchers.get(path) ?? []) cb(snapshotFor(path)) }
  function fireCollection(colPath: string) {
    // Honor the query's where() filters like real Firestore does server-side —
    // the production code must NOT need to re-filter in memory.
    for (const w of collectionWatchers.get(colPath) ?? []) {
      const rows = [...docs.entries()]
        .filter(([p]) => p.startsWith(`${colPath}/`) && p.split('/').length === colPath.split('/').length + 1)
        .filter(([, d]) => w.filters.every(([f, , v]) => (d as Record<string, unknown>)[f] === v))
        .map(([p, d]) => ({ id: p.split('/').pop()!, data: () => d }))
      w.cb(rows)
    }
  }

  const db = {
    doc(path: string) {
      return {
        set: async (data: Record<string, unknown>, opts?: { merge?: boolean }) => {
          docs.set(path, opts?.merge ? { ...(docs.get(path) ?? {}), ...data } : data)
          fireDoc(path); fireCollection(path.split('/').slice(0, -1).join('/'))
        },
        get: async () => snapshotFor(path),
        update: async (data: Record<string, unknown>) => {
          const cur = docs.get(path); if (!cur) throw new Error('NOT_FOUND')
          docs.set(path, { ...cur, ...data })
          fireDoc(path); fireCollection(path.split('/').slice(0, -1).join('/'))
        },
        onSnapshot: (cb: (s: { exists: boolean; data(): Record<string, unknown> | undefined }) => void) => {
          const arr = docWatchers.get(path) ?? []; arr.push(cb); docWatchers.set(path, arr)
          cb(snapshotFor(path))
          return () => { docWatchers.set(path, (docWatchers.get(path) ?? []).filter((f) => f !== cb)) }
        },
      }
    },
    collection(colPath: string) {
      const filters: Array<[string, string, unknown]> = []
      const q = {
        where(field: string, op: string, value: unknown) { filters.push([field, op, value]); return q },
        orderBy() { return q },
        limit() { return q },
        async get() {
          const rows = [...docs.entries()]
            .filter(([p]) => p.startsWith(`${colPath}/`) && p.split('/').length === colPath.split('/').length + 1)
            .filter(([, d]) => filters.every(([f, , v]) => (d as Record<string, unknown>)[f] === v))
            .map(([p, d]) => ({ id: p.split('/').pop()!, data: () => d }))
          return { empty: rows.length === 0, docs: rows }
        },
        onSnapshot(cb: (rows: Array<{ id: string; data(): Record<string, unknown> }>) => void) {
          const w = { filters: [...filters], cb }
          const arr = collectionWatchers.get(colPath) ?? []; arr.push(w); collectionWatchers.set(colPath, arr)
          return () => { collectionWatchers.set(colPath, (collectionWatchers.get(colPath) ?? []).filter((x) => x !== w)) }
        },
      }
      return q
    },
    _docs: docs,
  }
  return db
}

test('getActiveDevice excludes desktop-type devices', async () => {
  const db = desktopFakeDb()
  db._docs.set('users/u1/devices/desk1', { active: true, type: 'desktop', lastSeenAt: Date.now(), fcmToken: '', deviceName: 'Mac mini' })
  db._docs.set('users/u1/devices/ext1', { active: true, lastSeenAt: Date.now() - 1000, fcmToken: 't', deviceName: 'Chrome' })
  const fs = createFirestoreSession(db as never)
  const device = await fs.getActiveDevice('u1')
  assert.equal(device?.deviceId, 'ext1')
})

test('getActiveDesktopDevice returns fresh online desktop, ignores paused/stale/offline', async () => {
  const now = Date.now()
  const db = desktopFakeDb()
  db._docs.set('users/u1/devices/stale', { active: true, type: 'desktop', online: true, lastSeenAt: now - 120_000, deviceName: 's' })
  db._docs.set('users/u1/devices/paused', { active: true, type: 'desktop', online: true, isPaused: true, lastSeenAt: now, deviceName: 'p' })
  db._docs.set('users/u1/devices/offline', { active: true, type: 'desktop', online: false, lastSeenAt: now, deviceName: 'o' })
  db._docs.set('users/u1/devices/good', { active: true, type: 'desktop', online: true, lastSeenAt: now - 30_000, deviceName: 'Mac mini' })
  db._docs.set('users/u1/devices/browser', { active: true, online: true, lastSeenAt: now, fcmToken: 't', deviceName: 'Chrome' })
  const fs = createFirestoreSession(db as never)
  const device = await fs.getActiveDesktopDevice('u1')
  assert.equal(device?.deviceId, 'good')
})

test('desktop task lifecycle: create pending → executing → result, watchers fire', async () => {
  const db = desktopFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.createDesktopTask('u1', 't1', 'desk1', 'wiki_search', { query: 'hiking' })

  const seenPending: string[] = []
  const unsubPending = fs.watchPendingDesktopTasks('u1', 'desk1', (tasks) => {
    for (const t of tasks) seenPending.push(t.taskId)
  })
  await fs.createDesktopTask('u1', 't2', 'desk1', 'wiki_search', { query: 'x' })
  assert.ok(seenPending.includes('t2'))

  await fs.markDesktopTaskExecuting('u1', 't2')
  const statuses: string[] = []
  const unsubTask = fs.watchDesktopTask('u1', 't2', (t) => statuses.push(t.status))
  await fs.writeDesktopTaskResult('u1', 't2', { status: 'complete', result: { hits: 3 } })
  assert.ok(statuses.includes('complete'))
  unsubPending(); unsubTask()
})

test('watchPendingDesktopTasks only surfaces pending tasks for the given device', async () => {
  const db = desktopFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.createDesktopTask('u1', 'other-device', 'desk2', 'wiki_search', {})
  await fs.createDesktopTask('u1', 'mine', 'desk1', 'wiki_search', {})
  await fs.markDesktopTaskExecuting('u1', 'mine')
  const seen: string[] = []
  const unsub = fs.watchPendingDesktopTasks('u1', 'desk1', (tasks) => { for (const t of tasks) seen.push(t.taskId) })
  await fs.createDesktopTask('u1', 'fresh', 'desk1', 'wiki_search', {})
  assert.deepEqual(seen, ['fresh'])
  unsub()
})

test('failDesktopTaskIfUnresolved fails pending/executing, skips terminal', async () => {
  const db = desktopFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.createDesktopTask('u1', 't1', 'desk1', 'wiki_search', {})
  assert.equal(await fs.failDesktopTaskIfUnresolved('u1', 't1', { code: 'DESKTOP_TIMEOUT', message: 'timeout' }), true)
  assert.equal(await fs.failDesktopTaskIfUnresolved('u1', 't1', { code: 'DESKTOP_TIMEOUT', message: 'timeout' }), false)
})

test('desktop device online/offline/touch update device doc', async () => {
  const db = desktopFakeDb()
  db._docs.set('users/u1/devices/desk1', { active: true, type: 'desktop', online: false, deviceName: 'Mac mini' })
  const fs = createFirestoreSession(db as never)
  await fs.markDesktopDeviceOnline('u1', 'desk1', 'instance-A')
  assert.equal(db._docs.get('users/u1/devices/desk1')?.online, true)
  assert.equal(db._docs.get('users/u1/devices/desk1')?.connectedInstanceId, 'instance-A')
  await fs.touchDesktopDeviceLastSeen('u1', 'desk1')
  assert.ok(typeof db._docs.get('users/u1/devices/desk1')?.lastSeenAt !== 'undefined')
  await fs.markDesktopDeviceOffline('u1', 'desk1')
  assert.equal(db._docs.get('users/u1/devices/desk1')?.online, false)
  assert.equal(db._docs.get('users/u1/devices/desk1')?.connectedInstanceId, null)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build 2>&1 | head -20`
Expected: TypeScript errors — `getActiveDesktopDevice` etc. do not exist on the session object.

- [ ] **Step 3: Implement**

3a. Extend `CollectionQuery` (top of `firestoreSession.ts`) with an optional query listener:

```ts
export interface CollectionQuery {
  where(field: string, op: string, value: unknown): CollectionQuery
  orderBy(field: string, dir: 'asc' | 'desc'): CollectionQuery
  limit(n: number): CollectionQuery
  get(): Promise<{ empty: boolean; docs: Array<{ id: string; data(): Record<string, unknown> }> }>
  onSnapshot?(cb: (docs: Array<{ id: string; data(): Record<string, unknown> }>) => void): () => void
}
```

3b. Add shared types near `SessionMeta`:

```ts
export interface DesktopTaskError { code: 'DESKTOP_TIMEOUT' | 'DESKTOP_DISCONNECTED' | 'TOOL_ERROR'; message: string }

export interface DesktopTaskDoc {
  taskId: string
  deviceId: string
  status: 'pending' | 'executing' | 'complete' | 'failed'
  tool: string
  params: Record<string, unknown>
  result: unknown
  error: DesktopTaskError | null
}

const DESKTOP_TASK_TTL_MS = 60 * 60 * 1000  // spec §6: TTL policy reaps within the hour
const DESKTOP_LIVENESS_MS = 90 * 1000        // spec §6: lastSeenAt within 90s

function toMillis(v: unknown): number {
  if (typeof v === 'number') return v
  const t = v as { toMillis?: () => number } | null
  return t?.toMillis?.() ?? 0
}
```

3c. In `getActiveDevice`, change the eligibility filter to exclude desktops:

```ts
      const eligible = snap.docs.filter((d) => {
        const data = d.data() as unknown as DeviceDoc & { type?: string }
        return data.isPaused !== true && data.type !== 'desktop'
      })
```

3d. Add new methods inside the returned object of `createFirestoreSession` (after `getActiveDevice`):

```ts
    async getActiveDesktopDevice(uid: string): Promise<{ deviceId: string; deviceName: string } | null> {
      const snap = await db.collection(devicesPath(uid))
        .where('active', '==', true)
        .orderBy('lastSeenAt', 'desc')
        .limit(50)
        .get()
      const eligible = snap.docs.filter((d) => {
        const data = d.data() as Record<string, unknown>
        return data.type === 'desktop'
          && data.isPaused !== true
          && data.online === true
          && Date.now() - toMillis(data.lastSeenAt) <= DESKTOP_LIVENESS_MS
      })
      if (eligible.length === 0) return null
      const d = eligible[0]
      return { deviceId: d.id, deviceName: (d.data() as { deviceName?: string }).deviceName ?? '' }
    },

    async createDesktopTask(uid: string, taskId: string, deviceId: string, tool: string, params: Record<string, unknown>): Promise<void> {
      const expiresAt = admin.firestore?.Timestamp
        ? admin.firestore.Timestamp.fromMillis(Date.now() + DESKTOP_TASK_TTL_MS)
        : (Date.now() + DESKTOP_TASK_TTL_MS as unknown)
      await db.doc(desktopTaskPath(uid, taskId)).set({
        taskId, deviceId, status: 'pending', tool, params,
        result: null, error: null, createdAt: now(), updatedAt: now(), expiresAt,
      })
    },

    async markDesktopTaskExecuting(uid: string, taskId: string): Promise<void> {
      await db.doc(desktopTaskPath(uid, taskId)).update({ status: 'executing', updatedAt: now() })
    },

    async writeDesktopTaskResult(
      uid: string,
      taskId: string,
      outcome: { status: 'complete'; result: unknown } | { status: 'failed'; error: DesktopTaskError },
    ): Promise<void> {
      await db.doc(desktopTaskPath(uid, taskId)).update(
        outcome.status === 'complete'
          ? { status: 'complete', result: outcome.result, updatedAt: now() }
          : { status: 'failed', error: outcome.error, updatedAt: now() },
      )
    },

    async getDesktopTask(uid: string, taskId: string): Promise<DesktopTaskDoc | null> {
      const doc = await db.doc(desktopTaskPath(uid, taskId)).get()
      if (!doc.exists) return null
      return doc.data() as unknown as DesktopTaskDoc
    },

    /** Fails a task only if still pending/executing. Returns true when it wrote the failure. */
    async failDesktopTaskIfUnresolved(uid: string, taskId: string, error: DesktopTaskError): Promise<boolean> {
      const task = await this.getDesktopTask(uid, taskId)
      if (!task || task.status === 'complete' || task.status === 'failed') return false
      await this.writeDesktopTaskResult(uid, taskId, { status: 'failed', error })
      return true
    },

    watchDesktopTask(uid: string, taskId: string, cb: (task: DesktopTaskDoc) => void): () => void {
      const ref = db.doc(desktopTaskPath(uid, taskId))
      if (!ref.onSnapshot) throw new Error('watchDesktopTask requires onSnapshot support')
      return ref.onSnapshot((snap) => {
        if (snap.exists) cb(snap.data() as unknown as DesktopTaskDoc)
      })
    },

    /** Socket-owner listener: pending tasks for one device. Fires with the current pending set on every change. */
    watchPendingDesktopTasks(uid: string, deviceId: string, cb: (tasks: DesktopTaskDoc[]) => void): () => void {
      const q = db.collection(desktopTasksPath(uid))
        .where('status', '==', 'pending')
        .where('deviceId', '==', deviceId)
      if (!q.onSnapshot) throw new Error('watchPendingDesktopTasks requires onSnapshot support')
      return q.onSnapshot((docs) => {
        cb(docs.map((d) => d.data() as unknown as DesktopTaskDoc))
      })
    },

    async markDesktopDeviceOnline(uid: string, deviceId: string, instanceId: string): Promise<void> {
      await db.doc(`${devicesPath(uid)}/${deviceId}`).update({ online: true, connectedInstanceId: instanceId, lastSeenAt: now() })
    },

    async markDesktopDeviceOffline(uid: string, deviceId: string): Promise<void> {
      await db.doc(`${devicesPath(uid)}/${deviceId}`).update({ online: false, connectedInstanceId: null })
    },

    async touchDesktopDeviceLastSeen(uid: string, deviceId: string): Promise<void> {
      await db.doc(`${devicesPath(uid)}/${deviceId}`).update({ lastSeenAt: now() })
    },
```

3e. Add path helpers next to the existing ones:

```ts
  const desktopTasksPath = (uid: string) => `users/${uid}/desktopTasks`
  const desktopTaskPath = (uid: string, tid: string) => `users/${uid}/desktopTasks/${tid}`
```

3f. In `defaultFirestoreSession`, the raw Admin `Query` already exposes `onSnapshot`; extend the collection wrapper so the interface's optional method is real in production:

```ts
    collection: (path) => {
      const col = raw.collection(path)
      const wrap = (q: FirebaseFirestore.Query): CollectionQuery => ({
        where: (f, op, v) => wrap(q.where(f, op as FirebaseFirestore.WhereFilterOp, v)),
        orderBy: (f, dir) => wrap(q.orderBy(f, dir)),
        limit: (n) => wrap(q.limit(n)),
        get: async () => {
          const snap = await q.get()
          return { empty: snap.empty, docs: snap.docs.map((d) => ({ id: d.id, data: () => d.data() })) }
        },
        onSnapshot: (cb) => q.onSnapshot((snap) => cb(snap.docs.map((d) => ({ id: d.id, data: () => d.data() })))),
      })
      return wrap(col)
    },
```

**Composite index note:** `watchPendingDesktopTasks` uses two equality filters (`status`, `deviceId`) — equality-only queries need no composite index. `getActiveDesktopDevice` reuses the existing `active`+`lastSeenAt` index shape.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test --test-reporter spec dist/services/firestoreSession.test.js`
Expected: all existing + 6 new tests pass. If existing tests break on the `collection` wrapper change, fix the wrapper — not the tests.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/firestoreSession.ts cloud-agent/src/services/firestoreSession.test.ts
git commit -m "feat(cloud-agent): desktop device queries and desktopTasks queue in firestoreSession"
```

---

### Task 3: pairing service

**Files:**
- Create: `cloud-agent/src/services/desktopPairing.ts`
- Test: `cloud-agent/src/services/desktopPairing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// cloud-agent/src/services/desktopPairing.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const { generatePairingToken, pairDesktopDevice, resolvePairingToken, revokeDesktopDevice } = await import('./desktopPairing.js')

function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    doc(path: string) {
      return {
        set: async (data: Record<string, unknown>) => { docs.set(path, data) },
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        update: async (data: Record<string, unknown>) => { docs.set(path, { ...(docs.get(path) ?? {}), ...data }) },
        delete: async () => { docs.delete(path) },
      }
    },
  }
}

test('generatePairingToken: 256-bit base64url token, sha256 hex hash', () => {
  const { token, tokenHash } = generatePairingToken()
  assert.ok(token.length >= 43)                       // 32 bytes base64url
  assert.match(token, /^[A-Za-z0-9_-]+$/)             // base64url alphabet, no padding
  assert.equal(tokenHash, createHash('sha256').update(token).digest('hex'))
})

test('pairDesktopDevice writes device doc (no token material) and pairing mapping', async () => {
  const db = fakeDb()
  const { pairingToken, deviceId } = await pairDesktopDevice(db as never, 'u1', 'Mac mini')
  const deviceDoc = db.docs.get(`users/u1/devices/${deviceId}`)!
  assert.equal(deviceDoc.type, 'desktop')
  assert.equal(deviceDoc.deviceName, 'Mac mini')
  assert.equal(deviceDoc.active, true)
  assert.equal(deviceDoc.online, false)
  assert.equal(deviceDoc.isPaused, false)
  assert.ok(!JSON.stringify(deviceDoc).includes(pairingToken))
  const hash = createHash('sha256').update(pairingToken).digest('hex')
  const mapping = db.docs.get(`desktopPairings/${hash}`)!
  assert.equal(mapping.uid, 'u1')
  assert.equal(mapping.deviceId, deviceId)
})

test('resolvePairingToken: valid token resolves, unknown returns null', async () => {
  const db = fakeDb()
  const { pairingToken, deviceId } = await pairDesktopDevice(db as never, 'u1', 'Mac mini')
  assert.deepEqual(await resolvePairingToken(db as never, pairingToken), { uid: 'u1', deviceId })
  assert.equal(await resolvePairingToken(db as never, 'not-a-real-token'), null)
})

test('revokeDesktopDevice deletes device doc; token no longer resolves (fails closed)', async () => {
  const db = fakeDb()
  const { pairingToken, deviceId } = await pairDesktopDevice(db as never, 'u1', 'Mac mini')
  await revokeDesktopDevice(db as never, 'u1', deviceId)
  assert.equal(db.docs.has(`users/u1/devices/${deviceId}`), false)
  assert.equal(await resolvePairingToken(db as never, pairingToken), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build 2>&1 | head -20`
Expected: build error — module missing.

- [ ] **Step 3: Implement**

```ts
// cloud-agent/src/services/desktopPairing.ts
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import admin from 'firebase-admin'

// Structural Firestore subset (same pattern as DeviceUpsertFirestore in deviceUpsert.ts).
export interface PairingFirestore {
  doc(path: string): {
    set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<unknown>
    get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>
    delete?(): Promise<unknown>
  }
}

function now() { return admin.firestore?.Timestamp ? admin.firestore.Timestamp.now() : (Date.now() as unknown) }

const pairingPath = (tokenHash: string) => `desktopPairings/${tokenHash}`
const devicePath = (uid: string, deviceId: string) => `users/${uid}/devices/${deviceId}`

/** 32 bytes CSPRNG, base64url — shown to the user exactly once. Never persist or log the raw token. */
export function generatePairingToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: createHash('sha256').update(token).digest('hex') }
}

export async function pairDesktopDevice(
  db: PairingFirestore,
  uid: string,
  deviceName: string,
): Promise<{ pairingToken: string; deviceId: string }> {
  const { token, tokenHash } = generatePairingToken()
  const deviceId = randomUUID()
  // Device doc carries NO token material — device docs are client-readable (firestore.rules).
  await db.doc(devicePath(uid, deviceId)).set({
    deviceId, type: 'desktop', deviceName,
    active: true, isPaused: false, online: false,
    connectedInstanceId: null, lastSeenAt: null,
    registeredAt: now(),
  })
  await db.doc(pairingPath(tokenHash)).set({ uid, deviceId, createdAt: now() })
  return { pairingToken: token, deviceId }
}

export async function resolvePairingToken(
  db: PairingFirestore,
  rawToken: string,
): Promise<{ uid: string; deviceId: string } | null> {
  if (!rawToken || rawToken.length > 128) return null
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const snap = await db.doc(pairingPath(tokenHash)).get()
  if (!snap.exists) return null
  const data = snap.data() as { uid?: string; deviceId?: string }
  if (!data.uid || !data.deviceId) return null
  // Fail closed on revocation: the mapping is hash-keyed, so revoke cannot find and
  // delete it. Instead, resolve additionally requires the device doc to still exist —
  // a revoked token leaves a dangling mapping that resolves to nothing (harmless;
  // reaped manually or by a future cleanup). Matches spec §4 in effect.
  const device = await db.doc(devicePath(data.uid, data.deviceId)).get()
  if (!device.exists) return null
  return { uid: data.uid, deviceId: data.deviceId }
}

export async function revokeDesktopDevice(db: PairingFirestore, uid: string, deviceId: string): Promise<void> {
  // Deleting the device doc kills the token (resolve checks device-doc existence)
  // and removes the device from getActiveDesktopDevice results immediately.
  const deviceRef = db.doc(devicePath(uid, deviceId))
  if (deviceRef.delete) await deviceRef.delete()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test --test-reporter spec dist/services/desktopPairing.test.js`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/desktopPairing.ts cloud-agent/src/services/desktopPairing.test.ts
git commit -m "feat(cloud-agent): desktop pairing token service (hash-only storage, fail-closed resolve)"
```

---

### Task 4: `/agent/desktop/pair` and `/agent/desktop/revoke` routes

**Files:**
- Modify: `cloud-agent/src/index.ts` (next to `POST /agent/browser/register-device`, ~line 292)
- Test: extend `cloud-agent/src/services/desktopPairing.test.ts` is NOT enough — routes are thin; test via the existing app-level pattern only if `index.ts` has route tests. It does not, and the repo tests handlers/services directly. The route bodies below contain no logic beyond zod parse + service call, matching `register-device`. No new route test file.

- [ ] **Step 1: Add routes**

In `createApp` in `cloud-agent/src/index.ts`, immediately after the `/agent/browser/register-device` route:

```ts
  app.post('/agent/desktop/pair', authRouteLimiter, requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    if (!browserBridgeAvailable) { res.status(503).json({ error: 'Desktop bridge unavailable' }); return }
    const parsed = z.object({ deviceName: z.string().trim().min(1).max(100) }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid request body' }); return }
    try {
      const { pairingToken, deviceId } = await pairDesktopDevice(
        admin.firestore() as unknown as PairingFirestore, req.uid!, parsed.data.deviceName,
      )
      // Raw token appears exactly once, here. Do not log it.
      res.json({ pairingToken, deviceId })
    } catch (err) {
      console.error('desktop pair error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  app.post('/agent/desktop/revoke', authRouteLimiter, requireAuth, async (req: Request & { uid?: string }, res: Response): Promise<void> => {
    if (!browserBridgeAvailable) { res.status(503).json({ error: 'Desktop bridge unavailable' }); return }
    const parsed = z.object({ deviceId: z.string().uuid() }).safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Invalid request body' }); return }
    try {
      await revokeDesktopDevice(admin.firestore() as unknown as PairingFirestore, req.uid!, parsed.data.deviceId)
      res.json({ ok: true })
    } catch (err) {
      console.error('desktop revoke error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })
```

Add imports at the top of `index.ts`:

```ts
import { pairDesktopDevice, revokeDesktopDevice, resolvePairingToken, type PairingFirestore } from './services/desktopPairing.js'
```

(`resolvePairingToken` is used in Task 7's upgrade wiring — importing now avoids touching the import line twice.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean. (`resolvePairingToken` unused → if `noUnusedLocals` complains, defer that one import to Task 7.)

- [ ] **Step 3: Commit**

```bash
git add cloud-agent/src/index.ts
git commit -m "feat(cloud-agent): desktop pair/revoke routes"
```

---

### Task 5: `wsDesktopAgentHandler`

**Files:**
- Create: `cloud-agent/src/handlers/wsDesktopAgentHandler.ts`
- Test: `cloud-agent/src/handlers/wsDesktopAgentHandler.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// cloud-agent/src/handlers/wsDesktopAgentHandler.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'

const { handleDesktopWsUpgrade } = await import('./wsDesktopAgentHandler.js')
const { createDesktopBridge } = await import('../services/desktopBridge.js')

class FakeWs extends EventEmitter {
  OPEN = 1
  readyState = 1
  sent: string[] = []
  closeCode: number | null = null
  send(data: string) { this.sent.push(data) }
  close(code?: number) { this.closeCode = code ?? 1000; this.readyState = 3; this.emit('close') }
  frames() { return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>) }
}

function fakeSession(over: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[][]> = {
    markDesktopDeviceOnline: [], markDesktopDeviceOffline: [], touchDesktopDeviceLastSeen: [],
    markDesktopTaskExecuting: [], writeDesktopTaskResult: [], failDesktopTaskIfUnresolved: [],
  }
  let pendingCb: ((tasks: Array<Record<string, unknown>>) => void) | null = null
  const fs = {
    calls,
    emitPending(tasks: Array<Record<string, unknown>>) { pendingCb?.(tasks) },
    markDesktopDeviceOnline: async (...a: unknown[]) => { calls.markDesktopDeviceOnline.push(a) },
    markDesktopDeviceOffline: async (...a: unknown[]) => { calls.markDesktopDeviceOffline.push(a) },
    touchDesktopDeviceLastSeen: async (...a: unknown[]) => { calls.touchDesktopDeviceLastSeen.push(a) },
    markDesktopTaskExecuting: async (...a: unknown[]) => { calls.markDesktopTaskExecuting.push(a) },
    writeDesktopTaskResult: async (...a: unknown[]) => { calls.writeDesktopTaskResult.push(a) },
    failDesktopTaskIfUnresolved: async (...a: unknown[]) => { calls.failDesktopTaskIfUnresolved.push(a); return true },
    watchPendingDesktopTasks: (_u: string, _d: string, cb: (t: Array<Record<string, unknown>>) => void) => {
      pendingCb = cb; return () => { pendingCb = null }
    },
    getDesktopDeviceDoc: async () => ({ exists: true, isPaused: false }),
    ...over,
  }
  return fs
}

function options(fs: ReturnType<typeof fakeSession>, bridge = createDesktopBridge(), over: Record<string, unknown> = {}) {
  return {
    firestoreSession: fs as never,
    desktopBridge: bridge,
    resolvePairingToken: async (raw: string) => (raw === 'good-token' ? { uid: 'u1', deviceId: 'desk1' } : null),
    instanceId: 'instance-A',
    authTimeoutMs: 50,
    lastSeenRefreshMs: 0, // touch on every ping in tests
    ...over,
  }
}

function authFrame() { return JSON.stringify({ type: 'auth', pairingToken: 'good-token' }) }
async function tick() { await new Promise((r) => setTimeout(r, 0)) }

test('valid pairing token: marks online, subscribes, sends ready', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  assert.deepEqual(fs.calls.markDesktopDeviceOnline[0], ['u1', 'desk1', 'instance-A'])
  assert.ok(ws.frames().some((f) => f.type === 'ready'))
})

test('bad pairing token closes 4001', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'auth', pairingToken: 'wrong' }))); await tick()
  assert.equal(ws.closeCode, 4001)
})

test('no auth frame within timeout closes 4001', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(ws.closeCode, 4001)
})

test('paused device is rejected at auth', async () => {
  const ws = new FakeWs()
  const fs = fakeSession({ getDesktopDeviceDoc: async () => ({ exists: true, isPaused: true }) })
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  assert.equal(ws.closeCode, 4001)
})

test('pending task is marked executing and dispatched once over WS', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  fs.emitPending([{ taskId: 't1', tool: 'wiki_search', params: { query: 'x' }, status: 'pending', deviceId: 'desk1' }])
  await tick()
  fs.emitPending([{ taskId: 't1', tool: 'wiki_search', params: { query: 'x' }, status: 'pending', deviceId: 'desk1' }]) // listener re-fire
  await tick()
  const taskFrames = ws.frames().filter((f) => f.type === 'task')
  assert.equal(taskFrames.length, 1)
  assert.equal(taskFrames[0].taskId, 't1')
  assert.equal(fs.calls.markDesktopTaskExecuting.length, 1)
})

test('task_result writes complete result; task_error writes failure', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  fs.emitPending([{ taskId: 't1', tool: 'wiki_search', params: {}, status: 'pending', deviceId: 'desk1' }]); await tick()
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'task_result', taskId: 't1', result: { hits: 2 } }))); await tick()
  assert.deepEqual(fs.calls.writeDesktopTaskResult[0], ['u1', 't1', { status: 'complete', result: { hits: 2 } }])

  fs.emitPending([{ taskId: 't2', tool: 'wiki_search', params: {}, status: 'pending', deviceId: 'desk1' }]); await tick()
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'task_error', taskId: 't2', error: { code: 'E', message: 'boom' } }))); await tick()
  assert.deepEqual(fs.calls.writeDesktopTaskResult[1], ['u1', 't2', { status: 'failed', error: { code: 'TOOL_ERROR', message: 'boom' } }])
})

test('ping gets pong and refreshes lastSeenAt (throttle disabled in test)', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'ping' }))); await tick()
  assert.ok(ws.frames().some((f) => f.type === 'pong'))
  assert.equal(fs.calls.touchDesktopDeviceLastSeen.length, 1)
})

test('close marks device offline and fails in-flight dispatched tasks', async () => {
  const ws = new FakeWs(); const fs = fakeSession()
  handleDesktopWsUpgrade(ws as never, {} as never, options(fs) as never)
  ws.emit('message', Buffer.from(authFrame())); await tick()
  fs.emitPending([{ taskId: 't1', tool: 'wiki_search', params: {}, status: 'pending', deviceId: 'desk1' }]); await tick()
  ws.emit('close'); await tick()
  assert.equal(fs.calls.markDesktopDeviceOffline.length, 1)
  assert.equal(fs.calls.failDesktopTaskIfUnresolved.length, 1)
  assert.equal((fs.calls.failDesktopTaskIfUnresolved[0][2] as { code: string }).code, 'DESKTOP_DISCONNECTED')
})

test('replacement race: stale close after new registration must NOT mark device offline', async () => {
  const bridge = createDesktopBridge()
  const fs = fakeSession()
  const ws1 = new FakeWs()
  handleDesktopWsUpgrade(ws1 as never, {} as never, options(fs, bridge) as never)
  ws1.emit('message', Buffer.from(authFrame())); await tick()

  const ws2 = new FakeWs()
  handleDesktopWsUpgrade(ws2 as never, {} as never, options(fs, bridge) as never)
  ws2.emit('message', Buffer.from(authFrame())); await tick()
  // register() closed ws1, whose close handler has now run — device must still be online.
  const offlineCalls = fs.calls.markDesktopDeviceOffline.length
  assert.equal(offlineCalls, 0, 'stale close must not mark the replaced device offline')
  assert.equal(bridge.get('u1', 'desk1')?.ws, ws2 as never)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build 2>&1 | head -10`
Expected: build error — handler module missing. Also missing: `getDesktopDeviceDoc` on `firestoreSession` (added below in Step 3b).

- [ ] **Step 3: Implement**

3a. Handler:

```ts
// cloud-agent/src/handlers/wsDesktopAgentHandler.ts
import type { WebSocket } from 'ws'
import type { IncomingMessage } from 'http'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'
import type { DesktopBridge } from '../services/desktopBridge.js'

const desktopAuthSchema = z.object({
  type: z.literal('auth'),
  pairingToken: z.string().min(1).max(128),
})

const taskResultSchema = z.object({
  type: z.literal('task_result'),
  taskId: z.string().min(1),
  result: z.unknown(),
})

const taskErrorSchema = z.object({
  type: z.literal('task_error'),
  taskId: z.string().min(1),
  error: z.object({ code: z.string(), message: z.string() }),
})

export interface DesktopWsOptions {
  firestoreSession: FirestoreSession
  desktopBridge: DesktopBridge
  resolvePairingToken: (rawToken: string) => Promise<{ uid: string; deviceId: string } | null>
  instanceId: string
  authTimeoutMs?: number       // default 5000, mirror of browser handler
  lastSeenRefreshMs?: number   // default 60_000 — spec §5: refresh at most every third heartbeat
}

export function handleDesktopWsUpgrade(
  ws: WebSocket,
  _req: IncomingMessage,
  options: DesktopWsOptions,
): void {
  const fs = options.firestoreSession
  const bridge = options.desktopBridge
  const authTimeoutMs = options.authTimeoutMs ?? 5000
  const lastSeenRefreshMs = options.lastSeenRefreshMs ?? 60_000

  let authed = false
  let uid: string | null = null
  let deviceId: string | null = null
  let generation = 0
  let unsubPending: (() => void) | null = null
  let lastTouch = 0
  const dispatched = new Set<string>()   // taskIds sent over this socket, not yet resolved

  const authTimer = setTimeout(() => {
    if (!authed && ws.readyState === ws.OPEN) ws.close(4001, 'Auth timeout')
  }, authTimeoutMs)

  async function onAuth(raw: unknown): Promise<void> {
    const parsed = desktopAuthSchema.safeParse(raw)
    if (!parsed.success) { ws.close(4001, 'Invalid auth frame'); return }
    const resolved = await options.resolvePairingToken(parsed.data.pairingToken)
    if (!resolved) { ws.close(4001, 'Unknown pairing token'); return }
    const device = await fs.getDesktopDeviceDoc(resolved.uid, resolved.deviceId)
    if (!device.exists || device.isPaused) { ws.close(4001, 'Device unavailable'); return }

    uid = resolved.uid; deviceId = resolved.deviceId; authed = true
    clearTimeout(authTimer)

    // register() closes any previous socket for this uid:deviceId; its stale close
    // handler will call deregister() with an old generation and no-op (see ws.on('close')).
    generation = bridge.register(uid, deviceId, ws)
    await fs.markDesktopDeviceOnline(uid, deviceId, options.instanceId)
    lastTouch = Date.now()

    unsubPending = fs.watchPendingDesktopTasks(uid, deviceId, (tasks) => {
      for (const task of tasks) {
        if (dispatched.has(task.taskId)) continue
        dispatched.add(task.taskId)
        void fs.markDesktopTaskExecuting(uid!, task.taskId)
          .then(() => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'task', taskId: task.taskId, tool: task.tool, params: task.params }))
            }
          })
          .catch((err) => console.error('[desktop-bridge] dispatch failed:', task.taskId, err))
      }
    })

    ws.send(JSON.stringify({ type: 'ready' }))
  }

  async function onResult(raw: unknown): Promise<void> {
    if (!authed || !uid) return
    const r = taskResultSchema.safeParse(raw)
    if (r.success) {
      dispatched.delete(r.data.taskId)
      await fs.writeDesktopTaskResult(uid, r.data.taskId, { status: 'complete', result: r.data.result })
      return
    }
    const e = taskErrorSchema.safeParse(raw)
    if (e.success) {
      dispatched.delete(e.data.taskId)
      await fs.writeDesktopTaskResult(uid, e.data.taskId, {
        status: 'failed',
        error: { code: 'TOOL_ERROR', message: e.data.error.message },
      })
    }
  }

  ws.on('message', (data: Buffer) => {
    let parsed: unknown
    try { parsed = JSON.parse(data.toString()) } catch { return }
    const type = (parsed as { type?: string }).type
    if (type === 'ping') {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'pong' }))
      if (authed && uid && deviceId && Date.now() - lastTouch >= lastSeenRefreshMs) {
        lastTouch = Date.now()
        // Revocation reap (spec §4): revoke deletes the device doc, so this update throws
        // NOT_FOUND — close the socket. Works cross-instance without a per-connection doc
        // watch; a revoked desktop is disconnected within one refresh interval (≤60s).
        // Transient Firestore errors also close, which is safe: CT auto-reconnects.
        void fs.touchDesktopDeviceLastSeen(uid, deviceId).catch(() => {
          if (ws.readyState === ws.OPEN) ws.close(4001, 'Device revoked or unavailable')
        })
      }
      return
    }
    if (!authed) { void onAuth(parsed).catch(() => ws.close(1011, 'Internal error')); return }
    if (type === 'task_result' || type === 'task_error') {
      void onResult(parsed).catch((err) => console.error('[desktop-bridge] result write failed:', err))
    }
  })

  ws.on('close', () => {
    clearTimeout(authTimer)
    if (!authed || !uid || !deviceId) return
    // Generation guard: only the current owner may tear down shared state (spec §5).
    if (!bridge.deregister(uid, deviceId, generation)) return
    unsubPending?.()
    void fs.markDesktopDeviceOffline(uid, deviceId).catch(() => { /* liveness bound covers */ })
    for (const taskId of dispatched) {
      void fs.failDesktopTaskIfUnresolved(uid, taskId, {
        code: 'DESKTOP_DISCONNECTED', message: 'Desktop connection lost mid-call',
      }).catch(() => { /* caller timeout covers */ })
    }
    dispatched.clear()
  })
  ws.on('error', () => { clearTimeout(authTimer) })
}
```

3b. Add `getDesktopDeviceDoc` to `firestoreSession.ts` (inside `createFirestoreSession`, next to the other desktop methods) plus one test appended to `firestoreSession.test.ts`:

```ts
    async getDesktopDeviceDoc(uid: string, deviceId: string): Promise<{ exists: boolean; isPaused: boolean }> {
      const doc = await db.doc(`${devicesPath(uid)}/${deviceId}`).get()
      if (!doc.exists) return { exists: false, isPaused: false }
      const data = doc.data() as { isPaused?: boolean } | undefined
      return { exists: true, isPaused: data?.isPaused === true }
    },
```

```ts
test('getDesktopDeviceDoc reports existence and pause state', async () => {
  const db = desktopFakeDb()
  db._docs.set('users/u1/devices/desk1', { type: 'desktop', isPaused: true })
  const fs = createFirestoreSession(db as never)
  assert.deepEqual(await fs.getDesktopDeviceDoc('u1', 'desk1'), { exists: true, isPaused: true })
  assert.deepEqual(await fs.getDesktopDeviceDoc('u1', 'nope'), { exists: false, isPaused: false })
})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test --test-reporter spec dist/handlers/wsDesktopAgentHandler.test.js dist/services/firestoreSession.test.js`
Expected: all passing, including the replacement-race test.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/handlers/wsDesktopAgentHandler.ts cloud-agent/src/handlers/wsDesktopAgentHandler.test.ts cloud-agent/src/services/firestoreSession.ts cloud-agent/src/services/firestoreSession.test.ts
git commit -m "feat(cloud-agent): /agent/desktop WS handler with generation-guarded lifecycle"
```

---

### Task 6: `vault_*` ADK tool family

**Files:**
- Create: `cloud-agent/src/tools/vaultTools.ts`
- Test: `cloud-agent/src/tools/vaultTools.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// cloud-agent/src/tools/vaultTools.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { buildVaultTools, createVaultToolDeps, VAULT_WIRE_TOOL } = await import('./vaultTools.js')

function fakeSession(over: Record<string, unknown> = {}) {
  const created: Array<{ taskId: string; deviceId: string; tool: string; params: Record<string, unknown> }> = []
  let taskCb: ((task: Record<string, unknown>) => void) | null = null
  return {
    created,
    resolveTask(status: 'complete' | 'failed', payload: Record<string, unknown>) {
      taskCb?.({ taskId: created.at(-1)?.taskId, status, ...payload })
    },
    getActiveDesktopDevice: async () => ({ deviceId: 'desk1', deviceName: 'Mac mini' }),
    createDesktopTask: async (_u: string, taskId: string, deviceId: string, tool: string, params: Record<string, unknown>) => {
      created.push({ taskId, deviceId, tool, params })
    },
    watchDesktopTask: (_u: string, _t: string, cb: (task: Record<string, unknown>) => void) => {
      taskCb = cb; return () => { taskCb = null }
    },
    failDesktopTaskIfUnresolved: async () => true,
    ...over,
  }
}

function deps(fs: ReturnType<typeof fakeSession>, over: Record<string, unknown> = {}) {
  return createVaultToolDeps({
    firebaseUid: 'u1',
    firestoreSession: fs as never,
    callTimeoutMs: 100,
    ...over,
  })
}

test('exposes five tools with vault_ names and correct wire mapping', () => {
  const tools = buildVaultTools(deps(fakeSession()))
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    'vault_get_ontology', 'vault_related_chunks', 'vault_semantic_search',
    'vault_traverse_graph', 'vault_wiki_search',
  ])
  assert.equal(VAULT_WIRE_TOOL.vault_wiki_search, 'wiki_search')
  assert.equal(VAULT_WIRE_TOOL.vault_get_ontology, 'wiki_get_ontology')
  assert.equal(VAULT_WIRE_TOOL.vault_traverse_graph, 'wiki_traverse_graph')
  assert.equal(VAULT_WIRE_TOOL.vault_semantic_search, 'vault_semantic_search')
  assert.equal(VAULT_WIRE_TOOL.vault_related_chunks, 'vault_related_chunks')
})

test('no desktop device: fail-fast message, no task doc written', async () => {
  const fs = fakeSession({ getActiveDesktopDevice: async () => null })
  const tools = buildVaultTools(deps(fs))
  const search = tools.find((t) => t.name === 'vault_wiki_search')!
  const out = await search.execute({ query: 'hiking' })
  assert.match(String(out), /No home computer is connected/)
  assert.equal(fs.created.length, 0)
})

test('successful call writes task with wire tool name and returns JSON result', async () => {
  const fs = fakeSession()
  const tools = buildVaultTools(deps(fs))
  const search = tools.find((t) => t.name === 'vault_wiki_search')!
  const p = search.execute({ query: 'hiking', limit: 5 })
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(fs.created[0].tool, 'wiki_search')          // wire name, not ADK name
  assert.deepEqual(fs.created[0].params, { query: 'hiking', limit: 5 })
  fs.resolveTask('complete', { result: [{ id: 'e1', title: 'Hiking', score: 0.9 }] })
  const out = await p
  assert.match(String(out), /Hiking/)
})

test('timeout: marks task failed and returns timeout message', async () => {
  const fs = fakeSession()
  const failed: unknown[] = []
  fs.failDesktopTaskIfUnresolved = (async (...a: unknown[]) => { failed.push(a); return true }) as never
  const tools = buildVaultTools(deps(fs, { callTimeoutMs: 30 }))
  const out = await tools.find((t) => t.name === 'vault_wiki_search')!.execute({ query: 'x' })
  assert.match(String(out), /didn't respond in time/)
  assert.equal(failed.length, 1)
})

test('per-turn cap is shared across the family', async () => {
  const fs = fakeSession()
  const d = deps(fs, { maxCallsPerTurn: 2, callTimeoutMs: 30 })
  const tools = buildVaultTools(d)
  const search = tools.find((t) => t.name === 'vault_wiki_search')!
  const ontology = tools.find((t) => t.name === 'vault_get_ontology')!
  await search.execute({ query: 'a' })                     // 1 (times out, still counts)
  await ontology.execute({ entityId: 'tier_fact' })        // 2
  const out = await search.execute({ query: 'c' })         // 3 → capped
  assert.match(String(out), /answer with what you already have/)
  assert.equal(fs.created.length, 2)
})

test('tool error from CT surfaces its message', async () => {
  const fs = fakeSession()
  const tools = buildVaultTools(deps(fs))
  const p = tools.find((t) => t.name === 'vault_semantic_search')!.execute({ query: 'x' })
  await new Promise((r) => setTimeout(r, 0))
  fs.resolveTask('failed', { error: { code: 'TOOL_ERROR', message: 'no embeddings for vault' } })
  const out = await p
  assert.match(String(out), /no embeddings for vault/)
})

test('voice billing pause/resume wraps the call', async () => {
  const fs = fakeSession()
  const events: string[] = []
  const d = deps(fs, {
    callTimeoutMs: 30,
    pauseBilling: () => events.push('pause'),
    resumeBilling: () => events.push('resume'),
  })
  await buildVaultTools(d).find((t) => t.name === 'vault_wiki_search')!.execute({ query: 'x' })
  assert.deepEqual(events, ['pause', 'resume'])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build 2>&1 | head -10`
Expected: build error — module missing.

- [ ] **Step 3: Implement**

```ts
// cloud-agent/src/tools/vaultTools.ts
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'

// ADK-facing name → CT wire tool name (spec §7). Wire contract is the CT MCP spec, verbatim.
export const VAULT_WIRE_TOOL = {
  vault_wiki_search: 'wiki_search',
  vault_get_ontology: 'wiki_get_ontology',
  vault_traverse_graph: 'wiki_traverse_graph',
  vault_semantic_search: 'vault_semantic_search',
  vault_related_chunks: 'vault_related_chunks',
} as const

export type VaultAdkName = keyof typeof VAULT_WIRE_TOOL

export interface VaultToolConfig {
  firebaseUid: string
  firestoreSession: FirestoreSession
  callTimeoutMs?: number      // default 12_000 (spec §7: CT 10s budget + Firestore hop headroom)
  maxCallsPerTurn?: number    // default 5, shared across the family
  pauseBilling?: () => void   // voice only
  resumeBilling?: () => void  // voice only
}

export interface VaultToolDeps extends Required<Pick<VaultToolConfig, 'firebaseUid' | 'firestoreSession'>> {
  callTimeoutMs: number
  maxCallsPerTurn: number
  pauseBilling?: () => void
  resumeBilling?: () => void
  callsThisTurn: { count: number }
}

/** Create once per agent turn — the shared per-turn counter lives here. */
export function createVaultToolDeps(config: VaultToolConfig): VaultToolDeps {
  return {
    firebaseUid: config.firebaseUid,
    firestoreSession: config.firestoreSession,
    callTimeoutMs: config.callTimeoutMs ?? 12_000,
    maxCallsPerTurn: config.maxCallsPerTurn ?? 5,
    pauseBilling: config.pauseBilling,
    resumeBilling: config.resumeBilling,
    callsThisTurn: { count: 0 },
  }
}

const NO_DEVICE_MSG = 'No home computer is connected. Open Curated Thoughts on your desktop, or check Settings → Devices.'
const TIMEOUT_MSG = "Your home computer didn't respond in time. Answer with what you already have, or suggest the user check Curated Thoughts is running."
const CAP_MSG = 'Vault call limit reached for this turn — answer with what you already have.'

async function dispatchVaultCall(
  deps: VaultToolDeps,
  adkName: VaultAdkName,
  params: Record<string, unknown>,
): Promise<string> {
  if (deps.callsThisTurn.count >= deps.maxCallsPerTurn) return CAP_MSG
  deps.callsThisTurn.count++

  const fs = deps.firestoreSession
  // 1. Fail fast before any billing pause or doc write (spec §7 step 1) — no credit path here at all.
  const device = await fs.getActiveDesktopDevice(deps.firebaseUid)
  if (!device) return NO_DEVICE_MSG

  deps.pauseBilling?.()
  try {
    const taskId = crypto.randomUUID()
    await fs.createDesktopTask(deps.firebaseUid, taskId, device.deviceId, VAULT_WIRE_TOOL[adkName], params)

    const task = await new Promise<{ status: string; result?: unknown; error?: { message: string } } | null>((resolve) => {
      const timeout = setTimeout(() => {
        unsub()
        void fs.failDesktopTaskIfUnresolved(deps.firebaseUid, taskId, {
          code: 'DESKTOP_TIMEOUT', message: `No result within ${deps.callTimeoutMs}ms`,
        }).catch(() => { /* TTL backstop */ })
        resolve(null)
      }, deps.callTimeoutMs)
      const unsub = fs.watchDesktopTask(deps.firebaseUid, taskId, (t) => {
        if (t.status === 'complete' || t.status === 'failed') {
          clearTimeout(timeout); unsub(); resolve(t)
        }
      })
    })

    if (!task) return TIMEOUT_MSG
    if (task.status === 'failed') {
      return `Vault query failed: ${task.error?.message ?? 'unknown error'}`
    }
    return `Vault result (${VAULT_WIRE_TOOL[adkName]}): ${JSON.stringify(task.result)}`
  } finally {
    deps.resumeBilling?.()
  }
}

// Param schemas per CT tool contracts (2026-06-23-mcp-wiki-graph-tools-design.md §4,
// 2026-05-07-mcp-retrieval-facade-design.md §5).
const wikiSearchSchema = z.object({
  query: z.string().describe('Search text for the vault knowledge graph.'),
  entityIds: z.array(z.string()).optional().describe('Memory tiers to search. Default: ["tier_fact","tier_wisdom"].'),
  limit: z.number().int().min(1).max(25).optional().describe('Max results, default 10.'),
})
const getOntologySchema = z.object({
  entityId: z.string().describe('Memory tier whose ontology manifest to fetch, e.g. "tier_fact".'),
})
const traverseGraphSchema = z.object({
  entityId: z.string().describe('Memory tier to traverse.'),
  sourceId: z.string().describe('Seed entry id — get one from vault_wiki_search first.'),
  maxDepth: z.number().int().min(1).max(3).optional().describe('Hops, default 2.'),
  direction: z.enum(['inbound', 'outbound', 'both']).optional().describe('Edge direction, default both.'),
  edgeTypes: z.array(z.string()).optional().describe('Filter to these edge types.'),
})
const semanticSearchSchema = z.object({
  query: z.string().describe('Semantic search over the vault document chunks.'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results, default 10.'),
})
const relatedChunksSchema = z.object({
  doc_path: z.string().describe('Vault document path to find related chunks for.'),
  limit: z.number().int().min(1).max(10).optional().describe('Max results, default 5.'),
})

const VAULT_PREAMBLE = "Query the user's home computer knowledge vault (Curated Thoughts) — their personal notes and documents, separate from your own character memory. Use when the user asks about their own notes, files, or knowledge base. "

export function buildVaultTools(deps: VaultToolDeps): FunctionTool[] {
  const make = (name: VaultAdkName, description: string, parameters: z.ZodTypeAny) =>
    new FunctionTool({
      name,
      description,
      parameters,
      execute: async (args: unknown) => dispatchVaultCall(deps, name, args as Record<string, unknown>),
    })
  return [
    make('vault_wiki_search', VAULT_PREAMBLE + 'Search wiki facts by meaning; returns entry ids, titles, scores. Start here to get a sourceId for graph traversal.', wikiSearchSchema),
    make('vault_get_ontology', VAULT_PREAMBLE + 'Fetch the node/edge type manifest for a memory tier.', getOntologySchema),
    make('vault_traverse_graph', VAULT_PREAMBLE + 'Walk the knowledge graph outward from a seed entry (from vault_wiki_search).', traverseGraphSchema),
    make('vault_semantic_search', VAULT_PREAMBLE + 'Semantic search over raw document chunks in the vault.', semanticSearchSchema),
    make('vault_related_chunks', VAULT_PREAMBLE + 'Find chunks related to a specific vault document path.', relatedChunksSchema),
  ]
}
```

Note the spec's same-instance shortcut (spec §7 step 4) is intentionally **not** implemented in the tool: on the same instance the pending-tasks listener fires within milliseconds anyway, and one code path is easier to verify. This is a conscious simplification — record it in the PR description; add the shortcut later only if p50 latency data demands it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test --test-reporter spec dist/tools/vaultTools.test.js`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/tools/vaultTools.ts cloud-agent/src/tools/vaultTools.test.ts
git commit -m "feat(cloud-agent): vault_* ADK tool family with shared dispatcher and per-turn cap"
```

---

### Task 7: wiring — `buildAgent`, `buildLiveTools`, upgrade route, `runAgentReal`

**Files:**
- Modify: `cloud-agent/src/services/agentCore.ts` (buildAgent signature, ~line 16)
- Modify: `cloud-agent/src/services/liveToolAdapter.ts` (buildLiveTools, ~line 30)
- Modify: `cloud-agent/src/index.ts` (`runAgentReal` ~line 67; `attachWebSocketRoutes` upgrade block ~line 392)
- Test: `cloud-agent/src/tools/vaultToolsWiring.test.ts` (mirror of `browserActionWiring.test.ts`)

- [ ] **Step 1: Write the failing wiring test**

Read `cloud-agent/src/tools/browserActionWiring.test.ts` first and mirror its structure. The essential assertions:

```ts
// cloud-agent/src/tools/vaultToolsWiring.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { buildAgent } = await import('../services/agentCore.js')
const { buildLiveTools } = await import('../services/liveToolAdapter.js')
const { createVaultToolDeps } = await import('./vaultTools.js')

const fakeDb = {} as never   // copy the db stub approach from browserActionWiring.test.ts
const embed = async () => [0]

function vaultDeps() {
  return createVaultToolDeps({
    firebaseUid: 'u1',
    firestoreSession: { getActiveDesktopDevice: async () => null } as never,
  })
}

test('buildAgent includes vault_* tools only when vault deps provided', () => {
  const withVault = buildAgent(fakeDb, 'u1', 'c1', 'sys', 'UTC', embed, undefined, vaultDeps())
  const names = withVault.tools.map((t: { name: string }) => t.name)
  assert.ok(names.includes('vault_wiki_search'))
  assert.ok(names.includes('vault_related_chunks'))

  const without = buildAgent(fakeDb, 'u1', 'c1', 'sys', 'UTC', embed)
  const namesWithout = without.tools.map((t: { name: string }) => t.name)
  assert.ok(!namesWithout.some((n: string) => n.startsWith('vault_')))
})

test('buildLiveTools includes vault_* tools only when vault deps provided', () => {
  const set = buildLiveTools(fakeDb, 'u1', 'c1', embed, 'UTC', undefined, vaultDeps())
  assert.ok([...set.executors.keys()].includes('vault_wiki_search'))
  const setWithout = buildLiveTools(fakeDb, 'u1', 'c1', embed, 'UTC')
  assert.ok(![...setWithout.executors.keys()].some((n) => n.startsWith('vault_')))
})
```

*(If `browserActionWiring.test.ts` constructs `fakeDb`/`LiveToolSet` access differently, follow its exact fixture pattern — the assertions above are what matters.)*

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build 2>&1 | head -10`
Expected: build error — `buildAgent` takes 7 args.

- [ ] **Step 3: Implement wiring**

3a. `agentCore.ts` — extend `buildAgent`:

```ts
import { buildVaultTools, type VaultToolDeps } from '../tools/vaultTools.js'

export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
  timezone: string,
  embed: (text: string) => Promise<number[]>,
  bridge?: BrowserActionDeps,
  vault?: VaultToolDeps,
): LlmAgent {
  // ...existing tools array unchanged...
  if (bridge) tools.push(browserActionTool(bridge, { trigger: 'text', preBilled: true }))
  if (vault) tools.push(...buildVaultTools(vault))
  // ...rest unchanged
```

3b. `liveToolAdapter.ts` — extend `buildLiveTools` with a trailing `vault?: VaultToolDeps` parameter; after the `if (bridge)` block:

```ts
  if (vault) {
    adkTools.push(...buildVaultTools(vault))
  }
```

(Voice callers construct `vault` with `pauseBilling`/`resumeBilling` from the same billing controls they already hand to `bridge` — find where `wsLiveAgentHandler.ts` builds the `bridge` argument for `buildLiveTools` and construct `createVaultToolDeps({ firebaseUid, firestoreSession: defaultFirestoreSession(), pauseBilling, resumeBilling })` alongside it, passing it as the new argument.)

3c. `index.ts` — `runAgentReal` (~line 67): thread vault deps next to `bridge`:

```ts
  const vault = admin.apps.length ? createVaultToolDeps({
    firebaseUid,
    firestoreSession: defaultFirestoreSession(),
  }) : undefined
  const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embed, bridge, vault)
```

Add import: `import { createVaultToolDeps } from './tools/vaultTools.js'`

3d. `index.ts` — `attachWebSocketRoutes`: add a fourth WSS + upgrade branch after `/agent/browser`:

```ts
  const desktopWss = new WebSocketServer({ noServer: true })
```

```ts
    } else if (pathname === '/agent/desktop') {
      if (!browserBridgeAvailable) {
        socket.destroy()
        return
      }
      desktopWss.handleUpgrade(req, socket, head, (ws) => {
        handleDesktopWsUpgrade(ws, req, {
          firestoreSession: defaultFirestoreSession(),
          desktopBridge,
          resolvePairingToken: (raw: string) =>
            resolvePairingToken(admin.firestore() as unknown as PairingFirestore, raw),
          instanceId: INSTANCE_ID,
        })
      })
    }
```

Add imports: `import { handleDesktopWsUpgrade } from './handlers/wsDesktopAgentHandler.js'` and `import { desktopBridge } from './services/desktopBridge.js'`.

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run typecheck && npm run build && node --test --test-reporter spec dist/tools/vaultToolsWiring.test.js`
Expected: clean typecheck; wiring tests pass. Then run the full suite: `npm test` — all existing tests must still pass (buildAgent/buildLiveTools calls elsewhere use positional args before the new optional trailing params, so no breakage expected; `wsAgentHandler.ts:178` remains valid).

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/services/agentCore.ts cloud-agent/src/services/liveToolAdapter.ts cloud-agent/src/index.ts cloud-agent/src/tools/vaultToolsWiring.test.ts cloud-agent/src/handlers/wsLiveAgentHandler.ts
git commit -m "feat(cloud-agent): wire vault tools into text/voice agents and /agent/desktop upgrade route"
```

---

### Task 8: `firestore.rules`, TTL, docs

**Files:**
- Modify: `firestore.rules` (repo root)
- Create: `docs/desktop-vault-bridge.md`
- Modify: `README.md` (docs index — one line under "AI & Chat")

- [ ] **Step 1: firestore.rules**

Inside `match /databases/{database}/documents`, after the devices block:

```text
    // Desktop vault bridge (docs/desktop-vault-bridge.md).
    // desktopTasks: Admin SDK only — tool calls write, socket-owning instance reads.
    match /users/{uid}/desktopTasks/{taskId} {
      allow read, write: if false;
    }

    // desktopPairings/{tokenHash} (top-level) is intentionally NOT matched here:
    // default-deny already blocks clients; never add a client rule for it.
```

- [ ] **Step 2: Write `docs/desktop-vault-bridge.md`**

Content requirements (write it, don't stub it): overview paragraph (mirror of `docs/browser-bridge.md` style), the §2 routing diagram from the spec, pairing flow (pair → paste token in Curated Thoughts → revoke), frame table, `vault_*` → wire-name table, error codes, billing statement (no flat spend, voice timer paused), failure-mode table from spec §8a, and two ops notes: (1) **Firestore TTL policy must be enabled on `desktopTasks.expiresAt`** — `gcloud firestore fields ttls update expiresAt --collection-group=desktopTasks --enable-ttl`, (2) monitoring: watch `DESKTOP_TIMEOUT` frequency and TTL-reaped doc counts. Link back to the spec and to the CT counterpart spec path.

- [ ] **Step 3: README docs index**

Add under the AI & Chat section of the root `README.md` docs list:

```markdown
- **[Desktop Vault Bridge](docs/desktop-vault-bridge.md)** — `/agent/desktop` persistent WebSocket, pairing tokens, `vault_*` tools querying the Curated Thoughts home vault.
```

- [ ] **Step 4: Commit**

```bash
git add firestore.rules docs/desktop-vault-bridge.md README.md
git commit -m "docs: desktop vault bridge operator doc, firestore rules deny, TTL note"
```

---

### Task 9: full verification + integration smoke script

**Files:**
- Create: `cloud-agent/scripts/desktopBridgeSmoke.ts` (manual, not CI)

- [ ] **Step 1: Full local verification**

Run from `cloud-agent/`: `npm run typecheck && npm test`
Expected: zero failures across the whole suite. Fix anything that broke before proceeding.

- [ ] **Step 2: Write the smoke script (mock desktop client)**

```ts
// cloud-agent/scripts/desktopBridgeSmoke.ts
// Manual smoke test against the local Docker stack (docker-compose.local.yml).
// Usage:
//   1. docker compose -f ../docker-compose.local.yml up -d
//   2. Obtain a pairing token: POST /agent/desktop/pair with a real auth token, or
//      insert a desktopPairings doc + device doc directly via the emulator/console.
//   3. PAIRING_TOKEN=<token> CLOUD_AGENT_URL=ws://localhost:8080 npx tsx scripts/desktopBridgeSmoke.ts
// Speaks the auth/task frames like Curated Thoughts' CloudBridgeClient and answers
// every task with a canned wiki_search result.
import WebSocket from 'ws'

const url = `${process.env.CLOUD_AGENT_URL ?? 'ws://localhost:8080'}/agent/desktop`
const token = process.env.PAIRING_TOKEN
if (!token) { console.error('PAIRING_TOKEN required'); process.exit(1) }

const ws = new WebSocket(url)
ws.on('open', () => {
  console.log('connected, sending auth')
  ws.send(JSON.stringify({ type: 'auth', pairingToken: token }))
  setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 20_000)
})
ws.on('message', (data) => {
  const frame = JSON.parse(data.toString()) as { type: string; taskId?: string; tool?: string; params?: unknown }
  console.log('<<', frame)
  if (frame.type === 'task') {
    ws.send(JSON.stringify({
      type: 'task_result',
      taskId: frame.taskId,
      result: [{ id: 'entry-1', entity_id: 'tier_fact', title: `canned result for ${frame.tool}`, score: 0.99 }],
    }))
  }
})
ws.on('close', (code, reason) => console.log('closed', code, reason.toString()))
ws.on('error', (err) => console.error('error', err))
```

- [ ] **Step 3: Run the smoke end-to-end**

With the local stack up and the mock client connected, send a chat turn through `POST /agent/run` (same flow as `docs/edge-agent.md` local dev) asking "search my vault for hiking notes". Expected: the reply references the canned result; `desktopTasks` doc in the emulator shows `status: 'complete'`. Record observed dispatch→result latency in the PR description (spec §7 step 5 asks for this baseline).

- [ ] **Step 4: Commit**

```bash
git add cloud-agent/scripts/desktopBridgeSmoke.ts
git commit -m "test(cloud-agent): manual smoke client for desktop vault bridge"
```

---

## Deferred (tracked, not in this plan)

- Mobile app Settings → Devices UI calling `/agent/desktop/pair` + `/agent/desktop/revoke` (client repo work; API shape fixed by Task 4).
- Same-instance dispatch shortcut (measure first — Task 6 note).
- Firestore TTL policy activation is an ops step (Task 8 doc has the gcloud command) — run it in each environment when deploying.
- CT-side `CloudBridgeClient` — separate repo, already planned.

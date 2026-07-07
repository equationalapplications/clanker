// cloud-agent/src/services/firestoreSession.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

// Minimal in-memory Firestore double. Path string → doc data.
function makeFakeDb(calls?: Array<{ path: string; data: Record<string, unknown>; opts?: unknown }>) {
  const store = new Map<string, Record<string, unknown>>()
  function docRef(path: string) {
    return {
      path,
      async create(data: Record<string, unknown>) {
        if (store.has(path)) {
          const err = new Error('Already exists') as Error & { code: number }
          err.code = 6
          throw err
        }
        calls?.push({ path, data })
        store.set(path, data)
      },
      async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
        calls?.push({ path, data, opts })
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
    collection: (path: string) => {
      const coll = {
        where() { return coll },
        orderBy() { return coll },
        limit(n: number) {
          coll._limit = n
          return coll
        },
        _limit: 50,
        async get() {
          if (path.endsWith('/tasks')) {
            const docs = [...store.entries()]
              .filter(([k]) => k.startsWith(path + '/'))
              .slice(0, 1)
              .map(([k, v]) => ({ id: k.split('/').pop()!, data: () => v }))
            return { empty: docs.length === 0, docs }
          }
          const docs = [...store.entries()]
            .filter(([k, v]) => k.startsWith(path + '/') && v.active === true)
            .sort((a, b) => Number(b[1].lastSeenAt ?? 0) - Number(a[1].lastSeenAt ?? 0))
            .slice(0, coll._limit)
            .map(([k, v]) => ({ id: k.split('/').pop()!, data: () => v }))
          return { empty: docs.length === 0, docs }
        },
      }
      return coll
    },
    batch() {
      const ops: Array<{ op: 'update' | 'set'; path: string; data: Record<string, unknown> }> = []
      return {
        update(path: string, data: Record<string, unknown>) { ops.push({ op: 'update', path, data }) },
        set(path: string, data: Record<string, unknown>) {
          calls?.push({ path, data })
          ops.push({ op: 'set', path, data })
        },
        async commit() {
          for (const { op, path, data } of ops) {
            store.set(path, op === 'set' ? data : { ...(store.get(path) ?? {}), ...data })
          }
        },
      }
    },
  }
  return { db, store }
}

const { createFirestoreSession } = await import('./firestoreSession.js')

test('reserveSchedulerRun returns duplicate for same runKey', async () => {
  const { db } = makeFakeDb()
  const fs = createFirestoreSession(db as never)
  const ids = { sessionId: 's1', taskId: 't1' }
  assert.equal(await fs.reserveSchedulerRun('u1', 'run-a', ids), 'reserved')
  assert.equal(await fs.reserveSchedulerRun('u1', 'run-a', { sessionId: 's2', taskId: 't2' }), 'duplicate')
  const existing = await fs.getSchedulerRun('u1', 'run-a')
  assert.deepEqual(existing, ids)
})

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

test('getActiveDevice treats missing isPaused as active', async () => {
  const { db, store } = makeFakeDb()
  store.set('users/u1/devices/d1', { fcmToken: 'tok', deviceName: 'Mac', active: true, lastSeenAt: 5 })
  const fs = createFirestoreSession(db as never)
  const d = await fs.getActiveDevice('u1')
  assert.equal(d?.deviceId, 'd1')
  assert.equal(d?.fcmToken, 'tok')
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

test('getActiveDevice finds older unpaused device when recent docs are paused', async () => {
  const { db, store } = makeFakeDb()
  for (let i = 0; i < 11; i++) {
    store.set(`users/u1/devices/p${i}`, {
      fcmToken: `paused-${i}`,
      deviceName: 'Paused',
      active: true,
      isPaused: true,
      lastSeenAt: 100 + i,
    })
  }
  store.set('users/u1/devices/eligible', {
    fcmToken: 'eligible',
    deviceName: 'Work',
    active: true,
    isPaused: false,
    lastSeenAt: 1,
  })
  const fs = createFirestoreSession(db as never)
  const d = await fs.getActiveDevice('u1')
  assert.equal(d?.fcmToken, 'eligible')
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

test('getFirstTask returns the first task doc', async () => {
  const { db } = makeFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.writeTask('u1', 's1', 't1', {
    version: '1', taskId: 't1', sessionId: 's1', requiresAuth: false,
    actionSummary: 'x', action: { type: 'read_dom', selector: 'body' },
  })
  const t = await fs.getFirstTask('u1', 's1')
  assert.equal(t?.intent.taskId, 't1')
})

test('haltForAuth writes task awaiting_auth + session pending_auth + auth doc pending', async () => {
  const calls: Array<{ path: string; data: Record<string, unknown>; opts?: unknown }> = []
  const { db } = makeFakeDb(calls)
  const fs = createFirestoreSession(db as never)

  await fs.createSession('uid1', 'sid1', { status: 'routing', trigger: 'voice', voiceInstanceId: 'i1' })
  await fs.writeTask('uid1', 'sid1', 'tid1', {
    version: '1', taskId: 'tid1', sessionId: 'sid1', requiresAuth: true,
    actionSummary: 'Submit payment', action: { type: 'click', selector: '#buy', tier: 'stateful' },
  })
  await fs.haltForAuth('uid1', 'sid1', 'tid1', 2, 'Submit payment')

  const authCall = calls.find((c) => c.path === 'users/uid1/sessions/sid1/auth/tid1')

  const task = await fs.getTask('uid1', 'sid1', 'tid1')
  const session = await fs.getSession('uid1', 'sid1')
  assert.equal(task.status, 'awaiting_auth')
  assert.equal(task.haltedStepIndex, 2)
  assert.equal(session.status, 'pending_auth')
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
    collection: (_path: string) => ({ where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) }) }),
  } as unknown as import('./firestoreSession.js').FirestoreLike

  const fs = createFirestoreSession(db)
  const received: unknown[] = []
  const unsub = fs.watchAuth('uid1', 'sid1', 'tid1', (auth) => received.push(auth))

  snapCb!({ exists: true, data: () => ({ status: 'approved', approvalToken: 'tok', approvedAt: null, actionSummary: 'x', expiresAt: 0 }) })
  assert.equal(received.length, 1)
  unsub()
})

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
          const rows = [...docs.entries()]
            .filter(([p]) => p.startsWith(`${colPath}/`) && p.split('/').length === colPath.split('/').length + 1)
            .filter(([, d]) => w.filters.every(([f, , v]) => (d as Record<string, unknown>)[f] === v))
            .map(([p, d]) => ({ id: p.split('/').pop()!, data: () => d }))
          cb(rows)
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
  await fs.markDesktopDeviceOffline('u1', 'desk1', 'instance-A')
  assert.equal(db._docs.get('users/u1/devices/desk1')?.online, false)
  assert.equal(db._docs.get('users/u1/devices/desk1')?.connectedInstanceId, null)
})

test('watchPendingDesktopTasks emits existing pending tasks on subscribe', async () => {
  const db = desktopFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.createDesktopTask('u1', 'queued', 'desk1', 'wiki_search', { query: 'pre-existing' })
  const seen: string[] = []
  const unsub = fs.watchPendingDesktopTasks('u1', 'desk1', (tasks) => { for (const t of tasks) seen.push(t.taskId) })
  assert.deepEqual(seen, ['queued'])
  unsub()
})

test('markDesktopDeviceOffline ignores stale instance disconnects', async () => {
  const db = desktopFakeDb()
  db._docs.set('users/u1/devices/desk1', {
    active: true, type: 'desktop', online: true, connectedInstanceId: 'instance-B', deviceName: 'Mac mini',
  })
  const fs = createFirestoreSession(db as never)
  await fs.markDesktopDeviceOffline('u1', 'desk1', 'instance-A')
  assert.equal(db._docs.get('users/u1/devices/desk1')?.online, true)
  assert.equal(db._docs.get('users/u1/devices/desk1')?.connectedInstanceId, 'instance-B')
})

test('writeDesktopTaskResult skips terminal overwrite races', async () => {
  const db = desktopFakeDb()
  const fs = createFirestoreSession(db as never)
  await fs.createDesktopTask('u1', 't1', 'desk1', 'wiki_search', {})
  await fs.writeDesktopTaskResult('u1', 't1', { status: 'complete', result: { ok: true } })
  assert.equal(await fs.writeDesktopTaskResult('u1', 't1', { status: 'failed', error: { code: 'DESKTOP_TIMEOUT', message: 'late' } }), false)
  assert.equal((db._docs.get('users/u1/desktopTasks/t1') as { status: string }).status, 'complete')
})

test('getDesktopDeviceDoc reports existence and pause state', async () => {
  const db = desktopFakeDb()
  db._docs.set('users/u1/devices/desk1', { type: 'desktop', isPaused: true })
  const fs = createFirestoreSession(db as never)
  assert.deepEqual(await fs.getDesktopDeviceDoc('u1', 'desk1'), { exists: true, isPaused: true })
  assert.deepEqual(await fs.getDesktopDeviceDoc('u1', 'nope'), { exists: false, isPaused: false })
})

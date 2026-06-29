// cloud-agent/src/services/firestoreSession.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

// Minimal in-memory Firestore double. Path string → doc data.
function makeFakeDb(calls?: Array<{ path: string; data: Record<string, unknown>; opts?: unknown }>) {
  const store = new Map<string, Record<string, unknown>>()
  function docRef(path: string) {
    return {
      path,
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
        limit() { return coll },
        async get() {
          if (path.endsWith('/tasks')) {
            const docs = [...store.entries()]
              .filter(([k]) => k.startsWith(path + '/'))
              .slice(0, 1)
              .map(([k, v]) => ({ id: k.split('/').pop()!, data: () => v }))
            return { empty: docs.length === 0, docs }
          }
          const docs = [...store.entries()]
            .filter(([k, v]) => k.startsWith(path + '/') && v.active === true && (v as { isPaused?: boolean }).isPaused !== true)
            .sort((a, b) => Number(b[1].lastSeenAt ?? 0) - Number(a[1].lastSeenAt ?? 0))
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

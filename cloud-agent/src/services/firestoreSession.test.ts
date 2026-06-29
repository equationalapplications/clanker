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
            .filter(([k, v]) => k.startsWith(path + '/') && v.active === true && v.isPaused === false)
            .sort((a, b) => Number(b[1].lastSeenAt ?? 0) - Number(a[1].lastSeenAt ?? 0))
            .map(([k, v]) => ({ id: k.split('/').pop()!, data: () => v }))
          return { empty: docs.length === 0, docs }
        },
      }
      return coll
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

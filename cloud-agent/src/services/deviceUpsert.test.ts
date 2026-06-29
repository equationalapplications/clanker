// cloud-agent/src/services/deviceUpsert.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { upsertDeviceRecord } = await import('./deviceUpsert.js')

function makeStore() {
  const store = new Map<string, Record<string, unknown>>()
  const fs = {
    doc(path: string) {
      return {
        async get() {
          return { exists: store.has(path) }
        },
        async set(data: Record<string, unknown>, opts?: { merge?: boolean }) {
          store.set(path, opts?.merge ? { ...(store.get(path) ?? {}), ...data } : data)
        },
      }
    },
  }
  return { fs, store }
}

test('upsertDeviceRecord preserves isPaused when omitted on re-registration', async () => {
  const { fs, store } = makeStore()
  const path = 'users/u1/devices/d1'
  store.set(path, {
    fcmToken: 'old',
    deviceName: 'Mac',
    active: true,
    isPaused: true,
    registeredAt: 1,
    lastSeenAt: 1,
  })

  await upsertDeviceRecord(fs, 'u1', {
    fcmToken: 'new',
    deviceId: 'd1',
    deviceName: 'Mac',
  })

  const doc = store.get(path)!
  assert.equal(doc.fcmToken, 'new')
  assert.equal(doc.isPaused, true)
  assert.equal(doc.registeredAt, 1)
})

test('upsertDeviceRecord sets registeredAt only on first insert', async () => {
  const { fs, store } = makeStore()
  const path = 'users/u1/devices/d1'

  await upsertDeviceRecord(fs, 'u1', {
    fcmToken: 'tok',
    deviceId: 'd1',
    deviceName: 'Mac',
    isPaused: false,
  })
  const firstRegisteredAt = store.get(path)!.registeredAt
  assert.notEqual(firstRegisteredAt, undefined)

  await upsertDeviceRecord(fs, 'u1', {
    fcmToken: 'tok2',
    deviceId: 'd1',
    deviceName: 'Mac',
  })
  assert.equal(store.get(path)!.registeredAt, firstRegisteredAt)
})

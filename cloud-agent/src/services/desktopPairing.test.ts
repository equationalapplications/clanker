// cloud-agent/src/services/desktopPairing.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const { generatePairingToken, pairDesktopDevice, resolvePairingToken, revokeDesktopDevice } =
  await import('./desktopPairing.js')

function fakeDb() {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    docs,
    doc(path: string) {
      return {
        set: async (data: Record<string, unknown>) => {
          docs.set(path, data)
        },
        get: async () => ({ exists: docs.has(path), data: () => docs.get(path) }),
        update: async (data: Record<string, unknown>) => {
          docs.set(path, { ...(docs.get(path) ?? {}), ...data })
        },
        delete: async () => {
          docs.delete(path)
        },
      }
    },
    collection(path: string) {
      return {
        where(field: string, _op: string, value: unknown) {
          const filters: Array<[string, unknown]> = [[field, value]]
          const query = {
            where(nextField: string, _nextOp: string, nextValue: unknown) {
              filters.push([nextField, nextValue])
              return query
            },
            async get() {
              const matching = [...docs.entries()]
                .filter(
                  ([p, d]) =>
                    p.startsWith(`${path}/`) &&
                    filters.every(([f, v]) => (d as Record<string, unknown>)[f] === v),
                )
                .map(([p]) => ({
                  id: p.split('/').pop()!,
                  ref: {
                    delete: async () => {
                      docs.delete(p)
                    },
                  },
                }))
              return { docs: matching }
            },
          }
          return query
        },
      }
    },
  }
}

test('generatePairingToken: 256-bit base64url token, sha256 hex hash', () => {
  const { token, tokenHash } = generatePairingToken()
  assert.ok(token.length >= 43)
  assert.match(token, /^[A-Za-z0-9_-]+$/)
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

test('revokeDesktopDevice scoped by uid: revoking u1 does not affect u2 with same deviceId', async () => {
  const db = fakeDb()
  const { pairingToken: t1, deviceId: d1 } = await pairDesktopDevice(db as never, 'u1', 'Mac mini')
  const { pairingToken: t2 } = await pairDesktopDevice(db as never, 'u2', 'Mac mini')
  const u2DeviceId = [...db.docs.entries()]
    .find(
      ([p, d]) => p.startsWith('users/u2/devices/') && (d as any).deviceName === 'Mac mini',
    )?.[0]
    .split('/')[3]!
  await revokeDesktopDevice(db as never, 'u1', d1)
  assert.equal(db.docs.has(`users/u1/devices/${d1}`), false, 'u1 device doc deleted')
  assert.equal(await resolvePairingToken(db as never, t1), null, 'u1 token no longer resolves')
  assert.equal(db.docs.has(`users/u2/devices/${u2DeviceId}`), true, 'u2 device doc still exists')
  assert.deepEqual(
    await resolvePairingToken(db as never, t2),
    { uid: 'u2', deviceId: u2DeviceId },
    'u2 token still resolves',
  )
})

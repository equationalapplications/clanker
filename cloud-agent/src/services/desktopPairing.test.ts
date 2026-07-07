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
    collection(path: string) {
      return {
        where(field: string, _op: string, value: unknown) {
          return {
            async get() {
              const matching = [...docs.entries()]
                .filter(([p, d]) => p.startsWith(`${path}/`) && (d as Record<string, unknown>)[field] === value)
                .map(([p]) => ({
                  id: p.split('/').pop()!,
                  ref: {
                    delete: async () => { docs.delete(p) },
                  },
                }))
              return { docs: matching }
            },
          }
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

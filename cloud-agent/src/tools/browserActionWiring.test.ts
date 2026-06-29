// cloud-agent/src/tools/browserActionWiring.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { buildLiveTools } = await import('../services/liveToolAdapter.js')

test('buildLiveTools registers browser_action when bridge deps provided', () => {
  const fakeDb = {} as never
  const embed = async () => [0]
  const { declarations } = buildLiveTools(fakeDb, 'u1', 'c1', embed, 'UTC', {
    firestoreSession: {} as never, fcmDispatcher: {} as never, creditService: {} as never,
    instanceId: 'i1', firebaseUid: 'fb-u1', userId: 'u1',
  } as never)
  assert.ok(declarations.some((d) => d.name === 'browser_action'))
})

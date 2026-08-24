// cloud-agent/src/tools/vaultToolsWiring.test.ts
import test from 'node:test'
import assert from 'node:assert/strict'

const { buildAgent } = await import('../services/agentCore.js')
const { buildLiveTools } = await import('../services/liveToolAdapter.js')
const { createVaultToolDeps } = await import('./vaultTools.js')

const fakeDb = {} as never
const embed = async () => [0]

function vaultDeps() {
  return createVaultToolDeps({
    firebaseUid: 'u1',
    firestoreSession: { getActiveDesktopDevice: async () => null } as never,
  })
}

test('buildAgent includes vault_* tools only when vault deps provided', () => {
  const { agent: withVaultAgent } = buildAgent(
    fakeDb,
    'u1',
    'c1',
    'sys',
    'UTC',
    embed,
    undefined,
    vaultDeps(),
  )
  const names = withVaultAgent.tools.map((t) => (t as { name: string }).name)
  assert.ok(names.includes('vault_wiki_search'))
  assert.ok(names.includes('vault_related_chunks'))

  const { agent: withoutAgent } = buildAgent(fakeDb, 'u1', 'c1', 'sys', 'UTC', embed)
  const namesWithout = withoutAgent.tools.map((t) => (t as { name: string }).name)
  assert.ok(!namesWithout.some((n: string) => n.startsWith('vault_')))
})

test('buildLiveTools includes vault_* tools only when vault deps provided', () => {
  const set = buildLiveTools(fakeDb, 'u1', 'c1', embed, 'UTC', undefined, vaultDeps())
  assert.ok([...set.executors.keys()].includes('vault_wiki_search'))
  const setWithout = buildLiveTools(fakeDb, 'u1', 'c1', embed, 'UTC')
  assert.ok(![...setWithout.executors.keys()].some((n) => n.startsWith('vault_')))
})

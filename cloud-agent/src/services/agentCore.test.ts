import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'
import { buildAgent, assembleSystemInstruction } from './agentCore.js'

const mockDb = {} as unknown as DrizzleClient
const mockEmbed = async (_text: string): Promise<number[]> => new Array(1536).fill(0)

// The wiring probe drives the real generate_image execute(), whose default cs
// would be createCreditService(mockDb) — that rejects with a TypeError out of
// db.transaction rather than INSUFFICIENT_CREDITS, escaping execute. The stub
// spends nothing so the probe exercises the wiring, not the ledger. The fake
// imageGenerator below keeps the probe off the network BY CONSTRUCTION:
// without it execute would reach defaultVertexImageGenerator and make a real
// ~8 s billable Vertex call whenever live GCP creds are present.
const stubCs = {
  spendCredit: async () => [],
  refundCredit: async () => {},
}

const stubGeneratedImage = { imageBase64: 'QUJD', mimeType: 'image/png' }

test('buildAgent returns an agent with expected name and instruction', () => {
  const { agent } = buildAgent(mockDb, 'user-123', 'char-456', 'Test instruction', 'UTC', mockEmbed)
  assert.equal(agent.name, 'clanker-cloud-agent')
  assert.equal(agent.instruction, 'Test instruction')
})

test('assembleSystemInstruction includes character name and context', () => {
  const instruction = assembleSystemInstruction(
    {
      name: 'Alice',
      appearance: 'Tall',
      traits: 'Friendly',
      emotions: 'Happy',
      context: 'Loves art',
    },
    'User likes painting',
  )
  assert.ok(instruction.includes('You are Alice'))
  assert.ok(instruction.includes('Appearance: Tall'))
  assert.ok(instruction.includes('User likes painting'))
})

test('assembleSystemInstruction includes recent chat history when provided', () => {
  const instruction = assembleSystemInstruction(
    {
      name: 'Alice',
      appearance: null,
      traits: null,
      emotions: null,
      context: null,
    },
    '',
    'User: What happened in the news?\nAlice: A major storm is approaching.',
  )
  assert.ok(instruction.includes('Recent chat history'))
  assert.ok(instruction.includes('major storm is approaching'))
})

test('buildAgent wires generate_image and returns a fresh run-scoped collector', () => {
  const buildOpts = { creditService: stubCs, imageGenerator: async () => stubGeneratedImage }
  const first = buildAgent(
    mockDb,
    'user-123',
    'char-456',
    'Test instruction',
    'UTC',
    mockEmbed,
    undefined,
    undefined,
    buildOpts,
  )
  const second = buildAgent(
    mockDb,
    'user-123',
    'char-456',
    'Test instruction',
    'UTC',
    mockEmbed,
    undefined,
    undefined,
    buildOpts,
  )

  const names = first.agent.tools.map((t) => (t as { name: string }).name)
  assert.ok(names.includes('generate_image'))

  assert.deepEqual(first.imageCollector, [])
  assert.notEqual(first.imageCollector, second.imageCollector, 'collector must be per-run')

  // The tool closes over THIS run's collector: driving it — against the
  // injected fake generator, so no network is reachable from this probe —
  // pushes there, not elsewhere.
  const execute = (
    first.agent.tools.find((t) => (t as { name: string }).name === 'generate_image') as unknown as {
      execute: (args: unknown) => Promise<string>
    }
  ).execute
  return execute({ prompt: 'probe' }).then(() => {
    assert.deepEqual(first.imageCollector, [stubGeneratedImage])
    assert.deepEqual(second.imageCollector, [])
  })
})

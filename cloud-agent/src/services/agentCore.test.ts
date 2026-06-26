import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'
import { buildAgent, assembleSystemInstruction } from './agentCore.js'

const mockDb = {} as unknown as DrizzleClient
const mockEmbed = async (_text: string): Promise<number[]> => new Array(1536).fill(0)

test('buildAgent returns an agent with expected name and instruction', () => {
  const agent = buildAgent(
    mockDb,
    'user-123',
    'char-456',
    'Test instruction',
    'UTC',
    mockEmbed,
  )
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

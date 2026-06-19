import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from './db/client.js'

const { runAgentReal } = await import('./index.js')

const mockDb = {} as unknown as DrizzleClient
const mockEmbed = async (_text: string): Promise<number[]> => [0.1, 0.2]

test(
  'runAgentReal: mixes GOOGLE_SEARCH and a custom FunctionTool in one live turn',
  { skip: !process.env.RUN_LIVE_TESTS && 'set RUN_LIVE_TESTS=1 to run against live Vertex AI', timeout: 30_000 },
  async () => {
    const { reply, toolCalls } = await runAgentReal({
      db: mockDb,
      userId: 'live-test-user',
      characterId: 'live-test-character',
      systemInstruction: 'You are a helpful assistant.',
      message: 'What time is it right now, and what is the current weather in New York?',
      history: [],
      timezone: 'America/New_York',
      embed: mockEmbed,
    })

    assert.ok(toolCalls.includes('get_current_time'), 'expected get_current_time to be called')
    assert.ok(toolCalls.includes('google_search'), 'expected google_search to be called')
    assert.ok(reply.trim().length > 0, 'expected a non-empty final reply')
  },
)

import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from './db/client.js'

const { runAgentReal } = await import('./index.js')

// Mock DB is an empty object; the test prompt is carefully designed to only
// invoke get_current_time and google_search, avoiding wiki/tasks/documents/reminders
// that would require actual DB operations. Future prompt changes that trigger DB tools
// may cause unpredictable failures.
const mockDb = {} as unknown as DrizzleClient
const mockEmbed = async (_text: string): Promise<number[]> => [0.1, 0.2]
const liveTestsEnabled = process.env.RUN_LIVE_TESTS === '1'

test(
  'runAgentReal: mixes GOOGLE_SEARCH and a custom FunctionTool in one live turn',
  { skip: !liveTestsEnabled && 'set RUN_LIVE_TESTS=1 to run against live Vertex AI', timeout: 30_000 },
  async () => {
    const { reply, toolCalls } = await runAgentReal({
      db: mockDb,
      userId: 'live-test-user',
      firebaseUid: 'live-test-firebase-uid',
      characterId: 'live-test-character',
      systemInstruction:
        'You are a helpful assistant. You must call tools before answering when the user asks for live or current information. ' +
        'Only use get_current_time for the current time and google_search for current weather or other real-time facts. ' +
        'Do not use wiki, task, document, or reminder tools. ' +
        'Do not answer from memory or prior knowledge; invoke the required tools first, then summarize the results.',
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

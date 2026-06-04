import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from '../db/client.js'

const { setReminderTool } = await import('./reminders.js')

test('setReminderTool: name is set_reminder', () => {
  const tool = setReminderTool({} as DrizzleClient, 'u', 'c')
  assert.equal(tool.name, 'set_reminder')
})

test('setReminderTool: returns acknowledgement', async () => {
  const tool = setReminderTool({} as DrizzleClient, 'u', 'c')
  const result = await (tool as unknown as { execute: (a: unknown) => Promise<string> })
    .execute({ message: 'Call dentist', remind_at: '2026-07-01T09:00:00Z' })
  assert.ok(typeof result === 'string')
})
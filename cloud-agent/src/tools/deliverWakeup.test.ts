import assert from 'node:assert/strict'
import test from 'node:test'
import { createDeliverWakeupTool, type WakeupSink } from './deliverWakeup.js'

async function call(tool: ReturnType<typeof createDeliverWakeupTool>, args: unknown) {
  return (tool as unknown as { execute: (a: unknown) => Promise<string> }).execute(args)
}

test('records the mode and message the model chose', async () => {
  const sink: WakeupSink = { mode: null, message: null }
  const out = await call(createDeliverWakeupTool(sink), {
    mode: 'notify',
    message: 'How did the interview go?',
  })
  assert.equal(sink.mode, 'notify')
  assert.equal(sink.message, 'How did the interview go?')
  assert.match(out, /recorded/i)
})

test('rejects an unknown mode without mutating the sink', async () => {
  const sink: WakeupSink = { mode: null, message: null }
  const out = await call(createDeliverWakeupTool(sink), { mode: 'shout', message: 'hi' })
  assert.equal(sink.mode, null)
  assert.match(out, /mode must be/i)
})

test('accepts silent with no message', async () => {
  const sink: WakeupSink = { mode: null, message: null }
  await call(createDeliverWakeupTool(sink), { mode: 'silent' })
  assert.equal(sink.mode, 'silent')
  assert.equal(sink.message, null)
})

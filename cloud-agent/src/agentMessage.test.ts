import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNewMessage } from './agentMessage.js'

test('text-only turn produces a single text part', () => {
  assert.deepEqual(buildNewMessage('hello'), {
    role: 'user',
    parts: [{ text: 'hello' }],
  })
})

test('attachments precede the text so the question reads as being about the image', () => {
  const result = buildNewMessage('what is this?', [{ mimeType: 'image/webp', data: 'AAAA' }])
  assert.deepEqual(result, {
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'image/webp', data: 'AAAA' } },
      { text: 'what is this?' },
    ],
  })
})

test('captionless photo omits the text part entirely', () => {
  const result = buildNewMessage('', [{ mimeType: 'image/jpeg', data: 'BBBB' }])
  assert.deepEqual(result, {
    role: 'user',
    parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }],
  })
})

test('empty everything still yields one part — never a partless Content', () => {
  assert.deepEqual(buildNewMessage(''), { role: 'user', parts: [{ text: '' }] })
})

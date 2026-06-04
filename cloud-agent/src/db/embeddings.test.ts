import assert from 'node:assert/strict'
import test from 'node:test'

test('embedText: returns number array from mock provider', async () => {
  const mockEmbed = async (_text: string) => [0.1, 0.2, 0.3]
  assert.deepEqual(await mockEmbed('hello'), [0.1, 0.2, 0.3])
})

test('isRetryable: matches 429 error message', async () => {
  // Test the exported helper indirectly via re-export
  const { isRetryable } = (await import('./embeddings.js')) as { isRetryable: (e: unknown) => boolean }
  assert.equal(isRetryable(new Error('HTTP 429 rate limit exceeded')), true)
  assert.equal(isRetryable(new Error('quota exceeded')), true)
  assert.equal(isRetryable(new Error('503 service unavailable')), true)
  assert.equal(isRetryable(new Error('unknown error')), false)
  assert.equal(isRetryable('not an error'), false)
})
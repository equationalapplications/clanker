import assert from 'node:assert/strict'
import test from 'node:test'
import type { CreditService, CreditSpendAllocation } from '../services/creditService.js'
import { generateImage, type GeneratedImage } from './generateImage.js'

type Execute = (args: unknown) => Promise<string>

/** Casts the FunctionTool down to its bare execute so tests drive it directly. */
function executeOf(tool: unknown): Execute {
  return (tool as { execute: Execute }).execute
}

interface FakeCsCalls {
  order: string[]
  spends: { amount: number; reason: string }[]
  refunds: CreditSpendAllocation[][]
}

function makeFakeCs(opts?: { spendError?: Error; refundRejects?: boolean }): {
  cs: Pick<CreditService, 'spendCredit' | 'refundCredit'>
  calls: FakeCsCalls
} {
  const calls: FakeCsCalls = { order: [], spends: [], refunds: [] }
  return {
    calls,
    cs: {
      spendCredit: async (_userId: string, amount: number, reason: string) => {
        calls.order.push('spend')
        if (opts?.spendError) throw opts.spendError
        calls.spends.push({ amount, reason })
        return [{ transactionId: 'tx-1', amount }]
      },
      refundCredit: async (_userId: string, allocations: CreditSpendAllocation[]) => {
        calls.order.push('refund')
        if (opts?.refundRejects) throw new Error('REFUND_BOOM')
        calls.refunds.push(allocations)
      },
    },
  }
}

function makeFakeVertex(opts?: {
  image?: { imageBase64: string; mimeType: string }
  error?: Error
}) {
  const receivedPrompts: string[] = []
  let invocations = 0
  return {
    receivedPrompts,
    get invocations() {
      return invocations
    },
    generate: async (prompt: string) => {
      invocations += 1
      receivedPrompts.push(prompt)
      if (opts?.error) throw opts.error
      return opts?.image ?? { imageBase64: 'QUJD', mimeType: 'image/png' }
    },
  }
}

test('tool exposes name generate_image and a prompt parameter', () => {
  const { cs } = makeFakeCs()
  const vertex = makeFakeVertex()
  const tool = generateImage('user-1', cs, [], vertex.generate)
  assert.equal((tool as unknown as { name: string }).name, 'generate_image')
})

test('spends credits BEFORE calling the image model', async () => {
  const { cs, calls } = makeFakeCs()
  const vertex = makeFakeVertex()
  await executeOf(generateImage('user-1', cs, [], vertex.generate))({
    prompt: 'a bar chart of monthly revenue',
  })
  assert.deepEqual(calls.order, ['spend'])
  assert.equal(calls.spends[0]?.amount, 200)
  assert.equal(calls.spends[0]?.reason, 'image_generate')
  assert.equal(vertex.invocations, 1)
})

test('success pushes onto the collector and returns ok JSON without base64', async () => {
  const { cs } = makeFakeCs()
  const vertex = makeFakeVertex({ image: { imageBase64: 'QUJD', mimeType: 'image/PNG' } })
  const collector: GeneratedImage[] = []
  const out = await executeOf(generateImage('user-1', cs, collector, vertex.generate))({
    prompt: 'a diagram',
  })
  assert.deepEqual(JSON.parse(out), { status: 'ok' })
  assert.equal(out.includes('QUJD'), false, 'base64 must never be returned to the model')
  assert.deepEqual(collector, [{ imageBase64: 'QUJD', mimeType: 'image/png' }])
})

test('INSUFFICIENT_CREDITS relays a sentence, generates nothing, refunds nothing', async () => {
  const { cs, calls } = makeFakeCs({ spendError: new Error('INSUFFICIENT_CREDITS') })
  const vertex = makeFakeVertex()
  const out = await executeOf(generateImage('user-1', cs, [], vertex.generate))({ prompt: 'x' })
  assert.match(out, /credits/i)
  assert.equal(vertex.invocations, 0)
  assert.equal(calls.refunds.length, 0)
})

test('vertex failure refunds the full allocation and returns an apology', async () => {
  const { cs, calls } = makeFakeCs()
  const vertex = makeFakeVertex({ error: new Error('VERTEX_500') })
  const out = await executeOf(generateImage('user-1', cs, [], vertex.generate))({ prompt: 'x' })
  assert.match(out, /couldn't create/i)
  assert.deepEqual(calls.order, ['spend', 'refund'])
  assert.deepEqual(calls.refunds[0], [{ transactionId: 'tx-1', amount: 200 }])
})

test('unsupported MIME refunds', async () => {
  const { cs, calls } = makeFakeCs()
  const vertex = makeFakeVertex({ image: { imageBase64: 'QUJD', mimeType: 'image/gif' } })
  await executeOf(generateImage('user-1', cs, [], vertex.generate))({ prompt: 'x' })
  assert.deepEqual(calls.order, ['spend', 'refund'])
})

test('oversized base64 refunds', async () => {
  const { cs, calls } = makeFakeCs()
  const big = 'A'.repeat(8_000_001)
  const vertex = makeFakeVertex({ image: { imageBase64: big, mimeType: 'image/png' } })
  await executeOf(generateImage('user-1', cs, [], vertex.generate))({ prompt: 'x' })
  assert.deepEqual(calls.order, ['spend', 'refund'])
})

test('empty inline data refunds', async () => {
  const { cs, calls } = makeFakeCs()
  const vertex = makeFakeVertex({ image: { imageBase64: '   ', mimeType: 'image/png' } })
  await executeOf(generateImage('user-1', cs, [], vertex.generate))({ prompt: 'x' })
  assert.deepEqual(calls.order, ['spend', 'refund'])
})

test('second call in the same run declines WITHOUT spending', async () => {
  const { cs, calls } = makeFakeCs()
  const vertex = makeFakeVertex()
  const execute = executeOf(generateImage('user-1', cs, [], vertex.generate))
  const first = await execute({ prompt: 'one chart' })
  const second = await execute({ prompt: 'another chart' })
  assert.deepEqual(JSON.parse(first), { status: 'ok' })
  assert.match(second, /one image per reply/i)
  assert.equal(calls.spends.length, 1)
  assert.equal(vertex.invocations, 1)
})

test('blank prompt after trim refunds without calling the model', async () => {
  const { cs, calls } = makeFakeCs()
  const vertex = makeFakeVertex()
  await executeOf(generateImage('user-1', cs, [], vertex.generate))({ prompt: '   ' })
  assert.equal(vertex.invocations, 0)
  assert.deepEqual(calls.order, ['spend', 'refund'])
})

test('truncates prompts over 2000 chars before the model call', async () => {
  const { cs } = makeFakeCs()
  const vertex = makeFakeVertex()
  await executeOf(generateImage('user-1', cs, [], vertex.generate))({
    prompt: 'x'.repeat(2500),
  })
  assert.equal(vertex.receivedPrompts[0]?.length, 2000)
})

test('a failing refund does not throw out of execute', async () => {
  const { cs } = makeFakeCs({ refundRejects: true })
  const vertex = makeFakeVertex({ error: new Error('VERTEX_500') })
  const out = await executeOf(generateImage('user-1', cs, [], vertex.generate))({ prompt: 'x' })
  assert.match(out, /couldn't create/i)
})

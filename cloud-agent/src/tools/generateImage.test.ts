import assert from 'node:assert/strict'
import test from 'node:test'
import type { CreditService, CreditSpendAllocation } from '../services/creditService.js'
import { generateImage, lookupProjectId, type GeneratedImage } from './generateImage.js'

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

test('success records its spend allocations in the run-scoped ledger', async () => {
  const { cs } = makeFakeCs()
  const vertex = makeFakeVertex()
  const spendLedger: CreditSpendAllocation[] = []
  await executeOf(generateImage('user-1', cs, [], vertex.generate, spendLedger))({
    prompt: 'a diagram',
  })
  // The handler catch paths refund exactly these allocations if the run dies
  // after this point (spec §7 post-tool-success row).
  assert.deepEqual(spendLedger, [{ transactionId: 'tx-1', amount: 200 }])
})

test('failure branches that self-refund leave the spend ledger empty', async () => {
  const { cs, calls } = makeFakeCs()
  const vertex = makeFakeVertex({ error: new Error('VERTEX_DOWN') })
  const spendLedger: CreditSpendAllocation[] = []
  await executeOf(generateImage('user-1', cs, [], vertex.generate, spendLedger))({ prompt: 'x' })
  // The internal tryRefund already made the user whole — a ledger entry here
  // would cause a double refund downstream.
  assert.deepEqual(spendLedger, [])
  assert.equal(calls.refunds.length, 1)
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

// Project env resolution — regression for the local-dcontainer bug where only
// GOOGLE_CLOUD_PROJECT is set (the convention docker-compose.local.yml AND
// prod's clanker-cloud-agent both use). Pre-fix the tool threw
// MISSING_GCP_PROJECT before talking to Vertex, surfacing as the "camera
// glitched" character apology (tested via defaultVertexImageGenerator, which
// is the only path that actually exercises getVertexClient).

const PROJECT_ENV_KEYS = ['GCLOUD_PROJECT', 'GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT'] as const

type SavedEnv = Record<(typeof PROJECT_ENV_KEYS)[number], string | undefined>

function snapshotProjectEnv(): SavedEnv {
  return Object.fromEntries(PROJECT_ENV_KEYS.map((k) => [k, process.env[k]])) as SavedEnv
}

function restoreProjectEnv(snap: SavedEnv): void {
  for (const k of PROJECT_ENV_KEYS) {
    if (snap[k] === undefined) delete process.env[k]
    else process.env[k] = snap[k]
  }
}

test('lookupProjectId returns the project when only GOOGLE_CLOUD_PROJECT is set', () => {
  const snap = snapshotProjectEnv()
  try {
    delete process.env.GCLOUD_PROJECT
    delete process.env.GCP_PROJECT
    process.env.GOOGLE_CLOUD_PROJECT = 'clanker-prod'
    assert.equal(lookupProjectId(), 'clanker-prod')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('lookupProjectId falls back to GCLOUD_PROJECT, then GCP_PROJECT', () => {
  const snap = snapshotProjectEnv()
  try {
    delete process.env.GOOGLE_CLOUD_PROJECT
    process.env.GCLOUD_PROJECT = 'from-gcloud'
    delete process.env.GCP_PROJECT
    assert.equal(lookupProjectId(), 'from-gcloud')

    delete process.env.GCLOUD_PROJECT
    process.env.GCP_PROJECT = 'from-gcp'
    assert.equal(lookupProjectId(), 'from-gcp')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('lookupProjectId returns empty string when no project env is set', () => {
  const snap = snapshotProjectEnv()
  try {
    for (const k of PROJECT_ENV_KEYS) delete process.env[k]
    assert.equal(lookupProjectId(), '')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('lookupProjectId trims surrounding whitespace', () => {
  const snap = snapshotProjectEnv()
  try {
    delete process.env.GCLOUD_PROJECT
    delete process.env.GCP_PROJECT
    process.env.GOOGLE_CLOUD_PROJECT = '  clanker-prod  '
    assert.equal(lookupProjectId(), 'clanker-prod')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('lookupProjectId falls through whitespace-only higher-priority vars', () => {
  // A stray "  " in GCLOUD_PROJECT (e.g. from an unset CI variable that
  // exports as empty space) must not short-circuit the chain — the next
  // valid candidate wins. Pre-fix, ?? returned the whitespace and the
  // trailing .trim() produced "", which made getVertexClient throw
  // MISSING_GCP_PROJECT even though GCP_PROJECT was usable.
  const snap = snapshotProjectEnv()
  try {
    process.env.GCLOUD_PROJECT = '   '
    delete process.env.GCP_PROJECT
    process.env.GOOGLE_CLOUD_PROJECT = 'clanker-prod'
    assert.equal(lookupProjectId(), 'clanker-prod')

    process.env.GCLOUD_PROJECT = ''
    process.env.GCP_PROJECT = '\t\n'
    assert.equal(lookupProjectId(), 'clanker-prod')

    process.env.GCLOUD_PROJECT = '   '
    process.env.GCP_PROJECT = '  '
    delete process.env.GOOGLE_CLOUD_PROJECT
    assert.equal(lookupProjectId(), '')
  } finally {
    restoreProjectEnv(snap)
  }
})

test('a failing refund does not throw out of execute', async () => {
  const { cs } = makeFakeCs({ refundRejects: true })
  const vertex = makeFakeVertex({ error: new Error('VERTEX_500') })
  const out = await executeOf(generateImage('user-1', cs, [], vertex.generate))({ prompt: 'x' })
  assert.match(out, /couldn't create/i)
})

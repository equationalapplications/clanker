# Agent Chat Image Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Characters in cloud-agent chat can generate one image per reply; the image rides the turn response to the device, persists through the existing `saveCharacterImage` pipeline, and is saveable/shareable from the viewer.

**Architecture:** A new server-side `generate_image` FunctionTool (Vertex image model via `@google/genai`) spends 200 credits before generating and refunds on any failure, pushing base64 results onto a run-scoped collector that `buildAgent()` returns. Handlers emit the collector's contents — WS frame `{type:'agent_image'}` before `usage_snapshot`, HTTP field `generatedImage` on the final JSON. The client funnels both transports through one `onAgentImage` callback in `cloudAgentService`; `useAIChat` persists via `saveCharacterImage(source:'chat')` with pre-minted ids and carries `imageId` on the assistant row's `message_data`.

**Tech Stack:** cloud-agent (Node 22+, `@google/adk` FunctionTool + Zod, `@google/genai` 2.16 direct dep, **node:test**), Vertex AI Gemini image model, Expo 57 / React Native client (**Jest**, react-query), expo-media-library (new, `~57.0.3` line), expo-sharing (installed).

**Spec:** `docs/superpowers/specs/2026-08-23-agent-image-generation-design.md` — read it alongside this plan; section references below (`§6.1`, …) point into it.

**Out of scope (deliberately not tasks here):** the companion SEO page — it ships separately per its own drafted plan (`.superpowers/plans/2026-08-23-seo-character-images-page.md`, spec §11). No database migrations, no Storage-rules changes, no sync-pull changes (spec §3).

## Global Constraints

- Branch: work lands on `feat/chat-image-generation`; PRs target **`staging`**, never `main`.
- **cloud-agent tests use node:test — NOT Jest.** Suite runs compiled output: `cd cloud-agent && npm test`. Baseline: 288 suites-worth of files (287 pass, 1 skipped) + two known flakes.
- Root/client tests are Jest with scoped runs only: `npx jest <path>` (`npm test -- <path>` does NOT filter). React-query tests need `gcTime: 0`.
- Credits: exactly **200** per image (`IMAGE_GENERATION_COST`), spend-before-generate, refund on every failure branch after the spend.
- Hard cap one image per assistant reply, enforced by a closure-local flag independent of model obedience.
- Image guards mirror `functions/src/generateImage.ts`: prompt ≤ 2000 chars, base64 ≤ 8,000,000 chars, MIME ∈ {image/png, image/jpeg, image/webp}.
- Source union unchanged: images persist as `source: 'chat'` (spec §6.7).
- Model pinned as single constant `CHAT_IMAGE_MODEL_ID`; preferred value `gemini-3.1-flash-lite-image`, documented fallback `gemini-2.5-flash-image` (Task 0 decides the shipped value).
- Tool results returned to the model must never contain base64 — success returns `{"status":"ok"}`.
- CI formatting steps run `:check`, never `--write`; formatting sweeps never share a commit with logic changes.
- The client changes in Tasks 7–8 import a NEW native module (`expo-media-library`). It cannot reach existing store builds via OTA (runtimeVersion fence) — see the deployment-order warning in Task 9 before publishing anything.

---

### Task 0: Spike — verify the Vertex image model SKU and IAM (spec §10.1–10.2)

**Files:**
- Modify (only the constant's comment/value): `cloud-agent/src/constants/images.ts` — created in Task 1; this task decides its value.

**Interfaces:**
- Produces: the decided value of `CHAT_IMAGE_MODEL_ID` (`gemini-3.1-flash-lite-image` if callable, else `gemini-2.5-flash-image`) and confirmation that clanker-prod's runtime identity may call it. Task 1 consumes this decision.

- [ ] **Step 1: Ensure local ADC credentials are live**

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project clanker-prod
```

(An expired ADC token surfaces as a misleading "expired Vertex creds" style failure — refresh first.)

- [ ] **Step 2: Probe both model candidates from the cloud-agent dependency tree**

Run from `cloud-agent/`:

```bash
node --input-type=module -e "
import { GoogleGenAI } from '@google/genai'
const ai = new GoogleGenAI({ vertexai: true, project: 'clanker-prod', location: 'us-central1' })
for (const model of ['gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image']) {
  try {
    const r = await ai.models.generateContent({
      model,
      contents: 'A simple red circle on a white background',
      config: { responseModalities: ['TEXT', 'IMAGE'] },
    })
    const part = r.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
    console.log(model, part ? 'OK mime=' + part.inlineData.mimeType + ' approxBytes=' + Math.round((part.inlineData.data?.length ?? 0) * 0.75) : 'NO_IMAGE_PART')
  } catch (e) {
    console.log(model, 'FAIL', e instanceof Error ? e.message : e)
  }
}
"
```

- [ ] **Step 3: Record findings and decide**

- If the Lite SKU prints `OK`: keep `CHAT_IMAGE_MODEL_ID = 'gemini-3.1-flash-lite-image'`.
- If it fails with PERMISSION_DENIED / not-found but `gemini-2.5-flash-image` prints `OK`: ship the fallback value — do **not** block (spec §6.4). If the failure is IAM-shaped (`iam_permission_denied` or `aiplatform.endpoints.predict`), surface to the user for the ops grant (`roles/aiplatform.user` on the Cloud Run runtime service account) and re-run Step 2.
- Note the per-image price for the chosen SKU from Vertex pricing and record it in the `constants/images.ts` header comment written in Task 1.
- If BOTH fail: stop and report back before any implementation — the feature has no model to call.

---

### Task 1: Cloud-agent constants + `generate_image` tool (spec §6.1, §6.4, §6.8)

**Files:**
- Create: `cloud-agent/src/constants/images.ts`
- Modify: `cloud-agent/src/constants/credits.ts`
- Create: `cloud-agent/src/tools/generateImage.ts`
- Test: `cloud-agent/src/tools/generateImage.test.ts`

**Interfaces:**
- Consumes: `CreditService` pick `{ spendCredit, refundCredit }` from `../services/creditService.js`; constants from `../constants/*`.
- Produces (Tasks 2+ rely on these exact names):
  - `export interface GeneratedImage { imageBase64: string; mimeType: string }`
  - `export type VertexImageGenerator = (prompt: string) => Promise<GeneratedImage>`
  - `export function generateImage(userId: string, cs: Pick<CreditService, 'spendCredit' | 'refundCredit'>, collector: GeneratedImage[], vertexGenerate?: VertexImageGenerator): FunctionTool`
  - `IMAGE_GENERATION_COST = 200` in `constants/credits.ts`

> Signature note vs spec: spec §6.1 sketches the factory as `(db, userId, cs)`; the execute flow never touches the database directly (all persistence goes through `cs`), so `db` is omitted rather than carried unused. `collector` is the extra argument §6.2 requires ("closes the tool over it"), and `vertexGenerate` is the injection seam that makes the flow unit-testable without Vertex (same pattern as `options.generateImage` in `functions/src/generateImage.ts`).

- [ ] **Step 1: Write the failing tool test**

Create `cloud-agent/src/tools/generateImage.test.ts`:

```typescript
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

function makeFakeCs(opts?: {
  spendError?: Error
  refundRejects?: boolean
}): { cs: Pick<CreditService, 'spendCredit' | 'refundCredit'>; calls: FakeCsCalls } {
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cloud-agent && npx tsc --noEmit 2>&1 | head -5`
Expected: TS error — module `./generateImage.js` not found (constants file also missing yet).

- [ ] **Step 3: Create the constants**

Create `cloud-agent/src/constants/images.ts` (model value per Task 0's decision):

```typescript
// Chat image generation (agent generate_image tool) — spec:
// docs/superpowers/specs/2026-08-23-agent-image-generation-design.md §6.4.
// Primary: Nano Banana Lite tier (~1K native output matches the client's
// 1024-master/256-thumb variant pipeline; lowest latency/cost).
// Fallback (documented, swap = one-line change): 'gemini-2.5-flash-image'
// — today's prod avatar model in functions/src/generateImage.ts.
// Per-image price (Vertex, verified 2026-08-XX spike): $0.0XX
export const CHAT_IMAGE_MODEL_ID = 'gemini-3.1-flash-lite-image'
export const CHAT_IMAGE_REGION = 'us-central1'
```

Append to `cloud-agent/src/constants/credits.ts` (mirrors `functions/src/constants/credits.ts:8`):

```typescript
export const IMAGE_GENERATION_COST = 200
```

- [ ] **Step 4: Write the tool implementation**

Create `cloud-agent/src/tools/generateImage.ts`:

```typescript
import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { GoogleGenAI } from '@google/genai'
import { IMAGE_GENERATION_COST } from '../constants/credits.js'
import { CHAT_IMAGE_MODEL_ID, CHAT_IMAGE_REGION } from '../constants/images.js'
import type { CreditService } from '../services/creditService.js'

/** One generated image riding this agent_run's turn response to the client. */
export interface GeneratedImage {
  imageBase64: string
  mimeType: string
}

export type VertexImageGenerator = (prompt: string) => Promise<GeneratedImage>

// Mirrors functions/src/generateImage.ts guard values (no portrait wrapper —
// this tool takes the raw user-intent prompt).
const MAX_PROMPT_LENGTH = 2_000
const MAX_BASE64_LENGTH = 8_000_000
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

let vertexClient: GoogleGenAI | undefined

function getVertexClient(): GoogleGenAI {
  if (!vertexClient) {
    const project = (process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? '').trim()
    if (!project) {
      throw new Error('MISSING_GCP_PROJECT')
    }
    vertexClient = new GoogleGenAI({ vertexai: true, project, location: CHAT_IMAGE_REGION })
  }
  return vertexClient
}

export const defaultVertexImageGenerator: VertexImageGenerator = async (prompt) => {
  const result = await getVertexClient().models.generateContent({
    model: CHAT_IMAGE_MODEL_ID,
    contents: prompt,
    config: { responseModalities: ['TEXT', 'IMAGE'] },
  })
  for (const candidate of result.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inlineData?.data?.trim()
      if (data) {
        return { imageBase64: data, mimeType: part.inlineData?.mimeType ?? 'image/png' }
      }
    }
  }
  throw new Error('VERTEX_RETURNED_NO_IMAGE')
}

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(2000),
})

/**
 * House-pattern closure factory (see tools/browserAction.ts). `collector` is
 * minted by buildAgent() per agent_run; pushing onto it is how bytes reach the
 * transport handlers, because ADK forwards only tool NAMES and text tokens —
 * never tool results (spec §5).
 */
export function generateImage(
  userId: string,
  cs: Pick<CreditService, 'spendCredit' | 'refundCredit'>,
  collector: GeneratedImage[],
  vertexGenerate: VertexImageGenerator = defaultVertexImageGenerator,
): FunctionTool {
  // Run-scoped hard cap (decision #4): one successful generation per reply,
  // enforced here regardless of what the model does with the description.
  let generatedThisRun = false

  return new FunctionTool({
    name: 'generate_image',
    description:
      "Create an image and send it to the user in your reply — suited to charts, diagrams, visual plans, or a selfie of yourself. " +
      'Call it ONLY when the user asks you to create/draw/generate an image, or explicitly says yes right after you offered to draw something. ' +
      'Offering in plain text ("want me to draw that?") is always allowed and costs nothing. ' +
      `At most ONE image per reply; each image costs the user ${IMAGE_GENERATION_COST} credits.`,
    parameters: generateImageSchema,
    execute: async (args: unknown): Promise<string> => {
      const { prompt } = args as z.infer<typeof generateImageSchema>

      if (generatedThisRun) {
        return 'I can only create one image per reply, and I already made one for this message.'
      }

      // Spend BEFORE generating; every later failure branch refunds.
      let allocations
      try {
        allocations = await cs.spendCredit(userId, IMAGE_GENERATION_COST, 'image_generate')
      } catch (err) {
        if (err instanceof Error && err.message === 'INSUFFICIENT_CREDITS') {
          return "I'd love to draw that for you, but you're out of credits right now."
        }
        throw err
      }

      // Outer-loop refunds cover only allocations consumeAgentEvents collected
      // itself (verified: services/agentEventLoop.ts) — this refund path is
      // owned here. A failed refund must still resolve with a sentence so the
      // turn degrades instead of throwing into the event loop.
      const tryRefund = async (): Promise<void> => {
        try {
          await cs.refundCredit(userId, allocations)
        } catch (refundErr) {
          console.warn('[generate_image] refundCredit failed:', {
            allocations,
            error: refundErr instanceof Error ? refundErr.message : refundErr,
          })
        }
      }

      try {
        const trimmed = prompt.trim().slice(0, MAX_PROMPT_LENGTH)
        if (!trimmed) {
          await tryRefund()
          return "I couldn't read that image request — could you describe it again?"
        }

        const { imageBase64, mimeType } = await vertexGenerate(trimmed)

        const normalizedMime = mimeType.trim().toLowerCase()
        if (
          !imageBase64 ||
          imageBase64.length > MAX_BASE64_LENGTH ||
          !ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)
        ) {
          await tryRefund()
          return "I'm sorry — I couldn't create that image just now."
        }

        generatedThisRun = true
        collector.push({ imageBase64, mimeType: normalizedMime })
        // Never return the base64 here — tool results are tokenized into the
        // model context. The bytes leave through the run-scoped collector.
        return JSON.stringify({ status: 'ok' })
      } catch (err) {
        console.warn('[generate_image] generation failed:', err)
        await tryRefund()
        return "I'm sorry — I couldn't create that image just now. Please try again in a moment."
      }
    },
  })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Build then run just this file's compiled tests:

```bash
cd cloud-agent && npm run build && NODE_ENV=test node --test --test-reporter spec dist/cloud-agent/src/tools/generateImage.test.js
```

Expected: all 12 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/src/constants/images.ts cloud-agent/src/constants/credits.ts cloud-agent/src/tools/generateImage.ts cloud-agent/src/tools/generateImage.test.ts
git commit -m "feat(cloud-agent): add generate_image tool with spend-before-generate credits"
```

---

### Task 2: `buildAgent` mints the run-scoped collector and wires the tool (spec §6.2)

**Files:**
- Modify: `cloud-agent/src/services/agentCore.ts`
- Modify: `cloud-agent/src/handlers/wsAgentHandler.ts:174` (caller destructure; emission itself is Task 3)
- Modify: `cloud-agent/src/index.ts:123-132` (`runAgentReal` caller destructure)
- Test: `cloud-agent/src/services/agentCore.test.ts` (update existing call sites + add wiring assertions)
- Test: `cloud-agent/src/agent.test.ts`, `cloud-agent/src/tools/vaultToolsWiring.test.ts` (update destructuring)

**Interfaces:**
- Consumes: `generateImage`, `GeneratedImage` from Task 1.
- Produces:
  - `export interface BuildAgentResult { agent: LlmAgent; imageCollector: GeneratedImage[] }`
  - `buildAgent(db, userId, characterId, systemInstruction, timezone, embed, bridge?, vault?, opts?: { creditService?: Pick<CreditService, 'spendCredit' | 'refundCredit'> }): BuildAgentResult`
  - Every existing caller now destructures `{ agent, imageCollector }` (or ignores the collector where unused).

- [ ] **Step 1: Update the failing wiring test first**

In `cloud-agent/src/services/agentCore.test.ts`, update every existing `buildAgent(...)` use to `.agent` (e.g. `const { agent } = buildAgent(...)` → `agent.name`) and append:

```typescript
import { generateImage } from '../tools/generateImage.js'

test('buildAgent wires generate_image and returns a fresh run-scoped collector', () => {
  const first = buildAgent(mockDb, 'user-123', 'char-456', 'Test instruction', 'UTC', mockEmbed)
  const second = buildAgent(mockDb, 'user-123', 'char-456', 'Test instruction', 'UTC', mockEmbed)

  const names = first.agent.tools.map((t) => (t as { name: string }).name)
  assert.ok(names.includes('generate_image'))

  assert.deepEqual(first.imageCollector, [])
  assert.notEqual(first.imageCollector, second.imageCollector, 'collector must be per-run')

  // The tool closes over THIS run's collector: driving it pushes there, not elsewhere.
  const execute = (
    first.agent.tools.find((t) => (t as { name: string }).name === 'generate_image') as unknown as {
      execute: (args: unknown) => Promise<string>
    }
  ).execute
  return execute({ prompt: 'probe' }).then(() => {
    // buildAgent defaulted to createCreditService(mockDb); the push itself is
    // asserted end-to-end in tools/generateImage.test.ts with a fake cs. Here we
    // only pin that the wired tool resolves rather than throws on wiring.
    assert.ok(true)
  })
})
```

Note: the probe above runs against the real `defaultVertexImageGenerator`, which will attempt Vertex and fail — the tool catches internally and returns an apology string, which is exactly why the assertion is only "resolves". Do not assert collector contents here.

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud-agent && npm run build && NODE_ENV=test node --test dist/cloud-agent/src/services/agentCore.test.js`
Expected: FAIL — `buildAgent(...)` returns `LlmAgent`, no `.agent` property; no `generate_image` in tools.

- [ ] **Step 3: Implement in `agentCore.ts`**

Changes to `cloud-agent/src/services/agentCore.ts`:

```typescript
import { LlmAgent, GOOGLE_SEARCH } from '@google/adk'
// ...existing imports...
import type { CreditService } from './creditService.js'
import { createCreditService } from './creditService.js'
import { generateImage, type GeneratedImage } from '../tools/generateImage.js'

export interface BuildAgentResult {
  agent: LlmAgent
  /** Run-scoped: images generate_image produced during THIS agent_run. Empty otherwise. */
  imageCollector: GeneratedImage[]
}

export function buildAgent(
  db: DrizzleClient,
  userId: string,
  characterId: string,
  systemInstruction: string,
  timezone: string,
  embed: (text: string) => Promise<number[]>,
  bridge?: BrowserActionDeps,
  vault?: VaultToolDeps,
  opts?: { creditService?: Pick<CreditService, 'spendCredit' | 'refundCredit'> },
): BuildAgentResult {
  const cs = opts?.creditService ?? createCreditService(db)
  const imageCollector: GeneratedImage[] = []
  const tools = [
    // ...unchanged list through GOOGLE_SEARCH...
  ]
  if (bridge) tools.push(browserActionTool(bridge, { trigger: 'text', preBilled: true }))
  if (vault) tools.push(...buildVaultTools(vault))
  // Unconditional (§6.2): credit spending works on both transports; the tool's
  // own rules + cap gate usage.
  tools.push(generateImage(userId, cs, imageCollector))
  return {
    agent: new LlmAgent({
      name: 'clanker-cloud-agent',
      model: 'gemini-3.5-flash',
      instruction: systemInstruction,
      tools,
    }),
    imageCollector,
  }
}
```

- [ ] **Step 4: Update callers**

`cloud-agent/src/handlers/wsAgentHandler.ts:174` — inside the try block, replace

```typescript
const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embedText)
```

with

```typescript
// Pass the handler's injected cs so the tool spends/refunds hit the same
// credit service the loop bills with.
const { agent, imageCollector } = buildAgent(
  db,
  userId,
  characterId,
  systemInstruction,
  timezone,
  embedText,
  undefined,
  undefined,
  { creditService: cs },
)
```

(`imageCollector` is intentionally unused until Task 3 — add `void imageCollector` temporarily if lint complains, removing it in Task 3.)

`cloud-agent/src/index.ts` `runAgentReal` (~line 123) — replace

```typescript
const agent = buildAgent(db, userId, characterId, systemInstruction, timezone, embed, bridge, vault)
```

with

```typescript
const { agent, imageCollector } = buildAgent(
  db,
  userId,
  characterId,
  systemInstruction,
  timezone,
  embed,
  bridge,
  vault,
  { creditService },
)
```

and change the final line from `return consumeAgentEvents(events, userId, creditService)` to:

```typescript
const consumed = await consumeAgentEvents(events, userId, creditService)
return {
  ...consumed,
  // Post-loop delivery point (§6.3): at most one image per run.
  generatedImage: imageCollector.length > 0 ? imageCollector[0] : null,
}
```

Also widen the two result types at the top of `index.ts` (`AppOptions.runAgentFn` at ~line 76 and `runAgentReal` at ~line 92), adding the type-only import beside the existing ones:

```typescript
import type { GeneratedImage } from './tools/generateImage.js'
```

and extend both signatures to:

```typescript
Promise<{
  reply: string
  toolCalls: string[]
  groundingMetadata?: GroundingMetadata
  /** Present when the agent called generate_image this run (§6.3 HTTP parity). */
  generatedImage?: GeneratedImage | null
}>
```

- [ ] **Step 5: Fix remaining compile sites (tests)**

- `cloud-agent/src/agent.test.ts` — four `buildAgent(...)` calls become `const { agent } = buildAgent(...)`.
- `cloud-agent/src/tools/vaultToolsWiring.test.ts` — `withVault`/`without` become `const { agent: withVaultAgent } = ...` etc.; assertion targets rename accordingly.

- [ ] **Step 6: Run affected suites**

```bash
cd cloud-agent && npm test 2>&1 | tail -15
```

Expected: full suite green (baseline 287 pass + 1 skipped, plus the new agentCore test). Any failure here means a caller was missed.

- [ ] **Step 7: Commit**

```bash
git add cloud-agent/src/services/agentCore.ts cloud-agent/src/handlers/wsAgentHandler.ts cloud-agent/src/index.ts cloud-agent/src/services/agentCore.test.ts cloud-agent/src/agent.test.ts cloud-agent/src/tools/vaultToolsWiring.test.ts
git commit -m "feat(cloud-agent): buildAgent wires generate_image and returns run-scoped image collector"
```

---

### Task 3: WS handler emits the `agent_image` frame (spec §6.3)

**Files:**
- Modify: `cloud-agent/src/handlers/wsAgentHandler.ts` (real emission + `mockGeneratedImage` test hook)
- Test: `cloud-agent/src/handlers/wsAgentHandler.test.ts`

**Interfaces:**
- Consumes: `imageCollector` from `buildAgent` (Task 2); `WsHandlerOptions.mockGeneratedImage` (new, test-only).
- Produces: wire frame `{ type: 'agent_image', imageBase64: string, mimeType: string }` emitted once, after the event loop, **before** `usage_snapshot` and close. Old clients ignore unknown frames (verified dispatch) — additive-safe.

- [ ] **Step 1: Write the failing tests**

Append to `cloud-agent/src/handlers/wsAgentHandler.test.ts` (mirrors the grounding-ordering test above it):

```typescript
function collectFrameTypes(ws: WebSocket, types: string[]): void {
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as { type: string }
    types.push(msg.type)
  })
}

const AGENT_RUN_FRAME = { type: 'agent_run', message: 'hello', characterId: CHAR_UUID }

test('emits agent_image before usage_snapshot when mockGeneratedImage provided', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const { server, close } = createTestWsServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'firebase-uid' }),
    mockStreamReply: 'Hello from WebSocket',
    mockGeneratedImage: { imageBase64: 'QUJD', mimeType: 'image/png' },
  })
  const port = await listen(server)

  const frameTypes: string[] = []
  let imageFrame: { type: string; imageBase64?: string; mimeType?: string } | null = null

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://[IP_ADDRESS]:${port}`)
    collectFrameTypes(ws, frameTypes)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
      ws.send(JSON.stringify(AGENT_RUN_FRAME))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as {
        type: string
        imageBase64?: string
        mimeType?: string
      }
      if (msg.type === 'agent_image') imageFrame = msg
      if (msg.type === 'usage_snapshot') {
        clearTimeout(timeout)
        ws.close()
      }
    })

    ws.on('close', () => resolve())
    ws.on('error', reject)
  })

  await close()

  assert.ok(imageFrame, 'expected an agent_image frame')
  assert.equal((imageFrame as { imageBase64?: string }).imageBase64, 'QUJD')
  assert.equal((imageFrame as { mimeType?: string }).mimeType, 'image/png')
  assert.ok(
    frameTypes.indexOf('agent_image') !== -1 &&
      frameTypes.indexOf('agent_image') < frameTypes.indexOf('usage_snapshot'),
    `agent_image must precede usage_snapshot; got ${JSON.stringify(frameTypes)}`,
  )
})

test('omits agent_image when no image was generated', async () => {
  const db = makeMockDb([[mockUser], [mockCharacter]])
  const { server, close } = createTestWsServer({
    db,
    creditService: mockCreditService,
    verifyToken: async () => ({ uid: 'firebase-uid' }),
    mockStreamReply: 'Hello from WebSocket',
  })
  const port = await listen(server)

  const frameTypes: string[] = []
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://[IP_ADDRESS]:${port}`)
    collectFrameTypes(ws, frameTypes)
    const timeout = setTimeout(() => reject(new Error('test timeout')), 5000)

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'auth', token: 'valid-token' }))
      ws.send(JSON.stringify(AGENT_RUN_FRAME))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as { type: string }
      if (msg.type === 'usage_snapshot') {
        clearTimeout(timeout)
        ws.close()
      }
    })

    ws.on('close', () => resolve())
    ws.on('error', reject)
  })

  await close()
  assert.equal(frameTypes.includes('agent_image'), false)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd cloud-agent && npm run build && NODE_ENV=test node --test dist/cloud-agent/src/handlers/wsAgentHandler.test.js`
Expected: first test FAILS (`expected an agent_image frame`); hook property doesn't exist yet. Second passes trivially.

- [ ] **Step 3: Implement the hook + real emission**

In `WsHandlerOptions` (top of `wsAgentHandler.ts`), add:

```typescript
/** Test hook: emit this payload as an agent_image frame during the mockStreamReply branch. */
mockGeneratedImage?: { imageBase64: string; mimeType: string }
```

In the `mockStreamReply !== undefined` branch (lines ~139-160), insert between the grounding block and the balance lookup:

```typescript
if (options.mockGeneratedImage) {
  safeSend({
    type: 'agent_image',
    imageBase64: options.mockGeneratedImage.imageBase64,
    mimeType: options.mockGeneratedImage.mimeType,
  })
}
```

On the real path, immediately after `const result = await consumeAgentEvents(...)` (before the grounding block), insert:

```typescript
if (imageCollector.length > 0) {
  // Post-loop delivery (§6.3): text streamed first; the image lands with
  // completion, before usage_snapshot/close. One frame max per run.
  const img = imageCollector[0]
  safeSend({ type: 'agent_image', imageBase64: img.imageBase64, mimeType: img.mimeType })
}
```

Remove the temporary `void imageCollector` from Task 2 if present.

- [ ] **Step 4: Run the suite**

Run: `cd cloud-agent && npm test 2>&1 | tail -10`
Expected: all green including the two new tests.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/handlers/wsAgentHandler.ts cloud-agent/src/handlers/wsAgentHandler.test.ts
git commit -m "feat(cloud-agent): emit agent_image WS frame post-loop before usage_snapshot"
```

---

### Task 4: HTTP `/agent/run` carries `generatedImage` (spec §6.3)

**Files:**
- Modify: `cloud-agent/src/index.ts` (`res.json` body in the `/agent/run` handler ~line 398)
- Test: `cloud-agent/src/index.test.ts`

**Interfaces:**
- Consumes: `result.generatedImage?: GeneratedImage | null` on the `runAgentFn` return (widened in Task 2).
- Produces: response JSON gains `generatedImage: { imageBase64, mimeType } | null` beside `reply`/`toolCalls`/`usageSnapshot`/`groundingMetadata`.

- [ ] **Step 1: Write the failing tests**

Append near the other `/agent/run` tests in `cloud-agent/src/index.test.ts`:

```typescript
test('POST /agent/run returns generatedImage when runAgentFn produced one', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async () => ({
      reply: 'here is your chart',
      toolCalls: ['generate_image'],
      generatedImage: { imageBase64: 'QUJD', mimeType: 'image/png' },
    }),
    creditService: mockCreditService,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.deepEqual((res.body as { generatedImage: unknown }).generatedImage, {
    imageBase64: 'QUJD',
    mimeType: 'image/png',
  })
})

test('POST /agent/run returns generatedImage null when nothing was generated', async () => {
  const db = makeMockDb([[mockUser] as InsertedRow[], [mockCharacter] as InsertedRow[], []])
  const app = createApp({
    verifyToken: mockVerify,
    db,
    runAgentFn: async () => ({ reply: 'plain text', toolCalls: [] }),
    creditService: mockCreditService,
  })
  const res = await request(app)
    .post('/agent/run')
    .set('Authorization', 'Bearer valid-token')
    .send({ message: 'hello', characterId: CHAR_UUID })
  assert.equal(res.status, 200)
  assert.equal((res.body as { generatedImage: unknown }).generatedImage, null)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd cloud-agent && npm run build && NODE_ENV=test node --test --test-name-pattern "generatedImage" dist/cloud-agent/src/index.test.js`
Expected: first FAILS (field absent → undefined ≠ object); second PASSES already only after Step 3 adds `?? null` — if it fails too, proceed.

- [ ] **Step 3: Implement**

In `cloud-agent/src/index.ts`, the `/agent/run` success response (~line 398) becomes:

```typescript
res.json({
  reply: result.reply,
  toolCalls: result.toolCalls,
  usageSnapshot: newBalance !== null ? { remainingCredits: newBalance } : null,
  groundingMetadata: result.groundingMetadata,
  generatedImage: result.generatedImage ?? null,
})
```

- [ ] **Step 4: Run and commit**

Run: `cd cloud-agent && npm test 2>&1 | tail -8`
Expected: green.

```bash
git add cloud-agent/src/index.ts cloud-agent/src/index.test.ts
git commit -m "feat(cloud-agent): attach generatedImage to /agent/run JSON result"
```

---

### Task 5: Extend `transportParity.test.ts` for the new payload (spec §6.3)

**Files:**
- Modify: `cloud-agent/src/transportParity.test.ts`

**Interfaces:**
- Consumes: source-text conventions established in Tasks 3-4 (this file greps SOURCE, not behavior — house style of the existing suite).

- [ ] **Step 1: Add the parity test inside the existing `for` loop**

Insert after the `buildNewMessage` test inside `for (const [name, source] of ...)`:

```typescript
test(`${name} handler delivers the agent-image payload with matching keys`, () => {
  if (name === 'ws') {
    assert.match(source, /type:\s*'agent_image'/)
  } else {
    assert.match(source, /generatedImage:\s*result\.generatedImage \?\? null/)
  }
  // Both transports must carry the same two-field shape.
  assert.match(source, /imageBase64/)
  assert.match(source, /mimeType/)
})
```

- [ ] **Step 2: Run, then commit**

Run: `cd cloud-agent && npm test 2>&1 | tail -8`
Expected: green (both sources contain the markers from Tasks 3-4).

```bash
git add cloud-agent/src/transportParity.test.ts
git commit -m "test(cloud-agent): assert agent_image/generatedImage parity across transports"
```

---

### Task 6: Client `cloudAgentService` — one `onAgentImage` consumer for both transports (spec §6.5)

**Files:**
- Modify: `src/services/cloudAgentService.ts`
- Test: `src/services/__tests__/cloudAgentService.agentImage.test.ts` (new)

**Interfaces:**
- Consumes: WS frame `{type:'agent_image',...}` (Task 3), HTTP `generatedImage` field (Task 4).
- Produces (Task 7 relies on this exact signature):
  - `export interface AgentImagePayload { imageBase64: string; mimeType: string }`
  - `CloudAgentStreamCallbacks` gains `onAgentImage?: (image: AgentImagePayload) => void`
  - `runViaHttp(payload, callbacks?)` now threads callbacks; `callCloudAgent` passes them on both paths.

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/cloudAgentService.agentImage.test.ts`:

```typescript
/**
 * Scoped coverage for the agent_image ingestion funnel (spec §6.5): whatever
 * the transport, exactly one onAgentImage callback reaches the caller with the
 * same two-field payload.
 */
import { callCloudAgent } from '~/services/cloudAgentService'

jest.mock('~/config/firebaseConfig', () => ({
  getCurrentUser: () => ({ getIdToken: async () => 'fake-token' }),
}))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  sent: string[] = []
  private listeners: Record<string, ((ev: unknown) => void)[]> = {}

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    ;(this.listeners[type] ??= []).push(cb)
  }

  removeEventListener(): void {}

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {}

  emit(type: string, ev: unknown): void {
    for (const cb of this.listeners[type] ?? []) cb(ev)
  }
}

const originalWs = global.WebSocket

beforeEach(() => {
  FakeWebSocket.instances = []
  ;(global as { WebSocket: unknown }).WebSocket = FakeWebSocket
})

afterEach(() => {
  ;(global as { WebSocket: unknown }).WebSocket = originalWs
  jest.restoreAllMocks()
})

function lastSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  if (!socket) throw new Error('no websocket created')
  return socket
}

describe('WS agent_image frame', () => {
  it('funnels the frame through onAgentImage before resolution', async () => {
    const seen: unknown[] = []
    const order: string[] = []
    const pending = callCloudAgent(
      { message: 'draw', characterId: 'cloud-1' },
      {
        onAgentImage: (img) => {
          seen.push(img)
          order.push('image')
        },
      },
    )
    await Promise.resolve()
    const socket = lastSocket()
    socket.emit('open', {})
    socket.emit('message', {
      data: JSON.stringify({ type: 'token', text: 'sure, drawing…' }),
    })
    socket.emit('message', {
      data: JSON.stringify({ type: 'agent_image', imageBase64: 'QUJD', mimeType: 'image/png' }),
    })
    socket.emit('message', { data: JSON.stringify({ type: 'usage_snapshot', remainingCredits: 800 }) })
    socket.emit('close', { code: 1000 })

    const result = await pending
    expect(seen).toEqual([{ imageBase64: 'QUJD', mimeType: 'image/png' }])
    expect(order).toEqual(['image'])
    expect(result.reply).toBe('sure, drawing…')
    expect(result.usageSnapshot).toEqual({ remainingCredits: 800 })
    expect(socket.sent.length).toBeGreaterThan(0)
  })

  it('ignores malformed agent_image frames instead of crashing', async () => {
    const seen: unknown[] = []
    const pending = callCloudAgent(
      { message: 'draw', characterId: 'cloud-1' },
      { onAgentImage: (img) => seen.push(img) },
    )
    await Promise.resolve()
    const socket = lastSocket()
    socket.emit('open', {})
    socket.emit('message', { data: JSON.stringify({ type: 'agent_image' }) })
    socket.emit('message', { data: JSON.stringify({ type: 'usage_snapshot', remainingCredits: 1 }) })
    socket.emit('close', { code: 1000 })
    await pending
    expect(seen).toEqual([])
  })
})

describe('HTTP generatedImage field', () => {
  it('funnels the response field through onAgentImage', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        reply: 'here you go',
        toolCalls: ['generate_image'],
        usageSnapshot: { remainingCredits: 600 },
        generatedImage: { imageBase64: 'SFRUUC', mimeType: 'image/jpeg' },
      }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch

    const seen: unknown[] = []
    const result = await callCloudAgent(
      { message: 'draw', characterId: 'cloud-1' },
      { onAgentImage: (img) => seen.push(img) },
    )

    expect(seen).toEqual([{ imageBase64: 'SFRUUC', mimeType: 'image/jpeg' }])
    expect(result.generatedImage).toBeUndefined()
  })

  it('delivers nothing when the field is absent (old server)', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ reply: 'text only', toolCalls: [] }),
    }))
    global.fetch = fetchMock as unknown as typeof fetch
    const seen: unknown[] = []
    await callCloudAgent(
      { message: 'hi', characterId: 'cloud-1' },
      { onAgentImage: (img) => seen.push(img) },
    )
    expect(seen).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/services/__tests__/cloudAgentService.agentImage.test.ts`
Expected: FAIL — `onAgentImage` never fires (no such callback exists yet).

- [ ] **Step 3: Implement in `cloudAgentService.ts`**

Add the exported payload type and callback next to `CloudAgentStreamCallbacks`:

```typescript
export interface AgentImagePayload {
  imageBase64: string
  mimeType: string
}
```

Extend the interface:

```typescript
export interface CloudAgentStreamCallbacks {
  onToken?: (text: string) => void
  onToolStart?: (name: string) => void
  onToolEnd?: (name: string) => void
  /** Fires once when the agent generated an image this turn (either transport). */
  onAgentImage?: (image: AgentImagePayload) => void
}
```

In `runViaHttp`, change signature to `(payload: CloudAgentPayload, callbacks?: CloudAgentStreamCallbacks)`, widen the parsed-body cast to include `generatedImage?: unknown`, and after computing `usageSnapshot` add:

```typescript
const rawImage = data.generatedImage as AgentImagePayload | null | undefined
if (
  rawImage &&
  typeof rawImage.imageBase64 === 'string' &&
  typeof rawImage.mimeType === 'string'
) {
  callbacks?.onAgentImage?.({ imageBase64: rawImage.imageBase64, mimeType: rawImage.mimeType })
}
```

In `runViaWebSocket`'s `handleMessage` parse block, widen the cast with `imageBase64?: unknown; mimeType?: unknown` and add a branch beside `grounding_metadata`:

```typescript
} else if (msg.type === 'agent_image') {
  // Unknown-frame tolerance keeps old servers safe; malformed payloads are
  // dropped rather than trusted.
  if (typeof msg.imageBase64 === 'string' && typeof msg.mimeType === 'string') {
    callbacks?.onAgentImage?.({
      imageBase64: msg.imageBase64,
      mimeType: msg.mimeType as string,
    })
  }
} else if (msg.type === 'usage_snapshot') {
```

In `callCloudAgent`, thread callbacks to the fallback path too — change both `return await runViaHttp(resolvedPayload)` occurrences to `return await runViaHttp(resolvedPayload, callbacks)`.

- [ ] **Step 4: Run and commit**

Run: `npx jest src/services/__tests__/cloudAgentService.agentImage.test.ts`
Expected: 4 PASS.

```bash
git add src/services/cloudAgentService.ts src/services/__tests__/cloudAgentService.agentImage.test.ts
git commit -m "feat(client): funnel agent_image WS frame and HTTP field through onAgentImage"
```

---

### Task 7: Client `useAIChat` ingestion — save through the existing pipeline, carry `imageId` in `message_data` (spec §6.5)

**Files:**
- Modify: `src/hooks/useAIChat.ts` (inside `runCloudAgentTurn`)
- Test: `src/hooks/__tests__/useAIChat.test.tsx`

**Interfaces:**
- Consumes: `onAgentImage` callback (Task 6); `saveCharacterImage` (`~/services/characterImageService`, existing); `findCharacterImageByMessageId` (`~/database/characterImageDatabase`, existing); `generateSecureUuid` (`~/utilities/generateSecureUuid`, existing); the streaming id `aiMsgId` minted in `runCloudAgentTurn` (post-#621: exactly one AI id per stream).
- Produces: assistant row whose `message_data` JSON carries `imageId`; gallery row with `source:'chat'`, `message_id = aiMsgId`. `MessageBubble → ChatImageBubble → useResolvedImage` render untouched (`MessageBubble.tsx:40` already branches on `message.imageId`).

Key ordering invariant (spec §6.5.4): persistence happens **after `callCloudAgent` settles and before `saveAIMessage`**, so `imageId` rides the same write that persists the final reply — surviving #621's clear-after-refetch ordering with zero extra queries.

- [ ] **Step 1: Write the failing tests**

In `src/hooks/__tests__/useAIChat.test.tsx`, add to the imports:

```tsx
import { saveCharacterImage } from '~/services/characterImageService'
import { reportError } from '~/utilities/reportError'

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
```

(`saveCharacterImage` and `reportError` resolve to the existing module mocks — `characterImageService` is mocked at the top of the file; add `setActiveImageId: jest.fn()` to that mock factory so the not-called assertion below has a tripwire target. `reportError` is already mocked.)

Append the describe block:

```tsx
describe('agent chat image ingestion', () => {
  const fireTurnWithImage = async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )

    let resolveTurn!: () => void
    let fireImage!: (img: { imageBase64: string; mimeType: string }) => void
    mockCallCloudAgent.mockImplementation(
      (
        _payload: unknown,
        handlers: {
          onToken?: (text: string) => void
          onAgentImage?: (img: { imageBase64: string; mimeType: string }) => void
        },
      ) =>
        new Promise((resolve) => {
          fireImage = handlers.onAgentImage!
          resolveTurn = () =>
            resolve({
              reply: 'here is your chart',
              toolCalls: ['generate_image'],
              usageSnapshot: { remainingCredits: 800 },
            })
          handlers.onToken?.('drawing…')
        }),
    )

    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.sendMessage(userMessage)
    })
    await waitFor(() => expect(result.current.streamingMessage?.text).toBe('drawing…'))
    const streamedId = result.current.streamingMessage!._id

    await act(async () => {
      fireImage({ imageBase64: 'QUJD', mimeType: 'image/png' })
      resolveTurn()
    })
    await waitFor(() => expect(mockSaveAIMessage).toHaveBeenCalled())
    await sendPromise
    return { streamedId }
  }

  it('persists via saveCharacterImage and carries imageId on the assistant row', async () => {
    const { streamedId } = await fireTurnWithImage()

    expect(saveCharacterImage).toHaveBeenCalledTimes(1)
    expect(saveCharacterImage).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        userId: 'user-1',
        uri: 'data:image/png;base64,QUJD',
        width: 1024,
        height: 1024,
        source: 'chat',
        messageId: streamedId,
      }),
    )
    const savedImageId = (saveCharacterImage as jest.Mock).mock.calls[0][0].imageId as string
    expect(savedImageId).toMatch(UUID_LIKE)

    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'here is your chart',
      streamedId,
      expect.objectContaining({ imageId: savedImageId }),
    )

    // A chat image is a gallery row, never an avatar choice (same rule as photos).
    const imageServiceMock = jest.requireMock('~/services/characterImageService') as {
      setActiveImageId: jest.Mock
    }
    expect(imageServiceMock.setActiveImageId).not.toHaveBeenCalled()
  })

  it('reuses the deduped row id instead of saving twice on retry', async () => {
    const { findCharacterImageByMessageId } = jest.requireMock(
      '~/database/characterImageDatabase',
    ) as { findCharacterImageByMessageId: jest.Mock }
    findCharacterImageByMessageId.mockResolvedValueOnce({ id: 'existing-img-id' })

    const { streamedId } = await fireTurnWithImage()

    expect(saveCharacterImage).not.toHaveBeenCalled()
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'here is your chart',
      streamedId,
      expect.objectContaining({ imageId: 'existing-img-id' }),
    )
  })

  it('keeps the text reply when the local save fails', async () => {
    ;(saveCharacterImage as jest.Mock).mockRejectedValueOnce(new Error('disk full'))

    const { streamedId } = await fireTurnWithImage()

    expect(reportError).toHaveBeenCalled()
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'here is your chart',
      streamedId,
      expect.not.objectContaining({ imageId: expect.anything() }),
    )
  })

  it('persists no imageId on plain text turns', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )
    mockCallCloudAgent.mockResolvedValue({
      reply: 'plain text',
      toolCalls: [],
      usageSnapshot: null,
    })
    await act(async () => {
      await result.current.sendMessage(userMessage)
    })
    expect(saveCharacterImage).not.toHaveBeenCalled()
    const dataArg = mockSaveAIMessage.mock.calls[0][4] as Record<string, unknown>
    expect(dataArg.imageId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/hooks/__tests__/useAIChat.test.tsx`
Expected: new describe FAILS (`onAgentImage` not invoked / no `saveCharacterImage` call); all pre-existing tests stay green.

- [ ] **Step 3: Implement in `useAIChat.runCloudAgentTurn`**

Add import at top:

```typescript
import { generateSecureUuid } from '~/utilities/generateSecureUuid'
```

Inside `runCloudAgentTurn`, just above the `const agentResult = await callCloudAgent(...)` call, declare:

```typescript
// Agent-generated image for this turn. The callback fires during the stream
// (post-loop, just before usage_snapshot); persistence waits for settle so
// imageId rides the SAME saveAIMessage write that persists the reply — that is
// what keeps the render hint alive through #621's clear-after-refetch ordering.
let pendingAgentImage: { imageBase64: string; mimeType: string } | null = null
let agentImageId: string | null = null
```

Extend the callbacks object passed to `callCloudAgent`:

```typescript
onAgentImage: (img) => {
  pendingAgentImage = img
  agentImageId = generateSecureUuid()
},
```

After the call resolves, extend `aiMessageData` handling (insert between the `groundingMetadata` block and `saveAIMessage`):

```typescript
if (pendingAgentImage && agentImageId) {
  try {
    // Same dedupe rule sendPhoto uses: a retried turn finds the row it already
    // wrote instead of spending another FIFO slot on one image.
    const existing = await findCharacterImageByMessageId(aiMsgId, character.id, userId)
    if (!existing) {
      await saveCharacterImage({
        characterId: character.id,
        userId,
        uri: `data:${pendingAgentImage.mimeType};base64,${pendingAgentImage.imageBase64}`,
        width: 1024,
        height: 1024,
        source: 'chat',
        imageId: agentImageId,
        messageId: aiMsgId,
      })
      aiMessageData.imageId = agentImageId
    } else {
      aiMessageData.imageId = existing.id
    }
  } catch (imgErr) {
    // Error-matrix row 4: the text reply stands; the image is lost locally;
    // saveCharacterImage's own rollback cleaned up partial writes.
    reportError(imgErr, `chat:${character.id}:agentImage`)
  }
}
```

No other changes — `saveCharacterImage`/`findCharacterImageByMessageId` are already imported; `source:'chat'` rows skip `setActiveImageId` inside the service itself.

- [ ] **Step 4: Run and commit**

Run: `npx jest src/hooks/__tests__/useAIChat.test.tsx`
Expected: all PASS.

```bash
git add src/hooks/useAIChat.ts src/hooks/__tests__/useAIChat.test.tsx
git commit -m "feat(client): persist agent-generated chat images via saveCharacterImage"
```

---

### Task 8: Save-to-Photos + Share in the viewer (spec §6.6)

**Files:**
- Modify: `package.json` (+`expo-media-library@~57.0.3`, lockfile) — install with `npx expo install expo-media-library` so the Expo 57-compatible line is chosen
- Modify: `app.config.ts` (`ios.infoPlist`)
- Modify: `src/components/ChatImageBubble.tsx`
- Test: `src/components/__tests__/ChatImageBubble.test.tsx` (new)

**Interfaces:**
- Consumes: `useResolvedImage(imageId,'master')` URI already resolved while the viewer is open; `expo-sharing` API used identically to `src/utilities/okfSave.ts:42`.
- Produces: viewer modal gains "Save to Photos" and "Share" actions; failures degrade to an inline notice (gallery/viewer state unaffected).

⚠️ **Native-module note:** this task adds a native dependency. Nothing here ships via OTA — see Task 9's deployment ordering.

- [ ] **Step 1: Install the dependency**

```bash
npx expo install expo-media-library
node -e "console.log(require('./package.json').dependencies['expo-media-library'])"
```

Expected version: `~57.0.3` (from Expo 57's bundledNativeModules.json). If it differs, stop and reconcile against the bundled line.

- [ ] **Step 2: Add the iOS usage string**

In `app.config.ts`, inside `ios.infoPlist` (beside `NSPhotoLibraryUsageDescription`):

```typescript
// Add-only permission for saving agent-generated/chat images (expo-media-library
// writeOnly flow). Read access stays with expo-image-picker's existing prompts.
NSPhotoLibraryAddUsageDescription:
  'Allow Clanker to save images your characters create to your photo library.',
```

(Android needs no manifest entry: `MediaLibrary.saveToLibraryAsync` writes via MediaStore unpermissioned on API 29+; older devices degrade to the notice path below — accepted, matching the spec's toast-degradation row.)

- [ ] **Step 3: Write the failing component tests**

Create `src/components/__tests__/ChatImageBubble.test.tsx`:

```tsx
import React from 'react'
import { fireEvent, render, waitFor } from '@testing-library/react-native'
import ChatImageBubble from '../ChatImageBubble'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'

jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: (imageId: string | null, variant: 'thumb' | 'master') => ({
    uri: imageId ? `file:///cache/${variant}.webp` : null,
    isResolved: !!imageId,
  }),
}))

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(),
  saveToLibraryAsync: jest.fn(),
}))

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}))

const message = {
  _id: 'm1',
  text: '',
  createdAt: new Date(),
  user: { _id: 'char-1' },
  imageId: '11111111-2222-4333-8444-555555555555',
}

function openViewer() {
  const screen = render(<ChatImageBubble currentMessage={message} />)
  fireEvent.press(screen.getByLabelText('Photo in this message'))
  return screen
}

describe('ChatImageBubble viewer actions', () => {
  beforeEach(() => jest.clearAllMocks())

  it('saves the resolved master to the photo library after an add-only grant', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Save to Photos'))

    await waitFor(() =>
      expect(MediaLibrary.saveToLibraryAsync).toHaveBeenCalledWith('file:///cache/master.webp'),
    )
    await waitFor(() => expect(screen.getByText('Saved to Photos')).toBeTruthy())
  })

  it('shows a notice on permission denial and saves nothing', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false })
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Save to Photos'))

    await waitFor(() => expect(screen.getByText('Photo library permission denied')).toBeTruthy())
    expect(MediaLibrary.saveToLibraryAsync).not.toHaveBeenCalled()
  })

  it('shows a notice when the save fails and leaves the viewer usable', async () => {
    ;(MediaLibrary.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true })
    ;(MediaLibrary.saveToLibraryAsync as jest.Mock).mockRejectedValue(new Error('no space'))
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Save to Photos'))

    await waitFor(() => expect(screen.getByText("Couldn't save to Photos")).toBeTruthy())
    expect(screen.getByLabelText('Close photo')).toBeTruthy()
  })

  it('shares the master URI through expo-sharing', async () => {
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Share photo'))

    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/master.webp', {
        mimeType: 'image/webp',
        dialogTitle: 'Share image',
      }),
    )
  })

  it('shows a notice when sharing fails', async () => {
    ;(Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error('no share sheet'))
    const screen = openViewer()

    fireEvent.press(screen.getByLabelText('Share photo'))

    await waitFor(() => expect(screen.getByText("Couldn't share this image")).toBeTruthy())
  })
})
```

- [ ] **Step 4: Run to verify failure**

Run: `npx jest src/components/__tests__/ChatImageBubble.test.tsx`
Expected: FAIL — labels "Save to Photos"/"Share photo" not found.

- [ ] **Step 5: Implement the viewer actions**

Rewrite `src/components/ChatImageBubble.tsx` (full file — thumb/viewer logic unchanged, actions added):

```tsx
/**
 * The photo inside a chat bubble.
 *
 * Renders the 256 thumb, not the master: a scrollback of masters is ~15 MB of
 * decoded bitmaps against ~1.2 MB of thumbs, which is the same reason the picker
 * uses thumbs. The master is resolved only once the user taps through.
 *
 * Save/share arrived with agent image generation (spec §6.6): add-only photo
 * permission, expo-sharing for the sheet; either failing degrades to the inline
 * notice and leaves gallery rows and viewer state untouched.
 */

import { useState } from 'react'
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'
import * as MediaLibrary from 'expo-media-library'
import * as Sharing from 'expo-sharing'
import type { Message } from '~/types/chat'
import { useResolvedImage } from '~/hooks/useResolvedImage'

type PhotoMessage = Message & { imageId?: string }

const THUMB_SIZE = 200

export default function ChatImageBubble({ currentMessage }: { currentMessage?: PhotoMessage }) {
  const imageId = currentMessage?.imageId ?? null
  const [viewerOpen, setViewerOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const { uri: thumbUri, isResolved: thumbResolved } = useResolvedImage(imageId, 'thumb')
  const { uri: masterUri } = useResolvedImage(viewerOpen ? imageId : null, 'master')

  if (!imageId) return null

  const saveToPhotos = async (): Promise<void> => {
    if (!masterUri) return
    try {
      // writeOnly → the add-only prompt backed by NSPhotoLibraryAddUsageDescription.
      const perm = await MediaLibrary.requestPermissionsAsync(true)
      if (!perm.granted) {
        setNotice('Photo library permission denied')
        return
      }
      await MediaLibrary.saveToLibraryAsync(masterUri)
      setNotice('Saved to Photos')
    } catch {
      setNotice("Couldn't save to Photos")
    }
  }

  const shareImage = async (): Promise<void> => {
    if (!masterUri) return
    try {
      if (!(await Sharing.isAvailableAsync())) {
        setNotice('Sharing is not available here')
        return
      }
      await Sharing.shareAsync(masterUri, { mimeType: 'image/webp', dialogTitle: 'Share image' })
    } catch {
      setNotice("Couldn't share this image")
    }
  }

  if (!thumbUri) {
    if (!thumbResolved) return null
    return (
      <View style={styles.placeholder} accessible accessibilityLabel="Photo unavailable">
        <Text variant="labelSmall">Photo unavailable</Text>
      </View>
    )
  }

  return (
    <>
      <Pressable
        onPress={() => {
          setNotice(null)
          setViewerOpen(true)
        }}
        accessibilityRole="imagebutton"
        accessibilityLabel="Photo in this message"
        accessibilityHint="Opens the photo full screen"
      >
        <Image
          source={{ uri: thumbUri }}
          style={styles.thumb}
          resizeMode="contain"
        />
      </Pressable>

      <Modal visible={viewerOpen} transparent onRequestClose={() => setViewerOpen(false)}>
        <Pressable
          style={styles.viewerBackdrop}
          onPress={() => setViewerOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
        >
          {masterUri && (
            <Image
              source={{ uri: masterUri }}
              style={styles.viewerImage}
              resizeMode="contain"
              accessible
              accessibilityLabel="Full size photo"
            />
          )}
          {notice && (
            <View style={styles.noticePill} accessible accessibilityLiveRegion="polite">
              <Text variant="labelMedium" style={styles.noticeLabel}>
                {notice}
              </Text>
            </View>
          )}
          <View style={styles.actionBar}>
            <Pressable
              style={styles.actionButton}
              onPress={saveToPhotos}
              accessibilityRole="button"
              accessibilityLabel="Save to Photos"
            >
              <Text variant="labelLarge" style={styles.actionLabel}>
                Save
              </Text>
            </Pressable>
            <Pressable
              style={styles.actionButton}
              onPress={shareImage}
              accessibilityRole="button"
              accessibilityLabel="Share photo"
            >
              <Text variant="labelLarge" style={styles.actionLabel}>
                Share
              </Text>
            </Pressable>
          </View>
          <Pressable
            style={styles.viewerClose}
            onPress={() => setViewerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close photo"
          >
            <Text variant="labelLarge" style={styles.viewerCloseLabel}>
              Close
            </Text>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 12, margin: 3 },
  placeholder: {
    width: THUMB_SIZE,
    height: 60,
    margin: 3,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '100%' },
  actionBar: {
    position: 'absolute',
    bottom: 48,
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  actionLabel: { color: '#FFFFFF' },
  noticePill: {
    position: 'absolute',
    bottom: 108,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  noticeLabel: { color: '#FFFFFF' },
  viewerClose: {
    position: 'absolute',
    top: 40,
    right: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  viewerCloseLabel: { color: '#FFFFFF' },
})
```

- [ ] **Step 6: Verify the Info.plist key with a prebuild diff (house rule — not just tests)**

```bash
npx expo prebuild -p ios --no-install
grep -A1 NSPhotoLibraryAddUsageDescription ios/*/Info.plist
rm -rf ios
```

Expected: the grep shows the exact string from Step 2. (`ios/` is CNG output — confirm `git status` is clean after cleanup.) Also record that `package.json` overrides / plugins changed the native graph invisibly to tests — this diff IS the verification (memory: verify generated artifacts).

- [ ] **Step 7: Run and commit**

Run: `npx jest src/components/__tests__/ChatImageBubble.test.tsx src/components/__tests__/MessageBubble.test.tsx src/components/__tests__/ChatView.test.tsx`
Expected: all PASS.

```bash
git add package.json package-lock.json app.config.ts src/components/ChatImageBubble.tsx src/components/__tests__/ChatImageBubble.test.tsx
git commit -m "feat(client): save-to-Photos and share for chat image viewer"
```

---

### Task 9: Full verification, deploy, and rollout gates

**Files:**
- No code changes. Verification + deploy only.

**Interfaces:**
- Consumes: everything above; `cloud-agent/scripts/deploy.sh` via `npm run deploy`.

- [ ] **Step 1: Cloud-agent suite**

```bash
cd cloud-agent && npm test 2>&1 | tail -12
```

Expected: all pass; suite count = baseline (288 files / 287 passing + 1 skipped) plus the new test files. Known flakes may flake — rerun those individually before diagnosing.

- [ ] **Step 2: Client scoped suites**

```bash
npx jest src/hooks/__tests__/useAIChat.test.tsx src/services/__tests__/cloudAgentService.agentImage.test.ts src/components/__tests__/ChatImageBubble.test.tsx
```

Expected: green.

- [ ] **Step 3: Typecheck + format check (scoped)**

```bash
npm run typecheck && (cd cloud-agent && npm run typecheck)
npx prettier --check $(git ls-files '*.ts' '*.tsx' | grep -E 'cloud-agent/src/(tools/generateImage|constants/(images|credits)|handlers/wsAgentHandler|index|transportParity)|src/(hooks/useAIChat|services/cloudAgentService|components/ChatImageBubble)')
```

Expected: clean.

- [ ] **Step 4: Deploy cloud-agent, THEN verify traffic landed (spec §10.4)**

```bash
cd cloud-agent && npm run deploy
```

Then — per the Cloud Run 0%-traffic anomaly precedent, ALWAYS confirm the new revision actually took traffic (read `scripts/deploy.sh` first for the exact service name/region, then):

```bash
gcloud run services describe <SERVICE_NAME> --region us-central1 \
  --format='value(status.traffic)'
```

Expected: 100% on the newly created revision. If it shows 0%, canary explicitly (`gcloud run services update-traffic ... --to-revisions <REV>=100`) before declaring deploy done.

- [ ] **Step 5: Manual device gate (spec §9)**

On a dev client / ad-hoc store build containing the new native dep:
1. Ask a cloud-synced character to "draw a bar chart of X" → image bubble renders in the reply.
2. Open viewer → Save → photo appears in Photos; Share → sheet opens.
3. Character gallery contains the image with a chat-message association.
4. Second device → Cloud Sync pull → image appears there too.
5. Ask again in the same reply-context → declining sentence; ask when out of credits → relayed apology; verify credit ledger rows (`image_generate` spend, refund on induced failure).

- [ ] **Step 6: Deployment ORDER warning (OTA fence)**

The mobile JS from Tasks 6–8 imports a NEW NATIVE module. Publishing that bundle via OTA to current store builds (runtimeVersion major 31.x without `expo-media-library` linked) would crash the viewer for every existing install. Sequence strictly: merge PR → store build with the new native dep rolls out → only then publish OTA/JS updates. Server-side (Tasks 1–5) is independently safe to deploy: old clients ignore the `agent_image` frame and the HTTP field (accepted rollout-window edge, spec §6.3).

- [ ] **Step 7: Open the PR to `staging`**

PR body notes: baseline suite numbers, Task 0 spike findings (SKU + price), prebuild-diff confirmation, traffic verification screenshot/output, and the manual-gate checklist state. Per repo workflow, the user merges.

---

## Self-review record

- **Spec coverage:** §6.1→Task 1 · §6.2→Task 2 · §6.3→Tasks 3-5 · §6.4→Task 0 + constants in Task 1 · §6.5→Tasks 6-7 · §6.6→Task 8 · §6.7→Task 7 (`source:'chat'`, union untouched) · §6.8→Task 1 constants + Task 9 ledger check · §7 matrix→covered rows: insufficient (T1 test), refund branches (T1), second-call decline (T1), client-save-failure (T7), old-client/web tolerance (T3/T6 malformed-frame case + T9 step 6 note), empty-collector silence (T3 omission test) · §9 testing→distributed per task · §10 spikes→Tasks 0, 8 (prebuild diff), 9 (traffic) · §11 SEO page→explicitly excluded (own plan). §8 security: behavioral rules live in the tool description (T1), no new auth/storage surface anywhere.
- **Placeholder scan:** none — every code step carries full code; the only "decide" is Task 0's constant value, which is the spec's own plan-stage spike with an explicit decision rule.
- **Type consistency:** `GeneratedImage{imageBase64,mimeType}` (server) ↔ `AgentImagePayload{imageBase64,mimeType}` (client) ↔ wire keys identical; `buildAgent → BuildAgentResult{agent,imageCollector}` destructured consistently in Tasks 2-3; `onAgentImage(image: AgentImagePayload)` signature shared Tasks 6-7; `IMAGE_GENERATION_COST` referenced by name everywhere.

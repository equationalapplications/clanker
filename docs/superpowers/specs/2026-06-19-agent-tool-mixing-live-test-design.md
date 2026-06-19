# Live tool-mixing integration test — design

## Context

`cloud-agent/src/agent.ts:16-33` already wires a built-in tool (`GOOGLE_SEARCH`) alongside multiple custom `FunctionTool`s (tasks, wiki, time, documents, reminders) into one `LlmAgent`. Older Gemini models rejected payloads mixing built-in tools with `functionDeclarations` (HTTP 400). This is currently live in production with no automated check that the combination still works against the real Vertex AI endpoint for the configured model (`gemini-3-flash-preview`).

A user-provided draft proposed a vitest-based integration test (`toolMixing.int.test.ts`) using `agent.interact()` and a fictional `get_open_tasks` tool. That draft does not match this codebase:

- Test runner here is `node:test` (`node --test`), not vitest. No `describe`/`it`/`vi`.
- Tools are `FunctionTool` instances with zod schemas (see `cloud-agent/src/tools/time.ts:4`), not raw `functionDeclarations` objects.
- `LlmAgent` has no `.interact()` method. The real invocation path is `InMemoryRunner` + `runAsync`, with an async event loop collecting tool calls and the final reply — implemented in `cloud-agent/src/index.ts:218-276` as `runAgentReal`.

This spec corrects those mismatches and designs the test against the actual harness.

## Goal

Add a manual/local-only integration test that runs a dual-intent prompt through the real `buildAgent` + `InMemoryRunner` path against the live Vertex AI endpoint, proving:

1. The API call does not throw when `GOOGLE_SEARCH` and a custom `FunctionTool` are both registered.
2. The model actually invokes both tools in response to a prompt that needs both.

This is a regression guard for future ADK/model upgrades, not a pre-deploy gate — it requires real GCP credentials and network access, so it must not run in normal `npm test` / CI.

## Tool pairing

Pair `GOOGLE_SEARCH` with `get_current_time` (`cloud-agent/src/tools/time.ts`), not a fictional tool:

- No DB setup needed — `get_current_time` takes no DB/userId/characterId-dependent state.
- Deterministic to assert on (tool-call name), unlike scraping live weather text out of the reply.

Prompt: `"What time is it right now, and what is the current weather in New York?"`

## Harness reuse

`runAgentReal` in `cloud-agent/src/index.ts:218` already implements the exact production flow (`InMemoryRunner`, session creation, `runAsync`, tool-call extraction, final-reply extraction, error surfacing on `event.errorCode`/`errorMessage`). It is currently unexported.

Change: export it (`export async function runAgentReal(...)`). No other change to `index.ts`. The test imports and calls it directly so it exercises the literal production code path — no duplicated/inline `InMemoryRunner` wiring that could drift from reality.

## Test file

New file: `cloud-agent/src/agent.live.test.ts` (compiles to `dist/cloud-agent/src/agent.live.test.js`, already matched by the existing `npm test` glob `dist/**/*.test.js` — no new build config needed).

Structure, matching `cloud-agent/src/agent.test.ts` conventions (`node:assert/strict`, `node:test`):

```ts
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
```

Field names verified against `RunAgentParams` (`cloud-agent/src/index.ts:24-33`) — match exactly.

No fragile substring-matching on live weather content — that's the draft's main flaw, since weather text varies and the live model isn't mocked.

## Gating

- Skipped by default via the `node:test` per-test `skip` option, keyed on `process.env.RUN_LIVE_TESTS` — zero cost in standard `npm test` / CI runs.
- New `package.json` script: `"test:live": "RUN_LIVE_TESTS=1 npm test"`. Reuses the existing build+glob test script; only the new file's internal skip condition flips.
- Prerequisite (documented, not enforced in code): caller must already have real GCP auth (ADC or `GOOGLE_APPLICATION_CREDENTIALS`) and Vertex AI project config in their shell environment — same as running `cloud-agent` locally. The test does not probe for credentials; if missing, the live call throws and the test fails loudly, which is acceptable for a manual/local-only test.

## Error handling

None added beyond what `runAgentReal` already does. If Vertex AI rejects the tool-mixing payload (the exact regression this test exists to catch), `runAgentReal` throws (`index.ts:253-254`) and the test fails naturally — no need to special-case that path.

## Out of scope

- No CI wiring (explicitly rejected — manual/local only per user decision).
- No new tool fixtures (`get_open_tasks` from the draft is dropped — real `get_current_time` is used instead).
- No changes to `agent.ts` or any production tool registration — the test only adds visibility into existing behavior.

# Spec: Backend Reliability — Wiki Sync Races & Vertex Empty-Response Handling

**Date:** 2026-07-09
**Status:** Implemented
**Depends on:** `expo-llm-wiki` transaction-serialization patch
(`expo-llm-wiki/docs/superpowers/specs/2026-07-09-transaction-serialization-spec.md`)

---

## Problem

Production web testing (2026-07-09) surfaced two independent failure families:

**A. Client wiki transaction races** (wedged SQLite connection):

```text
[wiki:<id>:ontology:write] Failed to write ontology manifest …
  Error code 1: cannot start a transaction within a transaction
  Error code 1: cannot rollback - no transaction is active
importDump timed out after 8000ms
[wiki:sync:batch] Sync timeout for entity … after 60000ms
[liveVoiceMachine] importDump busy (librarian already running …), retrying
```

Two concurrency sources on the single shared `_wiki` connection
(`src/services/wikiService.ts`):

1. `wikiOrchestrator.syncAll` (`src/services/wikiOrchestrator.ts`) runs entity syncs
   with `concurrency = 2`; the per-entity xState actors serialize work _within_ an
   entity but not _across_ entities.
2. `wikiOrchestrator.getOrSpawn` fires a **fire-and-forget ontology bootstrap**
   (`void wiki.getOntologyManifest(...).then(setOntologyManifest)`) entirely outside
   the actor queue — it races every other wiki transaction even at concurrency 1.

**B. Cloud function 500s on empty Vertex responses:**

```text
POST …/summarizeText 500 — FirebaseError: INTERNAL
POST …/wikiLlm 500 — FirebaseError: Model returned an empty response.
```

`gemini-3.5-flash` intermittently returns candidates with no text parts. This is a
known, already-solved problem in this codebase — `functions/src/generateReply.ts`
retries once on retryable `finishReason`s and logs diagnostics — but the pattern was
never shared. `summarizeText`, `wikiLlm`, `memoryFunctions` (heal), and
`convertDocumentText` each have their own divergent copy of the Vertex client with
**no retry and no `finishReason`/`promptFeedback` logging**, so every empty response
becomes an opaque client-facing 500. `wikiLlm` is additionally more empty-prone: it
requests JSON mode with a degenerate `responseSchema: {type: OBJECT}` (no
properties) and `thinkingBudget: 0`.

`wikiLlm` failures compound family A: the client librarian
(`src/services/wikiLlmProvider.ts`) calls `wikiLlm`, so its 500s fail librarian runs
feeding the same sync pipeline the transaction races already wedge.

---

## Fix 1 — Adopt patched `expo-llm-wiki`

Bump `@equationalapplications/expo-llm-wiki` (and transitively `core-llm-wiki`) to
the release carrying internal transaction serialization. This alone eliminates the
nested-`BEGIN` / phantom-`ROLLBACK` errors and the wedged-connection cascade.

**Consequence:** `syncAll`'s `concurrency = 2` becomes safe and stays. The network
phase of each entity sync (`runRemoteSync` → `wikiSync` callable) still overlaps;
local transactional phases serialize inside the package. No orchestrator concurrency
change needed.

---

## Fix 2 — Ontology bootstrap goes through the actor

### Current behavior (`wikiOrchestrator.ts:54-60`)

On actor spawn: unawaited `getOntologyManifest` → if missing or `mode === 'off'`,
`setOntologyManifest(empty, emergent)`. Problems:

- Runs outside the actor's event queue → logical race: it can interleave with (or
  land _after_) a sync that just imported a real manifest from the cloud. The
  package-level mutex makes this _safe_ at the SQLite layer but not _correct_ at the
  ordering layer.
- Failure is only `console.warn` — invisible in production.

### New behavior

`wikiMachine` gains an initial `bootstrapping` state:

```text
initial: 'bootstrapping'
bootstrapping:
  invoke: bootstrapOntologyActor   # getOntologyManifest → conditional setOntologyManifest
  onDone: → idle                   # flushPending then drains anything queued during bootstrap
  onError: → idle                  # log via reportWikiOp…, non-fatal (matches current warn semantics)
```

- Events arriving during bootstrap are already handled: the machine's root `on`
  handlers append to `pendingEvents`, and `idle`'s `flushPending` entry action drains
  them. Bootstrap is therefore strictly ordered **before** the first read / write /
  sync for that entity — the overwrite race disappears.
- `getOrSpawn` drops the `void …` block entirely.
- Preserved behavior to re-verify in review: bootstrap intentionally resets a
  manifest whose mode is `'off'` to an **empty** emergent manifest (existing
  semantics; carried over as-is).
- Bootstrap errors keep non-fatal semantics but upgrade from `console.warn` to the
  existing `reportWikiOpForCharacter` reporting path with tag
  `wiki:<id>:ontology:bootstrap`.

### Tests

- `wikiMachine.test.ts`: SYNC sent immediately after spawn runs only after bootstrap
  resolves; bootstrap failure still reaches idle and processes queued events.
- `wikiOrchestrator.test.ts`: existing suites pass with the bootstrap block removed
  from `getOrSpawn`.

---

## Fix 3 — Shared Vertex text helper with empty-response retry

New module `functions/src/services/vertexText.ts` consolidating what
`generateReply.ts:318-409` already proved out:

```ts
export function getGenAIClient(): GoogleGenAI // singleton, vertexai + global location
export const NON_RETRYABLE_EMPTY_RESPONSE_FINISH_REASONS = new Set(['MAX_TOKENS', 'SAFETY'])
export function isRetryableEmptyResponseFinishReason(reason: string | undefined): boolean

export async function generateTextWithRetry(params: {
  model: string
  contents: Content[] | string
  config: GenerateContentConfig // caller controls systemInstruction, tokens, thinking, schema…
  logContext: string // e.g. "summarizeText", "wikiLlm", "memoryHeal"
}): Promise<{ text: string; candidate: Candidate }>
```

Behavior (lifted from `generateReply`, now shared):

1. Call `generateContent`; return first candidate with non-empty joined text parts.
2. On empty: retry **once** iff no candidates or any candidate has a retryable
   `finishReason`.
3. **Always log** `finishReasons`, `candidateCount`, and `promptFeedback` (warn on
   retry, error on final failure) tagged with `logContext` — closes the current
   diagnostic blackout.
4. Still empty → throw `HttpsError("internal", "Model returned an empty response.")`;
   callers keep their existing credit-refund `catch` blocks unchanged.

### Adoption

| Function                                        | Change                                                                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `summarizeText.ts`                              | Replace private client + candidate loop with helper                                                                                               |
| `wikiLlm.ts`                                    | Same, plus Fix 4 config changes                                                                                                                   |
| `memoryFunctions.ts` (`defaultGenerateContent`) | Replace; **also fixes a latent bug** — it currently returns `''` on empty response instead of failing, silently corrupting heal/write-diff output |
| `convertDocumentText.ts`                        | Replace private client + loop                                                                                                                     |
| `generateReply.ts`                              | Migrate to shared client + retry predicate; keeps its own loop for `functionCalls` / `groundingMetadata` handling on top of the shared pieces     |

Existing per-function tests keep passing by injecting `generateText` /
`generateContent` fakes exactly as today (the DI seams don't move).

---

## Fix 4 — `wikiLlm` model config

Two changes to `getTextGenerator` (`functions/src/wikiLlm.ts:94-122`):

1. **Drop `responseSchema: {type: Type.OBJECT}`.** An object schema with no
   properties gives constrained decoding a degenerate grammar and is a plausible
   direct driver of the empty responses. Keep
   `responseMimeType: "application/json"` — the librarian prompt (from
   `core-llm-wiki`) fully specifies the JSON shape, and the client parses/validates
   it. (Supplying a real schema is rejected: the librarian response shape is owned by
   the package prompt and would create a second, drift-prone source of truth in
   Clanker.)
2. **Raise `thinkingBudget` 0 → 1024** (see Fix 5).

---

## Fix 5 — `thinkingBudget` policy per function

`thinkingBudget: 0` everywhere was a latency/cost choice. For structured-reasoning
endpoints it is suspect for quality and possibly implicated in empties. New policy:

| Function                                            | Budget        | Rationale                                                                          |
| --------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `wikiLlm` (librarian)                               | **1024**      | Background job; structured JSON reasoning over the memory graph; quality > latency |
| `memoryFunctions` heal / write-diff / contradiction | **1024**      | Same profile: background, structured, correctness-critical                         |
| `generateReply` (chat)                              | 0 (unchanged) | Interactive latency budget                                                         |
| `summarizeText`                                     | 0 (unchanged) | Simple compression task; retry (Fix 3) covers empties                              |
| `convertDocumentText`                               | 0 (unchanged) | Mechanical transform                                                               |

Budgets become named constants next to each function's `MAX_OUTPUT_TOKENS`. If
empties persist on the budget-0 functions after Fix 3 ships, raising their budgets is
the documented next lever (revisit with the new `finishReason` telemetry).

---

## Rollout order

1. Release `expo-llm-wiki` patch (separate repo, already specced).
2. Clanker PR 1 (client): dependency bump + Fix 2. Verify on web prod-mirror:
   character save with cloud sync + Talk-tab entry no longer log transaction errors
   or sync timeouts.
3. Clanker PR 2 (functions): Fixes 3–5. Verify: `summarizeText` / `wikiLlm` 500 rate
   drops; Cloud Logging shows `finishReasons` on any residual empties.

PRs target `staging` per `docs/GIT_WORKFLOW.md`.

---

## Out of scope

- `withExclusiveTransactionAsync` investigation (tracked in the package spec).
- Edge/cloud agent grounding-tool split (unrelated; see
  `docs/edge-agent.md`).
- Credit-ledger changes — refund paths are already correct and untouched.

# Phase 2 — Edge Agent Tool Execution Loop, Silent Ontology Bootstrap, Status UI Cleanup

Date: 2026-06-23
Status: Draft

## Goal

Phase 1 (`docs/superpowers/specs/2026-06-23-cloud-ontology-graph-traversal-design.md`, merged to `staging`) built the cloud side of graph/ontology support: Postgres schema, `wikiSync.ts` edge persistence, and `cloud-agent`'s `wiki_get_ontology_manifest`/`wiki_traverse_graph` tools. This phase covers the edge side, explicitly deferred by phase 1's "Out of scope" list:

1. **Edge agent tool execution loop** — resurrect the on-device multi-turn tool-calling loop (deleted in commit `014ecaa1` for an unrelated reason — see below), re-pointed at a secure backend proxy instead of a client-embedded API key, and extend it with the two new graph tools.
2. **Silent ontology-mode bootstrap** — every character gets `emergent` ontology mode automatically; no user-facing UI. `strict` mode is not exposed at this time.
3. **`ChatView` status-hook cleanup** — replace two of the banner's manual `wikiMachine`/XState conditions with the package's `useEntityStatus` hook.

## Why the premise needed correcting

The original draft assumed an edge app that "evaluates whether to use a tool" via a local Gemini call, just missing executor wiring. That's not the current state. Investigation found:

- `src/hooks/useEdgeAgent.ts` is a stub: `sendMessage()` unconditionally returns `{ escalated: true }`. Its own code comment explains why: the prior implementation called `@google/genai` directly from the client with `EXPO_PUBLIC_GEMINI_API_KEY` embedded in the bundle. That key got abuse-flagged and revoked, and direct client-side model calls violate the documented policy in `docs/ai-and-chat.md` ("the app makes no client-side GenAI model calls").
- Commit `014ecaa1` (`fix: gemini 3 models require global vertex ai location, not us-central1`) deleted `src/services/edgeToolExecutors.ts` and `src/services/clankerManifests.ts` outright, and gutted `useEdgeAgent.ts`, specifically to close out that exposure.
- The policy is about **inference**, not **orchestration**. Client-side code may still own the multi-turn loop and execute tools locally — it just cannot call the Gemini API directly with an embedded key. It must delegate the inference step to a secured backend (Firebase callable, App Check + server-side Vertex credentials).
- `cloud-agent` already has its own independent, fully server-side tool-calling loop (ADK `FunctionTool`, Postgres-backed) reached via `callCloudAgent`/`useAIChat.ts`'s "Cloud Agent path." That's a separate tier for cloud-synced characters and harder tasks (e.g. `escalate_to_cloud_agent`) — it is not a substitute for the edge loop, because the edge loop's whole purpose is to operate on the **local SQLite** memory (`@equationalapplications/expo-llm-wiki`) that cloud-agent never sees directly. Both loops coexist by design, as they did before the deletion.
- Phase 1's cloud-agent ontology/graph tools (`cloud-agent/src/tools/ontology.ts`, registered in `cloud-agent/src/agent.ts`) are already complete and out of scope here — this phase is edge-only.

Given this, the correct fix is: restore the deleted local-orchestration code, and swap its one disqualifying line (the direct `@google/genai` call) for a call to the existing `generateReply` Firebase callable, extended to support multi-turn function calling.

## Section 1: Edge agent tool execution loop

### Restore `src/services/edgeToolExecutors.ts`

Restore from `git show 014ecaa1^:src/services/edgeToolExecutors.ts` verbatim — `ToolExecutor` type, `edgeToolExecutors` (currently just `get_current_time`), and `createEdgeToolExecutors(characterId, wiki)` factory wrapping `wiki_read`, `wiki_write`, `create_task`, `list_tasks`, `update_task`, `complete_task`, `delete_task`, `document_search`, and the `set_reminder` escalation phantom tool. These must all be restored together, not just the two new graph tools — `getSchemasForEdge()` (unchanged, in `shared/agent-tools-spec.ts`) advertises all of them to the model regardless of which executors exist, and a tool advertised with no executor behind it makes the loop silently feed the model `null`.

Add two new executors to the factory:

```ts
wiki_get_ontology: async () => {
  if (!wiki) return JSON.stringify({ mode: 'off', manifest: null })
  try {
    const result = await wiki.getOntologyManifest(characterId)
    return JSON.stringify(result ?? { mode: 'off', manifest: null })
  } catch (error) {
    console.error('[EdgeAgent] wiki_get_ontology failed:', error)
    return JSON.stringify({ mode: 'off', manifest: null })
  }
},
wiki_traverse_graph: async (args) => {
  try {
    const sourceId = typeof args.sourceId === 'string' ? args.sourceId.trim() : ''
    if (!wiki || !sourceId) return 'Failed to traverse graph: sourceId is required.'
    const maxDepth = typeof args.maxDepth === 'number' ? args.maxDepth : undefined
    const direction = args.direction as 'inbound' | 'outbound' | 'both' | undefined
    const edgeTypes = Array.isArray(args.edgeTypes) ? args.edgeTypes as string[] : undefined
    const neighborhood = await wiki.traverseGraph(characterId, { sourceId, maxDepth, direction, edgeTypes })
    return formatGraphContext(neighborhood)
  } catch (error) {
    console.error('[EdgeAgent] wiki_traverse_graph failed:', error)
    return 'Failed to traverse graph due to an internal error.'
  }
},
```

`formatGraphContext` imported from `@equationalapplications/core-llm-wiki`. Add `@equationalapplications/core-llm-wiki` as an explicit dependency in root `package.json` (version `4.17.0`, matching the other wiki packages already pinned there) rather than relying on it resolving as a transitive/phantom dependency of `expo-llm-wiki`.

Both tools' schemas added to `shared/agent-tools-spec.ts`'s `agentToolSpec` array, tier `'edge-only'` (mirrors the existing entries' shape; `cloud-agent` does not consume this file — it re-declares its own zod schemas separately, as established in phase 1):

```ts
{
  name: 'wiki_get_ontology',
  tier: 'edge-only',
  description: "Retrieve the current ontology manifest (allowed node types and edge types) for the user's memory. Use this to understand the structure of the knowledge graph before traversing it.",
  parameters: { type: 'object', properties: {}, required: [] },
},
{
  name: 'wiki_traverse_graph',
  tier: 'edge-only',
  description: 'Traverse the knowledge graph starting from a specific fact ID to discover connected concepts and relationships. Returns a formatted neighborhood subgraph.',
  parameters: {
    type: 'object',
    properties: {
      sourceId: { type: 'string', description: 'The exact ID of the starting fact node (obtained from a previous wiki_read call).' },
      maxDepth: { type: 'integer', minimum: 1, maximum: 3, description: 'How many relationship hops to traverse. Maximum allowed is 3.' },
      direction: { type: 'string', enum: ['inbound', 'outbound', 'both'], description: "Direction of relationships to follow. Default 'both'." },
      edgeTypes: { type: 'array', items: { type: 'string' }, description: 'Optional filter. If provided, traversal only follows these edge types.' },
    },
    required: ['sourceId'],
  },
},
```

Note: unlike the cloud-agent and core-llm-tools manifest versions, this schema has no `entityId` parameter — the edge executor already has `characterId` bound via closure, consistent with how `wiki_read`/`wiki_write` work today.

### Restore `src/hooks/useEdgeAgent.ts`

Restore the `MAX_ITERATIONS = 5` while-loop structure from `git show 014ecaa1^:src/hooks/useEdgeAgent.ts`, with these changes:

- Replace the `new GoogleGenAI({ apiKey })` client and its `ai.models.generateContent(...)` call with a call to `generateChatReply()` (`src/services/chatReplyService.ts`), extended per Section 2 below, passing `tools: getSchemasForEdge(!!wiki, isCloudSynced)`.
- Remove the `EXPO_PUBLIC_GEMINI_API_KEY` early-return branch entirely — there is no API key on the client anymore, so the loop runs unconditionally for all users.
- Response shape from `generateChatReply` gains an optional `functionCalls`. If present, the loop executes them via `createEdgeToolExecutors(character.id, wiki)` exactly as before (escalation phantom-tool check, `functionResponse` parts pushed back into `contents`, loop continues). If absent, return `{ escalated: false, text: result.reply }`.
- Model name: use the same model the rest of the app already standardized on (`gemini-3.5-flash`, matching `functions/src/generateReply.ts`'s `DEFAULT_MODEL`), not the old code's stale `gemini-2.5-flash` — the model is actually selected server-side now (see Section 2), so `useEdgeAgent.ts` no longer needs its own `GEMINI_MODEL` constant at all.
- Loop iteration cap stays `MAX_ITERATIONS = 5`; on exhaustion, same fallback as before (escalate if cloud-synced, otherwise return unescalated with no text — `useAIChat.ts` falls through to the Firebase path either way).

## Section 2: `generateReply` — multi-turn function calling support

`functions/src/generateReply.ts` must support being called once per round-trip of the edge loop (tool-decision steps and the final text-bearing reply), in addition to its existing single-shot callers (`sendMessageWithAIResponse`, `sendCharacterIntroduction`, which never send `tools` and are unaffected).

### Request: accept `tools` and richer `contents`

- `GenerateReplyData` gains `tools?: { name: string; description: string; parameters: object }[]`.
- Validate each tool's `name` against a server-side allow-list of known tool names (the full `agentToolSpec` name list from `shared/agent-tools-spec.ts`'s edge/both tiers, hardcoded as a `Set<string>` in `generateReply.ts` — not imported from `shared/`, since `functions/`'s `tsconfig.json` has `rootDir: "src"` and can't reach the repo-root `shared/` directory without restructuring its build; the client already constructs the schema array itself via `getSchemasForEdge()` and sends it as data, so the server only needs to defend against unexpected tool *names*, not re-derive the schemas). Reject with `invalid-argument` on any unrecognized name.
- `validateStructuredContents` (currently requires every part to have a string `text`) must also accept `functionCall: { name: string; args?: object }` and `functionResponse: { name: string; response: object }` parts, since the loop pushes those into `contents` between rounds. A content item's parts array may now contain a mix of `text`, `functionCall`, and `functionResponse` parts.

### Response: surface `functionCalls`

- `getTextGenerator`'s inner loop currently scans `candidate.content?.parts` for text only, and throws `HttpsError('internal', 'Model returned an empty response.')` if none is found. Change it to first check `result.functionCalls` (the SDK already parses these) — if present and non-empty, return `{ functionCalls: result.functionCalls }` instead of text. Only throw the empty-response error when there is neither text nor a function call.
- `GenerateReplyResponse` gains optional `functionCalls?: { name: string; args?: Record<string, unknown> }[]`.
- When `tools` is provided in the request, omit the existing hardcoded `googleSearchManifest` tool for that call — Gemini does not support mixing `googleSearch` with custom `functionDeclarations` in one request. Non-tool callers (intro, plain chat) are unaffected and keep getting `googleSearch` grounding as today.

### Billing

Charge 1 credit per `generateReply` call, unchanged — no special-casing between tool-decision rounds and the final reply. A complex multi-round-trip turn costs proportionally more, by design (confirmed: this is intentional, reflecting real compute cost, and is a deliberate divergence from cloud-agent's current single-charge-per-turn model — not something this phase changes on the cloud-agent side).

### Client-side wiring

`src/services/chatReplyService.ts`'s `generateChatReply()` gains a `tools` passthrough parameter and a `functionCalls` field on its return type, mirrored from the Firebase callable's new contract.

## Section 3: Silent ontology-mode bootstrap (no UI)

No changes to the Character Edit screen. `strict` mode and the taxonomy builder are not exposed to users at this time — every character is bootstrapped into `emergent` mode automatically, with an empty manifest (which is valid: `node_types`/`edge_types` are required arrays but may be empty — emergent mode discovers its own types rather than working from a predefined taxonomy).

### Bootstrap location

`src/services/wikiOrchestrator.ts`'s `getOrSpawn(entityId, wiki, machineOptions?)` is where per-character actors are created and cached by entity ID — this guarantees the check below runs at most once per entity per app session, not on every component render that calls into the orchestrator.

On actor creation (not on cache-hit return), before returning the actor:

```ts
void wiki.getOntologyManifest(entityId).then((existing) => {
  if (!existing || existing.mode === 'off') {
    return wiki.setOntologyManifest(entityId, { node_types: [], edge_types: [] }, { mode: 'emergent' })
  }
}).catch((error) => {
  console.warn(`Failed to bootstrap emergent ontology mode for ${entityId}:`, error)
})
```

Fire-and-forget (matches the existing pattern for non-blocking wiki writes elsewhere in the app, e.g. `useAIChat.ts`'s `onWriteObservation`). Idempotent: once a row exists with `mode: 'emergent'`, subsequent app sessions see `existing.mode === 'emergent'` and skip the write. Self-healing for characters created before this phase shipped — no migration script needed. Characters created after this phase ships get the row on their first `getOrSpawn` call, which happens as part of normal wiki setup (`useCharacterWiki`'s underlying actor spawn), not as a separate "character creation" hook.

### Ontology sync fix (Postgres)

Without this, the bootstrap above only ever reaches local SQLite — `cloud-agent`'s Postgres-backed `wiki_get_ontology_manifest` tool would keep reading the `'off'` default for every character, defeating the bootstrap whenever a conversation escalates to cloud-agent. Mirrors phase 1's edge-sync pattern exactly:

- `MemoryBundle` (local interface in `functions/src/wikiSync.ts`) gains `ontology?: WikiOntology`, with a new local hand-rolled `interface WikiOntology { mode: 'strict' | 'emergent' | 'off'; manifest: { node_types: { type: string; description: string }[]; edge_types: { type: string; source_type: string; target_type: string; description: string }[] } }` — matching the file's existing convention of local interfaces for `WikiFact`/`WikiTask`/`WikiEvent`/`WikiEdge` rather than importing package types.
- `wikiSync.ts` persistence: upsert into `llmWikiOntology` on `(entityId, userId)` conflict — unlike edges (dedupe-only) and unlike facts/tasks (LWW via `updated_at`), ontology mode/manifest should use `onConflictDoUpdate` keyed on the local SQLite row being authoritative (mode/manifest changes are infrequent, single-writer-per-entity by construction since only the bootstrap and — eventually — a future strict-mode UI would ever write it).
- Read-back: select the `(entityId, userId)` row into `remoteDump.ontology`.
- `src/hooks/useCharacterWiki.ts`'s `sync()`: add `ontology: localBundle.ontology` to the local→cloud direction (no entity-ID remap needed beyond what `edges` already does, since this is a single object, not an array), and the equivalent remap back for cloud→local.

## Out of scope

- `strict` ontology mode and any taxonomy-editing UI — explicitly deferred; `emergent` only, for all characters, for now.
- Refactoring `cloud-agent`'s ADK loop to charge per internal tool-call step (raised as a future-parity idea during design, not part of this phase — cloud-agent keeps its existing single-charge-per-turn billing).
- Any change to the "Cloud Agent path" tier in `useAIChat.ts` (lines 124-209) — it continues to call `cloud-agent` directly for cloud-synced characters with a `cloud_id`, independent of the edge loop's own `escalate_to_cloud_agent` tool decision.
- `document_search`'s local implementation — its restored executor keeps the prior placeholder behavior ("Document search is not yet available on device."); building real on-device document search is a separate feature.
- Backfilling existing characters' ontology rows via a one-time migration script — the lazy bootstrap-on-first-`getOrSpawn` check handles this without one.

## Testing

- `src/services/__tests__/edgeToolExecutors.test.ts` — restore prior coverage (per `git show 014ecaa1^` history) plus new tests for `wiki_get_ontology` (wiki present/absent, manifest present/absent) and `wiki_traverse_graph` (missing `sourceId`, successful traversal calling `formatGraphContext`, `wiki.traverseGraph` throwing).
- `src/hooks/__tests__/useEdgeAgent.test.ts` — restore prior coverage, updated to mock `generateChatReply` instead of `GoogleGenAI`; cover the functionCalls round-trip, `MAX_ITERATIONS` exhaustion, and the `set_reminder` escalation phantom-tool path.
- `functions/src/generateReply.test.ts` — new cases: `tools` round-trips with an unrecognized tool name (rejected), `contents` containing `functionCall`/`functionResponse` parts (accepted), a model response containing `functionCalls` (returned in the response shape instead of throwing on empty text), `tools` present alongside the implicit `googleSearch` omission.
- `functions/src/wikiSync.test.ts` (or equivalent) — ontology bundle round-trip: local `emergent` mode + empty manifest persists to Postgres and reads back unchanged.
- `src/services/__tests__/wikiOrchestrator.test.ts` — bootstrap fires `setOntologyManifest` only when existing mode is `'off'`/absent, and is skipped on subsequent `getOrSpawn` calls for the same entity once `emergent` is set.

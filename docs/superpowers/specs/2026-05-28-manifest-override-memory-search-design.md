# Manifest Override Pattern + Local `search_memory` Tool

**Date:** 2026-05-28
**Status:** Implemented
**Branch:** `main` (formerly `kv/fixes`)
**Approach:** Minimal Scope + Options Injection (Option B)

---

## Problem

The edge agent (`useEdgeAgent`) uses generic tool manifests from `@equationalapplications/core-llm-tools`. Two observed failure modes:

1. LLM hallucinates "rustic" time responses instead of calling `get_current_time`.
2. LLM tries to escalate memory lookups to the cloud instead of searching locally.

Additionally, there is no local `search_memory` tool — the agent cannot query the user's on-device wiki/memory at all during edge sessions.

A third pre-existing bug: `useEdgeAgent.ts:84` checks for `'escalate_to_cloud'` but the manifest's actual name is `'escalate_to_cloud_agent'`, making escalation detection silently broken.

---

## Goals

- Override generic tool descriptions with Clanker-specific directives that enforce correct tool-calling behavior.
- Add a `search_memory` tool that queries local wiki memory via the existing `readFromWiki` abstraction.
- Fix the `escalate_to_cloud` name mismatch bug.
- Upgrade the tool execution loop to handle async executors via `Promise.all` (required for `search_memory`, also supports Gemini parallel function calling).
- Keep `useEdgeAgent` a decoupled state machine — no direct React context access for wiki.

---

## Non-Goals

- Do not modify `@equationalapplications/core-llm-tools` or its `package.json`.
- Do not add raw SQLite/Drizzle queries — use `readFromWiki` exclusively.
- Do not add a `ToolRegistry` abstraction (YAGNI — only 3 tools).

---

## Architecture

### Files Changed

| File | Change |
|---|---|
| `src/services/clankerManifests.ts` | **NEW** — tool schema overrides |
| `src/services/edgeToolExecutors.ts` | Add `createEdgeToolExecutors(characterId, wiki)` factory |
| `src/hooks/useEdgeAgent.ts` | Add `wiki` to options; use clanker manifests; async loop |
| `src/hooks/useAIChat.ts` | Add `useWiki()` call; pass wiki into `useEdgeAgent` options |

### Tests Updated (no new test files)

| File | Change |
|---|---|
| `src/hooks/__tests__/useEdgeAgent.test.ts` | Update mock for new manifest import path; add `search_memory` mock; fix `escalate_to_cloud_agent` name |
| `src/services/__tests__/edgeToolExecutors.test.ts` | Add factory + `search_memory` tests |

---

## Component Design

### `src/services/clankerManifests.ts` (new)

Imports `getCurrentTimeManifest` and `escalateToCloudManifest` from `@equationalapplications/core-llm-tools`. Spreads each schema and overwrites `description` only.

```ts
export const clankerTimeSchema = {
  ...getCurrentTimeManifest.schema,
  description: 'CRITICAL: ALWAYS call this tool immediately if the user asks for the current time, date, day of the week, or uses relative temporal words (today, tomorrow). Do not guess or fabricate the time.',
}

export const clankerEscalationSchema = {
  ...escalateToCloudManifest.schema,
  description: 'Escalate complex workflows or writing tasks. CRITICAL: Do NOT use this tool for reading memory, checking the time, or casual chatting.',
}

export const clankerMemorySchema = {
  name: 'search_memory',
  description: "Search the user's local long-term memory and wiki. ALWAYS use this tool if the user asks you to recall something previously discussed or look up a fact.",
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}
```

**Note:** `clankerEscalationSchema` inherits `name: 'escalate_to_cloud_agent'` from the spread — this is correct and fixes the name mismatch.

---

### `src/services/edgeToolExecutors.ts`

`ToolExecutor` return type updated to `unknown | Promise<unknown>`.

Static map retained for stateless tools. New factory added:

```ts
export function createEdgeToolExecutors(characterId: string, wiki: Wiki | null): Record<string, ToolExecutor> {
  return {
    ...edgeToolExecutors,
    search_memory: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!wiki || !query) return 'No relevant memories found.'
        const results = await readFromWiki(wiki, characterId, query)
        const hasMemories = results.facts.length > 0 || results.tasks.length > 0 || results.events.length > 0
        return hasMemories ? JSON.stringify(results) : 'No relevant memories found.'
      } catch (error) {
        console.error('[EdgeAgent] Local memory search failed:', error)
        return 'No relevant memories found.'
      }
    },
  }
}
```

`readFromWiki` and `Wiki` type imported from `~/services/wikiService`.

---

### `src/hooks/useEdgeAgent.ts`

**Options interface:**

```ts
export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: IMessage[]
  isCloudSynced: boolean
  wiki: Wiki | null   // injected by caller
}
```

**Manifest imports** — remove `@equationalapplications/core-llm-tools` import; add:
```ts
import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema } from '~/services/clankerManifests'
```

**Tool declarations:**
```ts
const functionDeclarations = [clankerTimeSchema]
if (wiki) functionDeclarations.push(clankerMemorySchema)
if (isCloudSynced) functionDeclarations.push(clankerEscalationSchema)
```

**Executor instantiation** (inside `sendMessage`, before the while loop):
```ts
const toolExecutors = createEdgeToolExecutors(character.id, wiki)
```

**Async execution loop** — replaces the synchronous `functionCalls.map`:

```ts
let escalated = false

const responseParts = await Promise.all(
  functionCalls.map(async (fc) => {
    const name = fc.name ?? ''
    if (name === 'escalate_to_cloud_agent') {
      escalated = true
      return null
    }
    const executor = toolExecutors[name]
    const output = executor ? await executor(fc.args ?? {}) : null
    return { functionResponse: { name, response: { output } } }
  })
)

if (escalated) {
  setEscalationState('escalating')
  return { escalated: true }
}

// Append model turn
contents.push({
  role: 'model',
  parts: functionCalls.map((fc) => ({ functionCall: fc })),
} as Content)

// Append function responses (filter nulls, though none should appear if not escalated)
contents.push({
  role: 'user',
  parts: responseParts.filter(Boolean) as Part[],
} as Content)
```

**`useCallback` deps:** add `wiki` to dependency array. `useWiki()` returns a stable reference from its context provider — this is safe and does not cause `sendMessage` churn on re-renders.

**Additional import needed:** `Part` from `@google/genai` (for the `responseParts.filter(Boolean) as Part[]` cast).

---

### `src/hooks/useAIChat.ts`

Add `useWiki` import from `@equationalapplications/expo-llm-wiki`.

```ts
const wiki = useWiki()

const edgeAgent = useEdgeAgent({
  character,
  userId,
  priorMessages: messages,
  isCloudSynced,
  wiki,
})
```

---

## Data Flow

```
useAIChat
  │
  ├─ wiki = useWiki()
  └─ useEdgeAgent({ ..., wiki })
        │
        ├─ toolExecutors = createEdgeToolExecutors(character.id, wiki)
        │    ├─ get_current_time  (stateless, sync)
        │    └─ search_memory     (wiki-bound, async)
        │
        └─ while loop (max 5 iterations)
             │
             ├─ generateContent() → functionCalls[]
             │
             ├─ Promise.all(functionCalls.map(async fc => {
             │    if 'escalate_to_cloud_agent' → set flag, return null
             │    else → await toolExecutors[fc.name](fc.args)
             │           → return functionResponse part
             │  }))
             │
             ├─ if escalated → break → return { escalated: true }
             └─ else → push model turn + function responses → next iteration
```

### `search_memory` internals

```
args.query
  → readFromWiki(wiki, characterId, query)
      → wiki.read() [vector + hybrid search via expo-llm-wiki]
      → { facts[], tasks[], events[] }
  → hasMemories check (deep — avoids empty-object false positives)
  → JSON.stringify(results) | "No relevant memories found."
```

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `wiki` is null (not initialized) | `search_memory` returns "No relevant memories found." — no throw |
| `query` is empty/missing | Same — early return |
| `readFromWiki` throws | Propagates up; caught by outer `try/catch` in `sendMessage` → escalates to Firebase (existing behavior) |
| Executor not found for tool name | `output = null` — existing behavior retained |
| Escalation detected mid-`Promise.all` | Flag set; loop breaks after `Promise.all` resolves; no unhandled rejections |

---

## Testing

### `edgeToolExecutors.test.ts`
- `createEdgeToolExecutors` returns map containing `search_memory`
- `search_memory` returns JSON string when `readFromWiki` returns data
- `search_memory` returns "No relevant memories found." when all arrays empty
- `search_memory` returns "No relevant memories found." when `wiki` is null
- `get_current_time` still works from factory output

### `useEdgeAgent.test.ts`
- Mock import changed from `@equationalapplications/core-llm-tools` to `~/services/clankerManifests`
- Escalation test uses `escalate_to_cloud_agent` (was `escalate_to_cloud`)
- Tool-not-included test checks `escalate_to_cloud_agent` name
- New: `search_memory` in mock executor map returns fixture string
- New: verify `wiki` passed through options reaches factory call

---

## Constraints

- `@equationalapplications/core-llm-tools` — read only, never modified
- `expo-llm-wiki` tables — accessed only via `readFromWiki`, never raw SQL
- `useEdgeAgent` — does not call any React hook for wiki; receives it via options
- Schema descriptions — exact strings from approved spec (no paraphrase)

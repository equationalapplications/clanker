# Edge Memory Writing — `write_observation` Tool Spec

**Date:** 2026-06-01
**Status:** Implemented
**Branch:** `kv/fixes`
**Scope:** Phase 3 of the edge-agent architectural upgrades. Add a `write_observation` tool so the local Gemini edge loop can proactively persist user observations to the local SQLite wiki without escalating to Firebase.

**Related Docs:**
- Phase 1: [Edge Agent Chat Architecture](2026-05-28-edge-agent-chat-architecture.md)
- Phase 2: [Manifest Override + Local `search_memory`](2026-05-28-manifest-override-memory-search-design.md)
- Implementation Plan: [2026-06-01-edge-write-observation-plan.md](../plans/2026-06-01-edge-write-observation-plan.md)

---

## 1. Problem

The edge agent can now read local wiki memory via `search_memory` (Phase 2). It cannot write to it. When a user shares a preference or personal fact during an edge-resolved session, the agent has no path to persist it locally — the observation is either lost or must be escalated to Firebase.

The ADK sandbox (`clanker-local-adk-sandbox`) already validates this write shape with `wikiMemory.write(characterId, { event_type: 'observation', summary })` via `better-sqlite3`. The edge Expo client uses the same `expo-llm-wiki` `wiki.write` API. The translation is 1:1.

Additionally, the `clankerEscalationSchema` description does not currently forbid using escalation as a proxy for saving observations. Without an explicit prohibition, the LLM may route `write_observation` intents to the cloud agent instead of handling them locally.

---

## 2. Goals

- Export `clankerWriteObservationSchema` from `clankerManifests.ts` in the correct `@google/genai` tool schema shape.
- Add a `writeToWiki` helper to `wikiService.ts` that wraps `wiki.write` — mirrors the `readFromWiki` pattern.
- Add a `write_observation` executor inside `createEdgeToolExecutors` that validates input, calls `writeToWiki`, and fails gracefully without throwing unhandled rejections.
- Inject `clankerWriteObservationSchema` into the edge loop's `functionDeclarations` when `wiki` is present, alongside `clankerMemorySchema`.
- Tighten `clankerEscalationSchema.description` to explicitly forbid routing memory writes to the cloud.

---

## 3. Non-Goals

- No changes to `@equationalapplications/core-llm-tools`, `expo-llm-wiki`, or their `package.json`.
- No raw SQLite/Drizzle queries — `writeToWiki` calls `wiki.write` exclusively.
- No `ToolRegistry` abstraction — the executor map is sufficient for 4 tools.
- No syncing newly written observations to Cloud SQL — that is handled by the existing wiki sync flow, not the edge agent.
- No UI feedback for in-progress writes — the agent's reply text is sufficient confirmation.

---

## 4. Architecture

### Files Changed

| File | Change |
|---|---|
| `src/services/clankerManifests.ts` | Export `clankerWriteObservationSchema`; tighten `clankerEscalationSchema.description` |
| `src/services/wikiService.ts` | Export `writeToWiki` thin wrapper |
| `src/services/edgeToolExecutors.ts` | Import `writeToWiki`; add `write_observation` in `createEdgeToolExecutors` |
| `src/hooks/useEdgeAgent.ts` | Import + inject `clankerWriteObservationSchema` inside `if (wiki)` block |
| `src/services/__tests__/clankerManifests.test.ts` | Tests for new schema + updated escalation description |
| `src/services/__tests__/edgeToolExecutors.test.ts` | Tests for `write_observation` executor; extend `wikiService` mock to include `writeToWiki` |
| `src/hooks/__tests__/useEdgeAgent.test.ts` | Update `clankerManifests` mock; update `createEdgeToolExecutors` mock; tests for injection + execution |

---

## 5. Component Design

### 5.1 `src/services/clankerManifests.ts`

Add `clankerWriteObservationSchema`. Update `clankerEscalationSchema.description` to end with the WRITING/saving prohibition.

```typescript
export const clankerEscalationSchema = {
  ...escalateToCloudManifest.schema,
  description:
    'Escalate complex workflows or writing tasks. CRITICAL: Do NOT use this tool for checking the time, reading memory, or WRITING/saving observations.',
}

export const clankerWriteObservationSchema = {
  name: 'write_observation',
  description:
    'Record a new observation about the user into long-term memory. Call this when the user shares a personal detail, preference, or fact that should be remembered across future conversations.',
  parameters: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string' as const,
        description: 'The observation to record about the user.',
      },
    },
    required: ['summary'],
  },
}
```

---

### 5.2 `src/services/wikiService.ts`

Export a thin `writeToWiki` helper after `readFromWiki`. It is intentionally minimal — no retry logic; it also clears the per-entity “no result” cache so newly written observations can be discovered immediately.
```typescript
export async function writeToWiki(
  wiki: Wiki,
  entityId: string,
  event: { event_type: 'observation' | 'decision' | 'action' | 'outcome'; summary: string },
): Promise<void> {
  await wiki.write(entityId, event)
  clearWikiNoResultCache(entityId)
}
```

`wiki.write` signature (from `@equationalapplications/core-llm-wiki`):

```typescript
write(entityId: string, event: Omit<WikiEvent, 'id' | 'entity_id' | 'created_at'>): Promise<void>
```

The caller passes `{ event_type: 'observation', summary }` — `id`, `entity_id`, and `created_at` are assigned by the library.

---

### 5.3 `src/services/edgeToolExecutors.ts`

Add `writeToWiki` import alongside `readFromWiki`. Add `write_observation` inside `createEdgeToolExecutors`.

```typescript
import { readFromWiki, writeToWiki } from './wikiService'
import type { Wiki } from './wikiService'

// ... (edgeToolExecutors static map unchanged)

export function createEdgeToolExecutors(characterId: string, wiki: Wiki | null): Record<string, ToolExecutor> {
  return {
    ...edgeToolExecutors,
    search_memory: async (args) => { /* unchanged */ },
    write_observation: async (args) => {
      try {
        const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
        if (!wiki || !summary) return 'Failed to record observation: Invalid input or missing database.'
        await writeToWiki(wiki, characterId, { event_type: 'observation', summary })
        return 'Observation recorded successfully.'
      } catch (error) {
        console.error('[EdgeAgent] write_observation failed:', error)
        return 'Failed to record observation due to an internal error.'
      }
    },
  }
}
```

The executor always returns a string — it never throws. This prevents a rejected `write_observation` promise from surfacing as an unhandled rejection that would trigger the outer `catch` in `sendMessage` and cause an unwanted cloud escalation.

---

### 5.4 `src/hooks/useEdgeAgent.ts`

Two changes only:

**Import:**
```typescript
import {
  clankerTimeSchema,
  clankerEscalationSchema,
  clankerMemorySchema,
  clankerWriteObservationSchema,   // add
} from '~/services/clankerManifests'
```

**Tool injection** — inside the existing `if (wiki)` block:
```typescript
if (wiki) {
  functionDeclarations.push(clankerMemorySchema)
  functionDeclarations.push(clankerWriteObservationSchema)  // add
}
```

No changes to the while-loop, `Promise.all`, escalation logic, or `useCallback` deps. `wiki` is already in the dependency array from Phase 2.

---

## 6. Data Flow

```
useEdgeAgent.sendMessage(userText)
  │
  ├─ toolExecutors = createEdgeToolExecutors(character.id, wiki)
  │    ├─ get_current_time  (stateless, sync)
  │    ├─ search_memory     (wiki-bound, async — Phase 2)
  │    └─ write_observation (wiki-bound, async — Phase 3)
  │
  └─ while loop (max 5 iterations)
       │
       ├─ generateContent() → functionCalls[]
       │
       └─ Promise.all(functionCalls.map(async fc => {
            if 'escalate_to_cloud_agent' → set flag, return null
            if 'write_observation'       → await write_observation({ summary })
                                              → writeToWiki(wiki, characterId, { event_type: 'observation', summary })
                                                  → wiki.write(characterId, { event_type, summary })
                                              → returns 'Observation recorded successfully.'
                                              → return functionResponse part
          }))
```

The `write_observation` response part is fed back to the model in the next iteration exactly like any other tool response. The model then generates the user-facing acknowledgement text.

---

## 7. Error Handling

| Scenario | Behavior |
|---|---|
| `wiki` is null | Returns `'Failed to record observation: Invalid input or missing database.'` — no throw |
| `summary` missing or empty or non-string | Same early return — no throw |
| `wiki.write` throws (e.g., `WikiBusyError`, SQLite locked) | Caught in `try/catch`; logs error; returns `'Failed to record observation due to an internal error.'` — no escalation triggered |
| Model calls `write_observation` when wiki is null (schema not injected) | Cannot happen — schema is only added to `functionDeclarations` when `wiki` is truthy |
| Model calls `escalate_to_cloud_agent` for a memory write | Prevented by updated description; if it still escalates, existing escalation path handles it |

---

## 8. Testing

### `clankerManifests.test.ts`

| Test | Assertion |
|---|---|
| `clankerWriteObservationSchema.name` | `'write_observation'` |
| `clankerWriteObservationSchema.description` | Contains `'long-term memory'` |
| `clankerWriteObservationSchema.parameters.type` | `'object'` |
| `summary` parameter | In `required`; `type === 'string'` |
| Updated `clankerEscalationSchema.description` | Contains `'WRITING/saving observations'` |

### `edgeToolExecutors.test.ts`

| Test | Assertion |
|---|---|
| `write_observation` present in `createEdgeToolExecutors` output | `typeof ... === 'function'` |
| `wiki` null | Returns failure message; `writeToWiki` not called |
| `summary` empty string | Returns failure message; `writeToWiki` not called |
| `summary` whitespace only | Returns failure message; `writeToWiki` not called |
| `summary` missing from args | Returns failure message; `writeToWiki` not called |
| `summary` not a string | Returns failure message; `writeToWiki` not called |
| Happy path | `writeToWiki` called with `(wiki, 'char-42', { event_type: 'observation', summary: '...' })` |
| Happy path return | `'Observation recorded successfully.'` |
| `writeToWiki` throws | Returns `'Failed to record observation due to an internal error.'` |

`writeToWiki` is added to the `wikiService` mock alongside the existing `readFromWiki` mock.

### `useEdgeAgent.test.ts`

| Test | Assertion |
|---|---|
| `write_observation` included when `wiki` provided | Name in `functionDeclarations` |
| `write_observation` excluded when `wiki` null | Name NOT in `functionDeclarations` |
| Tool executes and loops to text reply | Model called twice; second call follows function response; `escalated: false` |

`clankerManifests` mock gains `clankerWriteObservationSchema`. `createEdgeToolExecutors` mock gains `write_observation: async () => 'Observation recorded successfully.'`.

---

## 9. Constraints

- `@equationalapplications/core-llm-tools` — read only, never modified.
- `expo-llm-wiki` tables — accessed only via `writeToWiki` → `wiki.write`, never raw SQL.
- `useEdgeAgent` — does not call any React hook for wiki; receives it via options (unchanged from Phase 2).
- Schema descriptions — exact strings from this spec; no paraphrase.
- Executor never throws — always returns a string, even in error paths.
- `write_observation` schema only injected when `wiki` is non-null — no schema drift.

---

## 10. Acceptance Criteria

| Scenario | Expected |
|---|---|
| User shares a preference during edge session | `write_observation` called; `wiki.write` called with `{ event_type: 'observation', summary }` |
| User asks agent to recall the fact in a later session | `search_memory` returns the written observation |
| `wiki` is null (wiki not initialized) | `write_observation` not offered to the model; executor returns failure string if somehow called |
| `write_observation` throws internally | No Firebase escalation; agent replies with internal error string |
| LLM tries to escalate a write observation task | Escalation description contains explicit prohibition; LLM directed to `write_observation` instead |
| `npx tsc --noEmit` | No new type errors |
| `npx jest --no-coverage` | No regressions; new tests pass |

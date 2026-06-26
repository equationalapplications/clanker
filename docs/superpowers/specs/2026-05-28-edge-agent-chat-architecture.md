# Edge Agent Chat Architecture — Spec

> **⚠️ DEPRECATED — historical record only.** This spec describes the pre-BYOI design (client-side `@google/genai` + `EXPO_PUBLIC_GEMINI_API_KEY`). The current architecture is documented in **[Edge Agent](../../edge-agent.md)**. Do not implement from this file.

**Date:** 2026-05-28
**Status:** Implemented
**Branch:** `feat/character-prompt`
**Scope:** Replace the Firebase-only chat path with an ADK-style edge execution loop in Expo. Simple queries (time, greetings) resolve on-device via `@google/genai`. Complex or stateful tasks escalate to the existing Firebase `generateReply` callable.

---

## 1. Problem

Every chat message currently makes a round-trip to Firebase Functions regardless of complexity. The prompt is built by string concatenation in `buildChatPrompt` — character fields are baked in, hard to test, and diverge from the `@google/genai` structured content format. There is no on-device tool execution and no escalation triage.

---

## 2. Architecture: Edge-First Execution Loop

```
User message
      ↓
useEdgeAgent (Expo, @google/genai)
      │
      ├── CharacterPromptBuilder
      │     └── Character fields → systemInstruction + Content[]
      │
      ├── @google/genai generateContent (loop)
      │         ↓
      │   functionCall?
      │   ├── get_current_time → edgeToolExecutors → inject functionResponse → loop again
      │   └── escalate_to_cloud → escalationState = 'escalating'
      │                                │
      │                          existing Firebase generateChatReply (unchanged)
      │
      └── text response → save to DB → update messages
```

`useAIChat` evolves to call `useEdgeAgent` internally. `ChatView` gains an `escalationState` prop to render the handoff UX. GiftedChat is retained.

---

## 3. Component Interfaces

### 3.1 `CharacterPromptBuilder`

```typescript
// src/services/characterPromptBuilder.ts

import type { Character } from '~/services/aiChatService'
import type { IMessage } from 'react-native-gifted-chat'

export interface CharacterPromptContext {
  character: Character
  userId: string
  memoryBlock?: string
}

export function buildSystemInstruction(ctx: CharacterPromptContext): string
// Returns the system prompt string for config.systemInstruction.
// Incorporates: character name, appearance/personality, traits, emotions,
// rolling context summary, memory block (if present), and stay-in-character directives.

export function buildContentHistory(
  messages: IMessage[],
  userId: string,
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>
// Converts IMessage[] (oldest→newest) to @google/genai Content[].
// Maps: msg.user._id === userId → 'user', otherwise → 'model'.
```

### 3.2 `edgeToolExecutors`

```typescript
// src/services/edgeToolExecutors.ts

export type ToolExecutor = (args: Record<string, unknown>) => unknown

export const edgeToolExecutors: Record<string, ToolExecutor> = {
  get_current_time: () =>
    new Date().toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }),
  // escalate_to_cloud is NOT in this map — it triggers a state change, not an execution.
}
```

### 3.3 `useEdgeAgent`

```typescript
// src/hooks/useEdgeAgent.ts

export type EscalationState = 'idle' | 'escalating'

export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: IMessage[]      // read from useMessages — not managed here
  memoryBlock?: string
}

export interface UseEdgeAgentReturn {
  sendMessage: (userText: string) => Promise<{ escalated: boolean }>
  isThinking: boolean
  escalationState: EscalationState
}
```

- Manages the `@google/genai` while-loop: build history → generate → check functionCalls → execute or escalate → repeat.
- Does **not** own React Query state, credits, or wiki writes. Those stay in `useAIChat`.
- Returns `{ escalated: true }` when escalation fires so `useAIChat` can route to `generateChatReply`.

### 3.4 `useAIChat` changes

- Accepts a new optional return field: `escalationState: EscalationState`.
- Internally constructs `useEdgeAgent` with the character + memory bundle.
- On `sendMessage`:
  1. Calls `useEdgeAgent.sendMessage(text)`.
  2. If `escalated === false` — the edge loop generated the reply; persist the AI message returned by `useEdgeAgent`.
  3. If `escalated === true` — fall through to the existing `generateChatReply` Firebase path for credit deduction and usage snapshot.
- Wiki `onWriteObservation` triggers after either path completes (unchanged logic).

### 3.5 `ChatView` changes

- Reads `escalationState` from `useAIChat`.
- When `escalationState === 'escalating'`, renders a status banner identical to the existing `wikiStatus` banners:
  ```tsx
  {escalationState === 'escalating' && (
    <Text style={styles.statusText} accessibilityLabel="Thinking deeply">
      🧠 Thinking deeply…
    </Text>
  )}
  ```

---

## 4. SDK: `@google/genai`

**Why not `@google/adk`:** `@google/adk` imports Node.js core modules (`fs`, `events`). Hermes does not provide these. The app crashes on load.

**`@google/genai`** is the universal Google AI SDK — pure JS, no Node.js builtins, compatible with Hermes and React Native.

```bash
npm install @google/genai
```

API key is the existing `EXPO_PUBLIC_GEMINI_API_KEY` env var (already set for wiki embeddings and voice chat).

Model: `gemini-2.5-flash` — matches the Firebase Functions backend model selection.

---

## 5. Tool Schemas

Schemas come from `@equationalapplications/core-llm-tools` (already installed as `^4.10.0`):

```typescript
import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'

const tools = [{
  functionDeclarations: [
    getCurrentTimeManifest.schema,
    escalateToCloudManifest.schema,
  ],
}]
```

No hardcoded schema strings in `useEdgeAgent`. When the manifest description changes in the package, both edge and cloud consumers update automatically.

---

## 6. Design Decisions

### Credit model for edge-resolved queries

Queries handled entirely at the edge (no `escalate_to_cloud`) do **not** call Firebase → no credit deduction. Queries that escalate consume one credit via the existing `generateChatReply` path.

**Open question before shipping:** confirm with product/business that edge-free queries are intentional (vs. every message costing one credit).

### CharacterPromptBuilder stays in clanker

`buildSystemInstruction` couples directly to the `Character` SQLite schema (`appearance`, `traits`, `emotions`, `context`). Moving it to `@equationalapplications/core-llm-tools` is deferred to Phase 2, when the schema is stable.

### `buildChatPrompt` is not deleted yet

`buildChatPrompt` in `aiChatService.ts` remains for the Firebase escalation path (which still sends a string prompt to `generateChatReply`). It is not extended further.

### Conversation history format

`CharacterPromptBuilder.buildContentHistory` maps `IMessage[]` to `@google/genai` `Content[]`. The `role: 'function'` turn (tool response) is inserted inline in the while-loop — not stored in the persistent `IMessage[]` list.

### Max tool iterations

The while-loop is capped at **5 iterations** to prevent runaway tool loops. If the cap is hit without a text response, `useEdgeAgent` escalates automatically.

---

## 7. Acceptance Criteria

| Test | Expected |
|------|----------|
| Query requires `get_current_time` | Firebase not called; reply contains current time |
| Query triggers escalation | `escalationState === 'escalating'`; Firebase `generateChatReply` called |
| System prompt | Built from `character.name`, `.appearance`, `.traits`, `.emotions`, `.context` |
| Tool schemas | `getCurrentTimeManifest.schema` and `escalateToCloudManifest.schema` spread, no hardcoded strings |
| Credit deduction | Escalated messages deduct credits; edge-resolved messages do not |
| GiftedChat | No regressions in message rendering or composer |
| TypeScript build | `npm run typecheck` passes |
| App test suite | `npm test` passes |

---

## 8. Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `@google/genai` |
| `src/services/characterPromptBuilder.ts` | **New** — builds `systemInstruction` and `Content[]` from `Character` |
| `src/services/edgeToolExecutors.ts` | **New** — pure local tool execution map |
| `src/hooks/useEdgeAgent.ts` | **New** — ADK-style while-loop, manages `escalationState` |
| `src/hooks/useAIChat.ts` | **Modify** — call `useEdgeAgent`, surface `escalationState`, route escalated messages to Firebase |
| `src/components/ChatView.tsx` | **Modify** — render escalation banner from `escalationState` |

---

## 9. Phase 2 Preview

- Extract `CharacterPromptBuilder` to `@equationalapplications/core-llm-tools` once the schema stabilizes.
- Add `search_memory` and `write_observation` edge tools to the local executor map (today they go to Firebase via the wiki callable).
- Add memory injection as a `before_model` step (SQLite query for recent context clues → appended to `systemInstruction`).

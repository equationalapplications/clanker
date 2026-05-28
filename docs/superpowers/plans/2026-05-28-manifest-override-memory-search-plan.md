# Manifest Override Pattern + Local `search_memory` Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace generic LLM tool manifests with Clanker-specific overrides, add an on-device `search_memory` tool backed by `readFromWiki`, and upgrade the edge agent execution loop to handle async tools via `Promise.all`.

**Architecture:** `clankerManifests.ts` owns all schema definitions; `edgeToolExecutors.ts` gains a `createEdgeToolExecutors(characterId, wiki)` factory that closes over character context; `useEdgeAgent` receives `wiki` via its options interface (injected by `useAIChat`) and runs tool calls concurrently. No React context access inside `useEdgeAgent`.

**Tech Stack:** React Native / Expo, `@google/genai` (Gemini 2.5 Flash), `@equationalapplications/expo-llm-wiki` (`readFromWiki`), Jest / jest-expo, TypeScript.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/services/clankerManifests.ts` | **Create** | All tool schema overrides for this app |
| `src/services/__tests__/clankerManifests.test.ts` | **Create** | Structural tests for schema shapes |
| `src/services/edgeToolExecutors.ts` | **Modify** | Update `ToolExecutor` type; add `createEdgeToolExecutors` factory |
| `src/services/__tests__/edgeToolExecutors.test.ts` | **Modify** | Add factory + `search_memory` tests; keep existing `get_current_time` tests |
| `src/hooks/useEdgeAgent.ts` | **Modify** | Add `wiki` option; swap manifests; replace sync loop with async `Promise.all`; fix escalation name |
| `src/hooks/__tests__/useEdgeAgent.test.ts` | **Modify** | Update mocks; add `wiki` to options; fix escalation name; add `search_memory` tests |
| `src/hooks/useAIChat.ts` | **Modify** | Add `useWiki()` call; pass wiki into `useEdgeAgent` options |

---

## Task 1: Create `clankerManifests.ts` and its tests

**Files:**
- Create: `src/services/clankerManifests.ts`
- Create: `src/services/__tests__/clankerManifests.test.ts`

---

- [ ] **Step 1.1 — Write the failing tests**

Create `src/services/__tests__/clankerManifests.test.ts`:

```ts
import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema } from '../clankerManifests'

describe('clankerTimeSchema', () => {
  it('has name get_current_time', () => {
    expect(clankerTimeSchema.name).toBe('get_current_time')
  })

  it('description contains CRITICAL', () => {
    expect(clankerTimeSchema.description).toContain('CRITICAL')
  })

  it('description mentions today and tomorrow', () => {
    expect(clankerTimeSchema.description).toContain('today')
    expect(clankerTimeSchema.description).toContain('tomorrow')
  })
})

describe('clankerEscalationSchema', () => {
  it('has name escalate_to_cloud_agent', () => {
    expect(clankerEscalationSchema.name).toBe('escalate_to_cloud_agent')
  })

  it('description says Do NOT use for reading memory', () => {
    expect(clankerEscalationSchema.description).toContain('Do NOT')
    expect(clankerEscalationSchema.description).toContain('reading memory')
  })
})

describe('clankerMemorySchema', () => {
  it('has name search_memory', () => {
    expect(clankerMemorySchema.name).toBe('search_memory')
  })

  it('description says ALWAYS use for recall', () => {
    expect(clankerMemorySchema.description).toContain('ALWAYS')
  })

  it('has required query parameter', () => {
    const params = clankerMemorySchema.parameters as {
      required: string[]
      properties: Record<string, unknown>
    }
    expect(params.required).toContain('query')
    expect(params.properties['query']).toBeDefined()
  })
})
```

- [ ] **Step 1.2 — Run tests to verify they fail**

```bash
npx jest --testPathPattern="clankerManifests" --no-coverage
```

Expected: FAIL — `Cannot find module '../clankerManifests'`

- [ ] **Step 1.3 — Create `src/services/clankerManifests.ts`**

```ts
import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'

export const clankerTimeSchema = {
  ...getCurrentTimeManifest.schema,
  description:
    'CRITICAL: ALWAYS call this tool immediately if the user asks for the current time, date, day of the week, or uses relative temporal words (today, tomorrow). Do not guess or act rustic.',
}

export const clankerEscalationSchema = {
  ...escalateToCloudManifest.schema,
  description:
    'Escalate complex workflows or writing tasks. CRITICAL: Do NOT use this tool for reading memory, checking the time, or casual chatting.',
}

export const clankerMemorySchema = {
  name: 'search_memory',
  description:
    "Search the user's local long-term memory and wiki. ALWAYS use this tool if the user asks you to recall something previously discussed or look up a fact.",
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}
```

> **Note:** `clankerEscalationSchema` inherits `name: 'escalate_to_cloud_agent'` from `escalateToCloudManifest.schema` via the spread. This is correct — it fixes the existing name mismatch bug.

- [ ] **Step 1.4 — Run tests to verify they pass**

```bash
npx jest --testPathPattern="clankerManifests" --no-coverage
```

Expected: PASS (3 describe blocks, 7 assertions)

- [ ] **Step 1.5 — Commit**

```bash
git add src/services/clankerManifests.ts src/services/__tests__/clankerManifests.test.ts
git commit -m "feat(edge): add clankerManifests with tool schema overrides"
```

---

## Task 2: Refactor `edgeToolExecutors.ts` — add factory and async type

**Files:**
- Modify: `src/services/edgeToolExecutors.ts`
- Modify: `src/services/__tests__/edgeToolExecutors.test.ts`

---

- [ ] **Step 2.1 — Add factory tests to the existing test file**

Replace the entire contents of `src/services/__tests__/edgeToolExecutors.test.ts` with:

```ts
import { edgeToolExecutors, createEdgeToolExecutors } from '../edgeToolExecutors'
import { readFromWiki } from '../wikiService'

jest.mock('../wikiService', () => ({
  readFromWiki: jest.fn(),
}))

const mockReadFromWiki = readFromWiki as jest.Mock

describe('edgeToolExecutors (static map)', () => {
  describe('get_current_time', () => {
    it('is present in the executor map', () => {
      expect(typeof edgeToolExecutors['get_current_time']).toBe('function')
    })

    it('returns a non-empty string', () => {
      const result = edgeToolExecutors['get_current_time']({})
      expect(typeof result).toBe('string')
      expect((result as string).length).toBeGreaterThan(0)
    })

    it('output contains a year (4-digit number)', () => {
      const result = edgeToolExecutors['get_current_time']({}) as string
      expect(result).toMatch(/\d{4}/)
    })
  })

  it('escalate_to_cloud is NOT in the executor map', () => {
    expect(edgeToolExecutors['escalate_to_cloud']).toBeUndefined()
  })

  it('search_memory is NOT in the static executor map', () => {
    expect(edgeToolExecutors['search_memory']).toBeUndefined()
  })
})

describe('createEdgeToolExecutors', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('includes get_current_time from static map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['get_current_time']).toBe('function')
  })

  it('includes search_memory', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['search_memory']).toBe('function')
  })

  describe('search_memory', () => {
    it('returns "No relevant memories found." when wiki is null', async () => {
      const execs = createEdgeToolExecutors('char-1', null)
      const result = await execs['search_memory']({ query: 'anything' })
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })

    it('returns "No relevant memories found." when query is empty string', async () => {
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: '' })
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })

    it('returns "No relevant memories found." when wiki returns all empty arrays', async () => {
      mockReadFromWiki.mockResolvedValue({ facts: [], tasks: [], events: [] })
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'coffee' })
      expect(result).toBe('No relevant memories found.')
    })

    it('returns JSON string when wiki returns facts', async () => {
      const mockResults = { facts: [{ content: 'User likes coffee' }], tasks: [], events: [] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'coffee' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('returns JSON string when wiki returns tasks', async () => {
      const mockResults = { facts: [], tasks: [{ content: 'Buy groceries' }], events: [] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'groceries' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('returns JSON string when wiki returns events', async () => {
      const mockResults = { facts: [], tasks: [], events: [{ content: 'Met at park' }] }
      mockReadFromWiki.mockResolvedValue(mockResults)
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({ query: 'park' })
      expect(result).toBe(JSON.stringify(mockResults))
    })

    it('calls readFromWiki with correct characterId and query', async () => {
      mockReadFromWiki.mockResolvedValue({ facts: [], tasks: [], events: [] })
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-42', wiki)
      await execs['search_memory']({ query: 'favorite food' })
      expect(mockReadFromWiki).toHaveBeenCalledWith(wiki, 'char-42', 'favorite food')
    })

    it('does not call readFromWiki when query is missing from args', async () => {
      const wiki = {} as any
      const execs = createEdgeToolExecutors('char-1', wiki)
      const result = await execs['search_memory']({})
      expect(result).toBe('No relevant memories found.')
      expect(mockReadFromWiki).not.toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2.2 — Run tests to verify new factory tests fail**

```bash
npx jest --testPathPattern="edgeToolExecutors" --no-coverage
```

Expected: existing `get_current_time` tests PASS; all `createEdgeToolExecutors` tests FAIL — `createEdgeToolExecutors is not a function`

- [ ] **Step 2.3 — Update `src/services/edgeToolExecutors.ts`**

Replace the entire file:

```ts
import { readFromWiki } from './wikiService'
import type { Wiki } from './wikiService'

export type ToolExecutor = (args: Record<string, unknown>) => unknown | Promise<unknown>

export const edgeToolExecutors: Record<string, ToolExecutor> = {
  get_current_time: () =>
    new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
}

export function createEdgeToolExecutors(
  characterId: string,
  wiki: Wiki | null,
): Record<string, ToolExecutor> {
  return {
    ...edgeToolExecutors,
    search_memory: async (args) => {
      const query = args.query as string
      if (!wiki || !query) return 'No relevant memories found.'
      const results = await readFromWiki(wiki, characterId, query)
      const hasMemories =
        results.facts.length > 0 || results.tasks.length > 0 || results.events.length > 0
      return hasMemories ? JSON.stringify(results) : 'No relevant memories found.'
    },
  }
}
```

- [ ] **Step 2.4 — Run tests to verify all pass**

```bash
npx jest --testPathPattern="edgeToolExecutors" --no-coverage
```

Expected: PASS — all static map tests + all factory tests

- [ ] **Step 2.5 — Commit**

```bash
git add src/services/edgeToolExecutors.ts src/services/__tests__/edgeToolExecutors.test.ts
git commit -m "feat(edge): add createEdgeToolExecutors factory with async search_memory"
```

---

## Task 3: Update `useEdgeAgent.ts` — options, manifests, async loop

**Files:**
- Modify: `src/hooks/useEdgeAgent.ts`
- Modify: `src/hooks/__tests__/useEdgeAgent.test.ts`

**Context:** The existing test file mocks `@equationalapplications/core-llm-tools` (no longer imported by `useEdgeAgent`) and uses the old static executor map. Both mocks must change. All `renderHook` calls must gain `wiki: null`. The escalation name `'escalate_to_cloud'` becomes `'escalate_to_cloud_agent'` throughout.

---

- [ ] **Step 3.1 — Replace the test file with the updated version**

Replace the entire contents of `src/hooks/__tests__/useEdgeAgent.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react-native'
import { useEdgeAgent } from '../useEdgeAgent'
import type { IMessage } from 'react-native-gifted-chat'

// Mock @google/genai
const mockGenerateContent = jest.fn()
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}))

// Mock clankerManifests — useEdgeAgent now imports from here, not core-llm-tools
jest.mock('~/services/clankerManifests', () => ({
  clankerTimeSchema: { name: 'get_current_time', description: 'Get current time', parameters: {} },
  clankerEscalationSchema: { name: 'escalate_to_cloud_agent', description: 'Escalate to cloud', parameters: {} },
  clankerMemorySchema: { name: 'search_memory', description: 'Search memory', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
}))

// Mock edgeToolExecutors — factory returns a fixed executor map
jest.mock('~/services/edgeToolExecutors', () => ({
  createEdgeToolExecutors: jest.fn().mockReturnValue({
    get_current_time: () => 'Thursday, May 28, 2026 at 10:00 AM PDT',
    search_memory: async () => JSON.stringify({ facts: [{ content: 'User likes tea' }], tasks: [], events: [] }),
  }),
}))

// Mock characterPromptBuilder
jest.mock('~/services/characterPromptBuilder', () => ({
  buildSystemInstruction: () => 'You are Aria.',
  buildContentHistory: () => [],
}))

const character = {
  id: 'char-1',
  name: 'Aria',
  appearance: 'warm',
  traits: 'kind',
  emotions: 'gentle',
  context: '',
}

const priorMessages: IMessage[] = []

beforeEach(() => {
  jest.clearAllMocks()
  process.env.EXPO_PUBLIC_GEMINI_API_KEY = 'test-key'
})

afterEach(() => {
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY
})

describe('useEdgeAgent', () => {
  it('returns escalated:false and text when model returns a text response', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello! How are you?',
      functionCalls: undefined,
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hi there')
    })

    expect(response).toEqual({ escalated: false, text: 'Hello! How are you?' })
    expect(result.current.escalationState).toBe('idle')
  })

  it('returns escalated:true when model calls escalate_to_cloud_agent', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'escalate_to_cloud_agent', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Tell me about the French revolution')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
  })

  it('executes get_current_time tool and loops to get text reply', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: undefined,
        functionCalls: [{ name: 'get_current_time', args: {} }],
      })
      .mockResolvedValueOnce({
        text: 'It is Thursday, May 28, 2026 at 10:00 AM PDT.',
        functionCalls: undefined,
      })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('What time is it?')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toContain('Thursday')
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('executes search_memory tool and loops to get text reply', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: undefined,
        functionCalls: [{ name: 'search_memory', args: { query: 'tea' } }],
      })
      .mockResolvedValueOnce({
        text: 'I found that you like tea!',
        functionCalls: undefined,
      })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('What do I like to drink?')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toContain('tea')
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('escalates automatically when iteration cap is reached', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'get_current_time', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
    expect(mockGenerateContent).toHaveBeenCalledTimes(5) // MAX_ITERATIONS
  })

  it('escalates automatically when iteration cap is reached for local-only characters', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'get_current_time', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
    expect(mockGenerateContent).toHaveBeenCalledTimes(5)
  })

  it('isThinking is true during the call and false after', async () => {
    let resolveGenerate: (v: any) => void
    const pendingGenerate = new Promise((resolve) => { resolveGenerate = resolve })
    mockGenerateContent.mockReturnValueOnce(pendingGenerate)

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    expect(result.current.isThinking).toBe(false)

    let done = false
    act(() => {
      result.current.sendMessage('Hello').then(() => { done = true })
    })

    expect(result.current.isThinking).toBe(true)

    await act(async () => {
      resolveGenerate!({ text: 'Hi!', functionCalls: undefined })
    })

    expect(result.current.isThinking).toBe(false)
    expect(done).toBe(true)
  })

  it('escalates when generateContent throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.isThinking).toBe(false)
  })

  it('escalates when generateContent throws for local-only characters', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.isThinking).toBe(false)
  })

  it('escalates when EXPO_PUBLIC_GEMINI_API_KEY is not set', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response?.escalated).toBe(true)
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })

  it('does not include escalate_to_cloud_agent tool when isCloudSynced is false', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello!',
      functionCalls: undefined,
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: null }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateContent.mock.calls[0][0]
    const functionDeclarations = callArgs.config.tools[0].functionDeclarations as { name: string }[]
    const names = functionDeclarations.map((fd) => fd.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('search_memory')
    expect(names).not.toContain('escalate_to_cloud_agent')
  })

  it('includes escalate_to_cloud_agent tool when isCloudSynced is true', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Hello!',
      functionCalls: undefined,
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: true, wiki: null }),
    )

    await act(async () => {
      await result.current.sendMessage('Hi')
    })

    const callArgs = mockGenerateContent.mock.calls[0][0]
    const functionDeclarations = callArgs.config.tools[0].functionDeclarations as { name: string }[]
    const names = functionDeclarations.map((fd) => fd.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('search_memory')
    expect(names).toContain('escalate_to_cloud_agent')
  })
})
```

- [ ] **Step 3.2 — Run tests to verify they fail in the expected way**

```bash
npx jest --testPathPattern="useEdgeAgent" --no-coverage
```

Expected: Multiple failures — cannot find `~/services/clankerManifests`, wrong mock paths, `wiki` not in interface.

- [ ] **Step 3.3 — Rewrite `src/hooks/useEdgeAgent.ts`**

Replace the entire file:

```ts
import { useState, useCallback, useRef, useEffect } from 'react'
import { GoogleGenAI } from '@google/genai'
import type { Content, Part, ToolListUnion } from '@google/genai'
import type { IMessage } from 'react-native-gifted-chat'
import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema } from '~/services/clankerManifests'
import type { Character } from '~/services/aiChatService'
import type { Wiki } from '~/services/wikiService'
import { buildSystemInstruction, buildContentHistory } from '~/services/characterPromptBuilder'
import { createEdgeToolExecutors } from '~/services/edgeToolExecutors'

export type EscalationState = 'idle' | 'escalating'

export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: IMessage[]
  isCloudSynced: boolean
  wiki: Wiki | null
}

export interface UseEdgeAgentReturn {
  sendMessage: (userText: string, memoryBlock?: string) => Promise<{ escalated: boolean; text?: string }>
  isThinking: boolean
  escalationState: EscalationState
}

const MAX_ITERATIONS = 5
const GEMINI_MODEL = 'gemini-2.5-flash'

export function useEdgeAgent({ character, userId, priorMessages, isCloudSynced, wiki }: UseEdgeAgentOptions): UseEdgeAgentReturn {
  const [isThinking, setIsThinking] = useState(false)
  const [escalationState, setEscalationState] = useState<EscalationState>('idle')
  const priorMessagesRef = useRef(priorMessages)

  useEffect(() => {
    priorMessagesRef.current = priorMessages
  }, [priorMessages])

  const sendMessage = useCallback(
    async (userText: string, memoryBlock?: string): Promise<{ escalated: boolean; text?: string }> => {
      setIsThinking(true)
      setEscalationState('idle')

      const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY
      if (!apiKey) {
        setIsThinking(false)
        setEscalationState('escalating')
        return { escalated: true }
      }

      const ai = new GoogleGenAI({ apiKey })
      const systemInstruction = buildSystemInstruction({ character, userId, memoryBlock })
      const historyContents = buildContentHistory(priorMessagesRef.current, userId)
      const toolExecutors = createEdgeToolExecutors(character.id, wiki)

      const contents: Content[] = [
        ...historyContents,
        { role: 'user', parts: [{ text: userText }] },
      ] as Content[]

      // Cast required: AgentToolSchema.parameters.properties is Record<string,unknown>
      // but FunctionDeclaration expects Record<string,Schema> — shapes are compatible at runtime
      const functionDeclarations = [clankerTimeSchema, clankerMemorySchema]
      if (isCloudSynced) {
        functionDeclarations.push(clankerEscalationSchema)
      }
      const tools = [{ functionDeclarations }] as unknown as ToolListUnion

      try {
        let iterations = 0

        while (iterations < MAX_ITERATIONS) {
          iterations++

          const result = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: contents as Content[],
            config: { systemInstruction, tools },
          })

          const functionCalls = result.functionCalls

          if (!functionCalls || functionCalls.length === 0) {
            return { escalated: false, text: result.text ?? '' }
          }

          let didEscalate = false

          const responseParts = await Promise.all(
            functionCalls.map(async (fc) => {
              const name = fc.name ?? ''
              if (name === 'escalate_to_cloud_agent') {
                didEscalate = true
                return null
              }
              const executor = toolExecutors[name]
              const output = executor ? await executor(fc.args ?? {}) : null
              return { functionResponse: { name, response: { output } } }
            }),
          )

          if (didEscalate) {
            setEscalationState('escalating')
            return { escalated: true }
          }

          // Append model turn
          contents.push({
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          } as Content)

          // Append function responses
          contents.push({
            role: 'user',
            parts: responseParts.filter(Boolean) as Part[],
          } as Content)
        }

        // Iteration cap — escalate to Firebase
        setEscalationState('escalating')
        return { escalated: true }
      } catch {
        // Error — escalate to Firebase
        setEscalationState('escalating')
        return { escalated: true }
      } finally {
        setIsThinking(false)
      }
    },
    [character, userId, isCloudSynced, wiki],
  )

  return { sendMessage, isThinking, escalationState }
}
```

- [ ] **Step 3.4 — Run tests to verify all pass**

```bash
npx jest --testPathPattern="useEdgeAgent" --no-coverage
```

Expected: PASS — all 13 tests

- [ ] **Step 3.5 — Commit**

```bash
git add src/hooks/useEdgeAgent.ts src/hooks/__tests__/useEdgeAgent.test.ts
git commit -m "feat(edge): inject wiki via options, use clanker manifests, async Promise.all loop"
```

---

## Task 4: Update `useAIChat.ts` — pass wiki into `useEdgeAgent`

**Files:**
- Modify: `src/hooks/useAIChat.ts`

**Context:** `useAIChat` already calls `useCharacterWiki(character.id)` which internally uses `useWiki()`. We add one more direct `useWiki()` call here to obtain the raw wiki instance for injection.

---

- [ ] **Step 4.1 — Add `useWiki` import and pass wiki to `useEdgeAgent`**

Open `src/hooks/useAIChat.ts`. Make these three targeted changes:

**a) Add `useWiki` to the expo-llm-wiki import** (find the existing import line and add `useWiki`):

```ts
// Before:
import { useWiki, WikiBusyError, type MemoryBundle } from '@equationalapplications/expo-llm-wiki'
// (if useWiki isn't already imported — add it)
```

If `useWiki` is not yet in the import, locate the `@equationalapplications/expo-llm-wiki` import and add it:

```ts
import { useWiki, WikiBusyError, type MemoryBundle } from '@equationalapplications/expo-llm-wiki'
```

**b) Add `const wiki = useWiki()` after the existing hook calls** (place it near the other hook calls at the top of `useAIChat`, before `useEdgeAgent`):

```ts
const wiki = useWiki()
```

**c) Add `wiki` to the `useEdgeAgent` options object** (find the `useEdgeAgent({...})` call, currently at line ~51):

```ts
const edgeAgent = useEdgeAgent({
  character,
  userId,
  priorMessages: messages,
  isCloudSynced,
  wiki,
})
```

- [ ] **Step 4.2 — Run all tests**

```bash
npx jest --no-coverage
```

Expected: PASS — all tests across all test files (clankerManifests, edgeToolExecutors, useEdgeAgent, plus pre-existing tests for other files)

- [ ] **Step 4.3 — Commit**

```bash
git add src/hooks/useAIChat.ts
git commit -m "feat(edge): pass wiki instance from useAIChat into useEdgeAgent"
```

---

## Self-Review Against Spec

**Spec requirement → Task coverage:**

| Requirement | Covered |
|---|---|
| `clankerTimeSchema` with CRITICAL description | Task 1 |
| `clankerEscalationSchema` with Do NOT description | Task 1 |
| `clankerMemorySchema` with `search_memory` name + `query` param | Task 1 |
| `search_memory` executor with `readFromWiki` | Task 2 |
| Deep empty-array check before returning "No relevant memories found." | Task 2 |
| `createEdgeToolExecutors(characterId, wiki)` factory | Task 2 |
| `wiki: Wiki | null` in `UseEdgeAgentOptions` | Task 3 |
| No `useWiki()` call inside `useEdgeAgent` | Task 3 ✓ (options injection) |
| Manifest imports from `clankerManifests`, not `core-llm-tools` | Task 3 |
| `functionDeclarations = [clankerTimeSchema, clankerMemorySchema]` always | Task 3 |
| `clankerEscalationSchema` pushed conditionally on `isCloudSynced` | Task 3 |
| `Promise.all` async execution loop | Task 3 |
| Fix `escalate_to_cloud` → `escalate_to_cloud_agent` name check | Task 3 |
| `Part` import added for filter cast | Task 3 |
| `wiki` in `useCallback` deps | Task 3 |
| `useWiki()` in `useAIChat`, passed to `useEdgeAgent` | Task 4 |
| Do not modify `@equationalapplications/core-llm-tools` | ✓ (never touched) |
| Use `readFromWiki`, no raw SQL | ✓ Task 2 |

All spec requirements covered. No placeholders or TBDs in plan.

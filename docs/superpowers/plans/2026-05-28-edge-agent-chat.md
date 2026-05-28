# Edge Agent Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Firebase-only chat path with an ADK-style on-device execution loop (`useEdgeAgent`) that resolves simple queries locally via `@google/genai` and escalates complex ones to the existing Firebase `generateChatReply` callable.

**Architecture:** `useEdgeAgent` owns a `@google/genai` while-loop (max 5 iterations). `useAIChat` calls `useEdgeAgent.sendMessage` first; if the edge loop resolves the reply (no escalation), it saves both messages locally and returns a null usage snapshot — no Firebase call, no credit deduction. If the edge loop calls `escalate_to_cloud`, `useAIChat` falls through to the existing `sendMessageWithAIResponse` Firebase path. `ChatView` renders a "🧠 Thinking deeply…" banner when `escalationState === 'escalating'`.

**Tech Stack:** `@google/genai` 2.x (universal JS SDK, Hermes-safe), Jest + `@testing-library/react-native`, `@equationalapplications/core-llm-tools` ^4.10.0 (tool schemas), `react-native-gifted-chat` IMessage, SQLite via `messageDatabase`.

---

## File Structure

| Path | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add `@google/genai` dependency |
| `src/services/characterPromptBuilder.ts` | Create | `buildSystemInstruction` + `buildContentHistory` |
| `src/services/__tests__/characterPromptBuilder.test.ts` | Create | Tests for prompt builder |
| `src/services/edgeToolExecutors.ts` | Create | Pure local tool execution map |
| `src/services/__tests__/edgeToolExecutors.test.ts` | Create | Tests for tool executors |
| `src/hooks/useEdgeAgent.ts` | Create | `@google/genai` while-loop, escalation state |
| `src/hooks/__tests__/useEdgeAgent.test.ts` | Create | Tests for edge agent hook |
| `src/hooks/useAIChat.ts` | Modify | Wire `useEdgeAgent`, expose `escalationState`, edge-first routing |
| `src/components/ChatView.tsx` | Modify | Render escalation banner |

---

## Task 1: Install `@google/genai`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker
npm install @google/genai
```

- [ ] **Step 2: Verify installation**

```bash
node -e "const p = require('./node_modules/@google/genai/package.json'); console.log(p.version)"
```

Expected: prints a semver like `2.6.0` (no error).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @google/genai for on-device edge agent"
```

---

## Task 2: `characterPromptBuilder.ts` — System instruction + content history

**Files:**
- Create: `src/services/characterPromptBuilder.ts`
- Create: `src/services/__tests__/characterPromptBuilder.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/characterPromptBuilder.test.ts`:

```typescript
import { buildSystemInstruction, buildContentHistory } from '../characterPromptBuilder'
import type { CharacterPromptContext } from '../characterPromptBuilder'
import type { IMessage } from 'react-native-gifted-chat'

const baseCharacter = {
  id: 'char-1',
  name: 'Aria',
  appearance: 'A warm, curious companion',
  traits: 'Thoughtful, empathetic',
  emotions: 'Gentle and expressive',
  context: 'We met last week and talked about astronomy.',
}

describe('buildSystemInstruction', () => {
  it('includes character name', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    expect(buildSystemInstruction(ctx)).toContain('Aria')
  })

  it('includes appearance, traits, emotions, context', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    const result = buildSystemInstruction(ctx)
    expect(result).toContain('A warm, curious companion')
    expect(result).toContain('Thoughtful, empathetic')
    expect(result).toContain('Gentle and expressive')
    expect(result).toContain('We met last week')
  })

  it('includes memoryBlock when provided', () => {
    const ctx: CharacterPromptContext = {
      character: baseCharacter,
      userId: 'u1',
      memoryBlock: 'User likes jazz music.',
    }
    expect(buildSystemInstruction(ctx)).toContain('User likes jazz music.')
  })

  it('omits memory section when memoryBlock is undefined', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    expect(buildSystemInstruction(ctx)).not.toContain('Memory')
  })

  it('includes stay-in-character instruction', () => {
    const ctx: CharacterPromptContext = { character: baseCharacter, userId: 'u1' }
    expect(buildSystemInstruction(ctx)).toContain('Stay in character')
  })
})

describe('buildContentHistory', () => {
  const userId = 'user-123'
  const charId = 'char-1'

  const makeMsg = (
    id: string,
    text: string,
    senderId: string,
    createdAt: Date,
  ): IMessage => ({
    _id: id,
    text,
    createdAt,
    user: { _id: senderId },
  })

  it('maps user message to role "user"', () => {
    const msgs = [makeMsg('1', 'Hello', userId, new Date(1000))]
    const result = buildContentHistory(msgs, userId)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('user')
    expect(result[0].parts[0].text).toBe('Hello')
  })

  it('maps AI message to role "model"', () => {
    const msgs = [makeMsg('2', 'Hi there!', charId, new Date(2000))]
    const result = buildContentHistory(msgs, userId)
    expect(result).toHaveLength(1)
    expect(result[0].role).toBe('model')
  })

  it('sorts oldest to newest', () => {
    const msgs = [
      makeMsg('b', 'Second', charId, new Date(2000)),
      makeMsg('a', 'First', userId, new Date(1000)),
    ]
    const result = buildContentHistory(msgs, userId)
    expect(result[0].parts[0].text).toBe('First')
    expect(result[1].parts[0].text).toBe('Second')
  })

  it('filters out messages with empty text', () => {
    const msgs = [
      makeMsg('1', '', userId, new Date(1000)),
      makeMsg('2', 'Valid', userId, new Date(2000)),
    ]
    const result = buildContentHistory(msgs, userId)
    expect(result).toHaveLength(1)
    expect(result[0].parts[0].text).toBe('Valid')
  })

  it('returns empty array for empty input', () => {
    expect(buildContentHistory([], userId)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/services/__tests__/characterPromptBuilder.test.ts --no-coverage
```

Expected: FAIL with `Cannot find module '../characterPromptBuilder'`

- [ ] **Step 3: Implement `characterPromptBuilder.ts`**

Create `src/services/characterPromptBuilder.ts`:

```typescript
import type { Character } from '~/services/aiChatService'
import type { IMessage } from 'react-native-gifted-chat'

export interface CharacterPromptContext {
  character: Character
  userId: string
  memoryBlock?: string
}

export function buildSystemInstruction(ctx: CharacterPromptContext): string {
  const { character, memoryBlock } = ctx

  const lines: string[] = [
    `You are ${character.name}, a virtual friend.`,
    ``,
    `Appearance: ${character.appearance}`,
    `Personality traits: ${character.traits}`,
    `Emotional style: ${character.emotions}`,
  ]

  if (character.context) {
    lines.push(``, `Conversation context:`, character.context)
  }

  if (memoryBlock) {
    lines.push(``, `Memory:`, memoryBlock)
  }

  lines.push(
    ``,
    `Instructions:`,
    `- Stay in character as ${character.name} at all times`,
    `- Never reveal you are an AI`,
    `- Respond naturally and conversationally`,
    `- Keep responses concise (1-3 sentences) unless depth is needed`,
  )

  return lines.join('\n')
}

export function buildContentHistory(
  messages: IMessage[],
  userId: string,
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  return [...messages]
    .filter((msg) => msg.text?.trim())
    .sort(
      (a, b) =>
        new Date(a.createdAt as string | number | Date).getTime() -
        new Date(b.createdAt as string | number | Date).getTime(),
    )
    .map((msg) => ({
      role: (msg.user._id === userId ? 'user' : 'model') as 'user' | 'model',
      parts: [{ text: msg.text }],
    }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/services/__tests__/characterPromptBuilder.test.ts --no-coverage
```

Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/characterPromptBuilder.ts src/services/__tests__/characterPromptBuilder.test.ts
git commit -m "feat(edge): add CharacterPromptBuilder for @google/genai content format"
```

---

## Task 3: `edgeToolExecutors.ts` — Pure local tool map

**Files:**
- Create: `src/services/edgeToolExecutors.ts`
- Create: `src/services/__tests__/edgeToolExecutors.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/services/__tests__/edgeToolExecutors.test.ts`:

```typescript
import { edgeToolExecutors } from '../edgeToolExecutors'

describe('edgeToolExecutors', () => {
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/services/__tests__/edgeToolExecutors.test.ts --no-coverage
```

Expected: FAIL with `Cannot find module '../edgeToolExecutors'`

- [ ] **Step 3: Implement `edgeToolExecutors.ts`**

Create `src/services/edgeToolExecutors.ts`:

```typescript
export type ToolExecutor = (args: Record<string, unknown>) => unknown

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/services/__tests__/edgeToolExecutors.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/edgeToolExecutors.ts src/services/__tests__/edgeToolExecutors.test.ts
git commit -m "feat(edge): add edgeToolExecutors with get_current_time"
```

---

## Task 4: `useEdgeAgent.ts` — ADK-style while-loop hook

**Files:**
- Create: `src/hooks/useEdgeAgent.ts`
- Create: `src/hooks/__tests__/useEdgeAgent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/__tests__/useEdgeAgent.test.ts`:

```typescript
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

// Mock core-llm-tools so schema imports work
jest.mock('@equationalapplications/core-llm-tools', () => ({
  getCurrentTimeManifest: {
    schema: { name: 'get_current_time', description: 'Get current time', parameters: {} },
  },
  escalateToCloudManifest: {
    schema: { name: 'escalate_to_cloud', description: 'Escalate to cloud', parameters: {} },
  },
}))

// Mock edgeToolExecutors
jest.mock('~/services/edgeToolExecutors', () => ({
  edgeToolExecutors: {
    get_current_time: () => 'Thursday, May 28, 2026 at 10:00 AM PDT',
  },
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
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hi there')
    })

    expect(response).toEqual({ escalated: false, text: 'Hello! How are you?' })
    expect(result.current.escalationState).toBe('idle')
  })

  it('returns escalated:true when model calls escalate_to_cloud', async () => {
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'escalate_to_cloud', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
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
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('What time is it?')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toContain('Thursday')
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })

  it('escalates automatically when iteration cap is reached', async () => {
    // Always return a function call — never a text response
    mockGenerateContent.mockResolvedValue({
      text: undefined,
      functionCalls: [{ name: 'get_current_time', args: {} }],
    })

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Loop forever')
    })

    expect(response?.escalated).toBe(true)
    expect(result.current.escalationState).toBe('escalating')
    expect(mockGenerateContent).toHaveBeenCalledTimes(5) // MAX_ITERATIONS
  })

  it('isThinking is true during the call and false after', async () => {
    let resolveGenerate: (v: any) => void
    const pendingGenerate = new Promise((resolve) => { resolveGenerate = resolve })
    mockGenerateContent.mockReturnValueOnce(pendingGenerate)

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    expect(result.current.isThinking).toBe(false)

    let done = false
    act(() => {
      result.current.sendMessage('Hello').then(() => { done = true })
    })

    // isThinking should be true while pending
    expect(result.current.isThinking).toBe(true)

    await act(async () => {
      resolveGenerate!({ text: 'Hi!', functionCalls: undefined })
    })

    expect(result.current.isThinking).toBe(false)
    expect(done).toBe(true)
  })

  it('escalates when EXPO_PUBLIC_GEMINI_API_KEY is not set', async () => {
    delete process.env.EXPO_PUBLIC_GEMINI_API_KEY

    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('Hello')
    })

    expect(response?.escalated).toBe(true)
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/hooks/__tests__/useEdgeAgent.test.ts --no-coverage
```

Expected: FAIL with `Cannot find module '../useEdgeAgent'`

- [ ] **Step 3: Implement `useEdgeAgent.ts`**

Create `src/hooks/useEdgeAgent.ts`:

```typescript
import { useState, useCallback, useRef, useEffect } from 'react'
import { GoogleGenAI } from '@google/genai'
import type { IMessage } from 'react-native-gifted-chat'
import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'
import type { Character } from '~/services/aiChatService'
import { buildSystemInstruction, buildContentHistory } from '~/services/characterPromptBuilder'
import { edgeToolExecutors } from '~/services/edgeToolExecutors'

export type EscalationState = 'idle' | 'escalating'

export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: IMessage[]
}

export interface UseEdgeAgentReturn {
  sendMessage: (userText: string, memoryBlock?: string) => Promise<{ escalated: boolean; text?: string }>
  isThinking: boolean
  escalationState: EscalationState
}

const MAX_ITERATIONS = 5
const GEMINI_MODEL = 'gemini-2.5-flash'

export function useEdgeAgent({ character, userId, priorMessages }: UseEdgeAgentOptions): UseEdgeAgentReturn {
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
        return { escalated: true }
      }

      const ai = new GoogleGenAI({ apiKey })
      const systemInstruction = buildSystemInstruction({ character, userId, memoryBlock })
      const historyContents = buildContentHistory(priorMessagesRef.current, userId)

      const contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> = [
        ...historyContents,
        { role: 'user', parts: [{ text: userText }] },
      ]

      const tools = [
        {
          functionDeclarations: [
            getCurrentTimeManifest.schema,
            escalateToCloudManifest.schema,
          ],
        },
      ]

      try {
        let iterations = 0

        while (iterations < MAX_ITERATIONS) {
          iterations++

          const result = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: contents as any,
            config: { systemInstruction, tools } as any,
          })

          const functionCalls = (result as any).functionCalls as
            | Array<{ name: string; args: Record<string, unknown> }>
            | undefined

          if (!functionCalls || functionCalls.length === 0) {
            return { escalated: false, text: (result as any).text ?? '' }
          }

          const shouldEscalate = functionCalls.some((fc) => fc.name === 'escalate_to_cloud')
          if (shouldEscalate) {
            setEscalationState('escalating')
            return { escalated: true }
          }

          // Append model turn
          contents.push({
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          })

          // Execute tools and append function responses
          contents.push({
            role: 'user',
            parts: functionCalls.map((fc) => {
              const executor = edgeToolExecutors[fc.name]
              const output = executor ? executor(fc.args) : null
              return { functionResponse: { name: fc.name, response: { output } } }
            }),
          })
        }

        // Iteration cap — escalate
        setEscalationState('escalating')
        return { escalated: true }
      } finally {
        setIsThinking(false)
      }
    },
    [character, userId],
  )

  return { sendMessage, isThinking, escalationState }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/hooks/__tests__/useEdgeAgent.test.ts --no-coverage
```

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useEdgeAgent.ts src/hooks/__tests__/useEdgeAgent.test.ts
git commit -m "feat(edge): add useEdgeAgent with @google/genai while-loop and escalation"
```

---

## Task 5: Modify `useAIChat.ts` — Edge-first routing

**Files:**
- Modify: `src/hooks/useAIChat.ts`

**Context:** `useAIChat` currently calls `sendMessageWithAIResponse` for every message. The new flow tries the edge agent first. If the edge resolves the reply (`escalated === false`), we persist both messages locally (no Firebase). If the edge escalates (`escalated === true`), we fall through to `sendMessageWithAIResponse` unchanged — it handles saving the user message, calling Firebase, saving the AI response, and wiki write.

- [ ] **Step 1: Add imports and update the return interface**

Open `src/hooks/useAIChat.ts`. Replace the top section up through the `UseAIChatReturn` interface:

```typescript
import { useCallback, useState } from 'react'
import { IMessage } from 'react-native-gifted-chat'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  sendMessageWithAIResponse,
  Character,
  getRecentConversationHistory,
  triggerConversationSummary,
} from '~/services/aiChatService'
import { useChatMessages, messageKeys } from '~/hooks/useMessages'
import { useAuthMachine } from '~/hooks/useMachines'
import { usageSnapshotFromError } from '~/services/usageSnapshot'
import { formatContext, WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import { reportError } from '~/utilities/reportError'
import { saveAIMessage } from '~/database/messageDatabase'
import { sendMessage as persistUserMessage } from '~/services/messageService'
import { useEdgeAgent, EscalationState } from '~/hooks/useEdgeAgent'

interface UseAIChatProps {
  characterId: string
  userId: string
  character: Character
}

interface UseAIChatReturn {
  messages: IMessage[]
  sendMessage: (message: IMessage) => Promise<void>
  isGeneratingResponse: boolean
  error: string | null
  escalationState: EscalationState
}
```

- [ ] **Step 2: Add `useEdgeAgent` instantiation inside the hook body**

Inside `useAIChat`, after the `characterWiki` line, add:

```typescript
const edgeAgent = useEdgeAgent({
  character,
  userId,
  priorMessages: messages,
})
```

- [ ] **Step 3: Replace `mutationFn` with edge-first routing**

Replace the entire `mutationFn: async (message: IMessage) => { ... }` block with:

```typescript
mutationFn: async (message: IMessage) => {
  let memoryBlock: string | undefined
  try {
    const bundle = await characterWiki.read(message.text)
    if (bundle) memoryBlock = formatContext(bundle, { maxFacts: 10, maxTasks: 5, maxEvents: 10 })
  } catch (err) {
    if (!(err instanceof WikiBusyError)) reportError(err, `wiki:${character.id}:read`)
  }

  const onWriteObservation = (_characterId: string, text: string) => {
    void characterWiki.write(text).catch((err: unknown) => {
      if (!(err instanceof WikiBusyError)) reportError(err, `wiki:${character.id}:write`)
    })
  }

  // Try edge agent first
  const { escalated, text: edgeText } = await edgeAgent.sendMessage(message.text, memoryBlock)

  if (!escalated && edgeText !== undefined) {
    // Edge resolved — save both messages, no Firebase call
    await persistUserMessage(character.id, userId, message)

    const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const savedAIMessage = await saveAIMessage(character.id, userId, edgeText, aiMsgId, {
      user: {
        _id: character.id,
        name: character.name,
        avatar: character.appearance || undefined,
      },
    })

    void triggerConversationSummary(character, userId)

    const priorHistory = messages.filter(
      (msg) => String(msg._id) !== String(message._id),
    )
    const recentMessages = getRecentConversationHistory(
      [...priorHistory, message, savedAIMessage],
      20,
    )
    const chunk = recentMessages
      .map((msg) => `${msg.user._id === userId ? 'User' : character.name}: ${msg.text}`)
      .join('\n')

    try {
      void Promise.resolve(
        onWriteObservation(character.id, chunk || message.text),
      ).catch((observationError: unknown) => {
        if (!(observationError instanceof WikiBusyError)) {
          reportError(observationError, `wiki:${character.id}:write:observation`)
        }
      })
    } catch (observationError) {
      if (!(observationError instanceof WikiBusyError)) {
        reportError(observationError, `wiki:${character.id}:write:observation`)
      }
    }

    return { usageSnapshot: null }
  }

  // Escalated — Firebase path (unchanged)
  return sendMessageWithAIResponse(message, character, userId, messages, {
    memoryBlock,
    onWriteObservation,
  })
},
```

- [ ] **Step 4: Update the return statement**

Replace the return at the bottom of `useAIChat`:

```typescript
return {
  messages,
  sendMessage,
  isGeneratingResponse: aiMessageMutation.isPending,
  error,
  escalationState: edgeAgent.escalationState,
}
```

- [ ] **Step 5: Run the test suite to catch regressions**

```bash
npx jest --no-coverage 2>&1 | tail -20
```

Expected: All previously-passing tests still pass. (No test exists for `useAIChat` yet — this is acceptable.)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAIChat.ts
git commit -m "feat(edge): wire useEdgeAgent into useAIChat with edge-first routing"
```

---

## Task 6: Modify `ChatView.tsx` — Escalation banner

**Files:**
- Modify: `src/components/ChatView.tsx`

- [ ] **Step 1: Destructure `escalationState` from `useAIChat`**

In `ChatView.tsx`, find the line:

```typescript
const { sendMessage } = useAIChat({
```

Replace with:

```typescript
const { sendMessage, escalationState } = useAIChat({
```

- [ ] **Step 2: Add escalation banner inside the status view**

Find the block that renders wiki status banners:

```tsx
{(wikiStatus.ingesting || wikiStatus.librarian) && (
  <View
    accessibilityLiveRegion="polite"
    accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
  >
    {wikiStatus.ingesting && (
      <Text style={styles.statusText} accessibilityLabel="Ingesting document">⏳ Ingesting document…</Text>
    )}
    {wikiStatus.librarian && (
      <Text style={styles.statusText} accessibilityLabel="Updating memory">🧠 Updating memory…</Text>
    )}
  </View>
)}
```

Replace with:

```tsx
{(wikiStatus.ingesting || wikiStatus.librarian || escalationState === 'escalating') && (
  <View
    accessibilityLiveRegion="polite"
    accessibilityRole={Platform.OS === 'web' ? ('status' as any) : undefined}
  >
    {wikiStatus.ingesting && (
      <Text style={styles.statusText} accessibilityLabel="Ingesting document">⏳ Ingesting document…</Text>
    )}
    {wikiStatus.librarian && (
      <Text style={styles.statusText} accessibilityLabel="Updating memory">🧠 Updating memory…</Text>
    )}
    {escalationState === 'escalating' && (
      <Text style={styles.statusText} accessibilityLabel="Thinking deeply">🧠 Thinking deeply…</Text>
    )}
  </View>
)}
```

- [ ] **Step 3: Run the test suite**

```bash
npx jest --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatView.tsx
git commit -m "feat(edge): render escalation banner in ChatView when escalationState is escalating"
```

---

## Task 7: TypeScript check + full test run

**Files:** None (verification only)

- [ ] **Step 1: Run TypeScript compiler**

```bash
npm run typecheck 2>&1 | tail -30
```

Expected: No errors. If errors appear, fix them before proceeding.

- [ ] **Step 2: Run full test suite**

```bash
npm test -- --no-coverage 2>&1 | tail -30
```

Expected: All tests pass, including the 11 new tests added in Tasks 2–4.

- [ ] **Step 3: Verify acceptance criteria**

Check the spec's acceptance table:

| Criterion | How to verify |
|-----------|--------------|
| `get_current_time` resolves on-device, no Firebase | `useEdgeAgent.test.ts` "executes get_current_time tool" passes |
| Escalation sets `escalationState === 'escalating'` | `useEdgeAgent.test.ts` "returns escalated:true" passes |
| System prompt includes all character fields | `characterPromptBuilder.test.ts` passes |
| Tool schemas from `core-llm-tools`, no hardcoded strings | `useEdgeAgent.ts` imports `getCurrentTimeManifest.schema` |
| Edge messages don't call Firebase → no credit deduction | `useAIChat.ts` returns `{ usageSnapshot: null }` on edge path |
| GiftedChat no regressions | Full test suite passes |
| TypeScript build passes | `npm run typecheck` clean |

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix(edge): typecheck and test corrections"
```

---

## Post-Implementation Note

**Open question from spec (Section 6):** Confirm with product whether edge-resolved queries should cost zero credits. The current `ChatView.handleSend` credit guard (`credits <= 0 → /subscribe`) blocks ALL sends, including edge-resolvable ones. Resolving this guard requires product sign-off on the zero-credit edge model.

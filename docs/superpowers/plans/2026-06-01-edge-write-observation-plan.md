# Edge Memory Writing — `write_observation` Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `write_observation` tool so the local edge LLM can proactively persist user observations to the local SQLite wiki without cloud escalation.

**Architecture:** `clankerWriteObservationSchema` declares the tool to the Gemini model; `createEdgeToolExecutors` handles execution by calling a new `writeToWiki` wrapper in `wikiService.ts`; `useEdgeAgent` gates injection behind `if (wiki)` alongside the existing `search_memory` tool. The escalation schema description is tightened to forbid delegating memory writes to the cloud.

**Tech Stack:** `@google/genai` tool schema format, `@equationalapplications/expo-llm-wiki` (`wiki.write`), Jest + `@testing-library/react-native`

---

## File Map

| File | Change |
|------|--------|
| `src/services/clankerManifests.ts` | Export `clankerWriteObservationSchema`; tighten `clankerEscalationSchema.description` |
| `src/services/wikiService.ts` | Export `writeToWiki` thin wrapper |
| `src/services/edgeToolExecutors.ts` | Add `write_observation` in `createEdgeToolExecutors`; import `writeToWiki` |
| `src/hooks/useEdgeAgent.ts` | Import + inject `clankerWriteObservationSchema` into `functionDeclarations` |
| `src/services/__tests__/clankerManifests.test.ts` | Tests for new schema + updated escalation description |
| `src/services/__tests__/edgeToolExecutors.test.ts` | Tests for `write_observation` executor |
| `src/hooks/__tests__/useEdgeAgent.test.ts` | Tests for tool injection + mock update |

---

### Task 1: Schema declaration and escalation guard

**Files:**
- Modify: `src/services/clankerManifests.ts`
- Modify: `src/services/__tests__/clankerManifests.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/services/__tests__/clankerManifests.test.ts`:

```typescript
import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema, clankerWriteObservationSchema } from '../clankerManifests'

// ... (existing tests unchanged)

describe('clankerWriteObservationSchema', () => {
  it('has name write_observation', () => {
    expect(clankerWriteObservationSchema.name).toBe('write_observation')
  })

  it('description mentions long-term memory', () => {
    expect(clankerWriteObservationSchema.description).toContain('long-term memory')
  })

  it('has required summary parameter of type string', () => {
    const params = clankerWriteObservationSchema.parameters as {
      required: string[]
      properties: Record<string, { type: string }>
    }
    expect(params.required).toContain('summary')
    expect(params.properties['summary'].type).toBe('string')
  })

  it('parameters type is object', () => {
    expect(clankerWriteObservationSchema.parameters.type).toBe('object')
  })
})

describe('clankerEscalationSchema — updated guard', () => {
  it('description forbids WRITING/saving observations', () => {
    expect(clankerEscalationSchema.description).toContain('WRITING/saving observations')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/services/__tests__/clankerManifests.test.ts --no-coverage
```

Expected: FAIL — `clankerWriteObservationSchema is not exported` / description mismatch

- [ ] **Step 3: Add `clankerWriteObservationSchema` and update escalation description**

Replace the contents of `src/services/clankerManifests.ts` with:

```typescript
import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'

export const clankerTimeSchema = {
  ...getCurrentTimeManifest.schema,
  description:
    'CRITICAL: ALWAYS call this tool immediately if the user asks for the current time, date, day of the week, or uses relative temporal words (today, tomorrow). Do not guess or fabricate the time.',
}

export const clankerEscalationSchema = {
  ...escalateToCloudManifest.schema,
  description:
    'Escalate complex workflows or writing tasks. CRITICAL: Do NOT use this tool for checking the time, reading memory, or WRITING/saving observations.',
}

export const clankerMemorySchema = {
  name: 'search_memory',
  description:
    "Search the user's local long-term memory and wiki. ALWAYS use this tool if the user asks you to recall something previously discussed or look up a fact.",
  parameters: {
    type: 'object' as const,
    properties: { query: { type: 'string' as const } },
    required: ['query'],
  },
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/services/__tests__/clankerManifests.test.ts --no-coverage
```

Expected: PASS (all tests, including existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/services/clankerManifests.ts src/services/__tests__/clankerManifests.test.ts
git commit -m "feat(edge): add write_observation schema and tighten escalation guard"
```

---

### Task 2: `writeToWiki` helper

**Files:**
- Modify: `src/services/wikiService.ts`

`writeToWiki` is a thin export wrapper over `wiki.write`. It is exercised through the executor mock in Task 3; no dedicated unit test is needed (mirrors the existing `readFromWiki` pattern).

- [ ] **Step 1: Export `writeToWiki` from `wikiService.ts`**

Add after the `readFromWiki` function (after line 99):

```typescript
export async function writeToWiki(
  wiki: Wiki,
  entityId: string,
  event: { event_type: 'observation' | 'decision' | 'action' | 'outcome'; summary: string },
): Promise<void> {
  await wiki.write(entityId, event)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors on new function.

- [ ] **Step 3: Commit**

```bash
git add src/services/wikiService.ts
git commit -m "feat(wiki): export writeToWiki helper"
```

---

### Task 3: `write_observation` executor

**Files:**
- Modify: `src/services/edgeToolExecutors.ts`
- Modify: `src/services/__tests__/edgeToolExecutors.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/services/__tests__/edgeToolExecutors.test.ts` (also add `writeToWiki` to the mock at the top):

Update the mock at the top of the file — change:
```typescript
jest.mock('../wikiService', () => ({
  readFromWiki: jest.fn(),
}))
```
to:
```typescript
jest.mock('../wikiService', () => ({
  readFromWiki: jest.fn(),
  writeToWiki: jest.fn(),
}))
```

Add to the imports:
```typescript
import { readFromWiki, writeToWiki } from '../wikiService'
```

Add below the `mockReadFromWiki` line:
```typescript
const mockWriteToWiki = writeToWiki as jest.Mock
```

Append this `describe` block to the file:

```typescript
describe('createEdgeToolExecutors — write_observation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('write_observation is present in executor map', () => {
    const execs = createEdgeToolExecutors('char-1', null)
    expect(typeof execs['write_observation']).toBe('function')
  })

  it('returns failure message when wiki is null', async () => {
    const execs = createEdgeToolExecutors('char-1', null)
    const result = await execs['write_observation']({ summary: 'User likes tea' })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('returns failure message when summary is empty string', async () => {
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: '' })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('returns failure message when summary is whitespace only', async () => {
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: '   ' })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('returns failure message when summary is missing from args', async () => {
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({})
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('returns failure message when summary is not a string', async () => {
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: 42 })
    expect(result).toBe('Failed to record observation: Invalid input or missing database.')
    expect(mockWriteToWiki).not.toHaveBeenCalled()
  })

  it('calls writeToWiki with characterId and observation payload', async () => {
    mockWriteToWiki.mockResolvedValue(undefined)
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-42', wiki)
    await execs['write_observation']({ summary: 'User prefers dark mode' })
    expect(mockWriteToWiki).toHaveBeenCalledWith(wiki, 'char-42', {
      event_type: 'observation',
      summary: 'User prefers dark mode',
    })
  })

  it('returns success message on successful write', async () => {
    mockWriteToWiki.mockResolvedValue(undefined)
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: 'User likes jazz' })
    expect(result).toBe('Observation recorded successfully.')
  })

  it('returns internal error message when writeToWiki throws', async () => {
    mockWriteToWiki.mockRejectedValue(new Error('SQLite locked'))
    const wiki = {} as any
    const execs = createEdgeToolExecutors('char-1', wiki)
    const result = await execs['write_observation']({ summary: 'User likes jazz' })
    expect(result).toBe('Failed to record observation due to an internal error.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/services/__tests__/edgeToolExecutors.test.ts --no-coverage
```

Expected: FAIL — `writeToWiki is not a function` / executor not implemented

- [ ] **Step 3: Implement `write_observation` in `edgeToolExecutors.ts`**

Replace the full contents of `src/services/edgeToolExecutors.ts` with:

```typescript
import { readFromWiki, writeToWiki } from './wikiService'
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

export function createEdgeToolExecutors(characterId: string, wiki: Wiki | null): Record<string, ToolExecutor> {
  return {
    ...edgeToolExecutors,
    search_memory: async (args) => {
      try {
        const query = typeof args.query === 'string' ? args.query.trim() : ''
        if (!wiki || !query) return 'No relevant memories found.'

        const results = await readFromWiki(wiki, characterId, query)
        const hasMemories =
          results.facts.length > 0 || results.tasks.length > 0 || results.events.length > 0
        return hasMemories ? JSON.stringify(results) : 'No relevant memories found.'
      } catch (error) {
        console.error('[EdgeAgent] Local memory search failed:', error)
        return 'No relevant memories found.'
      }
    },
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest src/services/__tests__/edgeToolExecutors.test.ts --no-coverage
```

Expected: PASS (all tests, including existing `search_memory` tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/edgeToolExecutors.ts src/services/__tests__/edgeToolExecutors.test.ts
git commit -m "feat(edge): implement write_observation executor"
```

---

### Task 4: Inject tool into edge loop

**Files:**
- Modify: `src/hooks/useEdgeAgent.ts`
- Modify: `src/hooks/__tests__/useEdgeAgent.test.ts`

- [ ] **Step 1: Write failing tests**

In `src/hooks/__tests__/useEdgeAgent.test.ts`, update the `clankerManifests` mock to include the new schema:

Change:
```typescript
jest.mock('~/services/clankerManifests', () => ({
  clankerTimeSchema: { name: 'get_current_time', description: 'Get current time', parameters: {} },
  clankerEscalationSchema: { name: 'escalate_to_cloud_agent', description: 'Escalate to cloud', parameters: {} },
  clankerMemorySchema: {
    name: 'search_memory',
    description: 'Search memory',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
}))
```
to:
```typescript
jest.mock('~/services/clankerManifests', () => ({
  clankerTimeSchema: { name: 'get_current_time', description: 'Get current time', parameters: {} },
  clankerEscalationSchema: { name: 'escalate_to_cloud_agent', description: 'Escalate to cloud', parameters: {} },
  clankerMemorySchema: {
    name: 'search_memory',
    description: 'Search memory',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  clankerWriteObservationSchema: {
    name: 'write_observation',
    description: 'Write observation',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
  },
}))
```

Also update the `createEdgeToolExecutors` mock to include `write_observation`:

Change:
```typescript
jest.mock('~/services/edgeToolExecutors', () => ({
  createEdgeToolExecutors: jest.fn().mockReturnValue({
    get_current_time: () => 'Thursday, May 28, 2026 at 10:00 AM PDT',
    search_memory: async () => JSON.stringify({ facts: [{ content: 'User likes tea' }], tasks: [], events: [] }),
  }),
}))
```
to:
```typescript
jest.mock('~/services/edgeToolExecutors', () => ({
  createEdgeToolExecutors: jest.fn().mockReturnValue({
    get_current_time: () => 'Thursday, May 28, 2026 at 10:00 AM PDT',
    search_memory: async () => JSON.stringify({ facts: [{ content: 'User likes tea' }], tasks: [], events: [] }),
    write_observation: async () => 'Observation recorded successfully.',
  }),
}))
```

Append these tests to the `describe('useEdgeAgent')` block:

```typescript
  it('includes write_observation when wiki is provided', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Got it, I will remember that!',
      functionCalls: undefined,
    })

    const mockWiki = {} as any
    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: mockWiki }),
    )

    await act(async () => {
      await result.current.sendMessage('I prefer dark mode.')
    })

    const callArgs = mockGenerateContent.mock.calls[0][0]
    const functionDeclarations = callArgs.config.tools[0].functionDeclarations as { name: string }[]
    const names = functionDeclarations.map((fd) => fd.name)
    expect(names).toContain('write_observation')
    expect(names).toContain('search_memory')
  })

  it('does not include write_observation when wiki is null', async () => {
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
    expect(names).not.toContain('write_observation')
  })

  it('executes write_observation tool and loops to get text reply', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        text: undefined,
        functionCalls: [{ name: 'write_observation', args: { summary: 'User prefers dark mode' } }],
      })
      .mockResolvedValueOnce({
        text: 'Got it, I will remember that!',
        functionCalls: undefined,
      })

    const mockWiki = {} as any
    const { result } = renderHook(() =>
      useEdgeAgent({ character, userId: 'u1', priorMessages, isCloudSynced: false, wiki: mockWiki }),
    )

    let response: { escalated: boolean; text?: string } | undefined
    await act(async () => {
      response = await result.current.sendMessage('I prefer dark mode.')
    })

    expect(response?.escalated).toBe(false)
    expect(response?.text).toContain('remember')
    expect(mockGenerateContent).toHaveBeenCalledTimes(2)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest src/hooks/__tests__/useEdgeAgent.test.ts --no-coverage
```

Expected: FAIL — `write_observation` not in `functionDeclarations`, import missing

- [ ] **Step 3: Update `useEdgeAgent.ts` to import and inject the schema**

Change the import line in `src/hooks/useEdgeAgent.ts`:

```typescript
import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema } from '~/services/clankerManifests'
```
to:
```typescript
import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema, clankerWriteObservationSchema } from '~/services/clankerManifests'
```

Change the `if (wiki)` block:

```typescript
      if (wiki) {
        functionDeclarations.push(clankerMemorySchema)
      }
```
to:
```typescript
      if (wiki) {
        functionDeclarations.push(clankerMemorySchema)
        functionDeclarations.push(clankerWriteObservationSchema)
      }
```

- [ ] **Step 4: Run all tests to verify they pass**

```bash
npx jest src/hooks/__tests__/useEdgeAgent.test.ts src/services/__tests__/clankerManifests.test.ts src/services/__tests__/edgeToolExecutors.test.ts --no-coverage
```

Expected: PASS (all tests across all three files)

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: No new failures

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useEdgeAgent.ts src/hooks/__tests__/useEdgeAgent.test.ts
git commit -m "feat(edge): inject write_observation into edge loop when wiki present"
```

---

## Self-Review

**Spec coverage:**
- [x] `clankerWriteObservationSchema` exported from `clankerManifests.ts` — Task 1
- [x] Escalation description forbids WRITING/saving observations — Task 1
- [x] `write_observation` executor with validation + try/catch — Task 3
- [x] Uses `writeToWiki` wrapper matching ADK sandbox shape `{ event_type: 'observation', summary }` — Tasks 2 + 3
- [x] Injected behind `if (wiki)` in `useEdgeAgent.ts` — Task 4
- [x] Fails gracefully without throwing unhandled rejections — Task 3 (catch returns string, never throws)
- [x] Reuses existing `Promise.all` loop — no changes to loop structure needed

**Placeholder scan:** No TBDs, no "similar to" references, all code blocks complete.

**Type consistency:** `writeToWiki` signature uses `Wiki` from `wikiService`; executor imports `writeToWiki` from `'./wikiService'`; both match. Schema `as const` casts on `type` fields match existing `clankerMemorySchema` pattern.

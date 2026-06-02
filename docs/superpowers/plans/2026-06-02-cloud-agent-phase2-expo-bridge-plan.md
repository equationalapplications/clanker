# Cloud Agent Phase 2: Expo Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Expo app to call the Cloud Agent via HTTP for escalated cloud-synced characters, replacing the Firebase `generateReply` path for those characters.

**Architecture:** New `cloudAgentService.ts` handles the authenticated HTTP call to `POST /agent/run`. `useAIChat.ts` routes escalated+isCloudSynced messages to the Cloud Agent when `EXPO_PUBLIC_CLOUD_AGENT_URL` is set; otherwise falls through to the existing Firebase path.

**Tech Stack:** React Native, `@react-native-firebase/auth` (ID token), global `fetch`, `buildContentHistory` from `CharacterPromptBuilder`, `listTasks` from `taskDatabase`.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `.env.example` | Add `EXPO_PUBLIC_CLOUD_AGENT_URL=` |
| Create | `src/services/cloudAgentService.ts` | Authenticated HTTP POST to Cloud Agent |
| Create | `__tests__/cloudAgentService.test.ts` | Unit tests for cloudAgentService |
| Modify | `src/hooks/useAIChat.ts` | Route escalated+isCloudSynced to Cloud Agent |
| Modify | `__tests__/useAIChat.test.tsx` | Tests for Cloud Agent routing |

---

## Task 1: Add `EXPO_PUBLIC_CLOUD_AGENT_URL` to env example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add env var to `.env.example`**

Open `.env.example`. After `EXPO_PUBLIC_REVENUECAT_GOOGLE_KEY=`, append:

```
# Cloud Agent (Epic 2)
# Local dev: http://<YOUR_MACHINE_LOCAL_IP>:8080/agent/run  (not localhost — RN simulator uses device IP)
# Production: Cloud Run HTTPS URL
EXPO_PUBLIC_CLOUD_AGENT_URL=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add EXPO_PUBLIC_CLOUD_AGENT_URL env var"
```

---

## Task 2: Create `cloudAgentService.ts` with tests (TDD)

**Files:**
- Create: `__tests__/cloudAgentService.test.ts`
- Create: `src/services/cloudAgentService.ts`

### cloudAgentService contract

```typescript
// callCloudAgent throws if:
//   - EXPO_PUBLIC_CLOUD_AGENT_URL not set
//   - auth.currentUser is null (no token)
//   - response.ok is false
//   - response body missing `reply` string
// On success returns { reply: string, toolCalls: string[] }
```

- [ ] **Step 1: Write the failing tests**

Create `__tests__/cloudAgentService.test.ts`:

```typescript
const mockGetIdToken = jest.fn()

jest.mock('~/config/firebaseConfig', () => ({
  auth: {
    get currentUser() {
      return mockGetIdToken.mock.calls.length >= 0
        ? { getIdToken: (...args: unknown[]) => mockGetIdToken(...args) }
        : null
    },
  },
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

describe('callCloudAgent', () => {
  const OLD_ENV = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...OLD_ENV, EXPO_PUBLIC_CLOUD_AGENT_URL: 'http://10.0.0.1:8080/agent/run' }
    mockGetIdToken.mockResolvedValue('firebase-id-token')
  })

  afterEach(() => {
    process.env = OLD_ENV
  })

  it('throws when EXPO_PUBLIC_CLOUD_AGENT_URL is not set', async () => {
    delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
    const { callCloudAgent } = require('~/services/cloudAgentService')
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('EXPO_PUBLIC_CLOUD_AGENT_URL is not configured')
  })

  it('throws when auth.currentUser is null', async () => {
    jest.resetModules()
    jest.mock('~/config/firebaseConfig', () => ({
      auth: { currentUser: null },
    }))
    const { callCloudAgent } = require('~/services/cloudAgentService')
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('No authenticated user')
  })

  it('makes POST with Authorization header and returns reply', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Hello!', toolCalls: ['create_task'] }),
    })
    const { callCloudAgent } = require('~/services/cloudAgentService')

    const result = await callCloudAgent({
      message: 'hi',
      characterId: 'char-1',
      history: [{ role: 'user', parts: [{ text: 'hey' }] }],
      unsyncedHistory: [{ type: 'task', id: 't1', title: 'Buy milk', status: 'open', createdAt: 1000 }],
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'http://10.0.0.1:8080/agent/run',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer firebase-id-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          message: 'hi',
          characterId: 'char-1',
          history: [{ role: 'user', parts: [{ text: 'hey' }] }],
          unsyncedHistory: [{ type: 'task', id: 't1', title: 'Buy milk', status: 'open', createdAt: 1000 }],
        }),
      }),
    )
    expect(result).toEqual({ reply: 'Hello!', toolCalls: ['create_task'] })
  })

  it('defaults toolCalls to [] when absent in response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'Sure!' }),
    })
    const { callCloudAgent } = require('~/services/cloudAgentService')
    const result = await callCloudAgent({ message: 'hi', characterId: 'char-1' })
    expect(result.toolCalls).toEqual([])
  })

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 })
    const { callCloudAgent } = require('~/services/cloudAgentService')
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('Cloud Agent responded with 401')
  })

  it('throws when response body missing reply', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ toolCalls: [] }),
    })
    const { callCloudAgent } = require('~/services/cloudAgentService')
    await expect(
      callCloudAgent({ message: 'hi', characterId: 'char-1' }),
    ).rejects.toThrow('Invalid Cloud Agent response')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/cloudAgentService.test.ts --no-coverage
```

Expected: FAIL with `Cannot find module '~/services/cloudAgentService'`

- [ ] **Step 3: Implement `cloudAgentService.ts`**

Create `src/services/cloudAgentService.ts`:

```typescript
import { auth } from '~/config/firebaseConfig'
import type { Content } from '@google/genai'

export interface CloudAgentUnsyncedTask {
  type: 'task'
  id: string
  title: string
  status: string
  createdAt: number
}

export interface CloudAgentPayload {
  message: string
  characterId: string
  history?: Content[]
  unsyncedHistory?: CloudAgentUnsyncedTask[]
}

export interface CloudAgentResult {
  reply: string
  toolCalls: string[]
}

export async function callCloudAgent(payload: CloudAgentPayload): Promise<CloudAgentResult> {
  const url = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
  if (!url) throw new Error('EXPO_PUBLIC_CLOUD_AGENT_URL is not configured')

  const token = await auth.currentUser?.getIdToken()
  if (!token) throw new Error('No authenticated user')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Cloud Agent responded with ${response.status}`)
  }

  const data = (await response.json()) as { reply?: string; toolCalls?: string[] }
  if (!data.reply || typeof data.reply !== 'string') {
    throw new Error('Invalid Cloud Agent response')
  }

  return { reply: data.reply, toolCalls: data.toolCalls ?? [] }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest __tests__/cloudAgentService.test.ts --no-coverage
```

Expected: PASS (6 tests in cloudAgentService suite)

- [ ] **Step 5: Commit**

```bash
git add src/services/cloudAgentService.ts __tests__/cloudAgentService.test.ts
git commit -m "feat(expo): add cloudAgentService HTTP client for Cloud Agent"
```

---

## Task 3: Route escalated cloud-synced messages to Cloud Agent in `useAIChat.ts`

**Files:**
- Modify: `__tests__/useAIChat.test.tsx`
- Modify: `src/hooks/useAIChat.ts`

### What changes in `useAIChat.ts`

Add these imports at the top of the file:

```typescript
import { callCloudAgent } from '~/services/cloudAgentService'
import { listTasks } from '~/database/taskDatabase'
import { buildContentHistory } from '~/services/CharacterPromptBuilder'
```

Insert the Cloud Agent branch **after** the edge-resolved block and **before** the existing Firebase escalation block. The complete new block (shown in context):

```typescript
// ── existing edge-resolved block (UNCHANGED) ────────────────────────────────
if (!escalated && edgeText !== undefined) {
  // ... (unchanged)
  return { usageSnapshot: null }
}

// ── NEW: Cloud Agent path ───────────────────────────────────────────────────
// Guard: character.cloud_id required — character.id is local-only and produces
// zero results from Cloud Agent DB queries. Falls through to Firebase if unset.
if (isCloudSynced && character.cloud_id && process.env.EXPO_PUBLIC_CLOUD_AGENT_URL) {
  const cloudCharacterId = character.cloud_id

  const priorHistory = messages.filter(
    (msg) => String(msg._id) !== String(message._id),
  )
  const recentHistory = getRecentConversationHistory(priorHistory, 20)
  const history = buildContentHistory(recentHistory, userId)

  const localTasks = await listTasks(character.id)
  const unsyncedHistory = localTasks.map((t) => ({
    type: 'task' as const,
    id: t.id,
    title: t.title,
    status: t.status,
    createdAt: t.created_at,
  }))

  const agentResult = await callCloudAgent({
    message: message.text,
    characterId: cloudCharacterId,
    history,
    unsyncedHistory,
  })

  await persistUserMessage(character.id, userId, message)

  const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  const savedAIMessage = await saveAIMessage(
    character.id,
    userId,
    agentResult.reply,
    aiMsgId,
    {
      user: {
        _id: character.id,
        name: character.name,
        avatar: character.appearance || undefined,
      },
    },
  )

  void triggerConversationSummary(character, userId)

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
    ).catch((obsErr: unknown) => {
      if (!(obsErr instanceof WikiBusyError)) {
        reportError(obsErr, `wiki:${character.id}:write:observation`)
      }
    })
  } catch (obsErr) {
    if (!(obsErr instanceof WikiBusyError)) {
      reportError(obsErr, `wiki:${character.id}:write:observation`)
    }
  }

  return { usageSnapshot: null }
}
// ── END Cloud Agent path ────────────────────────────────────────────────────

// Escalated — Firebase path with unsynced history (UNCHANGED from here)
let unsyncedLocal = await getUnsyncedMessages(character.id, userId)
```

- [ ] **Step 1: Write the failing tests**

Add the following to `__tests__/useAIChat.test.tsx`.

After the existing mock blocks (around line 100, after the `useEdgeAgent` mock), add:

```typescript
const mockCallCloudAgent = jest.fn()
const mockListTasks = jest.fn().mockResolvedValue([])

jest.mock('~/services/cloudAgentService', () => ({
  callCloudAgent: (...args: unknown[]) => mockCallCloudAgent(...args),
}))

jest.mock('~/database/taskDatabase', () => ({
  listTasks: (...args: unknown[]) => mockListTasks(...args),
}))
```

Update `renderUseAIChat` to accept `cloud_id` override (needed so tests can exercise the null case):

```typescript
function renderUseAIChat(overrides: Partial<{ save_to_cloud: number; cloud_id: string | null }> = {}): HookValue {
  let hookValue: HookValue | null = null

  function Probe() {
    hookValue = useAIChat({
      characterId: 'char-1',
      userId: 'user-1',
      character: {
        id: 'char-1',
        name: 'Nova',
        appearance: 'avatar',
        traits: 'kind',
        emotions: 'calm',
        context: 'friendly',
        save_to_cloud: overrides.save_to_cloud ?? 1,
        cloud_id: 'cloud_id' in overrides ? overrides.cloud_id : 'cloud-char-uuid-1',
      },
    })
    return null
  }

  act(() => { create(<Probe />) })

  if (hookValue === null) throw new Error('useAIChat did not produce value')
  return hookValue as HookValue
}
```

Add to `beforeEach` in the existing `describe('useAIChat')` block:

```typescript
mockCallCloudAgent.mockResolvedValue({ reply: 'Cloud reply!', toolCalls: [] })
mockListTasks.mockResolvedValue([])
process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://10.0.0.1:8080/agent/run'
```

Add to `afterEach` (create one if not present):

```typescript
afterEach(() => {
  delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
})
```

Add these test cases inside `describe('useAIChat')`:

```typescript
describe('Cloud Agent path', () => {
  beforeEach(() => {
    mockUseEdgeAgent.mockReturnValue({
      sendMessage: jest.fn().mockResolvedValue({ escalated: true, text: undefined }),
      escalationState: 'escalating',
    })
  })

  it('calls Cloud Agent when isCloudSynced=true and URL is configured', async () => {
    const hook = renderUseAIChat({ save_to_cloud: 1 })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-cloud-1',
        text: 'Use cloud agent',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockCallCloudAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Use cloud agent',
        characterId: 'cloud-char-uuid-1', // cloud_id, NOT character.id
        history: expect.any(Array),
        unsyncedHistory: expect.any(Array),
      }),
    )
    expect(mockSendMessageWithAIResponse).not.toHaveBeenCalled()
  })

  it('sends local tasks as unsyncedHistory', async () => {
    mockListTasks.mockResolvedValue([
      { id: 't1', character_id: 'char-1', title: 'Buy milk', status: 'pending', created_at: 1000 },
    ])
    const hook = renderUseAIChat({ save_to_cloud: 1 })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-cloud-2',
        text: 'Tasks please',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockCallCloudAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        unsyncedHistory: [
          { type: 'task', id: 't1', title: 'Buy milk', status: 'pending', createdAt: 1000 },
        ],
      }),
    )
  })

  it('saves Cloud Agent reply as AI message', async () => {
    mockCallCloudAgent.mockResolvedValue({ reply: 'Cloud says hi!', toolCalls: [] })
    const hook = renderUseAIChat({ save_to_cloud: 1 })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-cloud-3',
        text: 'Hello',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'Cloud says hi!',
      expect.any(String),
      expect.objectContaining({ user: expect.objectContaining({ _id: 'char-1' }) }),
    )
  })

  it('falls through to Firebase when URL is not configured', async () => {
    delete process.env.EXPO_PUBLIC_CLOUD_AGENT_URL
    const hook = renderUseAIChat({ save_to_cloud: 1 })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-firebase',
        text: 'Fallback to firebase',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockCallCloudAgent).not.toHaveBeenCalled()
    expect(mockSendMessageWithAIResponse).toHaveBeenCalled()
  })

  it('falls through to Firebase when isCloudSynced=false', async () => {
    const hook = renderUseAIChat({ save_to_cloud: 0 })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-firebase-2',
        text: 'Not cloud synced',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockCallCloudAgent).not.toHaveBeenCalled()
    expect(mockSendMessageWithAIResponse).toHaveBeenCalled()
  })

  it('falls through to Firebase when cloud_id is null (character not yet synced to cloud)', async () => {
    const hook = renderUseAIChat({ save_to_cloud: 1, cloud_id: null })

    await act(async () => {
      await hook.sendMessage({
        _id: 'msg-no-cloud-id',
        text: 'No cloud id yet',
        createdAt: new Date('2026-06-02T00:00:00.000Z'),
        user: { _id: 'user-1' },
      } as any)
    })

    expect(mockCallCloudAgent).not.toHaveBeenCalled()
    expect(mockSendMessageWithAIResponse).toHaveBeenCalled()
  })

  it('propagates Cloud Agent errors so onError can roll back the optimistic update', async () => {
    mockCallCloudAgent.mockRejectedValue(new Error('Cloud Agent responded with 500'))
    const hook = renderUseAIChat({ save_to_cloud: 1 })

    await act(async () => {
      await expect(
        hook.sendMessage({
          _id: 'msg-fail',
          text: 'Failing',
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          user: { _id: 'user-1' },
        } as any),
      ).rejects.toThrow('Cloud Agent responded with 500')
    })

    expect(mockSendMessageWithAIResponse).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/useAIChat.test.tsx --no-coverage
```

Expected: FAIL — `mockCallCloudAgent` not called, etc.

- [ ] **Step 3: Add imports to `useAIChat.ts`**

At the top of `src/hooks/useAIChat.ts`, add three new imports after the existing imports:

```typescript
import { callCloudAgent } from '~/services/cloudAgentService'
import { listTasks } from '~/database/taskDatabase'
import { buildContentHistory } from '~/services/CharacterPromptBuilder'
```

- [ ] **Step 4: Insert the Cloud Agent branch in `useAIChat.ts`**

Locate the line in `mutationFn` that reads:

```typescript
      // Escalated — Firebase path with unsynced history
```

Insert the following block immediately **before** that comment:

```typescript
      // Cloud Agent path — isCloudSynced characters with a cloud_id when EXPO_PUBLIC_CLOUD_AGENT_URL is set.
      // Must send character.cloud_id (Cloud SQL UUID) — character.id is local-only and
      // will silently produce zero results from Cloud Agent DB queries.
      if (isCloudSynced && character.cloud_id && process.env.EXPO_PUBLIC_CLOUD_AGENT_URL) {
        const cloudCharacterId = character.cloud_id

        const priorHistory = messages.filter(
          (msg) => String(msg._id) !== String(message._id),
        )
        const recentHistory = getRecentConversationHistory(priorHistory, 20)
        const history = buildContentHistory(recentHistory, userId)

        const localTasks = await listTasks(character.id)
        const unsyncedHistory = localTasks.map((t) => ({
          type: 'task' as const,
          id: t.id,
          title: t.title,
          status: t.status,
          createdAt: t.created_at,
        }))

        const agentResult = await callCloudAgent({
          message: message.text,
          characterId: cloudCharacterId,
          history,
          unsyncedHistory,
        })

        await persistUserMessage(character.id, userId, message)

        const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
        const savedAIMessage = await saveAIMessage(
          character.id,
          userId,
          agentResult.reply,
          aiMsgId,
          {
            user: {
              _id: character.id,
              name: character.name,
              avatar: character.appearance || undefined,
            },
          },
        )

        void triggerConversationSummary(character, userId)

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
          ).catch((obsErr: unknown) => {
            if (!(obsErr instanceof WikiBusyError)) {
              reportError(obsErr, `wiki:${character.id}:write:observation`)
            }
          })
        } catch (obsErr) {
          if (!(obsErr instanceof WikiBusyError)) {
            reportError(obsErr, `wiki:${character.id}:write:observation`)
          }
        }

        return { usageSnapshot: null }
      }

```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
npx jest __tests__/useAIChat.test.tsx --no-coverage
```

Expected: PASS (all existing tests still pass, new Cloud Agent tests pass)

- [ ] **Step 6: Run full test suite to catch regressions**

```bash
npx jest --no-coverage
```

Expected: PASS (same pass count as before, plus new tests)

- [ ] **Step 7: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useAIChat.ts __tests__/useAIChat.test.tsx
git commit -m "feat(expo): route escalated cloud-synced messages to Cloud Agent"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Task |
|---|---|
| `callCloudAgent` service with auth + fetch | Task 2 |
| `EXPO_PUBLIC_CLOUD_AGENT_URL` env var | Task 1 |
| Route escalated+isCloudSynced to Cloud Agent | Task 3 |
| Send `character.cloud_id` not `character.id` | Task 3 (implementation guard + `cloudCharacterId` var; test asserts `characterId: 'cloud-char-uuid-1'`) |
| Falls through to Firebase when `cloud_id` is null | Task 3 (test: "falls through to Firebase when cloud_id is null") |
| Falls through to Firebase when URL not set | Task 3 (test: "falls through to Firebase when URL is not configured") |
| Falls through to Firebase when not isCloudSynced | Task 3 (test: "falls through to Firebase when isCloudSynced=false") |
| `history` built with `buildContentHistory` | Task 3 (implementation) |
| `unsyncedHistory` = local tasks from `listTasks` | Task 3 (implementation + test) |
| `usageSnapshot: null` returned | Task 3 (implementation) |
| Cloud Agent error propagates for rollback | Task 3 (test: "propagates Cloud Agent errors") |

All spec requirements covered.

### Placeholder scan

No TBD/TODO/placeholder text. All steps include complete code.

### Type consistency

- `CloudAgentUnsyncedTask` defined in `cloudAgentService.ts`, used consistently in `useAIChat.ts` via inline object literal (matches shape)
- `callCloudAgent` signature matches usage in `useAIChat.ts`
- `listTasks` returns `LocalTask[]` with `created_at: number`; mapped to `createdAt: number` correctly
- `buildContentHistory` accepts `IMessage[]` and returns compatible `Content[]` shape

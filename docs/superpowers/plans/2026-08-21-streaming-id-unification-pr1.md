# Streaming ID Unification (PR 1 of 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One `_id` per cloud-agent AI reply from stream start through persistence — no bubble remount, no blank-gap window.

**Architecture:** `runCloudAgentTurn` mints the `ai_…` id once, before the agent call, and uses it for both the streamed row and the persisted row. `ChatView` filters the persisted row out of the list while the streamed copy is still mounted, and the hook clears `streamingMessage` only after the post-success refetch has delivered the persisted row (immediately on failure). Pure JS change — no schema, no native, no migration.

**Tech Stack:** Expo 57 / React Native / TypeScript 6, `@tanstack/react-query` v5, Jest + `jest-expo` + `@testing-library/react-native`.

**Spec:** [2026-08-21-streaming-id-unification-and-credit-spend-attribution-design](../specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md) (Fix A only — Fix B / credit attribution is PR 2, planned separately).

## How the spec splits into PRs

The spec shipped two independent defects as one PR; per the follow-up decision they now ship as **two PRs**:

| PR                    | Contents                                                                                                       | Branch                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **1 (this plan)**     | Fix A — streaming id unification: `useAIChat.ts`, `ChatView.tsx`, tests                                        | `fix/streaming-id-unification` |
| **2 (separate plan)** | Fix B — credit spend attribution: migration, `functions` + `cloud-agent` credit services, all spend call sites | planned after PR 1 merges      |

Two, not three: the two defects are the spec's own independent seam, and Fix B's uniform signature change is best reviewed across both backends at once. If PR 2's review balloons, peeling `cloud-agent` off into a follow-up PR is safe (the migration lands with `functions`; `cloud-agent` writes into an existing table) — no rework of this plan either way.

## Global Constraints

- PRs target **`staging`**, never `main`. The user merges explicitly; never assume a PR merged.
- CI gates run `:check` scripts only (`lint:check`, `format:check`, `typecheck`, `test`). Never `--write`/`--fix` in CI steps, and **no formatting sweeps on this branch** — formatting changes never share a commit with logic changes.
- Platform pins: Expo 57, Node 24, TS 6. This PR is pure JS — no native modules, no `runtimeVersion` impact, no `BREAKING CHANGE:` footer anywhere (a `BREAKING CHANGE:` footer forces a store update and cuts installs off OTA).
- The id format stays `ai_<ms>_<base36>` — SQLite rows remain byte-compatible, no data migration.
- Edge-agent and Firebase-escalation paths never set `streamingMessage` and must stay untouched.
- Known pre-existing flake: `avatarPicker` under parallel test load. Do not attribute unrelated failures to it.
- Note: the spec's Testing section mentions baseline flakes in `useAIChat.test.tsx` — **that file does not exist on this branch** (verified 2026-08-21). Task 1 creates it fresh; ignore the stale reference.

## File Structure

| File                                            | Change                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/hooks/useAIChat.ts`                        | Modify: mint id once (Task 1); clear-after-refetch in `onSuccess`/`onError`/`onSettled` (Task 2); `sendPhoto` finally (Task 3) |
| `src/components/ChatView.tsx`                   | Modify: dedupe guard at line 155, export `ChatViewContent` (Task 4)                                                            |
| `src/hooks/__tests__/useAIChat.test.tsx`        | **Create**: full mock scaffold + 4 tests (Tasks 1–3)                                                                           |
| `src/components/__tests__/MessageList.test.tsx` | Modify: one added invariant test (Task 1)                                                                                      |
| `src/components/__tests__/ChatView.test.tsx`    | **Create**: dedupe test (Task 4)                                                                                               |

Test commands (from repo root): `npm test -- <path>` (the `test` script forwards args to jest), `npm run typecheck`, `npm run lint:check`, `npm run format:check`.

---

### Task 1: Mint the AI reply id once, before the agent call

**Files:**

- Create: `src/hooks/__tests__/useAIChat.test.tsx`
- Modify: `src/hooks/useAIChat.ts:124-133` (streaming `_id`) and `:154` (delete the persist-time mint)
- Modify: `src/components/__tests__/MessageList.test.tsx` (add one test)

**Interfaces:**

- Consumes: nothing new — existing `runCloudAgentTurn` in `useAIChat.ts`.
- Produces: the invariant _streamed `_id` === persisted `_id`_, format `ai_<Date.now()>_<base36>` (same expression as the old line 154). Tasks 2–4 rely on this; the MessageList test pins that the list layer survives a same-key row swap.

- [ ] **Step 1: Create the useAIChat test file with the mock scaffold and the failing id test**

The hook imports many services; every one must be mocked or the test pulls Firebase/SQLite into Jest. Create `src/hooks/__tests__/useAIChat.test.tsx` with exactly this scaffold plus the first test:

```tsx
import React from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react-native'
import { useAIChat } from '../useAIChat'
import type { Message } from '~/types/chat'

const mockCallCloudAgent = jest.fn()
jest.mock('~/services/cloudAgentService', () => ({
  callCloudAgent: (...args: unknown[]) => mockCallCloudAgent(...args),
}))

const mockSaveAIMessage = jest.fn()
jest.mock('~/database/messageDatabase', () => ({
  saveAIMessage: (...args: unknown[]) => mockSaveAIMessage(...args),
  getUnsyncedMessages: jest.fn(() => Promise.resolve([])),
  markMessagesAsSynced: jest.fn(() => Promise.resolve()),
}))

const mockPersistUserMessage = jest.fn(() => Promise.resolve())
jest.mock('~/services/messageService', () => ({
  sendMessage: (...args: unknown[]) => mockPersistUserMessage(...args),
}))

const mockTriggerSummary = jest.fn(() => Promise.resolve())
jest.mock('~/services/aiChatService', () => ({
  getRecentConversationHistory: jest.fn((history: unknown[]) => history.slice(-20)),
  triggerConversationSummary: () => mockTriggerSummary(),
}))

jest.mock('~/hooks/useMessages', () => ({
  // Faithful shape of the real factory (src/hooks/useMessages.ts:26-31) — the
  // hook uses these keys for optimistic cache writes and invalidation.
  useChatMessages: jest.fn(() => [] as Message[]),
  messageKeys: {
    all: ['messages'] as const,
    lists: () => ['messages', 'list'] as const,
    list: (characterId: string, recipientUserId: string) =>
      ['messages', 'list', characterId, recipientUserId] as const,
  },
}))

const mockAuthSend = jest.fn()
jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({ send: mockAuthSend }),
}))

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  WikiBusyError: class WikiBusyError extends Error {},
  formatContext: jest.fn(() => ''),
  useWiki: () => ({
    read: jest.fn(() => Promise.resolve(null)),
    write: jest.fn(() => Promise.resolve()),
  }),
}))

const mockWikiWrite = jest.fn(() => Promise.resolve())
jest.mock('~/hooks/useCharacterWiki', () => ({
  useCharacterWiki: () => ({
    read: jest.fn(() => Promise.resolve(null)),
    write: mockWikiWrite,
  }),
}))

// Escalate unconditionally so the mutation takes the cloud-agent path.
jest.mock('~/hooks/useEdgeAgent', () => ({
  useEdgeAgent: () => ({
    sendMessage: jest.fn(() =>
      Promise.resolve({ escalated: true, text: undefined, usageSnapshot: null }),
    ),
    escalationState: 'idle',
  }),
  EscalationState: {},
}))

jest.mock('~/utilities/reportError', () => ({ reportError: jest.fn() }))
jest.mock('~/services/syncMessage', () => ({ toSyncMessage: jest.fn(() => ({})) }))
jest.mock('~/database/taskDatabase', () => ({ listTasks: jest.fn(() => Promise.resolve([])) }))
jest.mock('~/services/CharacterPromptBuilder', () => ({
  buildContentHistory: jest.fn(() => []),
}))
jest.mock('~/auth/devSandboxFlag', () => ({ isDevSandboxEnabled: () => false }))
jest.mock('~/services/usageSnapshot', () => ({ usageSnapshotFromError: jest.fn(() => null) }))
jest.mock('~/database/characterImageDatabase', () => ({
  findCharacterImageByMessageId: jest.fn(() => Promise.resolve(null)),
}))
jest.mock('~/services/characterImageService', () => ({
  saveCharacterImage: jest.fn(() => Promise.resolve()),
}))
jest.mock('../../shared/dev-sandbox', () => ({ DEV_CLOUD_CHARACTER_ID: 'dev-sandbox-character' }))

const character = {
  id: 'char-1',
  name: 'Bot',
  appearance: '',
  traits: '',
  emotions: '',
  context: '',
  cloud_id: 'cloud-1',
  save_to_cloud: 1,
}

const userMessage: Message = {
  _id: 'msg_1',
  text: 'hi',
  createdAt: new Date(),
  user: { _id: 'user-1', name: 'You' },
}

const createWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return { queryClient, Wrapper }
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.EXPO_PUBLIC_CLOUD_AGENT_URL = 'http://localhost:8080'
  mockSaveAIMessage.mockImplementation(
    (_characterId: string, _userId: string, text: string, id: string) =>
      Promise.resolve({
        _id: id,
        text,
        createdAt: new Date(),
        user: { _id: 'char-1', name: 'Bot' },
      }),
  )
})

describe('useAIChat streaming id unification', () => {
  it('persists the AI reply under the same _id it streamed under', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
      { wrapper: Wrapper },
    )

    let resolveTurn!: () => void
    mockCallCloudAgent.mockImplementation(
      (_payload: unknown, handlers: { onToken?: (text: string) => void }) =>
        new Promise((resolve) => {
          resolveTurn = () => resolve({ reply: 'final reply', toolCalls: [], usageSnapshot: null })
          handlers.onToken?.('partial ')
        }),
    )

    let sendPromise!: Promise<void>
    act(() => {
      sendPromise = result.current.sendMessage(userMessage)
    })

    // Stream started — capture the streamed row's id.
    await waitFor(() => expect(result.current.streamingMessage?.text).toBe('partial '))
    const streamedId = result.current.streamingMessage!._id
    expect(streamedId).toMatch(/^ai_/)

    await act(async () => {
      resolveTurn()
    })
    await waitFor(() => expect(mockSaveAIMessage).toHaveBeenCalled())
    await sendPromise

    // THE invariant: the persisted row carries the streamed id, not a fresh one.
    expect(mockSaveAIMessage).toHaveBeenCalledWith(
      'char-1',
      'user-1',
      'final reply',
      streamedId,
      expect.anything(),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/hooks/__tests__/useAIChat.test.tsx`
Expected: FAIL — `saveAIMessage` receives an `ai_…` id while the streamed id was `streaming_…`, so the `toHaveBeenCalledWith(streamedId, …)` assertion rejects. (If the scaffold itself throws instead, fix the mock list first — the failure must be the assertion, not a module error.)

- [ ] **Step 3: Implement — mint once, up front**

In `src/hooks/useAIChat.ts`, hoist the id expression from line 154 above the `setStreamingMessage` call and use it for both rows. Replace lines 123-133:

```ts
setActiveTool(null)
// One id per AI reply: minted once, used for the streamed row AND the
// persisted row, so the stream→persist transition keeps the same React
// key and the bubble reconciles in place instead of remounting (Fix A.1).
const aiMsgId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
setStreamingMessage({
  _id: aiMsgId,
  text: '',
  createdAt: new Date(),
  user: {
    _id: character.id,
    name: character.name,
    avatar: character.appearance || undefined,
  },
})
```

Then delete line 154 (`const aiMsgId = \`ai_${Date.now()}_…\``) so `saveAIMessage`at line 165-171 receives the hoisted`aiMsgId`:

```ts
const savedAMessage = await saveAIMessage(
  character.id,
  userId,
  agentResult.reply,
  aiMsgId,
  aiMessageData,
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/hooks/__tests__/useAIChat.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Add the MessageList same-key swap invariant test**

Append inside `describe('MessageList streaming-key invariant', …)` in `src/components/__tests__/MessageList.test.tsx`:

```tsx
it('does not remount a row when a persisted row replaces the streamed row under the same _id', () => {
  // Fix A makes stream→persist a same-key, fresh-identity swap: the refetch
  // delivers a new row object whose _id equals the streamed one. This pins
  // that MessageList reconciles in place across that swap. Expected green
  // before and after the useAIChat change — it guards the list layer the id
  // unification now exercises.
  let avatarMountCount = 0
  const CountingAvatar: React.FC = () => {
    React.useEffect(() => {
      avatarMountCount += 1
    }, [])
    return null
  }
  const renderAvatar = (_message: Message) => <CountingAvatar />

  const streamed: Message = { ...baseMessage, _id: 'ai_42', text: '' }
  const view = render(
    <MessageList messages={[streamed]} currentUserId="user" renderAvatar={renderAvatar} />,
  )
  expect(avatarMountCount).toBe(1)

  // Refetch delivers the persisted row: fresh object identity, same _id.
  const persisted: Message = { ...baseMessage, _id: 'ai_42', text: 'hello world' }
  view.rerender(
    <MessageList messages={[persisted]} currentUserId="user" renderAvatar={renderAvatar} />,
  )

  expect(avatarMountCount).toBe(1)
  expect(view.getByText('hello world')).toBeTruthy()
})
```

- [ ] **Step 6: Run the MessageList tests**

Run: `npm test -- src/components/__tests__/MessageList.test.tsx`
Expected: PASS (3 tests) — including the new one on the first run (it is an invariant pin, not red-green).

- [ ] **Step 7: Commit**

```bash
git checkout -b fix/streaming-id-unification
git add src/hooks/useAIChat.ts src/hooks/__tests__/useAIChat.test.tsx src/components/__tests__/MessageList.test.tsx
git commit -m "fix(chat): reuse one AI reply id from stream start through persist"
```

---

### Task 2: Hold the streamed bubble until the refetch delivers (text path)

**Files:**

- Modify: `src/hooks/__tests__/useAIChat.test.tsx` (add 2 tests)
- Modify: `src/hooks/useAIChat.ts:372-397` (`onSettled`, `onSuccess`, `onError`)

**Interfaces:**

- Consumes: Task 1's scaffold and `createWrapper()`.
- Produces: new clearing contract — `onSettled` no longer touches `streamingMessage`; success clears only after `invalidateQueries` resolves; error clears immediately. Task 3 applies the same contract to `sendPhoto`; Task 4's dedupe guard makes clear-vs-refetch ordering safe.

- [ ] **Step 1: Write the two failing tests**

Append to the `describe` block in `src/hooks/__tests__/useAIChat.test.tsx`:

```tsx
it('clears the streamed row only after the post-success refetch resolves', async () => {
  const { queryClient, Wrapper } = createWrapper()
  const { result } = renderHook(
    () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
    { wrapper: Wrapper },
  )

  // Controllable invalidation: the refetch completes only when we resolve it.
  let resolveInvalidate!: () => void
  jest.spyOn(queryClient, 'invalidateQueries').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveInvalidate = resolve
      }),
  )

  mockCallCloudAgent.mockResolvedValue({ reply: 'final reply', toolCalls: [], usageSnapshot: null })

  let sendPromise!: Promise<void>
  act(() => {
    sendPromise = result.current.sendMessage(userMessage)
  })
  await waitFor(() => expect(queryClient.invalidateQueries).toHaveBeenCalled())

  // Mutation done, refetch pending — the bubble must still be held.
  expect(result.current.streamingMessage).not.toBeNull()

  await act(async () => {
    resolveInvalidate()
  })
  await waitFor(() => expect(result.current.streamingMessage).toBeNull())
  await sendPromise
})

it('clears the streamed row immediately when the turn fails', async () => {
  const { Wrapper } = createWrapper()
  const { result } = renderHook(
    () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
    { wrapper: Wrapper },
  )

  mockCallCloudAgent.mockRejectedValue(new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS'))

  await act(async () => {
    await result.current.sendMessage(userMessage).catch(() => {})
  })

  // No persisted row will ever arrive on failure — nothing to hand off to.
  expect(result.current.streamingMessage).toBeNull()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- src/hooks/__tests__/useAIChat.test.tsx`
Expected: first new test FAILS (old `onSettled` clears `streamingMessage` before the invalidation resolves, so `not.toBeNull()` rejects). Second new test PASSES already (the old `onSettled` clear also covers failure) — that is fine; it pins the new contract once the clear leaves `onSettled`.

- [ ] **Step 3: Implement the clearing contract**

In `src/hooks/useAIChat.ts`:

Replace `onSettled` (lines 372-376) — drop the `streamingMessage` clear, keep the rest:

```ts
    onSettled: () => {
      setIsSendingMessage(false)
      setActiveTool(null)
    },
```

Replace `onSuccess` (lines 378-397) — make it async, await the invalidation, clear in `finally` so a failed refetch can never orphan the bubble:

```ts
    onSuccess: async (result) => {
      try {
        if (result?.usageSnapshot) {
          authService.send({
            type: 'USAGE_SNAPSHOT_RECEIVED',
            source: 'generateReply',
            remainingCredits: result.usageSnapshot.remainingCredits,
            planTier: result.usageSnapshot.planTier,
            planStatus: result.usageSnapshot.planStatus,
            verifiedAt: result.usageSnapshot.verifiedAt,
          })
        }

        console.log('✅ AI chat message sent successfully')
        setError(null)

        // Await the refetch so the persisted row is in the list before the
        // streamed bubble unmounts — closes the blank-gap window (Fix A.3).
        await queryClient.invalidateQueries({
          queryKey: messageKeys.list(characterId, userId),
        })
      } finally {
        setStreamingMessage(null)
      }
    },
```

In `onError` (line 399), add the immediate clear as the first statement, above `console.error`:

```ts
    onError: (err, message, context) => {
      // Failure path: no persisted row will arrive, so drop the bubble at once
      // instead of waiting for a refetch (Fix A.3).
      setStreamingMessage(null)
      console.error('❌ Failed to send AI chat message:', err)
      …rest unchanged…
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- src/hooks/__tests__/useAIChat.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAIChat.ts src/hooks/__tests__/useAIChat.test.tsx
git commit -m "fix(chat): hold the streaming bubble until the refetch lands"
```

---

### Task 3: Same handoff rule for the photo path (`sendPhoto`)

**Files:**

- Modify: `src/hooks/__tests__/useAIChat.test.tsx` (add 1 test)
- Modify: `src/hooks/useAIChat.ts:542-547` (`sendPhoto`'s `finally`)

**Interfaces:**

- Consumes: Task 1 scaffold; Task 2's clearing contract (this task extends it to the second entry point).
- Produces: both turn entry points now clear `streamingMessage` only after the refetch resolves.

- [ ] **Step 1: Write the failing test**

Append to the `describe` block:

```tsx
it('sendPhoto holds the streamed row until the refetch resolves', async () => {
  const { queryClient, Wrapper } = createWrapper()
  ;(findCharacterImageByMessageId as jest.Mock).mockResolvedValue({ id: 'existing' })
  mockCallCloudAgent.mockResolvedValue({
    reply: 'what a nice photo',
    toolCalls: [],
    usageSnapshot: null,
  })

  let resolveInvalidate!: () => void
  const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveInvalidate = resolve
      }),
  )

  const { result } = renderHook(
    () => useAIChat({ characterId: 'char-1', userId: 'user-1', character }),
    { wrapper: Wrapper },
  )

  const photo = {
    messageId: 'msg_photo_1',
    imageId: 'img_1',
    uri: 'file:///photo.jpg',
    width: 10,
    height: 10,
    attachment: {},
    variants: {},
  } as never

  let photoPromise!: Promise<boolean>
  act(() => {
    photoPromise = result.current.sendPhoto(photo, 'look')
  })
  await waitFor(() => expect(result.current.streamingMessage).not.toBeNull())
  await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())

  // Held until the refetch resolves — same contract as the text path.
  expect(result.current.streamingMessage).not.toBeNull()

  await act(async () => {
    resolveInvalidate()
  })
  await waitFor(() => expect(result.current.streamingMessage).toBeNull())
  await expect(photoPromise).resolves.toBe(true)
})
```

Note: `findCharacterImageByMessageId` must be referenced directly in the test body — import it via the mocked module at the top of the file (`import { findCharacterImageByMessageId } from '~/database/characterImageDatabase'`) so the `mockResolvedValue` lands on the mock. The `as never` cast on `photo` keeps the test independent of `PendingChatPhoto`'s internal shape.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/hooks/__tests__/useAIChat.test.tsx`
Expected: FAIL — the current `finally` clears `streamingMessage` before awaiting invalidation, so the "held" assertion rejects.

- [ ] **Step 3: Implement**

In `src/hooks/useAIChat.ts`, replace the `finally` block (lines 542-547):

```ts
      } finally {
        turnInFlightRef.current = false
        setIsSendingMessage(false)
        try {
          // Same handoff rule as the text path: the refetched list must contain
          // the persisted row before the streamed bubble unmounts (Fix A.3).
          await queryClient.invalidateQueries({ queryKey: messageKeys.list(characterId, userId) })
        } finally {
          setStreamingMessage(null)
        }
      }
```

The `catch` block and the `sendPhoto` dependency array are unchanged (`queryClient` is already a dependency).

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/hooks/__tests__/useAIChat.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAIChat.ts src/hooks/__tests__/useAIChat.test.tsx
git commit -m "fix(chat): await refetch before dropping the streamed photo bubble"
```

---

### Task 4: Dedupe guard in ChatView + rendered-exactly-once test

**Files:**

- Modify: `src/components/ChatView.tsx:92` (export `ChatViewContent`) and `:155` (dedupe guard)
- Create: `src/components/__tests__/ChatView.test.tsx`

**Interfaces:**

- Consumes: Task 1's same-id invariant (the guard only filters when ids match).
- Produces: `export function ChatViewContent({ characterId, character, currentUserId, userDisplayName?, userPhotoUrl? })` — a named export alongside the existing default wrapper, for direct render in tests. Default export behavior unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/ChatView.test.tsx`:

```tsx
import React from 'react'
import { PaperProvider } from 'react-native-paper'
import { render } from '@testing-library/react-native'
import { ChatViewContent } from '../ChatView'
import type { Character } from '~/services/characterService'
import type { Message } from '~/types/chat'

const mockUseAIChat = jest.fn()
jest.mock('~/hooks/useAIChat', () => ({
  useAIChat: (props: unknown) => mockUseAIChat(props),
}))

jest.mock('~/hooks/usePowerBalance', () => ({
  usePowerBalance: () => ({ totalPower: 100, isLoading: false }),
}))

jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: jest.fn().mockReturnValue({ uri: null, isResolved: true }),
}))

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({
    getParent: jest.fn(() => undefined),
    addListener: jest.fn(() => jest.fn()),
  }),
}))

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
}))

jest.mock('react-native-keyboard-controller', () => ({
  KeyboardAvoidingView: require('react-native').View,
}))

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useEntityStatus: () => ({ ingesting: false, librarian: false }),
}))

jest.mock('~/components/LowPowerBanner', () => ({ LowPowerBanner: () => null }))
jest.mock('~/components/ChatInputBar', () => ({ ChatInputBar: () => null }))

// Fields beyond these that Character requires: extend the literal, not a cast.
const baseCharacter = {
  id: 'char-1',
  name: 'Bot',
  appearance: '',
  traits: '',
  emotions: '',
  context: '',
  avatar: null,
  active_image_id: null,
  cloud_id: 'cloud-1',
  save_to_cloud: 1,
} as Character

const baseChat = {
  messages: [] as Message[],
  sendMessage: jest.fn(() => Promise.resolve()),
  sendPhoto: jest.fn(() => Promise.resolve(true)),
  canSendPhoto: false,
  isGeneratingResponse: false,
  error: null,
  escalationState: 'idle' as const,
  activeTool: null,
  streamingMessage: null,
}

const renderChat = (ui: React.ReactElement) => render(<PaperProvider>{ui}</PaperProvider>)

describe('ChatView streamed/persisted dedupe', () => {
  it('renders the persisted row exactly once while the streamed row is still set', () => {
    // Worst-case overlap: the refetch delivered the persisted row while the
    // hook still holds the streamed copy. Same _id (Task 1 invariant), so
    // without the dedupe guard the list renders the same key twice.
    const row: Message = {
      _id: 'ai_same',
      text: 'final answer text',
      createdAt: new Date(),
      user: { _id: 'char-1', name: 'Bot' },
    }
    mockUseAIChat.mockReturnValue({
      ...baseChat,
      messages: [row],
      streamingMessage: { ...row },
    })

    const view = renderChat(
      <ChatViewContent characterId="char-1" character={baseCharacter} currentUserId="user-1" />,
    )
    expect(view.getAllByText('final answer text')).toHaveLength(1)

    // And the steady state after the hook clears the streamed copy.
    mockUseAIChat.mockReturnValue({ ...baseChat, messages: [row], streamingMessage: null })
    view.rerender(
      <ChatViewContent characterId="char-1" character={baseCharacter} currentUserId="user-1" />,
    )
    expect(view.getAllByText('final answer text')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/components/__tests__/ChatView.test.tsx`
Expected: FAIL — `ChatViewContent` is not exported (import error), and once exported, `getAllByText` finds 2 nodes because line 155 prepends the streamed copy without filtering. Fix the export first, confirm the count failure, then continue.

- [ ] **Step 3: Implement**

In `src/components/ChatView.tsx`, add `export` to the content component at line 92:

```ts
export function ChatViewContent({
```

Replace line 155 with the spec's order-independent guard:

```ts
// While a turn is streaming, the refetch may deliver the persisted row before
// the hook clears the streamed copy. Both share one _id (Fix A.1), so filter
// by id — whichever copy arrives first wins, and keys stay unique.
const displayMessages = streamingMessage
  ? [streamingMessage, ...messages.filter((m) => String(m._id) !== String(streamingMessage._id))]
  : messages
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/components/__tests__/ChatView.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatView.tsx src/components/__tests__/ChatView.test.tsx
git commit -m "fix(chat): dedupe streamed and persisted rows sharing an id"
```

---

### Task 5: Full gates, manual verification, and the PR

**Files:** none modified — verification and PR only.

- [ ] **Step 1: Run the full local gate suite**

```bash
npm test
npm run typecheck
npm run lint:check
npm run format:check
```

Expected: all green, modulo the documented pre-existing flakes (avatarPicker under parallel load). Any `format:check` failure: run `npx prettier --write` on **only the files this branch touched** — never a repo-wide sweep.

- [ ] **Step 2: Manual verification (spec §Verification)**

Web + device dev build against a cloud-synced character:

1. Send a text turn — the streaming bubble must persist into the final reply with no blink and no blank gap.
2. Repeat with a photo turn (caption and captionless).
3. Confirm the reply appears exactly once in both cases.

- [ ] **Step 3: Push and open the PR to `staging`**

```bash
git push -u origin fix/streaming-id-unification
gh pr create --base staging --title "fix(chat): streaming bubble id unification" --body "$(cat <<'EOF'
Implements Fix A of docs/superpowers/specs/2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md.

- One \`_id\` per AI reply from stream start through persistence (no remount on stream→persist)
- ChatView dedupes streamed/persisted rows sharing an id
- streamingMessage clears only after the refetch delivers the persisted row; immediately on failure (text and photo paths)

Pure JS app change — no schema, no native, no OTA runtimeVersion impact.
Fix B (credit spend attribution) follows as a separate PR.
EOF
)"
```

Expected: PR opened against `staging`. Report the URL and stop — the user merges explicitly.

---

## Self-review notes (done at plan time)

- **Spec coverage:** Fix A.1 → Task 1; A.2 → Task 4; A.3 text path → Task 2; A.3 photo path → Task 3; A.4 (edge/Firebase untouched, id format unchanged) → constraints + no task touches those paths. Testing bullets: MessageList same-id invariant → Task 1 Step 5; ChatView rendered-once → Task 4; persisted-equals-streamed / clear-after-invalidation / clear-on-failure → Tasks 1–3. Rollout: one PR to `staging`, four revertable commits, no formatting sweeps → Tasks 1–5.
- **Deliberate deviation from spec letter:** the spec's Testing section references a pre-existing `useAIChat.test.tsx` with baseline flakes — that file does not exist on this branch, so Task 1 creates it fresh with a full mock scaffold. The spec's "one PR, two commits" is superseded by the approved two-PR split.
- **Type consistency:** `aiMsgId` minted in Task 1 is the same local consumed by `saveAIMessage`; `createWrapper()`/scaffold from Task 1 reused verbatim in Tasks 2–3; `ChatViewContent` named export from Task 4 is the only new public surface.

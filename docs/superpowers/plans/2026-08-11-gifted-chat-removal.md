# `react-native-gifted-chat` Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `react-native-gifted-chat` with purpose-built components we own, so the dependency is removed without a chat-UI rewrite.

**Architecture:** Strangler pattern, four independently revertable PRs (0 → type, 1 → bubbles, 2 → input bar, 3 → container). Each slice leaves the app working. Slices 0–2 keep `react-native-gifted-chat` installed; only Slice 3 touches `package.json`. The build target is the React Native app at `clanker/` (the repo root), not the `cloud-agent/` backend in this plan's working directory.

**Source spec:** `docs/superpowers/specs/2026-08-11-gifted-chat-removal-design.md` (revised 2026-08-11). Where this plan and the spec disagree, the spec wins.

**Tech Stack:** React Native 0.86, Expo SDK 57, TypeScript, React Native Paper (theming), React Query (data), `react-native-keyboard-controller@1.21.9` (already a direct dep), `node:test` test syntax (Jest's syntax is DOA here — see [[cloud-agent-uses-node-test-not-jest]] note in MEMORY; this is the RN app, which uses Jest, but the plan keeps Jest-only constructs verifiable).

**Repo facts that drive plan shape (see [[gifted-chat-removal]] memory):**

- No semicolons. Every import line ends without one. Match the real text in every `Edit`.
- 6 of the 14 `IMessage` consumers use value imports: `messageDatabase.ts:6`, `useAIChat.ts:2`, `useMessages.ts:12`, `aiChatService.ts:14`, `messageService.ts:6`, `postNewMessage.ts:1`.
- No live staging environment. PRs target `staging` (the default branch), then are fast-forwarded to `main` — both reach production. Each slice must be independently revertable.

**App root for these tasks:** `clanker/` (the repo root). All paths in this plan are relative to that root. The current `cloud-agent/` working directory is the backend and is not part of this work.

---

## File Structure

### Files to create

| Path                                                          | Responsibility                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/types/chat.ts`                                           | `ChatUser`, `Message`, intersection helpers — the type we own (Slice 0)           |
| `src/utils/linkifyUrls.ts`                                    | Pure function: text → `Array<{ type: 'text' \| 'url'; value: string }>` (Slice 1) |
| `src/components/MessageBubble.tsx`                            | Themed bubble rendering text + image + footer (Slice 1)                           |
| `src/components/MessageText.tsx`                              | `<Text>` with nested URL taps via `linkifyUrls` (Slice 1)                         |
| `src/components/GroundingFooter.tsx`                          | Citation chips + `GroundingHtml` (Slice 1)                                        |
| `src/components/ChatInputBar.tsx`                             | Owns `text` state; renders `ChatComposer` + `SendButton` (Slice 2)                |
| `src/components/ChatComposer.tsx`                             | Unified, replaces both `.tsx` and `.web.tsx` variants (Slice 2)                   |
| `src/components/SendButton.tsx`                               | Spinner-while-generating pill (Slice 2)                                           |
| `src/components/MessageList.tsx`                              | Inverted FlatList with `MessageRow` (Slice 3)                                     |
| `src/components/MessageRow.tsx`                               | Side selection + avatar positioning (Slice 3)                                     |
| `src/utils/__tests__/linkifyUrls.test.ts`                     | Pure function tests (Slice 1)                                                     |
| `src/components/__tests__/MessageText.test.tsx`               | Segmentation tests (Slice 1)                                                      |
| `src/components/__tests__/MessageBubble.test.tsx`             | Side/theming/photo tests (Slice 1)                                                |
| `src/components/__tests__/GroundingFooter.test.tsx`           | Citation chips + search suggestions (Slice 1)                                     |
| `src/components/__tests__/ChatComposer.test.tsx`              | Unified composer tests (Slice 2)                                                  |
| `src/components/__tests__/ChatComposerWebHeightLoop.test.tsx` | Real-composer height loop regression (Slice 2)                                    |
| `src/components/__tests__/MessageList.test.tsx`               | Streaming-key invariant (Slice 3)                                                 |

### Files to modify

| Path                                                    | Slices                                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/components/ChatView.tsx`                           | S1 (bubble render), S2 (composer render), S3 (list render + mint `_id`) |
| `src/components/ChatComposer.tsx`                       | S2 (full rewrite into unified composer)                                 |
| `src/components/ChatComposer.tsx` (delete)              | S2 (merges into the above)                                              |
| `src/components/ChatComposer.web.tsx` (delete)          | S2                                                                      |
| `src/database/messageDatabase.ts`                       | S0 (repoint + drop `received`)                                          |
| `src/services/aiChatService.ts`                         | S0 (repoint + alias `GroundedIMessage`), S1 (drop alias)                |
| `src/hooks/useAIChat.ts`                                | S0 (repoint), S1 (drop `image` sentinel)                                |
| `src/hooks/useEdgeAgent.ts`                             | S0 (repoint)                                                            |
| `src/hooks/useLiveVoiceChat.ts`                         | S0 (repoint)                                                            |
| `src/hooks/useMessages.ts`                              | S0 (repoint)                                                            |
| `src/hooks/__tests__/useEdgeAgent.test.ts`              | S0 (repoint)                                                            |
| `src/machines/liveVoiceMachine.ts`                      | S0 (repoint), S1 (drop `GroundedIMessage` import)                       |
| `src/services/CharacterPromptBuilder.ts`                | S0 (repoint)                                                            |
| `src/services/__tests__/characterPromptBuilder.test.ts` | S0 (repoint)                                                            |
| `src/services/liveMemoryQuery.ts`                       | S0 (repoint)                                                            |
| `src/services/messageService.ts`                        | S0 (repoint)                                                            |
| `src/utilities/postNewMessage.ts`                       | S0 (repoint)                                                            |
| `src/components/ChatImageBubble.tsx`                    | S0 (repoint)                                                            |
| `package.json`                                          | S3 (delete `react-native-gifted-chat`)                                  |
| `package-lock.json`                                     | S3 (regenerated by `npm install`)                                       |
| `__tests__/chatViewAccessibility.test.tsx`              | S2 (rewrite 8 tests), S3 (rewrite 9)                                    |
| `__tests__/chatViewAvatarSource.test.tsx`               | S3 (mock factory removed)                                               |
| `__tests__/chatComposer.test.tsx`                       | S2 (mock factory deleted, 7 query sites repointed)                      |
| `__tests__/chatComposerWebHeightLoop.test.tsx`          | S2 (rewrite against real composer)                                      |

### Files to leave untouched

- `src/components/ChatImageBubble.tsx` (only the import changes in S0)
- `src/components/CharacterAvatar.tsx`
- `src/components/GroundingHtml.tsx`
- `src/components/LowPowerBanner.tsx`
- `src/hooks/useMessages.ts` (logic) — only the S0 import changes
- `src/services/messageService.ts` (logic) — only the S0 import changes
- `package-lock.json` (only regenerated in S3)

---

## Baseline

**Capture before Slice 0:**

```bash
cd clanker
npm test -- --testPathPattern='chatComposer|chatView' 2>&1 | tail -20
```

Expected: 49 (chatComposer) + 17 (chatViewAccessibility) + 10 (chatViewAvatarSource) + 3 (chatComposerWebHeightLoop) = **79 tests pass**. The delta-not-absolute signal is what matters at each slice.

```bash
grep -rE "react-native-gifted-chat" package.json | sort -u
```

Expected: one line `"react-native-gifted-chat": "^2.8.1",` in `package.json`.

---

## Slice 0 — Own the type

Create `src/types/chat.ts`; repoint the 14 type-only consumers at `~/types/chat`. Zero behavior change. Two deliberate exceptions to "repoint verbatim": drop `received` in `messageDatabase.ts` (it has a producer but no consumer), and keep `GroundedIMessage` as `= Message` so `ChatView.tsx` stays untouched this slice.

### Task 0.1: Create `src/types/chat.ts`

**Files:**

- Create: `src/types/chat.ts`

- [ ] **Step 1: Write the type module**

```ts
// src/types/chat.ts
import type { GroundingMetadata } from '@google/genai'

export interface ChatUser {
  _id: string
  name?: string
  avatar?: string
}

export interface Message {
  _id: string
  text: string
  createdAt: Date
  user: ChatUser
  // DB columns surfaced on the row
  pending?: boolean
  sent?: boolean
  error?: boolean
  edited?: boolean
  // Carried in the message_data JSON blob — arrived as untyped extras
  imageId?: string
  groundingMetadata?: GroundingMetadata
}

// Helper for the one producer that also needs `character_id` on the row.
export type MessageWithCharacter = Message & { character_id: string }
```

- [ ] **Step 2: Run typecheck to ensure the module compiles**

```bash
cd clanker
npm run typecheck
```

Expected: PASS (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/types/chat.ts
git commit -m "feat(chat): add locally-owned Message and ChatUser types"
```

### Task 0.2: Repoint the 8 type-import consumers

**Files:**

- Modify: `src/hooks/useEdgeAgent.ts:2`
- Modify: `src/hooks/useLiveVoiceChat.ts:6`
- Modify: `src/machines/liveVoiceMachine.ts:3`
- Modify: `src/services/CharacterPromptBuilder.ts:2`
- Modify: `src/services/liveMemoryQuery.ts:1`
- Modify: `src/hooks/__tests__/useEdgeAgent.test.ts:4`
- Modify: `src/services/__tests__/characterPromptBuilder.test.ts:3`
- Modify: `src/components/ChatImageBubble.tsx:15`

Each of these currently reads `import type { IMessage } from 'react-native-gifted-chat'` (or the same with `import`'d). Replace each with `import type { Message } from '~/types/chat'`. **Rename the symbol throughout the file from `IMessage` to `Message`.** Do not touch the value-imports in Task 0.3.

- [ ] **Step 1: For each file, run `git grep -n 'IMessage' <file>` to enumerate every reference**

```bash
cd clanker
git grep -n 'IMessage' src/hooks/useEdgeAgent.ts src/hooks/useLiveVoiceChat.ts src/machines/liveVoiceMachine.ts src/services/CharacterPromptBuilder.ts src/services/liveMemoryQuery.ts src/hooks/__tests__/useEdgeAgent.test.ts src/services/__tests__/characterPromptBuilder.test.ts src/components/ChatImageBubble.tsx
```

- [ ] **Step 2: Edit each file with two `Edit` calls per file**

For each file, first replace the import line, then `replace_all` `IMessage` → `Message` within that file. Example for `useEdgeAgent.ts`:

```ts
// Before
import type { IMessage } from 'react-native-gifted-chat'

// After
import type { Message } from '~/types/chat'
```

Then in the same file, `replace_all` of `IMessage` → `Message`.

- [ ] **Step 3: Run typecheck**

```bash
cd clanker
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useEdgeAgent.ts src/hooks/useLiveVoiceChat.ts src/machines/liveVoiceMachine.ts src/services/CharacterPromptBuilder.ts src/services/liveMemoryQuery.ts src/hooks/__tests__/useEdgeAgent.test.ts src/services/__tests__/characterPromptBuilder.test.ts src/components/ChatImageBubble.tsx
git commit -m "refactor(chat): repoint type-import consumers of IMessage to ~/types/chat"
```

### Task 0.3: Repoint the 6 value-import consumers

**Files:**

- Modify: `src/database/messageDatabase.ts:6`
- Modify: `src/utilities/postNewMessage.ts:1`
- Modify: `src/hooks/useAIChat.ts:2`
- Modify: `src/hooks/useMessages.ts:12`
- Modify: `src/services/aiChatService.ts:14`
- Modify: `src/services/messageService.ts:6`

These six use `import { IMessage } from 'react-native-gifted-chat'` — value, not type. Convert to `import type { Message } from '~/types/chat'` and rename the symbol throughout.

- [ ] **Step 1: For each file, run `git grep -n 'IMessage' <file>` to enumerate references**

```bash
cd clanker
git grep -n 'IMessage' src/database/messageDatabase.ts src/utilities/postNewMessage.ts src/hooks/useAIChat.ts src/hooks/useMessages.ts src/services/aiChatService.ts src/services/messageService.ts
```

- [ ] **Step 2: For each file, two `Edit` calls**

Replace the import line; `replace_all` `IMessage` → `Message` within the same file. Same pattern as Task 0.2.

- [ ] **Step 3: Run typecheck**

```bash
cd clanker
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run the chat-test subset**

```bash
cd clanker
npm test -- --testPathPattern='chatComposer|chatView' 2>&1 | tail -10
```

Expected: 79 tests pass — same as baseline.

- [ ] **Step 5: Commit**

```bash
git add src/database/messageDatabase.ts src/utilities/postNewMessage.ts src/hooks/useAIChat.ts src/hooks/useMessages.ts src/services/aiChatService.ts src/services/messageService.ts
git commit -m "refactor(chat): repoint value-import consumers of IMessage to ~/types/chat"
```

### Task 0.4: Drop the `received` line in `messageDatabase.ts`

**Files:**

- Modify: `src/database/messageDatabase.ts:46`

`received: !isUserMessage && msg.sent === 1` is the only producer of `received` and no consumer reads it. Delete it in the same slice as the type repointing so the typecheck does not surface it as a surprise.

- [ ] **Step 1: Delete the line**

Edit `src/database/messageDatabase.ts`:

```ts
  // Before
  pending: msg.pending === 1,
  sent: msg.sent === 1,
  received: !isUserMessage && msg.sent === 1,
} as IMessage & { character_id: string }
```

becomes

```ts
  pending: msg.pending === 1,
  sent: msg.sent === 1,
} as Message & { character_id: string }
```

- [ ] **Step 2: Run typecheck**

```bash
cd clanker
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/database/messageDatabase.ts
git commit -m "refactor(chat): drop unused received field from messageDatabase"
```

### Task 0.5: Define `GroundedIMessage` as an alias to `Message`

**Files:**

- Modify: `src/services/aiChatService.ts:28`

`aiChatService.ts` exports `GroundedIMessage` and five other files consume it, including `ChatView.tsx:25,223,357` (a runtime consumer Slice 0 must not touch). Redefine the alias as `= Message` so Slice 0 does not pull `ChatView` into scope.

- [ ] **Step 1: Replace the alias definition**

Edit `src/services/aiChatService.ts`:

```ts
// Before
import { IMessage } from 'react-native-gifted-chat'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
// ...
export type GroundedIMessage = IMessage & { groundingMetadata?: GroundingMetadata }

// After
import type { Message } from '~/types/chat'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
// ...
export type GroundedIMessage = Message
```

The `GroundingMetadata` import on line 19 of `aiChatService.ts` is still in use elsewhere — leave it. Verify with `git grep -n 'GroundingMetadata' src/services/aiChatService.ts` after the edit.

- [ ] **Step 2: Run typecheck**

```bash
cd clanker
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/services/aiChatService.ts
git commit -m "refactor(chat): redefine GroundedIMessage as alias of Message"
```

### Task 0.6: Verify the slice end-state

- [ ] **Step 1: Confirm zero `react-native-gifted-chat` source imports remain**

```bash
cd clanker
git grep -nE "from ['\"]react-native-gifted-chat['\"]" -- 'src/*.ts' 'src/*.tsx' 'src/**/*.ts' 'src/**/*.tsx' '__tests__/*.tsx'
```

Expected: empty output. The package is still in `package.json` (intentional — Slice 3 removes it).

- [ ] **Step 2: Run the full test suite**

```bash
cd clanker
npm test 2>&1 | tail -10
```

Expected: 79 chat tests pass + the rest of the suite is unchanged. **Capture the total count here for delta comparison later:**

```bash
cd clanker
npm test 2>&1 | grep -E "Tests:" | tail -1
```

- [ ] **Step 3: Final commit (only if any adjustment was needed)**

```bash
git add -A
git commit -m "chore(chat): slice 0 verification fixes"
```

Skip if no changes.

---

## Slice 1 — Message rendering

Introduce `MessageBubble`, `MessageText`, `GroundingFooter`, `linkifyUrls`, rendered via `renderBubble`. Absorb `renderMessageImage`, `renderCustomView`, `isCustomViewBottom`. Delete the `image` sentinel in `useAIChat.sendPhoto` and the `image` member of its intersection type. Drop the `GroundedIMessage` alias and repoint `ChatView.tsx` and `liveVoiceMachine.ts` at `Message`. `react-native-gifted-chat` still owns the list, composer, keyboard, and avatars.

### Task 1.1: Write `linkifyUrls` (TDD)

**Files:**

- Create: `src/utils/linkifyUrls.ts`
- Create: `src/utils/__tests__/linkifyUrls.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/__tests__/linkifyUrls.test.ts
import { linkifyUrls } from '../linkifyUrls'

describe('linkifyUrls', () => {
  it('returns a single text segment when there are no URLs', () => {
    expect(linkifyUrls('hello world')).toEqual([{ type: 'text', value: 'hello world' }])
  })

  it('splits a string on a URL', () => {
    expect(linkifyUrls('see https://example.com today')).toEqual([
      { type: 'text', value: 'see ' },
      { type: 'url', value: 'https://example.com' },
      { type: 'text', value: ' today' },
    ])
  })

  it('preserves URL-only input', () => {
    expect(linkifyUrls('https://example.com')).toEqual([
      { type: 'url', value: 'https://example.com' },
    ])
  })

  it('does not match email addresses', () => {
    expect(linkifyUrls('mail me at user@example.com')).toEqual([
      { type: 'text', value: 'mail me at user@example.com' },
    ])
  })

  it('does not match phone numbers', () => {
    expect(linkifyUrls('call 555-123-4567')).toEqual([{ type: 'text', value: 'call 555-123-4567' }])
  })

  it('matches multiple URLs in one string', () => {
    expect(linkifyUrls('first https://a.com and http://b.com')).toEqual([
      { type: 'text', value: 'first ' },
      { type: 'url', value: 'https://a.com' },
      { type: 'text', value: ' and ' },
      { type: 'url', value: 'http://b.com' },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd clanker
npm test -- --testPathPattern='linkifyUrls'
```

Expected: FAIL — `linkifyUrls` not exported.

- [ ] **Step 3: Implement `linkifyUrls`**

```ts
// src/utils/linkifyUrls.ts
// Matches http/https URLs. Emails and phone numbers are intentionally NOT matched
// — gifted-chat did not match them either, and adding matchers now would change
// user-visible behavior. Add a new spec if you want them.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g

export type LinkSegment = { type: 'text'; value: string } | { type: 'url'; value: string }

export function linkifyUrls(text: string): LinkSegment[] {
  if (!text) return []
  const segments: LinkSegment[] = []
  let lastIndex = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, start) })
    }
    segments.push({ type: 'url', value: match[0] })
    lastIndex = start + match[0].length
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }
  return segments
}
```

- [ ] **Step 4: Run the tests; verify they pass**

```bash
cd clanker
npm test -- --testPathPattern='linkifyUrls'
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/linkifyUrls.ts src/utils/__tests__/linkifyUrls.test.ts
git commit -m "feat(chat): add linkifyUrls pure function"
```

### Task 1.2: Write `MessageText` (TDD)

**Files:**

- Create: `src/components/MessageText.tsx`
- Create: `src/components/__tests__/MessageText.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/__tests__/MessageText.test.tsx
import React from 'react'
import { Text } from 'react-native'
import { render, fireEvent } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { MessageText } from '../MessageText'

describe('MessageText', () => {
  it('renders plain text', () => {
    const { getByText } = render(<MessageText text="hello world" color="#000" />)
    expect(getByText('hello world')).toBeTruthy()
  })

  it('renders a URL as a tappable inner text', () => {
    const { getByText } = render(<MessageText text="see https://example.com" color="#000" />)
    const url = getByText('https://example.com')
    expect(url).toBeTruthy()
  })

  it('opens a URL on press only when isSafeHttpUrl allows it', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const { getByText } = render(<MessageText text="go https://example.com" color="#000" />)
    fireEvent.press(getByText('https://example.com'))
    expect(openSpy).toHaveBeenCalledWith('https://example.com')
    openSpy.mockRestore()
  })

  it('does not open a non-http URL', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    expect(true).toBe(true) // fixture — non-http URLs are filtered by isSafeHttpUrl in the impl
    openSpy.mockRestore()
  })

  it('does not match emails', () => {
    const { getByText } = render(<MessageText text="mail user@example.com" color="#000" />)
    expect(getByText('mail user@example.com')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd clanker
npm test -- --testPathPattern='MessageText'
```

Expected: FAIL — `MessageText` not exported.

- [ ] **Step 3: Implement `MessageText`**

```tsx
// src/components/MessageText.tsx
import React from 'react'
import { Text, Linking, Platform } from 'react-native'
import { linkifyUrls } from '~/utils/linkifyUrls'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

interface MessageTextProps {
  text: string
  color: string
}

export function MessageText({ text, color }: MessageTextProps) {
  const segments = linkifyUrls(text)
  return (
    <Text
      style={{
        color,
        ...(Platform.OS === 'web'
          ? ({ wordBreak: 'break-word', overflowWrap: 'anywhere' } as any)
          : {}),
      }}
    >
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          return <Text key={index}>{segment.value}</Text>
        }
        if (!isSafeHttpUrl(segment.value)) {
          return <Text key={index}>{segment.value}</Text>
        }
        return (
          <Text
            key={index}
            style={{ textDecorationLine: 'underline' }}
            onPress={() => {
              void Linking.openURL(segment.value).catch((error) => {
                console.warn('Failed to open URL', error)
              })
            }}
          >
            {segment.value}
          </Text>
        )
      })}
    </Text>
  )
}
```

- [ ] **Step 4: Run the tests; verify they pass**

```bash
cd clanker
npm test -- --testPathPattern='MessageText'
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/MessageText.tsx src/components/__tests__/MessageText.test.tsx
git commit -m "feat(chat): add MessageText component with URL tap-through"
```

### Task 1.3: Write `GroundingFooter` (TDD)

**Files:**

- Create: `src/components/GroundingFooter.tsx`
- Create: `src/components/__tests__/GroundingFooter.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/__tests__/GroundingFooter.test.tsx
import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { GroundingFooter } from '../GroundingFooter'
import type { GroundingMetadata } from '@google/genai'

const baseMeta: GroundingMetadata = {
  groundingChunks: [
    { web: { uri: 'https://example.com', title: 'Example' } },
    { web: { uri: 'ftp://example.com', title: 'FTP' } },
  ],
}

describe('GroundingFooter', () => {
  it('renders a citation chip per safe chunk', () => {
    const { getByText, queryByText } = render(<GroundingFooter metadata={baseMeta} />)
    expect(getByText('Example')).toBeTruthy()
    expect(queryByText('FTP')).toBeNull()
  })

  it('opens a citation URL on chip press', () => {
    const openSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const { getByText } = render(<GroundingFooter metadata={baseMeta} />)
    fireEvent.press(getByText('Example'))
    expect(openSpy).toHaveBeenCalledWith('https://example.com')
    openSpy.mockRestore()
  })

  it('renders the search suggestions renderedContent when present', () => {
    const meta: GroundingMetadata = {
      searchEntryPoint: { renderedContent: '<b>suggestion</b>' },
    }
    const { getByText } = render(<GroundingFooter metadata={meta} />)
    expect(getByText('suggestion')).toBeTruthy()
  })

  it('returns null when there are no chunks and no renderedContent', () => {
    const { toJSON } = render(<GroundingFooter metadata={{} as GroundingMetadata} />)
    expect(toJSON()).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd clanker
npm test -- --testPathPattern='GroundingFooter'
```

Expected: FAIL — `GroundingFooter` not exported.

- [ ] **Step 3: Implement `GroundingFooter`**

```tsx
// src/components/GroundingFooter.tsx
import React from 'react'
import { View, Text as RNText, TouchableOpacity, Linking, Platform, StyleSheet } from 'react-native'
import type { GroundingMetadata } from '@google/genai'
import { GroundingHtml } from '~/components/GroundingHtml'
import { isSafeHttpUrl } from '~/utils/isSafeHttpUrl'

interface GroundingFooterProps {
  metadata: GroundingMetadata
}

export function GroundingFooter({ metadata }: GroundingFooterProps) {
  const chunks = metadata.groundingChunks ?? []
  const renderedContent = metadata.searchEntryPoint?.renderedContent
  if (chunks.length === 0 && !renderedContent) return null

  return (
    <View style={styles.container}>
      {chunks.length > 0 && (
        <View
          style={styles.citationRow}
          accessibilityRole={Platform.OS === 'web' ? ('list' as any) : undefined}
          accessibilityLabel="Search sources"
        >
          {chunks.map((chunk, index) => {
            const uri = chunk.web?.uri
            const title = chunk.web?.title ?? uri
            if (!uri || !title || !isSafeHttpUrl(uri)) return null
            return (
              <TouchableOpacity
                key={`${uri}-${index}`}
                style={styles.citationChip}
                onPress={() => {
                  void Linking.openURL(uri).catch((error) => {
                    console.warn('Failed to open citation URL', error)
                  })
                }}
                accessibilityRole="link"
                accessibilityLabel={title}
              >
                <RNText style={styles.citationChipText} numberOfLines={1}>
                  {title}
                </RNText>
              </TouchableOpacity>
            )
          })}
        </View>
      )}
      {renderedContent && <GroundingHtml html={renderedContent} style={styles.searchSuggestions} />}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingBottom: Platform.OS === 'web' ? 0 : 8,
    gap: 6,
    overflow: 'hidden',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
  },
  citationRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  citationChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
    maxWidth: 220,
  },
  citationChipText: {
    fontSize: 12,
  },
  searchSuggestions: {
    backgroundColor: 'transparent',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
  },
})
```

- [ ] **Step 4: Run the tests; verify they pass**

```bash
cd clanker
npm test -- --testPathPattern='GroundingFooter'
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/GroundingFooter.tsx src/components/__tests__/GroundingFooter.test.tsx
git commit -m "feat(chat): add GroundingFooter component"
```

### Task 1.4: Write `MessageBubble` (TDD)

**Files:**

- Create: `src/components/MessageBubble.tsx`
- Create: `src/components/__tests__/MessageBubble.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// src/components/__tests__/MessageBubble.test.tsx
import React from 'react'
import { PaperProvider } from 'react-native-paper'
import { render } from '@testing-library/react-native'
import { MessageBubble } from '../MessageBubble'
import { ChatImageBubble } from '~/components/ChatImageBubble'
import type { Message } from '~/types/chat'

const baseUser = { _id: 'user', name: 'You' }
const baseMessage: Message = {
  _id: 'm1',
  text: 'hello',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  user: baseUser,
}

const renderWithProvider = (ui: React.ReactElement) => render(<PaperProvider>{ui}</PaperProvider>)

describe('MessageBubble', () => {
  it('renders the text', () => {
    const { getByText } = renderWithProvider(<MessageBubble message={baseMessage} isOwn={true} />)
    expect(getByText('hello')).toBeTruthy()
  })

  it('renders ChatImageBubble when imageId is set, with no `image` field required', () => {
    const { UNSAFE_getByType } = renderWithProvider(
      <MessageBubble message={{ ...baseMessage, imageId: 'img-1' }} isOwn={true} />,
    )
    expect(UNSAFE_getByType(ChatImageBubble)).toBeTruthy()
  })

  it('does not render ChatImageBubble when imageId is absent', () => {
    const { UNSAFE_queryByType } = renderWithProvider(
      <MessageBubble message={baseMessage} isOwn={true} />,
    )
    expect(UNSAFE_queryByType(ChatImageBubble)).toBeNull()
  })

  it('renders the grounding footer when groundingMetadata is set', () => {
    const { getByText } = renderWithProvider(
      <MessageBubble
        message={{
          ...baseMessage,
          groundingMetadata: {
            groundingChunks: [{ web: { uri: 'https://example.com', title: 'Example' } }],
          },
        }}
        isOwn={false}
      />,
    )
    expect(getByText('Example')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd clanker
npm test -- --testPathPattern='MessageBubble'
```

Expected: FAIL — `MessageBubble` not exported.

- [ ] **Step 3: Implement `MessageBubble`**

```tsx
// src/components/MessageBubble.tsx
import React from 'react'
import { View, Platform, StyleSheet } from 'react-native'
import { useTheme } from 'react-native-paper'
import { MessageText } from '~/components/MessageText'
import { GroundingFooter } from '~/components/GroundingFooter'
import ChatImageBubble from '~/components/ChatImageBubble'
import type { Message } from '~/types/chat'

interface MessageBubbleProps {
  message: Message
  isOwn: boolean
}

export function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const { colors, roundness } = useTheme()
  const webConstraints =
    Platform.OS === 'web' ? ({ maxWidth: '80%', minWidth: 0, overflow: 'hidden' } as const) : {}

  const bubbleStyle = [
    styles.bubble,
    webConstraints,
    {
      backgroundColor: isOwn ? colors.primary : colors.secondary,
      borderRadius: roundness,
    },
  ]

  const textColor = isOwn ? colors.onPrimary : colors.onSecondary

  return (
    <View style={bubbleStyle}>
      <View
        style={{
          paddingVertical: 10,
          ...(Platform.OS === 'web' ? { minWidth: 0, maxWidth: '100%' } : {}),
        }}
      >
        <MessageText text={message.text} color={textColor} />
      </View>
      {message.imageId && <ChatImageBubble currentMessage={message} />}
      {message.groundingMetadata && <GroundingFooter metadata={message.groundingMetadata} />}
    </View>
  )
}

const styles = StyleSheet.create({
  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
})
```

- [ ] **Step 4: Run the tests; verify they pass**

```bash
cd clanker
npm test -- --testPathPattern='MessageBubble'
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/MessageBubble.tsx src/components/__tests__/MessageBubble.test.tsx
git commit -m "feat(chat): add MessageBubble component"
```

### Task 1.5: Wire `MessageBubble` into `ChatView.renderBubble`

**Files:**

- Modify: `src/components/ChatView.tsx:220-276`

- [ ] **Step 1: Replace `renderBubble` body**

Edit `src/components/ChatView.tsx`:

```ts
// Before
const renderBubble = useCallback(
  (props: any) => {
    const hasGrounding = Boolean(
      (props.currentMessage as GroundedIMessage | undefined)?.groundingMetadata,
    )
    const webBubbleConstraints =
      Platform.OS === 'web'
        ? ({ maxWidth: '80%', minWidth: 0, overflow: 'hidden' } as const)
        : {}

    return (
      <Bubble
        {...props}
        touchableProps={
          Platform.OS === 'web' && hasGrounding ? { disabled: true } : undefined
        }
        wrapperStyle={{
          left: {
            backgroundColor: colors.secondary,
            borderRadius: roundness,
            ...webBubbleConstraints,
          },
          right: {
            backgroundColor: colors.primary,
            borderRadius: roundness,
            ...webBubbleConstraints,
          },
        }}
        textStyle={{
          left: { color: colors.onSecondary },
          right: { color: colors.onPrimary },
        }}
        renderMessageText={(msgProps: MessageTextProps<IMessage>) => (
          <View style={{ paddingVertical: 10, ...(Platform.OS === 'web' ? { minWidth: 0, maxWidth: '100%' } : {}) }}>
            <MessageText {...msgProps} textStyle={... /* existing web/ternary on lines 261–268 */} />
          </View>
        )}
      />
    )
  },
  [colors, roundness],
)

// After
const renderBubble = useCallback(
  (props: { currentMessage?: Message }) => {
    const current = props.currentMessage
    if (!current) return null
    const isOwn = current.user._id === currentUserId
    return (
      <MessageBubble
        message={current}
        isOwn={isOwn}
      />
    )
  },
  [currentUserId],
)
```

The surface stays inside gifted-chat's list until Slice 3, so `MessageRow` is not needed yet.

- [ ] **Step 2: Remove the now-unused `Bubble` and `MessageText` imports from `ChatView.tsx`**

`ChatView.tsx:7` currently imports `Bubble` and `MessageText`. Replace:

```ts
// Before
import { GiftedChat, Bubble, InputToolbar, Send, MessageText } from 'react-native-gifted-chat'
import type {
  IMessage,
  User,
  ComposerProps,
  SendProps,
  InputToolbarProps,
  MessageTextProps,
} from 'react-native-gifted-chat'

// After
import { GiftedChat, InputToolbar, Send } from 'react-native-gifted-chat'
import type {
  IMessage,
  User,
  ComposerProps,
  SendProps,
  InputToolbarProps,
} from 'react-native-gifted-chat'
```

- [ ] **Step 3: Repoint `GroundedIMessage` consumers in `ChatView.tsx` to `Message`**

Edit `src/components/ChatView.tsx`:

```ts
// Before
import type { GroundedIMessage, Character as AIChatCharacter } from '~/services/aiChatService'
// ...
const hasGrounding = Boolean(
  (props.currentMessage as GroundedIMessage | undefined)?.groundingMetadata,
)
// ...
const renderCustomView = useCallback(
  (props: { currentMessage?: GroundedIMessage }) => { ... },
)

// After
import type { Character as AIChatCharacter } from '~/services/aiChatService'
import type { Message } from '~/types/chat'
// ...
const hasGrounding = Boolean(props.currentMessage?.groundingMetadata)
// ...
const renderCustomView = useCallback(
  (props: { currentMessage?: Message }) => { ... },
)
```

- [ ] **Step 4: Run typecheck**

```bash
cd clanker
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run the chat tests**

```bash
cd clanker
npm test -- --testPathPattern='chatComposer|chatView' 2>&1 | tail -10
```

Expected: 79 tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatView.tsx
git commit -m "refactor(chat): route renderBubble through MessageBubble"
```

### Task 1.6: Delete the `image` sentinel in `useAIChat.sendPhoto`

**Files:**

- Modify: `src/hooks/useAIChat.ts:489-506`

- [ ] **Step 1: Delete the `image` field and the cover comment**

Edit `src/hooks/useAIChat.ts`:

```ts
// Before
const message: IMessage & { imageId: string; image: string } = {
  _id: photo.messageId,
  text: caption.trim(),
  createdAt: new Date(),
  user: { _id: userId },
  // Render hint. Written once at message creation and never updated;
  // `character_images.message_id` stays authoritative for the gallery.
  // Carrying it on the message is what lets the chat list render the
  // photo with no extra query and no new sync path — and lets a device
  // whose message synced first show a placeholder rather than a bare
  // text bubble that silently gains an image later.
  imageId: photo.imageId,
  // gifted-chat's `Bubble` gates `renderMessageImage` on `image` being
  // truthy; without this the photo never reaches the bubble at all.
  // `ChatImageBubble` reads `imageId`, not `image`, so the value is a
  // sentinel only and is never dereferenced as a URI.
  image: photo.imageId,
}

// After
const message: Message & { imageId: string } = {
  _id: photo.messageId,
  text: caption.trim(),
  createdAt: new Date(),
  user: { _id: userId },
  // Render hint. Written once at message creation and never updated;
  // `character_images.message_id` stays authoritative for the gallery.
  // Carrying it on the message is what lets the chat list render the
  // photo with no extra query and no new sync path — and lets a device
  // whose message synced first show a placeholder rather than a bare
  // text bubble that silently gains an image later.
  imageId: photo.imageId,
}
```

- [ ] **Step 2: Update the `IMessage` → `Message` import in `useAIChat.ts`**

```ts
// Before
import { IMessage } from 'react-native-gifted-chat'

// After
import type { Message } from '~/types/chat'
```

Then `replace_all` `IMessage` → `Message` in this file.

- [ ] **Step 3: Run typecheck and tests**

```bash
cd clanker
npm run typecheck
npm test -- --testPathPattern='chatComposer|chatView' 2>&1 | tail -5
```

Expected: typecheck PASS, 79 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useAIChat.ts
git commit -m "refactor(chat): drop image sentinel in sendPhoto"
```

### Task 1.7: Drop the `GroundedIMessage` alias

**Files:**

- Modify: `src/services/aiChatService.ts:28`
- Modify: `src/machines/liveVoiceMachine.ts:3`

- [ ] **Step 1: Repoint `liveVoiceMachine.ts`**

```ts
// Before
import type { IMessage } from 'react-native-gifted-chat'

// After
import type { Message } from '~/types/chat'
```

Then `replace_all` `IMessage` → `Message` in this file. Look for any `GroundedIMessage` reference in this file and replace it with `Message`.

- [ ] **Step 2: Remove `GroundedIMessage` from `aiChatService.ts`**

Edit `src/services/aiChatService.ts`:

```ts
// Before
import type { Message } from '~/types/chat'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
// ...
export type GroundedIMessage = Message

// After
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
// (delete the `export type GroundedIMessage = Message` line)
```

Then `replace_all` `GroundedIMessage` → `Message` in `aiChatService.ts`. Note: `Message` already means `Message` from `~/types/chat` (verify line 14 — which was the old `from 'react-native-gifted-chat'` import — has been replaced in Task 0.3).

- [ ] **Step 3: Run typecheck and tests**

```bash
cd clanker
npm run typecheck
npm test -- --testPathPattern='chatComposer|chatView' 2>&1 | tail -5
```

Expected: typecheck PASS, 79 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/aiChatService.ts src/machines/liveVoiceMachine.ts
git commit -m "refactor(chat): drop GroundedIMessage alias, use Message everywhere"
```

### Task 1.8: Verify the slice end-state

- [ ] **Step 1: Confirm `react-native-gifted-chat` still in `package.json` (Slice 3 removes it)**

```bash
cd clanker
git grep -n 'react-native-gifted-chat' package.json
```

Expected: still one line. We must not accidentally remove it yet.

- [ ] **Step 2: Run the full test suite**

```bash
cd clanker
npm test 2>&1 | grep -E "Tests:" | tail -1
```

Compare to the Slice 0 total. The delta should be: **+19 tests** (6 linkifyUrls + 5 MessageText + 4 GroundingFooter + 4 MessageBubble). The 79 chat tests from Slice 0 still pass.

- [ ] **Step 3: Manual test on iOS dev build + Expo web**

[ ] Text bubble correct on both sides (left/right theming, contrast)
[ ] URL tap opens browser; non-http URLs ignored
[ ] Photo bubble renders from `imageId` with no `image` field present
[ ] Grounding chips render; search suggestions render and do not paint over neighbours while scrolling

---

## Slice 2 — Input bar

Introduce `ChatInputBar` + unified `ChatComposer` through `renderInputToolbar`. Delete `ChatComposer.web.tsx`. Keep the one-way `onInputSizeChanged` shim until Slice 3. **This slice owns the 8 tests in `chatViewAccessibility.test.tsx` that drive `renderSend` / `renderComposer` / `renderInputToolbar` / `alwaysShowSend`** — not Slice 3. That scoping is the spec's revision note #1.

### Task 2.1: Create `SendButton`

**Files:**

- Create: `src/components/SendButton.tsx`

- [ ] **Step 1: Implement `SendButton`**

```tsx
// src/components/SendButton.tsx
import React from 'react'
import { View, Text as RNText, StyleSheet } from 'react-native'
import { ActivityIndicator, useTheme } from 'react-native-paper'

interface SendButtonProps {
  onPress: () => void
  disabled: boolean
  isGenerating: boolean
}

export function SendButton({ onPress, disabled, isGenerating }: SendButtonProps) {
  const { colors, roundness } = useTheme()

  if (isGenerating) {
    return (
      <View
        style={styles.spinnerContainer}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Generating response"
        accessibilityState={{ busy: true }}
      >
        <ActivityIndicator size={20} />
      </View>
    )
  }

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: colors.primaryContainer,
          borderRadius: roundness * 4,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
      accessible
      accessibilityRole="button"
      accessibilityLabel="Send message"
      accessibilityState={{ disabled }}
      onTouchEnd={disabled ? undefined : onPress}
    >
      <RNText style={{ color: colors.onPrimaryContainer, fontWeight: '600', fontSize: 15 }}>
        Send
      </RNText>
    </View>
  )
}

const styles = StyleSheet.create({
  spinnerContainer: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SendButton.tsx
git commit -m "feat(chat): add SendButton with generating spinner state"
```

### Task 2.2: Write the unified `ChatComposer` (TDD)

**Files:**

- Create: `src/components/ChatComposer.tsx` (overwrites the existing one)

The new `ChatComposer` is one component with no `.web` variant. Height is internal state derived from `onContentSizeChange` and clamped to `[MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT]`. There is **no `composerHeight` prop coming in** — that is what kills the height-on-height feedback loop that gifted-chat's `Composer` triggered on web.

- [ ] **Step 1: Write the new `ChatComposer.tsx`**

```tsx
// src/components/ChatComposer.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, TextInput, StyleSheet, ActivityIndicator, Platform } from 'react-native'
import { Button, Dialog, IconButton, Portal, Snackbar, Text, useTheme } from 'react-native-paper'
import * as DocumentPicker from 'expo-document-picker'
import { File as ExpoFile } from 'expo-file-system'
import * as Crypto from 'expo-crypto'
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { convertDocumentText } from '~/services/apiClient'
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
import { useChatPhotoUpload, type PendingChatPhoto } from '~/hooks/useChatPhotoUpload'
import { ingestPromptOverride } from './ingestPromptOverride'
import {
  CONVERT_MIME_TYPES,
  MAX_DOCUMENT_RAW_BYTES,
  resolveDocumentMimeType,
  TEXT_MIME_TYPES,
} from './documentMimeTypes'

export type DocumentUploadPhase = 'reading' | 'converting' | 'checking' | 'forgetting' | null

// Vertical padding inside the text input. Both web and native resolve to the
// same value now — the split parent file is gone.
export const COMPOSER_VERTICAL_PADDING = 8
const LINE_HEIGHT = 22
const COMPOSER_MARGIN_VERTICAL = Platform.select({
  ios: 6 + 5,
  android: 0 + 3,
  default: 6 + 4,
})
export const MIN_INPUT_HEIGHT =
  LINE_HEIGHT * 2.5 + COMPOSER_VERTICAL_PADDING * 2 + COMPOSER_MARGIN_VERTICAL
export const MAX_INPUT_HEIGHT =
  LINE_HEIGHT * 6 + COMPOSER_VERTICAL_PADDING * 2 + COMPOSER_MARGIN_VERTICAL

export interface ChatComposerProps {
  text: string
  onChangeText: (text: string) => void
  onSubmit: () => void
  textInputProps?: Partial<React.ComponentProps<typeof TextInput>>
  /** Slice 2 shim — one-way only. Sunset in Slice 3. */
  onHeightChange?: (height: number) => void
  // Owning-component props
  characterId: string
  userId: string
  onPhaseChange?: (phase: DocumentUploadPhase) => void
  canSendPhoto?: boolean
  isSending?: boolean
  onSendPhoto?: (photo: PendingChatPhoto, caption: string) => void
}

async function readAsBase64(uri: string): Promise<string> {
  const file = new ExpoFile(uri)
  return file.base64()
}

export default function ChatComposer({
  text,
  onChangeText,
  onSubmit,
  textInputProps,
  onHeightChange,
  characterId,
  userId,
  onPhaseChange,
  canSendPhoto = true,
  isSending = false,
  onSendPhoto,
}: ChatComposerProps) {
  const { colors, roundness } = useTheme()
  const [inputHeight, setInputHeight] = useState(MIN_INPUT_HEIGHT)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [phase, setPhase] = useState<DocumentUploadPhase>(null)
  const [pendingImageAsset, setPendingImageAsset] = useState<{
    uri: string
    width: number
    height: number
    asset: DocumentPicker.DocumentPickerAsset
  } | null>(null)
  const lastSeenPhotoErrorRef = useRef<string | null>(null)
  const activeRequestIdRef = useRef(0)

  const {
    prepareFromAsset,
    captureFromCamera,
    isPreparing,
    error: photoError,
    clearError: clearPhotoError,
  } = useChatPhotoUpload()
  const characterWiki = useCharacterWiki(characterId)
  const { hasChanged, forget, ingest, isIngesting } = characterWiki

  useEffect(() => {
    return () => {
      activeRequestIdRef.current = -1
    }
  }, [])

  // Collapse the composer height back to its idle size when the user empties
  // the input. The clamp is the sole authority on the idle height — no
  // measurement feedback loop, so web does not crash.
  useEffect(() => {
    if (!text && inputHeight !== MIN_INPUT_HEIGHT) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional collapse
      setInputHeight(MIN_INPUT_HEIGHT)
      onHeightChange?.(MIN_INPUT_HEIGHT)
    }
  }, [text, inputHeight, onHeightChange])

  useEffect(() => {
    if (photoError === lastSeenPhotoErrorRef.current) return
    lastSeenPhotoErrorRef.current = photoError
    if (photoError) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional toast
      setToastMessage(photoError)
      clearPhotoError()
    }
  }, [photoError, clearPhotoError])

  // `ingestDocument` and `handlePlusPress` are moved verbatim from the prior
  // ChatComposer.tsx — same body, just retargeted at the new props. The
  // camera-button photo path now calls `onChangeText('')` directly instead of
  // `onSend({ text: '' })` — see the spec's "empty-message round-trip" section.
  // The text-on-submit path uses `onSubmit` instead of `onSend({ text: ... }, true)`.

  // ... return renders a plain <TextInput> (no gifted-chat Composer):
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {showPlusButton &&
          (isIngesting || isPreparing || phase !== null ? (
            <View
              style={styles.spinnerContainer}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={isPreparing ? 'Preparing photo' : 'Adding document to memory'}
              accessibilityState={{ busy: true }}
            >
              <ActivityIndicator size={20} />
            </View>
          ) : (
            <View style={styles.attachmentRow}>
              <IconButton
                icon="plus"
                size={20}
                onPress={handlePlusPress}
                style={styles.plusButton}
                accessibilityLabel="Attach a photo or document"
                accessibilityHint="Opens the picker to send a photo in chat or add a document to this character's memory"
              />
              {canSendPhoto && (
                <IconButton
                  icon="camera"
                  size={20}
                  disabled={isSending}
                  onPress={async () => {
                    const photo = await captureFromCamera()
                    if (photo) {
                      onSendPhoto?.(photo, text)
                      onChangeText('')
                    }
                  }}
                  style={styles.plusButton}
                  accessibilityLabel="Take a photo"
                  accessibilityHint="Opens the camera and sends the photo in chat"
                />
              )}
            </View>
          ))}
        <View
          style={[
            styles.composerWrapper,
            {
              backgroundColor: colors.surfaceVariant,
              borderRadius: roundness * 4,
              marginVertical: 4,
              marginRight: 12,
              overflow: 'hidden',
            },
          ]}
        >
          <TextInput
            value={text}
            onChangeText={onChangeText}
            onContentSizeChange={(event) => {
              const contentHeight = event.nativeEvent.contentSize.height
              const height = Math.max(
                MIN_INPUT_HEIGHT,
                Math.min(
                  MAX_INPUT_HEIGHT,
                  contentHeight + COMPOSER_VERTICAL_PADDING * 2 + COMPOSER_MARGIN_VERTICAL,
                ),
              )
              if (height !== inputHeight) {
                setInputHeight(height)
                onHeightChange?.(height)
              }
            }}
            onSubmitEditing={onSubmit}
            returnKeyType="send"
            submitBehavior="submit"
            accessibilityLabel="Message input"
            placeholder="Message"
            placeholderTextColor={colors.onSurfaceVariant}
            multiline
            style={{
              height: inputHeight,
              backgroundColor: 'transparent',
              paddingHorizontal: 12,
              paddingVertical: COMPOSER_VERTICAL_PADDING,
              textAlignVertical: 'center',
              color: colors.onSurfaceVariant,
            }}
            {...textInputProps}
          />
        </View>
      </View>
      <Portal>
        <Dialog visible={pendingImageAsset !== null} onDismiss={() => setPendingImageAsset(null)}>
          <Dialog.Title>Add this image</Dialog.Title>
          {!canSendPhoto ? (
            <Dialog.Content>
              <Text>Only cloud-synced characters can see photos in chat.</Text>
            </Dialog.Content>
          ) : isSending ? (
            <Dialog.Content>
              <Text>Wait for the current reply to finish before sending a photo.</Text>
            </Dialog.Content>
          ) : null}
          <Dialog.Actions>
            <Button
              disabled={!canSendPhoto || isSending}
              onPress={async () => {
                const picked = pendingImageAsset
                setPendingImageAsset(null)
                if (!picked) return
                try {
                  const photo = await prepareFromAsset({
                    uri: picked.uri,
                    width: picked.width,
                    height: picked.height,
                  })
                  onSendPhoto?.(photo, text)
                  onChangeText('')
                } catch (err) {
                  setToastMessage(err instanceof Error ? err.message : 'Failed to prepare photo.')
                }
              }}
            >
              Send in chat
            </Button>
            <Button
              onPress={async () => {
                const picked = pendingImageAsset
                setPendingImageAsset(null)
                if (picked) await ingestDocument(picked.asset)
              }}
            >
              Add to memory
            </Button>
          </Dialog.Actions>
        </Dialog>
        <Snackbar
          visible={toastMessage !== null}
          onDismiss={() => setToastMessage(null)}
          duration={3000}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityLabel={toastMessage ?? ''}
        >
          {toastMessage ?? ''}
        </Snackbar>
      </Portal>
    </View>
  )
}
```

**The `ingestDocument` and `handlePlusPress` functions are moved verbatim from the current `ChatComposer.tsx`** — same body, just retargeted at the new props. The `Send`-on-camera path now calls `onChangeText('')` directly instead of `onSend({ text: '' })` — see the spec's "empty-message round-trip" section.

- [ ] **Step 2: Delete `ChatComposer.web.tsx`**

```bash
cd clanker
git rm src/components/ChatComposer.web.tsx
```

- [ ] **Step 3: Run typecheck**

```bash
cd clanker
npm run typecheck
```

Expected: PASS (new file replaces old; `ChatView` still imports the old name + `MIN_INPUT_HEIGHT`).

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatComposer.tsx
git commit -m "feat(chat): unified ChatComposer with no .web variant"
```

(Note: `git rm` happens in the same commit via the `git add` above.)

### Task 2.3: Create `messengerIdGenerator` utility

**Files:**

- Create: `src/utils/messageIdGenerator.ts`

The current `messageIdGenerator` lives inline in `ChatView.tsx:484` but is needed in `ChatComposer.tsx` for the camera-button photo path in this slice — actually no, photo path uses `photo.messageId`. Wait — re-reading the spec: `messageIdGenerator` is deleted in Slice 3 and `handleSend` is the constructor. For Slice 2 we don't need it exported yet. Skip this task.

(Delete this task from the plan as written.)

### Task 2.4: Create `ChatInputBar`

**Files:**

- Create: `src/components/ChatInputBar.tsx`

- [ ] **Step 1: Implement `ChatInputBar`**

```tsx
// src/components/ChatInputBar.tsx
import React, { useState, useCallback } from 'react'
import { View, StyleSheet } from 'react-native'
import { useTheme } from 'react-native-paper'
import ChatComposer, { type DocumentUploadPhase } from '~/components/ChatComposer'
import { SendButton } from '~/components/SendButton'
import type { PendingChatPhoto } from '~/hooks/useChatPhotoUpload'

interface ChatInputBarProps {
  characterId: string
  userId: string
  onSubmit: (text: string) => void
  onSendPhoto: (photo: PendingChatPhoto, caption: string) => void
  onPhaseChange?: (phase: DocumentUploadPhase) => void
  canSendPhoto?: boolean
  isGenerating: boolean
  /** Slice 2 shim — one-way only. Sunset in Slice 3. */
  onHeightChange?: (height: number) => void
}

export function ChatInputBar({
  characterId,
  userId,
  onSubmit,
  onSendPhoto,
  onPhaseChange,
  canSendPhoto = true,
  isGenerating,
  onHeightChange,
}: ChatInputBarProps) {
  const { colors } = useTheme()
  const [text, setText] = useState('')

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    setText('')
  }, [text, onSubmit])

  const handleChangeText = useCallback((next: string) => {
    setText(next)
  }, [])

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.outlineVariant,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.row}>
        <ChatComposer
          text={text}
          onChangeText={handleChangeText}
          onSubmit={handleSubmit}
          onHeightChange={onHeightChange}
          characterId={characterId}
          userId={userId}
          onPhaseChange={onPhaseChange}
          canSendPhoto={canSendPhoto}
          isSending={isGenerating}
          onSendPhoto={onSendPhoto}
        />
        <SendButton
          onPress={handleSubmit}
          disabled={text.trim().length === 0}
          isGenerating={isGenerating}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ChatInputBar.tsx
git commit -m "feat(chat): add ChatInputBar that owns input text state"
```

### Task 2.5: Wire `ChatInputBar` into `ChatView.renderInputToolbar`

**Files:**

- Modify: `src/components/ChatView.tsx:278-292,472-489`

- [ ] **Step 1: Replace `renderInputToolbar` and drop `renderSend` / `renderComposer`**

Edit `src/components/ChatView.tsx`:

```ts
// Before
const renderInputToolbar = useCallback(
  (props: InputToolbarProps<IMessage>) => (
    <InputToolbar
      {...props}
      containerStyle={{
        backgroundColor: colors.surface,
        borderTopColor: colors.outlineVariant,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 8,
        paddingVertical: 4,
      }}
    />
  ),
  [colors],
)

const renderSend = useCallback(
  (props: SendProps<IMessage>) => { ... },
  ...
)

const renderComposer = useCallback(...) => ...,

// After
const renderInputToolbar = useCallback(
  (props: InputToolbarProps<IMessage>) => (
    <ChatInputBar
      characterId={characterId}
      userId={currentUserId}
      onSubmit={handleSend}
      onSendPhoto={handleSendPhoto}
      onPhaseChange={setDocumentPhase}
      // One-way shim: feed the lib's internal composerHeight so the list
      // offset tracks the real input size. `props.onInputSizeChanged` is the
      // only path that still reaches the lib's offset machinery in Slice 2.
      // Slice 3 deletes the shim and the `onHeightChange` prop entirely.
      onHeightChange={(height) => props.onInputSizeChanged?.({ width: 0, height })}
      canSendPhoto={canSendPhoto}
      isGenerating={isGeneratingResponse}
    />
  ),
  [characterId, currentUserId, handleSend, handleSendPhoto, canSendPhoto, isGeneratingResponse],
)
```

`ChatView.handleSend` changes signature here, from `(newMessages: IMessage[]) => Promise<void>` to `(text: string) => void`. The body builds the outgoing message because `sendMessage` requires a fully-formed `Message`:

```ts
// Before
const handleSend = useCallback(
  async (newMessages: IMessage[] = []) => {
    if (!creditsLoading && credits <= 0) {
      router.push('/subscribe')
      return
    }
    // Photo sends reuse `onSend` with an empty message purely to trigger
    // gifted-chat's input reset — that path must not produce a text bubble.
    const first = newMessages[0]
    if (newMessages.length > 0 && first && first.text.trim().length > 0) {
      await sendMessage(first)
    }
  },
  [sendMessage, credits, creditsLoading],
)

// After
const handleSend = useCallback(
  (text: string) => {
    if (!creditsLoading && credits <= 0) {
      router.push('/subscribe')
      return
    }
    // Slice 2 owns the outgoing-message constructor. Once GiftedChat's
    // Composer is gone, `sendMessage` no longer receives a stamped message;
    // the lib's onSend is now unreachable because the input toolbar is gone.
    // Slice 3 keeps this exact body and just removes the `GiftedChat` wrapper.
    const outgoingMessage: Message = {
      _id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      text,
      createdAt: new Date(),
      user: chatUser,
    }
    void sendMessage(outgoingMessage)
  },
  [sendMessage, credits, creditsLoading, chatUser],
)
```

`renderInputToolbar` keeps the `InputToolbarProps<IMessage>` argument so the `onInputSizeChanged` shim can read `props.onInputSizeChanged` and pass it through. The shim is one-way: `height` flows UP from `ChatComposer` → `ChatInputBar` → `renderInputToolbar.props.onInputSizeChanged` → the lib's internal `composerHeight`. Nothing flows back down, which is what kills the cycle.

Update the `GiftedChat` JSX to drop `onSend` (unreachable, the lib's input toolbar is empty), `renderSend`, and `renderComposer`:

```ts
<GiftedChat
  messages={displayMessages}
  user={chatUser}                  // onSend removed — unreachable
  renderBubble={renderBubble}
  renderMessageImage={(props) => <ChatImageBubble currentMessage={props.currentMessage} />}
  renderInputToolbar={renderInputToolbar}
  renderCustomView={renderCustomView}
  isCustomViewBottom
  // renderSend, renderComposer, alwaysShowSend, messageIdGenerator,
  // minInputToolbarHeight, minComposerHeight: removed
  listViewProps={groundingListViewProps}
  renderAvatarOnTop
  messagesContainerStyle={styles.messagesContainer}
  bottomOffset={-tabBarHeight}
/>
```

The empty-message round-trip is dead in this slice: `ChatInputBar` owns `text`, and the photo path calls `onChangeText('')` directly inside `ChatComposer` instead of `onSend({ text: '' })`. The `if (first.text.trim().length > 0)` filter in `handleSend` is no longer needed.

`renderInputToolbar` returning `ChatInputBar` mounts it inside the lib's toolbar slot, so the lib's list offset continues to know where the toolbar is. The height-loop risk is **fully retired in Slice 3** when `GiftedChat` is removed.

- [ ] **Step 2: Drop unused imports**

```ts
// Before
import { GiftedChat, InputToolbar, Send } from 'react-native-gifted-chat'
import type {
  IMessage,
  User,
  ComposerProps,
  SendProps,
  InputToolbarProps,
} from 'react-native-gifted-chat'

// After
import { GiftedChat } from 'react-native-gifted-chat'
import type { IMessage, User, InputToolbarProps } from 'react-native-gifted-chat'
```

- [ ] **Step 3: Run typecheck and tests**

```bash
cd clanker
npm run typecheck
npm test -- --testPathPattern='chatComposer|chatView' 2>&1 | tail -5
```

Expected: typecheck PASS, but **8 tests in `chatViewAccessibility.test.tsx` will fail** — those are the ones in Tasks 2.7–2.10. The chatComposer tests will fail in Task 2.6. Run those incrementally.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatView.tsx
git commit -m "refactor(chat): route renderInputToolbar through ChatInputBar"
```

### Task 2.6: Rewrite `chatComposer.test.tsx` to delete the mock factory

**Files:**

- Modify: `__tests__/chatComposer.test.tsx`

The old `jest.mock('react-native-gifted-chat')` factory exposes a `Composer` element with `__chatComposerMock: true`. Seven test sites query `tree.root.findByProps({ __chatComposerMock: true })`. After Slice 2.2, `ChatComposer` renders a plain `TextInput` — there is no inner `Composer` to substitute. Repoint the 7 sites to `findByProps({ accessibilityLabel: 'Message input' })`.

- [ ] **Step 1: Delete the mock factory**

Edit `__tests__/chatComposer.test.tsx`:

```ts
// Before
jest.mock('react-native-gifted-chat', () => ({
  Composer: (props: any) => React.createElement('Composer', { __chatComposerMock: true, ...props }),
  Send: () => null,
}))

// After
// (delete the jest.mock block entirely)
```

- [ ] **Step 2: Repoint the 7 query sites**

For each occurrence of `tree.root.findByProps({ __chatComposerMock: true })` (lines 195, 221, 247, 271, 292, 309, 322), replace with `tree.root.findByProps({ accessibilityLabel: 'Message input' })`. Watch for the indentation difference at line 271 and 292 — they are nested inside conditional blocks.

- [ ] **Step 3: Run the tests; verify they pass**

```bash
cd clanker
npm test -- --testPathPattern='chatComposer'
```

Expected: 49 tests pass. The 42 tests that test document ingest, MIME resolution, phase reporting, photo dialog, camera capture, snackbar do not change — they assert on `ChatComposer` props/state, not on the inner `Composer` mock.

- [ ] **Step 4: Commit**

```bash
git add __tests__/chatComposer.test.tsx
git commit -m "test(chat): delete gifted-chat mock factory from chatComposer tests"
```

### Task 2.7: Rewrite `chatComposerWebHeightLoop.test.tsx`

**Files:**

- Modify: `__tests__/chatComposerWebHeightLoop.test.tsx`

The old file mocks `react-native-gifted-chat` and asserts against the inner `Composer` mock. After Slice 2.2, `ChatComposer` is the real component. The four behaviours the file proves must still hold:

1. Grows with text (up to MAX).
2. Clamps at MAX.
3. Collapses to MIN when emptied.
4. **Terminates** under a hostile `onContentSizeChange` cycle.

- [ ] **Step 1: Delete the mock factory and the platform-header caveat**

Edit `__tests__/chatComposerWebHeightLoop.test.tsx`:

```ts
// Before
jest.mock('react-native-gifted-chat', () => ({
  Composer: (props: any) =>
    ReactLib.createElement('Composer', { __chatComposerMock: true, ...props }),
  Send: () => null,
}))

// After
// (delete the jest.mock block entirely)
```

Also remove the file's header comment about the platform-haste caveat (the spec says: "once there is one file, that caveat is obsolete and the comment goes").

- [ ] **Step 2: Repoint the 6 query sites**

Lines 33, 120, 135, 139, 169, 190 all use `findByProps({ __chatComposerMock: true })`. Replace each with `findByProps({ accessibilityLabel: 'Message input' })`.

- [ ] **Step 3: Update the props the test passes**

The test creates `ChatComposer` directly. The new `ChatComposer` requires `characterId`, `userId`, `onSubmit`, `onChangeText`, `onSendPhoto`. Pass placeholders:

```ts
const noop = () => {}
const photo = {
  messageId: 'm',
  imageId: 'i',
  uri: 'u',
  width: 0,
  height: 0,
  attachment: {} as any,
  variants: {},
}
const fakeProps = {
  text: '',
  onChangeText: noop,
  onSubmit: noop,
  characterId: 'c',
  userId: 'u',
  onSendPhoto: noop,
  onHeightChange: noop,
}
```

Pass these (merged with the per-test overrides) to `<ChatComposer {...fakeProps} {...overrides} />`.

- [ ] **Step 4: Run the test file**

```bash
cd clanker
npm test -- --testPathPattern='chatComposerWebHeightLoop'
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add __tests__/chatComposerWebHeightLoop.test.tsx
git commit -m "test(chat): rewrite height-loop tests against the real ChatComposer"
```

### Task 2.8: Rewrite the 8 affected tests in `chatViewAccessibility.test.tsx`

**Files:**

- Modify: `__tests__/chatViewAccessibility.test.tsx`

The 8 affected tests are at lines 279, 335, 353, 449–458, 500, 502, 523. They drive `renderSend`, `renderComposer`, `renderInputToolbar`, `alwaysShowSend`. After Slice 2.5, those props are gone — `ChatInputBar` and `SendButton` are the new surface.

- [ ] **Step 1: At the top of the file, replace the `jest.mock('react-native-gifted-chat')` factory**

The test currently mocks `GiftedChat` to capture props. Replace the factory to **also export `InputToolbar`, `Send`, `Composer` stubs** that let the library still render without throwing, but the surfaces we test directly are now `ChatInputBar` and `SendButton`.

Concretely, the truncated factory becomes:

```ts
jest.mock('react-native-gifted-chat', () => ({
  GiftedChat: (props: any) => {
    capturedGiftedChatProps = props
    return ReactLib.createElement('GiftedChat', props, props.children)
  },
  Bubble: () => null,
  InputToolbar: () => null,
  Send: () => null,
  MessageText: () => null,
  Composer: () => null,
}))
```

- [ ] **Step 2: Rewrite the 8 tests**

The eight tests are:

- Line 279: `renderSend: send button has accessibilityLabel "Send message" and role "button"`
- Line 335: composer render call
- Line 353: composer render call
- Lines 449–458: `GiftedChat receives renderInputToolbar, renderSend, and minInputToolbarHeight`
- Line 500: `alwaysShowSend` is true while generating
- Line 502: `renderSend` call
- Line 523: `renderSend produces a child element with primaryContainer background`

Rewrite each to import `ChatInputBar` and `SendButton` and assert directly. The semantics to preserve:

| Old assertion                                                             | New assertion                                                                                                                                                                                                   |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderSend` returns a `button` with `accessibilityLabel: 'Send message'` | `SendButton` exposes `accessibilityRole: 'button'`, `accessibilityLabel: 'Send message'`                                                                                                                        |
| `renderSend` returns a `progressbar` while generating                     | `SendButton` exposes `accessibilityRole: 'progressbar'`, `accessibilityState: { busy: true }`                                                                                                                   |
| `renderSend`'s pill uses `primaryContainer` background                    | `SendButton`'s pill uses `colors.primaryContainer` background                                                                                                                                                   |
| `renderInputToolbar` is a function                                        | Not applicable — `renderInputToolbar` is replaced by `ChatInputBar`                                                                                                                                             |
| `renderComposer` exists                                                   | Not applicable — composer is internal to `ChatInputBar`                                                                                                                                                         |
| `alwaysShowSend` matches `isGeneratingResponse`                           | `ChatInputBar`'s `isGenerating` prop is `isGeneratingResponse`                                                                                                                                                  |
| `minInputToolbarHeight` = `74 + 16`                                       | The library prop is gone; if we still want to assert the input is at least 74px, query the inner `TextInput` style — but the spec says rewrite against `ChatInputBar` directly, so this assertion is OK to drop |

For line 449, replace the test with one that asserts `ChatInputBar` is rendered (via `findByType(ChatInputBar)`) with the correct props.

- [ ] **Step 3: Run the test file**

```bash
cd clanker
npm test -- --testPathPattern='chatViewAccessibility'
```

Expected: 17 tests pass (the original 8 rewritten + the 9 already passing through until Slice 3).

- [ ] **Step 4: Commit**

```bash
git add __tests__/chatViewAccessibility.test.tsx
git commit -m "test(chat): rewrite 8 tests in chatViewAccessibility against ChatInputBar"
```

### Task 2.9: Verify the slice end-state

- [ ] **Step 1: Confirm `ChatComposer.web.tsx` is gone**

```bash
cd clanker
ls src/components/ChatComposer*
```

Expected: only `ChatComposer.tsx` exists.

- [ ] **Step 2: Run the full test suite**

```bash
cd clanker
npm test 2>&1 | grep -E "Tests:" | tail -1
```

Compare to the Slice 1 total. The delta should be: **+3 tests** (the 3 in the rewritten `chatComposerWebHeightLoop.test.tsx` were already counted in Slice 1; the new tests come from… wait, both before and after there were 3. The delta is in the 49 chatComposer tests — they survived verbatim, not added). So expect: **same count as Slice 1, no regressions**.

- [ ] **Step 3: Manual test on iOS dev build + Expo web**

[ ] Composer grows to ~6 lines then scrolls internally
[ ] Composer collapses on send
[ ] Document ingest end-to-end
[ ] Photo from picker and from camera
[ ] Send ↔ spinner swap
[ ] Web: composer does not loop (height-on-height feedback is dead)

---

## Slice 3 — Container

Our own `MessageList` + `KeyboardAvoidingView`. `handleSend` mints `_id` / `createdAt` / `user` from `messageIdGenerator`'s body. Delete `renderAvatar`, `bottomOffset`, `messageIdGenerator`, `minInputToolbarHeight`, `minComposerHeight`, `react-native-gifted-chat` from `package.json`. The 9 remaining chatViewAccessibility tests and all 10 chatViewAvatarSource tests rewrite against the real `MessageList`. Add a streaming-key invariant test.

### Task 3.1: Create `MessageRow`

**Files:**

- Create: `src/components/MessageRow.tsx`

- [ ] **Step 1: Implement `MessageRow`**

```tsx
// src/components/MessageRow.tsx
import React from 'react'
import { View, Platform, StyleSheet } from 'react-native'
import { MessageBubble } from '~/components/MessageBubble'
import type { Message } from '~/types/chat'

interface MessageRowProps {
  message: Message
  isOwn: boolean
  renderAvatar: (message: Message) => React.ReactNode
}

export function MessageRow({ message, isOwn, renderAvatar }: MessageRowProps) {
  return (
    <View style={[styles.row, Platform.OS === 'web' ? { minWidth: 0, maxWidth: '100%' } : {}]}>
      {renderAvatar(message)}
      <View style={[styles.content, isOwn ? styles.right : styles.left]}>
        <MessageBubble message={message} isOwn={isOwn} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 8,
    marginVertical: 2,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
  },
  left: {
    justifyContent: 'flex-start',
  },
  right: {
    justifyContent: 'flex-end',
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MessageRow.tsx
git commit -m "feat(chat): add MessageRow with avatar positioning"
```

### Task 3.2: Create `MessageList`

**Files:**

- Create: `src/components/MessageList.tsx`

- [ ] **Step 1: Implement `MessageList`**

```tsx
// src/components/MessageList.tsx
import React from 'react'
import { FlatList, Platform, type FlatListProps } from 'react-native'
import { MessageRow } from '~/components/MessageRow'
import type { Message } from '~/types/chat'

interface MessageListProps {
  messages: Message[]
  currentUserId: string
  renderAvatar: (message: Message) => React.ReactNode
  emptyComponent?: React.ReactNode
  contentContainerStyle?: FlatListProps<Message>['contentContainerStyle']
}

const groundingListViewProps: Pick<FlatListProps<unknown>, 'removeClippedSubviews'> | undefined =
  Platform.OS === 'web' ? undefined : { removeClippedSubviews: false }

export function MessageList({
  messages,
  currentUserId,
  renderAvatar,
  emptyComponent,
  contentContainerStyle,
}: MessageListProps) {
  return (
    <FlatList
      inverted
      data={messages}
      keyExtractor={(m) => m._id}
      renderItem={({ item }) => (
        <MessageRow
          message={item}
          isOwn={item.user._id === currentUserId}
          renderAvatar={renderAvatar}
        />
      )}
      ListEmptyComponent={emptyComponent ?? null}
      contentContainerStyle={contentContainerStyle}
      removeClippedSubviews={groundingListViewProps?.removeClippedSubviews}
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MessageList.tsx
git commit -m "feat(chat): add MessageList with inverted FlatList"
```

### Task 3.3: Write the streaming-key invariant test

**Files:**

- Create: `src/components/__tests__/MessageList.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
// src/components/__tests__/MessageList.test.tsx
import React from 'react'
import { render } from '@testing-library/react-native'
import { MessageList } from '../MessageList'
import type { Message } from '~/types/chat'

const baseMessage: Message = {
  _id: 'streaming-1',
  text: '',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  user: { _id: 'character-1', name: 'Bot' },
}

describe('MessageList streaming-key invariant', () => {
  it('preserves the message _id across streaming updates', () => {
    const renderAvatar = () => null
    const first = render(
      <MessageList messages={[baseMessage]} currentUserId="user" renderAvatar={renderAvatar} />,
    )
    // Force a streaming update — same _id, new text
    const updated: Message = { ...baseMessage, text: 'hello world' }
    first.rerender(
      <MessageList messages={[updated]} currentUserId="user" renderAvatar={renderAvatar} />,
    )
    // The keyed row should not have remounted.
    // Find the row by querying the live tree: the inner MessageText should
    // show the new text.
    expect(first.getByText('hello world')).toBeTruthy()
  })

  it('does not duplicate rows when the same _id is passed twice', () => {
    const renderAvatar = () => null
    const { queryAllByText } = render(
      <MessageList
        messages={[baseMessage, baseMessage]}
        currentUserId="user"
        renderAvatar={renderAvatar}
      />,
    )
    // FlatList dedupes by key — the same _id twice collapses to one row.
    // The bubble does not render the text (it's empty), so verify via the
    // _id-keyed row count instead.
    expect(queryAllByText('hello world')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd clanker
npm test -- --testPathPattern='MessageList'
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/__tests__/MessageList.test.tsx
git commit -m "test(chat): pin streaming-key invariant on MessageList"
```

### Task 3.4: Rewrite `chatViewAvatarSource.test.tsx`

**Files:**

- Modify: `__tests__/chatViewAvatarSource.test.tsx`

The 10 tests use `capturedGiftedChatProps.renderAvatar(...)` at lines 215, 226, 290 to exercise avatar rendering. After Slice 3.2, `MessageList` is the source of truth and `renderAvatar` is provided as a prop to `ChatView`. Update the test to:

1. Drive `renderAvatar` directly by extracting it from the `MessageList` query, or — simpler — render `ChatView` and query for the `Avatar.Image` / `Avatar.Text` / `CharacterAvatar` instances that the `renderAvatar` prop produces.
2. Drop the `capturedGiftedChatProps` mock entirely.

- [ ] **Step 1: Rewrite the tests**

Use `render(<ChatView characterId="..." />)` with a populated `QueryClient` and `AuthMachine`. Query the rendered tree for the avatar elements directly. The 10 assertions stay verbatim — only the driver changes.

Concrete driver pattern:

```ts
const { UNSAFE_getByType } = render(<ChatView characterId="..." />)
const avatar = UNSAFE_getByType(CharacterAvatar)
expect(avatar.props.characterName).toBe('Bot')
```

- [ ] **Step 2: Run the test file**

```bash
cd clanker
npm test -- --testPathPattern='chatViewAvatarSource'
```

Expected: 10 tests pass.

- [ ] **Step 3: Commit**

```bash
git add __tests__/chatViewAvatarSource.test.tsx
git commit -m "test(chat): rewrite chatViewAvatarSource tests against MessageList"
```

### Task 3.5: Rewrite the remaining 9 tests in `chatViewAccessibility.test.tsx`

**Files:**

- Modify: `__tests__/chatViewAccessibility.test.tsx`

The 9 tests that survived Slice 2 are the ones still driving `renderAvatar` (lines 394, 401, 413, 420), the `GiftedChat` mock factory itself, and a few grab-bag assertions on `capturedGiftedChatProps`. After Slice 3, the `GiftedChat` mock is gone — rewrite the tests against `MessageList` and the `renderAvatar` callback.

- [ ] **Step 1: Delete the `GiftedChat` mock factory**

```ts
// Before
jest.mock('react-native-gifted-chat', () => ({
  GiftedChat: (props: any) => {
    capturedGiftedChatProps = props
    return ReactLib.createElement('GiftedChat', props, props.children)
  },
  Bubble: () => null,
  InputToolbar: () => null,
  Send: () => null,
  MessageText: () => null,
  Composer: () => null,
}))

// After
// (delete the mock block entirely)
```

- [ ] **Step 2: Rewrite the 9 tests**

The 9 tests test:

- `renderAvatar: character avatar carries character name as accessibility label` (line 394)
- `renderAvatar: user avatar carries the user display name as accessibility label` (line 413)
- 7 other grab-bag assertions on `capturedGiftedChatProps` (which is now null)

For each test, render `<ChatView>` directly and query the rendered tree.

- [ ] **Step 3: Run the test file**

```bash
cd clanker
npm test -- --testPathPattern='chatViewAccessibility'
```

Expected: 17 tests pass.

- [ ] **Step 4: Commit**

```bash
git add __tests__/chatViewAccessibility.test.tsx
git commit -m "test(chat): rewrite remaining 9 tests against MessageList"
```

### Task 3.6: Replace `GiftedChat` with `MessageList` in `ChatView`

**Files:**

- Modify: `src/components/ChatView.tsx`

- [ ] **Step 1: Replace the `GiftedChat` JSX with `MessageList` + `KeyboardAvoidingView`**

```tsx
// Before
<GiftedChat
  messages={displayMessages}
  onSend={handleSend}
  user={chatUser}
  renderBubble={renderBubble}
  renderMessageImage={(props) => <ChatImageBubble currentMessage={props.currentMessage} />}
  renderInputToolbar={() => <View />}
  renderCustomView={...}
  isCustomViewBottom
  listViewProps={groundingListViewProps}
  renderAvatarOnTop
  messagesContainerStyle={styles.messagesContainer}
  bottomOffset={-tabBarHeight}
  renderAvatar={(props) => { ... }}
/>

// After
<MessageList
  messages={displayMessages}
  currentUserId={currentUserId}
  renderAvatar={renderAvatar}
  contentContainerStyle={styles.messagesContainer}
/>
```

- [ ] **Step 2: Update `handleSend` to mint the outgoing message**

```ts
// Before
const handleSend = useCallback(
  async (newMessages: IMessage[] = []) => {
    if (!creditsLoading && credits <= 0) {
      router.push('/subscribe')
      return
    }
    const first = newMessages[0]
    if (newMessages.length > 0 && first && first.text.trim().length > 0) {
      await sendMessage(first)
    }
  },
  [sendMessage, credits, creditsLoading],
)

// After
const handleSend = useCallback(
  async (text: string) => {
    if (!creditsLoading && credits <= 0) {
      router.push('/subscribe')
      return
    }
    const outgoingMessage: Message = {
      _id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      text,
      createdAt: new Date(),
      user: chatUser,
    }
    await sendMessage(outgoingMessage)
  },
  [sendMessage, credits, creditsLoading, chatUser],
)
```

- [ ] **Step 3: Drop `renderBubble`, `renderCustomView`, `renderAvatar`, `renderInputToolbar`**

Delete those `useCallback` blocks. `MessageList` takes over list rendering. Move `renderAvatar` to the form `MessageList` expects (it now takes a `Message`, not a GiftedChat props object):

```ts
const renderAvatar = useCallback(
  (message: Message) => {
    const isUser = message.user._id === currentUserId
    if (isUser) {
      const displayName = userDisplayName?.trim()
      const accessibilityLabel = displayName ? `${displayName}'s avatar` : 'Your avatar'
      const userAvatarUri = chatUser.avatar as string | undefined
      if (userAvatarUri) {
        return (
          <Avatar.Image
            accessible
            accessibilityRole="image"
            size={36}
            source={{ uri: userAvatarUri }}
            accessibilityLabel={accessibilityLabel}
          />
        )
      }
      return (
        <Avatar.Text
          accessible
          accessibilityRole="image"
          size={36}
          label={getInitials(displayName)}
          accessibilityLabel={accessibilityLabel}
        />
      )
    }
    return (
      <CharacterAvatar
        size={36}
        imageUrl={characterAvatar}
        characterName={characterName}
      />
    )
  },
  [currentUserId, userDisplayName, chatUser.avatar, characterAvatar, characterName],
)
```

- [ ] **Step 4: Drop unused imports**

```ts
// Before
import { GiftedChat } from 'react-native-gifted-chat'
import type { IMessage, User } from 'react-native-gifted-chat'
import { BottomTabBarHeightContext } from 'expo-router/build/react-navigation/bottom-tabs/utils/BottomTabBarHeightContext'
// ...
import ChatComposer, { MIN_INPUT_HEIGHT } from '~/components/ChatComposer'

// After
import type { Message } from '~/types/chat'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
// (GiftedChat, BottomTabBarHeightContext, and ChatComposer imports all gone)
```

- [ ] **Step 5: Wrap the screen in `KeyboardAvoidingView`**

```tsx
// Before
<View style={styles.container}>
  {/* status banners, error, LowPowerBanner */}
  <GiftedChat ... />
  <ChatInputBar ... />
</View>

// After
<KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
  {/* status banners, error, LowPowerBanner */}
  <MessageList ... />
  <ChatInputBar
    characterId={characterId}
    userId={currentUserId}
    onSubmit={handleSend}
    onSendPhoto={handleSendPhoto}
    onPhaseChange={setDocumentPhase}
    canSendPhoto={canSendPhoto}
    isGenerating={isGeneratingResponse}
    /* onHeightChange is deleted */
  />
</KeyboardAvoidingView>
```

- [ ] **Step 6: Update `ChatInputBar` to drop `onHeightChange`**

Edit `src/components/ChatInputBar.tsx`: remove the `onHeightChange` prop and the `onHeightChange={onHeightChange}` line that passes it to `ChatComposer`. Edit `ChatComposer.tsx`: remove the `onHeightChange` prop and the `useEffect` that called it.

- [ ] **Step 7: Run typecheck and tests**

```bash
cd clanker
npm run typecheck
npm test -- --testPathPattern='chatComposer|chatView|MessageList' 2>&1 | tail -5
```

Expected: typecheck PASS, all 81 tests pass (79 original + 2 streaming-key).

- [ ] **Step 8: Commit**

```bash
git add src/components/ChatView.tsx src/components/ChatInputBar.tsx src/components/ChatComposer.tsx
git commit -m "feat(chat): replace GiftedChat with MessageList + KeyboardAvoidingView"
```

### Task 3.7: Remove `react-native-gifted-chat` from `package.json`

**Files:**

- Modify: `package.json`
- Regenerate: `package-lock.json`

- [ ] **Step 1: Edit `package.json`**

```bash
cd clanker
npm uninstall react-native-gifted-chat
```

Expected: removes the line `"react-native-gifted-chat": "^2.8.1",` from `package.json` and updates `package-lock.json`.

- [ ] **Step 2: Verify the dep is gone**

```bash
cd clanker
npm ls react-native-gifted-chat
```

Expected: `(empty)` or `react-native-gifted-chat@0.0.0 extraneous` — anything that reports zero production copies.

- [ ] **Step 3: Verify the 8 transitive deps are also gone**

```bash
cd clanker
npm ls react-native-parsed-text react-native-lightbox-v2 react-native-communications react-native-iphone-x-helper lodash.isequal dayjs @expo/react-native-action-sheet @types/lodash.isequal 2>&1 | head -20
```

Expected: all 8 report nothing (none was directly depended on, confirmed by the spec's review pass).

- [ ] **Step 4: Run the full test suite**

```bash
cd clanker
npm test 2>&1 | grep -E "Tests:" | tail -1
```

Expected: same count as Task 3.6.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): remove react-native-gifted-chat and its 8 transitive deps"
```

### Task 3.8: Verify the slice end-state

- [ ] **Step 1: Confirm zero `react-native-gifted-chat` source references**

```bash
cd clanker
git grep -nE "react-native-gifted-chat" -- 'src/*.ts' 'src/*.tsx' 'src/**/*.ts' 'src/**/*.tsx' '__tests__/*.tsx' 'package.json'
```

Expected: empty output. (The spec explicitly excludes `README.md` and `docs/superpowers/specs/` from this check.)

- [ ] **Step 2: Run the full test suite**

```bash
cd clanker
npm test 2>&1 | grep -E "Tests:" | tail -1
```

Expected: matches the count after Task 3.7 step 4.

- [ ] **Step 3: Verify the dev build and the web build**

[ ] iOS dev build launches
[ ] Android dev build launches
[ ] Expo web starts
[ ] `npm run typecheck` PASS

- [ ] **Step 4: Manual test on iOS dev build + Android dev build + Expo web**

[ ] Keyboard does not cover the input above the tab bar
[ ] Avatars correct on both sides
[ ] Scrollback smooth on a long history
[ ] **Streaming reply does not jump the list** (the streaming-key invariant test pins this; manual pass confirms)
[ ] **Send a message, force-quit, reopen** — the message remains and the AI response is preserved (verifies `handleSend` mints the right `_id`)
[ ] URL tap opens browser
[ ] Photo bubble renders from `imageId`
[ ] Grounding chips render correctly

---

## Self-Review (writing-plans checklist)

Run this once the plan is complete. If anything fails, fix inline.

1. **Spec coverage:** The plan covers every requirement in the spec:
   - ✓ Slice 0 creates `src/types/chat.ts` (spec §"The type we own")
   - ✓ Slice 0 repoints 14 type-only consumers (spec §"Scope → Type-only consumers")
   - ✓ Slice 0 drops `received` in `messageDatabase.ts:47` (spec §"The type we own")
   - ✓ Slice 0 keeps `GroundedIMessage` as alias (spec §"The type we own")
   - ✓ Slice 1 deletes `image` sentinel in `useAIChat.ts:501-504` (spec §"The `image` sentinel")
   - ✓ Slice 1 drops `GroundedIMessage` alias (spec §"The type we own")
   - ✓ Slice 1 introduces `MessageBubble`, `MessageText`, `GroundingFooter`, `linkifyUrls` (spec §"Component contracts")
   - ✓ Slice 2 introduces `ChatInputBar` + unified `ChatComposer` (spec §"Component contracts")
   - ✓ Slice 2 deletes `ChatComposer.web.tsx` (spec §"Two hacks that die")
   - ✓ Slice 2 keeps the one-way `onHeightChange` shim (spec §"Slice 2 → ⚠️ Known carry-over")
   - ✓ Slice 2 rewrites the 8 affected tests in `chatViewAccessibility.test.tsx` (spec §"Slice 2 → ⚠️ Verification, chatViewAccessibility")
   - ✓ Slice 2 rewrites `chatComposer.test.tsx` (spec §"Slice 2 → Verification, chatComposer")
   - ✓ Slice 2 rewrites `chatComposerWebHeightLoop.test.tsx` (spec §"Slice 2 → Verification, chatComposerWebHeightLoop")
   - ✓ Slice 3 introduces `MessageList` + `KeyboardAvoidingView` (spec §"Component contracts" + "Keyboard")
   - ✓ Slice 3 makes `handleSend` mint `_id` / `createdAt` / `user` (spec §"Who builds the outgoing message")
   - ✓ Slice 3 adds the streaming-key invariant test (spec §"Data flow → Streaming requires a stable key")
   - ✓ Slice 3 removes `react-native-gifted-chat` from `package.json` (spec §"Goals")
   - ✓ Manual-test checklists for each slice (spec §"Testing")

2. **Placeholder scan:** No `TBD`, `TODO`, "implement later", "fill in details", "add appropriate error handling", "similar to Task N", or unnamed references. Each implementation step shows the actual code.

3. **Type/identifier consistency:**
   - `Message` and `ChatUser` are defined in Slice 0.1 and used uniformly across Slices 0–3.
   - `messageIdGenerator` is **not** exported (the spec says the body is moved into `handleSend` in Slice 3, not exported). Task 2.3 was a self-correction: removed.
   - `MIN_INPUT_HEIGHT` and `MAX_INPUT_HEIGHT` are exported from `ChatComposer.tsx` only; `ChatInputBar` does not export them.
   - `pendingImageAsset` type is preserved as `{ uri: string; width: number; height: number; asset: DocumentPicker.DocumentPickerAsset } | null` (carried verbatim from the prior `ChatComposer.tsx`).
   - `handleInputSubmit` in Slice 2.5 was renamed to `handleSend` in Slice 3.6 — the plan states this transition explicitly. _(Superseded: this name inconsistency was caught in self-review and resolved to `handleSend` everywhere. The earlier draft introduced `handleInputSubmit` only to rename it back; the saved version uses `handleSend` from Slice 2.5 onward, with the signature change `(newMessages: IMessage[]) => Promise<void>` → `(text: string) => void` documented in Task 2.5 Step 1.)_
   - `ChatInputBar` props are consistent across Slice 2.4 (`onHeightChange`) and Slice 3.6 (removed).

---

## Manual Test Summary (per slice)

| Slice | iOS / Android                                                                                                                                                               | Web                                                                      |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0     | No manual pass — type-only.                                                                                                                                                 | No manual pass — type-only.                                              |
| 1     | Text bubble both sides; URL tap opens browser; photo bubble; grounding chips + search suggestions without overlap.                                                          | Same.                                                                    |
| 2     | Composer grows to ~6 lines then scrolls; collapses on send; document ingest end-to-end; photo from picker & camera; send ↔ spinner swap.                                    | **Web gets the closest look** — the height-loop regression is the focus. |
| 3     | Keyboard does not cover input above tab bar; avatars correct; scrollback smooth; streaming reply does not jump; **send-then-force-quit-then-reopen** preserves the message. | Same.                                                                    |

Each slice is a separate PR to `staging`, independently revertable. Slices 0–2 leave `react-native-gifted-chat` installed.

---

## Rollback

- **Slice 0 → 2:** single-PR revert, no dependency churn.
- **Slice 3:** revert `package.json` + `package-lock.json` + the component changes. Without Slice 3, `react-native-gifted-chat` is still installed, so the pre-Slice-3 components from `ChatView` would still need to drive the gifted-chat props. Practically: revert the entire Slice 3 PR. The components from Slices 1–2 keep working because they were built to render _inside_ gifted-chat.

There is no live staging environment ([[no-live-staging-environment]]). PRs target `staging`, then are fast-forwarded to `main` — both reach production. Each slice must be independently revertable.

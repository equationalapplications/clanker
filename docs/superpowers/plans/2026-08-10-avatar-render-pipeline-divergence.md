# Avatar Render Pipeline Divergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Talk and Chat render avatars from the Phase 1 image pipeline instead of the dead `characters.avatar` column, and make `CharacterAvatar` actually reach its bundled-default branch.

**Architecture:** Render-layer only. Four call sites switch from `character.avatar` to `useResolvedImage(character.active_image_id, variant) ?? character.avatar`. `CharacterAvatar`'s fallback chain drops its initials branch so `imageUrl → bundled default` is reachable. `AvatarPicker` sends `LOAD` after mutating `active_image_id` so the machine's cached characters stay fresh. No schema, migration, data, or type changes.

**Tech Stack:** React Native / Expo Router, XState via `~/hooks/useMachines`, expo-sqlite, Jest + `react-test-renderer` (not `@testing-library/react-native` — every test file touched here uses `create`/`act` directly).

**Spec:** `docs/superpowers/specs/2026-08-10-avatar-render-pipeline-divergence-design.md`

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/components/CharacterAvatar.tsx` | Fallback chain: `imageUrl → bundled default`. Drop initials + `showFallback`. |
| Modify | `__tests__/characterAvatarAccessibility.test.tsx` | Existing suite asserts the initials branch and passes `showFallback`; both go away. |
| Modify | `src/components/ChatView.tsx` | Header + bubble avatars read the new pipeline. |
| Create | `__tests__/chatViewAvatarSource.test.tsx` | Asserts ChatView's header and bubble avatar source precedence. |
| Modify | `app/(drawer)/(tabs)/talk/index.tsx` | Header + body avatars read the new pipeline. |
| Create | `__tests__/talkScreenAvatarSource.test.tsx` | Asserts Talk's header and body avatar source precedence. |
| Modify | `src/components/AvatarPicker.tsx` | Send `LOAD` after activate and after delete-of-active. |
| Modify | `__tests__/avatarPicker.test.tsx` | Asserts the two new `LOAD` sends. |

A separate test file is created for each screen rather than extending
`chatViewAccessibility.test.tsx` / `talkScreenGrounding.test.tsx`, because both
of those stub `~/components/CharacterAvatar` to `() => null` on purpose and
several of their assertions depend on that. Reworking them to capture props
would couple unrelated suites to this change.

**Run tests with `yarn test`, not bare `jest`.** The `test` script injects
`--require ./jest.preload.cjs` via `NODE_OPTIONS` to define `__DEV__` before
Jest's workers boot; running `jest` directly fails in module init.

---

## Task 1: `CharacterAvatar` falls through to the bundled default

**Files:**
- Modify: `src/components/CharacterAvatar.tsx`
- Test: `__tests__/characterAvatarAccessibility.test.tsx`

- [ ] **Step 1: Rewrite the two affected cases in the existing test file**

The suite currently has a test named `'Avatar.Text (initials) has accessible=true and label'` that asserts the branch being removed, plus two tests that pass `showFallback={false}`. Replace the initials test and drop the now-meaningless prop.

In `__tests__/characterAvatarAccessibility.test.tsx`, replace this test:

```tsx
  it('Avatar.Text (initials) has accessible=true and label', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl={null} characterName="Frodo Baggins" />) })
    const avatar = tree.root.findByType('AvatarText')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Frodo Baggins avatar')
  })
```

with this one:

```tsx
  // Regression guard for the Phase 1 divergence: the image-pipeline spec and
  // characterMachine.ts both assume a character with no image row renders the
  // bundled asset. An initials branch ahead of that fallback made it
  // unreachable, so every avatar-less character showed initials instead.
  it('renders the bundled default — not initials — when there is no image but there is a name', () => {
    let tree: any
    act(() => { tree = create(<CharacterAvatar imageUrl={null} characterName="Frodo Baggins" />) })
    expect(tree.root.findAllByType('AvatarText')).toHaveLength(0)
    const avatar = tree.root.findByType('AvatarImage')
    expect(avatar.props.source).toBe('DEFAULT_AVATAR_ASSET')
    expect(avatar.props.accessible).toBe(true)
    expect(avatar.props.accessibilityLabel).toBe('Character avatar')
  })
```

Then remove the `showFallback={false}` prop from the two tests that pass it. Replace:

```tsx
    act(() => { tree = create(<CharacterAvatar imageUrl={null} characterName="" showFallback={false} />) })
```

with:

```tsx
    act(() => { tree = create(<CharacterAvatar imageUrl={null} characterName="" />) })
```

and replace:

```tsx
    act(() => { tree = create(<CharacterAvatar imageUrl="https://example.com/a.png" characterName="" showFallback={false} />) })
```

with:

```tsx
    act(() => { tree = create(<CharacterAvatar imageUrl="https://example.com/a.png" characterName="" />) })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test __tests__/characterAvatarAccessibility.test.tsx`

Expected: FAIL. The new test errors on `tree.root.findAllByType('AvatarText')` returning length 1 (or on `findByType('AvatarImage')` throwing "No instances found"), because the current component takes the initials branch for a named character.

- [ ] **Step 3: Rewrite `CharacterAvatar`**

Replace the entire contents of `src/components/CharacterAvatar.tsx` with:

```tsx
import React, { useState } from 'react'
import { Avatar } from 'react-native-paper'
import type { ComponentProps } from 'react'

/**
 * Bundled default. Nothing is written per character: previously every new
 * character stored its own copy of the same 7.6 KB base64 blob, and that blob
 * was an Android adaptive icon whose padding showed as a ring under the
 * circular mask.
 */
const DEFAULT_AVATAR = require('../../assets/default-avatar-1024.webp')

// react-native-paper 5.x does not include `resizeMode` in the type definition
// for Avatar.Image, but the underlying Image component accepts it and it is
// needed to fill the circular mask with non-square sources.
type AvatarImageProps = ComponentProps<typeof Avatar.Image> & { resizeMode?: string }

interface CharacterAvatarProps {
  size?: number
  imageUrl?: string | null
  characterName?: string
}

/**
 * Fallback chain: `imageUrl` → bundled default.
 *
 * There is deliberately no initials branch. Characters with no image row are
 * expected to render the bundled asset — see `characterMachine.ts`'s default
 * character creation and the bundled-default purge in
 * `migrateAvatarsToImageStore`, both of which write no row on purpose. An
 * initials branch ahead of the bundled default made that fallback unreachable
 * for any character with a name, i.e. all of them.
 */
export default function CharacterAvatar({
  size = 100,
  imageUrl,
  characterName = '',
}: CharacterAvatarProps) {
  const [erroredUrl, setErroredUrl] = useState<string | null>(null)
  // Derived: imageError is true only when the current URL matches the one that
  // errored. When imageUrl changes, erroredUrl won't match, so imageError
  // naturally resets — no effect needed.
  const imageError = imageUrl != null && erroredUrl === imageUrl

  const AvatarImage = Avatar.Image as React.ComponentType<AvatarImageProps>

  if (imageUrl && !imageError) {
    return (
      <AvatarImage
        size={size}
        source={{ uri: imageUrl }}
        // Legacy migrated avatars can be non-square; cover fills the circle
        // instead of letterboxing it.
        resizeMode="cover"
        onError={() => {
          setErroredUrl(imageUrl ?? null)
        }}
        accessible
        accessibilityLabel={characterName ? `${characterName} avatar` : 'Character avatar'}
      />
    )
  }

  return (
    <AvatarImage
      size={size}
      source={DEFAULT_AVATAR}
      resizeMode="cover"
      accessible
      accessibilityLabel="Character avatar"
    />
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test __tests__/characterAvatarAccessibility.test.tsx`

Expected: PASS, 6 tests.

- [ ] **Step 5: Check for other `showFallback` callers**

Run: `grep -rn "showFallback" src app __tests__`

Expected: no output. If any line prints, delete that prop from the call site — it no longer exists on `CharacterAvatarProps` and TypeScript will reject it.

- [ ] **Step 6: Commit**

```bash
git add src/components/CharacterAvatar.tsx __tests__/characterAvatarAccessibility.test.tsx
git commit -m "fix(avatar): fall through to the bundled default instead of initials

The initials branch was gated on characterName && showFallback, and
showFallback defaults to true and was never passed false — so every
named character took it and the bundled-default branch was unreachable.
Both the image-pipeline spec and characterMachine.ts assume characters
with no image row render the bundled asset."
```

---

## Task 2: ChatView reads the new pipeline

**Files:**
- Modify: `src/components/ChatView.tsx:157`, `:385`
- Test: `__tests__/chatViewAvatarSource.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/chatViewAvatarSource.test.tsx`:

```tsx
/**
 * Avatar source precedence for ChatView's header and message bubbles.
 *
 * Chain: resolved(active_image_id) → legacy characters.avatar → bundled default.
 * The header is installed through drawerNav.setOptions, so it is captured and
 * rendered separately from the main tree.
 */

import React from 'react'
import { create, act } from 'react-test-renderer'

// ── Gifted-Chat ─────────────────────────────────────────────────────────────
let capturedGiftedChatProps: any = null

jest.mock('react-native-gifted-chat', () => {
  const React = require('react')
  return {
    GiftedChat: (props: any) => {
      capturedGiftedChatProps = props
      return React.createElement('View', { testID: 'gifted-chat' })
    },
    Bubble: () => null,
    InputToolbar: () => null,
    Send: ({ sendButtonProps, children }: any) =>
      React.createElement('View', { testID: 'send-btn', ...sendButtonProps }, children),
  }
})

// ── expo-router ──────────────────────────────────────────────────────────────
let capturedHeaderTitle: (() => React.ReactElement) | null = null

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    getParent: () => ({
      getParent: () => ({
        setOptions: (opts: any) => {
          if (typeof opts?.headerTitle === 'function') capturedHeaderTitle = opts.headerTitle
        },
      }),
    }),
    addListener: jest.fn(() => jest.fn()),
  }),
}))

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    setParams: jest.fn(),
  }),
  Stack: Object.assign(
    ({ children }: any) => {
      const React = require('react')
      return React.createElement('View', {}, children)
    },
    { Screen: () => null },
  ),
}))

// ── react-native ─────────────────────────────────────────────────────────────
jest.mock('react-native', () => {
  const React = require('react')
  const View = (props: any) => React.createElement('View', props)
  const Text = (props: any) => React.createElement('Text', props)
  const TouchableOpacity = (props: any) => React.createElement('TouchableOpacity', props)
  return {
    StyleSheet: { create: (s: any) => s, hairlineWidth: 1 },
    Platform: { OS: 'android', select: (spec: any) => spec.android || spec.default },
    View,
    Text,
    TouchableOpacity,
  }
})

// ── react-native-paper ───────────────────────────────────────────────────────
jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    ActivityIndicator: (props: any) =>
      React.createElement('View', { testID: 'activity-indicator', ...props }),
    useTheme: () => ({
      colors: {
        primary: '#6200ee',
        onPrimary: '#fff',
        primaryContainer: '#e9d5ff',
        secondary: '#00c',
        onSecondary: '#fff',
        surface: '#1e1e1e',
        outlineVariant: '#444',
      },
      roundness: 4,
    }),
    Avatar: {
      Image: (props: any) => React.createElement('View', { testID: 'avatar-img', ...props }),
      Text: (props: any) => React.createElement('View', { testID: 'avatar-text', ...props }),
    },
  }
})

// ── Auth / XState ─────────────────────────────────────────────────────────────
jest.mock('~/hooks/useMachines', () => ({
  useAuthMachine: () => ({}),
}))

jest.mock('@xstate/react', () => ({
  useSelector: (_service: any, selector: any) =>
    selector({ context: { user: { uid: 'user-1', displayName: 'Test', photoURL: null } } }),
}))

// ── Data hooks ────────────────────────────────────────────────────────────────
const mockUseCharacter = jest.fn()
jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: (...args: any[]) => mockUseCharacter(...args),
}))

jest.mock('~/hooks/useMessages', () => ({
  useChatMessages: () => [],
}))

jest.mock('~/hooks/useAIChat', () => ({
  useAIChat: () => ({
    messages: [],
    sendMessage: jest.fn(),
    isGeneratingResponse: false,
    escalationState: 'idle',
    error: null,
    activeTool: null,
    streamingMessage: null,
  }),
}))

jest.mock('~/hooks/usePowerBalance', () => ({
  usePowerBalance: () => ({ totalPower: 10 }),
}))

// ── The pipeline under test ───────────────────────────────────────────────────
let mockResolved: string | null = null
const mockUseResolvedImage = jest.fn(() => mockResolved)
jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: (...args: any[]) => mockUseResolvedImage(...args),
}))

// ── Child components ──────────────────────────────────────────────────────────
const capturedAvatarProps: any[] = []
jest.mock('~/components/CharacterAvatar', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedAvatarProps.push(props)
    return null
  },
}))

jest.mock('~/components/ChatComposer', () => ({
  __esModule: true,
  COMPOSER_VERTICAL_PADDING: 8,
  MIN_INPUT_HEIGHT: 74,
  MAX_INPUT_HEIGHT: 151,
  default: () => null,
}))

jest.mock('@equationalapplications/expo-llm-wiki', () => ({
  useEntityStatus: () => ({ ingesting: false, librarian: false, heal: false }),
}))

// ── SUT ───────────────────────────────────────────────────────────────────────
import ChatView from '~/components/ChatView'

function renderChat(character: Record<string, unknown>) {
  mockUseCharacter.mockReturnValue({ data: character, isLoading: false })
  let tree: any
  act(() => { tree = create(<ChatView characterId="char-1" />) })
  return tree
}

/** Render the headerTitle element captured from drawerNav.setOptions. */
function renderHeader() {
  expect(capturedHeaderTitle).toBeTruthy()
  act(() => { create(capturedHeaderTitle!()) })
}

function baseCharacter(overrides: Record<string, unknown>) {
  return {
    id: 'char-1',
    name: 'Nova',
    avatar: null,
    active_image_id: null,
    appearance: 'Friendly AI',
    traits: 'calm',
    emotions: 'cheerful',
    context: 'coach',
    cloud_id: null,
    save_to_cloud: false,
    ...overrides,
  }
}

/** The character-side avatar uri GiftedChat's renderAvatar would use. */
function bubbleAvatarUri(tree: any): string | null | undefined {
  const rendered = capturedGiftedChatProps.renderAvatar({
    currentMessage: { user: { _id: 'char-1' } },
  })
  const holder = create(rendered)
  const img = holder.root.findAllByProps({ testID: 'avatar-img' }, { deep: false })[0]
  return img ? img.props.source.uri : null
}

describe('ChatView avatar source', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedAvatarProps.length = 0
    capturedGiftedChatProps = null
    capturedHeaderTitle = null
    mockResolved = null
  })

  it('header prefers the resolved image over a stale legacy avatar URL', () => {
    mockResolved = 'file:///new.webp'
    renderChat(baseCharacter({ avatar: 'https://old.example/stale.png', active_image_id: 'img-1' }))
    renderHeader()

    expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')
    expect(capturedAvatarProps[0].imageUrl).toBe('file:///new.webp')
  })

  it('header falls back to the legacy avatar URL when nothing resolves', () => {
    mockResolved = null
    renderChat(baseCharacter({ avatar: 'https://old.example/legacy.png' }))
    renderHeader()

    expect(capturedAvatarProps[0].imageUrl).toBe('https://old.example/legacy.png')
  })

  it('header passes null when there is neither a row nor a legacy URL', () => {
    mockResolved = null
    renderChat(baseCharacter({}))
    renderHeader()

    expect(capturedAvatarProps[0].imageUrl).toBeNull()
  })

  it('message bubbles prefer the resolved image over a stale legacy avatar URL', () => {
    mockResolved = 'file:///new.webp'
    const tree = renderChat(
      baseCharacter({ avatar: 'https://old.example/stale.png', active_image_id: 'img-1' }),
    )

    expect(bubbleAvatarUri(tree)).toBe('file:///new.webp')
  })

  it('message bubbles fall back to the legacy avatar URL', () => {
    mockResolved = null
    const tree = renderChat(baseCharacter({ avatar: 'https://old.example/legacy.png' }))

    expect(bubbleAvatarUri(tree)).toBe('https://old.example/legacy.png')
  })

  it('resolves the bubble avatar once per ChatView, not once per message', () => {
    mockResolved = 'file:///new.webp'
    renderChat(baseCharacter({ active_image_id: 'img-1' }))

    // Header + bubbles share two hook calls total (one per variant request);
    // a hook moved inside renderAvatar would multiply with message count.
    expect(mockUseResolvedImage.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test __tests__/chatViewAvatarSource.test.tsx`

Expected: FAIL. `expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')` fails with zero calls — ChatView does not import the hook yet. The header test asserting `'file:///new.webp'` gets `'https://old.example/stale.png'` instead.

- [ ] **Step 3: Add the hook import to ChatView**

In `src/components/ChatView.tsx`, immediately after the existing line:

```tsx
import { useCharacter } from '~/hooks/useCharacters'
```

add:

```tsx
import { useResolvedImage } from '~/hooks/useResolvedImage'
```

- [ ] **Step 4: Resolve once at component scope and use it for both sites**

In `src/components/ChatView.tsx`, replace this line (currently around `:385`):

```tsx
  const characterAvatar = character.avatar || null
```

with:

```tsx
  // Phase 1 pipeline first, then the deprecated `characters.avatar` column as a
  // tail fallback for devices whose one-shot migration has not run and for
  // characters that predate `avatar_data` entirely — those legitimately have a
  // working legacy URL and no gallery row. `CharacterAvatar` supplies the
  // bundled default when both are null.
  const resolvedAvatar = useResolvedImage(character.active_image_id, 'thumb')
  const characterAvatar = resolvedAvatar ?? character.avatar ?? null
```

Then replace the header avatar line (currently `:157`):

```tsx
              <CharacterAvatar size={40} imageUrl={character.avatar} characterName={characterName} />
```

with:

```tsx
              <CharacterAvatar size={40} imageUrl={characterAvatar} characterName={characterName} />
```

- [ ] **Step 5: Add `characterAvatar` to the header effect's dependency array**

The header is installed inside `React.useLayoutEffect`. `characterAvatar` starts
as `null` and becomes a real uri once the async resolve lands, so without this
the header keeps the first-render value.

Find the dependency array at the end of that `useLayoutEffect` (the one whose body calls `drawerNav?.setOptions({ headerTitle: ... })`). Replace:

```tsx
  }, [character, characterName, handleEdit, navigation])
```

with:

```tsx
  }, [character, characterAvatar, characterName, handleEdit, navigation])
```

Note: `characterAvatar` is declared *after* this `useLayoutEffect` in the file today. Move the two-line `resolvedAvatar` / `characterAvatar` declaration from Step 4 to sit immediately after `const characterName = character.name || 'Character'` so it is in scope for the effect. Delete the old declaration site.

- [ ] **Step 6: Run the test to verify it passes**

Run: `yarn test __tests__/chatViewAvatarSource.test.tsx`

Expected: PASS, 6 tests.

- [ ] **Step 7: Run the neighbouring suite for regressions**

Run: `yarn test __tests__/chatViewAccessibility.test.tsx`

Expected: PASS. That suite stubs `CharacterAvatar` to `() => null` and never asserts on avatar sources, so it should be unaffected. If it fails, the cause is the declaration move in Step 5 — check that `characterAvatar` is declared before every use.

- [ ] **Step 8: Commit**

```bash
git add src/components/ChatView.tsx __tests__/chatViewAvatarSource.test.tsx
git commit -m "fix(chat): render avatars from active_image_id, not the legacy column

ChatView's header and message bubbles read characters.avatar, which
Phase 1 never writes, so a regenerated avatar never appeared in chat.
Resolve active_image_id once at component scope — keeping the bubble
cost at one hook per view rather than one per message — with the legacy
URL as a tail fallback."
```

---

## Task 3: Talk screen reads the new pipeline

**Files:**
- Modify: `app/(drawer)/(tabs)/talk/index.tsx:139`, `:194`
- Test: `__tests__/talkScreenAvatarSource.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `__tests__/talkScreenAvatarSource.test.tsx`:

```tsx
/**
 * Avatar source precedence for the Talk screen's header and body avatars.
 *
 * Chain: resolved(active_image_id) → legacy characters.avatar → bundled default.
 * The header goes through drawerNav.setOptions, so it is captured and rendered
 * separately; the body avatar is in the main tree.
 */

import React from 'react'
import { create, act } from 'react-test-renderer'

let mockCharacter: Record<string, unknown> = {}

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}))

jest.mock('~/hooks/useCharacters', () => ({
  useCharacter: () => ({ data: mockCharacter, isLoading: false }),
}))

jest.mock('~/hooks/useTabCharacterId', () => ({
  useTabCharacterId: () => ({
    characterId: 'char-1',
    isLoading: false,
    isCreatingDefault: false,
  }),
}))

jest.mock('~/hooks/useLiveVoiceChat', () => ({
  useLiveVoiceChat: () => ({
    isConnecting: false,
    isLive: false,
    isSyncing: false,
    error: null,
    transcript: [],
    activeTool: null,
    groundingMetadata: null,
    isPlayingAudio: false,
    startCall: jest.fn(),
    endCall: jest.fn(),
    cancelCall: jest.fn(),
  }),
}))

jest.mock('~/components/GroundingHtml', () => ({
  GroundingHtml: () => null,
}))

jest.mock('react-native-reanimated', () => {
  const React = require('react')
  return {
    __esModule: true,
    default: {
      View: ({ children, style }: any) => React.createElement('View', { style }, children),
    },
    useSharedValue: (v: any) => ({ value: v }),
    useAnimatedStyle: () => ({}),
    withRepeat: (v: any) => v,
    withTiming: (v: any) => v,
    cancelAnimation: jest.fn(),
    Easing: { inOut: () => ({}), ease: {} },
  }
})

jest.mock('react-native', () => {
  const React = require('react')
  return {
    StyleSheet: { create: (s: any) => s },
    Platform: { OS: 'web' },
    View: ({ children, style, accessibilityRole, accessibilityLabel, testID }: any) =>
      React.createElement('View', { style, accessibilityRole, accessibilityLabel, testID }, children),
    Pressable: ({ children, onPress, disabled, style, accessibilityRole, accessibilityLabel }: any) =>
      React.createElement('Pressable', { onPress, disabled, style, accessibilityRole, accessibilityLabel }, children),
    TouchableOpacity: ({ children, onPress, accessibilityRole, accessibilityLabel }: any) =>
      React.createElement('TouchableOpacity', { onPress, accessibilityRole, accessibilityLabel }, children),
    ActivityIndicator: ({ size, style }: any) => React.createElement('ActivityIndicator', { size, style }),
    Linking: { openURL: jest.fn() },
  }
})

jest.mock('@expo/vector-icons', () => ({
  MaterialCommunityIcons: () => null,
}))

// ── The pipeline under test ───────────────────────────────────────────────────
let mockResolved: string | null = null
const mockUseResolvedImage = jest.fn(() => mockResolved)
jest.mock('~/hooks/useResolvedImage', () => ({
  useResolvedImage: (...args: any[]) => mockUseResolvedImage(...args),
}))

const capturedAvatarProps: any[] = []
jest.mock('~/components/CharacterAvatar', () => ({
  __esModule: true,
  default: (props: any) => {
    capturedAvatarProps.push(props)
    return null
  },
}))

let capturedHeaderTitle: (() => React.ReactElement) | null = null

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({
    addListener: jest.fn(() => jest.fn()),
    getParent: () => ({
      getParent: () => ({
        setOptions: (opts: any) => {
          if (typeof opts?.headerTitle === 'function') capturedHeaderTitle = opts.headerTitle
        },
      }),
    }),
  }),
}))

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
  }
})

import TalkTabScreen from '../app/(drawer)/(tabs)/talk/index'

function baseCharacter(overrides: Record<string, unknown>) {
  return {
    id: 'char-1',
    name: 'Frodo',
    avatar: null,
    active_image_id: null,
    voice: 'Aoede',
    save_to_cloud: 1,
    ...overrides,
  }
}

function renderTalk(character: Record<string, unknown>) {
  mockCharacter = character
  let tree: any
  act(() => { tree = create(<TalkTabScreen />) })
  return tree
}

/** Body avatar props — the header renders separately via setOptions. */
function bodyAvatarProps() {
  return capturedAvatarProps[capturedAvatarProps.length - 1]
}

function headerAvatarProps() {
  expect(capturedHeaderTitle).toBeTruthy()
  const before = capturedAvatarProps.length
  act(() => { create(capturedHeaderTitle!()) })
  return capturedAvatarProps[before]
}

describe('Talk screen avatar source', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    capturedAvatarProps.length = 0
    capturedHeaderTitle = null
    mockResolved = null
  })

  it('body avatar prefers the resolved master over a stale legacy URL', () => {
    mockResolved = 'file:///new-master.webp'
    renderTalk(baseCharacter({ avatar: 'https://old.example/stale.png', active_image_id: 'img-1' }))

    expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'master')
    expect(bodyAvatarProps().imageUrl).toBe('file:///new-master.webp')
  })

  it('body avatar falls back to the legacy URL when nothing resolves', () => {
    mockResolved = null
    renderTalk(baseCharacter({ avatar: 'https://old.example/legacy.png' }))

    expect(bodyAvatarProps().imageUrl).toBe('https://old.example/legacy.png')
  })

  it('body avatar passes null when there is neither a row nor a legacy URL', () => {
    mockResolved = null
    renderTalk(baseCharacter({}))

    expect(bodyAvatarProps().imageUrl).toBeNull()
  })

  it('header avatar requests the thumb variant and prefers the resolved image', () => {
    mockResolved = 'file:///new-thumb.webp'
    renderTalk(baseCharacter({ avatar: 'https://old.example/stale.png', active_image_id: 'img-1' }))

    expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')
    expect(headerAvatarProps().imageUrl).toBe('file:///new-thumb.webp')
  })

  it('header avatar falls back to the legacy URL', () => {
    mockResolved = null
    renderTalk(baseCharacter({ avatar: 'https://old.example/legacy.png' }))

    expect(headerAvatarProps().imageUrl).toBe('https://old.example/legacy.png')
  })

  // Guards the useLayoutEffect dependency array. The resolve is async, so the
  // header is first installed with null. `character` is the same object across
  // both renders, so only the resolved uri can retrigger the effect — drop it
  // from the deps and the header keeps showing the bundled default forever.
  it('reinstalls the header when the resolved image arrives after first render', () => {
    mockResolved = null
    const character = baseCharacter({ active_image_id: 'img-1' })
    const tree = renderTalk(character)

    expect(headerAvatarProps().imageUrl).toBeNull()

    mockResolved = 'file:///late-thumb.webp'
    act(() => { tree.update(<TalkTabScreen />) })

    expect(headerAvatarProps().imageUrl).toBe('file:///late-thumb.webp')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test __tests__/talkScreenAvatarSource.test.tsx`

Expected: FAIL. `expect(mockUseResolvedImage).toHaveBeenCalledWith('img-1', 'master')` fails with zero calls — the screen does not import the hook yet.

- [ ] **Step 3: Add the hook import**

In `app/(drawer)/(tabs)/talk/index.tsx`, immediately after the existing line:

```tsx
import { useCharacter } from '~/hooks/useCharacters'
```

add:

```tsx
import { useResolvedImage } from '~/hooks/useResolvedImage'
```

- [ ] **Step 4: Resolve both variants in `TalkView`**

In `app/(drawer)/(tabs)/talk/index.tsx`, find:

```tsx
function TalkView({ characterId }: { characterId: string }) {
  const { data: character } = useCharacter(characterId)
```

and insert the two resolutions directly beneath, so they sit above the
`useLayoutEffect` that installs the header:

```tsx
function TalkView({ characterId }: { characterId: string }) {
  const { data: character } = useCharacter(characterId)
  // Phase 1 pipeline first, then the deprecated `characters.avatar` column as a
  // tail fallback for devices whose one-shot migration has not run and for
  // characters that predate `avatar_data`. `CharacterAvatar` supplies the
  // bundled default when both are null. Two variants because the body avatar is
  // the screen's focal element and the header is 40px.
  const resolvedHeaderAvatar = useResolvedImage(character?.active_image_id, 'thumb')
  const headerAvatar = resolvedHeaderAvatar ?? character?.avatar ?? null
  const resolvedBodyAvatar = useResolvedImage(character?.active_image_id, 'master')
  const bodyAvatar = resolvedBodyAvatar ?? character?.avatar ?? null
```

`character` is optional here — `useCharacter` returns `{ data }` and the
`if (!character)` guard sits below the hooks, so these must tolerate `undefined`.

- [ ] **Step 5: Use the resolved values at both render sites**

Replace the header avatar line:

```tsx
              <CharacterAvatar size={40} imageUrl={character.avatar} characterName={character.name} />
```

with:

```tsx
              <CharacterAvatar size={40} imageUrl={headerAvatar} characterName={character.name} />
```

Replace the body avatar block:

```tsx
        <CharacterAvatar
          size={AVATAR_SIZE}
          imageUrl={character.avatar}
          characterName={character.name}
        />
```

with:

```tsx
        <CharacterAvatar
          size={AVATAR_SIZE}
          imageUrl={bodyAvatar}
          characterName={character.name}
        />
```

- [ ] **Step 6: Add `headerAvatar` to the header effect's dependency array**

The header `React.useLayoutEffect` currently ends with:

```tsx
  }, [character, isLive, characterId, navigation])
```

Change it to:

```tsx
  }, [character, headerAvatar, isLive, characterId, navigation])
```

Without this the header keeps the `null` it had on first render, because the
resolve is async and `character` itself does not change when it lands.

- [ ] **Step 7: Run the test to verify it passes**

Run: `yarn test __tests__/talkScreenAvatarSource.test.tsx`

Expected: PASS, 6 tests. If only `'reinstalls the header when the resolved image
arrives after first render'` fails, Step 6's dependency array is wrong.

- [ ] **Step 8: Run the neighbouring Talk suites for regressions**

Run: `yarn test __tests__/talkScreenGrounding.test.tsx __tests__/talkScreenStatusLiveRegion.test.tsx`

Expected: PASS. Both stub `CharacterAvatar` to `() => null` and neither mocks
`~/hooks/useResolvedImage`. The real hook is safe under test — it returns `null`
synchronously when `imageId` is falsy and never touches the database, and these
fixtures have no `active_image_id`.

- [ ] **Step 9: Commit**

```bash
git add "app/(drawer)/(tabs)/talk/index.tsx" __tests__/talkScreenAvatarSource.test.tsx
git commit -m "fix(talk): render avatars from active_image_id, not the legacy column

Both the header and the body avatar read characters.avatar, which Phase
1 never writes. Header takes the thumb variant, the body avatar takes
master, and the resolved header uri joins the useLayoutEffect deps so
the header updates when the async resolve lands."
```

---

## Task 4: `AvatarPicker` refreshes the character machine

**Files:**
- Modify: `src/components/AvatarPicker.tsx`
- Test: `__tests__/avatarPicker.test.tsx`

- [ ] **Step 1: Make the existing machine mock assertable**

`__tests__/avatarPicker.test.tsx` already mocks `~/hooks/useMachines`, but with an inline `jest.fn()` that no test can reach. Replace this line:

```tsx
jest.mock('~/hooks/useMachines', () => ({ useCharacterMachine: () => ({ send: jest.fn() }) }))
```

with:

```tsx
const mockSend = jest.fn()
jest.mock('~/hooks/useMachines', () => ({ useCharacterMachine: () => ({ send: mockSend }) }))
```

Jest hoists `jest.mock` above `const` declarations, but the factory only reads
`mockSend` when the component calls the hook — by then the binding is
initialised. The `mock` name prefix is what exempts it from the out-of-scope
variable guard.

- [ ] **Step 2: Write the failing tests**

Append these two tests inside the existing `describe('AvatarPicker', ...)` block in `__tests__/avatarPicker.test.tsx`:

```tsx
  // Talk and Chat read active_image_id off the character machine's cached
  // array. Writing the pointer to SQLite without a LOAD leaves both screens
  // showing the previous image until an unrelated reload happens to fire.
  it('reloads the character machine after activating an image', async () => {
    mockGetImages.mockResolvedValue(rows)
    mockSetActive.mockResolvedValue(undefined)
    const tree = await renderPicker()
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })

    await act(async () => { await items[1].props.onPress() })

    expect(mockSend).toHaveBeenCalledWith({ type: 'LOAD' })
  })

  it('reloads the character machine after deleting the active image', async () => {
    mockGetImages.mockResolvedValue(rows)
    mockDeleteImage.mockResolvedValue(undefined)
    mockGetActive.mockResolvedValue({ id: 'img-1' })
    const tree = await renderPicker({ activeImageId: 'img-2' })
    const items = tree.root.findAllByProps({ testID: 'avatar-picker-item' }, { deep: false })

    // rows[0] is img-2, the active one — deleting it repoints the character.
    await act(async () => { await items[0].props.onLongPress() })

    expect(mockSend).toHaveBeenCalledWith({ type: 'LOAD' })
  })
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn test __tests__/avatarPicker.test.tsx -t "reloads the character machine"`

Expected: FAIL, 2 tests, each with `expect(jest.fn()).toHaveBeenCalledWith(...)` reporting "Number of calls: 0".

- [ ] **Step 4: Wire the machine into `AvatarPicker`**

In `src/components/AvatarPicker.tsx`, add this import after the existing `useImageGeneration` import:

```tsx
import { useCharacterMachine } from '~/hooks/useMachines'
```

Then inside the `AvatarPicker` component body, immediately after the `const [items, setItems] = useState<PickerItem[]>([])` line, add:

```tsx
  const characterService = useCharacterMachine()
```

- [ ] **Step 5: Send `LOAD` after both mutations**

In `handleActivate`, replace:

```tsx
      const userId = getCurrentUser()?.uid
      if (userId) void pushActiveImageId(characterId, userId)
      await refresh()
```

with:

```tsx
      const userId = getCurrentUser()?.uid
      if (userId) void pushActiveImageId(characterId, userId)
      // The machine's cached characters carry active_image_id, which Talk and
      // Chat now render from. Without this they keep the previous image.
      characterService.send({ type: 'LOAD' })
      await refresh()
```

In `performDelete`, replace:

```tsx
        void pushActiveImageId(characterId, userId, { allowClear: true })
      }
      await refresh()
```

with:

```tsx
        void pushActiveImageId(characterId, userId, { allowClear: true })
        characterService.send({ type: 'LOAD' })
      }
      await refresh()
```

The `LOAD` sits inside the `if (imageId === activeImageId)` branch on purpose:
deleting a non-active image does not change `active_image_id`, so no consumer of
the cached array is stale.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn test __tests__/avatarPicker.test.tsx`

Expected: PASS, all tests in the file.

- [ ] **Step 7: Commit**

```bash
git add src/components/AvatarPicker.tsx __tests__/avatarPicker.test.tsx
git commit -m "fix(avatar): reload the character machine after changing the active image

AvatarPicker wrote active_image_id to SQLite without notifying the
machine, unlike useImageGeneration and useAvatarUpload. Latent until
Talk and Chat started reading active_image_id off the cached array."
```

---

## Task 5: Full verification

**Files:** none modified.

- [ ] **Step 1: Run the whole test suite**

Run: `yarn test`

Expected: PASS. Pay particular attention to `characterCardAccessibility.test.tsx`,
`migrateAvatarsToImageStore.test.ts`, and `useAvatarUpload.test.tsx` — none should
have changed behaviour, and a failure there means something in Tasks 1–4 reached
further than intended.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors. A `Property 'showFallback' does not exist` error means Task 1
Step 5's grep missed a call site.

- [ ] **Step 3: Lint**

Run: `yarn lint`

Expected: no errors. The most likely finding is
`react-hooks/exhaustive-deps` on the two `useLayoutEffect` dependency arrays —
if it fires, the fix is to add the missing dependency it names, not to suppress
the rule.

- [ ] **Step 4: Confirm the migration was not touched**

Run: `git diff main --stat -- src/database/migrations/`

Expected: no output. The migration's bundled-default skip is correct and this
change must not alter it.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin fix/avatar-render-pipeline-divergence
gh pr create --base staging \
  --title "fix(avatar): render Talk and Chat from the Phase 1 image pipeline" \
  --body "$(cat <<'BODY'
Fixes two production avatar defects reported after the Phase 1 OTA.

**Talk and Chat showed a stale avatar.** Both read `characters.avatar`, a
column Phase 1 deliberately never writes. They now resolve
`active_image_id` through `useResolvedImage`, with the legacy URL kept as a
tail fallback for devices whose one-shot migration has not run.

**Avatar-less characters showed initials.** `CharacterAvatar` checked its
initials branch ahead of the bundled default, making that fallback
unreachable for any named character. Both the image-pipeline spec and
`characterMachine.ts` assume characters with no image row render the bundled
asset. Initials are gone; `showFallback` is gone with them.

`AvatarPicker` now sends `LOAD` after changing `active_image_id`, matching
`useImageGeneration` and `useAvatarUpload` — latent before this change,
a live bug once Talk and Chat read the cached array.

Render-layer only: no schema, migration, data, or type changes. Ships as an OTA.

Spec: `docs/superpowers/specs/2026-08-10-avatar-render-pipeline-divergence-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 6: On-device verification after the OTA**

Not automatable — run these on the reporting device once the OTA lands:

1. Characters not regenerated since the OTA show the bundled default avatar in the list, not initials.
2. The regenerated character shows the same image in the list, Edit, Chat header, Chat bubbles, Talk header, and Talk body.
3. Generating a new image updates Talk and Chat without leaving the screen.
4. Selecting a different image in the Avatar Picker updates Talk and Chat.

---

## Known scope boundary

ChatView's `renderAvatar` has its own initials fallback (`getInitials`) for
message bubbles, separate from `CharacterAvatar`. This plan leaves it alone: the
approved spec's §4.1 covers `CharacterAvatar` only, and §4.2 asks only that
bubbles read the new pipeline. The consequence is that after this change a
character with no image anywhere shows the bundled default in headers and
initials in bubbles. If that inconsistency is unwanted, it is a separate,
one-function change to `renderAvatar` and should be scoped deliberately rather
than folded in here.

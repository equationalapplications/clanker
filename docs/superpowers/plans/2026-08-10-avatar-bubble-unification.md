# Avatar Bubble Unification (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chat message bubbles render `CharacterAvatar` (bundled default) for avatar-less characters — closing the deliberate Phase 1 §6 inconsistency where the same character shows the bundled default in the Chat header but initials in the Chat message bubbles on the same screen.

**Architecture:** Render-layer only. `ChatView`'s `renderAvatar` callback splits its branches: the user branch keeps the existing `Avatar.Image` / `Avatar.Text` (initials are the right fallback for the user); the character branch delegates to `CharacterAvatar`, which already implements `imageUrl → bundled default`. `CharacterAvatar` gains `accessibilityRole="image"` on both its returns so the role the bubble already had is preserved without being passed in from the caller, and exports `DEFAULT_AVATAR` as a testing contract. No schema, migration, data, or type changes.

**Tech Stack:** React Native / Expo Router, react-native-paper 5.x (`Avatar.Image` / `Avatar.Text`), Jest + `react-test-renderer` (`create`/`act`) for the ChatView suite + `@testing-library/react-native` (`render`/`fireEvent`) for the new `CharacterAvatar` contract suite.

**Spec:** `docs/superpowers/specs/2026-08-10-avatar-bubble-unification-design.md`

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/components/CharacterAvatar.tsx` | Add `accessibilityRole="image"` to both `Avatar.Image` returns; export `DEFAULT_AVATAR`. |
| Modify | `__tests__/characterAvatarAccessibility.test.tsx` | Existing suite still passes (no changes required — see Task 1 step 5). |
| Create | `__tests__/characterAvatar.test.tsx` | New strict contract: bundled default on null/undefined, supplied uri contract, no-initials guard, `onError` fallback, retry on URL change, `accessibilityRole`. |
| Modify | `src/components/ChatView.tsx` | Rewrite `renderAvatar` (§2.1): branch on `isUser` and keep characters on `CharacterAvatar`. |
| Modify | `__tests__/chatViewAvatarSource.test.tsx` | Replace `bubbleAvatarUri` with `bubbleCharacterProps` + add `bubbleUserLabel`; update the two existing bubble tests; add three new tests for the character branch's bundled-default contract, the user branch's initials asymmetry, and the inline-closure forward guard. |

No migration changes. No schema changes.

**Run tests with `yarn test`, not bare `jest`.** The `test` script injects
`--require ./jest.preload.cjs` via `NODE_OPTIONS` to define `__DEV__` before
Jest's workers boot; running `jest` directly fails in module init.

---

## Task 1: `CharacterAvatar` is a role-bearing image with a verifiable contract

**Files:**
- Create: `__tests__/characterAvatar.test.tsx`
- Modify: `src/components/CharacterAvatar.tsx`

This is the foundational change — `DEFAULT_AVATAR` becomes a module export
and `accessibilityRole="image"` rides on both branches — and the new contract
test pins it.

- [ ] **Step 1: Write the failing contract test**

Create `__tests__/characterAvatar.test.tsx` with the full contents from
spec §2.5:

```tsx
import React from 'react'
import { render, fireEvent } from '@testing-library/react-native'

const capturedImageProps: any[] = []
const capturedTextProps: any[] = []

jest.mock('react-native-paper', () => {
  const React = require('react')
  return {
    Avatar: {
      Image: (props: any) => {
        capturedImageProps.push(props)
        return React.createElement('View', { testID: 'avatar-img', ...props })
      },
      Text: (props: any) => {
        capturedTextProps.push(props)
        return React.createElement('View', { testID: 'avatar-text', ...props })
      },
    },
  }
})

import CharacterAvatar, { DEFAULT_AVATAR } from '~/components/CharacterAvatar'

describe('CharacterAvatar bundled-default contract', () => {
  beforeEach(() => {
    capturedImageProps.length = 0
    capturedTextProps.length = 0
  })

  it('renders the bundled default when imageUrl is null', () => {
    render(<CharacterAvatar imageUrl={null} characterName="Test" />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedImageProps[0].source).toBe(DEFAULT_AVATAR)
  })

  it('renders the bundled default when imageUrl is undefined', () => {
    render(<CharacterAvatar />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedImageProps[0].source).toBe(DEFAULT_AVATAR)
  })

  it('renders the supplied uri when imageUrl is provided', () => {
    render(<CharacterAvatar imageUrl="https://example.com/test.png" characterName="Test" />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedImageProps[0].source).toEqual({ uri: 'https://example.com/test.png' })
  })

  // Guards the deliberate removal of the initials branch in phase 1 §4.1.
  // An avatar-less character with a name used to render initials above the
  // bundled default; the fallback chain must terminate at the bundled default.
  it('does not render initials when characterName is set but imageUrl is null', () => {
    render(<CharacterAvatar imageUrl={null} characterName="Test" />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedTextProps).toHaveLength(0)
  })

  // The erroredUrl branch (CharacterAvatar.tsx:39-43, 55-57). A dead remote
  // URL must degrade to the bundled default, not to a broken image box.
  it('falls back to the bundled default after the supplied uri fails to load', () => {
    const { getByTestId } = render(
      <CharacterAvatar imageUrl="https://example.com/dead.png" characterName="Test" />,
    )
    fireEvent(getByTestId('avatar-img'), 'error')
    expect(capturedImageProps[capturedImageProps.length - 1].source).toBe(DEFAULT_AVATAR)
    expect(capturedTextProps).toHaveLength(0)
  })

  // Derived-state reset: imageError is keyed to the URL that failed, so a new
  // URL must be attempted rather than inheriting the previous failure.
  it('retries when imageUrl changes after an error', () => {
    const { getByTestId, rerender } = render(
      <CharacterAvatar imageUrl="https://example.com/dead.png" characterName="Test" />,
    )
    fireEvent(getByTestId('avatar-img'), 'error')
    rerender(<CharacterAvatar imageUrl="https://example.com/fresh.png" characterName="Test" />)
    expect(capturedImageProps[capturedImageProps.length - 1].source).toEqual({
      uri: 'https://example.com/fresh.png',
    })
  })

  it('sets the image accessibility role on the bundled-default branch', () => {
    render(<CharacterAvatar characterName="Test" />)
    expect(capturedImageProps[0].accessibilityRole).toBe('image')
  })
})
```

- [ ] **Step 2: Run the test to verify pre-change failures**

Run: `yarn test __tests__/characterAvatar.test.tsx`

Expected: FAIL. Every test in the file errors at module-resolution
with a message about `DEFAULT_AVATAR` not being exported — for example,
`SyntaxError: The requested module '~/components/CharacterAvatar' does
not provide the export 'DEFAULT_AVATAR'`. That single gated import
fails the whole file before any test body runs.

Step 2's purpose is to confirm the contract file loads correctly.
If the error is a different module-resolution issue (e.g. cannot find
`~/components/CharacterAvatar`), fix the test path first; nothing in
this file is structural pre-change.

- [ ] **Step 3: Export `DEFAULT_AVATAR` and add `accessibilityRole="image"` to both returns**

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
 *
 * Exported as a testing contract, not for production use. The bundled-default
 * assertion in `__tests__/characterAvatar.test.tsx` compares `Avatar.Image`'s
 * `source` against this by identity; inlining it back into the component
 * breaks that suite. No production consumer reads it — that is intentional,
 * not dead code.
 */
export const DEFAULT_AVATAR = require('../../assets/default-avatar-1024.webp')

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
        accessibilityRole="image"
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
      accessibilityRole="image"
      accessibilityLabel="Character avatar"
    />
  )
}
```

Two lines change:
- The `const` becomes `export const`, and the JSDoc block gains the
  "testing contract" paragraph explaining why.
- Both `AvatarImage` returns gain `accessibilityRole="image"` next to
  `accessible`.

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `yarn test __tests__/characterAvatar.test.tsx`

Expected: PASS, 7 tests. The strict-identity `source === DEFAULT_AVATAR`
assertion holds because jest-expo's asset transform returns a stable
per-module value for the `require()` call.

- [ ] **Step 5: Run the existing accessibility suite for regression**

Run: `yarn test __tests__/characterAvatarAccessibility.test.tsx`

Expected: PASS. The existing suite uses `findByType('AvatarImage')` and
asserts on `accessible` / `accessibilityLabel` only; the new
`accessibilityRole="image"` is additive, not breaking.

- [ ] **Step 6: Commit**

```bash
git add src/components/CharacterAvatar.tsx __tests__/characterAvatar.test.tsx
git commit -m "feat(avatar): make CharacterAvatar image-role and lock its contract

CharacterAvatar already rendered AvatarImage with a label and
accessible=true, but without accessibilityRole='image', so TalkBack
and VoiceOver read it as text rather than announcing it as an image.
The same omission dropped the role from every phase 1 call site —
Talk header, Chat header, Talk body, CharacterCard — and would have
dropped it from the Chat message bubble in phase 2.

Bundle the role into the component itself rather than threading it
through every caller, then add a strict contract suite that pins the
bundled-default branch, the onError fallback, the URL-change retry,
and the no-initials guard. Export DEFAULT_AVATAR so the contract test
can compare source by identity rather than by marker string."
```

---

## Task 2: ChatView's `renderAvatar` delegates the character branch to `CharacterAvatar`

**Files:**
- Modify: `src/components/ChatView.tsx`
- Modify: `__tests__/chatViewAvatarSource.test.tsx`

This is the headline change — the character bubble stops rendering
`Avatar.Text`. The TDD cycle plays out as: replace the bubble helper,
update the two existing bubble tests to use it, add the three new tests
(some of which fail today), then rewrite the callback.

- [ ] **Step 1: Replace `bubbleAvatarUri` with `bubbleCharacterProps` and add `bubbleUserLabel`**

In `__tests__/chatViewAvatarSource.test.tsx`, find the helper block at
lines 213-225 (the comment starts with `/** The character-side avatar uri GiftedChat's renderAvatar would use. */`). Replace the existing helper:

```ts
/** The character-side avatar uri GiftedChat's renderAvatar would use. */
function bubbleAvatarUri(tree: any): string | null | undefined {
  const rendered = capturedGiftedChatProps.renderAvatar({
    currentMessage: { user: { _id: 'char-1' } },
  })
  // React 19 + react-test-renderer auto-unmount renderers created outside
  // act(), so the bubble subtree must be rendered inside act before we
  // touch `.root`.
  let holder: any
  act(() => { holder = create(rendered) })
  const img = holder.root.findAllByProps({ testID: 'avatar-img' }, { deep: false })[0]
  return img ? img.props.source.uri : null
}
```

with two helpers from spec §2.4 — note that neither takes a `tree`
argument, and `bubbleCharacterProps` clears the shared `capturedAvatarProps`
before mounting so it works even when a header test runs first:

```ts
/** Mount the character bubble and return the props CharacterAvatar received. */
function bubbleCharacterProps() {
  const rendered = capturedGiftedChatProps.renderAvatar({
    currentMessage: { user: { _id: 'char-1' } },
  })
  capturedAvatarProps.length = 0
  act(() => { create(rendered) })
  expect(capturedAvatarProps).toHaveLength(1)
  return capturedAvatarProps[0]
}

/** Mount the user bubble and return the Avatar.Text label, or null if absent. */
function bubbleUserLabel(): string | null {
  const rendered = capturedGiftedChatProps.renderAvatar({
    currentMessage: { user: { _id: 'user-1' } },
  })
  let holder: any
  act(() => { holder = create(rendered) })
  const txt = holder.root.findAllByProps({ testID: 'avatar-text' }, { deep: false })[0]
  return txt ? txt.props.label : null
}
```

- [ ] **Step 2: Update the two existing bubble tests to use `bubbleCharacterProps()`**

In `__tests__/chatViewAvatarSource.test.tsx`, replace the body of the
`'message bubbles prefer the resolved image over a stale legacy avatar URL'`
test (currently around line 261):

```tsx
  it('message bubbles prefer the resolved image over a stale legacy avatar URL', () => {
    mockResolved = 'file:///new.webp'
    const { tree } = renderChat(
      baseCharacter({ avatar: 'https://old.example/stale.png', active_image_id: 'img-1' }),
    )

    expect(bubbleAvatarUri(tree)).toBe('file:///new.webp')
  })
```

with:

```tsx
  it('message bubbles prefer the resolved image over a stale legacy avatar URL', () => {
    mockResolved = 'file:///new.webp'
    renderChat(baseCharacter({ avatar: 'https://old.example/stale.png', active_image_id: 'img-1' }))

    expect(bubbleCharacterProps().imageUrl).toBe('file:///new.webp')
  })
```

Replace the body of `'message bubbles fall back to the legacy avatar URL'`:

```tsx
  it('message bubbles fall back to the legacy avatar URL', () => {
    mockResolved = null
    const { tree } = renderChat(baseCharacter({ avatar: 'https://old.example/legacy.png' }))

    expect(bubbleAvatarUri(tree)).toBe('https://old.example/legacy.png')
  })
```

with:

```tsx
  it('message bubbles fall back to the legacy avatar URL', () => {
    mockResolved = null
    renderChat(baseCharacter({ avatar: 'https://old.example/legacy.png' }))

    expect(bubbleCharacterProps().imageUrl).toBe('https://old.example/legacy.png')
  })
```

The `const { tree }` destructuring is dropped — neither replacement uses
it. The semantic shift is from "extract the uri out of the rendered
`Avatar.Image`'s source prop" to "extract the `imageUrl` prop off the
captured `CharacterAvatar`", per §2.4.

- [ ] **Step 3: Add the three new bubble tests from spec §2.4**

Append these inside the existing `describe('ChatView avatar source', ...)`
block, immediately after the test `'message bubbles fall back to the
legacy avatar URL'`:

```tsx
  // The phase 2 change itself: an avatar-less character renders the bundled
  // default (via CharacterAvatar) in the bubble, not initials. Fails against
  // pre-phase-2 ChatView, which returns Avatar.Text here.
  it('character bubble renders CharacterAvatar, not initials, when there is no image', () => {
    mockResolved = null
    renderChat(baseCharacter({}))

    const rendered = capturedGiftedChatProps.renderAvatar({
      currentMessage: { user: { _id: 'char-1' } },
    })
    capturedAvatarProps.length = 0
    let holder: any
    act(() => { holder = create(rendered) })

    expect(capturedAvatarProps).toHaveLength(1)
    expect(capturedAvatarProps[0].imageUrl).toBeNull()
    expect(holder.root.findAllByProps({ testID: 'avatar-text' }, { deep: false })).toHaveLength(0)
  })

  // Locks in the deliberate asymmetry: the user keeps initials when
  // chatUser.avatar is null. The character branch runs the bundled-default
  // fallback instead.
  it('user bubble shows initials when user has no avatar', () => {
    mockResolved = null
    renderChat(baseCharacter({}))
    expect(bubbleUserLabel()).toBe('T')  // 'Test' → 'T'
  })

  // NOT a mirror of the header's dep-array bug — renderAvatar is an inline
  // closure with nothing to memoize, so this passes trivially today. It exists
  // to fail if renderAvatar is later wrapped in useCallback with characterAvatar
  // missing from the deps, which would freeze the bubble on the first resolve.
  it('bubble tracks a resolved image that arrives after first render', () => {
    mockResolved = null
    const result = renderChat(baseCharacter({ active_image_id: 'img-1' }))
    expect(bubbleCharacterProps().imageUrl).toBeNull()

    mockResolved = 'file:///late-thumb.webp'
    result.rerender()
    expect(bubbleCharacterProps().imageUrl).toBe('file:///late-thumb.webp')
  })
```

- [ ] **Step 4: Run the test file to verify the new test fails against pre-change `ChatView`**

Run: `yarn test __tests__/chatViewAvatarSource.test.tsx`

Expected: 2 distinct bubble failures.

- The existing test `'message bubbles prefer the resolved image over a
  stale legacy avatar URL'` fails with
  `expect(capturedAvatarProps).toHaveLength(1)` reporting length 0 —
  because the character branch still returns `Avatar.Image` whose
  mount does not push into `capturedAvatarProps`.
- The new test `'character bubble renders CharacterAvatar, not
  initials, when there is no image'` fails the same way at length 0.

The `'user bubble shows initials when user has no avatar'` test
**passes** today — it asserts the existing initials behavior for the
user branch. The `'bubble tracks a resolved image that arrives after
first render'` test also **passes** today — `renderAvatar` is an
inline closure that reads `characterAvatar` fresh each render.

If both new tests pass and both old tests fail, the test state is
correct for the TDD step. If `'user bubble ...'` fails, the `@xstate/react`
mock or `chatUser` shape doesn't match — resolve that first.

- [ ] **Step 5: Rewrite `renderAvatar` in `ChatView.tsx`**

In `src/components/ChatView.tsx`, find the `renderAvatar` callback
inside `<GiftedChat ...>` (currently lines 460-488). Replace it with the
spec §2.1 version:

```tsx
        renderAvatar={(props) => {
          const isUser = props.currentMessage?.user._id === currentUserId

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
        }}
```

Three things changed vs the current code:
- `isUser` is now an early-return inside an `if (isUser) { ... }` block.
  The character branch is the `return (<CharacterAvatar ... />)` at the
  bottom.
- The user branch's `userAvatarUri` is local; the `as string | null`
  cast on `characterAvatar` disappears entirely (the mock expects
  `CharacterAvatar`, not an `Avatar.Image`).
- `accessibilityLabel` and `initials` are computed only on the user
  path; the character path inherits `CharacterAvatar`'s own label
  (`"Nova avatar"` — a deliberate change, per §2.1).

`size={36}` is non-negotiable: dropping it would blow out the layout,
because `CharacterAvatar` defaults to `100` and GiftedChat's default
bubble avatar is `36x36`.

`characterAvatar` is the variable resolved in phase 1 at `ChatView.tsx:149-150`
as `resolvedAvatar ?? character.avatar ?? null`. `CharacterAvatar`
accepts `string | null | undefined` directly, so no cast is needed.

- [ ] **Step 6: Run the bubble test file to verify it passes**

Run: `yarn test __tests__/chatViewAvatarSource.test.tsx`

Expected: PASS, 9 tests (3 header + 5 bubble + 1 hook-call-count).

If `'user bubble shows initials when user has no avatar'` fails with
`'T'` not matching, the displayName mock or `getInitials` semantics
differ — `'Test' → 'T'` is correct; the mock `@xstate/react` block at
lines 116-119 sets `displayName: 'Test'`.

- [ ] **Step 7: Run the neighbouring ChatView suite for regressions**

Run: `yarn test __tests__/chatViewAccessibility.test.tsx`

Expected: PASS. That suite stubs `~/components/CharacterAvatar` to
`() => null` and never asserts on avatar sources, so the renderAvatar
rewrite is invisible to it. A failure here means the closing-brace
of `renderAvatar` is misplaced — re-check §2.1.

- [ ] **Step 8: Commit**

```bash
git add src/components/ChatView.tsx __tests__/chatViewAvatarSource.test.tsx
git commit -m "fix(chat): render character bubbles from CharacterAvatar

Phase 1 §6 deliberately left ChatView's renderAvatar for message
bubbles on Avatar.Text because the same callback also renders the
user's avatar, where initials are correct. That created an
inconsistency: a character with no active_image_id and no legacy
characters.avatar URL renders the bundled default in the Chat header
but initials in the Chat message bubbles for the same character on the
same screen.

Branch renderAvatar on isUser. The user branch keeps Avatar.Image /
Avatar.Text with initials as fallback. The character branch delegates
to CharacterAvatar, which already implements imageUrl → bundled
default. CharacterAvatar's accessibilityRole addition in the prior
commit covers the role the bubble had previously set itself.

The character bubble's accessibility label changes from
\"Nova's avatar\" to \"Nova avatar\" — deliberate, so a screen-reader
user hears the same label in the header and in the bubble."
```

---

## Task 3: Full verification

**Files:** none modified.

- [ ] **Step 1: Run the whole test suite**

Run: `yarn test`

Expected: PASS. Pay particular attention to
`characterAvatarAccessibility.test.tsx` (pre-change suite, should
still pass after Task 1), `chatViewAvatarSource.test.tsx` (9 tests
after Task 2), `characterAvatar.test.tsx` (7 tests, the new contract),
and `talkScreenAvatarSource.test.tsx` (Talk is unchanged in phase 2;
should be unaffected).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: no errors. The `DEFAULT_AVATAR` export and the new
`accessibilityRole="image"` prop are both typed correctly; a
`Cannot find name 'DEFAULT_AVATAR'` error means the export was
forgotten, and a `Property 'accessibilityRole' does not exist on type`
error means the cast was removed from the `AvatarImage` type alias.

- [ ] **Step 3: Lint**

Run: `yarn lint`

Expected: no errors. The most likely finding is a
`react-hooks/exhaustive-deps` lint on an existing `useLayoutEffect`
in `ChatView` — but phase 2 touched no `useLayoutEffect`, so this
should be a no-op. If `yarn lint` runs `tsc` under the hood, expect
the same green as Step 2.

- [ ] **Step 4: Confirm the migration was not touched**

Run: `git diff main --stat -- src/database/migrations/`

Expected: no output. The bundled-default skip in
`migrateAvatarsToImageStore` is correct and phase 2 must not alter it.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin fix/avatar-bubble-unification
gh pr create --base staging \
  --title "fix(avatar): render chat message bubbles from CharacterAvatar" \
  --body "$(cat <<'BODY'
Closes the deliberate Phase 1 §6 inconsistency between ChatView's
header and ChatView's message bubbles.

**What changed.** The character branch of `ChatView.renderAvatar`
now delegates to `CharacterAvatar`, which already implements the
`imageUrl → bundled default` fallback chain used by the Chat header,
the Talk header and body, and the character card. An avatar-less
character now shows the bundled default in message bubbles — matching
what the header on the same screen already shows — instead of
initials. The user branch is unchanged: `chatUser.avatar` when set,
initials otherwise. Initials remain the right fallback for the user,
where bundled defaults would be wrong.

`CharacterAvatar` now sets `accessibilityRole="image"` on both its
returns, restoring a role Phase 1 dropped from every call site.
`DEFAULT_AVATAR` is exported and a new contract test pins the bundled
default, the `onError` fallback, the URL-change retry, and the
no-initials guard.

**Behavior changes.**
1. An avatar-less character shows the bundled default in Chat message
   bubbles instead of initials.
2. The character bubble's accessibility label changes from
   `"Nova's avatar"` to `"Nova avatar"`, matching the header.
   `accessibilityRole="image"` is preserved.

Render-layer only: no schema, migration, data, or type changes.
Ships as an OTA.

Spec: `docs/superpowers/specs/2026-08-10-avatar-bubble-unification-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 6: On-device verification after the OTA**

Not automatable — run these on the reporting device once the OTA lands:

1. A character with no `active_image_id` and no legacy URL shows the
   bundled default in both the Chat header and message bubbles.
2. Selecting a different image in the Avatar Picker updates the
   bubble (Phase 1 §4.3 already wires the `LOAD` notification).
3. The user bubble still shows `chatUser.avatar` if set, or initials
   otherwise.
4. TalkBack/VoiceOver on a character bubble announces `"Nova avatar"`
   with an image role.

---

## Known scope boundary

Phase 2 does not touch:
- **`characters.avatar` column.** It remains the rollback net for the
  Phase 1 OTA. Dropping it is structurally off the table until Phase 1
  has been live for at least one full release cycle.
- **User avatar pipeline.** No restructuring of how the user's avatar
  is sourced or rendered. The user branch stays on `chatUser.avatar`
  and initials.
- **Memoizing `renderAvatar`.** It remains an inline closure. The
  Task 2 memoization test exists as a forward guard against a careless
  `useCallback(..., [/* characterAvatar omitted */])` wrap, not as a
  change to make.

# Avatar bubble unification — design (phase 2)

**Date:** 2026-08-10
**Status:** Implemented
**Follows:** `2026-08-10-avatar-render-pipeline-divergence-design.md` (Phase 1, shipped PR #589)

## 1. Problem

Phase 1 unified the Talk header, Chat header, Talk body, and `CharacterCard`
onto `CharacterAvatar`, so an avatar-less character renders the bundled
default in those sites. The Chat message bubbles were deliberately left alone
because the same `renderAvatar` callback renders the **user's** avatar, where
initials are the right fallback.

The deliberate exception in phase 1 §6 created an inconsistency: a character
with no `active_image_id` and no legacy `characters.avatar` URL renders the
**bundled default in the Chat header** but **initials in the Chat message
bubbles** for the same character in the same screen. Phase 2 closes this
inconsistency.

## 2. Design

### 2.1 Bubble path delegates to `CharacterAvatar`

The `renderAvatar` callback at `src/components/ChatView.tsx:460-488` already
branches on `isUser`. The character branch is rewritten to delegate the
fallback chain to `CharacterAvatar`; the user branch is unchanged.

`accessibilityLabel` and `initials` move **inside** the `isUser` branch. In the
pre-revision draft they were computed unconditionally, so every character
bubble paid for a `getInitials(characterName)` call whose result the character
branch no longer reads.

```ts
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

The `isUser` branch remains the right fallback for the user: `chatUser.avatar`
when set, otherwise initials. The character branch now runs the same
`imageUrl → bundled default` chain the header runs, so the two paths agree
for every character.

The `as string | null` cast on `characterAvatar` disappears with the merged
`avatarUri` local: `CharacterAvatar` accepts `string | null | undefined`
directly.

The `size={36}` constraint is non-negotiable. `CharacterAvatar` defaults to
`100`, and dropping the explicit size would blow out the ChatView layout.
GiftedChat's default bubble avatar is `36x36`.

The character bubble's accessibility label changes from `"Nova's avatar"` to
`CharacterAvatar`'s `"Nova avatar"`. This is a deliberate accepted change: the
bubble label now tracks the header label without an extra prop, and both
sites read identically to a screen reader user on the same screen.

### 2.2 `CharacterAvatar` gains `accessibilityRole="image"`

The character bubble currently sets `accessibilityRole="image"`
(`ChatView.tsx:472`). `CharacterAvatar` sets `accessible` and a label but no
role (`CharacterAvatar.tsx:58-59, 69-70`), so §2.1 as originally drafted would
have silently dropped the role from the bubble.

Rather than pass the role in from the bubble, add it to both `AvatarImage`
returns in `CharacterAvatar`. The role is correct at every call site — Talk
header, Chat header, Talk body, `CharacterCard` — all of which lost it in
phase 1 and none of which should be an unroled `accessible` view:

```tsx
<AvatarImage
  size={size}
  source={{ uri: imageUrl }}
  resizeMode="cover"
  onError={() => { setErroredUrl(imageUrl ?? null) }}
  accessible
  accessibilityRole="image"
  accessibilityLabel={characterName ? `${characterName} avatar` : 'Character avatar'}
/>
```

and identically on the bundled-default return.

### 2.3 Export `DEFAULT_AVATAR` as a testing contract

`src/components/CharacterAvatar.tsx` currently keeps `DEFAULT_AVATAR` as a
module-private `const`. The contract test (§2.5) compares against the constant
directly to verify the bundled-default branch, so the constant is exported:

```ts
/**
 * Exported as a testing contract, not for production use. The bundled-default
 * assertion in `__tests__/characterAvatar.test.tsx` compares `Avatar.Image`'s
 * `source` against this by identity; inlining it back into the component
 * breaks that suite. No production consumer reads it — that is intentional,
 * not dead code.
 */
export const DEFAULT_AVATAR = require('../../assets/default-avatar-1024.webp')
```

The `require()` call is hoisted to module scope and runs once at import
time, so exporting does not change the asset load path. jest-expo's asset
transform returns a stable per-module value, so `toBe` identity holds.

### 2.4 Test helper changes in `chatViewAvatarSource.test.tsx`

The existing `bubbleAvatarUri` helper (`__tests__/chatViewAvatarSource.test.tsx:214-225`)
reads `Avatar.Image` props. After §2.1 the character branch renders
`CharacterAvatar`, which the test mocks at lines 156-162 to capture props and
return `null`. The helper is replaced with two dedicated helpers.

`capturedAvatarProps` is shared with the header captures, so
`bubbleCharacterProps` clears it immediately before mounting rather than
indexing from the end — indexing worked only by the accident that no bubble
test calls `renderHeader()`, and would break silently the first time one did.
Neither helper takes the unused `tree` argument the pre-revision draft passed.

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

The existing bubble tests (lines 261-275) are updated to call
`bubbleCharacterProps` instead of `bubbleAvatarUri`. The character branch's
assertions change from `imageUrl` on the rendered `Avatar.Image` source to
`imageUrl` on the captured `CharacterAvatar` props — same semantic, different
mount path.

Note that after the swap those two tests assert the same `characterAvatar`
value (`ChatView.tsx:150`) the header tests already assert, so they become
near-duplicate coverage. They are kept because they pin the bubble to that
value rather than to some other source, but the bubble-specific value of the
suite now rests on the first new test below.

**New test 1 — the phase 2 deliverable.** Nothing in the pre-revision plan
asserted the actual behavior change: that the character bubble stops rendering
`Avatar.Text`. Every test in that draft passed against unchanged `ChatView`.
This is the one test that fails today:

```ts
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
```

**New test 2 — the user branch's asymmetry.**

```ts
// Locks in the deliberate asymmetry: the user keeps initials when
// chatUser.avatar is null. The character branch runs the bundled-default
// fallback instead.
it('user bubble shows initials when user has no avatar', () => {
  mockResolved = null
  renderChat(baseCharacter({}))
  expect(bubbleUserLabel()).toBe('T')  // 'Test' → 'T'
})
```

**New test 3 — forward guard on memoization.** The pre-revision draft
justified this as mirroring the header's late-resolve bug. That rationale was
wrong and is corrected here: the header break was a `useLayoutEffect`
dependency-array omission (`ChatView.tsx:188`), and `renderAvatar` is an
inline, non-memoized closure that reads `characterAvatar` fresh on every
render. The test cannot fail against any current shape of the code. It is kept
only as a cheap forward guard, and the comment says so:

```ts
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

The `currentUserId` in the test mock (`@xstate/react` at lines 116-119) is
`'user-1'`, so the user branch fires when `currentMessage.user._id === 'user-1'`.

### 2.5 New `CharacterAvatar` contract test

New file: `__tests__/characterAvatar.test.tsx`. This is the contract that
phase 1 §2.2 broke and the integration suites verify only by checking that
`imageUrl` is null upstream. The new suite asserts that null `imageUrl`
actually renders the bundled asset, and covers the `onError` fallback — the
only other real branch in the file, currently untested anywhere:

```ts
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

The bundled-default assertion (`source === DEFAULT_AVATAR`) is strictly
deterministic — if a future refactor accidentally swaps the bundled default
for a different local asset, the test fails. The `Avatar.Text` absence
assertion locks in the phase 1 §2.2 fix.

## 3. Testing

Full test plan:

- **`CharacterAvatar` contract** (new file, 7 cases): bundled default on null,
  bundled default on undefined, supplied uri, no-initials guard, `onError`
  fallback, retry on URL change, accessibility role.
- **`ChatView` character bubble**:
  - renders `CharacterAvatar` and no `Avatar.Text` with no image (**new — the
    only test in this plan that fails against pre-phase-2 `ChatView`**).
  - prefers resolved over stale legacy URL (existing, helper updated).
  - falls back to legacy URL when nothing resolves (existing, helper updated).
  - tracks an image resolved after first render (new, forward guard only).
- **`ChatView` user bubble**:
  - shows initials when user has no avatar (new).
- **Existing header and bubble tests** keep passing with updated helpers.

No changes to `talkScreenAvatarSource.test.tsx` — Talk's body and header are
already on `CharacterAvatar`, and the bubble path doesn't exist there. The
§2.2 accessibility role addition is additive and asserted in the new
`CharacterAvatar` suite, so no Talk-side assertion changes.

No new migration test. The migration is unchanged.

## 4. Not in scope

- **`characters.avatar` column stays.** The legacy column is the rollback net
  for the phase 1 OTA. Dropping it now removes the safe revert path for any
  device where the new pipeline misbehaves. Targeted for a future release once
  phase 1 has shipped for at least one full cycle.
- **User avatar pipeline.** No restructuring of how the user's avatar is
  sourced or rendered. The user branch still uses `chatUser.avatar` and
  initials; this is the right fallback for the user.
- **Memoizing `renderAvatar`.** It stays an inline closure. Wrapping it in
  `useCallback` is what §2.4's third test guards against doing carelessly, not
  something this phase does.
- **`useResolvedImage` mock fidelity.** The tests mock `useResolvedImage` to
  a synchronous return; the two-render test exercises the dep-array-style
  guard without depending on the hook's actual async implementation.
- **No migration change, no schema change, no data backfill.** Phase 1's
  scope is unchanged.

## 5. Risk and rollout

Render-layer only. The blast radius is the `renderAvatar` callback in
`ChatView.tsx`, the `accessibilityRole` and `DEFAULT_AVATAR` export in
`CharacterAvatar.tsx`, and the two test suites. No persisted state changes, so
a rollback is a plain revert with no data to unwind.

Two deliberate behavior changes:

1. An avatar-less character now shows the bundled default in message bubbles
   instead of initials. This is the documented phase 1 §6 inconsistency
   closing.
2. The character bubble's accessibility label changes from `"Nova's avatar"`
   to `"Nova avatar"`, matching the header. The `accessibilityRole="image"`
   the bubble already had is preserved by adding it to `CharacterAvatar`
   (§2.2), which also restores it to the four call sites that lost it in
   phase 1.

The new contract test file locks in the bundled-default contract on its own;
if a future refactor accidentally swaps the asset, the strict equality
against `DEFAULT_AVATAR` fails.

Verification after OTA, on the reporting device:

1. A character with no `active_image_id` and no legacy URL shows the bundled
   default in both the Chat header and message bubbles.
2. Selecting a different image in the Avatar Picker updates the bubble (phase
   1 §4.3 already wired the `LOAD` notification).
3. The user bubble still shows `chatUser.avatar` if set, or initials otherwise.
4. TalkBack/VoiceOver on a character bubble announces `"Nova avatar"` with an
   image role.

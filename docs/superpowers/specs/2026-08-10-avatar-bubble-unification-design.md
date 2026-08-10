# Avatar bubble unification — design (phase 2)

**Date:** 2026-08-10
**Status:** Designed
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

```ts
renderAvatar={(props) => {
  const isUser = props.currentMessage?.user._id === currentUserId
  const displayName = userDisplayName?.trim()
  const accessibilityLabel = isUser
    ? (displayName ? `${displayName}'s avatar` : 'Your avatar')
    : `${characterName}'s avatar`
  const initials = isUser ? getInitials(displayName) : getInitials(characterName)
  const userAvatarUri = chatUser.avatar as string | undefined

  if (isUser) {
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
        label={initials}
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

The `size={36}` constraint is non-negotiable. `CharacterAvatar` defaults to
`100`, and dropping the explicit size would blow out the ChatView layout.
GiftedChat's default bubble avatar is `36x36`.

`CharacterAvatar`'s `accessibilityLabel` is `${characterName} avatar` when
`characterName` is set, so the bubble's label tracks the header's label
without an extra prop. The character-bubble access label becomes
redundant but consistent.

### 2.2 Export `DEFAULT_AVATAR` for direct test comparison

`src/components/CharacterAvatar.tsx` currently keeps `DEFAULT_AVATAR` as a
module-private `const`. The new contract test (§2.4) compares against the
constant directly to verify the bundled-default branch, so the constant is
exported:

```ts
export const DEFAULT_AVATAR = require('../../assets/default-avatar-1024.webp')
```

No production consumer reads this export. It exists solely for the test.

The `require()` call is hoisted to module scope and runs once at import
time, so exporting does not change the asset load path.

### 2.3 Test helper changes in `chatViewAvatarSource.test.tsx`

The existing `bubbleAvatarUri` helper (`__tests__/chatViewAvatarSource.test.tsx:214-225`)
reads `Avatar.Image` props. After §2.1 the character branch renders
`CharacterAvatar`, which the test mocks at lines 156-162 to capture props and
return `null`. The helper is replaced with two dedicated helpers:

```ts
function bubbleCharacterProps(tree: any) {
  const rendered = capturedGiftedChatProps.renderAvatar({
    currentMessage: { user: { _id: 'char-1' } },
  })
  act(() => { create(rendered) })
  return capturedAvatarProps[capturedAvatarProps.length - 1]
}

function bubbleUserLabel(tree: any): string | null {
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

Two new tests pin down the contract:

```ts
// Mirrors the header guard. The character bubble is rendered via
// CharacterAvatar (unified in phase 2 §4.1), so the same async-resolve
// path that broke the header once applies here: render with null,
// flip mockResolved, rerender, verify the bubble carried the uri.
it('reinstalls the character bubble when the resolved image arrives after first render', () => {
  mockResolved = null
  const result = renderChat(baseCharacter({ active_image_id: 'img-1' }))
  expect(bubbleCharacterProps(result.tree).imageUrl).toBeNull()

  mockResolved = 'file:///late-thumb.webp'
  result.rerender()
  expect(bubbleCharacterProps(result.tree).imageUrl).toBe('file:///late-thumb.webp')
})

// Locks in the user branch's deliberate asymmetry: the user keeps
// initials when chatUser.avatar is null. The character branch runs
// the bundled-default fallback instead.
it('user bubble shows initials when user has no avatar', () => {
  mockResolved = null
  const { tree } = renderChat(baseCharacter({}))
  expect(bubbleUserLabel(tree)).toBe('T')  // 'Test' → 'T'
})
```

The `currentUserId` in the test mock (`@xstate/react` at lines 116-119) is
`'user-1'`, so the user branch fires when `currentMessage.user._id === 'user-1'`.

### 2.4 New `CharacterAvatar` contract test

New file: `__tests__/characterAvatar.test.tsx`. This is the contract that
phase 1 §2.2 broke and the integration suites verify only by checking that
`imageUrl` is null upstream. The new suite asserts that null `imageUrl`
actually renders the bundled asset:

```ts
import React from 'react'
import { render } from '@testing-library/react-native'

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
    render(<CharacterAvatar characterName="Test" />)
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
    render(<CharacterAvatar characterName="Test" />)
    expect(capturedImageProps).toHaveLength(1)
    expect(capturedTextProps).toHaveLength(0)
  })
})
```

The bundled-default assertion (`source === DEFAULT_AVATAR`) is strictly
deterministic — if a future refactor accidentally swaps the bundled default
for a different local asset, the test fails. The `Avatar.Text` absence
assertion locks in the phase 1 §2.2 fix.

## 3. Testing

Full test plan:

- **`CharacterAvatar` bundled-default contract** (new file, 4 cases).
- **`ChatView` character bubble**:
  - prefers resolved over stale legacy URL (existing, helper updated).
  - falls back to legacy URL when nothing resolves (existing, helper updated).
  - reinstalls when the resolved image arrives after first render (new).
- **`ChatView` user bubble**:
  - shows initials when user has no avatar (new).
- **Existing header and bubble tests** keep passing with updated helpers.

No changes to `talkScreenAvatarSource.test.tsx` — Talk's body and header are
already on `CharacterAvatar`, and the bubble path doesn't exist there.

No new migration test. The migration is unchanged.

## 4. Not in scope

- **`characters.avatar` column stays.** The legacy column is the rollback net
  for the phase 1 OTA. Dropping it now removes the safe revert path for any
  device where the new pipeline misbehaves. Targeted for a future release once
  phase 1 has shipped for at least one full cycle.
- **User avatar pipeline.** No restructuring of how the user's avatar is
  sourced or rendered. The user branch still uses `chatUser.avatar` and
  initials; this is the right fallback for the user.
- **`useResolvedImage` mock fidelity.** The tests mock `useResolvedImage` to
  a synchronous return; the two-render test exercises the dep-array-style
  guard without depending on the hook's actual async implementation.
- **No migration change, no schema change, no data backfill.** Phase 1's
  scope is unchanged.

## 5. Risk and rollout

Render-layer only. The blast radius is the `renderAvatar` callback in
`ChatView.tsx`, the `DEFAULT_AVATAR` export in `CharacterAvatar.tsx`, and
the two test suites. No persisted state changes, so a rollback is a plain
revert with no data to unwind.

The deliberate behavior change is that an avatar-less character now shows
the bundled default in message bubbles instead of initials. This is the
documented phase 1 §6 inconsistency closing.

The new contract test file locks in the bundled-default contract on its own;
if a future refactor accidentally swaps the asset, the strict equality
against `DEFAULT_AVATAR` fails.

Verification after OTA, on the reporting device:

1. A character with no `active_image_id` and no legacy URL shows the bundled
   default in both the Chat header and message bubbles.
2. Selecting a different image in the Avatar Picker updates the bubble (phase
   1 §4.3 already wired the `LOAD` notification).
3. The user bubble still shows `chatUser.avatar` if set, or initials otherwise.

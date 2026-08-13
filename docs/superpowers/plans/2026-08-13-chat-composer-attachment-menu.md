# Chat Composer Attachment Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate photo/document attachment behind a single plus button that opens a `react-native-paper` `Menu` (Take photo / Choose from library / Add document) on all platforms, fixing the missing web camera affordance and wiring up the currently-dead `pickFromLibrary()`.

**Architecture:** One component change in `ChatComposer.tsx` (replace the plus + standalone-camera two-button row with a `Menu` anchored on the plus button), preceded by a test-suite rework that encodes the new menu contract. No hook, pipeline, persistence, or wire-format changes. Rollback is a single-PR revert.

**Source spec:** `docs/superpowers/specs/2026-08-13-chat-composer-attachment-menu-design.md`. Where this plan and the spec disagree, the spec wins.

**Tech Stack:** React Native 0.86 / Expo SDK 57, TypeScript, `react-native-paper@^5.15.3` (`Menu`), Jest + `@testing-library/react-native` + `react-test-renderer`.

**Repo facts that drive plan shape (verified 2026-08-13):**

- **No semicolons.** Every line in `src/` and `__tests__/` ends without one. Match the exact text in every edit.
- **The plus button is pressed directly by 29 tests (33 press lines).** The spec says "all other existing composer tests must stay green untouched" — that holds for _assertions and coverage_, but the press sites themselves must change, because the plus button now opens a menu instead of launching the document picker. The press lines come in four shapes (all native/web twins unless noted):
  - **Shape A — 25 identical sites:** `await act(async () => { await plusButton.props.onPress() })` (lines ≈533, 578, 626, 676, 725, 771, 807, 856, 917, 961, 998, 1035, 1073, 1110, 1146, 1180, 1356, 1418, 1463, 1500, 1537, 1575, 1612, 1648, 1682).
  - **Shape B — 2 sites (superseded-request tests, ≈1216 and ≈1718):** double press inside one `act`.
  - **Shape C — 2 sites (unmount-mid-flight tests, ≈1259 and ≈1760):** `pressPromise = plusButton.props.onPress()` then unmount.
  - **Shape D — 2 sites (spinner-during-phase tests, ≈1301 and ≈1802):** `void plusButton.props.onPress()` then assert the spinner replaced the button.
    All four are converted mechanically in Task 2 via two shared helpers; no assertion text changes.
- **Four RNTL-style tests** press `getByLabelText('Attach a photo or document')` (≈1840, ≈1869, ≈1897, ≈1941) and need a follow-up press on the "Add document" item; the camera tests (≈1937–2068) press `getByLabelText('Take a photo')`, a label that ceases to exist (new item title: `Take photo`).
- **No test asserts the composer's `accessibilityHint`**, no test consumes the `__cameraButtonMock` tag (only the mock factory defines it), and `chatComposerWebHeightLoop.test.tsx` / `chatView*` tests never touch the composer buttons — the hint update and camera-button removal are unconstrained.
- **`Menu` is already proven in this app:** `app/(drawer)/(tabs)/characters/list.tsx:221-241` and `src/components/admin/UserActionPanel.tsx:103-142` render `Menu`s through the root `PaperProvider` (`ThemeProvider` in `app/_layout.tsx`). `ChatView` is rendered directly by plain route pages (`app/(drawer)/(tabs)/chat/[id].tsx`, `chat/index.tsx`) with no `Modal` ancestor — the spec's "confirm no Portal-clipping context" check passes on paper; keep the manual sanity check in Task 6.
- **Known full-suite baseline failures (pre-existing on clean staging):** `__tests__/useAIChat.test.tsx` "persists the user message before cloud or edge work begins" and `__tests__/avatarPicker.test.tsx` "lists every live image newest first" (only under full parallel load). Do not attribute these to this work; anything else failing is a regression.
- **`gh pr create` is denied by local permission rules in this environment** — the owner opens the PR; Task 7 prepares everything else.

**Commands:**

- Focused tests: `npm test -- chatComposer` (runs `chatComposer.test.tsx` + `chatComposerWebHeightLoop.test.tsx`)
- Full suite: `npm test`
- Type check: `npm run typecheck`
- Lint gate: `npm run lint:check`

All paths are relative to the repo root `/Users/equationalapplications/code/src/github.com/equationalapplications/clanker`.

---

## File Structure

| Path                                      | Action | Responsibility                                                                 |
| ----------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `src/components/ChatComposer.tsx`         | Modify | Replace two-button attachment row with one `Menu`; wire `pickFromLibrary`      |
| `__tests__/chatComposer.test.tsx`         | Modify | `Menu`/`Menu.Item` mocks, `mockPickFromLibrary`, rework press sites, new tests |
| `docs/superpowers/specs/2026-08-13-…​.md` | Commit | The design spec (currently untracked)                                          |
| `docs/superpowers/plans/2026-08-13-…​.md` | Commit | This plan                                                                      |

**Untouched (per spec):** `src/hooks/useChatPhotoUpload.ts`, `ingestDocument`, MIME resolution, the `pendingImageAsset` dialog, the `Snackbar`, `ChatView`, `MessageList`, `ChatInputBar`, `chatComposerWebHeightLoop.test.tsx`.

---

## Task 0: Branch, docs commit, baseline

**Files:**

- Commit (currently untracked): `docs/superpowers/specs/2026-08-13-chat-composer-attachment-menu-design.md`
- Commit: `docs/superpowers/plans/2026-08-13-chat-composer-attachment-menu.md`

- [ ] **Step 1: Create the feature branch from `staging`**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker
git status --short
git switch -c feat/chat-composer-attachment-menu
```

Expected: on `staging`, the only untracked paths are the two docs files above (nothing else dirty).

- [ ] **Step 2: Commit spec + plan**

```bash
git add docs/superpowers/specs/2026-08-13-chat-composer-attachment-menu-design.md \
        docs/superpowers/plans/2026-08-13-chat-composer-attachment-menu.md
git commit -m "docs(chat): add attachment menu design spec and implementation plan"
```

- [ ] **Step 3: Capture the baseline**

```bash
npm test -- chatComposer 2>&1 | tail -8
```

Expected: all tests pass — `chatComposer.test.tsx` has **51** tests, plus the web-height-loop file. Record the exact totals; every later run must match or exceed them (Task 3 adds 6 new tests).

---

## Task 1: Test mock infrastructure (stays green)

Extend the test doubles so later tasks can express the menu contract. Nothing consumes the new mocks yet, so the suite stays green and this commits independently.

**Files:**

- Modify: `__tests__/chatComposer.test.tsx`

- [ ] **Step 1: Add `mockPickFromLibrary` to the `useChatPhotoUpload` mock**

Replace (≈ lines 58–70):

```ts
const mockCaptureFromCamera = jest.fn()
const mockPrepareFromAsset = jest.fn()
jest.mock('~/hooks/useChatPhotoUpload', () => ({
  useChatPhotoUpload: () => ({
    prepareFromAsset: (...args: unknown[]) => mockPrepareFromAsset(...args),
    pickFromLibrary: jest.fn(),
    captureFromCamera: (...args: unknown[]) => mockCaptureFromCamera(...args),
    isPreparing: false,
    error: null,
    clearError: jest.fn(),
  }),
}))
```

with:

```ts
const mockCaptureFromCamera = jest.fn()
const mockPickFromLibrary = jest.fn()
const mockPrepareFromAsset = jest.fn()
jest.mock('~/hooks/useChatPhotoUpload', () => ({
  useChatPhotoUpload: () => ({
    prepareFromAsset: (...args: unknown[]) => mockPrepareFromAsset(...args),
    pickFromLibrary: (...args: unknown[]) => mockPickFromLibrary(...args),
    captureFromCamera: (...args: unknown[]) => mockCaptureFromCamera(...args),
    isPreparing: false,
    error: null,
    clearError: jest.fn(),
  }),
}))
```

(`pickFromLibrary` was an anonymous `jest.fn()` because nothing consumed it; the named mock lets tests assert and script it, mirroring `mockCaptureFromCamera`.)

- [ ] **Step 2: Drop the camera tagging from the `IconButton` mock**

Inside the `jest.mock('react-native-paper', ...)` factory, replace the `IconButton` entry:

```ts
    IconButton: (props: any) => {
      // Tag the plus and camera buttons separately so the existing plus-only
      // assertions still match exactly one node after Task 15 added a camera.
      const tag =
        props.icon === 'camera'
          ? { __cameraButtonMock: true }
          : props.icon === 'plus'
            ? { __iconButtonMock: true }
            : {}
      // Same reason as the Button mock: a View ignores `disabled`, so without
      // this a disabled camera would still fire its handler under test. No-op
      // rather than `undefined` so RNTL does not climb to an ancestor handler.
      return React.createElement(View, {
        ...tag,
        ...props,
        onPress: props.disabled ? () => {} : props.onPress,
        accessibilityState: { disabled: !!props.disabled },
      })
    },
```

with:

```ts
    IconButton: (props: any) => {
      // Tag the plus button so tests can find the attachment-menu anchor.
      const tag = props.icon === 'plus' ? { __iconButtonMock: true } : {}
      // Same reason as the Button mock: a View ignores `disabled`, so without
      // this a disabled button would still fire its handler under test. No-op
      // rather than `undefined` so RNTL does not climb to an ancestor handler.
      return React.createElement(View, {
        ...tag,
        ...props,
        onPress: props.disabled ? () => {} : props.onPress,
        accessibilityState: { disabled: !!props.disabled },
      })
    },
```

(The standalone camera button disappears in Task 4; no test reads `__cameraButtonMock` — verified.)

- [ ] **Step 3: Add `Menu` and `Menu.Item` mocks to the same factory**

Insert after the `Dialog` entry (before `Text:`) in the `react-native-paper` mock object:

```ts
    Menu: Object.assign(
      // The anchor is always rendered; items exist only while `visible`.
      // Mirrors the real component closely enough for tests, the same way
      // `Portal: ({ children }) => children` does.
      ({ anchor, visible, children }: any) =>
        React.createElement(React.Fragment, null, anchor, visible ? children : null),
      {
        Item: ({ title, onPress, disabled }: any) =>
          // Honour `disabled` with a no-op rather than `undefined`, same
          // reason as the Button mock: RNTL climbs to an ancestor handler
          // when the pressed element has none.
          React.createElement(
            RNText,
            {
              __attachMenuItemMock: title,
              onPress: disabled ? () => {} : onPress,
              accessibilityLabel: title,
              accessibilityState: { disabled: !!disabled },
            },
            title,
          ),
      },
    ),
```

- [ ] **Step 4: Run the focused tests — must still be green**

```bash
npm test -- chatComposer 2>&1 | tail -8
```

Expected: same pass count as the Task 0 baseline (the new mocks are unused or behavior-compatible).

- [ ] **Step 5: Commit**

```bash
git add __tests__/chatComposer.test.tsx
git commit -m "test(chat): add Menu mocks and pickFromLibrary double for attachment menu"
```

---

## Task 2: Rework existing tests onto the menu flow (goes red)

Encode the new contract: every document pick now goes plus → menu → "Add document"; camera tests go plus → menu → "Take photo". These tests **fail after this task** and turn green in Task 4 — that is the TDD red state, not a mistake. Do not commit this task on its own.

**Files:**

- Modify: `__tests__/chatComposer.test.tsx`

- [ ] **Step 1: Add the two menu helpers**

Insert immediately after the top-level `beforeEach` inside `describe('ChatComposer', ...)` (after `jest.useRealTimers()` / `})`, ≈ line 176):

```ts
// Drive the attachment menu the way a user does: open it from the plus
// anchor, then act on an item. All document-ingest tests share this path —
// the behavior under test starts at DocumentPicker.
async function openAttachMenu(tree: ReturnType<typeof create>): Promise<any> {
  const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
  await act(async () => {
    plusButton.props.onPress()
  })
  return tree.root.find((n: any) => n.props?.__attachMenuItemMock === 'Add document')
}

async function pressPlusAndPickDocument(tree: ReturnType<typeof create>) {
  const addDocumentItem = await openAttachMenu(tree)
  await act(async () => {
    await addDocumentItem.props.onPress()
  })
}
```

Anchor for the edit:

```ts
    capturedSnackbarProps = null
    jest.useRealTimers()
  })
```

- [ ] **Step 2: Convert the 25 Shape A sites (uniform single press)**

Use a replace-all edit (`replace_all: true`) for this exact 4-line block — it occurs 25 times and nowhere else:

Old:

```ts
const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
await act(async () => {
  await plusButton.props.onPress()
})
```

New:

```ts
await pressPlusAndPickDocument(tree)
```

Verify:

```bash
grep -c "pressPlusAndPickDocument(tree)" __tests__/chatComposer.test.tsx   # → 25 (the definition line ends `tree:`, so it does not match)
grep -c "plusButton.props.onPress()" __tests__/chatComposer.test.tsx       # → 1 (inside the openAttachMenu helper only)
```

- [ ] **Step 3: Convert the 2 Shape B sites (superseded-request double press)**

Replace-all (`replace_all: true`) — occurs exactly twice (native ≈1216, web ≈1718):

Old:

```ts
const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
await act(async () => {
  const firstPress = plusButton.props.onPress()
  const secondPress = plusButton.props.onPress()
  await Promise.all([firstPress, secondPress])
})
```

New:

```ts
const addDocumentItem = await openAttachMenu(tree)
await act(async () => {
  const firstPress = addDocumentItem.props.onPress()
  const secondPress = addDocumentItem.props.onPress()
  await Promise.all([firstPress, secondPress])
})
```

(Same semantics as before: two synchronous presses of the same handler before any re-render, exercising the superseded-request guard.)

- [ ] **Step 4: Convert the 2 Shape C sites (unmount mid-flight)**

Replace-all (`replace_all: true`) — occurs exactly twice (native ≈1259, web ≈1760):

Old:

```ts
const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
let pressPromise!: Promise<void>
await act(async () => {
  pressPromise = plusButton.props.onPress()
  await new Promise((resolve) => setTimeout(resolve, 0))
})
```

New:

```ts
const addDocumentItem = await openAttachMenu(tree)
let pressPromise!: Promise<void>
await act(async () => {
  pressPromise = addDocumentItem.props.onPress()
  await new Promise((resolve) => setTimeout(resolve, 0))
})
```

- [ ] **Step 5: Convert the 2 Shape D sites (spinner while phase active)**

Replace-all (`replace_all: true`) — occurs exactly twice (native ≈1301, web ≈1802):

Old:

```ts
const plusButton = tree.root.find((n: any) => n.props?.__iconButtonMock === true)
await act(async () => {
  void plusButton.props.onPress()
  await new Promise((resolve) => setTimeout(resolve, 0))
})
```

New:

```ts
const addDocumentItem = await openAttachMenu(tree)
await act(async () => {
  void addDocumentItem.props.onPress()
  await new Promise((resolve) => setTimeout(resolve, 0))
})
```

(The trailing assertions in these tests — spinner visible, zero `__iconButtonMock` nodes — stay untouched and remain correct: the busy state replaces the whole menu anchor.)

Verify all shapes converted:

```bash
grep -c "plusButton.props.onPress()" __tests__/chatComposer.test.tsx              # → 1 (the helper only)
grep -c "openAttachMenu(tree)" __tests__/chatComposer.test.tsx                    # → 6 (B×2 + C×2 + D×2; the definition ends `tree:` so it does not match)
grep -c "__attachMenuItemMock === 'Add document'" __tests__/chatComposer.test.tsx # → 1 (inside the openAttachMenu helper)
```

- [ ] **Step 6: Rework the four RNTL image-pick/dialog tests**

In `describe('image pick: send vs memory (Task 15)', ...)`. **Do NOT use replace-all in this step** — the bare press line occurs four times; each edit below includes unique surrounding lines so it targets exactly one test. Do the sub-steps in order (6d consumes one occurrence that Step 7 would otherwise also match).

a) `'prompts send-vs-memory when the pick is an image'` (≈1840) — replace (the `Send in chat` expectation is the unique anchor):

```ts
fireEvent.press(getByLabelText('Attach a photo or document'))

expect(await findByText('Send in chat')).toBeTruthy()
```

with:

```ts
fireEvent.press(getByLabelText('Attach a photo or document'))
fireEvent.press(await findByText('Add document'))

expect(await findByText('Send in chat')).toBeTruthy()
```

b) `'does not prompt for a text document and still ingests it'` (≈1869) — replace (the `act` wrapper makes this block unique):

```ts
await act(async () => {
  fireEvent.press(getByLabelText('Attach a photo or document'))
})
```

with:

```ts
fireEvent.press(getByLabelText('Attach a photo or document'))
await act(async () => {
  fireEvent.press(getByText('Add document'))
})
```

and add `getByText` to this test's render destructure:

```ts
      const { getByLabelText, getByText, queryByText } = render(
```

c) `'offers no photo option when the character cannot use the cloud agent'` (≈1897) — replace (the following comment is the unique anchor):

```ts
fireEvent.press(getByLabelText('Attach a photo or document'))

// Never silently degraded to a text-only turn: the option is present and
```

with:

```ts
fireEvent.press(getByLabelText('Attach a photo or document'))
fireEvent.press(await findByText('Add document'))

// Never silently degraded to a text-only turn: the option is present and
```

(`findByText` is already destructured in this test.)

d) `'blocks photo entry while a turn is in flight, without blaming cloud sync'` (≈1911) — replace:

```ts
// Camera is a direct-to-chat entry point, so it must be inert while busy.
await act(async () => {
  fireEvent.press(getByLabelText('Take a photo'))
})
expect(mockCaptureFromCamera).not.toHaveBeenCalled()

fireEvent.press(getByLabelText('Attach a photo or document'))
fireEvent.press(await findByText('Send in chat'))
```

with:

```ts
// The menu's photo items are direct-to-chat entry points, so they must
// be inert while busy.
fireEvent.press(getByLabelText('Attach a photo or document'))
await act(async () => {
  fireEvent.press(getByLabelText('Take photo'))
  fireEvent.press(getByLabelText('Choose from library'))
})
expect(mockCaptureFromCamera).not.toHaveBeenCalled()
expect(mockPickFromLibrary).not.toHaveBeenCalled()

fireEvent.press(getByLabelText('Add document'))
fireEvent.press(await findByText('Send in chat'))
```

(The disabled items are no-ops, so the menu stays open through both presses; "Add document" is not gated by `isSending` and proceeds to the image dialog. Everything after this point in the test is untouched.)

- [ ] **Step 7: Rework the three camera-send tests**

In the same describe, the tests `'sends a captured photo straight to chat'`, `'keeps the typed caption when onSendPhoto rejects the photo turn'`, and `'clears the typed caption when onSendPhoto accepts the photo turn'` each contain (≈1983, ≈2024, ≈2060). The block occurs exactly **3** times at this point — the identical fourth occurrence in `'blocks photo entry…'` was already replaced in Step 6d, so replace-all is safe now:

```ts
await act(async () => {
  fireEvent.press(getByLabelText('Take a photo'))
})
```

Replace-all (`replace_all: true`) with:

```ts
fireEvent.press(getByLabelText('Attach a photo or document'))
await act(async () => {
  fireEvent.press(getByLabelText('Take photo'))
})
```

- [ ] **Step 8: Reset `mockPickFromLibrary` in the inner `beforeEach`**

Replace:

```ts
beforeEach(() => {
  mockCaptureFromCamera.mockReset()
  mockPrepareFromAsset.mockReset()
})
```

with:

```ts
beforeEach(() => {
  mockCaptureFromCamera.mockReset()
  mockPickFromLibrary.mockReset()
  mockPrepareFromAsset.mockReset()
})
```

- [ ] **Step 9: Run the focused tests — expect red, for the right reason**

```bash
npm test -- chatComposer 2>&1 | tail -25
```

Expected: every converted/reworked test fails with `No instances found` (the `openAttachMenu` item lookup) or `Unable to find an element with label: Take photo` — the component still renders the old two-button layout. The untouched tests (Enter-key, busy-spinner existence, height, dialog-only paths) still pass. **Do not commit.**

---

## Task 3: New coverage tests (still red)

**Files:**

- Modify: `__tests__/chatComposer.test.tsx`

- [ ] **Step 1: Add the `attachment menu` describe block**

Insert immediately before the file's final closing `})` (after the `image pick` describe closes, ≈ line 2067):

```ts
  describe('attachment menu', () => {
    beforeEach(() => {
      mockCaptureFromCamera.mockReset()
      mockPickFromLibrary.mockReset()
      mockPrepareFromAsset.mockReset()
    })

    it('opens the attachment menu with all three actions when photos are supported', () => {
      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText, queryByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          canSendPhoto
          onSendPhoto={jest.fn()}
        />,
      )

      // A closed menu exposes no actions.
      expect(queryByLabelText('Take photo')).toBeNull()
      expect(queryByLabelText('Choose from library')).toBeNull()
      expect(queryByLabelText('Add document')).toBeNull()

      fireEvent.press(getByLabelText('Attach a photo or document'))

      expect(getByLabelText('Take photo')).toBeTruthy()
      expect(getByLabelText('Choose from library')).toBeTruthy()
      expect(getByLabelText('Add document')).toBeTruthy()
    })

    it('sends a library photo straight to chat', async () => {
      mockPickFromLibrary.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///library.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(true)
      const { getByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Choose from library'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      expect(mockCaptureFromCamera).not.toHaveBeenCalled()
    })

    it('keeps the typed caption when a library photo send is rejected', async () => {
      mockPickFromLibrary.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///library.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(false)
      const onChangeText = jest.fn()
      const { getByLabelText } = render(
        <ChatComposer
          text="my caption"
          onChangeText={onChangeText}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Choose from library'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      expect(onChangeText).not.toHaveBeenCalled()
    })

    it('clears the typed caption when a library photo send succeeds', async () => {
      mockPickFromLibrary.mockResolvedValue({
        imageId: 'img-1',
        messageId: 'msg_1',
        uri: 'file:///library.jpg',
        width: 1200,
        height: 900,
        variants: {
          master: { base64: 'M', mimeType: 'image/jpeg' },
          thumb: { base64: 'T', mimeType: 'image/jpeg' },
        },
        attachment: { mimeType: 'image/jpeg', data: 'M' },
      })

      const ChatComposer = require('~/components/ChatComposer').default
      const onSendPhoto = jest.fn().mockResolvedValue(true)
      const onChangeText = jest.fn()
      const { getByLabelText } = render(
        <ChatComposer
          text="my caption"
          onChangeText={onChangeText}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          onSendPhoto={onSendPhoto}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))
      await act(async () => {
        fireEvent.press(getByLabelText('Choose from library'))
      })

      await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
      await waitFor(() => expect(onChangeText).toHaveBeenCalledWith(''))
    })

    it('hides the photo items when the character cannot use the cloud agent', () => {
      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText, queryByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          canSendPhoto={false}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))

      expect(queryByLabelText('Take photo')).toBeNull()
      expect(queryByLabelText('Choose from library')).toBeNull()
      expect(getByLabelText('Add document')).toBeTruthy()
    })

    it('disables the photo items while a reply is in flight but keeps Add document enabled', async () => {
      const ChatComposer = require('~/components/ChatComposer').default
      const { getByLabelText } = render(
        <ChatComposer
          text=""
          onChangeText={jest.fn()}
          onSubmit={jest.fn()}
          characterId="char-1"
          userId="user-1"
          canSendPhoto
          isSending
          onSendPhoto={jest.fn()}
        />,
      )

      fireEvent.press(getByLabelText('Attach a photo or document'))

      const takePhoto = getByLabelText('Take photo')
      const chooseFromLibrary = getByLabelText('Choose from library')
      expect(takePhoto.props.accessibilityState).toEqual({ disabled: true })
      expect(chooseFromLibrary.props.accessibilityState).toEqual({ disabled: true })
      expect(getByLabelText('Add document').props.accessibilityState).toEqual({ disabled: false })

      // Disabled must actually block the handlers, not merely look disabled.
      await act(async () => {
        fireEvent.press(takePhoto)
        fireEvent.press(chooseFromLibrary)
      })
      expect(mockCaptureFromCamera).not.toHaveBeenCalled()
      expect(mockPickFromLibrary).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run the focused tests — new tests fail too**

```bash
npm test -- chatComposer 2>&1 | grep -E "✕|✓|Tests:" | tail -15
```

Expected: the six new tests fail (no `Menu` in the component yet — labels like `Take photo` do not exist). **Do not commit.**

---

## Task 4: Implement the menu in `ChatComposer.tsx` (goes green)

**Files:**

- Modify: `src/components/ChatComposer.tsx`

- [ ] **Step 1: Add `Menu` to the paper import**

Replace (line 3):

```ts
import { Button, Dialog, IconButton, Portal, Snackbar, Text, useTheme } from 'react-native-paper'
```

with:

```ts
import {
  Button,
  Dialog,
  IconButton,
  Menu,
  Portal,
  Snackbar,
  Text,
  useTheme,
} from 'react-native-paper'
```

- [ ] **Step 2: Consume `pickFromLibrary` from the hook**

Replace (≈ lines 81–87):

```ts
const {
  prepareFromAsset,
  captureFromCamera,
  isPreparing,
  error: photoError,
  clearError: clearPhotoError,
} = useChatPhotoUpload()
```

with:

```ts
const {
  prepareFromAsset,
  captureFromCamera,
  pickFromLibrary,
  isPreparing,
  error: photoError,
  clearError: clearPhotoError,
} = useChatPhotoUpload()
```

- [ ] **Step 3: Add the menu visibility state**

Replace:

```ts
const [pendingImageAsset, setPendingImageAsset] = useState<{
  uri: string
  width: number
  height: number
  asset: DocumentPicker.DocumentPickerAsset
} | null>(null)
const lastSeenPhotoErrorRef = useRef<string | null>(null)
```

with:

```ts
const [pendingImageAsset, setPendingImageAsset] = useState<{
  uri: string
  width: number
  height: number
  asset: DocumentPicker.DocumentPickerAsset
} | null>(null)
const [attachMenuVisible, setAttachMenuVisible] = useState(false)
const lastSeenPhotoErrorRef = useRef<string | null>(null)
```

- [ ] **Step 4: Rename `handlePlusPress` to `handleDocumentPick` and close the menu first**

Replace:

```ts
  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return
```

with:

```ts
  const handleDocumentPick = useCallback(async () => {
    // Close first, then invoke: the picker hands control to the OS, and the
    // menu must not linger while the app is backgrounded.
    setAttachMenuVisible(false)
    if (!characterId || !userId) return
```

The rest of the callback body and its dependency array (`[characterId, userId, ingestDocument]`) stay exactly as they are.

- [ ] **Step 5: Add the photo handlers after `handleDocumentPick`**

Insert immediately after `handleDocumentPick`'s closing `}, [characterId, userId, ingestDocument])`:

```ts
// Only clear the typed caption when the photo turn actually launched — if
// sendPhoto rejects (network, credits, etc.) the user keeps their text and
// can retry without retyping. Same send shape the old camera button used.
const sendPhotoToChat = useCallback(
  async (photo: PendingChatPhoto) => {
    const sent = await onSendPhoto?.(photo, text)
    if (sent) onChangeText('')
  },
  [onSendPhoto, text, onChangeText],
)

const handleTakePhoto = useCallback(async () => {
  setAttachMenuVisible(false)
  const photo = await captureFromCamera()
  if (!photo) return
  await sendPhotoToChat(photo)
}, [captureFromCamera, sendPhotoToChat])

const handlePickFromLibrary = useCallback(async () => {
  setAttachMenuVisible(false)
  const photo = await pickFromLibrary()
  if (!photo) return
  await sendPhotoToChat(photo)
}, [pickFromLibrary, sendPhotoToChat])
```

(`PendingChatPhoto` is already imported: `import { useChatPhotoUpload, type PendingChatPhoto } from '~/hooks/useChatPhotoUpload'`.)

- [ ] **Step 6: Replace the attachment row — delete the camera button, anchor the `Menu` on the plus button**

Replace the entire block (≈ lines 325–364):

```tsx
<View style={styles.attachmentRow}>
  <IconButton
    icon="plus"
    size={20}
    onPress={handlePlusPress}
    style={styles.plusButton}
    accessibilityLabel="Attach a photo or document"
    accessibilityHint="Opens the picker to send a photo in chat or add a document to this character's memory"
  />
  {canSendPhoto && !isWeb && (
    // The camera capture path opens expo-image-picker's native
    // camera intent, which web cannot host. Suppress the button
    // on web — the picker IconButton above still offers "Send in
    // chat" via gallery selection.
    <IconButton
      icon="camera"
      size={20}
      disabled={isSending}
      onPress={async () => {
        const photo = await captureFromCamera()
        if (!photo) return
        // Only clear the typed caption when the photo turn
        // actually launched — if sendPhoto rejects (network,
        // credits, etc.) the user keeps their text and can
        // retry without retyping.
        const sent = await onSendPhoto?.(photo, text)
        if (sent) onChangeText('')
      }}
      style={styles.plusButton}
      accessibilityLabel="Take a photo"
      accessibilityHint="Opens the camera and sends the photo in chat"
    />
  )}
</View>
```

with:

```tsx
<View style={styles.attachmentRow}>
  <Menu
    visible={attachMenuVisible}
    onDismiss={() => setAttachMenuVisible(false)}
    anchor={
      <IconButton
        icon="plus"
        size={20}
        onPress={() => setAttachMenuVisible(true)}
        style={styles.plusButton}
        accessibilityLabel="Attach a photo or document"
        accessibilityHint="Opens the attachment menu to take a photo, choose one from the library, or add a document"
      />
    }
  >
    {canSendPhoto && (
      <>
        <Menu.Item
          leadingIcon="camera"
          title="Take photo"
          disabled={isSending}
          onPress={handleTakePhoto}
        />
        <Menu.Item
          leadingIcon="image"
          title="Choose from library"
          disabled={isSending}
          onPress={handlePickFromLibrary}
        />
      </>
    )}
    <Menu.Item
      leadingIcon="file-document-outline"
      title="Add document"
      onPress={handleDocumentPick}
    />
  </Menu>
</View>
```

Notes:

- Keep `const isWeb = Platform.OS === 'web'` — the `TextInput` handlers below still use it. Only the camera block's usage disappears.
- The busy branch (`isIngesting || isPreparing || phase !== null` → `ActivityIndicator`) above this block is untouched: it still replaces the whole menu anchor.
- No `isWeb` branching in the menu — web degradation lives inside `expo-image-picker` per the spec.

- [ ] **Step 7: Run the focused tests — everything green**

```bash
npm test -- chatComposer 2>&1 | tail -8
```

Expected: all pass — the previous 51 tests (reworked) + 6 new = **57** in `chatComposer.test.tsx`, plus the web-height-loop file green.

- [ ] **Step 8: Typecheck + lint**

```bash
npm run typecheck && npm run lint:check
```

Expected: both clean (`lint:check` is the CI gate, `--max-warnings 0`).

- [ ] **Step 9: Commit**

```bash
git add src/components/ChatComposer.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(chat): consolidate composer attachments behind one plus menu"
```

---

## Task 5: Full-suite gate

**Files:** none

- [ ] **Step 1: Run the entire root suite**

```bash
npm test 2>&1 | tail -15
```

Expected: green except the two **known pre-existing baseline failures** (`useAIChat.test.tsx` "persists the user message before cloud or edge work begins"; `avatarPicker.test.tsx` "lists every live image newest first", which only times out under full parallel load). Any other failure is a regression caused by this change — stop and diagnose before continuing.

---

## Task 6: Manual verification (device + web)

No code here — run the app and work the checklist. Record results in the PR description. The desktop-web "Take photo" and "Choose from library" resolving to the same file picker is a **deliberate, approved trade-off** — do not "fix" it.

- [ ] **Step 1: iOS dev build** — open a cloud-synced character's chat:
  - Plus button opens the menu; all three items visible; tapping outside dismisses it.
  - "Take photo" → permission prompt (if needed) → camera → photo sends to chat; caption clears only on success.
  - "Choose from library" → camera roll (not the Files app) → photo sends to chat.
  - "Add document" → Files picker → image picks still show the "Add this image" dialog; text/PDF ingest unchanged.
  - With a reply in flight: photo items disabled, "Add document" enabled; VoiceOver still announces the disabled items as disabled (not silently hidden).
  - Menu is not clipped by any modal/Portal context on the chat screen.
- [ ] **Step 2: Keyboard interaction (iOS and Android)** — with the keyboard up:
  - Opening the menu does not dismiss the keyboard; the typed caption survives opening and dismissing the menu.
  - The menu renders above the keyboard, anchored to the plus button. If it mispositions, adjust via `Menu` anchor/`statusBarHeight` props — do not reintroduce offset hacks.
  - Dismissing the keyboard while the menu is open leaves the menu anchored (no floating/detached menu).
- [ ] **Step 3: Android device** — repeat the Step 1 list; confirm TalkBack announces disabled items.
- [ ] **Step 4: Web** — `npx expo start --web` (localhost:8081), open a cloud-synced character's chat:
  - Menu opens with all three items (the old camera gap is gone).
  - "Take photo" opens a file picker on desktop without crashing; "Choose from library" opens a file picker; document flow unchanged.

---

## Task 7: Push and hand off the PR

`gh pr create` is denied by local permission rules in this environment — push the branch, then hand the owner the exact command.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/chat-composer-attachment-menu
```

- [ ] **Step 2: Give the owner the PR command (do not run it yourself)**

```bash
gh pr create --base staging --head feat/chat-composer-attachment-menu \
  --title "feat(chat): consolidate composer attachments behind one plus menu" \
  --body-file .github/pull_request_template.md --web
```

PR targets `staging` (flow: feature → `staging` → `main`). Fill the template's test section with the Task 6 manual results. Rollback if needed: single-PR revert — no dependency, schema, or persistence changes.

# Chat Composer — Unified Attachment Menu Design

**Date:** 2026-08-13
**Status:** Implemented (PR #612)
**Owner:** equationalapplications
**File affected:** `src/components/ChatComposer.tsx` (plus its test `__tests__/chatComposer.test.tsx`)
**Depends on:** [react-native-gifted-chat Removal](./2026-08-11-gifted-chat-removal-design.md) (this builds on the custom composer it introduced) and the [Vision / Chat Uploads](./2026-08-10-vision-chat-uploads-design.md) camera-permission work

## Problem

The composer exposes photo capture through **two separate entry points** with inconsistent platform behavior:

- The **plus button** (`handlePlusPress`, `ChatComposer.tsx:278-310`) opens `expo-document-picker`, and routes a picked image into the "Add this image" dialog (Send in chat / Add to memory) or a non-image into memory ingest.
- The **camera button** (`ChatComposer.tsx:340-363`), a standalone `IconButton` rendered only when `canSendPhoto && !isWeb`, captures a photo and sends it straight to chat.

Three concrete problems follow:

1. **No camera on web.** The camera button is gated behind `!isWeb`, so web chat has no capture affordance next to the plus button — reported directly during v31 web testing ("there is no camera button next to the plus button like on mobile"). The gate's comment claims "web cannot host" the camera, but that is stale: the installed `expo-image-picker` _does_ implement `launchCameraAsync` on web (a `<input type="file" capture="camera">`), so the suppression is no longer justified.
2. **No gallery access at all.** `useChatPhotoUpload` defines `pickFromLibrary()` (`launchImageLibraryAsync`), but nothing in the composer ever calls it — on iOS especially, the document picker opens the Files app, not the camera roll, so there is currently no way to pick an existing photo to send.
3. **Two buttons doing one job.** Photo attachment is split across two affordances with different gating, which is more surface to maintain than a single overflow menu.

## Goals

- Consolidate photo/document attachment behind a **single plus button** that opens a `react-native-paper` `Menu`.
- Offer three actions: **Take photo**, **Choose from library**, **Add document**.
- Show the menu on **all platforms including web**, fixing the missing-camera gap.
- Wire up the currently-dead `pickFromLibrary()` so the camera roll is reachable.
- Preserve all existing behavior: the document MIME/ingest flow, the image chat/memory dialog, camera-to-chat send, permission handling, busy states, accessibility.

## Non-Goals

- No real desktop-web webcam capture. Web "Take photo" uses the `capture` attribute, which opens the camera on mobile browsers but degrades to a file picker on desktop. A `getUserMedia`-based desktop capture component is explicitly out of scope (considered, deferred).
- No change to the photo/document pipeline: `useChatPhotoUpload`, `prepareImageVariants`, `ingestDocument`, the `pendingImageAsset` dialog, or any persistence/wire format.
- No change to `ChatView`, `MessageList`, or message rendering.

## Design

### End state

```text
ChatComposer attachment row (when not busy)
└── IconButton "plus"  ──opens──▶  react-native-paper Menu
                                      ├── Take photo           → captureFromCamera() → chat
                                      ├── Choose from library  → pickFromLibrary()   → chat
                                      └── Add document         → handleDocumentPick() → dialog/ingest
```

One button, one menu. The standalone camera `IconButton` is deleted.

### Menu component and state

Use `react-native-paper` `Menu`, following the established pattern in `app/(drawer)/(tabs)/characters/list.tsx:221-241` (the character-list overflow menu): the anchor is the triggering `IconButton` passed inline as the `anchor` prop, each `Menu.Item` closes the menu first and then invokes its handler, and open/close is plain `useState`.

- New local state: `const [attachMenuVisible, setAttachMenuVisible] = useState(false)`.
- `Menu` props: `visible={attachMenuVisible}`, `onDismiss={() => setAttachMenuVisible(false)}`, `anchor={<IconButton icon="plus" … onPress={() => setAttachMenuVisible(true)} />}`.
- The plus `IconButton` keeps `accessibilityLabel="Attach a photo or document"` and updates its `accessibilityHint` to describe opening the menu.

**Portal/Provider dependency — verified, already satisfied.** `react-native-paper`'s `Menu` renders through a `Portal`, which needs a `Provider` at the root. This is already in place: `ThemeProvider` wraps `PaperProvider` (`src/components/ThemeProvider.tsx:24`) and is mounted near the app root (`app/_layout.tsx:414`), and `characters/list.tsx` already renders a `Menu` successfully. The one thing to confirm during implementation is that the chat screen is not nested inside a modal or other context that clips the Portal.

**Unmount safety — the close-then-invoke order matters.** Selecting "Take photo" or "Choose from library" hands control to the OS camera/gallery and the app backgrounds. Because each `Menu.Item` calls `setAttachMenuVisible(false)` _before_ invoking the async picker, there is no lingering `setState` that fires after the composer may have unmounted or lost focus. Keep that order; do not move the close after the `await`.

### Menu items and their handlers

Each `Menu.Item` calls `setAttachMenuVisible(false)` first, then runs its action (same close-then-invoke order as `list.tsx`'s `handleMenuCloudSync`).

| Item                | `leadingIcon`           | Handler                                                                                          |
| ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| Take photo          | `camera`                | `captureFromCamera()` → on a non-null result, `onSendPhoto(photo, text)`, clear text on success. |
| Choose from library | `image`                 | `pickFromLibrary()` → on a non-null result, `onSendPhoto(photo, text)`, clear text on success.   |
| Add document        | `file-document-outline` | The current `handlePlusPress` body (DocumentPicker → image dialog or memory ingest).             |

The "Take photo" and "Choose from library" handlers reuse the exact send shape the camera button uses today (`ChatComposer.tsx:348-358`): only clear the typed caption when `onSendPhoto` resolves `true`, so a failed send keeps the user's text. "Add document" moves the existing `handlePlusPress` logic verbatim into a named handler; its image-vs-document branch and the `pendingImageAsset` dialog are untouched.

`pickFromLibrary` must be added to the `useChatPhotoUpload()` destructure at `ChatComposer.tsx:81-87` (it is defined in the hook but not currently consumed).

### Gating

- **Menu visibility:** the plus button renders under the same `showPlusButton` condition as today (`ChatComposer.tsx:312`).
- **Take photo / Choose from library:** rendered only when `canSendPhoto` (both send a photo to chat, which only cloud-synced characters support). When `canSendPhoto` is false they are hidden, matching today's hidden camera button. Both are `disabled` while `isSending` (a reply is in flight), matching the camera button's current `disabled={isSending}`.
- **Add document:** always rendered and not gated by `canSendPhoto` or `isSending` — memory ingest is independent of photo sending, same as today's ungated plus button.
- **Busy spinner:** unchanged. When `isIngesting || isPreparing || phase !== null` (`ChatComposer.tsx:332-338`) the whole attachment row still collapses to the existing `ActivityIndicator`, replacing the menu anchor. Each menu item closes the menu before its action starts, so the spinner and an open menu never coexist.

### Web behavior (the fix)

Removing the camera `IconButton` also removes its `!isWeb` guard. The menu and all three items render on web:

- **Take photo** → `captureFromCamera()` → `launchCameraAsync`, which on web opens `<input capture="camera">`: the actual camera on mobile browsers, a file picker on desktop. The hook's iOS-simulator guard (`Platform.OS === 'ios' && !Device.isDevice`) does not fire on web, and web permission requests resolve to granted, so the path runs cleanly.
- **Choose from library** → `pickFromLibrary()` → `launchImageLibraryAsync`, a plain file picker on web.
- **Add document** → unchanged document picker.

Desktop web therefore gets a working (if file-picker-backed) "Take photo" instead of nothing. No platform-specific branching is added to the composer; the graceful degradation lives entirely inside `expo-image-picker`.

**Expected desktop-web redundancy — accepted.** On desktop web both "Take photo" and "Choose from library" resolve to a file picker, so the two items behave identically there. This duplication is a deliberate, approved trade-off for keeping a single unified cross-platform menu with no `isWeb` branching; do not special-case desktop web to hide or merge the items.

### Accessibility

- Plus button retains its label; hint updated to mention the menu.
- `Menu.Item`s expose their titles as accessible labels ("Take photo", "Choose from library", "Add document"), consistent with how the overflow-menu spec restored full labels.
- **Disabled items must stay announced.** While `isSending` the photo items are `disabled`; confirm during manual testing that VoiceOver/TalkBack still announce them as disabled rather than hiding them from the accessibility tree entirely (behavior can vary by `react-native-paper` version). If a disabled `Menu.Item` turns out to be invisible to screen readers, surface the busy state another way (e.g. keep it focusable with a "busy" hint) rather than leaving a silent gap.

### Keyboard interaction

The composer sits just above the keyboard, so verify during manual testing that opening the menu plays nicely with it:

- Tapping the plus button must not dismiss the keyboard before the menu opens (the typed caption should survive opening and dismissing the menu).
- The menu must render above the keyboard, not clipped or hidden behind it. RNP `Menu` renders through the root `Portal`, but its anchor position is measured from the plus button, so confirm placement with the keyboard up on both iOS and Android.
- The chat screen already wraps in `react-native-keyboard-controller`'s `KeyboardAvoidingView`; if the menu mispositions with the keyboard up, adjust via the `Menu` anchor/`statusBarHeight` props rather than re-introducing offset hacks. This is a manual-verification item, not a code default.
- Conversely, if the keyboard is dismissed while the menu is open (e.g. swiping down on the list), the menu must stay anchored to the plus button — it should reposition with the composer or dismiss cleanly, not detach and float in mid-air as the keyboard slides out from under it. Usually a non-issue for a root-`Portal` menu, but worth a glance.

## Removed

- The standalone camera `IconButton` block (`ChatComposer.tsx:340-363`) and its `canSendPhoto && !isWeb` guard.
- The now-inaccurate comment claiming web cannot host the camera.

## Unchanged

- `useChatPhotoUpload` (`captureFromCamera`, `pickFromLibrary`, `prepareFromAsset`, permission and simulator handling, error surfacing).
- `ingestDocument`, MIME resolution, phase reporting, the `pendingImageAsset` "Add this image" dialog, the `Snackbar`.
- `ChatView` and everything upstream of the composer.

## Testing

`__tests__/chatComposer.test.tsx` mocks `react-native-paper` wholesale, so the spec for test changes is:

- **Add a `Menu` mock** to the existing factory: render `anchor` plus children (mirroring the existing `Portal: ({ children }) => children` and the `Dialog` mock), and a `Menu.Item` mock that renders a pressable honoring `disabled` and exposing `title` as its accessibility label.
- **Add `mockPickFromLibrary`** to the `useChatPhotoUpload` mock alongside `mockCaptureFromCamera`.
- **Rework the existing camera tests** (`chatComposer.test.tsx:1935-2060`, which press `getByLabelText('Take a photo')` directly) to open the menu first and then press the "Take photo" item; drop the `__cameraButtonMock` IconButton-tagging now that there is no standalone camera button.
- **New coverage:**
  - Pressing the plus button opens the menu with all three items when `canSendPhoto` is true.
  - "Take photo" invokes `captureFromCamera` and sends; "Choose from library" invokes `pickFromLibrary` and sends; both clear the caption only on a successful send.
  - "Add document" still drives the DocumentPicker ingest/dialog path.
  - Photo items are absent when `canSendPhoto` is false; "Add document" remains.
  - Photo items are disabled while `isSending`.
- All other existing composer tests (document ingest, MIME resolution, phase reporting, photo dialog, snackbar, web height) must stay green untouched.
- Manual pass on an iOS dev build, an Android device, and Expo web (`localhost:8081`):
  - Menu opens and each action behaves; web "Take photo" opens a picker without crashing.
  - Keyboard stays up when the menu opens and the menu renders above it (see [Keyboard interaction](#keyboard-interaction)).
  - Dismissing the keyboard while the menu is open leaves the menu anchored (no floating/detached menu).
  - The menu is not clipped by a modal/Portal context on the chat screen.
  - With a reply in flight (`isSending`), the photo items are disabled and still announced as disabled by VoiceOver/TalkBack.

## Rollback

Single-PR revert of `ChatComposer.tsx` and its test. No dependency, schema, or persistence changes, so reverting restores the two-button layout with no side effects.

## Related

- [react-native-gifted-chat Removal](./2026-08-11-gifted-chat-removal-design.md) — introduced the custom composer this changes
- [Vision / Chat Uploads](./2026-08-10-vision-chat-uploads-design.md) — the camera-capture feature being consolidated
- [Character List Header — Overflow Menu](./2026-07-09-character-list-header-overflow-menu-design.md) — the `react-native-paper` `Menu` pattern this reuses
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — PRs target `staging`, later promoted to `main`

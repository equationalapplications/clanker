# react-native-gifted-chat Removal Design

**Date:** 2026-08-11
**Status:** Approved, not implemented
**Owner:** equationalapplications
**Supersedes:** the fork-migration approach previously described in this document (see [Why not the fork](#why-not-the-fork))
**Depends on:** [Dependency Security and Major Upgrades](./2026-08-11-dependency-security-and-major-upgrades-design.md) Phase 3

## Problem

`react-native-gifted-chat` is formally deprecated on npm. Installing it prints:

> Maintenance mode - development moved to `@kesha-antonov/react-native-chat`

The app's single most important screen depends on a package that will not receive React Native compatibility fixes — a real constraint given the RN 0.86 upgrade just landed and further RN majors will follow.

## Why not the fork

This spec originally proposed migrating to `@kesha-antonov/react-native-chat@^4.3.0` as a like-for-like swap behind a type-indirection module. **That approach was investigated and rejected.** The fork is not an API-compatible successor; it is a rewrite that happens to share ancestry. Findings, from unpacking `4.3.0`:

| Finding | Consequence |
|---|---|
| `GiftedChat` is not exported. Zero occurrences in the shipped `lib/`. The main component is `Chat` (`export { ChatWrapper as Chat }`). | `ChatView.tsx` mounts a component that does not exist. |
| `ComposerProps` has no `onInputSizeChanged` and no `textInputStyle`. `composerHeight` is declared but ignored — the implementation destructures only `text, textInputProps, isMultiline, isTextOptional, onSend`. | Both composers are built entirely on that mechanism. Not portable. |
| Systematic prop renames on the root component: `alwaysShowSend`→`isSendButtonAlwaysVisible`, `renderAvatarOnTop`→`isAvatarOnTop`, `showUserAvatar`→`isUserAvatarVisible`. | `ChatView.tsx:481,486` uses the old names. |
| 14 peer dependencies, 8 absent from this project — including `react-native-vision-camera`, `@lodev09/react-native-true-sheet`, `react-native-audio-api`, `expo-video`, `expo-audio`, `@shopify/flash-list`, `react-native-streamdown`, `react-native-svg`. | New native modules ⇒ new dev-client/EAS build, app-size change, config plugins. FlashList replaces the list renderer wholesale, contradicting "no visual regression". |

`IMessage` itself *is* shape-compatible (`_id, text, createdAt, user, image, video, audio, system, sent, received, pending, quickReplies` all present), so the original spec's persisted-data hard stop does not trigger. The break is in the **component** API, which the original spec never inspected.

Since adopting the fork costs a chat-UI rewrite either way, the rewrite should produce components we own rather than a second dependency on an unstable API surface.

## Scope

21 files reference `react-native-gifted-chat`.

**Type-only consumers (14 files)** — each imports only `IMessage`:

`src/database/messageDatabase.ts` · `src/utilities/postNewMessage.ts` · `src/machines/liveVoiceMachine.ts` · `src/hooks/useLiveVoiceChat.ts` · `src/hooks/useEdgeAgent.ts` · `src/hooks/useMessages.ts` · `src/hooks/useAIChat.ts` · `src/services/CharacterPromptBuilder.ts` · `src/services/messageService.ts` · `src/services/liveMemoryQuery.ts` · `src/services/aiChatService.ts` · `src/components/ChatImageBubble.tsx` · `src/hooks/__tests__/useEdgeAgent.test.ts` · `src/services/__tests__/characterPromptBuilder.test.ts`

⚠️ **These are not uniform.** Six use *value* imports (`import { IMessage } from …`), not `import type`: `messageDatabase.ts:6`, `useAIChat.ts:2`, `useMessages.ts:12`, `aiChatService.ts:14`, `messageService.ts:6`, `postNewMessage.ts:1`. And **this repo uses no semicolons** — every import line ends without one. Any bulk edit must match the real text, not an idealised form.

**Mock-only references (4 files)** — module name appears only inside `jest.mock(...)`:

`__tests__/chatComposer.test.tsx` · `__tests__/chatComposerWebHeightLoop.test.tsx` · `__tests__/chatViewAccessibility.test.tsx` · `__tests__/chatViewAvatarSource.test.tsx`

**Runtime component imports (3 files)** — the real work:

| File | Imports |
|---|---|
| `src/components/ChatView.tsx` | `GiftedChat`, `Bubble`, `InputToolbar`, `Send`, `MessageText` + 6 types |
| `src/components/ChatComposer.tsx` | `Composer` + `ComposerProps`, `IMessage`, `SendProps` |
| `src/components/ChatComposer.web.tsx` | `Composer` + `ComposerProps`, `IMessage`, `SendProps` |

Non-code references in `README.md` and under `docs/superpowers/specs/` name the package legitimately and are **not** in scope. No "zero matches in the repo" check is valid.

## Goals

- Remove `react-native-gifted-chat` entirely; `npm ls react-native-gifted-chat` returns nothing, direct or transitive.
- Replace it with purpose-built components the project owns.
- Behavioral parity with today's chat screen. Visual near-parity is acceptable.
- Delete `src/components/ChatComposer.web.tsx`, whose existence is a gifted-chat workaround.
- No new runtime dependencies.

## Non-Goals

- Redesigning the chat UI. Behavioral parity is the bar.
- Changing message persistence, the SQLite schema, or any wire format.
- Surfacing the `error` / `edited` message flags. They exist on the type and render nothing today; they continue to render nothing. Surfacing them is a genuine improvement and belongs in a later spec.
- Adding pagination. `useMessages` loads the full conversation via `getMessages`; there is no `loadEarlier` wiring today and none is added.
- Changing Expo SDK 57 or React Native 0.86.

## Design

### End state

```
ChatScreen (KeyboardAvoidingView — react-native-keyboard-controller)
├── status banners / error region / LowPowerBanner   [unchanged, in ChatView]
├── MessageList          inverted FlatList over displayMessages
│   └── MessageRow       side = message.user._id === currentUserId
│       ├── Avatar       CharacterAvatar | Avatar.Image | Avatar.Text  [existing]
│       └── MessageBubble
│           ├── MessageText      text + linkifyUrls + web word-break
│           ├── ChatImageBubble  [existing, unchanged]
│           └── GroundingFooter  citation chips + GroundingHtml
└── ChatInputBar         attachment buttons + ChatComposer + SendButton
```

`ChatView` composes concrete components. There is deliberately **no render-prop layer** — `renderBubble` / `renderSend` / `renderAvatar` / `renderComposer` exist today only because gifted-chat demanded them, and a render-prop framework with exactly one call site is pure overhead.

**New:** `MessageList`, `MessageRow`, `MessageBubble`, `MessageText`, `GroundingFooter`, `ChatInputBar`, `SendButton`, `src/utils/linkifyUrls.ts`, `src/types/chat.ts`.

**Deleted:** `ChatComposer.web.tsx`, `react-native-gifted-chat` and its 8 transitive deps (`react-native-parsed-text`, `react-native-lightbox-v2`, `react-native-communications`, `react-native-iphone-x-helper`, `lodash.isequal`, `dayjs`, `@expo/react-native-action-sheet`, `@types/lodash.isequal`).

**Unchanged:** `ChatImageBubble`, `CharacterAvatar`, `GroundingHtml`, `LowPowerBanner`, `useAIChat`, `useMessages`, `messageService`, `messageDatabase`.

### The type we own

`src/types/chat.ts` defines our own interfaces — not re-exports:

```ts
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
  // DB columns
  pending?: boolean
  sent?: boolean
  error?: boolean
  edited?: boolean
  // carried in the message_data JSON blob
  imageId?: string
  groundingMetadata?: GroundingMetadata
}
```

`messageDatabase.ts:35` spreads a JSON blob (`...JSON.parse(msg.message_data)`) over every row, so `groundingMetadata` and `imageId` arrive as untyped extras, while `pending`/`sent`/`error`/`edited` are real columns.

Two deliberate narrowings from gifted-chat's `IMessage`:

- `_id: string`, not `string | number`. Every producer emits strings.
- `video`, `audio`, `system`, `quickReplies`, `received` dropped as unused.

Both are **designed to fail loudly** under typecheck in Slice 0 if wrong. A typecheck error is the verification, not a surprise. `GroundedIMessage` in `aiChatService` collapses into `Message`.

### Component contracts

**`MessageList`** — `{ messages: Message[]; currentUserId: string; renderAvatar: (m: Message) => ReactNode }`

Inverted `FlatList`, `keyExtractor={m => m._id}`, empty state. Retains `removeClippedSubviews: false` on native only — `ChatView.tsx:78` documents that native WebViews paint over sibling rows in inverted lists without it, and the grounding HTML is a WebView.

**`MessageRow`** — `{ message: Message; isOwn: boolean; renderAvatar: (m: Message) => ReactNode }`

Side selection and avatar-on-top positioning.

**`MessageBubble`** — `{ message: Message; isOwn: boolean }`

Themed via `useTheme()`: `colors.secondary`/`onSecondary` left, `colors.primary`/`onPrimary` right, `roundness`. Web keeps `maxWidth: '80%'; minWidth: 0; overflow: hidden`. Renders `MessageText`, then `ChatImageBubble` when `imageId` is set, then `GroundingFooter` when `groundingMetadata` is set — absorbing today's `renderMessageImage`, `renderCustomView`, and `isCustomViewBottom`.

**`MessageText`** — `{ text: string; color: string }`

Uses `linkifyUrls(text): Array<{ type: 'text' | 'url'; value: string }>`; renders one `<Text>` with nested `<Text onPress>` per URL. Preserves the web `wordBreak: 'break-word'; overflowWrap: 'anywhere'` fix. URL taps pass through the existing `isSafeHttpUrl` guard before `Linking.openURL` — the same guard the citation chips use. Email and phone matching are **not** carried over.

**`GroundingFooter`** — citation chips + `GroundingHtml`, lifted verbatim from `ChatView.renderCustomView`.

**`ChatComposer`** — unified, replaces both current variants:

```ts
{
  text: string
  onChangeText: (t: string) => void
  onSubmit: () => void
  textInputProps?: Partial<TextInputProps>
  onHeightChange?: (h: number) => void   // Slice 2 shim only; deleted in Slice 3
}
```

**This contract is what kills the height-loop bug.** Height is internal state derived from `onContentSizeChange` and clamped to `[MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT]`. There is deliberately **no `composerHeight` prop coming in**. The production crash (React error #185) existed because gifted-chat fed a height *down* while the browser fed a measurement *up*; with reporting strictly one-way, the cycle has nowhere to close. The `text === ''` collapse becomes a plain clamp rather than the effect-plus-ref dance both current files carry.

Everything else in today's `ChatComposer` — document ingest, MIME resolution, phase reporting, the photo dialog, camera capture, snackbar — moves across unchanged.

**`ChatInputBar`** — attachment buttons + `ChatComposer` + `SendButton`, carrying the surface/outline styling from today's `renderInputToolbar`. **Owns the `text` state.**

**`SendButton`** — `{ onPress; disabled; isGenerating }`. Spinner with `accessibilityRole="progressbar"` while generating, themed Send pill otherwise, `accessibilityLabel: 'Send message'`.

### Keyboard

`KeyboardAvoidingView` from `react-native-keyboard-controller` (already a direct dependency at 1.21.9) wraps list + input bar. This deletes `bottomOffset={-tabBarHeight}`, the `BottomTabBarHeightContext` import, and the negative-offset workaround at `ChatView.tsx:490-493`.

### A hack that dies

`ChatView.handleSend` filters empty-text messages because photo sends call `onSend({ text: '' })` purely to trigger gifted-chat's input reset (`ChatView.tsx:199-203`, twice more in `ChatComposer`). Once `ChatInputBar` owns the text state, photo send calls `setText('')` directly. The empty-message round-trip and its filter both disappear in Slice 2.

## Rollout — strangler, in four slices

Chat is the app's core screen and **there is no live staging environment**: `staging` has no deployed env, so a merge reaches production. A big-bang rewrite with no pre-prod soak is the one thing to avoid. Each slice is a separate PR to `staging`, independently revertable, and leaves a working app if the next never lands.

### Slice 0 — Own the type

Create `src/types/chat.ts`; repoint the 14 type-only consumers at `~/types/chat`. Zero behavior change. Accounts for the six value imports and the no-semicolon style.

*Verification:* `npm run typecheck` clean. All existing tests untouched and green.

### Slice 1 — Message rendering

Introduce `MessageBubble`, `MessageText`, `GroundingFooter`, `linkifyUrls`, rendered through gifted-chat's existing `renderBubble`. Absorbs `renderMessageImage`, `renderCustomView`, `isCustomViewBottom`. gifted-chat still owns the list, composer, keyboard, and avatars.

*Verification:* new unit tests for `linkifyUrls` (pure function — TDD it first), `MessageText` segmentation, `MessageBubble` side/theming, `GroundingFooter`. The four existing chat test files are unaffected: `chatViewAccessibility` stubs `Bubble` as `() => null`, so bubble internals are invisible to it.

### Slice 2 — Input bar

Introduce `ChatInputBar` + unified `ChatComposer` through `renderInputToolbar`. Delete `ChatComposer.web.tsx`.

⚠️ **Known carry-over:** gifted-chat still owns the list offset in this slice and derives it from its internal `composerHeight`. Slice 2 must therefore keep calling `props.onInputSizeChanged` as a temporary **one-way** shim — reporting height up, never reading one back down. One-way is what breaks the cycle, but the shim itself survives until Slice 3, so the height-loop risk is reduced here and only fully retired in Slice 3.

*Verification:* `chatComposer.test.tsx` — 44 of 49 tests pass with only the mock-factory key updated; the 5 keyboard/send tests stop mocking `Composer` and drive the real component. `chatComposerWebHeightLoop.test.tsx` — rewritten against the real `ChatComposer`: grows with text, clamps at MAX, collapses when emptied, and **terminates** under a hostile `onContentSizeChange`. Rewriting this file rather than deleting it is what licenses removing the `.web` variant — it proves the unification instead of assuming it.

### Slice 3 — Container

Our own `MessageList` + `KeyboardAvoidingView`. Absorbs `renderAvatar`. Deletes the Slice 2 shim, the `bottomOffset` hack, and `react-native-gifted-chat` from `package.json`.

*Verification:* `chatViewAccessibility.test.tsx` and `chatViewAvatarSource.test.tsx` — mock factories deleted, tests render the real `MessageList`. All 28 assertions survive verbatim; only the `capturedGiftedChatProps.renderAvatar(...)` driver becomes a direct query. Plus `npm ls react-native-gifted-chat` returns nothing.

## Data flow

Everything upstream of the view layer is untouched in every slice.

```
SQLite → getMessages → useMessages (React Query, 5s poll)
                            ↓
    useAIChat → { messages, streamingMessage, isGeneratingResponse,
                  activeTool, escalationState, error, canSendPhoto }
                            ↓
  displayMessages = streamingMessage ? [streamingMessage, ...messages] : messages
                            ↓
            MessageList (inverted: index 0 renders at bottom)
```

The single ownership change: composer `text` moves from gifted-chat's internal state to `ChatInputBar`. Send flows `ChatInputBar.onSubmit → ChatView.handleSend → sendMessage`, preserving the credits gate (`credits <= 0 → router.push('/subscribe')`). Photo flows `ChatComposer.onSendPhoto → ChatView.handleSendPhoto → sendPhoto`.

**Streaming requires a stable key.** `streamingMessage` re-renders on every token; with `keyExtractor={m => m._id}` its `_id` must be stable across those updates or the row remounts and the list jumps. Explicit invariant, covered by a test.

## Error handling

Preserved as-is: `chatError` in the assertive live region; failed sends flagged `error: true` by `useMessages`; `ChatImageBubble`'s resolved-vs-missing distinction; URL taps guarded by `isSafeHttpUrl`, failures logged rather than thrown.

## Testing

Capture the `npm test` baseline before Slice 0 and compare at every slice — the **delta** is the signal, not the absolute count.

Per-slice automated verification is listed with each slice above. In addition, because CI covers no rendering and merges reach production, **each slice carries a manual pass on an iOS/Android dev build and on Expo web** (`docker-compose.local.yml`, port 8081), scoped to what it changed:

- **Slice 1** — text bubble both sides; URL tap opens browser; photo bubble and full-screen viewer; grounding chips and search suggestions render and do not paint over neighbours while scrolling.
- **Slice 2** — composer grows to ~6 lines then scrolls internally; collapses on send; document ingest end-to-end; photo from picker and from camera; send ↔ spinner swap. **Web gets the closest look**, since that is where the loop crashed.
- **Slice 3** — keyboard does not cover the input above the tab bar; avatars correct on both sides; scrollback smooth on a long history; streaming reply does not jump the list.

## Rollback

Slices 0–2 leave `react-native-gifted-chat` installed, so each reverts as a single PR with no dependency churn. Only Slice 3 touches `package.json`. If Slice 3 misbehaves in production, reverting it restores a fully working gifted-chat-backed screen — the components from Slices 1–2 keep working, because they were built to render *inside* it.

## Related

- [2026-08-11 Dependency Security and Major Upgrades](./2026-08-11-dependency-security-and-major-upgrades-design.md) — Phase 3 lands first
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — PRs target `staging`, later promoted to `main`

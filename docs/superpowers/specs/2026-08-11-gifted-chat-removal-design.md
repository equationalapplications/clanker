# react-native-gifted-chat Removal Design

**Date:** 2026-08-11
**Status:** Implemented 2026-08-11 — revised 2026-08-11 after a review pass against the code (see [Revision notes](#revision-notes))
**Owner:** equationalapplications
**Implementation:** [2026-08-11-gifted-chat-removal.md](../plans/2026-08-11-gifted-chat-removal.md) was executed on branch `docs/gifted-chat-removal-spec`. 26 commits, shipped as a single PR to `staging`. `react-native-gifted-chat` and its 8 transitive deps are removed from `package.json`; `npm ls react-native-gifted-chat` returns empty. 1401/1401 tests pass; typecheck is clean.
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

One further reference is neither type nor value: `ChatComposer.tsx:52` cites a `node_modules/react-native-gifted-chat/lib/Composer.js` path in a comment explaining the padding workaround. It must not survive Slice 2 — the workaround it documents is deleted along with it.

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

**Unchanged:** `ChatImageBubble`, `CharacterAvatar`, `GroundingHtml`, `LowPowerBanner`, `useMessages`, `messageService`.

**Type-repointed, plus one small deletion each:** `messageDatabase` (loses the `received` line), `useAIChat` (loses the `image` sentinel in `sendPhoto`), `aiChatService` (loses the `GroundedIMessage` alias). No logic in any of the three changes.

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

`messageDatabase.ts:35` spreads a JSON blob (`...JSON.parse(msg.message_data)`) over every row, so `groundingMetadata` and `imageId` arrive as untyped extras, while `pending`/`sent`/`error`/`edited` are real columns. `toGiftedChatMessage` also returns `character_id` through an intersection (`IMessage & { character_id: string }`); that intersection is preserved verbatim as `Message & { character_id: string }` and `character_id` deliberately does **not** move onto `Message`, since only that one function produces it.

Two deliberate narrowings from gifted-chat's `IMessage`:

- `_id: string`, not `string | number`. Every producer emits strings.
- `video`, `audio`, `system`, `quickReplies` dropped as unused.

Both are **designed to fail loudly** under typecheck in Slice 0 if wrong. A typecheck error is the verification, not a surprise.

**`received` is a third narrowing and is *not* in that "fail loudly" category — it has a known producer, decided here rather than discovered during implementation.** `messageDatabase.ts:47` computes `received: !isUserMessage && msg.sent === 1` on every row read. Nothing consumes it: it existed to drive gifted-chat's delivery-tick rendering, which we do not reproduce (and which is already covered by the `error`/`edited` non-goal). It is derived at read time, not a stored column, so nothing persisted depends on it. Slice 0 therefore **omits `received` from `Message` and deletes the producing line**, in the same commit, rather than letting the typecheck surface it as a surprise.

**`GroundedIMessage` survives Slice 0 as an alias.** `aiChatService.ts:28` exports it and five files consume it — including `ChatView.tsx:25,223,357`, which is a runtime consumer that Slice 0 must not touch. Collapsing it immediately would pull `ChatView` into a slice defined as "the 14 type-only consumers, zero behavior change". So Slice 0 redefines it as `export type GroundedIMessage = Message` and leaves every call site alone; Slice 1 removes the alias and repoints `ChatView` and `liveVoiceMachine` as part of work already touching them.

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

### Who builds the outgoing message

gifted-chat does this today and it is easy to miss. `GiftedChat` stamps `_id` (through `messageIdGenerator`, `ChatView.tsx:485`), `createdAt`, and `user` (from its `user={chatUser}` prop) onto the outgoing message *before* invoking `onSend`. Downstream is unforgiving about it: `sendMessage(message: IMessage)` at `useAIChat.ts:459` takes a fully-formed message, and `runCloudAgentTurn` dedupes history on `String(msg._id)`.

Removing `GiftedChat` removes that stamping, so **Slice 3 makes `ChatView.handleSend` the constructor**. `ChatInputBar.onSubmit` reports text only; `handleSend` builds:

```ts
{
  _id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
  text,
  createdAt: new Date(),
  user: chatUser,
}
```

That `_id` expression is `messageIdGenerator`'s current body, moved rather than reinvented, so the id shape in SQLite does not change. `messageIdGenerator`, `minInputToolbarHeight`, and `minComposerHeight` are deleted with the `GiftedChat` element; `MIN_INPUT_HEIGHT` stays, since `ChatComposer` still clamps to it.

### Two hacks that die

**The empty-message round-trip.** `ChatView.handleSend` filters empty-text messages because photo sends call `onSend({ text: '' })` purely to trigger gifted-chat's input reset (`ChatView.tsx:199-203`, twice more in `ChatComposer`). Once `ChatInputBar` owns the text state, photo send calls `setText('')` directly. The empty-message round-trip and its filter both disappear in Slice 2.

**The `image` sentinel.** `sendPhoto` sets `image: photo.imageId` (`useAIChat.ts:501-504`) solely because gifted-chat's `Bubble` gates `renderMessageImage` on `image` being truthy; the comment there says exactly that, and the value is never dereferenced as a URI. `MessageBubble` gates on `imageId` instead, so the sentinel becomes dead the moment Slice 1 lands — and it is written into the `message_data` blob, so leaving it in keeps writing a meaningless field into new rows forever. **Slice 1 deletes it**, along with its comment and the `image` member of `sendPhoto`'s intersection type. Old rows that already carry `image` are harmless: nothing reads it, and it arrives as an untyped extra through the `message_data` spread. `Message` therefore has no `image` field.

## Rollout — strangler, in four slices

Chat is the app's core screen and **there is no live staging environment**: `staging` has no deployed env, so a merge reaches production. A big-bang rewrite with no pre-prod soak is the one thing to avoid. Each slice is a separate PR to `staging`, independently revertable, and leaves a working app if the next never lands.

### Slice 0 — Own the type

Create `src/types/chat.ts`; repoint the 14 type-only consumers at `~/types/chat`. Zero behavior change. Accounts for the six value imports and the no-semicolon style.

Two edits beyond the mechanical repointing, both argued in "The type we own" above: delete the `received` line at `messageDatabase.ts:47`, and redefine `GroundedIMessage` as `= Message` so `ChatView.tsx` stays untouched in this slice.

*Verification:* `npm run typecheck` clean. All existing tests untouched and green.

### Slice 1 — Message rendering

Introduce `MessageBubble`, `MessageText`, `GroundingFooter`, `linkifyUrls`, rendered through gifted-chat's existing `renderBubble`. Absorbs `renderMessageImage`, `renderCustomView`, `isCustomViewBottom`. Deletes the `image` sentinel in `sendPhoto` and the `GroundedIMessage` alias, repointing `ChatView` and `liveVoiceMachine` at `Message`. gifted-chat still owns the list, composer, keyboard, and avatars.

*Verification:* new unit tests for `linkifyUrls` (pure function — TDD it first), `MessageText` segmentation, `MessageBubble` side/theming, `GroundingFooter`, plus one asserting a photo message renders `ChatImageBubble` from `imageId` alone with no `image` field present. The four existing chat test files are unaffected: `chatViewAccessibility` stubs `Bubble` as `() => null`, so bubble internals are invisible to it.

### Slice 2 — Input bar

Introduce `ChatInputBar` + unified `ChatComposer` through `renderInputToolbar`. Delete `ChatComposer.web.tsx`.

⚠️ **Known carry-over:** gifted-chat still owns the list offset in this slice and derives it from its internal `composerHeight`. Slice 2 must therefore keep calling `props.onInputSizeChanged` as a temporary **one-way** shim — reporting height up, never reading one back down. One-way is what breaks the cycle, but the shim itself survives until Slice 3, so the height-loop risk is reduced here and only fully retired in Slice 3.

*Verification, `chatComposer.test.tsx` (49 tests):* the `jest.mock('react-native-gifted-chat')` factory is **deleted, not re-keyed** — after unification there is no inner `Composer` to substitute, because `ChatComposer` renders a plain `TextInput`. The 7 sites that query `tree.root.findByProps({ __chatComposerMock: true })` (lines 195, 221, 247, 271, 292, 309, 322) repoint at the real input. The remaining 42 tests — document ingest, MIME resolution, phase reporting, the photo dialog, camera capture, snackbar — are untouched, because none of that logic moves.

*Verification, `chatComposerWebHeightLoop.test.tsx`:* rewritten against the real `ChatComposer`: grows with text, clamps at MAX, collapses when emptied, and **terminates** under a hostile `onContentSizeChange`. Rewriting this file rather than deleting it is what licenses removing the `.web` variant — it proves the unification instead of assuming it. Note its header comment records that a platform-bare import resolves to the *native* module under jest's default haste platform; once there is one file, that caveat is obsolete and the comment goes.

⚠️ *Verification, `chatViewAccessibility.test.tsx` — this slice, not Slice 3.* Slice 2 deletes `renderSend`, `renderComposer`, `renderInputToolbar`, `minInputToolbarHeight`, and `alwaysShowSend`, and this file drives every one of them: `renderSend` at lines 279, 502, 523; `renderComposer` at 335, 353; the prop-shape assertions at 449–458 and 500. That is 8 of its 17 tests, and they fail here regardless of which slice claims the file. They are rewritten against `ChatInputBar` and `SendButton` directly — the send button's `accessibilityLabel: 'Send message'`, its `button` role, the `progressbar` role while generating, and the `primaryContainer` background are all preserved as assertions; only the `capturedGiftedChatProps.render*(...)` drivers become direct queries. The file's other 9 tests, and all of `chatViewAvatarSource.test.tsx`, stay on the gifted-chat mock until Slice 3.

### Slice 3 — Container

Our own `MessageList` + `KeyboardAvoidingView`. Absorbs `renderAvatar` and takes over building the outgoing message in `handleSend` (see "Who builds the outgoing message"). Deletes the Slice 2 shim, the `bottomOffset` hack, `messageIdGenerator`, and `react-native-gifted-chat` from `package.json`.

*Verification:* the remaining 9 tests in `chatViewAccessibility.test.tsx` and all 10 in `chatViewAvatarSource.test.tsx` — mock factories deleted, tests render the real `MessageList`. Their assertions survive verbatim; only the `capturedGiftedChatProps.renderAvatar(...)` driver (`chatViewAvatarSource.test.tsx:215,226,290`; `chatViewAccessibility.test.tsx:401,420`) becomes a direct query. Add one test pinning the streaming-key invariant: appending tokens to `streamingMessage` must not change its `_id`. Plus `npm ls react-native-gifted-chat` returns nothing.

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

Two ownership changes, both out of gifted-chat and into our own components:

1. Composer `text` moves from gifted-chat's internal state to `ChatInputBar` (Slice 2).
2. Outgoing-message construction moves from `GiftedChat`'s `onSend` stamping to `ChatView.handleSend` (Slice 3).

Send flows `ChatInputBar.onSubmit(text) → ChatView.handleSend → sendMessage`, with `handleSend` minting `_id`/`createdAt`/`user` and preserving the credits gate (`credits <= 0 → router.push('/subscribe')`). Photo flows `ChatComposer.onSendPhoto → ChatView.handleSendPhoto → sendPhoto`, unchanged apart from dropping the `image` sentinel.

**Streaming requires a stable key.** `streamingMessage` re-renders on every token; with `keyExtractor={m => m._id}` its `_id` must be stable across those updates or the row remounts and the list jumps. This holds today — `setStreamingMessage((prev) => ({ ...prev, text: ... }))` at `useAIChat.ts:147` carries `_id` forward — but nothing currently enforces it, because gifted-chat keyed the list. Slice 3 pins it with a test.

## Error handling

Preserved as-is: `chatError` in the assertive live region; failed sends flagged `error: true` by `useMessages`; `ChatImageBubble`'s resolved-vs-missing distinction; URL taps guarded by `isSafeHttpUrl`, failures logged rather than thrown.

## Testing

Capture the `npm test` baseline before Slice 0 and compare at every slice — the **delta** is the signal, not the absolute count.

Per-slice automated verification is listed with each slice above. In addition, because CI covers no rendering and merges reach production, **each slice carries a manual pass on an iOS/Android dev build and on Expo web** (`docker-compose.local.yml`, port 8081), scoped to what it changed:

- **Slice 1** — text bubble both sides; URL tap opens browser; photo bubble and full-screen viewer; grounding chips and search suggestions render and do not paint over neighbours while scrolling.
- **Slice 2** — composer grows to ~6 lines then scrolls internally; collapses on send; document ingest end-to-end; photo from picker and from camera; send ↔ spinner swap. **Web gets the closest look**, since that is where the loop crashed.
- **Slice 3** — keyboard does not cover the input above the tab bar; avatars correct on both sides; scrollback smooth on a long history; streaming reply does not jump the list. **And: send a message, force-quit, reopen.** `handleSend` now mints the `_id` that gifted-chat used to supply, so this is the one path where a mistake shows up as a message that renders fine and then vanishes — or duplicates against the cloud-agent history dedupe, which compares on `_id`.

## Rollback

Slices 0–2 leave `react-native-gifted-chat` installed, so each reverts as a single PR with no dependency churn. Only Slice 3 touches `package.json`. If Slice 3 misbehaves in production, reverting it restores a fully working gifted-chat-backed screen — the components from Slices 1–2 keep working, because they were built to render *inside* it.

## Revision notes

A review pass verified this document against the code. The file inventory, the six value imports, the no-semicolon warning, the `ChatView` line references, the `react-native-keyboard-controller` dependency, and the eight transitive deps (each confirmed gifted-chat-exclusive via `npm ls`) all held. Seven things did not, and are fixed above:

1. **Slice 2 broke a file the plan assigned to Slice 3.** 8 of `chatViewAccessibility.test.tsx`'s 17 tests drive `renderSend` / `renderComposer` / `renderInputToolbar` / `alwaysShowSend` — exactly what Slice 2 deletes. Now scoped to Slice 2.
2. **Nothing minted the outgoing message after Slice 3.** `GiftedChat` stamps `_id`/`createdAt`/`user` before `onSend`, and `sendMessage` requires them. `handleSend` now owns it.
3. **`received` was called unused; it has a producer** at `messageDatabase.ts:47`. Resolved by decision rather than left to a typecheck error.
4. **`GroundedIMessage`'s collapse reached `ChatView`**, contradicting Slice 0's "type-only, zero behavior change". Kept as an alias through Slice 0.
5. **The `image` sentinel is a second dying hack**, and it is written into `message_data`. Deleted in Slice 1.
6. **Two test counts were wrong.** "28 assertions" matched neither the test count (27) nor the `expect` count (62); "44 of 49 with the mock-factory key updated" mis-stated the mechanism — the factory is deleted, since no inner `Composer` remains.
7. **`ChatComposer.tsx:52`** cites a `node_modules/react-native-gifted-chat` path in a comment, outside the README/docs scope exemption.

## Related

- [2026-08-11 Dependency Security and Major Upgrades](./2026-08-11-dependency-security-and-major-upgrades-design.md) — Phase 3 lands first
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — PRs target `staging`, later promoted to `main`

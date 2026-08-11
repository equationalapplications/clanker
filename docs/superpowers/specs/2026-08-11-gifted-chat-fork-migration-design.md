# react-native-gifted-chat → Maintained Fork Migration Design

**Date:** 2026-08-11
**Status:** Approved, not implemented
**Owner:** equationalapplications
**Depends on:** [Dependency Security and Major Upgrades](./2026-08-11-dependency-security-and-major-upgrades-design.md) Phase 3

## Problem

`react-native-gifted-chat` is formally deprecated on npm. Installing it prints:

> Maintenance mode - development moved to `@kesha-antonov/react-native-chat`

| | Version | Last published |
|---|---|---|
| `react-native-gifted-chat` (current, `^2.8.1` declared; resolved 2.8.1 in lockfile) | 2.8.1 | 2026-06-19 |
| `@kesha-antonov/react-native-chat` (target) | 4.3.0 | 2026-08-06 |

The fork is MIT-licensed, actively maintained (published five days before this spec), and is the upstream author's own designated successor. Staying put means the app's single most important screen depends on a package that will not receive React Native compatibility fixes — a real constraint given the RN 0.86 upgrade just landed and further RN majors will follow.

## Why this is its own spec

The dependency spec deliberately excludes it. Chat is the app's core surface, and this is API-surface work rather than a version bump. Bundled into a dependency-churn PR, a chat regression would be difficult to isolate from a dozen unrelated upgrades. It ships alone, after Phase 3, so that a bisect lands on this change unambiguously.

## Scope — smaller than it appears

21 files reference `react-native-gifted-chat`, but the dependency is overwhelmingly type-only:

**Type-only imports (14 files)** — every one imports just `IMessage`:

`src/database/messageDatabase.ts` · `src/utilities/postNewMessage.ts` · `src/machines/liveVoiceMachine.ts` · `src/hooks/useLiveVoiceChat.ts` · `src/hooks/useEdgeAgent.ts` · `src/hooks/useMessages.ts` · `src/hooks/useAIChat.ts` · `src/services/CharacterPromptBuilder.ts` · `src/services/messageService.ts` · `src/services/liveMemoryQuery.ts` · `src/services/aiChatService.ts` · `src/components/ChatImageBubble.tsx` · `src/hooks/__tests__/useEdgeAgent.test.ts` · `src/services/__tests__/characterPromptBuilder.test.ts`

**Mock-only references (4 files)** — reference the module name only inside `jest.mock(...)`; no symbol is imported:

`__tests__/chatComposer.test.tsx` · `__tests__/chatComposerWebHeightLoop.test.tsx` · `__tests__/chatViewAccessibility.test.tsx` · `__tests__/chatViewAvatarSource.test.tsx`

**Runtime component imports (3 files)** — the actual migration surface:

| File | Imports |
|---|---|
| `src/components/ChatView.tsx` | `GiftedChat`, `Bubble`, `InputToolbar`, `Send`, `MessageText` + `IMessage`, `User`, `ComposerProps`, `SendProps`, `InputToolbarProps`, `MessageTextProps` |
| `src/components/ChatComposer.tsx` | `Composer` + `ComposerProps`, `IMessage`, `SendProps` |
| `src/components/ChatComposer.web.tsx` | `Composer` + `ComposerProps`, `IMessage`, `SendProps` |

So the risky work is confined to three components. The other 18 files are a mechanical import-path change — and this spec eliminates that category permanently rather than repeating it.

## Goals

- Replace `react-native-gifted-chat` with `@kesha-antonov/react-native-chat@^4.x`.
- Decouple the codebase from the chat library's identity, so a future migration touches a handful of files rather than 21.
- No visual or behavioral regression in chat, including image bubbles, the web composer, and live-voice message flow.
- Deprecation warning gone from `npm install` and `npm ls react-native-gifted-chat --all` returns no results (direct or transitive).

## Non-Goals

- Redesigning the chat UI. This is a like-for-like migration; visual changes are a separate concern.
- Changing the `IMessage` data shape, message persistence, or any wire format.
- Migrating away from the fork's `IMessage` model to a bespoke one. Tempting during this work, and out of scope.
- Changing Expo SDK 57 or React Native 0.86 to satisfy the fork's peer dependencies. The platform baseline is fixed; the dependency yields to it, not the reverse.

## Design

### Step 1 — introduce a local chat-types module

Create `src/types/chat.ts` re-exporting the types the app uses:

```ts
export type {
  IMessage,
  User,
  ComposerProps,
  SendProps,
  InputToolbarProps,
  MessageTextProps,
} from 'react-native-gifted-chat'
```

Repoint all 18 type-only files at `~/types/chat`. After this, exactly three files plus this module know which chat library the app uses. Establishing this boundary is the durable value of the migration — the next time this package changes hands, the blast radius is one file.

Do this as the first commit, still pointing at `react-native-gifted-chat`, so the indirection lands and passes tests *before* the library swap. That separates "did the indirection break anything" from "did the fork break anything" into two bisectable commits.

### Step 2 — swap the dependency

Remove `react-native-gifted-chat`, add `@kesha-antonov/react-native-chat@^4.3.0`, and update the re-export in `src/types/chat.ts` so it imports from `@kesha-antonov/react-native-chat` instead of `react-native-gifted-chat`.

### Step 3 — migrate the three components

Update the runtime imports in `ChatView.tsx`, `ChatComposer.tsx`, and `ChatComposer.web.tsx`.

**Verify before assuming a drop-in replacement.** The fork is at 4.x against the resolved gifted-chat 2.x, so two majors' worth of divergence exists on top of the fork point. The specific things to confirm, each of which is load-bearing in this app:

- Is the default export still named `GiftedChat`, or renamed in the fork?
- Do `Bubble`, `InputToolbar`, `Send`, `MessageText`, and `Composer` keep their prop contracts? `ChatView` supplies custom renderers for all of these.
- Does `IMessage` retain its field shape? It is persisted via `messageDatabase.ts` — **a field-shape change becomes a data migration**, which would materially expand this spec.
- Does the web `Composer` path still behave? There is a dedicated `ChatComposer.web.tsx` and a regression test (`chatComposerWebHeightLoop.test.tsx`) for a height-loop bug, implying past fragility here.
- **Does the fork support React Native 0.86 under Expo SDK 57?** Expo 57 is the fixed baseline and does not move to accommodate a dependency — see the platform-baseline section of the [dependency spec](./2026-08-11-dependency-security-and-major-upgrades-design.md). If the fork requires an RN version Expo 57 does not provide, **this migration does not proceed**; staying on the deprecated package is preferable to breaking the platform baseline. Check its peer dependencies before any other step.

If `IMessage` has changed shape, stop and re-scope. Persisted-data migration is not in this spec's budget.

### Step 4 — update tests

Six test files reference the library: `chatViewAccessibility.test.tsx`, `chatViewAvatarSource.test.tsx`, `chatComposerWebHeightLoop.test.tsx`, `chatComposer.test.tsx`, `useEdgeAgent.test.ts`, and `characterPromptBuilder.test.ts`. Repoint the type-only ones at `~/types/chat`; update any that mock the library by module name.

These tests are the primary regression net for this migration — particularly `chatComposerWebHeightLoop`, which guards a bug that has already occurred once.

## Testing

- `npm run typecheck` clean — the highest-signal check here, since most of the surface is types
- `npm test` green, root baseline **150 suites / 1378 tests** (adjust to the post-Phase-3 baseline)
- Manual verification on a real device, both platforms — CI does not cover rendering:
  - send and receive a text message
  - image bubble renders and opens full-screen (`ChatImageBubble`)
  - composer grows correctly with multi-line input
  - live-voice messages appear in the transcript
  - scrollback loads earlier messages
- Web composer verified — `ChatComposer.web.tsx` is shipped and `docker-compose.local.yml` serves Expo web on :8081, so the web chat path is in scope and must pass manual verification on the browser dev path

## Rollout

Single PR to `staging` after Phase 3 of the dependency spec has reached production. Not batched with any other work.

**Rollback:** revert the PR. Because Step 1 is a separate commit, a partial rollback to "indirection without the fork" is also available if the fork proves unsuitable — the type module is worth keeping regardless of which library sits behind it.

## Open Questions

1. **Is `IMessage` shape-compatible across the 2.x → fork 4.x boundary?** Unverified, and the single question that determines whether this spec is accurate. Resolve first, before any other step — a persisted-shape change re-scopes the entire effort into a data migration.
2. **Does the fork still export a symbol named `GiftedChat`?** Affects `ChatView.tsx` only; mechanical either way.

## Related

- [2026-08-11 Dependency Security and Major Upgrades](./2026-08-11-dependency-security-and-major-upgrades-design.md) — Phase 3 must land first
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — PRs target `staging`, which is later promoted to `main`

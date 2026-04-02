# Plan: Chat Bottom Tabs Overhaul

## Current Issues

1. **Web Platform Incompatibility (BLOCKING)** — Image generation crashes with "expo-file-system is not supported on web" error, leaving edit page blank and unresponsive
2. **Chat Tab Empty State** — Shows "No Characters Yet" instead of displaying the default character like Characters tab does
3. **Characters Tab Stuck on Chat Screen** — After navigating into a character's chat, tapping the Characters tab keeps showing the GiftedChat screen (bottom tab highlights correctly but the Characters stack doesn't reset to its index)

## Key Decisions

- **Default character**: Ensure the user always has at least one character; avoid empty-state confusion, but do not enforce a single default character
- **Canonical avatar field**: `avatar` remains the canonical character avatar field. `avatar_data` is a local-only cache for rendering and must not be synced to cloud.
- **Image storage**: Store base64 image data in SQLite via `avatar_data` on all platforms (web, Android, iOS). This replaces `expo-file-system` for local image storage entirely — `expo-file-system` can be uninstalled after this change.
- **Navigation reset**: Tapping the Characters tab should always navigate to the list of characters to edit
- **Unsaved changes protection**: If the user has unsaved changes on the edit screen, confirm before allowing Characters-tab navigation away from the screen

---

## Implementation Plan

### Phase 1: Replace expo-file-system with SQLite Image Storage (Issue 1)

**Problem**: `edit.tsx` imports `useLocalImageGeneration` → calls `localImageStorageService.ts` → imports `expo-file-system` which doesn't exist on web.

**Solution**: Add an `avatar_data` TEXT column to `characters` table (base64), rewrite `localImageStorageService.ts` to use SQLite instead of `expo-file-system`, update `useLocalImageGeneration` accordingly, and uninstall `expo-file-system`.

#### Tasks

- [ ] **1a. Add SQLite migration** — Bump `SCHEMA_VERSION` to 3 in `src/database/schema.ts`. Add migration that creates `avatar_data TEXT` column on the `characters` table. This column stores raw base64 image data on all platforms.

- [ ] **1b. Rewrite `localImageStorageService.ts` to use SQLite** — Replace the `expo-file-system` implementation with one that reads/writes `characters.avatar_data` via the database:
  - `saveCharacterImageLocally(characterId, base64Data)` → writes base64 into `characters.avatar_data`, returns a `data:image/webp;base64,...` data URI. This is now **async** (DB access).
  - `getLocalCharacterImageUri(characterId)` → reads `avatar_data` from SQLite, returns data URI. Now **async**.
  - `deleteLocalCharacterImage(characterId)` → sets `avatar_data = null`. Now **async**.

- [ ] **1c. Update `useLocalImageGeneration.ts`** — Adapt to the now-async `saveCharacterImageLocally`. Stop writing `file://` URIs (or data URIs) into the `avatar` column — the hook should write base64 to `avatar_data` only. The `avatar` field stays untouched (canonical, for cloud URLs).

- [ ] **1d. Keep `avatar` canonical and `avatar_data` local-only** — `avatar_data` must not be included in cloud sync payloads (`characterSyncService.ts`), and changes to it must not mark the character as needing cloud sync.

- [ ] **1e. Update `characterDatabase.ts` and related types** — Add `avatar_data` to the `LocalCharacter` interface. Update `toAppFormat()` to expose a display-ready avatar URI: prefer `avatar_data` (as a data URI) when present, fall back to `avatar`.

- [ ] **1f. Update display avatar across the app** — Ensure the edit screen, `CharacterAvatar`, character list, and chat screens all use the display URI from `toAppFormat()` so locally-generated images render correctly on every platform.

- [ ] **1g. Uninstall `expo-file-system`** — Remove `expo-file-system` from `package.json`. Verify no other code imports it. Run a native rebuild (this is a **breaking change** — the commit must use `feat!` to bump the major version and runtime version).

- [ ] **1h. Verify on all platforms** — Confirm the edit page works on web, Android, and iOS: generated avatars display immediately, persist after refresh, and `avatar` is never set to a data URI or `file://` URI.

### Phase 2: Fix Chat Tab Empty State (Issue 2)

**Problem**: `(tabs)/index.tsx` (Chats screen) shows "No Characters Yet" when the character list is empty, but doesn't auto-create a default character like the Characters tab does.

**Solution**: Unify default-character creation so it runs regardless of which tab loads first, and use a shared guard that prevents duplicate auto-creation across screens.

#### Tasks

- [ ] **2a. Lift default character creation out of Characters tab** — Extract the auto-create logic from `characters/index.tsx` into a shared hook, e.g. `useEnsureDefaultCharacter()`. This hook should enforce the invariant that the user has at least one character.

- [ ] **2b. Add a cross-screen creation guard** — Use a shared/module-level guard or equivalent coordination so both tabs cannot race and create duplicate default characters before React Query settles. A component-local `useRef` is not sufficient once both tabs use the hook.

- [ ] **2c. Use `useEnsureDefaultCharacter` in both tabs** — Call it in `(tabs)/index.tsx` (Chats) and `characters/index.tsx` (Characters) so either entry path can initialize the first character.

- [ ] **2d. Update Chats tab empty state** — Replace "No Characters Yet" with a loading/creating indicator (matching the Characters tab) while the first character is being created. Once created, the `useCharacters` query invalidation will cause both tabs to re-render with data.

### Phase 3: Fix Characters Tab Navigation (Issue 3)

**Problem**: The Characters tab uses a `Stack` navigator. When user navigates to `characters/[id]/chat`, then taps the Characters bottom tab, Expo Router highlights the tab but doesn't pop the stack — so the chat screen stays visible.

**Solution**: Always route to the Characters list when the tab is pressed, and protect against accidental data loss from the edit screen.

#### Tasks

- [ ] **3a. Add `tabPress` listener to Characters tab** — In `(tabs)/_layout.tsx`, add a listener on the Characters `Tabs.Screen` that always routes to `/characters` when the tab is pressed, so the user lands on the list of characters to edit.

- [ ] **3b. Track dirty state on the edit screen** — Detect whether the character edit form has unsaved changes by comparing current form state to the loaded character values.

- [ ] **3c. Confirm before leaving edit with unsaved changes** — If the user taps the Characters tab from the edit screen while dirty, show a confirmation alert before navigating to `/characters`. Choosing cancel keeps the user on the edit screen; choosing discard proceeds.

---

## Verification Checklist

- [ ] All platforms: edit page loads, "Generate Image" produces an avatar that displays correctly
- [ ] All platforms: generated avatar persists after refresh (stored in SQLite `avatar_data`)
- [ ] All platforms: canonical `avatar` is never set to a data URI or `file://` URI; `avatar_data` remains local-only
- [ ] `expo-file-system` is fully removed; native rebuild succeeds
- [ ] Chats tab: shows loading state then character list when user has no characters (first character auto-created)
- [ ] Chats tab: shows all characters when user has existing characters (no regression)
- [ ] Characters tab: tapping tab after deep navigation (chat/edit) always returns to character list
- [ ] Characters tab: normal navigation into character detail/edit/chat still works
- [ ] Edit screen: tapping Characters tab with unsaved changes shows a confirmation alert
- [ ] Edit screen: choosing cancel from that alert stays on the edit screen
- [ ] Edit screen: choosing discard from that alert navigates to the Characters list
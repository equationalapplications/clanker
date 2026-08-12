# Avatar render pipeline divergence — design

**Date:** 2026-08-10
**Status:** Implemented
**Follows:** `2026-07-28-image-pipeline-refactor-design.md` (Phase 1, shipped PR #580)

## 1. Problem

Two user-visible avatar defects were reported from a production Android build
after the Phase 1 OTA:

1. **Talk and Chat show a stale avatar.** Regenerating a character's image
   updates the Characters list and the Edit screen immediately, but the Talk
   header, the Talk body avatar, the Chat header, and the Chat message bubbles
   keep showing the pre-OTA image indefinitely. Saving on the Edit screen does
   not change this.
2. **Characters that were never regenerated show initials.** On the first launch
   after the OTA, characters whose avatar had been the bundled default rendered
   as initials in the Characters list instead of an avatar. They stay that way
   until the user generates a new image for them.

Both were reproduced on device. Character `3151ef7f-1952-4353-ac2d-233979579e15`
was used for the confirming tests: its Avatar Picker held exactly one image (the
freshly generated one), its list thumbnail was correct, and both Chat and Talk
showed the old image.

## 2. Root cause

### 2.1 Talk and Chat never adopted the Phase 1 read path

Phase 1 moved character images into the `character_images` table, addressed by
`characters.active_image_id` and read through `useResolvedImage`. The write path
follows this: `saveCharacterImage` (`src/services/characterImageService.ts`)
inserts a row and calls `setActiveImageId`. Nothing in Phase 1 writes the legacy
`characters.avatar` column, by design — the image-pipeline spec §3.3 marks it
deprecated but keeps it populated for public import and web compatibility.

Two screens were adopted; two were not.

| Call site                                            | Reads                                       | Correct? |
| ---------------------------------------------------- | ------------------------------------------- | -------- |
| `src/components/CharacterCard.tsx:27`                | `useResolvedImage(activeImageId, 'thumb')`  | yes      |
| `app/(drawer)/(tabs)/characters/[id]/edit.tsx:64`    | `useResolvedImage(activeImageId, 'master')` | yes      |
| `app/(drawer)/(tabs)/talk/index.tsx:139` (header)    | `character.avatar`                          | **no**   |
| `app/(drawer)/(tabs)/talk/index.tsx:194` (body)      | `character.avatar`                          | **no**   |
| `src/components/ChatView.tsx:157` (header)           | `character.avatar`                          | **no**   |
| `src/components/ChatView.tsx:385` → `:455` (bubbles) | `character.avatar`                          | **no**   |

`toAppFormat` (`src/database/characterDatabase.ts:93`) passes `char.avatar`
through unchanged and also exposes `active_image_id`, so both fields reach the
component — the four sites above simply read the wrong one. Symptom 1 is fully
explained by this and nothing else.

### 2.2 `CharacterAvatar` never reaches its bundled-default branch

The migration's decision to skip bundled-default characters is **correct and
intentional**, not a defect. The image-pipeline spec states it explicitly:

> Characters whose `avatar_data` matches the bundled default get **no image row
> at all** and fall through to the bundled asset. This purges the duplicated
> default from every row carrying one.
> — `2026-07-28-image-pipeline-refactor-design.md:749-750`

`src/machines/characterMachine.ts:84` makes the same assumption for newly
created characters:

> No avatar row is written: characters with no active image fall through to the
> bundled default in `CharacterAvatar`.

What breaks that contract is the fallback order inside
`src/components/CharacterAvatar.tsx`. The chain is
`imageUrl → initials → bundled default`, and the initials branch is gated only on
`characterName && showFallback`. `showFallback` defaults to `true` and is never
passed `false` anywhere in the codebase, so any character with a name — every
character — takes the initials branch. The bundled-default branch at
`CharacterAvatar.tsx:69-78` is unreachable in practice.

Symptom 2 is therefore a render-layer ordering bug affecting two cohorts at once:
migrated bundled-default characters, and every newly created character.

### 2.3 `AvatarPicker` does not notify the character machine

`src/components/AvatarPicker.tsx:88-89` (selecting a different image) and `:119`
(deleting the active image) write `active_image_id` to SQLite and invoke a local
React callback, but never send `characterService.send({ type: 'LOAD' })`.
`useImageGeneration.ts:88` and `useAvatarUpload.ts:111` both do send it.

This is latent today because no screen outside the Edit screen's own local state
reads `active_image_id` off the machine's cached character array. Section 2.1's
fix makes Talk and Chat read exactly that array, at which point picking or
deleting an image leaves both screens showing the previous image until an
unrelated `LOAD` happens to fire.

## 3. Corrections to the originating investigation report

Recorded so these are not re-raised:

- **"The regenerated image never reaches the DB until the user saves."** False.
  `useImageGeneration.ts:59-88` calls `saveCharacterImage` — which calls
  `setActiveImageId` — and then sends `LOAD`, all before `onImageGenerated`
  fires. Persistence happens at generation time. The staleness is entirely §2.1.
- **"The migration should insert an inline row holding
  `LEGACY_DEFAULT_AVATAR_BASE64`" (option 2a).** Rejected. It re-adds ~7.6 KB per
  character of exactly the duplication the spec purged, and does not fix newly
  created characters, which have the identical symptom.
- **"Add a `bundled` storage_kind returning the `require()`d asset" (option
  2b).** Rejected. Widens the `storage_kind` union and adds a resolver branch for
  an asset the resolver never needs to see; `CharacterAvatar` already holds the
  `require()`.
- **"Do not change `CharacterAvatar`'s null-image fallback — it would contradict
  the spec."** Inverted. The current fallback order is what contradicts the spec.

Non-avatar items from the same report, verified with no action required:

- **`logScreenView` deprecated (RNFirebase v22).** `src/services/analyticsService.ts:44`
  already uses the modular form, `logScreenView(getAnalytics(), { screen_name,
screen_class })`, on `@react-native-firebase/analytics` ^23.8.8. The
  deprecation targets the namespaced `firebase.analytics().logScreenView()`.
- **`UIBackgroundModes` missing `remote-notification`.** Already configured:
  `app.config.ts:246` sets `enableBackgroundRemoteNotifications: true` on the
  `expo-notifications` plugin.
- **`[expo-notifications] fetch failed` on iOS simulator.** Expected; no push
  token exists there.
- **Crashlytics initialized with `enabled: false`.** Intentional. Collection is
  consent-gated via `setCrashlyticsEnabled` from `SettingsContext.tsx:11` and
  `CookieConsent/CookieConsentContext.tsx:21`, applied after the user's choice
  loads.

## 4. Design

### 4.1 `CharacterAvatar` fallback order

Chain becomes `imageUrl → bundled default`. The initials branch and the
`showFallback` prop are removed rather than left in place behind a default:
nothing passes `showFallback={false}`, and a dead branch that silently outranks
the intended fallback is what produced this bug. `Avatar.Text` and the initials
derivation go with it.

The existing `onError` recovery (`erroredUrl` state,
`CharacterAvatar.tsx:31-35`) is unchanged — a URL that fails to load still
degrades to the bundled default, which is what the image-pipeline spec §
"Resolver failure" already promised.

### 4.2 Talk and Chat read the new pipeline, with the legacy URL as a tail fallback

Each of the four sites resolves:

```ts
const resolved = useResolvedImage(character.active_image_id, variant)
// …
<CharacterAvatar imageUrl={resolved ?? character.avatar} characterName={character.name} />
```

Full render chain: **`active_image_id` → `characters.avatar` → bundled default.**

The tail fallback is deliberate. `characterSyncService.ts:305` writes
`cloudChar.avatar` on every cloud restore while `avatar_data` is carried from the
local row only (`:315`), so a device that has not yet run the one-shot migration,
or a character predating `avatar_data` entirely, can legitimately hold a working
legacy URL and no image row. Without the tail fallback those characters would
regress from a real avatar to the bundled default. With it, the new pipeline
still wins whenever a row exists, which is what fixes the reported staleness.

Variants:

| Site                                 | Variant  | Rationale                                 |
| ------------------------------------ | -------- | ----------------------------------------- |
| `talk/index.tsx:139` header          | `thumb`  | 40 px                                     |
| `talk/index.tsx:194` body            | `master` | `AVATAR_SIZE`, the screen's focal element |
| `ChatView.tsx:157` header            | `thumb`  | 40 px                                     |
| `ChatView.tsx:385` `characterAvatar` | `thumb`  | bubble-sized                              |

Two implementation constraints:

- **Talk's header is set inside `useLayoutEffect` → `drawerNav.setOptions`**
  (`talk/index.tsx:124-158`). The `useResolvedImage` call must sit at component
  top level, and the resolved uri must join that effect's dependency array —
  otherwise the header keeps whatever the uri was on first render, which is
  `null` while the async resolve is in flight.
- **`ChatView`'s bubble avatar is already hoisted.** `characterAvatar` is
  computed once at component scope (`:385`) and read inside `renderAvatar`
  (`:455`). Keeping that shape means one `useResolvedImage` call per ChatView,
  not one per message. Do not move the hook into `renderAvatar`.

### 4.3 `AvatarPicker` notifies the machine

Add `characterService.send({ type: 'LOAD' })` after the `setActiveImageId` write
at `AvatarPicker.tsx:88-89` and after the active-image reassignment on delete at
`:119`, matching `useImageGeneration.ts:88` and `useAvatarUpload.ts:111`.

### 4.4 Not in scope

- **No migration change.** `migrateAvatarsToImageStore` is unchanged and its
  bundled-default skip is correct. The per-user completion flag stays `done` on
  devices that already ran it; nothing needs re-running or re-migrating.
- **No schema change, no data backfill, no type change.** Both
  `AppCharacter` (`src/database/characterDatabase.ts:41`) and `Character`
  (`src/services/characterService.ts:24`) already expose `active_image_id`, and
  `toAppFormat` already populates it — the field reaches Talk and ChatView today
  and is simply unread there.
- **Dropping `characters.avatar` stays deferred.** §4.2's tail fallback is what
  makes a future drop tractable to reason about, but the column still feeds
  `getPublicCharacter` and shared-character import.

## 5. Testing

- **`CharacterAvatar`** — with `imageUrl` null and `characterName` set, renders
  the bundled `Avatar.Image` source, not `Avatar.Text`. This is the contract that
  broke; it needs a test that fails against the current code.
- **`CharacterAvatar`** — with a non-null `imageUrl`, still renders that uri;
  `onError` still degrades to the bundled default.
- **Talk and ChatView** — three cases each:
  - `active_image_id` set and `avatar` holding a different, stale URL → renders
    the resolved uri.
  - `active_image_id` null and `avatar` set → renders `avatar`.
  - both null → renders the bundled default. This case covers the Talk header,
    the Talk body, and the Chat header — the three call sites that go through
    `CharacterAvatar`. Chat message bubbles are out of scope: they render
    `Avatar.Text` initials inline via GiftedChat's `renderAvatar`, and that
    branch is unchanged (see §6).
- **Talk header specifically** — the header avatar updates when the resolved uri
  arrives after first render, guarding the dependency-array constraint in §4.2.
- **`AvatarPicker`** — selecting an image and deleting the active image each
  send `LOAD`.
- No new migration test. The migration is unchanged.

## 6. Risk and rollout

Render-layer only, so this ships as an OTA. The blast radius is the four avatar
call sites plus `CharacterAvatar`; no persisted state changes, so a rollback is a
plain revert with no data to unwind.

The one deliberate behavior change beyond the bug fix is that initials disappear
from every `CharacterAvatar` call site: the character list, Edit, and the Talk
and Chat headers now render the bundled default for an avatar-less character.
This was chosen over preserving initials because it is what both the
image-pipeline spec and `characterMachine.ts:84` already assume, and because
preserving initials would require the rejected 2a/2b migration work while still
leaving newly created characters broken.

Chat message bubbles are the deliberate exception. `ChatView`'s `renderAvatar`
builds its own `Avatar.Image`/`Avatar.Text` pair rather than delegating to
`CharacterAvatar`, and the same branch renders the _user's_ avatar, where
initials remain the right fallback. Unifying the bubble on `CharacterAvatar`
would change user-avatar behavior too, so it stays out of this render-layer fix.
An avatar-less character therefore still shows initials in bubbles while showing
the bundled default in the Chat header.

Verification after OTA, on the reporting device:

1. Characters not regenerated since the OTA show the bundled default avatar in
   the list, not initials.
2. The regenerated character shows the same image in the list, Edit, Chat header,
   Chat bubbles, Talk header, and Talk body.
3. Generating a new image updates Talk and Chat without leaving the screen.
4. Selecting a different image in the Avatar Picker updates Talk and Chat.

# Default Character Cloud Sync On By Default — Design Spec

**Date:** 2026-07-03
**Status:** Implemented

---

## Overview

New user signs up, `characterMachine` auto-creates a default character named "Clanker"
(`creatingDefault` state, `src/machines/characterMachine.ts:204-208`, fires when user has zero
characters). `DEFAULT_CHARACTER_INSERT` (`characterMachine.ts:51-59`) does not set `save_to_cloud`,
so `characterDatabase.createCharacter` defaults it to `0` (`src/database/characterDatabase.ts:153`).

Talk screen live voice gates on this flag:

```
// src/hooks/useLiveVoiceChat.ts:146
if (!character.save_to_cloud) {
  Alert.alert('Cloud Sync Required', ..., [
    { text: 'Cancel' },
    { text: 'Enable Sync', onPress: () => router.push(`/characters/${characterId}/edit`) },
  ])
  return
}
```

Result: every brand-new user who taps Talk gets bounced to the character edit screen to flip a
toggle and hit Save before they can try the feature at all. This spec makes new default characters
cloud-synced from creation so Talk works immediately.

**Scope:** one data default in `src/machines/characterMachine.ts`, plus deletion of an unrelated
dead code path found during investigation (`createNewCharacter` in `characterService.ts`, zero
callers anywhere in the codebase or tests). No DB schema change, no migration — the `save_to_cloud`
column already exists and keeps its `0` default; this only changes the value the app inserts for
new sign-ups.

---

## Decisions

| # | Topic | Decision |
|---|-------|----------|
| 1 | Default `save_to_cloud` for new sign-up character | `true` |
| 2 | Default `is_public` | stays `false` — cloud sync ≠ public sharing |
| 3 | Dev-sandbox default character path | untouched — already forces `save_to_cloud=1` (`src/auth/ensureDevSandboxCharacter.ts`) |
| 4 | Existing users' characters | untouched — this only changes the insert for characters created after this ships |
| 5 | Dead `createNewCharacter` (`characterService.ts:138-182`) | delete, along with its now-unused `loadDefaultAvatarBase64` import — confirmed no callers |

---

## Change 1: Default character created cloud-synced

`src/machines/characterMachine.ts`, `DEFAULT_CHARACTER_INSERT`:

```diff
 const DEFAULT_CHARACTER_INSERT: CharacterInsert = {
   name: 'Clanker',
   is_public: false,
   appearance: 'A sturdy mechanical companion with a practical, well-worn chassis.',
   traits: 'Loyal, curious, resourceful, and a little sarcastic.',
   emotions: 'Calm, attentive, and eager to help.',
   context: 'A newly created companion character ready to chat and develop its personality.',
   voice: DEFAULT_VOICE,
+  save_to_cloud: true,
 }
```

**Why this is sufficient:** `characterDatabase.createCharacter` writes whatever `save_to_cloud`
value it's given (`char.save_to_cloud ? 1 : 0`, no other gating). The app already syncs any
character with `save_to_cloud=1` and no `cloud_id` to the cloud automatically and without user
action — on network reconnect and on app startup after auth resolves (`app/_layout.tsx:195-229`,
`syncAllToCloud`). So the new default character will pick up a `cloud_id` in the background shortly
after creation, same path as any character a user manually flips to synced today. No new sync
machinery needed.

**Talk screen gate:** `useLiveVoiceChat.ts:146` checks `character.save_to_cloud` truthily, not
`cloud_id` — so the redirect-to-edit-screen alert stops firing for new users immediately, without
waiting on the background sync to finish.

---

## Change 2: Delete dead `createNewCharacter`

`src/services/characterService.ts:135-182` — a second, divergent default-character constructor
(different appearance/traits text, also `save_to_cloud` unset) with zero callers in app code or
tests. It is not the code path sign-up actually uses (that's `characterMachine`'s
`createDefaultCharacterActor`). Leaving it around risks a future edit landing here instead of the
real path and silently doing nothing. Delete the function body and the `loadDefaultAvatarBase64`
import it was the sole user of. `CharacterInsert`/`CharacterUpdate` re-exports and the local
`createCharacter` wrapper (line 70, still used by `characterMachine.ts`) stay.

---

## Testing

`__tests__/characterMachine.test.ts` (~line 462-480) already asserts the shape of the
`createCharacter` call made for the default character (checks `voice: 'Umbriel'` among other
fields). Extend that assertion to also expect `save_to_cloud: true`.

No new test files needed — this is a one-field default change plus a deletion of unreferenced code.

---

## Out of scope

- Changing the Talk-screen gate logic itself (still checks `save_to_cloud`, still shows the alert
  for any character a user has manually un-synced).
- Any change to sync timing/reliability, `cloud_id` assignment, or the sync service.
- `is_public` behavior or sharing flows.

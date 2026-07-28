# Image Pipeline Refactor — Phase 1: Avatars

**Date:** 2026-07-28
**Status:** Approved, ready for planning
**Scope:** Character avatars only. Vision (user photo upload to LLM) and agent
image generation are documented as groundwork in §17, explicitly out of scope.

---

## 1. Problems addressed

**Avatars are silently lost.** `characters.avatar_data` holds base64 in local
SQLite. The cloud Postgres `characters.avatar` column exists but nothing ever
writes an image to it, and `characterSyncService.ts:283-285` sets
`avatar_data: null` when pulling from cloud. A new device or reinstall drops the
avatar with no warning.

**Generating overwrites history.** `saveCharacterImageLocally` writes a single
column, so each new avatar destroys the previous one — including uploads, which
today silently replace whatever was there.

**The default avatar has a baked-in border.** `assets/adaptive-icon-200x200.webp`
is an Android adaptive icon: the logo circle sits inside a padded square. Under a
circular mask the padding renders as a ring of background colour. This is an
asset problem, not a styling problem — no `resizeMode` change fixes it.

**Every character stores its own copy of that default.** `characterMachine.ts:88`
loads the embedded base64 and writes it into each new character's row, so N
characters carry N identical copies of the same 7.6 KB image.

**Uploads are not square.** `useAvatarUpload.ts:60-61` resizes to 1024 on the
longest edge preserving aspect ratio, so a 16:9 photo becomes 1024×576 and the
circular mask crops an arbitrary slice the user never chose.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Storage backend | Firebase Storage (GCS, `clanker-prod`) | Reuses existing Firebase Auth + App Check; rules scope by uid with no new credential plumbing |
| Privacy routing | Client-side, keyed on `save_to_cloud` | The Cloud Function never learns privacy state, so it cannot leak it |
| Upload location | Client, after `generateImage` returns | `generateImage` unchanged; same path reused by Vision later |
| Web privacy mode | base64 in SQLite (already OPFS-backed) | See §3 |
| Master resolution | 1024×1024 WebP | Model native output; supports future zoom/download |
| Thumbnail | 256×256 WebP | See §4 |
| Cap | 100 images per character, FIFO | Per-character matches gallery semantics; active image never evicted |
| TTL sweeper | **Rejected** | See §12 |
| Default avatar | Bundled asset, not stored per character | Offline, zero cost, deletes three source files |
| Public import | Signed URL in Phase 1 | Omitting it regresses a shipped feature |

### 2.1 Why web privacy mode keeps base64 in SQLite

`expo-sqlite@56` on web uses `AccessHandlePoolVFS`
(`node_modules/expo-sqlite/web/worker.ts:790`) — an OPFS sync-access-handle pool.
SQLite-on-web is therefore *already* origin-private storage: the same quota bucket
IndexedDB draws from, the same eviction rules, and it never touches a server.

The usual "don't put binary in SQLite" instinct targets *native* SQLite. On web,
base64-in-SQLite and blobs-in-IndexedDB are both opaque bytes in origin storage.
The genuine advantage of an IndexedDB blob store — keeping rows lean so list
queries stay fast — is obtained here structurally by moving images into their own
table (§3), which no list query on `characters` touches.

What IndexedDB would have cost: blob URLs cannot be built synchronously from a
row and die on page reload, so every session must re-mint them; a second source
of truth requiring cascade-delete and orphan sweeps; and an IndexedDB read path
in `src/utilities/okfSave.web.ts`. Rejected on that balance. The resolver seam
(§5) keeps it a contained swap if web privacy usage ever justifies it.

---

## 3. Data model

### 3.1 Local SQLite (`src/database/schema.ts`)

Migration 22 creates (the highest existing index is 21):

```sql
CREATE TABLE character_images (
  id            TEXT PRIMARY KEY,   -- uuid; also the storage object name
  character_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  storage_kind  TEXT NOT NULL,      -- 'cloud' | 'file' | 'inline'
  master_ref    TEXT NOT NULL,      -- object path | file:// uri | base64
  thumb_ref     TEXT,               -- same kind as master; NULL = fall back to master
  mime_type     TEXT NOT NULL DEFAULT 'image/webp',
  source        TEXT NOT NULL,      -- 'generated' | 'uploaded' | 'imported'
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_character_images_char ON character_images(character_id, created_at DESC);
```

Migration 23 adds `characters.active_image_id TEXT`.

The `storage_kind` discriminator lets one row shape serve all three routing
modes. `mime_type` is per-row rather than a constant specifically so the web
WebP fallback (§9) can record JPEG for the rows it affects.

Splitting images into their own table satisfies the performance requirement
structurally: list queries on `characters` no longer touch image bytes, so
there is no `SELECT` column discipline to remember or regress.

### 3.2 Cloud Postgres (`functions/src/db/schema.ts`)

A mirror `character_images` table. Cloud rows are always `kind='cloud'`, so it
carries `storage_path` / `thumb_path` instead of `storage_kind` / `master_ref`:

| Column | Type |
|---|---|
| `id` | uuid PK |
| `character_id` | uuid FK → characters |
| `user_id` | uuid FK → users |
| `storage_path` | text NOT NULL |
| `thumb_path` | text |
| `mime_type` | text NOT NULL DEFAULT `'image/webp'` |
| `source` | text NOT NULL |
| `created_at` | timestamptz NOT NULL |
| `deleted_at` | timestamptz |

Plus `characters.active_image_id uuid`.

> **Migration constraint:** hand-write `functions/drizzle/0022_character_images.sql`
> (the highest existing file is `0021_fix_handle_new_user_trigger_power_scale.sql`).
> Do **not** run `drizzle-kit generate` — the journal is out of sync with the
> migration directory.

---

## 4. Storage layout and rules

```
users/{uid}/characters/{characterId}/{imageId}.webp         1024×1024
users/{uid}/characters/{characterId}/{imageId}_thumb.webp     256×256
```

New `storage.rules` file, plus a `storage` block in `firebase.json` (neither
exists today):

- Read and write permitted only where `request.auth.uid == uid`.
- Writes additionally constrained to `image/webp` or `image/jpeg`, and < 2 MB.
- No public-read paths. Sharing goes through signed URLs (§8).

`src/config/firebaseConfig.web.ts:27` already reads
`EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET`; the value needs setting.

### Why a thumbnail

An AI portrait at 1024 WebP q0.85 is roughly 150 KB. The avatar picker showing
100 of them would be a **15 MB screen**, while the character list renders those
same images at 48 px. A 256×256 thumb is roughly 12 KB, bringing the grid to
about 1.2 MB and the character list to a twelfth of the bytes. This matters most
in web privacy mode, where the resolver would otherwise pull 100 × ~200 KB of
base64 through the WASM boundary to paint one grid.

Storage cost is not the driver: 100 images × 150 KB is 15 MB per user, about
**$0.0004/user/month** in GCS.

---

## 5. The resolver seam

```ts
// src/services/localImageStore.ts  /  src/services/localImageStore.web.ts
resolveImageUri(row: CharacterImageRow, variant: 'master' | 'thumb'): Promise<string>
```

Dispatch on `storage_kind`:

| Kind | Resolution |
|---|---|
| `cloud` | `getDownloadURL(path)`, memoized per path for the session |
| `file` | the `file://` URI as-is |
| `inline` | `data:{mime_type};base64,…` |

When `thumb_ref` is NULL, `variant: 'thumb'` falls back to the master.

Native implementation uses `expo-file-system`; the `.web.ts` implementation reads
base64 from SQLite. Firebase Storage access is likewise platform-split behind
`src/services/storageService.ts` / `.web.ts`, because native uses
`@react-native-firebase/storage` and web uses the `firebase` JS SDK. Native
therefore uploads with `putFile(localPath)`, which sidesteps the React Native
`Blob` problem; web uses `uploadBytes`.

**Consumer contract:** `CharacterAvatar` keeps its current `imageUrl?: string`
prop. Resolution moves into a `useResolvedImage(imageId, variant)` hook used by
`CharacterCard`, the edit screen, and the talk screen. This preserves the
existing component and its accessibility tests unchanged.

---

## 6. Write path

`saveCharacterImage(characterId, base64, mimeType, source)`:

1. **Normalize to square.** Generated images are already 1024×1024 and imported
   ones inherit the owner's square, so this applies to uploads only — see §7.
2. **Resize to 1024** on the longest edge, never upscaling: an 800×800 upload is
   stored at 800. Derive a 256 thumb the same way.
3. **Route on `save_to_cloud`:**
   - cloud → upload master and thumb to Storage; `kind='cloud'`, refs are object paths
   - native privacy → write both under `expo-file-system` document directory; `kind='file'`
   - web privacy → `kind='inline'`, base64 in `master_ref` / `thumb_ref`
4. **Insert the row**, set `characters.active_image_id`.
5. **Enforce the cap:** if the character now exceeds 100 images, hard-delete the
   oldest — with the active image always exempt. Deletion removes bytes before
   rows (§10).

Steps 2 and 3 are abstracted so the Vision feature reuses them verbatim.

---

## 7. User-uploaded avatars

`src/hooks/useAvatarUpload.ts` already exists and is wired at
`app/(drawer)/(tabs)/characters/[id]/edit.tsx:462`. Phase 1 migrates it rather
than building it:

- **Square crop.** Set `allowsEditing: true, aspect: [1, 1]` on
  `launchImageLibraryAsync`. iOS always presents a square cropper when editing is
  enabled; `aspect` drives Android. The user chooses their own crop and the
  result is guaranteed square. Web does not support `allowsEditing`, so it falls
  back to a programmatic centre-crop via the manipulator.
  This reverses the original spec's `allowsEditing: false`, which was correct
  when avatars were incidental and is wrong now that filling the circle is a
  requirement.
- **Route through the gallery.** `saveCharacterImageLocally` →
  `saveCharacterImage(..., source: 'uploaded')`, so uploads become pickable
  alongside generated ones instead of destroying the previous avatar.
- The 200×200 minimum stays. Images between 200 and 1024 are stored at their
  native size, not upscaled.

---

## 8. Public character import

`getPublicCharacter` returns a 15-minute V4 signed URL for the owner's active
master. The importer downloads once, re-stores under their own account according
to *their* privacy mode, and writes a row with `source='imported'`.

This stays in Phase 1 because `getPublicCharacter` already ships: omitting it
would regress a live feature, leaving imported characters avatar-less.

> **Deploy-time trap:** signed-URL generation requires the runtime service
> account to hold `roles/iam.serviceAccountTokenCreator` **on itself**, or
> `getSignedUrl` fails with a `signBlob` permission error. This is IAM
> configuration, not a code defect — grant it before deploying.

---

## 9. Web WebP encoding probe

`expo-image-manipulator` on web encodes through `canvas.toDataURL('image/webp')`.
Safari only gained WebP canvas encoding in 17. Browsers that lack support return
PNG silently rather than throwing, so the probe must check the returned prefix:

```ts
const isWebpSupported = (() => {
  if (typeof document === 'undefined') return true
  const elem = document.createElement('canvas')
  return elem.getContext && elem.getContext('2d')
    ? elem.toDataURL('image/webp').indexOf('data:image/webp') === 0
    : false
})()

const mimeType = isWebpSupported ? 'image/webp' : 'image/jpeg'
```

The resulting MIME type is recorded per row (§3.1), so mixed-format galleries
resolve correctly.

**Native needs no probe.** `expo-image-manipulator@56` encodes WebP on iOS via
`SDImageWebPCoder` (`node_modules/expo-image-manipulator/ios/ImageManipulatorUtils.swift:79`).
The historical "WEBP is Android-only" limitation no longer applies.

---

## 10. Deletion cascade

Any path that removes images — character hard-delete, character purge, cap
eviction, or explicit delete from the picker — must **delete bytes before
dropping rows**:

| Kind | Cleanup |
|---|---|
| `cloud` | Delete master and thumb objects from Firebase Storage |
| `file` | Delete both files from the device |
| `inline` | Row deletion is sufficient — bytes live in the row |

Ordering matters: a failure partway through leaves recoverable rows pointing at
possibly-missing bytes, which the resolver degrades gracefully (§11). The reverse
order would leave orphaned bytes with nothing referencing them.

---

## 11. Error handling

**Governing rule: never lose an image the user spent credits on.** Every
generated image costs `IMAGE_GENERATION_COST`.

- **Upload failure** keeps the image locally with the row marked for retry. The
  avatar still displays and the credits are not wasted.
- **Resolver failure** degrades master → thumb → bundled default, via the
  existing `onError` path in `CharacterAvatar`.
- **Signed URL expiry** during import re-requests rather than failing.
- **Storage permission and quota errors** surface in the existing Snackbar
  alongside `imageError` / `uploadError`.

---

## 12. Rejected: the TTL sweeper

The original concept included deleting images unused for 30–60 days. Rejected:

1. **It deletes things users paid for.** Every generated avatar cost credits.
   Silently removing a paid asset invites support tickets and refund requests.
2. **It contradicts the feature's premise.** The point of avatar history is that
   old avatars are still there. A user who returns after a season to find their
   favourite gone got the opposite of what was advertised.
3. **It is two implementations for $0.0004/user/month** — a scheduled Cloud
   Function plus a `last_used_at` column for cloud mode, *and* an on-device
   sweeper for privacy mode, where no server can reach the files.

The FIFO cap (§6) already bounds storage. Revisit only if the economics change.

---

## 13. Default avatar

A one-off script crops `assets/icon.png` to the 986×986 square at **(19, 0)** and
resizes to 1024, producing `assets/default-avatar-1024.webp`.

Measured geometry of `assets/icon.png` (1024×1024): the logo circle's widest row
is y=493 spanning x=19…1004, giving centre (511.5, 493) and diameter 986. The
neck and shoulders extend below y=986 but fall outside the circular mask, so the
crop discards them harmlessly.

`CharacterAvatar` falls back to this asset via `require()` when a character has
no active image. Nothing is written per character.

**Deletes:** `src/utilities/defaultAvatarBase64.ts` (a 10 KB source embed),
`src/utilities/loadDefaultAvatar.ts`, `src/services/defaultAvatarService.ts`, and
the copy at `src/machines/characterMachine.ts:88`.

> **Prep step:** no image tooling is installed locally — no `sharp`, ImageMagick,
> or PIL. The crop needs `npx sharp-cli` or equivalent.

---

## 14. Migration of existing avatars

DDL lives in numbered SQL migrations 22 and 23. The **data move runs in JS**
(`migrateAvatarsToImageStore()`, guarded by a `kvStorage` flag) because it needs
conditional logic SQL cannot express cleanly.

1. Characters whose `avatar_data` matches the bundled default get **no image row
   at all** and fall through to the bundled asset. This purges the duplicated
   default from every row carrying one.
2. Every other character with `avatar_data` gets an `inline` row holding the
   existing base64, `thumb_ref` NULL.
3. A background pass then generates thumbs and promotes `save_to_cloud`
   characters from `inline` to `cloud`.

`avatar_data` is **left in place and unread for one release** as a rollback net,
then dropped in a follow-up. The migration must be idempotent — safe to re-run
if interrupted partway.

---

## 15. Avatar picker UI

A modal on the edit screen: `FlatList numColumns={3}` of thumbs, newest first,
the active one check-marked. Tap to activate; swipe or long-press to delete.
The Generate and Upload buttons move into its header, reusing
`useImageGeneration` and `useAvatarUpload` unchanged.

`CharacterAvatar` also gains `resizeMode: 'cover'` so any non-square image
(legacy migrated avatars) fills rather than letterboxes.

---

## 16. Testing

| Area | Cases |
|---|---|
| Resolver | Dispatch per `storage_kind`; thumb→master fallback when `thumb_ref` NULL |
| Cap eviction | Evicts oldest; **never** evicts the active image; no-op below 100 |
| Deletion cascade | Bytes deleted before rows, per kind; partial-failure leaves rows |
| Migration | Default-purge; base64→inline row; idempotency across interruption |
| Upload | Square result on native and web; no upscaling below 1024; 200×200 minimum |
| WebP probe | JPEG fallback recorded in `mime_type` |
| `storage.rules` | uid isolation, size cap, content-type — via emulator |
| Picker | Activate, delete, empty state |

Existing `__tests__/characterAvatarAccessibility.test.tsx` and
`__tests__/useAvatarUpload.test.tsx` are updated, not replaced.

---

## 17. Groundwork for later phases (out of scope)

Phase 1 deliberately builds seams these need:

**Vision — user photo upload to the LLM.** The `+` button
(`src/components/ChatComposer.tsx:271`, currently `expo-document-picker`) gains a
photo option. Reuses §6 steps 2–3 verbatim. Images are passed to the model
inline rather than persisted where possible; anything that must be stored goes to
`users/{uid}/ephemeral/{id}.webp` under a lifecycle rule. Needs a message
attachment link table.

**Agent image generation.** A tool available to the agent, backed by agent
memory. Persists into the same `character_images` table with `source='agent'`,
returns with the reply, renders as a thumb in the chat bubble, and taps through
to a zoom modal with download via `expo-media-library` / `expo-sharing`. Needs
the same attachment table plus media-library permissions.

Neither is implemented in Phase 1.

---

## 18. File map

| Action | Path |
|---|---|
| Create | `src/services/localImageStore.ts` / `.web.ts` |
| Create | `src/services/storageService.ts` / `.web.ts` |
| Create | `src/services/characterImageService.ts` (`saveCharacterImage`, cap, cascade) |
| Create | `src/hooks/useResolvedImage.ts` |
| Create | `src/components/AvatarPicker.tsx` |
| Create | `src/database/migrations/migrateAvatarsToImageStore.ts` |
| Create | `storage.rules` |
| Create | `assets/default-avatar-1024.webp` |
| Create | `functions/drizzle/0022_character_images.sql` |
| Modify | `src/database/schema.ts` (migrations 22, 23) |
| Modify | `src/database/characterDatabase.ts` (`toAppFormat` drops the data-URI build) |
| Modify | `src/hooks/useAvatarUpload.ts` (square crop, gallery routing) |
| Modify | `src/hooks/useImageGeneration.ts` (routes through `saveCharacterImage`) |
| Modify | `src/components/CharacterAvatar.tsx` (bundled default, `cover`) |
| Modify | `src/components/CharacterCard.tsx` (uses `useResolvedImage`) |
| Modify | `app/(drawer)/(tabs)/characters/[id]/edit.tsx` (picker) |
| Modify | `src/services/characterSyncService.ts` (stop nulling avatars; sync image rows) |
| Modify | `functions/src/db/schema.ts`, `functions/src/characterFunctions.ts` (signed URL) |
| Modify | `firebase.json` (storage block) |
| Delete | `src/utilities/defaultAvatarBase64.ts`, `src/utilities/loadDefaultAvatar.ts`, `src/services/defaultAvatarService.ts`, `src/services/localImageStorageService.ts` |

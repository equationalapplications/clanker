# Image Pipeline Refactor — Phase 1: Avatars

**Date:** 2026-07-28
**Status:** Implemented (Phase 1)
**Scope:** Character avatars only. Vision (user photo upload to LLM) and agent
image generation are documented as groundwork in §18, explicitly out of scope.

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
| Cap | 100 images per character, FIFO | Per-character matches gallery semantics; active image never evicted. Enforced server-side for cloud characters — see §13.3 |
| Image sync | Dedicated callable, tombstone-based | The character snapshot's last-write-wins rule cannot express a set with deletions — see §13 |
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
  sync_state    TEXT NOT NULL DEFAULT 'local',
                 -- 'local' | 'synced' | 'pending_upload' | 'pending_delete' | 'failed'
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  deleted_at    INTEGER
);
CREATE INDEX idx_character_images_char ON character_images(character_id, created_at DESC);
CREATE INDEX idx_character_images_sync ON character_images(sync_state)
  WHERE sync_state IN ('pending_upload', 'pending_delete');
```

Migration 23 adds `characters.active_image_id TEXT`.

The `storage_kind` discriminator lets one row shape serve all three routing
modes. `mime_type` is per-row rather than a constant specifically so the web
WebP fallback (§9) can record JPEG for the rows it affects. `sync_state` and
`sync_attempts` drive the retry and reconciliation flow — see §13.1, which also
defines how `deleted_at` and `sync_state` interact.

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

Plus `characters.active_image_id uuid` — deliberately **not** a foreign key to
`character_images(id)`. `syncCharacterImages` upserts rows and sets the pointer in
one request, and a device may also push a pointer for a row that is still
local-only, so a FK would reject legitimate writes. The handler validates instead:
the id must match a live, non-tombstoned row on that character. Dangling pointers
are handled at both ends — eviction never picks the active row, and the resolver
falls back to the newest live image, then the bundled default.

`deleted_at` is load-bearing here, not vestigial: a soft-deleted cloud row is the
**tombstone** other devices reconcile against (§13.3). Cloud rows are retained for
30 days after deletion, then dropped by a retention pass. The Storage objects are
deleted immediately — only the row lingers, and rows are tens of bytes.

### 3.3 The legacy `characters.avatar` column

The Postgres `characters.avatar` URL column is now deprecated. It keeps syncing
untouched for one release so a rollback has somewhere to land, and is dropped in
the same follow-up that drops local `avatar_data` (§15). Nothing in Phase 1 writes
to it, and once `active_image_id` is populated nothing reads it either — the
`toAppFormat` fallback in `src/database/characterDatabase.ts:70-72` is removed as
part of this work.

> **Migration constraint:** hand-write `functions/drizzle/0022_character_images.sql`
> (the highest existing file is `0021_fix_handle_new_user_trigger_power_scale.sql`).
> Do **not** run `drizzle-kit generate` — the journal is out of sync with the
> migration directory.

---

## 4. Storage layout and rules

```text
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

1. **Normalize to square.** Generated images are already 1024×1024, and imported
   ones inherit the owner's aspect ratio — usually square, though a legacy
   migrated avatar can arrive non-square. §16's `resizeMode: 'cover'` absorbs
   that safely, so active normalization applies to uploads only — see §7.
2. **Resize to 1024** on the longest edge, never upscaling: an 800×800 upload is
   stored at 800. Derive a 256 thumb the same way.
3. **Route on `save_to_cloud`:**
   - cloud → upload master and thumb to Storage; `kind='cloud'`, refs are object paths
   - native privacy → write both under `expo-file-system` document directory; `kind='file'`
   - web privacy → `kind='inline'`, base64 in `master_ref` / `thumb_ref`
4. **Insert the row**, set `characters.active_image_id`.

   **Cloud saves reserve the row before uploading.** Storage paths derive from
   ids the caller already holds (§13.2), so the row that names them can be written
   before the bytes exist. It goes in as `sync_state='reserved'` and is updated
   into its real state once the upload resolves — the reservation is the commit
   point's other half, not an extra row.

   Compensating cleanup alone cannot close this window. A process killed between a
   successful upload and the row write runs no `catch` at all, leaving objects in
   Storage that nothing references and no sweep could find: invisible and billable
   forever. A row written first is the only thing that survives a hard kill.

   Reserved rows are excluded from the picker, the cap count, and eviction — the
   user never sees one. The ordinary failure paths delete their own reservation, so
   `reapStaleImageReservations` (run at the head of each sweep) normally finds
   nothing; it exists for the hard-kill case, and only collects reservations older
   than 30 minutes so it cannot race a save that is merely slow.

   **Local kinds get no reservation.** An `inline` row's refs *are* the payload, so
   there is nothing to name in advance, and a stranded `file` write is addressable
   on-device rather than invisible and billable. Those keep the compensating
   rollback below.

   The rollback still matters for everything the reservation does not cover: any
   throw between the first write and the commit deletes what already landed, on
   whichever side it landed. That includes *partial* cloud uploads, the easy case
   to miss — when the master uploads and the thumb then fails, the write path falls
   back to local storage and commits a `file` row **successfully**, so a rollback
   keyed only on the outer failure would never run. The uploaded master has to be
   deleted on that fallback path specifically.
5. **Enforce the cap:** if the character now exceeds 100 images, evict the oldest
   — with the active image always exempt. Deletion removes bytes before rows
   (§10). For `file` and `inline` rows the client enforces this directly; for
   cloud characters the authoritative cap lives server-side, because no single
   client can see the whole set (§13.3).

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
>
> **Deploy-time trap #2:** on web, the importer loads the signed URL through
> `expo-image-manipulator`'s canvas path, which needs to read the response
> body cross-origin. `storage.googleapis.com` sends no CORS headers by
> default — unlike `getDownloadURL()` links, which do — so an unconfigured
> bucket makes public import silently fail to fetch the avatar on web (the
> character itself still imports; only the avatar is lost, per §11's
> degrade-not-fail rule). Apply `cors.json` to the bucket before deploying:
> `gsutil cors set cors.json gs://clanker-prod.firebasestorage.app`.
>
> `cors.json` must allow `GET`, `POST` and `DELETE`, not `GET` alone: the web
> storage path also calls `uploadBytes` and `deleteObject`, so a read-only config
> blocks browser uploads and cleanup deletes outright. `PUT` is not used.

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

**Variant derivation is platform-split, and web is not the incidental case.**
Native reads the manipulator's output files through `expo-file-system` and deletes
the temporaries. That module is a warn-and-noop stub on web — `new File(uri)`
returns an object with no `base64()` — so web instead takes the manipulator's own
`base64: true` save option and has no temp file to clean up. Native keeps the file
read rather than adopting `base64: true` everywhere, to avoid holding a second copy
of the payload as a JS string alongside the native buffer.

---

## 10. Deletion cascade

Any path that removes images — character hard-delete, character purge, cap
eviction, or explicit delete from the picker — cleans up per kind:

| Kind | Cleanup |
|---|---|
| `cloud` | Delete master and thumb objects from Firebase Storage |
| `file` | Delete both files from the device |
| `inline` | Row deletion is sufficient — bytes live in the row |

### 10.1 Ordering

**The invariant is: never destroy the last handle to the bytes before destroying
the bytes.** For a single image the row *is* that handle — it carries the object
path — so bytes go first. A failure partway then leaves a recoverable row
pointing at possibly-missing bytes, which the resolver degrades gracefully (§11),
whereas the reverse would leave orphaned bytes with nothing able to find them.

"Bytes before rows" is the single-image corollary, **not** a blanket rule. Bulk
paths delete by *prefix*, and a prefix is derived from ids the caller already
holds rather than read out of the rows. There the rows are not the handle, so the
invariant permits the opposite order — and avoiding stale references prefers it:

| Path | Order | Why |
|---|---|---|
| Single image (picker, cap eviction) | bytes → row | The row is the only handle to the object path |
| `deleteCharacterFn` → `purgeCharacter` | rows → prefix | Prefix `users/{uid}/characters/{cloudId}/` is derivable from the request. Rows-first means a Storage failure leaves only orphan bytes, which a retry's idempotent prefix delete reaps; bytes-first risks a *surviving* character whose rows point at deleted objects, with no tombstone to trigger cleanup |
| `adminResetUserState` | rows → prefix | Same handle argument; the `users` row survives, so `firebaseUid` stays available for a retry |
| `adminDeleteUser` | prefix → rows | **Inverted, and required.** The prefix is `users/{firebaseUid}/`, and `firebaseUid` lives on the `users` row this handler deletes. Dropping that row first makes the bytes permanently unaddressable — here the `users` row is the last handle |

Prefix deletion is a list-then-delete loop, idempotent, so every one of these is
safe to re-run after a partial failure.

**A failed Storage delete must fail loudly.** Both bulk helpers attempt every
path — one bad object does not strand the rest — and then throw if any non-404
failure occurred. A 404 stays idempotent success. Logging and resolving instead
would let callers go on to delete the rows holding those paths, and the objects
would be unreachable rather than merely orphaned: retry needs the references.

**Ownership is checked before any destructive step, not after.** The cloud
`character_images` delete predicate is scoped by `user_id` as well as
`character_id`: a caller-supplied `characterId` that belongs to someone else must
not reach a `DELETE` at all. Storage-path scoping alone is insufficient — the
path embeds the *caller's* uid and so silently no-ops on a foreign character,
leaving the Postgres delete as the unguarded step.

**Offline is the exception.** A `cloud` row's bytes are unreachable without a
network, so the whole operation defers rather than proceeding half-way: the row is
soft-deleted locally and marked `pending_delete`, and the sweeper completes it in
order later (§13.1). Deleting the local row while its objects survive would strand
the bytes with nothing left to retry from.

---

## 11. Error handling

**Governing rule: never lose an image the user spent credits on.** Every
generated image costs `IMAGE_GENERATION_COST`.

- **Upload failure** keeps the image locally as a `file` row marked
  `pending_upload`, retried by the sweeper on a bounded budget (§13.1). The avatar
  still displays and the credits are not wasted, even if the upload never
  succeeds — only cloud redundancy is lost.
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

## 13. `character_images` sync and lifecycle

Image history is an append-mostly log with deletions. It cannot ride inside the
character snapshot `syncCharacterFn` pushes, and it cannot use the
last-write-wins-on-`updated_at` rule `restoreFromCloud` applies to characters —
there is no single row whose timestamp settles a set difference. It gets its own
flow.

### 13.1 Sync state on the local row

`sync_state` (§3.1) takes one of:

| Value | Meaning |
|---|---|
| `reserved` | a cloud row claimed before its upload began (§6); invisible to the picker, the cap and eviction, and reaped if it outlives a plausible upload |
| `local` | a `file` or `inline` row on a privacy-mode character; terminal, the sweeper skips it |
| `pending_upload` | the server does not yet have this row — either the bytes are still on-device, or they are uploaded and only the registration call is outstanding |
| `synced` | cloud row and objects confirmed |
| `pending_delete` | the user deleted it; the cloud copy still has to be reaped |
| `failed` | retry budget exhausted — see below |

The default is `local`, not `synced`, because most rows never touch the cloud and
a sweeper reading `synced` as "nothing to do" would be one careless `WHERE` clause
away from uploading privacy-mode images. Making the privacy state the default and
naming it distinctly removes that failure mode.

**Deletion interacts with the existing `deleted_at` column.** A user-initiated
delete sets `deleted_at` immediately on every path, online or off, so the row
leaves the picker and stops counting toward the cap at once. What follows depends
on kind:

| Kind | On delete |
|---|---|
| `file`, `inline` | bytes removed and row hard-deleted in the same local transaction (§10) |
| `cloud` | `deleted_at` set, `sync_state='pending_delete'`; bytes then rows reaped by the sweeper |

**A row settles only on server acknowledgement.** The sweeper uploads bytes, then
registers them with `syncCharacterImages`; the row stays `pending_upload` across
both, and becomes `synced` only after the callable returns. Marking it `synced` at
upload time would drop it out of every future sweep — the sweeper queries the
`pending_*` states — so a failed registration would leave bytes in Storage that
the server never learns about. The same rule governs deletion in reverse: objects
are deleted, the row stays a `pending_delete` tombstone, and is hard-deleted
locally only once the server has acknowledged. Hard-deleting first would make the
deletion unretryable, and §13.3's reconcile would then re-insert the image from
the still-live cloud row.

A consequence: a `cloud`-kind row can legitimately be `pending_upload`. That means
"bytes are already in Storage, registration is outstanding" — the sweeper
re-registers it rather than re-uploading, since the local bytes were deleted after
the successful upload.

**Retry driver.** `syncAllToCloud` already runs at app start and on reconnect
(`app/_layout.tsx:201`, `:223`) and already fans out to per-concern helpers. It
gains `syncCharacterImages(localUserId)`, sweeping `pending_upload` and
`pending_delete`. No new scheduler is introduced.

**Retry budget.** Each failed attempt increments `sync_attempts`. Transient
failures retry on the next sweep; after 5 attempts, or immediately on a permission
or quota error that retrying cannot fix, the row moves to `failed` and the sweeper
stops touching it. A `failed` row keeps `kind='file'` and its local bytes, so the
image still resolves and still displays. **Unbounded retry is not the safe
default here** — it burns battery and quota re-attempting an upload that a Storage
rule will reject every time, and it buries the one signal (§11's Snackbar) that
tells the user cloud backup is not happening.

A failed *registration* charges the same budget as a failed upload. Failed
*deletions* deliberately get none: abandoning one leaves the cloud row live, which
resurrects an image the user deleted. Re-sending an id costs nothing, so unbounded
retry is the safer end of that trade.

### 13.2 Identifiers and storage paths

**The image `id` is minted once, on the device that creates the image, and reused
verbatim as the cloud row's primary key.** It is a bare uuid — unlike character
ids, which are `char_`-prefixed locally (`generateLocalCharacterId`,
`characterSyncService.ts:59-61`) but bare uuids in the cloud. Image ids therefore
need no translation and are what §13.3 reconciles on.

Character ids do need translation, and the storage path is where getting it wrong
is unrecoverable:

```text
users/{uid}/characters/{cloudId}/{imageId}.webp
```

**`{cloudId}`, never the local `char_…` id.** The local id is device-private: a
second device restoring the same character holds a different local id, and a path
built from it would be unresolvable there. Cloud `character_images.character_id`
likewise holds the cloud uuid while the local table holds the local id;
`restoreFromCloud` maps between them using the `cloudIdToLocalId` map it already
builds (`characterSyncService.ts:265-274`).

**Ordering.** A character has no cloud id until its first successful sync, so an
image created before then has no path to be written to. `syncCharacterImages`
therefore runs *after* `syncUnsyncedToCloud` — sequentially, not inside the
`Promise.all` beside it (`characterSyncService.ts:232-235`) — and skips any
character still lacking a confirmed `cloud_id`. Those rows stay `pending_upload`
for one more sweep.

The path uses the **confirmed** `cloud_id`, deliberately not `pending_cloud_id`.
The two are equal in the normal case, but the server's returned id is
authoritative; building a path from a locally-guessed id that the server then
disagrees with would strand objects at a location nothing can reach. Waiting one
sweep cycle is the cheaper side of that trade.

### 13.3 Cap enforcement and cross-device deletion

**Server-side cap for cloud characters.** Two devices can each hold fewer than 100
images while the cloud total exceeds it, so a client-only cap cannot be correct. A
new `syncCharacterImagesFn` callable owns the cap for cloud characters: on insert
it evicts the oldest rows beyond 100, exempting `active_image_id`, deletes their
Storage objects, tombstones their rows, and returns the evicted ids for the client
to apply locally. Clients keep enforcing the cap themselves only for `file` and
`inline` rows, where by construction there is one device. `cloud` rows are excluded
from the client's eviction candidates in SQL, before the `LIMIT` — filtering after
it under-evicts whenever the oldest rows happen to include cloud ones — and
filtered again in the caller, because "never hard-delete a cloud row locally" is
load-bearing enough to defend twice: doing so races the server's cap and destroys a
row the sweeper has not reconciled.

**Everything the callable accepts is validated, since it is client-supplied.**
`storagePath` must sit under the caller's own prefix (the security boundary — the
eviction path deletes whatever it is given). `mimeType` is restricted to the two
types §4's rules admit; it is persisted and echoed to every device, where it drives
data-URI construction, so an unvalidated `text/html` would be a stored XSS
primitive on web. `images` and `deletedImageIds` are capped per request, since the
FIFO cap bounds surviving rows but not write volume. `activeImageId` distinguishes
three cases: absent means no change, an explicit `null` clears the pointer (what a
device sends after deleting its last image), and anything else must be a live UUID
on that character — a malformed value is rejected rather than dropped, which would
leave the server stale while the device believed it had synced.

The row upsert is additionally scoped by owner. Its conflict target is the
client-minted image id, so without a `user_id` + `character_id` guard on the update
a guessed or replayed id would overwrite another user's storage paths; with it, a
foreign id no-ops.

**Tombstones, not absence.** `getUserCharactersFn` returns, per character,
`active_image_id` and an `images` array **including tombstones**. On pull the
client:

- inserts rows it does not have, mapping `character_id` through `cloudIdToLocalId`;
- hard-deletes local rows whose cloud counterpart carries `deleted_at`;
- leaves everything else alone.

A local `cloud` row merely *absent* from the response is **not** deleted. Absence
is ambiguous — a truncated response, a partial server failure, and a genuine
remote delete are indistinguishable at the client — and acting on it destroys
images the user paid for, in bulk and silently, which is precisely what §11's
governing rule forbids. An explicit `deleted_at` cannot be produced by a bug in
the read path. The 30-day tombstone window (§3.2) covers every realistic reconnect
gap; a device offline longer keeps rows whose bytes are gone, which the resolver's
degrade path already handles.

Rows in `pending_upload` are excluded from reconciliation entirely — by definition
they have no cloud counterpart yet.

### 13.4 Cloud-side deletion cascade

Nothing today removes Storage objects when a character or a user is deleted
server-side, and the client cannot do it — it may be offline, or the rows may
belong to another device.

- `deleteCharacterFn` drops that character's `character_images` rows — tombstones
  included, since the parent is gone and there is nothing left to reconcile
  against — and then prefix-deletes `users/{uid}/characters/{cloudId}/` via the
  Admin SDK. Rows first: see §10.1 for why this path inverts the single-image
  order, and for the ownership predicate the row delete must carry.
- `adminResetUserState`, which deletes `characters` rows wholesale
  (`functions/src/adminFunctions.ts:496-498`), and `adminDeleteUser`
  (`adminFunctions.ts:534-547`) both prefix-delete `users/{uid}/`. Without this an
  admin reset leaves every image the user ever generated orphaned in the bucket
  with no row referencing it and no way to find it. The two order Storage against
  their row deletes differently, and must — again §10.1.

Prefix deletion is a list-then-delete loop rather than an atomic operation. It is
idempotent, so a partial failure is safe to re-run.

Note that cloud `character_images.character_id` carries
`REFERENCES characters(id) ON DELETE CASCADE`, so deleting a `characters` row
already reaps its image rows. The explicit row deletes above are therefore about
*ordering against Storage*, not about reachability.

### 13.5 Toggling `save_to_cloud`

`save_to_cloud` flips at runtime — `removeCharacterFromCloud` already exists
(`characterSyncService.ts:432`). Write-path routing (§6) picks a mode per image at
creation time, so an unhandled toggle strands a character holding rows in the mode
it just left.

**On.** Existing `file` and `inline` rows are marked `pending_upload` and picked up
by the sweeper, converting to `cloud` on success. This is the same promotion pass
§15 step 3 uses for migration, written once and called from both.

**Off.** Every `cloud` row is pulled back to local storage *before* anything is
destroyed:

1. Download master and thumb for each `cloud` row.
2. Native → write to the `expo-file-system` document directory, `kind='file'`.
   Web → store base64 in the row, `kind='inline'`. There is no file system to
   write to on web; this is the same platform split §6 step 3 already encodes.
3. Only once every row is local: delete the Storage objects and cloud rows.
4. Then clear the cloud link.

**Step 4 must come last, and this is the trap.** `removeCharacterFromCloud`
currently calls `clearCharacterCloudLink` as its final act, nulling `cloud_id` —
and after §13.2, `cloud_id` *is* the storage path. Clearing it before the download
makes every one of that character's cloud images permanently unreachable. The
toggle-off path requires network; offline it must refuse outright rather than
partially proceed.

---

## 14. Default avatar

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

## 15. Migration of existing avatars

DDL lives in numbered SQL migrations 22 and 23. The **data move runs in JS**
(`migrateAvatarsToImageStore()`, guarded by a `kvStorage` flag) because it needs
conditional logic SQL cannot express cleanly.

1. Characters whose `avatar_data` matches the bundled default get **no image row
   at all** and fall through to the bundled asset. This purges the duplicated
   default from every row carrying one.

   Detection is **strict string equality** against `DEFAULT_AVATAR_BASE64`, with
   a length pre-check to keep the common case cheap. This is safe because the
   constant has never changed since it was embedded in commit `bf9d2f66`
   (2026-04-09): only two commits ever touched
   `src/utilities/defaultAvatarBase64.ts`, both inside PR #395, so no release has
   shipped different default bytes. `characterMachine.ts:88` writes the constant
   verbatim, so stored copies are byte-identical rather than re-encoded.
   Characters predating the default-avatar feature have no `avatar_data` at all
   and likewise get no row.

2. Every other character with `avatar_data` gets an `inline` row holding the
   existing base64, `thumb_ref` NULL, and that row is set as the character's
   `active_image_id`. Without that assignment the avatar would sit in the gallery
   while rendering and public import still fell through to the bundled default.
3. A background pass then generates thumbs and promotes `save_to_cloud`
   characters from `inline` to `cloud`.

   **This pass must sniff the actual format rather than trust `mime_type`.**
   `saveCharacterImageLocally` and `useAvatarUpload` hardcode `'image/webp'`, but
   on web `SaveFormat.WEBP` silently produced PNG on browsers without WebP canvas
   encoding (§9) — so some existing rows are PNG bytes labelled WebP. Check the
   base64 prefix: `UklGR` is WebP (RIFF), `iVBORw0KGgo` is PNG, `/9j/` is JPEG.

   Correcting `mime_type` is necessary but not sufficient — §4's rules admit only
   `image/webp` and `image/jpeg`, so even a correctly-labelled PNG is rejected at
   upload. PNG rows are therefore **re-encoded**, not relabelled; the pass is
   already invoking the manipulator to derive thumbs, so the master is re-encoded
   in the same call. Rows staying `inline` (privacy mode) keep their bytes and
   take only the corrected label — nothing rejects them, and re-encoding would
   cost quality for no gain.

`avatar_data` is **left in place and unread for one release** as a rollback net,
then dropped in a follow-up. Nothing else may clear it in the meantime — in
particular `restoreFromCloud` and public import both go through
`batchInsertCharacters`, which is `INSERT OR REPLACE`, so they carry the existing
local value forward instead of writing NULL. Hardcoding NULL there would destroy
the rollback copy of any character a partial migration has not converted yet.

**Idempotency has two layers, because the completion flag alone is not enough.**
A run interrupted before the flag is set would otherwise insert a second row for
every avatar it had already converted. So:

- Per character: a character that already has gallery rows is skipped, whatever
  the flag says. This is what actually makes a re-run safe.
- Per device *and per user*: the completion flag is keyed by user id. The
  migration query is already per-user, and the flag outlives sign-out, so a
  device-wide key would let the first account to finish suppress migration for
  every other account that ever signs in on that device.

The migration is **not gated on connectivity.** It is purely local work, and this
startup path is the only thing that runs it — the reconnect handler retries cloud
sync only. Gating it would strand `avatar_data` until some later launch that
happened to begin online. It is still awaited before `syncAllToCloud`, so migrated
rows carry their final `sync_state` before the sweeper reads them.

---

## 16. Avatar picker UI

A modal on the edit screen: `FlatList numColumns={3}` of thumbs, newest first,
the active one check-marked. Tap to activate; swipe or long-press to delete.
The Generate and Upload buttons move into its header, reusing
`useImageGeneration` and `useAvatarUpload` unchanged.

`CharacterAvatar` also gains `resizeMode: 'cover'` so any non-square image
(legacy migrated avatars) fills rather than letterboxes.

---

## 17. Testing

| Area | Cases |
|---|---|
| Resolver | Dispatch per `storage_kind`; thumb→master fallback when `thumb_ref` NULL |
| Cap eviction | Evicts oldest; **never** evicts the active image; no-op below 100; server-side eviction returns ids the client applies |
| Deletion cascade | Single image deletes bytes before rows, per kind; partial-failure leaves rows; offline `cloud` delete defers as `pending_delete` |
| Deletion ordering | Each §10.1 path orders Storage against rows as tabulated; `adminDeleteUser` deletes the prefix before the `users` row |
| Deletion authorization | A `characterId` owned by another user is rejected **before** any row or object is deleted — asserted on the DB rows, not just the storage path |
| Sync — ids | Storage path uses `cloud_id`, never `char_…`; image id survives round-trip as the cloud PK |
| Sync — ordering | Image with no confirmed `cloud_id` stays `pending_upload` and syncs on the next sweep |
| Sync — reconciliation | Tombstone deletes the local row; **absence does not**; `pending_upload` rows are never reconciled away |
| Sync — retries | `sync_attempts` increments; `failed` after budget; permission error fails fast; `failed` row still resolves locally |
| Privacy toggle | On → promotes to `cloud`; off → downloads before the link is cleared, native `file` vs web `inline`; offline refuses |
| Migration | Default-purge by strict equality; base64→inline row; PNG-mislabelled row re-encoded; idempotency across interruption |
| Upload | Square result on native and web; no upscaling below 1024; 200×200 minimum |
| WebP probe | JPEG fallback recorded in `mime_type` |
| `storage.rules` | uid isolation, size cap, content-type — via emulator |
| Picker | Activate, delete, empty state |

Existing `__tests__/characterAvatarAccessibility.test.tsx` and
`__tests__/useAvatarUpload.test.tsx` are updated, not replaced.

---

## 18. Groundwork for later phases (out of scope)

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

## 19. File map

| Action | Path |
|---|---|
| Create | `src/services/localImageStore.ts` / `.web.ts` |
| Create | `src/services/storageService.ts` / `.web.ts` |
| Create | `src/services/characterImageService.ts` (`saveCharacterImage`, cap, cascade) |
| Create | `src/hooks/useResolvedImage.ts` |
| Create | `src/components/AvatarPicker.tsx` |
| Create | `src/database/migrations/migrateAvatarsToImageStore.ts` |
| Create | `src/services/characterImageSyncService.ts` (sweeper, reconciliation, privacy toggle) |
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
| Modify | `src/services/characterSyncService.ts` (stop nulling avatars; sequence image sync after character sync; reconcile on restore; download-before-unlink in `removeCharacterFromCloud`) |
| Modify | `src/services/apiClient.ts` (`images` on `CharacterSnapshot`; `syncCharacterImagesFn`) |
| Modify | `functions/src/db/schema.ts`, `functions/src/characterFunctions.ts` (signed URL; `syncCharacterImagesFn` with server-side cap; `images` in `getUserCharacters`; Storage prefix delete in `deleteCharacter`) |
| Modify | `functions/src/adminFunctions.ts` (prefix-delete `users/{uid}/` in `adminResetUserState` and `adminDeleteUser`) |
| Modify | `firebase.json` (storage block) |
| Delete | `src/utilities/defaultAvatarBase64.ts`, `src/utilities/loadDefaultAvatar.ts`, `src/services/defaultAvatarService.ts`, `src/services/localImageStorageService.ts` |

# Image Pipeline — Phase 2: Vision and Chat Uploads

**Date:** 2026-08-10
**Status:** Design
**Depends on:** `2026-07-28-image-pipeline-refactor-design.md` (Phase 1, Implemented)
**Scope:** The user sends a photo during chat and the character sees it on that
turn. The photo joins the character's existing image gallery and can later be
picked as an avatar. Agent-initiated image generation, and an agent tool for
looking at arbitrary gallery images, remain out of scope — see §11.

---

## 1. What this adds

Today the `+` button in `ChatComposer` (`src/components/ChatComposer.tsx:80`)
accepts images, but only to feed them through `convertDocumentText` into the
character's wiki memory as text. Nothing in the app ever puts an image in front
of the model as an image, and nothing renders an image inside a chat bubble.

Phase 2 closes that. A user picks or captures a photo, sends it as a chat
message, and the character's reply is conditioned on the actual pixels. The
photo is durable: it appears in scrollback, syncs across devices, and lands in
the same per-character gallery that already holds generated and uploaded
avatars — so the user can later promote any photo they sent to be the
character's avatar.

Phase 1 built the seams this needs. `imageVariants.ts` already carries the
comment that it is "shared verbatim by the write path, the legacy-avatar
migration, and — later — the Vision upload path." This is that later.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Agent path | Cloud agent only | The edge path's `ContentPart` union has no image variant; adding one there duplicates plumbing for a model tier that already sheds capability elsewhere. See §3 |
| Persistence | Durable, in `character_images` | The user asked for one gallery per character combining avatars, chat uploads, and (later) generated images — not a parallel attachment store |
| Message linkage | Nullable `message_id` on `character_images` | One table, one sync flow. A join table would add a second thing to sync for no gain — see §4.2 |
| Aspect ratio | Preserved for chat photos | A photo of a landscape must not be centre-cropped to a square before the model sees the subject the question is about — see §4.3 |
| Model delivery | Client sends base64 `inlineData` | The manipulator already yields base64; a Storage round-trip would make the reply wait on an upload it does not need |
| Vision scope | Current turn only | Re-sending every past photo on every turn grows the payload without bound. Recall of older images becomes an agent tool in Phase 3 — see §11 |
| Entry point | The existing `+` picker, branched on file type | Image types are already accepted there; adding a second icon splits one "attach something" affordance in two |
| Camera | Included | `expo-image-picker` is already a dependency via `useAvatarUpload` |
| Save on failure | Image is kept regardless of reply outcome | Phase 1 §11's governing rule, applied to user effort rather than credits |

---

## 3. Why cloud-agent only

The chat stack has two paths (`src/hooks/useAIChat.ts:107`, `:155`). Both end at
a vision-capable Gemini Flash model; the constraint is entirely in the app's own
payload types.

- **Edge** (`src/hooks/useEdgeAgent.ts:33-35`) types a part as
  `{text} | {functionCall} | {functionResponse}`. There is no `inlineData`
  variant, and the callable behind it (`functions/src/generateReply.ts`) builds
  text-only `Content[]`.
- **Cloud agent** (`src/services/cloudAgentService.ts:19-23`) already types
  `history` as `@google/genai`'s `Content[]`, which admits `inlineData`
  natively. Only the `message` field — a bare `string` — blocks an image.

Extending the edge path means a second `ContentPart` union, a second server
validator, and a second `newMessage` construction, for a path that is already
the reduced-capability tier (it cannot mix `googleSearch` with custom tools,
which is why `escalate_to_cloud_agent` exists). Phase 2 follows the established
pattern: capability gaps are resolved by routing to the cloud agent, not by
widening the edge.

**Consequence for the UI.** Photo send requires `canUseCloudAgent`
(`useAIChat.ts:70`). When it is false, the photo option is **disabled with an
explanation**, never silently degraded to a text-only turn. A quiet fallback
would produce a character that answers confidently about an image it never
received, which is worse than a refusal.

---

## 4. Data model

### 4.1 Local SQLite (`src/database/schema.ts`)

Migration 24 (the highest existing index is 23):

```sql
ALTER TABLE character_images ADD COLUMN message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_character_images_message
  ON character_images(message_id) WHERE message_id IS NOT NULL;
```

`source` gains the value `'chat'` alongside `'generated' | 'uploaded' |
'imported'`. It is a free-text column, so no DDL changes — only the TypeScript
union and its validators.

### 4.2 Cloud Postgres (`functions/src/db/schema.ts`)

Hand-write `functions/drizzle/0023_character_images_chat.sql` (the highest
existing file is `0022_character_images.sql`). Do **not** run `drizzle-kit
generate` — the journal is out of sync with the migration directory.

```sql
ALTER TABLE character_images ADD COLUMN message_id text;
```

**Deliberately not a foreign key to `messages`.** `syncCharacterImages` and
message sync are independent flows that can land in either order, so a device
may legitimately register an image row for a message the server has not received
yet. A FK would reject that write and strand the image. This is the same
reasoning Phase 1 §3.2 applied to `active_image_id`, and it has the same
consequence: dangling pointers are tolerated and handled at read time (§7).

**`message_id` is a safe cross-device join key** because message ids are
client-minted and stable — the local `messages.id` is carried verbatim into the
cloud row's `messageId`. Unlike character ids, there is no local/cloud
translation to get wrong.

### 4.3 Aspect ratio

`imageVariants.ts` keeps its 1024-longest-edge master and 256 thumb
(`imageVariants.ts:16-17`), never upscaling. What becomes conditional is the
**square-crop stage**, which today runs for every upload:

| Source | Square crop |
|---|---|
| `generated` | Already 1024×1024 from the model |
| `uploaded` (avatar picker) | Yes — OS cropper on native (`useAvatarUpload.ts`), centre-crop on web |
| `chat` | **No** — native aspect ratio preserved |
| `imported` | Unchanged from Phase 1 |

A non-square row in the gallery is already safe: `CharacterAvatar` gained
`resizeMode: 'cover'` in Phase 1 §16 precisely so legacy non-square avatars fill
the circle rather than letterbox. A chat photo promoted to avatar is
centre-cropped **at display time**, which is reversible, instead of at capture
time, which is not.

### 4.4 Cap and storage layout

Unchanged. Storage path stays `users/{uid}/characters/{cloudId}/{imageId}.webp`
— no separate `chat_attachments/` prefix, because these rows are gallery rows.
The 100-image FIFO cap (Phase 1 §6, §13.3) counts chat photos like everything
else, and chat photos get **no special exemption**; only `active_image_id` is
exempt. Eviction of a chat photo still referenced by a visible message is
handled at read time (§7), not prevented.

---

## 5. Entry point

`handlePlusPress` (`ChatComposer.tsx:80`) currently routes every accepted type,
images included, into wiki ingestion. `CONVERT_MIME_TYPES`
(`src/components/documentMimeTypes.ts`) already lists `image/png`, `image/jpeg`,
`image/webp`.

**That existing behaviour must not change silently.** A user who has been
dropping screenshots in to build the character's memory would otherwise find
those screenshots becoming chat messages. So when the picked file is an image,
the composer presents a choice:

- **Send in chat** — the new path.
- **Add to memory** — the existing `convertDocumentText` → wiki flow, unchanged.

Non-image picks (`.txt`, `.md`, `.pdf`, `.docx`) show no prompt and behave
exactly as today.

A third entry, **Take photo**, opens `ImagePicker.launchCameraAsync` and goes
straight to *send in chat* — capturing a photo in order to file it into memory
is not a flow anyone asks for, so it is not offered. Camera permission is
requested at first use and a denial surfaces in the existing toast, matching
`useAvatarUpload`'s handling of a denied photo library.

The picker branch lives in a new `src/hooks/useChatPhotoUpload.ts` so
`ChatComposer` does not grow a second large async handler; the existing
memory-ingestion body stays where it is.

---

## 6. Send path

1. **Resize.** `imageVariants.ts` with the square-crop stage skipped (§4.3).
   Master and thumb derived as usual.
2. **Hold the master's base64** in memory for the model call.
3. **Persist the user message first**, as today (`persistUserMessage`,
   `useAIChat.ts`), so the bubble is visible while the model is thinking.
4. **Write the image row** via `saveCharacterImage({ source: 'chat', messageId })`.
   This follows Phase 1 §6 verbatim, reservation protocol included — a cloud
   save reserves the row as `sync_state='reserved'` before uploading bytes, so a
   hard kill mid-upload cannot leave unreferenced billable objects.
5. **Call the cloud agent** with the attachment (§6.1).
6. **Persist the reply** as today.

Steps 4 and 5 are independent: the image is committed whether or not step 5
succeeds (§7).

### 6.1 Both transports must carry the attachment

`callCloudAgent` tries WebSocket first and falls back to HTTP after a
transport-level failure, with a 60-second cooldown
(`cloudAgentService.ts:284-304`). The two are served by **separate handlers with
separate Zod schemas that each build `newMessage` independently**:

| Path | Schema | `newMessage` construction |
|---|---|---|
| HTTP | `cloud-agent/src/index.ts:211` | `:113` |
| WS | `cloud-agent/src/handlers/wsAgentHandler.ts:30` | `:205` |

Adding the field to one and not the other produces a feature that works or
silently drops the image **depending on network conditions at that moment** —
close to the worst possible failure mode, because it is intermittent, invisible,
and unreproducible on a healthy connection. Both are changed together, and §10
tests both.

`CloudAgentPayload` gains:

```ts
attachments?: { mimeType: string; data: string }[]
```

Both schemas validate it identically: at most **one** attachment in Phase 2,
`mimeType` restricted to `image/webp` and `image/jpeg` (the two types Phase 1
§4's Storage rules admit — keeping the sets aligned means a photo the model
accepts is always a photo the gallery can store), and `data` capped at
**1,400,000 base64 characters** (≈1 MB decoded), which is generous against the
~200 KB a 1024px WebP actually produces while leaving headroom under §6.3's 2 MB
body limit for history. Both `newMessage` constructions become:

```ts
{ role: 'user', parts: [...attachments.map((a) => ({ inlineData: a })), { text: message }] }
```

Attachments precede the text so the question reads as being *about* the image.

### 6.2 Captionless photos

Both schemas today declare `message: z.string().trim().min(1)`. Sending a photo
with no caption is an ordinary thing to do, and under the current validators it
fails with an opaque `INVALID_REQUEST` on both paths.

The rule becomes: **text may be empty if and only if at least one attachment is
present.** Empty text with no attachment stays rejected. This is a cross-field
refinement, not a relaxation of the string rule — dropping `min(1)` outright
would let a genuinely empty turn through and spend a credit on nothing.

### 6.3 Payload budget

`express.json({ limit: '2mb' })` (`cloud-agent/src/index.ts:154`) bounds the
whole request, history included. A 1024px WebP at q0.85 is roughly 150 KB, about
200 KB base64 — comfortable against a 2 MB ceiling shared with ~20 turns of text
history. The one-attachment cap keeps it that way; raising it later means
revisiting this limit deliberately rather than discovering it as a 413 in
production.

### 6.4 Credits

A vision turn costs the same as any other cloud-agent turn. No new pricing, no
new constant. If image input turns out to move token cost materially, that is a
pricing change to make on evidence, not a guess baked into this phase.

---

## 7. Failure, retry, and dangling pointers

**A failed reply keeps the photo.** The image row is committed at step 4, before
the model is called. Phase 1 §11's governing rule — never lose an image the user
spent something on — extends from credits to effort: a user who framed and sent
a photo should not have to re-pick it because the network dropped.

**Retry reuses the row.** A retried vision turn finds the existing row by
`message_id` rather than writing a second one, which would otherwise consume two
slots against the FIFO cap for one photo. It re-obtains base64 through the
Phase 1 resolver (`resolveImageUri`) rather than the in-memory copy, because a
`cloud`-kind row's local bytes are deleted after a successful upload — so on a
cold retry, or a retry after app restart, the original base64 is gone and only
the resolver can produce it.

**Dangling pointers are tolerated in both directions**, matching §4.2's decision
not to enforce referential integrity:

| Event | Effect |
|---|---|
| Photo deleted from the Avatar Picker | Message keeps its text; the bubble degrades via `CharacterAvatar`'s existing `onError` fallback (Phase 1 §11) |
| Message deleted | Image **stays** in the gallery — it is a gallery image now, and §11 forbids destroying it. `message_id` becomes dangling, which nothing reads destructively |
| Cap eviction takes a chat photo | Same degrade as the first row. Not prevented; only the active image is exempt |

**Sync is two independent flows and neither blocks on the other.** The image row
rides the existing `syncCharacterImages` sweeper (Phase 1 §13); the message
rides message sync. On a second device either may arrive first:

- Message present, image row not yet → the bubble shows a placeholder and
  resolves once the row lands.
- Image row present, message not yet → it is simply a gallery image, which is
  correct and harmless.

**Absence of a counterpart never deletes anything**, on either side. This is
Phase 1 §13.3's "tombstones, not absence" rule applied across the message/image
boundary: a truncated response, a partial failure, and a genuine remote delete
are indistinguishable at the client, and acting on absence destroys user data.

---

## 8. Rendering

**The render hint travels on the message.** The image id is written into the
message's `message_data` JSON in addition to `character_images.message_id`.
`src/database/messageDatabase.ts:35` already spreads that blob into the
`IMessage` on read, and it already syncs to the cloud in the `messageData`
jsonb column — so the chat list gets the image id with **no extra query and no
new sync path**. The alternative, joining `character_images` by the visible
page's message ids, adds a query per page render for information the message can
simply carry.

This is a denormalisation, and it is safe because it is **write-once**: the
field is set when the message is created and never updated. If the two ever
disagree, `character_images.message_id` is authoritative for gallery purposes;
`message_data.imageId` is a render hint only.

It also has an ordering benefit — a device whose message synced first knows an
image is coming and can show a placeholder rather than a plain text bubble that
silently gains an image later.

**Components.** A new `src/components/ChatImageBubble.tsx` renders the 256 thumb
through `useResolvedImage(imageId, 'thumb')`, wired via GiftedChat's
`renderMessageImage`. Tapping opens a full-screen viewer on the master. Download
and share stay in Phase 3, where they arrive with `expo-media-library` /
`expo-sharing` for agent-generated images.

**History stays text-only.** `buildContentHistory` is unchanged: a past photo
turn appears in history as its caption, or as `[sent a photo]` when captionless,
so the transcript remains coherent without re-sending bytes on every turn. The
model can see that a photo was sent earlier; it cannot see the photo again. That
is the deliberate boundary §11 lifts.

---

## 9. Security and validation

Everything the cloud agent accepts is client-supplied and validated on both
transports:

- **`mimeType`** is restricted to `image/webp` and `image/jpeg`. This is not
  only about what the model will accept: the same value is persisted on the
  image row and echoed to every device, where it drives data-URI construction on
  web. Phase 1 §13.3 already treats an unvalidated MIME type as a stored-XSS
  primitive, and the same reasoning applies here.
- **Attachment count** is capped at 1, and `data` length at 1,400,000 base64
  characters (§6.1), so an oversized request fails Zod validation with a
  readable error rather than arriving as a 413 the client cannot interpret.
- **Base64 payloads are never logged**, including in error paths — a vision
  request body is user photo content.
- Storage writes go through `saveCharacterImage` unchanged, so Phase 1's
  `storage.rules` (uid isolation, 2 MB cap, content-type restriction) apply
  without modification. **No `storage.rules` change is needed or wanted** —
  Phase 1 §20.2 records that the rules file has no emulator coverage and should
  not be edited without cause.

---

## 10. Testing

| Area | Cases |
|---|---|
| Variants | `source:'chat'` preserves aspect ratio; `source:'uploaded'` still squares; neither upscales below 1024 |
| Picker branch | Image pick prompts send-vs-memory; `.txt`/`.pdf`/`.docx` pick does **not** prompt and still ingests; camera entry goes straight to chat; denied camera permission surfaces in the toast |
| Transport parity | `inlineData` present in `newMessage.parts` on the **HTTP** path and on the **WS** path; a fixture asserted against both schemas |
| Captionless | Empty text with an attachment is accepted on both paths; empty text with no attachment is still rejected on both |
| Validation | `mimeType` outside the allowed pair rejected; two attachments rejected; oversized decoded payload rejected |
| Edge gating | A character without `canUseCloudAgent` disables the photo option; no silent text-only send |
| Persistence | Image row committed when the reply throws; row carries `source:'chat'` and `message_id` |
| Retry | Retry reuses the existing row rather than inserting a second; base64 re-obtained via the resolver after local bytes are gone |
| Dangling | Deleting the image degrades the bubble without touching the message; deleting the message leaves the image in the gallery; evicted chat photo degrades |
| Cross-device | Message-before-image renders a placeholder then resolves; image-before-message is a plain gallery row; neither ordering deletes anything |
| Gallery | A chat photo is pickable as an avatar and displays cropped-to-fill, not letterboxed |
| Render | Thumb variant used in the bubble; tap opens the master |

---

## 11. Groundwork for later phases (out of scope)

**Agent gallery vision.** The character should eventually be able to look at any
image in its gallery on its own initiative — including its own avatar. Phase 2
deliberately builds toward this without implementing it: every image the user
sends now lands in `character_images` alongside avatars, addressed by a stable
id, resolvable on any device. What is missing is a tool the agent can call to
fetch one by id and receive it as `inlineData` on a later turn. That is a
tool-definition and a server-side resolver, not a data-model change — which is
the point of putting chat photos in the shared gallery rather than a private
attachment store.

**Agent image generation.** Unchanged from Phase 1 §18: a tool that generates an
image, persists it into the same table with `source='agent'`, renders in the
chat bubble, and taps through to a zoom modal with download via
`expo-media-library` / `expo-sharing`. Phase 2's `ChatImageBubble` and
`message_id` linkage are exactly what it renders through.

**Multi-image turns.** The one-attachment cap (§6.1) is a payload-budget
decision, not a model limitation. Raising it means revisiting §6.3's 2 MB
ceiling deliberately.

---

## 12. File map

| Action | Path |
|---|---|
| Create | `src/hooks/useChatPhotoUpload.ts` (picker branch, camera, resize, send) |
| Create | `src/components/ChatImageBubble.tsx` (thumb in bubble, tap-to-view) |
| Modify | `src/database/schema.ts` (migration 24: `message_id` + index) |
| Modify | `src/database/characterImageDatabase.ts` (`message_id` on insert; lookup by `message_id`) |
| Modify | `src/services/characterImageService.ts` (`source:'chat'`, `messageId` param) |
| Modify | `src/services/imageVariants.ts` (square-crop stage made conditional) |
| Modify | `src/components/ChatComposer.tsx` (image branch; memory path unchanged) |
| Modify | `src/hooks/useAIChat.ts` (attachment through the send path; cloud-agent gating) |
| Modify | `src/services/cloudAgentService.ts` (`attachments` on `CloudAgentPayload`; WS and HTTP) |
| Modify | `src/database/messageDatabase.ts` / `src/services/messageService.ts` (image id in `message_data`) |
| Create | `functions/drizzle/0023_character_images_chat.sql` |
| Modify | `functions/src/db/schema.ts` (`messageId` on `character_images`) |
| Modify | `functions/src/characterFunctions.ts` (`messageId` accepted and echoed by `syncCharacterImages`) |
| Modify | `cloud-agent/src/index.ts` (HTTP schema; `newMessage` parts) |
| Modify | `cloud-agent/src/handlers/wsAgentHandler.ts` (WS schema; `newMessage` parts) |

---

## 13. Known gaps

**A photo can outlive the message that introduced it, and vice versa.** This is
chosen, not overlooked (§7). The alternative — cascading deletes across a link
with no referential integrity and two independent sync flows — would delete user
images on the strength of a counterpart's absence, which Phase 1 §13.3 rejects
explicitly.

**The retry path re-encodes.** Re-obtaining base64 through the resolver after a
cloud upload means downloading and re-encoding bytes the device just uploaded.
This only happens on a cold retry of a failed vision turn, which is rare, and the
alternative — caching base64 across app restarts — is a second copy of user photo
content in a second place with its own lifecycle. Not worth it at this frequency.

**`message_data.imageId` is denormalised.** Justified in §8 by the write-once
property and the query it removes from every page render. If a future feature
ever needs to *change* which image a message shows, this decision has to be
revisited rather than extended.

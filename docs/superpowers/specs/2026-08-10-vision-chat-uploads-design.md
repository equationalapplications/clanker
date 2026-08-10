# Image Pipeline — Phase 2: Vision and Chat Uploads

**Date:** 2026-08-10
**Status:** Implemented
**Implementation date:** 2026-08-10
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
| Wire contract | Single definition in `shared/cloudAgentProtocol.ts` | The WS and HTTP handlers already duplicate their schemas; extending that duplication makes an intermittent, network-dependent bug possible. See §6.1 |

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

### 6.1 One wire contract, two transports

`callCloudAgent` tries WebSocket first and falls back to HTTP after a
transport-level failure, with a 60-second cooldown
(`cloudAgentService.ts:284-304`). HTTP is a **permanent fallback for WS-hostile
networks**, not scaffolding awaiting removal — all three WS endpoints
(`/agent/stream`, `/agent/live`, `/agent/browser`) are live, and real users land
on the HTTP path whenever a proxy or carrier blocks the upgrade.

Today the two are served by separate handlers that **duplicate their request
schema and their `newMessage` construction**:

| Path | Schema | `newMessage` construction |
|---|---|---|
| HTTP | `cloud-agent/src/index.ts:211` (with `contentSchema` at `:39-42`) | `:113` |
| WS | `cloud-agent/src/handlers/wsAgentHandler.ts:30` (with `contentSchema` at `:23-27`) | `:205` |

`contentSchema` is already copy-pasted verbatim between the two, and the
`agentRunSchema` fields differ only incidentally. Adding `attachments` to one and
not the other would produce a feature that works or silently drops the image
**depending on network conditions at that moment** — intermittent, invisible, and
unreproducible on a healthy connection.

**"Change both files" is rejected as the mitigation.** A convention that must be
remembered on every future edit is the weakest available control, and this
duplication has already survived long enough to be copied once. The contract is
made structurally single instead.

**`shared/cloudAgentProtocol.ts`** becomes the one definition of the agent-run
wire format: `contentSchema`, `agentRunSchema`, `attachmentSchema`, the
`ATTACHMENT_MIME_TYPES` allowlist, and `MAX_ATTACHMENT_BASE64_CHARS`. Both
handlers import it; neither declares a schema of its own. This is a proven path —
`cloud-agent` already imports Zod schemas from `shared/`
(`wsBrowserAgentHandler.ts:9`, `schedulerTriggerHandler.ts:8`) and its tsconfig
carries `"rootDir": ".."` with `"include": ["src", "../shared"]`.

**`cloud-agent/src/agentMessage.ts`** exports `buildNewMessage(message,
attachments)`, called by both handlers, so the two transports cannot feed
structurally different prompts to the model:

```ts
{ role: 'user', parts: [
  ...attachments.map((a) => ({ inlineData: a })),
  ...(message.length > 0 ? [{ text: message }] : []),
] }
```

Attachments precede the text so the question reads as being *about* the image,
and the trailing text part is omitted when the caption is empty (per §6.2).
A captionless photo therefore produces a single `inlineData` part, not
`{ text: '' }` next to it.

`CloudAgentPayload` gains `attachments?: { mimeType: string; data: string }[]`.
The schema admits at most **one** attachment in Phase 2, restricts `mimeType` to
`image/webp` and `image/jpeg` (the two types Phase 1 §4's Storage rules admit —
aligned sets mean a photo the model accepts is always a photo the gallery can
store), and caps `data` at **1,400,000 base64 characters** (≈1 MB decoded):
generous against the ~200 KB a 1024px WebP produces, with headroom under §6.3's
2 MB body limit for history.

#### Client-side reuse is a second, gated step

Sharing the same module with the *client* would also give pre-flight validation
before a wasted round-trip. That is desirable but **not proven in this repo**, and
it is not on the critical path:

- No `shared/` module is currently imported from both sides. The directory is
  partitioned in practice — `dsl-*`, `constants`, and `hostPolicy` are
  cloud-agent-only; `localCloudAgent` is app-only and is *explicitly excluded* by
  `cloud-agent/tsconfig.json`.
- `cloud-agent` is `moduleResolution: nodenext`, which **requires** a `.js`
  specifier on relative imports. There are **zero** `.js`-suffixed relative
  imports anywhere in `src/`, so Metro's handling of `'../../shared/x.js'` →
  `shared/x.ts` is untested here.

`shared/` *is* in Metro's `watchFolders` and the root tsconfig compiles it, so
this will probably work. **Verify it with a throwaway import before relying on
it.** If it resolves, the client imports `ATTACHMENT_MIME_TYPES` and
`MAX_ATTACHMENT_BASE64_CHARS` directly. If it does not, the client keeps its own
copy of those two constants and a test asserts equality against the shared
module — the §9 pattern, applied one boundary further out. Either way the
server-side contract is already single, which is where the correctness risk lives.

### 6.2 Captionless photos

Both schemas today declare `message: z.string().trim().min(1)`. Sending a photo
with no caption is an ordinary thing to do, and under the current validators it
fails with an opaque `INVALID_REQUEST` on both paths.

The rule becomes: **text may be empty if and only if at least one attachment is
present.** Empty text with no attachment stays rejected. This is a cross-field
refinement, not a relaxation of the string rule — dropping `min(1)` outright
would let a genuinely empty turn through and spend a credit on nothing.

The refinement lives on `agentRunSchema` in `shared/cloudAgentProtocol.ts`
(§6.1), so it is expressed once. A cross-field rule is exactly the kind that
diverges when copied: the two halves look independently reasonable, and a
handler that kept `min(1)` while gaining `attachments` rejects captionless
photos on that transport alone — the intermittent failure §6.1 exists to make
impossible.

### 6.3 Payload budget

`express.json({ limit: '2mb' })` (`cloud-agent/src/index.ts:154`) bounds the
whole request, history included. A 1024px WebP at q0.85 is roughly 150 KB, about
200 KB base64 — comfortable against a 2 MB ceiling shared with ~20 turns of text
history. The one-attachment cap keeps it that way; raising it later means
revisiting this limit deliberately rather than discovering it as a 413 in
production.

There are two distinct rejection paths the client can hit, and they are not
symmetric:

- **413 Payload Too Large** — the body exceeds `express.json`'s 2 MB limit
  *before* the handler runs. `agentRunSchema` never gets to see it; the body is
  gone by the time validation could log a useful reason. `runViaHttp`
  surfaces this as `Cloud Agent responded with 413` (status only, no body), so
  the user sees a generic failure. The mitigation is keeping the budget here,
  not making the schema stricter.
- **400 Bad Request** — the body fits, but `agentRunSchema.safeParse` rejects
  it (e.g. wrong mime, `data` over `MAX_ATTACHMENT_BASE64_CHARS`, an extra
  attachment). The handler returns `{ error: 'Invalid request body' }` with no
  field-level detail, and `runViaHttp` again discards the body. The user
  sees the same generic status-only message.

`runViaHttp` deliberately does not parse the response body for non-2xx
outcomes — only the status reaches `useAIChat`. Documenting this so the next
person looking at a "413 vs 400" bug in the client knows that schema
validation is not where every oversize rejection is caught.

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
slots against the FIFO cap for one photo. The retry path uses the original
base64 the user just prepared, because `PendingChatPhoto` lives in memory for
the duration of the turn.

**The cold-retry path is not implemented.** `PendingChatPhoto` is in-memory
only — process death or app restart loses the bytes the user just sent. A
durable retry queue (or committing the base64 alongside the image row) is a
follow-up; the current implementation surfaces the original error on a true
cold retry rather than silently re-sending stale bytes from Storage. The
test matrix reflects this: in-memory retry reuses the row and the bytes; cold
retry after restart is not yet supported and is the documented gap in §13.

**Dangling pointers are tolerated in both directions**, matching §4.2's decision
not to enforce referential integrity:

| Event | Effect |
|---|---|
| Photo deleted from the Avatar Picker | Message keeps its text; the bubble degrades via `ChatImageBubble`'s `Photo unavailable` placeholder. The placeholder renders only after `useResolvedImage` completes the lookup and finds no row — a row still in flight shows nothing rather than the misleading "unavailable" label. |
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

- **`mimeType`** is restricted to `image/webp` and `image/jpeg` via
  `ATTACHMENT_MIME_TYPES`. This is not only about what the model will accept:
  the same value is persisted on the image row and echoed to every device, where
  it drives data-URI construction on web. Phase 1 §13.3 already treats an
  unvalidated MIME type as a stored-XSS primitive, and the same reasoning applies
  here.
- **Attachment count** is capped at 1, and `data` length at
  `MAX_ATTACHMENT_BASE64_CHARS` (1,400,000; §6.1), so an oversized request fails
  Zod validation with a readable error rather than arriving as a 413 the client
  cannot interpret.
- **Base64 payloads are never logged**, including in error paths — a vision
  request body is user photo content.
- Storage writes go through `saveCharacterImage` unchanged, so Phase 1's
  `storage.rules` (uid isolation, 2 MB cap, content-type restriction) apply
  without modification. **No `storage.rules` change is needed or wanted** —
  Phase 1 §20.2 records that the rules file has no emulator coverage and should
  not be edited without cause.

**The one boundary code cannot cross is `storage.rules`**, a Firebase rules file
that cannot import TypeScript. Its content-type allowlist and the
`ATTACHMENT_MIME_TYPES` constant must agree — a type the agent accepts but the
rules reject produces a photo the model sees and the gallery then fails to store,
which §7's "save regardless" promise would quietly break.

Phase 1 set the pattern for exactly this: `__tests__/storageRules.test.ts` asserts
`cors.json`'s origin against `SITE_BASE` so the two cannot drift. The same test
file gains an assertion binding the rules file's content-type strings to
`ATTACHMENT_MIME_TYPES`. Where a single source of truth is impossible, a test
that fails on divergence is the next-best control — and unlike a comment saying
"keep in sync", it runs.

---

## 10. Testing

| Area | Cases |
|---|---|
| Variants | `source:'chat'` preserves aspect ratio; `source:'uploaded'` still squares; neither upscales below 1024 |
| Picker branch | Image pick prompts send-vs-memory; `.txt`/`.pdf`/`.docx` pick does **not** prompt and still ingests; camera entry goes straight to chat; denied camera permission surfaces in the toast |
| Transport parity | Both handlers import `agentRunSchema` from `shared/` and call `buildNewMessage` — asserted structurally (no locally-declared schema, no inline `parts` literal), not by duplicating payload cases per transport |
| Wire contract | `buildNewMessage` puts `inlineData` parts before the text part; omits the text part rules per §6.2; one table-driven suite over `agentRunSchema` |
| Captionless | Empty text with an attachment accepted; empty text with no attachment rejected — once, against the shared schema |
| Validation | `mimeType` outside `ATTACHMENT_MIME_TYPES` rejected; two attachments rejected; `data` over `MAX_ATTACHMENT_BASE64_CHARS` rejected |
| Cross-boundary | `storage.rules` content types match `ATTACHMENT_MIME_TYPES` (extends `__tests__/storageRules.test.ts`); if the client keeps its own constants (§6.1), they equal the shared module's |
| Edge gating | A character without `canUseCloudAgent` disables the photo option; no silent text-only send |
| Persistence | Image row committed when the reply throws; row carries `source:'chat'` and `message_id` |
| Retry | Retry reuses the existing row rather than inserting a second; the same in-memory `PendingChatPhoto` bytes are used. Cold retry after app restart is not yet supported (see §13) |
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
| Create | `shared/cloudAgentProtocol.ts` (`contentSchema`, `agentRunSchema`, `attachmentSchema`, `ATTACHMENT_MIME_TYPES`, `MAX_ATTACHMENT_BASE64_CHARS`) |
| Create | `cloud-agent/src/agentMessage.ts` (`buildNewMessage`) |
| Modify | `cloud-agent/src/index.ts` (**delete** local `contentSchema`/`agentRunSchema`; import shared; call `buildNewMessage`) |
| Modify | `cloud-agent/src/handlers/wsAgentHandler.ts` (same deletions and imports) |
| Modify | `__tests__/storageRules.test.ts` (bind rules content types to `ATTACHMENT_MIME_TYPES`) |

---

## 13. Known gaps

**A photo can outlive the message that introduced it, and vice versa.** This is
chosen, not overlooked (§7). The alternative — cascading deletes across a link
with no referential integrity and two independent sync flows — would delete user
images on the strength of a counterpart's absence, which Phase 1 §13.3 rejects
explicitly.

**Cold retry after app restart is not implemented.** `PendingChatPhoto` lives
in memory for the lifetime of the turn; process death loses the bytes the
user just sent. A durable retry queue (or committing the base64 alongside the
image row) is a follow-up that costs a second copy of user photo content in
a second place with its own lifecycle — not in scope for this phase. Until
that lands, the client surfaces the original error on a true cold retry
rather than silently re-sending stale bytes from Storage.

**`message_data.imageId` is denormalised.** Justified in §8 by the write-once
property and the query it removes from every page render. If a future feature
ever needs to *change* which image a message shows, this decision has to be
revisited rather than extended.

**Client-side import of `shared/cloudAgentProtocol.ts` is unverified.** §6.1
records the specifics: `cloud-agent` is `moduleResolution: nodenext` and needs
`.js` specifiers, the app has never used one, and no `shared/` module is
currently consumed from both sides. The server-side dedupe — where the
correctness risk actually lives — does not depend on this. Resolve it with a
throwaway import at the start of implementation rather than discovering it in a
Metro bundling error halfway through; the fallback (client constants plus an
equality test) is one small test, not a redesign.

**Hoisting `agentRunSchema` touches the browser-bridge and voice paths'
neighbour code.** The schemas being moved serve `/agent/stream` only, not
`/agent/live` or `/agent/browser`, so the blast radius is limited — but
`cloud-agent/src/index.ts` is a large file with several handlers, and the
deletion should be verified as removing *only* the text-chat schemas.

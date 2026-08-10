# Vision and Chat Uploads (Image Pipeline Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user attaches or captures a photo in chat, the cloud agent sees the actual pixels on that turn, and the photo persists as an ordinary row in the character's image gallery.

**Architecture:** The agent-run wire contract is hoisted out of the two duplicated cloud-agent handlers into `shared/cloudAgentProtocol.ts` so WS and HTTP cannot diverge; a zod-free `shared/cloudAgentAttachments.ts` holds the constants the app also needs. The photo is resized once by the existing `imageVariants` pipeline (square-crop skipped), committed to `character_images` with `source='chat'` and a nullable `message_id`, and its master base64 is handed to the cloud agent as an `inlineData` part. The render hint (`imageId`) rides in the message's existing `message_data` blob, so the chat list needs no extra query and no new sync path.

**Tech Stack:** Expo/React Native + expo-sqlite + react-native-gifted-chat (app), Zod + Express + `ws` + `@google/adk` (cloud-agent), Firebase Callable Functions + Drizzle/Postgres (functions), Jest (app/shared tests) and `node:test` (cloud-agent tests).

---

## Deviations from the spec (read before starting)

Three things in the spec's file map do not survive contact with the code. Each is
resolved here in the spirit of the spec's own reasoning:

1. **`src/services/imageVariants.ts` needs no change.** The spec (§4.3) describes
   making "the square-crop stage" conditional, but `prepareImageVariants` never
   crops — it only resizes on the longest edge and never upscales. The squaring
   lives in `useAvatarUpload.ts` (`centreCropToSquare` on web, the OS cropper via
   `allowsEditing` on native). The chat path therefore gets aspect preservation
   by *not* calling those, and Task 9 pins that with a test rather than a change.

2. **The constants are split out of `shared/cloudAgentProtocol.ts`.** The spec
   puts `ATTACHMENT_MIME_TYPES` and `MAX_ATTACHMENT_BASE64_CHARS` in the same
   module as the Zod schemas. `zod` is a `cloud-agent` dependency and is **not**
   declared in the app's `package.json` (only present in root `node_modules` as a
   transitive), so a client import of that module would pull Zod into the Metro
   bundle through an undeclared dependency. Task 1 puts the constants in a
   dependency-free `shared/cloudAgentAttachments.ts` which both the schema module
   and the client import. This makes §13's "unverified client-side import" gap
   cheap rather than risky — Task 0 still verifies it before anything depends on it.

3. **`saveCharacterImage` gains three optional inputs** (`imageId`, `messageId`,
   `variants`) and stops setting the active-image pointer for `source: 'chat'`.
   The spec assumed `saveCharacterImage({ source: 'chat', messageId })` drops in,
   but today it unconditionally calls `setActiveImageId` — which would make every
   photo the user sends the character's avatar. `variants` lets the caller reuse
   the single encode it already performed for the model payload, so a photo is
   not resized twice; `imageId` lets the message row be written with its render
   hint *before* the save (spec §6 step 3 before step 4).

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `shared/cloudAgentAttachments.ts` | Dependency-free attachment constants shared by app + cloud-agent |
| Create | `shared/cloudAgentProtocol.ts` | The single Zod definition of the agent-run wire format |
| Create | `cloud-agent/src/agentMessage.ts` | `buildNewMessage` — the single `newMessage` construction |
| Modify | `cloud-agent/src/index.ts` | Delete local schemas; import shared; accept + forward attachments |
| Modify | `cloud-agent/src/handlers/wsAgentHandler.ts` | Same deletions, imports, and forwarding |
| Create | `cloud-agent/src/agentMessage.test.ts` | `buildNewMessage` unit tests |
| Create | `cloud-agent/src/transportParity.test.ts` | Structural assertion that neither handler declares its own schema |
| Create | `__tests__/cloudAgentProtocol.test.ts` | Table-driven schema validation suite |
| Modify | `src/database/schema.ts` | Migration 24 + fresh-install DDL + skip guard |
| Modify | `src/database/characterImageDatabase.ts` | `message_id` on the row type/insert; `findCharacterImageByMessageId` |
| Modify | `src/services/characterImageService.ts` | `imageId`/`messageId`/`variants` inputs; no active pointer for `chat` |
| Create | `src/services/imageModelBytes.ts` | Re-obtain a saved image's base64 for the model (retry path) |
| Modify | `src/services/cloudAgentService.ts` | `attachments` on `CloudAgentPayload`, sent by both transports |
| Modify | `src/services/characterImageSyncService.ts` | Carry `messageId` up to and down from the cloud |
| Create | `src/hooks/useChatPhotoUpload.ts` | Pick/capture → resize → build the outgoing photo message |
| Modify | `src/components/ChatComposer.tsx` / `.web.tsx` | Branch image picks into send-vs-memory; camera entry |
| Modify | `src/hooks/useAIChat.ts` | Photo send path, cloud-agent gating, row commit, retry reuse |
| Modify | `src/services/CharacterPromptBuilder.ts` | `[sent a photo]` for captionless photo turns in history |
| Create | `src/components/ChatImageBubble.tsx` | Thumb in the bubble, tap → full-screen master |
| Modify | `src/components/ChatView.tsx` | Wire `renderMessageImage`; pass photo send through |
| Modify | `functions/src/db/schema.ts` | `messageId` on `character_images` |
| Create | `functions/drizzle/0023_character_images_chat.sql` | `ALTER TABLE ... ADD COLUMN message_id text` |
| Modify | `functions/src/characterFunctions.ts` | Accept/echo `messageId`; admit `source: 'chat'` |
| Modify | `__tests__/storageRules.test.ts` | Bind `storage.rules` content types to `ATTACHMENT_MIME_TYPES` |

**Test commands used throughout:**
- App/shared: `npm test -- <pattern>`
- cloud-agent: `cd cloud-agent && npm test` (builds then runs `node --test` over `dist/**/*.test.js`)
- functions: `cd functions && npm test`
- Typecheck: `npm run typecheck`, `cd cloud-agent && npm run typecheck`

---

## Task 0: Spike — verify the app can import a `shared/` module that cloud-agent also imports

Spec §13 flags this as the one unverified mechanical question. Settle it before
anything depends on it. Nothing from this task is committed.

**Files:**
- Create (throwaway): `shared/__spikeProbe.ts`
- Modify (throwaway): `src/services/cloudAgentService.ts`

- [ ] **Step 1: Create the probe module**

`shared/__spikeProbe.ts`:

```ts
export const SPIKE_PROBE = ['image/webp', 'image/jpeg'] as const
```

- [ ] **Step 2: Import it from the app and from cloud-agent**

Add to the top of `src/services/cloudAgentService.ts` (app style — no extension):

```ts
import { SPIKE_PROBE } from '../../shared/__spikeProbe'
console.log('SPIKE_PROBE', SPIKE_PROBE)
```

Add to the top of `cloud-agent/src/agent.ts` (nodenext style — `.js` extension):

```ts
import { SPIKE_PROBE } from '../../shared/__spikeProbe.js'
console.log('SPIKE_PROBE', SPIKE_PROBE)
```

- [ ] **Step 3: Verify both toolchains resolve it**

Run: `npm run typecheck`
Expected: no error mentioning `__spikeProbe`.

Run: `cd cloud-agent && npm run typecheck`
Expected: no error mentioning `__spikeProbe`.

Run: `npm test -- cloudAgentService`
Expected: the existing suite runs; no "Unable to resolve module" for `__spikeProbe`.

- [ ] **Step 4: Record the outcome and revert the spike**

```bash
git checkout -- src/services/cloudAgentService.ts cloud-agent/src/agent.ts
rm shared/__spikeProbe.ts
```

If **all three passed**: proceed as written — Task 12 imports
`shared/cloudAgentAttachments` directly from the client.

If **any failed**: the client keeps its own copy of the two constants in
`src/services/cloudAgentAttachments.ts` with identical values, and Task 12's
Step 6 test asserts equality against the shared module (which Jest can require
directly even if Metro cannot bundle it). Everything else in this plan is
unchanged — the server-side contract is single either way.

---

## Task 1: `shared/cloudAgentAttachments.ts` — the dependency-free constants

**Files:**
- Create: `shared/cloudAgentAttachments.ts`
- Test: `__tests__/cloudAgentProtocol.test.ts` (created here, extended in Task 2)

- [ ] **Step 1: Write the failing test**

Create `__tests__/cloudAgentProtocol.test.ts`:

```ts
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENT_BASE64_CHARS,
  isAttachmentMimeType,
} from '../shared/cloudAgentAttachments'

describe('cloudAgentAttachments', () => {
  it('admits exactly the two types storage.rules admits', () => {
    expect([...ATTACHMENT_MIME_TYPES]).toEqual(['image/webp', 'image/jpeg'])
  })

  it('caps a turn at one attachment in Phase 2', () => {
    expect(MAX_ATTACHMENTS_PER_TURN).toBe(1)
  })

  // ~1 MB decoded: generous against the ~200 KB a 1024px WebP produces, with
  // headroom under the 2 MB express.json body limit shared with history.
  it('caps base64 length at 1,400,000 chars', () => {
    expect(MAX_ATTACHMENT_BASE64_CHARS).toBe(1_400_000)
  })

  it('narrows unknown mime types', () => {
    expect(isAttachmentMimeType('image/webp')).toBe(true)
    expect(isAttachmentMimeType('image/svg+xml')).toBe(false)
    expect(isAttachmentMimeType('text/html')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npm test -- cloudAgentProtocol`
Expected: FAIL — "Cannot find module '../shared/cloudAgentAttachments'".

- [ ] **Step 3: Write the module**

Create `shared/cloudAgentAttachments.ts`:

```ts
/**
 * Attachment limits for the cloud-agent run contract.
 *
 * Deliberately dependency-free (no Zod, no relative imports) so the Expo app can
 * import it for pre-flight validation without pulling a server-only dependency
 * into the Metro bundle. The Zod schemas that consume these live in
 * `cloudAgentProtocol.ts`, which only the server imports.
 *
 * The mime allowlist must stay in sync with `storage.rules` — a type the agent
 * accepts but the Storage rules reject produces a photo the model sees and the
 * gallery then fails to store. `__tests__/storageRules.test.ts` fails on divergence.
 */

export const ATTACHMENT_MIME_TYPES = ['image/webp', 'image/jpeg'] as const

export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number]

/** Phase 2 sends one photo per turn. Raising this means revisiting the 2 MB body limit. */
export const MAX_ATTACHMENTS_PER_TURN = 1

/** ≈1 MB decoded. A 1024px WebP at q0.85 is ~200 KB base64, so this is ~7× headroom. */
export const MAX_ATTACHMENT_BASE64_CHARS = 1_400_000

export function isAttachmentMimeType(value: string): value is AttachmentMimeType {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- cloudAgentProtocol`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/cloudAgentAttachments.ts __tests__/cloudAgentProtocol.test.ts
git commit -m "feat(shared): add dependency-free cloud-agent attachment constants"
```

---

## Task 2: `shared/cloudAgentProtocol.ts` — one Zod definition of the wire format

**Files:**
- Create: `shared/cloudAgentProtocol.ts`
- Test: `__tests__/cloudAgentProtocol.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/cloudAgentProtocol.test.ts`:

```ts
import { agentRunSchema } from '../shared/cloudAgentProtocol'

const CHARACTER_ID = '11111111-1111-4111-8111-111111111111'
const base = { message: 'hello', characterId: CHARACTER_ID }
const attachment = { mimeType: 'image/webp', data: 'AAAA' }

describe('agentRunSchema', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['plain text turn', base, true],
    ['text with one attachment', { ...base, attachments: [attachment] }, true],
    ['captionless photo', { message: '', characterId: CHARACTER_ID, attachments: [attachment] }, true],
    ['whitespace-only caption with a photo', { message: '   ', characterId: CHARACTER_ID, attachments: [attachment] }, true],
    ['empty text with no attachment', { message: '', characterId: CHARACTER_ID }, false],
    ['whitespace-only text with no attachment', { message: '   ', characterId: CHARACTER_ID }, false],
    ['non-uuid characterId', { message: 'hi', characterId: 'char_local_1' }, false],
    ['disallowed mime type', { ...base, attachments: [{ mimeType: 'image/svg+xml', data: 'AAAA' }] }, false],
    ['two attachments', { ...base, attachments: [attachment, attachment] }, false],
    ['oversized data', { ...base, attachments: [{ mimeType: 'image/webp', data: 'A'.repeat(1_400_001) }] }, false],
    ['empty data', { ...base, attachments: [{ mimeType: 'image/webp', data: '' }] }, false],
    ['ws envelope fields tolerated', { ...base, type: 'agent_run', timezone: 'Europe/London' }, true],
    ['history of content parts', { ...base, history: [{ role: 'user', parts: [{ text: 'earlier' }] }] }, true],
    ['history with empty parts', { ...base, history: [{ role: 'user', parts: [] }] }, false],
  ]

  it.each(cases)('%s → %s', (_name, input, expected) => {
    expect(agentRunSchema.safeParse(input).success).toBe(expected)
  })

  it('trims the message so a padded caption is not treated as text', () => {
    const parsed = agentRunSchema.parse({ message: '  hi  ', characterId: CHARACTER_ID })
    expect(parsed.message).toBe('hi')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cloudAgentProtocol`
Expected: FAIL — "Cannot find module '../shared/cloudAgentProtocol'".

- [ ] **Step 3: Write the module**

Create `shared/cloudAgentProtocol.ts`:

```ts
/**
 * The single definition of the `/agent/run` wire format.
 *
 * Both transports import this: the HTTP handler (`cloud-agent/src/index.ts`) and
 * the WebSocket handler (`cloud-agent/src/handlers/wsAgentHandler.ts`). They used
 * to declare copy-pasted schemas of their own, which meant a field added to one
 * and not the other produced a feature that worked or silently dropped data
 * depending on whether the network allowed a WS upgrade — intermittent, invisible,
 * and unreproducible on a healthy connection. Neither handler may declare an
 * agent-run schema again; `transportParity.test.ts` enforces that structurally.
 */

import { z } from 'zod'
import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS_PER_TURN,
  MAX_ATTACHMENT_BASE64_CHARS,
} from './cloudAgentAttachments.js'

export const contentSchema = z.object({
  role: z.enum(['user', 'model']),
  parts: z.array(z.object({}).passthrough()).min(1),
})

export const attachmentSchema = z.object({
  mimeType: z.enum(ATTACHMENT_MIME_TYPES),
  data: z.string().min(1).max(MAX_ATTACHMENT_BASE64_CHARS),
})

export const agentRunSchema = z
  .object({
    // Present on the WS envelope, absent on the HTTP body. Optional here so one
    // schema serves both rather than two schemas differing only incidentally.
    type: z.literal('agent_run').optional(),
    message: z.string().trim(),
    characterId: z.string().uuid(),
    unsyncedHistory: z.array(z.unknown()).optional(),
    history: z.array(contentSchema).optional(),
    timezone: z.string().optional(),
    attachments: z.array(attachmentSchema).max(MAX_ATTACHMENTS_PER_TURN).optional(),
  })
  // Text may be empty if and only if an attachment is present. Sending a photo
  // with no caption is ordinary; an entirely empty turn still spends a credit on
  // nothing, so `min(1)` is refined rather than dropped.
  .refine((value) => value.message.length > 0 || (value.attachments?.length ?? 0) > 0, {
    message: 'message must not be empty unless an attachment is present',
    path: ['message'],
  })

export type AgentRunRequest = z.infer<typeof agentRunSchema>
export type AgentAttachment = z.infer<typeof attachmentSchema>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- cloudAgentProtocol`
Expected: PASS (all cases).

- [ ] **Step 5: Verify cloud-agent still typechecks with the new file in its program**

Run: `cd cloud-agent && npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add shared/cloudAgentProtocol.ts __tests__/cloudAgentProtocol.test.ts
git commit -m "feat(shared): single agent-run wire schema with attachments"
```

---

## Task 3: `buildNewMessage` — one `newMessage` construction

**Files:**
- Create: `cloud-agent/src/agentMessage.ts`
- Test: `cloud-agent/src/agentMessage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cloud-agent/src/agentMessage.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildNewMessage } from './agentMessage.js'

test('text-only turn produces a single text part', () => {
  assert.deepEqual(buildNewMessage('hello'), {
    role: 'user',
    parts: [{ text: 'hello' }],
  })
})

test('attachments precede the text so the question reads as being about the image', () => {
  const result = buildNewMessage('what is this?', [{ mimeType: 'image/webp', data: 'AAAA' }])
  assert.deepEqual(result, {
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'image/webp', data: 'AAAA' } },
      { text: 'what is this?' },
    ],
  })
})

test('captionless photo omits the text part entirely', () => {
  const result = buildNewMessage('', [{ mimeType: 'image/jpeg', data: 'BBBB' }])
  assert.deepEqual(result, {
    role: 'user',
    parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }],
  })
})

test('empty everything still yields one part — never a partless Content', () => {
  assert.deepEqual(buildNewMessage(''), { role: 'user', parts: [{ text: '' }] })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud-agent && npm test`
Expected: FAIL at build — "Cannot find module './agentMessage.js'".

- [ ] **Step 3: Write the implementation**

Create `cloud-agent/src/agentMessage.ts`:

```ts
import type { Content } from '@google/genai'
import type { AgentAttachment } from '../../shared/cloudAgentProtocol.js'

/**
 * The one construction of the ADK `newMessage` for a text-chat turn.
 *
 * Called by both `/agent/run` (HTTP) and the `agent_run` WS frame so the two
 * transports cannot feed structurally different prompts to the model. Inline
 * data comes first: a trailing image reads to the model as an afterthought,
 * while a leading one frames the text as a question *about* the photo.
 */
export function buildNewMessage(
  message: string,
  attachments: readonly AgentAttachment[] = [],
): Content {
  const parts = [
    ...attachments.map((attachment) => ({
      inlineData: { mimeType: attachment.mimeType, data: attachment.data },
    })),
    ...(message.length > 0 ? [{ text: message }] : []),
  ]

  // A Content with no parts is rejected downstream; the schema makes this
  // unreachable, but a partless prompt would be an opaque failure if it were not.
  return { role: 'user', parts: parts.length > 0 ? parts : [{ text: message }] }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cloud-agent && npm test`
Expected: PASS — 4 new `agentMessage` tests, existing suites unchanged.

- [ ] **Step 5: Commit**

```bash
git add cloud-agent/src/agentMessage.ts cloud-agent/src/agentMessage.test.ts
git commit -m "feat(cloud-agent): single newMessage construction with inline attachments"
```

---

## Task 4: WS handler imports the shared contract

**Files:**
- Modify: `cloud-agent/src/handlers/wsAgentHandler.ts:23-34` (delete local schemas), `:205` (newMessage)
- Test: `cloud-agent/src/wsAgentHandler.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `cloud-agent/src/handlers/wsAgentHandler.test.ts` (match the existing
harness in that file for constructing a socket — reuse whatever helper the
neighbouring tests use to drive an `agent_run` frame; the assertion below is on
the ADK `newMessage` the handler builds):

```ts
test('WS agent_run forwards an attachment as a leading inlineData part', async () => {
  const captured: unknown[] = []
  await runAgentRunFrame({
    frame: {
      type: 'agent_run',
      message: 'what is this?',
      characterId: TEST_CHARACTER_ID,
      attachments: [{ mimeType: 'image/webp', data: 'AAAA' }],
    },
    onNewMessage: (newMessage) => captured.push(newMessage),
  })

  assert.deepEqual(captured[0], {
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'image/webp', data: 'AAAA' } },
      { text: 'what is this?' },
    ],
  })
})

test('WS accepts a captionless photo', async () => {
  const errors: unknown[] = []
  await runAgentRunFrame({
    frame: {
      type: 'agent_run',
      message: '',
      characterId: TEST_CHARACTER_ID,
      attachments: [{ mimeType: 'image/webp', data: 'AAAA' }],
    },
    onError: (err) => errors.push(err),
  })
  assert.deepEqual(errors, [])
})
```

> If `runAgentRunFrame` does not exist in that file, write it as a local helper
> mirroring the existing tests' socket setup — do not introduce a new harness
> shape for these two cases.

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud-agent && npm test -- --test-name-pattern "WS agent_run forwards"`
Expected: FAIL — attachments are stripped by the local schema, so `parts` is `[{ text: ... }]`.

- [ ] **Step 3: Delete the local schemas and import the shared ones**

In `cloud-agent/src/handlers/wsAgentHandler.ts`, delete lines 23-34 (the local
`contentSchema` and `agentRunSchema`) and add to the imports:

```ts
import { agentRunSchema } from '../../../shared/cloudAgentProtocol.js'
import { buildNewMessage } from '../agentMessage.js'
```

Remove the now-unused `import { z } from 'zod'` if nothing else in the file uses
`z` (`noUnusedLocals` is on — the build will tell you).

- [ ] **Step 4: Thread attachments to the prompt**

Where the parsed frame is destructured, add `attachments`:

```ts
const { message, characterId, unsyncedHistory = [], history: rawHistory = [], attachments = [] } = parsed.data
```

Replace the `newMessage` literal at `:205`:

```ts
        const events = runner.runAsync({
          userId,
          sessionId,
          newMessage: buildNewMessage(message, attachments),
          abortSignal: abortController.signal,
        })
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd cloud-agent && npm test`
Expected: PASS — the two new tests plus every existing `wsAgentHandler` test.

- [ ] **Step 6: Commit**

```bash
git add cloud-agent/src/handlers/wsAgentHandler.ts cloud-agent/src/handlers/wsAgentHandler.test.ts
git commit -m "refactor(cloud-agent): ws handler uses the shared agent-run contract"
```

---

## Task 5: HTTP handler imports the shared contract

**Files:**
- Modify: `cloud-agent/src/index.ts:39-42` (delete `contentSchema`), `:113` (newMessage), `:211-217` (inline schema)
- Test: `cloud-agent/src/index.test.ts` (extend)

- [ ] **Step 1: Write the failing test**

Append to `cloud-agent/src/index.test.ts`, following that file's existing
supertest-style app construction:

```ts
test('POST /agent/run forwards an attachment as a leading inlineData part', async () => {
  const captured: unknown[] = []
  const app = createTestApp({ onNewMessage: (m: unknown) => captured.push(m) })

  const res = await postAgentRun(app, {
    message: 'what is this?',
    characterId: TEST_CHARACTER_ID,
    attachments: [{ mimeType: 'image/webp', data: 'AAAA' }],
  })

  assert.equal(res.status, 200)
  assert.deepEqual(captured[0], {
    role: 'user',
    parts: [
      { inlineData: { mimeType: 'image/webp', data: 'AAAA' } },
      { text: 'what is this?' },
    ],
  })
})

test('POST /agent/run accepts a captionless photo and rejects an empty turn', async () => {
  const app = createTestApp({})

  const withPhoto = await postAgentRun(app, {
    message: '',
    characterId: TEST_CHARACTER_ID,
    attachments: [{ mimeType: 'image/webp', data: 'AAAA' }],
  })
  assert.equal(withPhoto.status, 200)

  const empty = await postAgentRun(app, { message: '', characterId: TEST_CHARACTER_ID })
  assert.equal(empty.status, 400)
})
```

> Reuse whatever `createTestApp` / request helper the existing tests in that file
> use; do not add a second harness.

- [ ] **Step 2: Run to verify it fails**

Run: `cd cloud-agent && npm test -- --test-name-pattern "POST /agent/run forwards"`
Expected: FAIL — the inline schema drops `attachments`.

- [ ] **Step 3: Delete the local schema and import the shared one**

In `cloud-agent/src/index.ts`, delete the `contentSchema` declaration at lines
39-42 and add:

```ts
import { agentRunSchema } from '../../shared/cloudAgentProtocol.js'
import { buildNewMessage } from './agentMessage.js'
```

Remove `import { z } from 'zod'` if `z` becomes unused.

- [ ] **Step 4: Use the shared schema in the route**

Replace the inline `z.object({...}).safeParse(req.body)` at `:211-217` with:

```ts
      const parseResult = agentRunSchema.safeParse(req.body)
      if (!parseResult.success) {
        res.status(400).json({ error: 'Invalid request body' })
        return
      }
      const {
        message,
        characterId,
        unsyncedHistory = [],
        history: rawHistory = [],
        attachments = [],
      } = parseResult.data
```

- [ ] **Step 5: Thread attachments to `runAgent`**

Add the field to `RunAgentParams` (`cloud-agent/src/index.ts:47`):

```ts
import type { AgentAttachment } from '../../shared/cloudAgentProtocol.js'

export interface RunAgentParams {
  db: DrizzleClient
  userId: string
  firebaseUid: string
  characterId: string
  systemInstruction: string
  message: string
  history: Content[]
  timezone: string
  embed: (text: string) => Promise<number[]>
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>
  /** At most one in Phase 2; delivered as a leading inlineData part. */
  attachments?: AgentAttachment[]
}
```

Replace the `newMessage` literal at `:113`:

```ts
  const events = runner.runAsync({
    userId,
    sessionId,
    newMessage: buildNewMessage(message, attachments),
  })
```

…destructuring `attachments = []` from the params alongside `message` and
`history`, and pass it at the call site:

```ts
      const result = await runAgentFn({ db, userId, firebaseUid, characterId, systemInstruction, message, history, timezone, embed: embedText, creditService: cs, attachments })
```

- [ ] **Step 6: Verify no base64 reaches a log line**

Run: `grep -n "console\.\(log\|warn\|error\).*req\.body\|JSON.stringify(req.body)" cloud-agent/src/index.ts cloud-agent/src/handlers/wsAgentHandler.ts`
Expected: no output. A vision request body is user photo content and must never be logged.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd cloud-agent && npm test`
Expected: PASS — new tests plus all existing suites.

- [ ] **Step 8: Commit**

```bash
git add cloud-agent/src/index.ts cloud-agent/src/index.test.ts
git commit -m "refactor(cloud-agent): http handler uses the shared agent-run contract"
```

---

## Task 6: Structural transport-parity test

The point of Tasks 4-5 is that the duplication cannot come back. Assert it
structurally rather than by duplicating payload cases per transport.

**Files:**
- Create: `cloud-agent/src/transportParity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `cloud-agent/src/transportParity.test.ts`:

```ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Read the SOURCE, not the build output: the invariant is about what future
// edits are allowed to write, and the compiled JS has no `z.object` left to find.
const SRC = join(import.meta.dirname, '..', '..', 'cloud-agent', 'src')
const httpHandler = readFileSync(join(SRC, 'index.ts'), 'utf8')
const wsHandler = readFileSync(join(SRC, 'handlers', 'wsAgentHandler.ts'), 'utf8')

for (const [name, source] of [['http', httpHandler], ['ws', wsHandler]] as const) {
  test(`${name} handler imports the shared agent-run schema`, () => {
    assert.match(source, /import \{[^}]*agentRunSchema[^}]*\} from '.*shared\/cloudAgentProtocol\.js'/)
  })

  test(`${name} handler declares no agent-run schema of its own`, () => {
    assert.equal(/const\s+(agentRunSchema|contentSchema|attachmentSchema)\s*=/.test(source), false)
  })

  test(`${name} handler builds newMessage through buildNewMessage`, () => {
    assert.match(source, /newMessage: buildNewMessage\(/)
    // An inline parts literal is the exact regression this guards.
    assert.equal(/newMessage:\s*\{\s*role:/.test(source), false)
  })
}
```

- [ ] **Step 2: Run to verify it passes (Tasks 4-5 already satisfied it)**

Run: `cd cloud-agent && npm test -- --test-name-pattern "handler"`
Expected: PASS — 6 assertions.

- [ ] **Step 3: Verify it actually fails when the invariant breaks**

Temporarily re-add `const contentSchema = z.object({})` to
`cloud-agent/src/handlers/wsAgentHandler.ts`, run
`cd cloud-agent && npm test -- --test-name-pattern "declares no agent-run schema"`.
Expected: FAIL for `ws`. Then revert the temporary line.

- [ ] **Step 4: Commit**

```bash
git add cloud-agent/src/transportParity.test.ts
git commit -m "test(cloud-agent): lock ws/http agent-run contract to one definition"
```

---

## Task 7: Local SQLite — `message_id` and the `chat` source

**Files:**
- Modify: `src/database/schema.ts:140-159` (fresh-install DDL), `:65` (skip guards), `:235` (migrations)
- Modify: `src/database/characterImageDatabase.ts:13` (`ImageSource`), `:29-43` (row type), `:45-66` (insert)
- Test: `__tests__/characterImageSchema.test.ts`, `__tests__/characterImageDatabase.test.ts`

- [ ] **Step 1: Write the failing schema test**

Append to `__tests__/characterImageSchema.test.ts`:

```ts
import { CREATE_TABLES, MIGRATIONS, MIGRATION_SKIP_GUARDS } from '~/database/schema'

describe('migration 24 — chat photo linkage', () => {
  it('adds message_id and a partial index', () => {
    expect(MIGRATIONS[24]).toContain('ALTER TABLE character_images ADD COLUMN message_id TEXT')
    expect(MIGRATIONS[24]).toContain('idx_character_images_message')
    expect(MIGRATIONS[24]).toContain('WHERE message_id IS NOT NULL')
  })

  it('is skipped when the column already exists', () => {
    expect(MIGRATION_SKIP_GUARDS[24]).toEqual([
      { table: 'character_images', column: 'message_id' },
    ])
  })

  it('fresh installs get the column without running the migration', () => {
    expect(CREATE_TABLES).toContain('message_id')
    expect(CREATE_TABLES).toContain('idx_character_images_message')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- characterImageSchema`
Expected: FAIL — `MIGRATIONS[24]` is undefined.

- [ ] **Step 3: Add the migration, the guard, and the fresh-install DDL**

In `src/database/schema.ts`, add to `MIGRATION_SKIP_GUARDS` (after the `23:` entry):

```ts
  24: [{ table: 'character_images', column: 'message_id' }],
```

Add to `MIGRATIONS` (after the `23:` entry):

```ts
  // Chat photos are gallery rows with a message they arrived on. Nullable and
  // deliberately unconstrained: message sync and image sync are independent
  // flows that can land in either order, so a row may legitimately name a
  // message this device has not received yet. Dangling is tolerated and handled
  // at read time; a foreign key would reject the write and strand the image.
  24: `ALTER TABLE character_images ADD COLUMN message_id TEXT;
CREATE INDEX IF NOT EXISTS idx_character_images_message ON character_images(message_id) WHERE message_id IS NOT NULL`,
```

In `CREATE_TABLES`, add the column to the `character_images` block (after
`deleted_at    INTEGER`, inserting a comma on the previous line):

```sql
    deleted_at    INTEGER,
    message_id    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_character_images_char
    ON character_images(character_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_character_images_message
    ON character_images(message_id)
    WHERE message_id IS NOT NULL;
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npm test -- characterImageSchema`
Expected: PASS.

- [ ] **Step 5: Write the failing database-layer test**

Append to `__tests__/characterImageDatabase.test.ts`:

```ts
import {
  insertCharacterImage,
  findCharacterImageByMessageId,
} from '~/database/characterImageDatabase'

describe('message_id linkage', () => {
  it('round-trips message_id and source chat', async () => {
    await insertCharacterImage({
      id: 'img-chat-1',
      character_id: 'char-1',
      user_id: 'user-1',
      storage_kind: 'file',
      master_ref: 'file:///master',
      thumb_ref: 'file:///thumb',
      mime_type: 'image/webp',
      source: 'chat',
      sync_state: 'local',
      sync_attempts: 0,
      created_at: 1,
      deleted_at: null,
      message_id: 'msg-1',
    })

    const found = await findCharacterImageByMessageId('msg-1')
    expect(found?.id).toBe('img-chat-1')
    expect(found?.source).toBe('chat')
  })

  it('returns null for a message with no image', async () => {
    expect(await findCharacterImageByMessageId('msg-none')).toBeNull()
  })

  it('ignores soft-deleted rows so a retry does not resurrect a deleted photo', async () => {
    await insertCharacterImage({
      id: 'img-chat-2',
      character_id: 'char-1',
      user_id: 'user-1',
      storage_kind: 'file',
      master_ref: 'file:///master2',
      thumb_ref: null,
      mime_type: 'image/webp',
      source: 'chat',
      sync_state: 'pending_delete',
      sync_attempts: 0,
      created_at: 2,
      deleted_at: 2,
      message_id: 'msg-2',
    })

    expect(await findCharacterImageByMessageId('msg-2')).toBeNull()
  })
})
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- characterImageDatabase`
Expected: FAIL — `findCharacterImageByMessageId` is not exported.

- [ ] **Step 7: Extend the database layer**

In `src/database/characterImageDatabase.ts`:

```ts
export type ImageSource = 'generated' | 'uploaded' | 'imported' | 'chat'
```

Add to `CharacterImageRow` (after `deleted_at`):

```ts
  /**
   * The chat message this photo arrived on, for `source: 'chat'` rows; null for
   * avatars. Not a foreign key — see migration 24.
   */
  message_id: string | null
```

Update `insertCharacterImage` to write it:

```ts
export async function insertCharacterImage(row: CharacterImageRow): Promise<void> {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT INTO character_images
     (id, character_id, user_id, storage_kind, master_ref, thumb_ref, mime_type, source, sync_state, sync_attempts, created_at, deleted_at, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.character_id,
      row.user_id,
      row.storage_kind,
      row.master_ref,
      row.thumb_ref,
      row.mime_type,
      row.source,
      row.sync_state,
      row.sync_attempts,
      row.created_at,
      row.deleted_at,
      row.message_id ?? null,
    ],
  )
}
```

Add the lookup:

```ts
/**
 * The live image a message carries, if any.
 *
 * Used by the retry path: a retried vision turn must reuse the existing row
 * rather than write a second one, which would consume two slots against the
 * FIFO cap for one photo. Soft-deleted and reserved rows are excluded — a photo
 * the user deleted must not come back on retry, and a reservation's bytes are
 * not confirmed.
 */
export async function findCharacterImageByMessageId(
  messageId: string,
): Promise<CharacterImageRow | null> {
  const db = await getDatabase()
  return db.getFirstAsync<CharacterImageRow>(
    `SELECT * FROM character_images
     WHERE message_id = ? AND deleted_at IS NULL AND sync_state != 'reserved'
     ORDER BY created_at DESC
     LIMIT 1`,
    [messageId],
  )
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm test -- characterImageDatabase characterImageSchema`
Expected: PASS.

Run: `npm run typecheck`
Expected: errors only where `CharacterImageRow` literals now lack `message_id` —
fix each by adding `message_id: null` (notably
`src/services/characterImageService.ts` and
`src/services/characterImageSyncService.ts`; Tasks 8 and 11 revisit both).

- [ ] **Step 9: Commit**

```bash
git add src/database/schema.ts src/database/characterImageDatabase.ts __tests__/characterImageSchema.test.ts __tests__/characterImageDatabase.test.ts
git commit -m "feat(db): link character images to the chat message they arrived on"
```

---

## Task 8: `saveCharacterImage` — chat photos are gallery rows, not avatars

**Files:**
- Modify: `src/services/characterImageService.ts:33-41` (input), `:71-…` (body), `:~250` (post-save bookkeeping)
- Test: `__tests__/characterImageService.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/characterImageService.test.ts` (reuse that file's existing
mocks of `characterImageDatabase`, `imageVariants`, `localImageStore`, and
`storageService`):

```ts
describe('chat photos', () => {
  it('does not become the active avatar', async () => {
    await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
    })

    expect(setActiveImageId).not.toHaveBeenCalled()
  })

  it('still promotes an uploaded avatar to active', async () => {
    await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///avatar.jpg',
      width: 1024,
      height: 1024,
      source: 'uploaded',
    })

    expect(setActiveImageId).toHaveBeenCalledWith('char-1', expect.any(String))
  })

  it('writes message_id onto the row', async () => {
    const row = await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
    })

    expect(row.message_id).toBe('msg-1')
    expect(insertCharacterImage).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'chat', message_id: 'msg-1' }),
    )
  })

  it('honours a caller-supplied imageId so the message can carry it beforehand', async () => {
    const row = await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
      imageId: '22222222-2222-4222-8222-222222222222',
    })

    expect(row.id).toBe('22222222-2222-4222-8222-222222222222')
  })

  it('reuses caller-supplied variants instead of re-encoding', async () => {
    const variants = {
      master: { base64: 'MASTER', mimeType: 'image/webp' },
      thumb: { base64: 'THUMB', mimeType: 'image/webp' },
    }

    await saveCharacterImage({
      characterId: 'char-1',
      userId: 'user-1',
      uri: 'file:///photo.jpg',
      width: 1600,
      height: 900,
      source: 'chat',
      messageId: 'msg-1',
      variants,
    })

    expect(prepareImageVariants).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- characterImageService`
Expected: FAIL — `messageId` is not an accepted input; `setActiveImageId` is called for `chat`.

- [ ] **Step 3: Extend the input type**

In `src/services/characterImageService.ts`:

```ts
import { prepareImageVariants, type ImageVariants } from '~/services/imageVariants'

export interface SaveCharacterImageInput {
  characterId: string
  userId: string
  /** Source image URI — a picker result, a manipulator output, or a data: URI. */
  uri: string
  width: number
  height: number
  source: ImageSource
  /**
   * The chat message this photo arrived on. Only meaningful for `source: 'chat'`.
   * Not a foreign key in either database (see migration 24).
   */
  messageId?: string
  /**
   * Pre-minted row id. The chat path needs the id *before* the save so the
   * message it writes can carry the render hint; everything else lets the
   * service mint one. Must be a UUID — the sync callable validates it.
   */
  imageId?: string
  /**
   * Already-derived variants. The chat path encodes once to obtain the master
   * base64 it sends to the model and hands the result here rather than paying
   * for a second identical encode.
   */
  variants?: ImageVariants
}
```

- [ ] **Step 4: Use the new inputs in the body**

Replace the variant derivation and id minting near the top of `saveCharacterImage`:

```ts
  const variants =
    input.variants ??
    (await prepareImageVariants({
      uri: input.uri,
      width: input.width,
      height: input.height,
    }))

  const imageId = input.imageId ?? generateSecureUuid()
```

Add `message_id: input.messageId ?? null` to **both** the reservation insert and
the committed `row` literal:

```ts
      await insertCharacterImage({
        id: imageId,
        character_id: input.characterId,
        user_id: input.userId,
        storage_kind: 'cloud',
        master_ref: masterPath,
        thumb_ref: thumbPath,
        mime_type: variants.master.mimeType,
        source: input.source,
        sync_state: 'reserved',
        sync_attempts: 0,
        created_at: Date.now(),
        deleted_at: null,
        message_id: input.messageId ?? null,
      })
```

```ts
    row = {
      id: imageId,
      character_id: input.characterId,
      user_id: input.userId,
      storage_kind: storageKind,
      master_ref: masterRef,
      thumb_ref: thumbRef,
      mime_type: variants.master.mimeType,
      source: input.source,
      sync_state: syncState,
      sync_attempts: 0,
      created_at: Date.now(),
      deleted_at: null,
      message_id: input.messageId ?? null,
    }
```

- [ ] **Step 5: Stop promoting chat photos to the avatar**

Replace the post-save bookkeeping block:

```ts
  try {
    // A chat photo is a gallery row, not an avatar choice. Promoting it would
    // silently change the character's face every time the user sends a picture;
    // the user can still pick it later from the Avatar Picker, which is the
    // whole reason it lands in the shared gallery.
    if (input.source !== 'chat') {
      await setActiveImageId(input.characterId, imageId)
    }
    await enforceLocalCap(input.characterId)
  } catch (err) {
    // The row is already committed. Reporting a failure here would make callers
    // retry and duplicate the image, which costs the user credits again.
    console.warn('Image saved, but post-save bookkeeping failed:', err)
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- characterImageService`
Expected: PASS — new cases plus every existing case in the file.

- [ ] **Step 7: Commit**

```bash
git add src/services/characterImageService.ts __tests__/characterImageService.test.ts
git commit -m "feat(images): chat photos save as gallery rows without claiming the avatar"
```

---

## Task 9: Pin aspect-ratio preservation for chat photos

No production change — `prepareImageVariants` already preserves aspect ratio.
This locks the behaviour the spec depends on so a future "square everything"
refactor fails loudly.

**Files:**
- Test: `__tests__/imageVariants.test.ts`

- [ ] **Step 1: Write the test**

Append to `__tests__/imageVariants.test.ts` (reuse the file's existing
`manipulateAsync` mock; assert on the actions it was called with):

```ts
describe('aspect ratio', () => {
  it('never crops — a landscape photo keeps its shape', async () => {
    await prepareImageVariants({ uri: 'file:///landscape.jpg', width: 1600, height: 900 })

    const [, actions] = (manipulateAsync as jest.Mock).mock.calls[0]
    expect(actions).toEqual([{ resize: { width: 1024 } }])
    expect(JSON.stringify(actions)).not.toContain('crop')
  })

  it('resizes a tall photo on its longest edge', async () => {
    await prepareImageVariants({ uri: 'file:///tall.jpg', width: 900, height: 1600 })

    const [, actions] = (manipulateAsync as jest.Mock).mock.calls[0]
    expect(actions).toEqual([{ resize: { height: 1024 } }])
  })

  it('never upscales', async () => {
    await prepareImageVariants({ uri: 'file:///small.jpg', width: 800, height: 600 })

    const [, actions] = (manipulateAsync as jest.Mock).mock.calls[0]
    expect(actions).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it passes**

Run: `npm test -- imageVariants`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add __tests__/imageVariants.test.ts
git commit -m "test(images): pin aspect-ratio preservation for chat photos"
```

---

## Task 10: Cloud Postgres — `message_id` on `character_images`

**Files:**
- Create: `functions/drizzle/0023_character_images_chat.sql`
- Modify: `functions/src/db/schema.ts:107-122`
- Modify: `functions/src/characterFunctions.ts:119` (`IMAGE_SOURCES`), `:132-143` (serialize), `:153-200` (parse), `:280-295` (syncImages call)
- Test: `functions/src/characterFunctions.test.ts`

- [ ] **Step 1: Hand-write the SQL migration**

Do **not** run `drizzle-kit generate` — the journal is out of sync with the
migration directory.

Create `functions/drizzle/0023_character_images_chat.sql`:

```sql
-- Chat photos are gallery rows that also name the message they arrived on.
-- Deliberately NOT a foreign key to messages: syncCharacterImages and message
-- sync are independent flows that can land in either order, so a device may
-- legitimately register an image for a message the server has not received yet.
-- A FK would reject that write and strand the image.
ALTER TABLE character_images ADD COLUMN message_id text;
```

- [ ] **Step 2: Add the column to the Drizzle schema**

In `functions/src/db/schema.ts`, inside `characterImages`, after `source`:

```ts
  source: text('source').notNull(),
  /** Client-minted message id this photo arrived on; null for avatars. Not an FK — see 0023. */
  messageId: text('message_id'),
```

- [ ] **Step 3: Write the failing callable tests**

Append to `functions/src/characterFunctions.test.ts`, following the existing
`imageRequest` / `imageDeps` helpers:

```ts
test("syncCharacterImages accepts source 'chat' with a messageId", async () => {
  const deps = imageDeps();
  await syncCharacterImagesHandler(
    imageRequest({
      characterId: CHARACTER_UUID,
      images: [{
        id: IMAGE_UUID,
        storagePath: `users/${FIREBASE_UID}/characters/${CHARACTER_UUID}/${IMAGE_UUID}.webp`,
        thumbPath: null,
        mimeType: "image/webp",
        source: "chat",
        messageId: "msg_1723300000000_ab12cd",
      }],
    }),
    deps as never
  );

  assert.deepEqual(
    deps.characterImageService.syncImages.mock.calls[0].arguments[2][0].messageId,
    "msg_1723300000000_ab12cd"
  );
});

test("syncCharacterImages defaults messageId to null for avatars", async () => {
  const deps = imageDeps();
  await syncCharacterImagesHandler(
    imageRequest({
      characterId: CHARACTER_UUID,
      images: [{
        id: IMAGE_UUID,
        storagePath: `users/${FIREBASE_UID}/characters/${CHARACTER_UUID}/${IMAGE_UUID}.webp`,
        source: "uploaded",
      }],
    }),
    deps as never
  );

  assert.equal(
    deps.characterImageService.syncImages.mock.calls[0].arguments[2][0].messageId,
    null
  );
});

test("syncCharacterImages rejects a non-string messageId", async () => {
  await assert.rejects(
    () => syncCharacterImagesHandler(
      imageRequest({
        characterId: CHARACTER_UUID,
        images: [{
          id: IMAGE_UUID,
          storagePath: `users/${FIREBASE_UID}/characters/${CHARACTER_UUID}/${IMAGE_UUID}.webp`,
          source: "chat",
          messageId: 42,
        }],
      }),
      imageDeps() as never
    ),
    /messageId/
  );
});
```

- [ ] **Step 4: Run to verify they fail**

Run: `cd functions && npm test`
Expected: FAIL — `source: 'chat'` is rejected by `IMAGE_SOURCES`.

- [ ] **Step 5: Accept and echo `messageId`**

In `functions/src/characterFunctions.ts`:

```ts
const IMAGE_SOURCES = new Set(['generated', 'uploaded', 'imported', 'chat']);
```

In `parseImagePayload`, destructure and validate it:

```ts
  const {id, storagePath, thumbPath, mimeType, source, messageId} = value as Record<string, unknown>;
```

```ts
  if (typeof source !== 'string' || !IMAGE_SOURCES.has(source)) {
    throw new HttpsError('invalid-argument', 'image.source must be generated, uploaded, imported, or chat.');
  }
  // Rejected rather than coerced, for the same reason as thumbPath: a caller
  // that sent a malformed messageId believes the photo is linked to its message,
  // and silently nulling it strands the bubble on every other device.
  if (messageId !== undefined && messageId !== null && typeof messageId !== 'string') {
    throw new HttpsError('invalid-argument', 'image.messageId must be a string or null when provided.');
  }
```

Return it:

```ts
  return {
    id,
    storagePath,
    thumbPath: typeof thumbPath === 'string' ? thumbPath : null,
    mimeType: typeof mimeType === 'string' ? mimeType : 'image/webp',
    source,
    messageId: typeof messageId === 'string' ? messageId : null,
  };
```

Add `messageId: string | null` to the `CharacterImagePayload` type, add it to
`serializeCharacterImage`:

```ts
    source: String(row.source),
    messageId: row.messageId == null ? null : String(row.messageId),
```

…and pass it through the `syncImages` mapping:

```ts
      parsedImages.map((image) => ({
        id: image.id,
        characterId,
        userId: user.id,
        storagePath: image.storagePath,
        thumbPath: image.thumbPath ?? null,
        mimeType: image.mimeType ?? 'image/webp',
        source: image.source,
        messageId: image.messageId ?? null,
      }))
```

Update `characterImageService.syncImages`'s insert/upsert in
`functions/src/services/` to include `messageId` in both the insert values and
the `onConflictDoUpdate` set (grep for `storagePath:` in that service to find it).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd functions && npm test`
Expected: PASS — three new tests plus the existing `syncCharacterImages` suite.

- [ ] **Step 7: Commit**

```bash
git add functions/drizzle/0023_character_images_chat.sql functions/src/db/schema.ts functions/src/characterFunctions.ts functions/src/services functions/src/characterFunctions.test.ts
git commit -m "feat(functions): carry message_id and the chat source on character images"
```

---

## Task 11: Client sync — carry `messageId` in both directions

**Files:**
- Modify: `src/services/characterImageSyncService.ts:266-272` (push), `:425-437` (pull)
- Test: `__tests__/characterImageSync.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/characterImageSync.test.ts`:

```ts
it('pushes message_id to the cloud', async () => {
  // arrange a pending_upload chat row via the file's existing row factory
  await seedImageRow({ id: IMAGE_ID, source: 'chat', message_id: 'msg-1', sync_state: 'pending_upload' })

  await syncCharacterImages()

  expect(syncCharacterImagesFn).toHaveBeenCalledWith(
    expect.objectContaining({
      images: [expect.objectContaining({ id: IMAGE_ID, messageId: 'msg-1' })],
    }),
  )
})

it('restores message_id from a cloud snapshot', async () => {
  await reconcileFromCloud(LOCAL_CHARACTER_ID, LOCAL_USER_ID, [
    {
      id: IMAGE_ID,
      storagePath: 'users/u/characters/c/i.webp',
      thumbPath: null,
      mimeType: 'image/webp',
      source: 'chat',
      messageId: 'msg-1',
      createdAt: new Date(1).toISOString(),
      deletedAt: null,
    },
  ], null)

  expect(insertCharacterImage).toHaveBeenCalledWith(
    expect.objectContaining({ source: 'chat', message_id: 'msg-1' }),
  )
})
```

> Use the file's own helpers (`seedImageRow`, the cloud-snapshot entry point it
> already tests) rather than inventing new ones; the two assertions above are
> what matters.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- characterImageSync`
Expected: FAIL — `messageId` is absent from the pushed payload.

- [ ] **Step 3: Push it**

In `src/services/characterImageSyncService.ts`:

```ts
        images: bucket.uploaded.map((row) => ({
          id: row.id,
          storagePath: row.master_ref,
          thumbPath: row.thumb_ref,
          mimeType: row.mime_type,
          source: row.source,
          messageId: row.message_id,
        })),
```

- [ ] **Step 4: Pull it**

Add `messageId?: string | null` to the cloud-snapshot type in this file, and in
the reconcile insert:

```ts
      source: snapshot.source,
      sync_state: 'synced',
      sync_attempts: 0,
      created_at: snapshot.createdAt ? new Date(snapshot.createdAt).getTime() : Date.now(),
      deleted_at: null,
      // A device may receive the image before the message it names. That is a
      // plain gallery row until the message arrives — never a reason to drop it.
      message_id: snapshot.messageId ?? null,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- characterImageSync characterSyncRestoreImages characterImageReconcile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/characterImageSyncService.ts __tests__/characterImageSync.test.ts
git commit -m "feat(sync): carry chat photo message linkage across devices"
```

---

## Task 12: `attachments` on the client wire payload — both transports

**Files:**
- Modify: `src/services/cloudAgentService.ts:19-23` (payload), `:82-96` (HTTP), `:195-202` (WS frame)
- Test: `__tests__/cloudAgentService.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/cloudAgentService.test.ts`:

```ts
const ATTACHMENT = { mimeType: 'image/webp' as const, data: 'AAAA' }

it('sends attachments over HTTP', async () => {
  await runViaHttp({
    message: 'what is this?',
    characterId: CHARACTER_UUID,
    attachments: [ATTACHMENT],
  })

  const [, init] = (global.fetch as jest.Mock).mock.calls[0]
  expect(JSON.parse(init.body).attachments).toEqual([ATTACHMENT])
})

it('sends attachments over WebSocket', async () => {
  await runViaWebSocketForTest({
    message: 'what is this?',
    characterId: CHARACTER_UUID,
    attachments: [ATTACHMENT],
  })

  const frames = mockSocket.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw))
  const agentRun = frames.find((f) => f.type === 'agent_run')
  expect(agentRun.attachments).toEqual([ATTACHMENT])
})
```

> Use the file's existing fetch mock and WS mock harness. The second test is the
> one that matters: the WS frame enumerates its fields explicitly, so an
> attachment added only to the HTTP body would produce exactly the intermittent
> bug the shared server schema exists to prevent.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- cloudAgentService`
Expected: FAIL — `attachments` is not a property of `CloudAgentPayload`.

- [ ] **Step 3: Extend the payload type**

In `src/services/cloudAgentService.ts`:

```ts
import type { AttachmentMimeType } from '../../shared/cloudAgentAttachments'

export interface CloudAgentAttachment {
  mimeType: AttachmentMimeType
  /** Base64 of the 1024px master. Never logged — this is user photo content. */
  data: string
}

export interface CloudAgentPayload {
  message: string
  characterId: string
  history?: Content[]
  unsyncedHistory?: CloudAgentUnsyncedTask[]
  /** At most one in Phase 2 (MAX_ATTACHMENTS_PER_TURN). */
  attachments?: CloudAgentAttachment[]
}
```

> If Task 0's spike failed, replace the import with a local
> `src/services/cloudAgentAttachments.ts` holding the same two constants, and add
> the equality test in Step 6.

- [ ] **Step 4: HTTP needs no change**

`runViaHttp` already does `JSON.stringify(payload)`, so `attachments` rides along
once it is on the type. Confirm by reading `src/services/cloudAgentService.ts:95`.

- [ ] **Step 5: Add the field to the WS frame**

In `runViaWebSocket`, destructure `attachments` from the payload alongside
`message`/`characterId`/`history`/`unsyncedHistory`, and add it to the frame:

```ts
      ws.send(JSON.stringify({
        type: 'agent_run',
        message,
        characterId,
        history,
        unsyncedHistory,
        timezone,
        attachments,
      }))
```

- [ ] **Step 6: If Task 0 failed — assert the duplicated constants cannot drift**

Only if the client keeps its own copy. Append to
`__tests__/cloudAgentProtocol.test.ts`:

```ts
import * as clientConstants from '~/services/cloudAgentAttachments'
import * as sharedConstants from '../shared/cloudAgentAttachments'

it('client constants equal the shared contract', () => {
  expect([...clientConstants.ATTACHMENT_MIME_TYPES]).toEqual([...sharedConstants.ATTACHMENT_MIME_TYPES])
  expect(clientConstants.MAX_ATTACHMENT_BASE64_CHARS).toBe(sharedConstants.MAX_ATTACHMENT_BASE64_CHARS)
  expect(clientConstants.MAX_ATTACHMENTS_PER_TURN).toBe(sharedConstants.MAX_ATTACHMENTS_PER_TURN)
})
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- cloudAgentService cloudAgentProtocol`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/services/cloudAgentService.ts __tests__/cloudAgentService.test.ts __tests__/cloudAgentProtocol.test.ts
git commit -m "feat(cloud-agent-client): send image attachments on both transports"
```

---

## Task 13: `imageModelBytes` — re-obtain a saved photo's base64

Needed by the retry path (§7): a `cloud`-kind row's local bytes are deleted after
a successful upload, so on a cold retry the original base64 is gone and only the
Phase 1 resolver can produce it.

**Files:**
- Create: `src/services/imageModelBytes.ts`
- Test: `__tests__/imageModelBytes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/imageModelBytes.test.ts`:

```ts
import { getImageAttachment } from '~/services/imageModelBytes'
import { getCharacterImageById } from '~/database/characterImageDatabase'
import { resolveImageUri } from '~/services/localImageStore'

jest.mock('~/database/characterImageDatabase')
jest.mock('~/services/localImageStore')

const row = {
  id: 'img-1',
  character_id: 'char-1',
  user_id: 'user-1',
  storage_kind: 'cloud' as const,
  master_ref: 'users/u/characters/c/img-1.webp',
  thumb_ref: null,
  mime_type: 'image/webp',
  source: 'chat' as const,
  sync_state: 'synced' as const,
  sync_attempts: 0,
  created_at: 1,
  deleted_at: null,
  message_id: 'msg-1',
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(getCharacterImageById as jest.Mock).mockResolvedValue(row)
})

it('reads a data: URI without a network round-trip', async () => {
  ;(resolveImageUri as jest.Mock).mockResolvedValue('data:image/webp;base64,AAAA')

  await expect(getImageAttachment('img-1')).resolves.toEqual({
    mimeType: 'image/webp',
    data: 'AAAA',
  })
  expect(global.fetch).not.toHaveBeenCalled()
})

it('returns null when the row is gone rather than throwing', async () => {
  ;(getCharacterImageById as jest.Mock).mockResolvedValue(null)
  await expect(getImageAttachment('img-1')).resolves.toBeNull()
})

it('returns null when the mime type is not an allowed attachment type', async () => {
  ;(getCharacterImageById as jest.Mock).mockResolvedValue({ ...row, mime_type: 'image/svg+xml' })
  ;(resolveImageUri as jest.Mock).mockResolvedValue('data:image/svg+xml;base64,AAAA')

  await expect(getImageAttachment('img-1')).resolves.toBeNull()
})

it('returns null when the image cannot be resolved', async () => {
  ;(resolveImageUri as jest.Mock).mockResolvedValue(null)
  await expect(getImageAttachment('img-1')).resolves.toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- imageModelBytes`
Expected: FAIL — "Cannot find module '~/services/imageModelBytes'".

- [ ] **Step 3: Write the module**

Create `src/services/imageModelBytes.ts`:

```ts
/**
 * Re-obtains a saved image's base64 for a model call.
 *
 * The first send holds the master base64 in memory — it was just encoded, and a
 * Storage round-trip would make the reply wait on an upload it does not need.
 * This is the *retry* path: a `cloud`-kind row's local bytes are deleted once
 * uploaded, so after an app restart the resolver is the only thing that can
 * produce them again. That re-encode is accepted for how rare a cold retry of a
 * failed vision turn is; caching base64 across restarts would put a second copy
 * of user photo content in a second place with its own lifecycle.
 *
 * Returns null on every failure. A vision retry that cannot find its bytes must
 * degrade to a plain text turn's error handling, not crash the send.
 */

import { getCharacterImageById } from '~/database/characterImageDatabase'
import { resolveImageUri } from '~/services/localImageStore'
import { isAttachmentMimeType, type AttachmentMimeType } from '../../shared/cloudAgentAttachments'

export interface ImageAttachment {
  mimeType: AttachmentMimeType
  data: string
}

async function base64FromUri(uri: string): Promise<string | null> {
  if (uri.startsWith('data:')) {
    const comma = uri.indexOf(',')
    return comma === -1 ? null : uri.slice(comma + 1)
  }

  const response = await fetch(uri)
  if (!response.ok) return null
  const blob = await response.blob()

  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onerror = () => resolve(null)
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma === -1 ? null : result.slice(comma + 1))
    }
    reader.readAsDataURL(blob)
  })
}

export async function getImageAttachment(imageId: string): Promise<ImageAttachment | null> {
  try {
    const row = await getCharacterImageById(imageId)
    if (!row) return null
    // The mime type is client-supplied data that round-tripped through the cloud.
    // Re-check it here rather than trusting the row: the same value drives
    // data-URI construction on web, and the agent contract admits only two types.
    if (!isAttachmentMimeType(row.mime_type)) return null

    const uri = await resolveImageUri(row, 'master')
    if (!uri) return null

    const data = await base64FromUri(uri)
    if (!data) return null

    return { mimeType: row.mime_type, data }
  } catch (err) {
    console.warn('Failed to load image bytes for the model:', imageId, err)
    return null
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- imageModelBytes`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/imageModelBytes.ts __tests__/imageModelBytes.test.ts
git commit -m "feat(images): resolve a saved image back to model-ready base64"
```

---

## Task 14: `useChatPhotoUpload` — pick or capture, resize, hand back a photo message

**Files:**
- Create: `src/hooks/useChatPhotoUpload.ts`
- Test: `__tests__/useChatPhotoUpload.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `__tests__/useChatPhotoUpload.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react-native'
import * as ImagePicker from 'expo-image-picker'
import { useChatPhotoUpload } from '~/hooks/useChatPhotoUpload'
import { prepareImageVariants } from '~/services/imageVariants'

jest.mock('expo-image-picker')
jest.mock('~/services/imageVariants')

const VARIANTS = {
  master: { base64: 'MASTER', mimeType: 'image/webp' as const },
  thumb: { base64: 'THUMB', mimeType: 'image/webp' as const },
}

beforeEach(() => {
  jest.resetAllMocks()
  ;(prepareImageVariants as jest.Mock).mockResolvedValue(VARIANTS)
})

it('builds a photo message from a picked asset without cropping it', async () => {
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: Awaited<ReturnType<typeof result.current.prepareFromAsset>>
  await act(async () => {
    photo = await result.current.prepareFromAsset({
      uri: 'file:///landscape.jpg',
      width: 1600,
      height: 900,
    })
  })

  expect(prepareImageVariants).toHaveBeenCalledWith({
    uri: 'file:///landscape.jpg',
    width: 1600,
    height: 900,
  })
  expect(photo).toEqual({
    imageId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    messageId: expect.stringMatching(/^msg_/),
    uri: 'file:///landscape.jpg',
    width: 1600,
    height: 900,
    variants: VARIANTS,
    attachment: { mimeType: 'image/webp', data: 'MASTER' },
  })
})

it('rejects an encode that exceeds the wire cap instead of sending a doomed request', async () => {
  ;(prepareImageVariants as jest.Mock).mockResolvedValue({
    master: { base64: 'A'.repeat(1_400_001), mimeType: 'image/webp' },
    thumb: { base64: 'THUMB', mimeType: 'image/webp' },
  })
  const { result } = renderHook(() => useChatPhotoUpload())

  await act(async () => {
    await expect(
      result.current.prepareFromAsset({ uri: 'file:///huge.jpg', width: 4000, height: 3000 }),
    ).rejects.toThrow(/too large/i)
  })
})

it('surfaces a denied camera permission as an error rather than throwing', async () => {
  ;(ImagePicker.launchCameraAsync as jest.Mock).mockRejectedValue(new Error('denied'))
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.captureFromCamera()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toBe('Camera access denied')
})

it('returns null when the camera is cancelled', async () => {
  ;(ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: [] })
  const { result } = renderHook(() => useChatPhotoUpload())

  let photo: unknown
  await act(async () => {
    photo = await result.current.captureFromCamera()
  })

  expect(photo).toBeNull()
  expect(result.current.error).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- useChatPhotoUpload`
Expected: FAIL — "Cannot find module '~/hooks/useChatPhotoUpload'".

- [ ] **Step 3: Write the hook**

Create `src/hooks/useChatPhotoUpload.ts`:

```ts
/**
 * Turns a picked or captured photo into everything the chat send path needs.
 *
 * Lives outside `ChatComposer` so that component does not grow a second large
 * async handler beside the wiki-ingestion one.
 *
 * Deliberately does NOT crop. `useAvatarUpload` squares its result because an
 * avatar fills a circle; a photo the user is asking a question about must reach
 * the model with the subject intact — a landscape centre-cropped to a square can
 * remove the very thing being asked about. Non-square gallery rows are already
 * safe: `CharacterAvatar` covers rather than letterboxes, so promoting a chat
 * photo to avatar crops at display time (reversible) instead of capture time.
 */

import { useCallback, useState } from 'react'
import * as ImagePicker from 'expo-image-picker'
import { prepareImageVariants, type ImageVariants } from '~/services/imageVariants'
import { generateSecureUuid } from '~/utilities/generateSecureUuid'
import {
  MAX_ATTACHMENT_BASE64_CHARS,
  isAttachmentMimeType,
} from '../../shared/cloudAgentAttachments'
import type { CloudAgentAttachment } from '~/services/cloudAgentService'

export interface PendingChatPhoto {
  /** Pre-minted so the message row can carry the render hint before the save. */
  imageId: string
  messageId: string
  uri: string
  width: number
  height: number
  /** Encoded once here; handed to `saveCharacterImage` so it does not re-encode. */
  variants: ImageVariants
  attachment: CloudAgentAttachment
}

interface UseChatPhotoUploadReturn {
  prepareFromAsset: (asset: { uri: string; width: number; height: number }) => Promise<PendingChatPhoto>
  pickFromLibrary: () => Promise<PendingChatPhoto | null>
  captureFromCamera: () => Promise<PendingChatPhoto | null>
  isPreparing: boolean
  error: string | null
  clearError: () => void
}

function newMessageId(): string {
  // Matches ChatView's messageIdGenerator so photo turns and text turns are
  // indistinguishable downstream.
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

export function useChatPhotoUpload(): UseChatPhotoUploadReturn {
  const [isPreparing, setIsPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearError = useCallback(() => setError(null), [])

  const prepareFromAsset = useCallback(
    async (asset: { uri: string; width: number; height: number }): Promise<PendingChatPhoto> => {
      setIsPreparing(true)
      try {
        const variants = await prepareImageVariants({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
        })

        if (!isAttachmentMimeType(variants.master.mimeType)) {
          throw new Error('This image format cannot be sent in chat.')
        }
        // Fail here rather than after a wasted round-trip: the server rejects the
        // same bound, and a 400 mid-send costs the user their photo and their wait.
        if (variants.master.base64.length > MAX_ATTACHMENT_BASE64_CHARS) {
          throw new Error('That photo is too large to send.')
        }

        return {
          imageId: generateSecureUuid(),
          messageId: newMessageId(),
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          variants,
          attachment: { mimeType: variants.master.mimeType, data: variants.master.base64 },
        }
      } finally {
        setIsPreparing(false)
      }
    },
    [],
  )

  const fromPickerResult = useCallback(
    async (result: ImagePicker.ImagePickerResult): Promise<PendingChatPhoto | null> => {
      if (result.canceled) return null
      const [asset] = result.assets
      if (!asset) return null
      return await prepareFromAsset({ uri: asset.uri, width: asset.width, height: asset.height })
    },
    [prepareFromAsset],
  )

  const pickFromLibrary = useCallback(async (): Promise<PendingChatPhoto | null> => {
    setError(null)
    try {
      // No allowsEditing: the OS cropper would force a square (see the module doc).
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      })
      return await fromPickerResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Photo library access denied')
      return null
    }
  }, [fromPickerResult])

  const captureFromCamera = useCallback(async (): Promise<PendingChatPhoto | null> => {
    setError(null)
    try {
      const result = await ImagePicker.launchCameraAsync({ quality: 1 })
      return await fromPickerResult(result)
    } catch (err) {
      // Matches useAvatarUpload's handling of a denied photo library: the picker
      // call is the only thing wrapped, so a downstream encode failure does not
      // get mislabelled as a permission problem.
      const message = err instanceof Error && !/denied/i.test(err.message)
        ? err.message
        : 'Camera access denied'
      setError(message)
      return null
    }
  }, [fromPickerResult])

  return { prepareFromAsset, pickFromLibrary, captureFromCamera, isPreparing, error, clearError }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- useChatPhotoUpload`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useChatPhotoUpload.ts __tests__/useChatPhotoUpload.test.tsx
git commit -m "feat(chat): prepare picked and captured photos for sending"
```

---

## Task 15: The composer branch — send in chat vs add to memory

**Files:**
- Modify: `src/components/ChatComposer.tsx:80` (`handlePlusPress`), `:250-275` (plus button)
- Modify: `src/components/ChatComposer.web.tsx:89` (same branch, no camera on web)
- Test: `__tests__/chatComposer.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/chatComposer.test.tsx`:

```tsx
it('prompts send-vs-memory when the pick is an image', async () => {
  ;(DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 1000 }],
  })

  const { getByLabelText, findByText } = render(<ChatComposer {...props} />)
  fireEvent.press(getByLabelText('Attach a photo or document'))

  expect(await findByText('Send in chat')).toBeTruthy()
  expect(await findByText('Add to memory')).toBeTruthy()
  expect(convertDocumentText).not.toHaveBeenCalled()
})

it('does not prompt for a text document and still ingests it', async () => {
  ;(DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 100 }],
  })

  const { getByLabelText, queryByText } = render(<ChatComposer {...props} />)
  await act(async () => { fireEvent.press(getByLabelText('Attach a photo or document')) })

  expect(queryByText('Send in chat')).toBeNull()
  await waitFor(() => expect(ingest).toHaveBeenCalled())
})

it('offers no photo option when the character cannot use the cloud agent', async () => {
  ;(DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg', size: 1000 }],
  })

  const { getByLabelText, findByText, queryByText } = render(
    <ChatComposer {...props} canSendPhoto={false} />,
  )
  fireEvent.press(getByLabelText('Attach a photo or document'))

  // Never silently degraded to a text-only turn: the option is present and
  // disabled with a reason, so the user is not left with a character that
  // answers confidently about an image it never received.
  expect(await findByText(/only cloud-synced characters can see photos/i)).toBeTruthy()
  expect(queryByText('Add to memory')).toBeTruthy()
})

it('sends a captured photo straight to chat', async () => {
  const onSendPhoto = jest.fn()
  const { getByLabelText } = render(
    <ChatComposer {...props} onSendPhoto={onSendPhoto} />,
  )
  await act(async () => { fireEvent.press(getByLabelText('Take a photo')) })

  await waitFor(() => expect(onSendPhoto).toHaveBeenCalled())
  expect(convertDocumentText).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- chatComposer`
Expected: FAIL — no send-vs-memory prompt exists.

- [ ] **Step 3: Add the props and the branch to `ChatComposer.tsx`**

Extend the props type:

```ts
type ChatComposerProps<TMessage extends IMessage = IMessage> = ComposerProps &
  Pick<SendProps<TMessage>, 'onSend' | 'text'> & {
    characterId?: string
    userId?: string
    onPhaseChange?: (phase: DocumentUploadPhase) => void
    /** False when the character has no cloud agent — the photo option is disabled, never degraded. */
    canSendPhoto?: boolean
    onSendPhoto?: (photo: PendingChatPhoto, caption: string) => void
  }
```

Split the existing handler: rename the current `handlePlusPress` body to
`ingestDocument(asset)` (unchanged logic, taking the already-picked asset), and
make the new `handlePlusPress` pick and branch:

```ts
  const { prepareFromAsset, captureFromCamera, isPreparing, error: photoError, clearError } =
    useChatPhotoUpload()
  const [pendingImageAsset, setPendingImageAsset] = useState<
    { uri: string; width: number; height: number; asset: DocumentPicker.DocumentPickerAsset } | null
  >(null)

  const handlePlusPress = useCallback(async () => {
    if (!characterId || !userId) return

    const pickerResult = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: [...TEXT_MIME_TYPES, ...CONVERT_MIME_TYPES],
    })
    if (pickerResult.canceled || !pickerResult.assets?.[0]) return

    const asset = pickerResult.assets[0]
    const mimeType = resolveDocumentMimeType(asset.name ?? asset.uri, asset.mimeType)
      ?.trim()
      .toLowerCase()

    // Images have been accepted here since before Phase 2, and they went to the
    // wiki. A user who has been dropping screenshots in to build the character's
    // memory must not find those screenshots silently becoming chat messages, so
    // the branch is a question, not a redirect. Non-image picks are untouched.
    if (mimeType?.startsWith('image/')) {
      setPendingImageAsset({
        uri: asset.uri,
        width: (asset as { width?: number }).width ?? 0,
        height: (asset as { height?: number }).height ?? 0,
        asset,
      })
      return
    }

    await ingestDocument(asset)
  }, [characterId, userId, ingestDocument])
```

Add the choice dialog (Paper's `Dialog` inside the existing `Portal`):

```tsx
      <Portal>
        <Dialog visible={pendingImageAsset !== null} onDismiss={() => setPendingImageAsset(null)}>
          <Dialog.Title>Add this image</Dialog.Title>
          {!canSendPhoto && (
            <Dialog.Content>
              <Text>Only cloud-synced characters can see photos in chat.</Text>
            </Dialog.Content>
          )}
          <Dialog.Actions>
            <Button
              disabled={!canSendPhoto}
              onPress={async () => {
                const picked = pendingImageAsset
                setPendingImageAsset(null)
                if (!picked) return
                try {
                  const photo = await prepareFromAsset({
                    uri: picked.uri,
                    width: picked.width,
                    height: picked.height,
                  })
                  onSendPhoto?.(photo, text ?? '')
                } catch (err) {
                  setToastMessage(err instanceof Error ? err.message : 'Failed to prepare photo.')
                }
              }}
            >
              Send in chat
            </Button>
            <Button
              onPress={async () => {
                const picked = pendingImageAsset
                setPendingImageAsset(null)
                if (picked) await ingestDocument(picked.asset)
              }}
            >
              Add to memory
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
```

Add the camera button beside the plus button (native only), and relabel the plus:

```tsx
            <IconButton
              icon="plus"
              size={20}
              onPress={handlePlusPress}
              style={styles.plusButton}
              accessibilityLabel="Attach a photo or document"
              accessibilityHint="Opens the picker to send a photo in chat or add a document to this character's memory"
            />
            {canSendPhoto && (
              <IconButton
                icon="camera"
                size={20}
                onPress={async () => {
                  // Capturing a photo in order to file it into memory is not a
                  // flow anyone asks for, so the camera goes straight to chat.
                  const photo = await captureFromCamera()
                  if (photo) onSendPhoto?.(photo, text ?? '')
                }}
                style={styles.plusButton}
                accessibilityLabel="Take a photo"
                accessibilityHint="Opens the camera and sends the photo in chat"
              />
            )}
```

Surface `photoError` through the existing `Snackbar`:

```tsx
  useEffect(() => {
    if (photoError) {
      setToastMessage(photoError)
      clearError()
    }
  }, [photoError, clearError])
```

Include `isPreparing` in the spinner condition alongside `isIngesting || phase !== null`.

- [ ] **Step 4: Mirror the branch in `ChatComposer.web.tsx`**

Apply the same props, the same `pendingImageAsset` dialog, and the same
`prepareFromAsset` call. **Omit the camera button** — `launchCameraAsync` has no
useful web behaviour and the file picker already covers the browser case.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- chatComposer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChatComposer.tsx src/components/ChatComposer.web.tsx __tests__/chatComposer.test.tsx
git commit -m "feat(chat): branch image picks between sending and memory ingestion"
```

---

## Task 16: `useAIChat` — the photo send path

**Files:**
- Modify: `src/hooks/useAIChat.ts:78-100` (persist), `:107` (edge), `:155-206` (cloud call), return type
- Test: `__tests__/useAIChatPhoto.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `__tests__/useAIChatPhoto.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react-native'
import { useAIChat } from '~/hooks/useAIChat'
import { callCloudAgent } from '~/services/cloudAgentService'
import { saveCharacterImage } from '~/services/characterImageService'
import { findCharacterImageByMessageId } from '~/database/characterImageDatabase'
import { sendMessage as persistUserMessage } from '~/services/messageService'
import { getImageAttachment } from '~/services/imageModelBytes'

jest.mock('~/services/cloudAgentService')
jest.mock('~/services/characterImageService')
jest.mock('~/database/characterImageDatabase')
jest.mock('~/services/messageService')
jest.mock('~/services/imageModelBytes')

const PHOTO = {
  imageId: '33333333-3333-4333-8333-333333333333',
  messageId: 'msg_1_abc',
  uri: 'file:///photo.jpg',
  width: 1600,
  height: 900,
  variants: {
    master: { base64: 'MASTER', mimeType: 'image/webp' as const },
    thumb: { base64: 'THUMB', mimeType: 'image/webp' as const },
  },
  attachment: { mimeType: 'image/webp' as const, data: 'MASTER' },
}

it('persists the message with the render hint, commits the row, then calls the agent', async () => {
  const { result } = renderHook(() => useAIChat(cloudCharacterProps))

  await act(async () => { await result.current.sendPhoto(PHOTO, 'what is this?') })

  expect(persistUserMessage).toHaveBeenCalledWith(
    'char-1',
    'user-1',
    expect.objectContaining({ _id: 'msg_1_abc', text: 'what is this?', imageId: PHOTO.imageId }),
  )
  // The base64 must never reach message_data — it would double the row size and
  // put a second copy of the photo in the message store.
  expect((persistUserMessage as jest.Mock).mock.calls[0][2].attachment).toBeUndefined()

  expect(saveCharacterImage).toHaveBeenCalledWith(
    expect.objectContaining({
      source: 'chat',
      imageId: PHOTO.imageId,
      messageId: 'msg_1_abc',
      variants: PHOTO.variants,
    }),
  )

  expect(callCloudAgent).toHaveBeenCalledWith(
    expect.objectContaining({ attachments: [PHOTO.attachment] }),
    expect.anything(),
  )
})

it('keeps the photo when the reply throws', async () => {
  ;(callCloudAgent as jest.Mock).mockRejectedValue(new Error('network'))
  const { result } = renderHook(() => useAIChat(cloudCharacterProps))

  await act(async () => {
    await result.current.sendPhoto(PHOTO, 'what is this?').catch(() => {})
  })

  expect(saveCharacterImage).toHaveBeenCalled()
  expect(result.current.error).toBeTruthy()
})

it('reuses the existing row on retry rather than consuming a second cap slot', async () => {
  ;(findCharacterImageByMessageId as jest.Mock).mockResolvedValue({
    id: PHOTO.imageId,
    mime_type: 'image/webp',
  })
  ;(getImageAttachment as jest.Mock).mockResolvedValue({ mimeType: 'image/webp', data: 'REREAD' })
  const { result } = renderHook(() => useAIChat(cloudCharacterProps))

  await act(async () => { await result.current.sendPhoto(PHOTO, 'what is this?') })

  expect(saveCharacterImage).not.toHaveBeenCalled()
  expect(callCloudAgent).toHaveBeenCalledWith(
    expect.objectContaining({ attachments: [{ mimeType: 'image/webp', data: 'REREAD' }] }),
    expect.anything(),
  )
})

it('refuses to send a photo when the character has no cloud agent', async () => {
  const { result } = renderHook(() => useAIChat(localOnlyCharacterProps))

  expect(result.current.canSendPhoto).toBe(false)
  await act(async () => { await result.current.sendPhoto(PHOTO, 'hi').catch(() => {}) })

  expect(callCloudAgent).not.toHaveBeenCalled()
  // Not degraded to a text-only turn — a character that answers confidently
  // about an image it never received is worse than a refusal.
  expect(result.current.error).toMatch(/cannot see photos/i)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- useAIChatPhoto`
Expected: FAIL — `sendPhoto` and `canSendPhoto` are not on the hook's return.

- [ ] **Step 3: Extend the return type**

In `src/hooks/useAIChat.ts`:

```ts
import type { PendingChatPhoto } from '~/hooks/useChatPhotoUpload'
import { saveCharacterImage } from '~/services/characterImageService'
import { findCharacterImageByMessageId } from '~/database/characterImageDatabase'
import { getImageAttachment } from '~/services/imageModelBytes'

interface UseAIChatReturn {
  messages: IMessage[]
  sendMessage: (message: IMessage) => Promise<void>
  /** Vision turn. Cloud-agent only — see `canSendPhoto`. */
  sendPhoto: (photo: PendingChatPhoto, caption: string) => Promise<void>
  canSendPhoto: boolean
  isGeneratingResponse: boolean
  error: string | null
  escalationState: EscalationState
  activeTool: string | null
  streamingMessage: IMessage | null
}
```

- [ ] **Step 4: Factor the cloud-agent turn so the photo path can reuse it**

Extract the existing cloud-agent block (`useAIChat.ts:155-206` through the reply
persist) into a local `async function runCloudAgentTurn(message: IMessage, attachments?: CloudAgentAttachment[])`
that takes the attachments and passes them straight through:

```ts
        const agentResult = await callCloudAgent(
          {
            message: message.text,
            characterId: cloudCharacterId,
            history,
            unsyncedHistory,
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          },
          {
            onToolStart: (name) => setActiveTool(name),
            onToolEnd: () => setActiveTool(null),
            onToken: (text) => { /* unchanged */ },
          },
        )
```

The existing `sendMessage` path calls it with no attachments, so its behaviour is
byte-for-byte what it is today.

- [ ] **Step 5: Add `sendPhoto`**

```ts
  const sendPhoto = useCallback(
    async (photo: PendingChatPhoto, caption: string) => {
      if (!canUseCloudAgent || !cloudAgentCharacterId) {
        // Explicit refusal, never a quiet text-only fallback.
        setError('This character cannot see photos. Turn on cloud sync to send images.')
        return
      }

      setError(null)
      setIsSendingMessage(true)
      try {
        const message: IMessage & { imageId: string } = {
          _id: photo.messageId,
          text: caption.trim(),
          createdAt: new Date(),
          user: { _id: userId },
          // Render hint. Written once at message creation and never updated;
          // `character_images.message_id` stays authoritative for the gallery.
          // Carrying it on the message is what lets the chat list render the
          // photo with no extra query and no new sync path — and lets a device
          // whose message synced first show a placeholder rather than a bare
          // text bubble that silently gains an image later.
          imageId: photo.imageId,
        }

        // Bubble first, so it is visible while the model is thinking.
        await persistUserMessage(character.id, userId, message)

        // A retried vision turn finds the row it already wrote. Writing a second
        // one would spend two of the 100 FIFO slots on one photo.
        const existing = await findCharacterImageByMessageId(photo.messageId)
        let attachment = photo.attachment

        if (existing) {
          // On a cold retry the in-memory base64 is gone (a cloud row's local
          // bytes are deleted after upload), so re-obtain it through the resolver.
          const reread = await getImageAttachment(existing.id)
          if (reread) attachment = reread
        } else {
          // Committed before the model call and kept regardless of the outcome:
          // a user who framed and sent a photo should not have to re-pick it
          // because the network dropped.
          await saveCharacterImage({
            characterId: character.id,
            userId,
            uri: photo.uri,
            width: photo.width,
            height: photo.height,
            source: 'chat',
            imageId: photo.imageId,
            messageId: photo.messageId,
            variants: photo.variants,
          })
        }

        await runCloudAgentTurn(message, [attachment])
      } catch (err) {
        reportError(err, `chat:${character.id}:sendPhoto`)
        setError(err instanceof Error ? err.message : 'Failed to send photo')
      } finally {
        setIsSendingMessage(false)
        setStreamingMessage(null)
        void queryClient.invalidateQueries({ queryKey: messageKeys.list(characterId, userId) })
      }
    },
    [canUseCloudAgent, cloudAgentCharacterId, character.id, userId, queryClient, characterId],
  )
```

Return `sendPhoto` and `canSendPhoto: canUseCloudAgent` from the hook.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- useAIChatPhoto useAIChat`
Expected: PASS — new suite plus every existing `useAIChat` test unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useAIChat.ts __tests__/useAIChatPhoto.test.tsx
git commit -m "feat(chat): send photos to the cloud agent and commit them to the gallery"
```

---

## Task 17: History says `[sent a photo]` for a captionless turn

`buildContentHistory` filters out empty-text messages, so a captionless photo
turn would vanish from the transcript entirely — the model would see a gap where
the user clearly did something.

**Files:**
- Modify: `src/services/CharacterPromptBuilder.ts:41-56`
- Test: `__tests__/characterPromptBuilder.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/characterPromptBuilder.test.ts`:

```ts
describe('photo turns in history', () => {
  const base = { createdAt: new Date(1), user: { _id: 'user-1' } }

  it('substitutes a marker for a captionless photo rather than dropping the turn', () => {
    const history = buildContentHistory(
      [{ ...base, _id: 'm1', text: '', imageId: 'img-1' } as never],
      'user-1',
    )

    expect(history).toEqual([{ role: 'user', parts: [{ text: '[sent a photo]' }] }])
  })

  it('keeps the caption when there is one', () => {
    const history = buildContentHistory(
      [{ ...base, _id: 'm1', text: 'what is this?', imageId: 'img-1' } as never],
      'user-1',
    )

    expect(history).toEqual([{ role: 'user', parts: [{ text: 'what is this?' }] }])
  })

  it('still drops an empty message with no photo', () => {
    expect(buildContentHistory([{ ...base, _id: 'm1', text: '' } as never], 'user-1')).toEqual([])
  })

  // History stays text-only: re-sending every past photo on every turn grows the
  // payload without bound. Recall of older images is a Phase 3 agent tool.
  it('never puts inlineData in history', () => {
    const history = buildContentHistory(
      [{ ...base, _id: 'm1', text: 'hi', imageId: 'img-1' } as never],
      'user-1',
    )

    expect(JSON.stringify(history)).not.toContain('inlineData')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- characterPromptBuilder`
Expected: FAIL — the captionless turn is filtered out, so the first case gets `[]`.

- [ ] **Step 3: Implement**

In `src/services/CharacterPromptBuilder.ts`:

```ts
  /** What a photo turn with no caption reads as in the text-only transcript. */
  static readonly PHOTO_TURN_PLACEHOLDER = '[sent a photo]'

  static buildContentHistory(
    messages: IMessage[],
    userId: string,
  ): { role: 'user' | 'model'; parts: { text: string }[] }[] {
    return [...messages]
      .map((msg) => ({
        msg,
        // A captionless photo is a real turn. Filtering it out would leave the
        // model a transcript in which the user said nothing and the character
        // then described something — incoherent. The bytes are deliberately not
        // re-sent (see §8): the model can see that a photo was sent, not the photo.
        text: msg.text.trim()
          ? msg.text
          : (msg as { imageId?: string }).imageId
            ? CharacterPromptBuilder.PHOTO_TURN_PLACEHOLDER
            : '',
      }))
      .filter((entry) => entry.text)
      .sort(
        (a, b) =>
          new Date(a.msg.createdAt as string | number | Date).getTime() -
          new Date(b.msg.createdAt as string | number | Date).getTime(),
      )
      .map((entry) => ({
        role: (entry.msg.user._id === userId ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: entry.text }],
      }))
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- characterPromptBuilder`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/CharacterPromptBuilder.ts __tests__/characterPromptBuilder.test.ts
git commit -m "feat(chat): keep captionless photo turns coherent in history"
```

---

## Task 18: `ChatImageBubble` and the GiftedChat wiring

**Files:**
- Create: `src/components/ChatImageBubble.tsx`
- Modify: `src/components/ChatView.tsx:439-450` (GiftedChat props), `:323-335` (renderComposer)
- Test: `__tests__/chatImageBubble.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `__tests__/chatImageBubble.test.tsx`:

```tsx
import { render, fireEvent } from '@testing-library/react-native'
import ChatImageBubble from '~/components/ChatImageBubble'
import { useResolvedImage } from '~/hooks/useResolvedImage'

jest.mock('~/hooks/useResolvedImage')

it('renders the thumb variant, not the master', () => {
  ;(useResolvedImage as jest.Mock).mockReturnValue('file:///thumb.webp')

  const { getByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )

  expect(useResolvedImage).toHaveBeenCalledWith('img-1', 'thumb')
  expect(getByLabelText('Photo in this message')).toBeTruthy()
})

it('opens the master in a viewer on tap', () => {
  ;(useResolvedImage as jest.Mock).mockReturnValue('file:///thumb.webp')

  const { getByLabelText, queryByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )
  expect(queryByLabelText('Full size photo')).toBeNull()

  fireEvent.press(getByLabelText('Photo in this message'))

  expect(getByLabelText('Full size photo')).toBeTruthy()
  expect(useResolvedImage).toHaveBeenCalledWith('img-1', 'master')
})

it('degrades to nothing when the image no longer resolves', () => {
  // The photo may have been deleted from the Avatar Picker, evicted by the FIFO
  // cap, or not yet synced to this device. The message keeps its text either way.
  ;(useResolvedImage as jest.Mock).mockReturnValue(null)

  const { queryByLabelText, getByLabelText } = render(
    <ChatImageBubble currentMessage={{ _id: 'm1', imageId: 'img-1' } as never} />,
  )

  expect(queryByLabelText('Photo in this message')).toBeNull()
  expect(getByLabelText('Photo unavailable')).toBeTruthy()
})

it('renders nothing for a message with no image', () => {
  const { toJSON } = render(<ChatImageBubble currentMessage={{ _id: 'm1' } as never} />)
  expect(toJSON()).toBeNull()
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- chatImageBubble`
Expected: FAIL — "Cannot find module '~/components/ChatImageBubble'".

- [ ] **Step 3: Write the component**

Create `src/components/ChatImageBubble.tsx`:

```tsx
/**
 * The photo inside a chat bubble.
 *
 * Renders the 256 thumb, not the master: a scrollback of masters is ~15 MB of
 * decoded bitmaps against ~1.2 MB of thumbs, which is the same reason the picker
 * uses thumbs. The master is resolved only once the user taps through.
 *
 * Download and share belong to Phase 3, where they arrive with expo-media-library
 * and expo-sharing for agent-generated images.
 */

import { useState } from 'react'
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'
import type { IMessage } from 'react-native-gifted-chat'
import { useResolvedImage } from '~/hooks/useResolvedImage'

type PhotoMessage = IMessage & { imageId?: string }

const THUMB_SIZE = 200

export default function ChatImageBubble({ currentMessage }: { currentMessage?: PhotoMessage }) {
  const imageId = currentMessage?.imageId ?? null
  const [viewerOpen, setViewerOpen] = useState(false)

  const thumbUri = useResolvedImage(imageId, 'thumb')
  // Resolved only while the viewer is open so scrollback never pulls masters.
  const masterUri = useResolvedImage(viewerOpen ? imageId : null, 'master')

  if (!imageId) return null

  if (!thumbUri) {
    // A dangling render hint is expected, not exceptional: the row may be
    // mid-sync on this device, deleted from the gallery, or cap-evicted. The
    // message keeps its text; only the picture degrades.
    return (
      <View style={styles.placeholder} accessible accessibilityLabel="Photo unavailable">
        <Text variant="labelSmall">Photo unavailable</Text>
      </View>
    )
  }

  return (
    <>
      <Pressable
        onPress={() => setViewerOpen(true)}
        accessibilityRole="imagebutton"
        accessibilityLabel="Photo in this message"
        accessibilityHint="Opens the photo full screen"
      >
        <Image
          source={{ uri: thumbUri }}
          style={styles.thumb}
          // Contain, not cover: chat photos keep their native aspect ratio, and
          // cropping the bubble preview would hide the part being asked about.
          resizeMode="contain"
        />
      </Pressable>

      <Modal visible={viewerOpen} transparent onRequestClose={() => setViewerOpen(false)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setViewerOpen(false)}>
          {masterUri && (
            <Image
              source={{ uri: masterUri }}
              style={styles.viewerImage}
              resizeMode="contain"
              accessible
              accessibilityLabel="Full size photo"
            />
          )}
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 12, margin: 3 },
  placeholder: {
    width: THUMB_SIZE,
    height: 60,
    margin: 3,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: { width: '100%', height: '100%' },
})
```

- [ ] **Step 4: Run the component tests to verify they pass**

Run: `npm test -- chatImageBubble`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it into `ChatView`**

In `src/components/ChatView.tsx`, pull the new members from `useAIChat`:

```ts
  const {
    messages, sendMessage, sendPhoto, canSendPhoto,
    escalationState, isGeneratingResponse, activeTool, streamingMessage,
  } = useAIChat({ characterId, userId: currentUserId, character: toAIChatCharacter(character) })
```

Add a photo send handler beside `handleSend`:

```ts
  const handleSendPhoto = useCallback(
    async (photo: PendingChatPhoto, caption: string) => {
      if (!creditsLoading && credits <= 0) {
        router.push('/subscribe')
        return
      }
      await sendPhoto(photo, caption)
    },
    [sendPhoto, credits, creditsLoading],
  )
```

Pass both new props through `renderComposer`:

```tsx
      <ChatComposer
        {...props}
        characterId={characterId}
        userId={currentUserId}
        onPhaseChange={setDocumentPhase}
        canSendPhoto={canSendPhoto}
        onSendPhoto={handleSendPhoto}
      />
```

…adding `canSendPhoto` and `handleSendPhoto` to that `useCallback`'s deps.

Add the render prop to `<GiftedChat>`:

```tsx
        renderMessageImage={(props) => <ChatImageBubble currentMessage={props.currentMessage} />}
```

- [ ] **Step 6: Verify the whole chat surface still renders**

Run: `npm test -- chatView chatComposer chatImageBubble`
Expected: PASS.

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/components/ChatImageBubble.tsx src/components/ChatView.tsx __tests__/chatImageBubble.test.tsx
git commit -m "feat(chat): render chat photos in bubbles with tap-to-view"
```

---

## Task 19: Bind `storage.rules` to `ATTACHMENT_MIME_TYPES`

`storage.rules` is a Firebase rules file that cannot import TypeScript, so this
is the one boundary where a single source of truth is impossible. A test that
fails on divergence is the next-best control — and unlike a comment saying "keep
in sync", it runs.

**Files:**
- Modify: `__tests__/storageRules.test.ts:15-17`

- [ ] **Step 1: Write the failing test**

Replace the `admits only webp and jpeg on write` case in
`__tests__/storageRules.test.ts`:

```ts
import { ATTACHMENT_MIME_TYPES } from '../shared/cloudAgentAttachments'

  // The agent's allowlist and the Storage rules' allowlist must agree. A type
  // the agent accepts but the rules reject produces a photo the model sees and
  // the gallery then fails to store — quietly breaking the promise that a photo
  // is kept regardless of how the reply goes.
  it('admits exactly the mime types the agent accepts as attachments', () => {
    const expected = `request.resource.contentType in [${ATTACHMENT_MIME_TYPES.map((t) => `'${t}'`).join(', ')}]`
    expect(rules).toContain(expected)
  })
```

- [ ] **Step 2: Run to verify it passes today and fails on divergence**

Run: `npm test -- storageRules`
Expected: PASS.

Temporarily add `'image/png'` to `ATTACHMENT_MIME_TYPES` in
`shared/cloudAgentAttachments.ts`, re-run `npm test -- storageRules`.
Expected: FAIL. Then revert.

- [ ] **Step 3: Confirm `storage.rules` itself is untouched**

Run: `git diff --stat storage.rules`
Expected: no output. Phase 1 §20.2 records that the rules file has no emulator
coverage and should not be edited without cause; this task is a test, not a
rules change.

- [ ] **Step 4: Commit**

```bash
git add __tests__/storageRules.test.ts
git commit -m "test(storage): bind storage.rules content types to the agent attachment allowlist"
```

---

## Task 20: Full verification

**Files:** none

- [ ] **Step 1: Run every suite**

```bash
npm test
cd cloud-agent && npm test && cd ..
cd functions && npm test && cd ..
```

Expected: all green. Record any pre-existing failure explicitly rather than
assuming it is unrelated.

- [ ] **Step 2: Typecheck every project**

```bash
npm run typecheck
cd cloud-agent && npm run typecheck && cd ..
cd functions && npx tsc --noEmit && cd ..
```

Expected: exit 0 for each.

- [ ] **Step 3: Lint**

Run: `npm run lint:check`
Expected: no new errors.

- [ ] **Step 4: Confirm no photo bytes are logged anywhere**

Run:

```bash
grep -rn "attachments" --include=*.ts --include=*.tsx src cloud-agent/src shared | grep -i "console\."
```

Expected: no output.

- [ ] **Step 5: Manual smoke (dev sandbox, cloud-synced character)**

1. `npm start`, open a cloud-synced character.
2. Tap `+`, pick a **landscape** photo → choose **Send in chat** → the bubble shows
   the photo un-cropped and the reply describes it.
3. Tap the bubble → full-screen master opens.
4. Tap `+`, pick a `.txt` → **no prompt**, wiki ingestion runs as before.
5. Tap the camera icon → capture → goes straight to chat.
6. Send a photo with an empty caption → accepted, reply arrives.
7. Open the Avatar Picker → the chat photo is listed and selectable as the avatar;
   selecting it shows it cropped-to-fill in the circle, not letterboxed.
8. Open a **local-only** character → the photo option is disabled with the
   cloud-sync explanation; the memory path still works.
9. Kill the network mid-send → the reply errors, and the photo is still in the
   bubble and in the gallery.

- [ ] **Step 6: Report**

State plainly which suites passed, which manual steps were performed, and
anything skipped. Do not claim completion for a step that was not run.

---

## Self-review notes

- **Spec §4.3 (square crop)** is satisfied by *not* cropping in the chat path
  (Task 14) plus the pinning tests in Task 9 — see the Deviations section for why
  `imageVariants.ts` itself needs no change.
- **Spec §6.1's client-side reuse** is resolved by Task 0 and the constants split;
  both outcomes are covered (Task 12 Step 6 is the fallback).
- **Spec §7's "retry reuses the row"** is Task 16's third test plus
  `findCharacterImageByMessageId` (Task 7) and `getImageAttachment` (Task 13).
- **Spec §10's "cross-device" row** is covered by Task 11's two directions plus
  Task 18's "degrades to nothing" case (message-before-image renders the
  placeholder; image-before-message is a plain gallery row).
- **Spec §10's "edge gating"** is Task 15's third test and Task 16's fourth.
- **Not implemented, by design (spec §11):** agent-initiated generation, an agent
  tool for looking at arbitrary gallery images, multi-image turns, and
  download/share from the viewer.

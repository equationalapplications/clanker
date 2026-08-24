# Agent Chat Image Generation — Design

**Date:** 2026-08-23
**Branch:** `feat/chat-image-generation`
**Status:** Implemented (verified 2026-08-24).
**Supersedes the deferral in:** image-pipeline refactor §18 and vision-chat-uploads §11, both of which scoped this feature explicitly.

## 1. Summary

AI characters can generate one image per reply during cloud-agent chat conversations. The character's tool call runs server-side (Vertex image model), the 200-credit charge is taken inside the tool with spend-before-generate / refund-on-failure semantics, and the resulting base64 rides the live turn response back to the sending device. The client persists it through the **existing** `saveCharacterImage` pipeline exactly as chat photo uploads do today — no new server persistence, no new sync paths, zero database migrations.

The feature is dual-purpose by design: a work tool (charts, diagrams, visual plans requested mid-project) and a fun one (character selfies). A companion static SEO page (`public/image-generation/`, plan drafted) ships **separately** from this code change — it is NOT part of this release; see §11.

## 2. Goals

1. User asks in chat → character generates and sends an image within the same reply.
2. Character may _offer_ unprompted ("want me to draw that?"); an offer never spends; generation requires the request or an explicit yes.
3. Generated images render in the chat bubble immediately, land in the character's gallery, and survive across devices through existing sync.
4. Save-to-Photos and Share available from the image viewer on day one.
5. Cost is transparent: same 200-credit price as avatar generation, visible in the turn's usage snapshot.

## 3. Non-goals

- Multiple images per reply (hard-capped at one).
- Image editing, variations, or follow-up refinement of a prior image.
- Server-side persistence of any kind (Storage writes, Postgres inserts, signed URLs).
- Changes to sync pull semantics, `character_images` schema, or Storage rules.
- Edge-agent support (edge stays text-only; capability gaps route to cloud — established doctrine).
- Web client rendering (clanker-ai.com ignores the new payload for now).
- Modernizing the avatar pipeline's legacy model in `functions/src/generateImage.ts`.
- Dedicated rate limiting beyond the 1-per-reply cap + credit price.

## 4. Locked product decisions (agreed with user — do not revisit)

| #   | Decision                                                    |
| --- | ----------------------------------------------------------- |
| 1   | Request-only trigger; agent may offer unprompted            |
| 2   | 200 credits/image, spend-before-generate, refund-on-failure |
| 3   | Save + share included this phase                            |
| 4   | Max 1 image per assistant reply                             |

## 5. Architecture

```
user ask ──▶ WS agent_run / HTTP POST /agent/run
              └─ buildAgent(): LlmAgent(gemini-3.5-flash) + tools[…, generate_image]
                   └─ tool execute:
                        spendCredit(user, 200, 'image_generate')
                        Vertex image model ──▶ inlineData base64
                        collector.push(base64)          ← in-process, run-scoped
                        refundCredit(allocations) on ANY failure branch
              post-loop (handler):
                WS  → emit {type:'agent_image', …} frame before usage_snapshot/close
                HTTP→ attach generatedImage field to final JSON result
              client (useAIChat):
                mint imageId → saveCharacterImage(source:'chat', pre-minted ids)
                → assistant row carries message_data.imageId
                → ChatImageBubble renders; sweeper pushes bytes+row to cloud as usual
```

Key constraint driving this shape: tool returns reach only the model — never the client (`agentEventLoop.ts` forwards names and text tokens exclusively), and neither messages nor `character_images` rows sync to devices in realtime (pull happens only on manual Cloud Sync or empty-DB restore). Therefore the image must arrive inside the turn response itself, and persistence must happen on-device.

## 6. Detailed design

### 6.1 Cloud-agent tool — `cloud-agent/src/tools/generateImage.ts` (new)

House-pattern closure factory: `generateImage(userId, cs, collector, vertexGenerate?, spendLedger?)` returning a `FunctionTool`. `db` is intentionally omitted — the tool never touches the database. `collector` is the run-scoped `GeneratedImage[]` minted by `buildAgent()` per agent_run (tool results reach only the model, so bytes reach the client through it); `vertexGenerate` is the optional injection seam tests use to stub the Vertex call; `spendLedger` records the exact credit allocations backing a successful generation so post-tool failure paths can refund them.

- **name** `generate_image`; **parameters** Zod `{ prompt: z.string().min(1).max(2000) }`.
- **description** carries ALL usage rules (the system instruction contains no tool guidance anywhere in cloud-agent): generate only when the user requests an image or explicitly accepts a prior offer; offering in plain text is always allowed and free; at most one image per reply; suited to charts, diagrams, visual plans, and selfies.
- **execute flow**, in order:
  1. Closure-local `generatedThisRun` flag → if already generated, return a sentence saying one image per reply is the limit (hard enforcement of decision #4, independent of model obedience).
  2. `cs.spendCredit(userId, IMAGE_GENERATION_COST, 'image_generate')` — on `INSUFFICIENT_CREDITS` catch, return a friendly out-of-credits sentence for the model to relay (browserAction pattern; never throw into the loop).
  3. Trim/validate prompt (≤2000 chars); call Vertex image model (§6.4) with `responseModalities:['TEXT','IMAGE']`; extract first `inlineData` part.
  4. Guards mirrored from `functions/src/generateImage.ts`: MIME ∈ {png, jpeg, webp}, base64 ≤8M chars. No avatar portrait wrapper — raw user-intent prompt only.
  5. Success: push `{ imageBase64, mimeType }` onto the run-scoped collector; return a short JSON string to the model (`{status:'ok'}` — never the base64 itself; tool results are tokenized into the model context).
  6. Any failure after step 2 (Vertex error, missing/invalid image part, guard trip): `cs.refundCredit(allocations)`, return a failure sentence the model can apologize with. Each refund path owned by the tool — outer-loop refunds do not cover tool-level spends (verified: `consumeAgentEvents` only refunds allocations it collected).

### 6.2 Agent wiring + run-scoped collector — `agentCore.ts`

- Push the new tool into the array in `buildAgent()` alongside existing tools (unconditional — credits are available on both transports).
- `buildAgent()` additionally creates `const imageCollector: GeneratedImage[] = []`, closes the tool over it, and returns it alongside the agent (small signature change; callers destructure).
- Handlers read the collector after `consumeAgentEvents` resolves. In-process, single-run lifetime — no shared state across requests.

### 6.3 Transport delivery (parity is mandatory)

- **WS** (`wsAgentHandler.ts`): after the event loop, if the collector is non-empty, emit `{ type: 'agent_image', imageBase64, mimeType }` once, _before_ `usage_snapshot` and close. Unknown frame types are ignored by old clients (verified client dispatch), making this additive-safe.
- **HTTP** (`index.ts` `/agent/run`): attach `generatedImage: { imageBase64, mimeType } | null` to the final result object next to `reply`/`toolCalls`/`usageSnapshot`.
- `transportParity.test.ts` is extended to assert both transports deliver identically-shaped payloads.
- v1 emission point is post-loop only (single code path, trivial parity): text streams first, image lands with completion. Earlier mid-stream emission can be a fast-follow behind the same frame type.
- Old mobile clients and the web client ignore the frame/field gracefully: text-only reply, no crash. Accepted rollout-window edge case.

### 6.4 Image model

- **Primary:** `gemini-3.1-flash-image` family via `@google/genai` `{vertexai:true}` — pinned as a single constant `CHAT_IMAGE_MODEL_ID` in `cloud-agent/src/constants/`. Preferred concrete value: **`gemini-3.1-flash-lite-image`** (native ~1K output matches our 1024-master/256-thumb variant pipeline without downscaling waste; lowest latency/cost tier of the current Nano Banana generation). `gemini-2.5-flash-image` (today's prod avatar model) remains the documented fallback value of the same constant — swapping requires no code change.
- The avatar pipeline keeps its existing model; only this tool reads the new constant.
- Plan-stage spike (§10) verifies which of these model IDs are callable via Vertex from clanker-prod's runtime identity and their per-image billing; ship the fallback rather than block if the Lite SKU is absent on Vertex.
- No aspect-ratio parameter in v1 — model default; noted as fast-follow if charts/diagrams demand non-square canvases.

### 6.5 Client ingestion + persistence — `src/hooks/useAIChat.ts` (+ `cloudAgentService.ts`)

- `cloudAgentService` gains optional callback `onAgentImage({ imageBase64, mimeType })` fed by the WS frame type and by the HTTP result field; both funnel through one consumer so transport differences stay invisible to callers.
- On callback, `useAIChat`:
  1. Mints `imageId = generateSecureUuid()`; uses the streaming assistant message's already-minted id as `messageId` (post-#621 there is exactly one AI id per stream, minted at stream start).
  2. Calls `saveCharacterImage({ characterId, userId, uri: 'data:' + mimeType + ';base64,' + imageBase64, width:1024, height:1024, source:'chat', imageId, messageId })` — the exact shape `useAIChat.sendPhoto` uses, including the `findCharacterImageByMessageId` dedupe guard. Reservation → variants → upload → sweeper registration all reuse existing machinery untouched.
  3. Skips `setActiveImageId` — a chat image is a gallery row, not an avatar choice (same rule as chat photos).
  4. Persists `imageId` onto the assistant message so it serializes into the SQLite **`message_data`** column (canonical name everywhere in this spec; `additionalData` appears only as the in-code object at `messageDatabase.ts`'s stringify site). This write must ride the same settle path that persists the final reply so the id survives #621's clear-after-refetch ordering, leaving `MessageBubble → ChatImageBubble → useResolvedImage(imageId,'thumb')` working with zero component changes.

### 6.6 Save/share UI — `ChatImageBubble.tsx` viewer modal

- **Save to Photos:** `expo-media-library` (new dependency, Expo 57-compatible line), add-only permission flow, new `NSPhotoLibraryAddUsageDescription` in `app.config.ts`. Verified per house rule with a prebuild Info.plist diff — not just tests.
- **Share:** `expo-sharing` (already installed; currently used only by OKF export) sharing the resolved master URI.
- Either action failing — or a press while the master lookup is still in flight, or one after it completed without a URI — degrades to an **inline notice rendered inside the viewer** (the `noticePill`); no toasts. Gallery rows and viewer state are unaffected.

### 6.7 Source semantics

Reuse `'chat'`. The TS union `'generated'|'uploaded'|'imported'|'chat'` and the functions-callable validator gain no new member — an agent image IS a chat image by the vision spec's own definition; adding `'agent'` would touch three validators for zero behavioral gain.

### 6.8 Credits

- `export const IMAGE_GENERATION_COST = 200` added to `cloud-agent/src/constants/credits.ts`, mirroring `functions/src/constants/credits.ts:8`.
- Normal turn billing is unchanged (100/loop-iteration, cap 5); an image turn therefore totals iterations×100 + 200, all visible in the existing `usage_snapshot` frame. No display changes required.
- Refund safety net unchanged: `refundCredit`'s expiry-predicated re-increment (with non-expiring compensation row) applies to tool refunds exactly as elsewhere.

## 7. Error handling matrix

| Failure                                                                         | Layer                          | Outcome                                                                                                            |
| ------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Insufficient credits                                                            | tool spend                     | Sentence to model; agent relays; nothing generated, nothing refunded (nothing taken)                               |
| Vertex error / empty response / guard trip                                      | tool                           | Full refund + failure sentence to model                                                                            |
| Second generation attempt in one run                                            | tool flag                      | Declining sentence to model; no spend                                                                              |
| Client save/upload fails                                                        | client hook                    | Text reply stands; image lost locally; existing reservation rollback cleans up                                     |
| Old mobile client receives frame                                                | transport                      | Frame ignored; text-only reply                                                                                     |
| Web client receives frame                                                       | transport                      | Ignored; web rendering out of scope                                                                                |
| Loop throws after a successful generation (ADK error event / empty final reply) | handler catch path (WS + HTTP) | Image spend refunded with its recorded allocations; error frame / 500 replaces the text reply — no image delivered |
| Collector empty at emit time                                                    | handlers                       | No frame / null field — silent, valid                                                                              |

## 8. Security considerations

- Prompt-injection via wiki/character context inducing unwanted generation is bounded four ways: behavioral rules in the tool description, the hard 1-per-reply cap, the explicit 200-credit price (visible in usage snapshot), and request-or-accepted-offer framing. Residual risk accepted for v1; no confirmation round-trip is possible (one `agent_run` per WS connection).
- Auth status quo maintained: Firebase ID-token auth on both transports; App Check stays enforced at the functions boundary (unchanged scope).
- Outbound frames remain uncapped as today; a single ≤8M-char base64 matches the Live handler's existing audio-frame precedent.
- No storage.rules changes; client uploads satisfy existing path/content-type bindings unchanged.

## 9. Testing

**cloud-agent (node:test — NOT Jest):**

- New `tools/generateImage.test.ts`: spend-before-generate ordering against a fake credit service; refund asserted on every failure branch; INSUFFICIENT_CREDITS sentence path; second-call decline; prompt truncation; MIME/base64 guards; collector push shape.
- Handler tests: WS emits `agent_image` before `usage_snapshot`/close when collector non-empty, omits when empty; HTTP result carries `generatedImage`.
- `transportParity.test.ts` extension for the new payload.
- Baseline discipline: suite currently 288 (287 pass, 1 skipped) + two known flakes.

**Client (Jest, scoped runs):**

- `useAIChat` ingestion: mocked `onAgentImage` → asserts saveCharacterImage call shape (pre-minted ids, `source:'chat'`, dedupe), `message_data.imageId` persisted on settle, `setActiveImageId` NOT called.
- Viewer actions with `MediaLibrary`/`Sharing` mocked: success, permission-denied, and failure paths — each failure renders the inline `noticePill` inside the viewer (no toasts, no gallery-row or viewer-state changes).
- React-query suites keep `gcTime: 0`; root filtering via `npx jest <path>`.

**Manual verification gate:** device run — ask a character for a chart → bubble renders → save/share → gallery entry → second device sees it after Cloud Sync pull.

## 10. Implementation-time verifications (plan-stage spikes)

1. `@google/genai` resolvable from cloud-agent (direct dep vs transitive via ADK) and `CHAT_IMAGE_MODEL_ID` candidates callable via Vertex under clanker-prod; record per-image price.
2. Runtime service account permission for the chosen image model (ops grant if missing).
3. `expo-media-library` version compatible with Expo 57; prebuild diff of Info.plist shows the new usage string.
4. Post-deploy traffic check: verify the cloud-agent revision actually takes traffic (Cloud Run 0%-traffic anomaly precedent).

## 11. Companion marketing page

Static SEO page ships **separately from this release** per the approved-plan-pending draft at `.superpowers/plans/2026-08-23-seo-character-images-page.md` (slug `public/image-generation/`, sitemap entry, footer/welcome links). Built and reviewed independently of the code change; claims restricted to facts in §2 (200 credits, cloud-powered availability, save/share).

## 12. References

- `docs/superpowers/specs/2026-07-28-image-pipeline-refactor-design.md` §18 · `docs/superpowers/specs/2026-08-10-vision-chat-uploads-design.md` §11
- Tool template: `cloud-agent/src/tools/browserAction.ts:96-186` · wiring: `cloud-agent/src/services/agentCore.ts:31-53`
- Event/frame layer: `cloud-agent/src/services/agentEventLoop.ts` · `cloud-agent/src/handlers/wsAgentHandler.ts`
- Generation guards source: `functions/src/generateImage.ts`
- Client persist chain: `src/hooks/useImageGeneration.ts` → `src/services/characterImageService.ts` · chat-artifact shape: `src/hooks/useAIChat.ts` sendPhoto · render: `src/components/ChatImageBubble.tsx`

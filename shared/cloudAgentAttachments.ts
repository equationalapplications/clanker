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

/**
 * Hard ceiling on one agent-run payload, applied to both transports.
 *
 * The HTTP route gets this via `express.json({ limit })`. The WebSocket route
 * needs it explicitly: `ws` defaults `maxPayload` to 100 MiB, so without it
 * `/agent/stream` would buffer and JSON-parse two orders of magnitude more than
 * `/agent/run` accepts for the identical payload. Both read this constant so the
 * two transports cannot drift.
 */
export const MAX_AGENT_RUN_BODY_BYTES = 2 * 1024 * 1024

export function isAttachmentMimeType(value: string): value is AttachmentMimeType {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value)
}

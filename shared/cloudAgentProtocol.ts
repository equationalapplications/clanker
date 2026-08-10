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
  // Upload paths produce raw standard base64 (see `expo-file-system` /
  // `expo-image-manipulator` returns in §6.1). `z.base64()` rejects whitespace,
  // URL-safe alphabets, and other encodings the model would not round-trip.
  data: z.base64().min(1).max(MAX_ATTACHMENT_BASE64_CHARS),
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
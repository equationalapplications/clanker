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

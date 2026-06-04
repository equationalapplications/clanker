import { appCheckReady, generateReplyFn } from '~/config/firebaseConfig'
import type { SyncMessage } from '~/services/syncMessage'

interface GenerateChatReplyInput {
  prompt?: string
  contents?: unknown[]
  systemInstruction?: string
  referenceId?: string
  unsyncedHistory?: SyncMessage[]
  characterId?: string  // forwarded to Firebase for bulk insert
}

const MAX_STRUCTURED_PAYLOAD_SIZE = 12_000

function getUtf8ByteLength(text: string): number {
  return new Blob([text]).size
}

function validateStructuredPayloadSize(contents: unknown[], systemInstruction: string): string {
  let serialized: string
  try {
    serialized = JSON.stringify({ contents, systemInstruction })
  } catch {
    throw new Error('Structured contents must be JSON-serializable.')
  }

  const payloadSize = getUtf8ByteLength(serialized)
  if (payloadSize > MAX_STRUCTURED_PAYLOAD_SIZE) {
    throw new Error(
      `Structured contents and systemInstruction must serialize to at most ${MAX_STRUCTURED_PAYLOAD_SIZE} bytes.`,
    )
  }
  return serialized
}

interface GenerateReplyCallableResponse {
  reply: string
  remainingCredits?: number | null
  planTier?: string | null
  planStatus?: 'active' | 'cancelled' | 'expired' | null
  verifiedAt?: string
}

export interface GenerateChatReplyResult {
  reply: string
  remainingCredits: number | null
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
}

export async function generateChatReply({
  prompt,
  contents,
  systemInstruction,
  referenceId,
  unsyncedHistory,
  characterId,
}: GenerateChatReplyInput): Promise<GenerateChatReplyResult> {
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    return {
      reply: '[MOCKED FALLBACK] Edge agent did not escalate. Local simulated response.',
      remainingCredits: null,
      planTier: null,
      planStatus: null,
      verifiedAt: new Date().toISOString(),
    }
  }
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : ''

  if (!trimmedPrompt && contents === undefined) {
    throw new Error('Prompt or structured contents are required')
  }

  if (contents !== undefined) {
    if (!Array.isArray(contents) || contents.length === 0) {
      throw new Error('contents must be a non-empty array when provided')
    }

    if (typeof systemInstruction !== 'string' || !systemInstruction.trim()) {
      throw new Error('systemInstruction must be a non-empty string when contents are provided')
    }

    // Client-side size guard: match backend MAX_STRUCTURED_PAYLOAD_SIZE (12 KB)
    validateStructuredPayloadSize(contents, systemInstruction.trim())
  }

  await appCheckReady

  const payload: Record<string, unknown> = {
    referenceId,
    unsyncedHistory,
    characterId,
  }

  if (trimmedPrompt) {
    payload.prompt = trimmedPrompt
  }

  if (contents !== undefined) {
    payload.contents = contents
  }

  if (typeof systemInstruction === 'string') {
    payload.systemInstruction = systemInstruction.trim()
  }

  const result = await generateReplyFn(payload)

  const data = result.data as GenerateReplyCallableResponse
  if (!data?.reply || typeof data.reply !== 'string') {
    throw new Error('Invalid generateReply response payload')
  }
  const verifiedAt = typeof data.verifiedAt === 'string' ? data.verifiedAt.trim() : ''
  if (!verifiedAt) {
    throw new Error('Invalid generateReply response payload: missing verifiedAt')
  }

  return {
    reply: data.reply.trim(),
    remainingCredits:
      typeof data.remainingCredits === 'number' && Number.isFinite(data.remainingCredits)
        ? data.remainingCredits
        : null,
    planTier: typeof data.planTier === 'string' ? data.planTier : null,
    planStatus:
      data.planStatus === 'active' || data.planStatus === 'cancelled' || data.planStatus === 'expired'
        ? data.planStatus
        : null,
    verifiedAt,
  }
}

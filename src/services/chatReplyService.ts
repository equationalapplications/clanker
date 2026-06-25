import type { GroundingMetadata } from '@google/genai'
import { appCheckReady, generateReplyFn } from '~/config/firebaseConfig'
import { parseGroundingMetadata } from '~/services/groundingMetadata'
import type { SyncMessage } from '~/services/syncMessage'

interface GenerateChatReplyInput {
  prompt?: string
  contents?: unknown[]
  systemInstruction?: string
  referenceId?: string
  unsyncedHistory?: SyncMessage[]
  characterId?: string  // forwarded to Firebase for bulk insert
  tools?: { name: string; description: string; parameters: object }[]
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
  groundingMetadata?: unknown
  functionCalls?: { name: string; args?: Record<string, unknown> }[]
}

export interface GenerateChatReplyResult {
  reply: string
  remainingCredits: number | null
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
  groundingMetadata?: GroundingMetadata
  functionCalls?: { name: string; args?: Record<string, unknown> }[]
}

export async function generateChatReply({
  prompt,
  contents,
  systemInstruction,
  referenceId,
  unsyncedHistory,
  characterId,
  tools,
}: GenerateChatReplyInput): Promise<GenerateChatReplyResult> {
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

  // Omit undefined optional fields: Firebase web SDK encode() turns undefined into
  // null, and generateReply rejects null for array-typed optional fields.
  const payload: Record<string, unknown> = {}

  if (referenceId !== undefined) {
    payload.referenceId = referenceId
  }
  if (unsyncedHistory !== undefined) {
    payload.unsyncedHistory = unsyncedHistory
  }
  if (characterId !== undefined) {
    payload.characterId = characterId
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

  if (tools !== undefined) {
    payload.tools = tools
  }

  const result = await generateReplyFn(payload)

  const data = result.data as GenerateReplyCallableResponse
  const functionCalls = Array.isArray(data?.functionCalls) && data.functionCalls.length > 0
    ? data.functionCalls
    : undefined

  if (!functionCalls && (!data?.reply || typeof data.reply !== 'string')) {
    throw new Error('Invalid generateReply response payload')
  }
  const verifiedAt = typeof data.verifiedAt === 'string' ? data.verifiedAt.trim() : ''
  if (!verifiedAt) {
    throw new Error('Invalid generateReply response payload: missing verifiedAt')
  }

  const parsedGroundingMetadata = parseGroundingMetadata(data.groundingMetadata)

  return {
    reply: typeof data.reply === 'string' ? data.reply.trim() : '',
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
    groundingMetadata: parsedGroundingMetadata,
    functionCalls,
  }
}

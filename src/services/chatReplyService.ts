import { appCheckReady, generateReplyFn } from '~/config/firebaseConfig'

interface GenerateChatReplyInput {
  prompt: string
  referenceId?: string
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
  referenceId,
}: GenerateChatReplyInput): Promise<GenerateChatReplyResult> {
  const trimmedPrompt = prompt.trim()
  if (!trimmedPrompt) {
    throw new Error('Prompt must be non-empty')
  }

  await appCheckReady

  const result = await generateReplyFn({
    prompt: trimmedPrompt,
    referenceId,
  })

  const data = result.data as GenerateReplyCallableResponse
  if (!data?.reply || typeof data.reply !== 'string') {
    throw new Error('Invalid generateReply response payload')
  }
  if (!data.verifiedAt || typeof data.verifiedAt !== 'string') {
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
    verifiedAt: data.verifiedAt,
  }
}

import { appCheckReady, generateVoiceReplyFn } from '~/config/firebaseConfig'

interface GenerateVoiceReplyInput {
  prompt: string
  characterVoice: string
  characterTraits?: string
  characterEmotions?: string
  referenceId?: string
}

interface GenerateVoiceReplyCallableResponse {
  replyText: string
  rawReplyText?: string
  audioBase64: string
  audioMimeType?: string
  remainingCredits?: number | null
  planTier?: string | null
  planStatus?: 'active' | 'cancelled' | 'expired' | null
  verifiedAt?: string
}

export interface GenerateVoiceReplyResult {
  replyText: string
  rawReplyText: string
  audioBase64: string
  audioMimeType: string
  remainingCredits: number | null
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
}

export async function generateVoiceReply({
  prompt,
  characterVoice,
  characterTraits,
  characterEmotions,
  referenceId,
}: GenerateVoiceReplyInput): Promise<GenerateVoiceReplyResult> {
  const trimmedPrompt = prompt.trim()
  const trimmedVoice = characterVoice.trim()

  if (!trimmedPrompt) {
    throw new Error('Prompt must be non-empty')
  }
  if (!trimmedVoice) {
    throw new Error('characterVoice must be non-empty')
  }

  await appCheckReady

  const result = await generateVoiceReplyFn({
    prompt: trimmedPrompt,
    characterVoice: trimmedVoice,
    characterTraits,
    characterEmotions,
    referenceId,
  })

  const responseData = result.data

  if (!responseData || typeof responseData !== 'object') {
    throw new Error('Invalid generateVoiceReply response payload')
  }

  const data = responseData as GenerateVoiceReplyCallableResponse
  const trimmedReplyText = typeof data.replyText === 'string' ? data.replyText.trim() : ''
  const trimmedAudioBase64 = typeof data.audioBase64 === 'string' ? data.audioBase64.trim() : ''
  const verifiedAt = typeof data.verifiedAt === 'string' ? data.verifiedAt.trim() : ''

  if (!trimmedReplyText || !trimmedAudioBase64 || !verifiedAt) {
    throw new Error('Invalid generateVoiceReply response payload')
  }

  return {
    replyText: trimmedReplyText,
    rawReplyText:
      typeof data.rawReplyText === 'string' && data.rawReplyText.trim().length > 0
        ? data.rawReplyText.trim()
        : trimmedReplyText,
    audioBase64: trimmedAudioBase64,
    audioMimeType:
      typeof data.audioMimeType === 'string' && data.audioMimeType.trim().length > 0
        ? data.audioMimeType.trim()
        : 'audio/wav',
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

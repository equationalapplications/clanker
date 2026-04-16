import { appCheckReady, generateReplyFn } from '~/config/firebaseConfig'

interface GenerateChatReplyInput {
  prompt: string
  referenceId?: string
}

interface GenerateReplyCallableResponse {
  reply: string
}

export async function generateChatReply({
  prompt,
  referenceId,
}: GenerateChatReplyInput): Promise<string> {
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

  return data.reply.trim()
}

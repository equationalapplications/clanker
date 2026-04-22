import { appCheckReady, summarizeTextFn } from '~/config/firebaseConfig'

interface SummarizeTextInput {
  text: string
  maxCharacters: number
}

interface SummarizeTextResponse {
  summary: string
}

export async function summarizeText({
  text,
  maxCharacters,
}: SummarizeTextInput): Promise<string> {
  const normalizedText = text.trim()
  if (!normalizedText) {
    throw new Error('text must be a non-empty string')
  }

  if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
    throw new Error('maxCharacters must be a positive integer')
  }

  await appCheckReady
  const result = await summarizeTextFn({ text: normalizedText, maxCharacters })
  const payload = result.data as SummarizeTextResponse

  if (!payload?.summary || typeof payload.summary !== 'string') {
    throw new Error('Invalid summarizeText response payload')
  }

  return payload.summary.trim()
}

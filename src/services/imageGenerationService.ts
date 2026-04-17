import { appCheckReady, generateImageFn } from '~/config/firebaseConfig'

export interface GenerateImageViaCallableResponse {
  imageBase64: string
  mimeType: string
  creditsSpent: number
  remainingCredits: number | null
  planTier: string | null
}

function normalizeBase64(value: string): string {
  const trimmed = value.trim()
  const match = /^data:[^;]+;base64,(.*)$/i.exec(trimmed)
  return (match?.[1] ?? trimmed).trim()
}

function parseResponse(payload: unknown): GenerateImageViaCallableResponse {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid image generation response payload')
  }

  const record = payload as Partial<GenerateImageViaCallableResponse>
  const imageBase64 =
    typeof record.imageBase64 === 'string' ? normalizeBase64(record.imageBase64) : ''
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType : ''
  const creditsSpent =
    typeof record.creditsSpent === 'number' && Number.isFinite(record.creditsSpent)
      ? record.creditsSpent
      : NaN

  if (!imageBase64) {
    throw new Error('Image generation returned empty image data')
  }

  if (!mimeType) {
    throw new Error('Image generation returned empty mimeType')
  }

  if (!Number.isFinite(creditsSpent) || creditsSpent < 0) {
    throw new Error('Image generation returned invalid creditsSpent value')
  }

  const remainingCredits =
    typeof record.remainingCredits === 'number' && Number.isFinite(record.remainingCredits)
      ? record.remainingCredits
      : null

  const planTier = typeof record.planTier === 'string' ? record.planTier : null

  return {
    imageBase64,
    mimeType,
    creditsSpent,
    remainingCredits,
    planTier,
  }
}

export async function generateImageViaCallable(
  prompt: string,
): Promise<GenerateImageViaCallableResponse> {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) {
    throw new Error('prompt must be a non-empty string')
  }

  await appCheckReady
  const result = await generateImageFn({ prompt: normalizedPrompt })

  const wrapped = result as { data?: unknown }
  const payload = wrapped.data ?? (result as unknown)

  return parseResponse(payload)
}

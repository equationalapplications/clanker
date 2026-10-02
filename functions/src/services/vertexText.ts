import { HttpsError } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import { GoogleGenAI } from '@google/genai'
import type { Candidate, Content, GenerateContentConfig } from '@google/genai'

import { resolveProjectId } from './projectId.js'

// Gemini 3 family is global-only on Vertex AI.
const GEMINI_LOCATION = 'global'

let genAIClient: GoogleGenAI | undefined

/** Test seam — inject a fake client. */
export function __setGenAIClientForTests(client: GoogleGenAI | undefined): void {
  genAIClient = client
}

export function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient
  }
  const project = resolveProjectId()
  if (!project) {
    throw new HttpsError(
      'failed-precondition',
      'Missing project env (GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT) for Vertex AI.',
    )
  }
  genAIClient = new GoogleGenAI({ vertexai: true, project, location: GEMINI_LOCATION })
  return genAIClient
}

// RECITATION is deliberately absent: unlike these verdicts it is a property of
// the sampled tokens rather than of the prompt, so a second draw often clears it.
export const NON_RETRYABLE_EMPTY_RESPONSE_FINISH_REASONS = new Set([
  'MAX_TOKENS',
  'SAFETY',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'MALFORMED_FUNCTION_CALL',
])

export function isRetryableEmptyResponseFinishReason(finishReason: string | undefined): boolean {
  if (!finishReason || finishReason === 'FINISH_REASON_UNSPECIFIED' || finishReason === 'OTHER') {
    return true
  }
  return !NON_RETRYABLE_EMPTY_RESPONSE_FINISH_REASONS.has(finishReason)
}

function firstNonEmptyText(candidates: Candidate[]): { text: string; candidate: Candidate } | null {
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? []
    const text = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim()
    if (text) return { text, candidate }
  }
  return null
}

export async function generateTextWithRetry(params: {
  model: string
  contents: Content[] | string
  config: GenerateContentConfig
  logContext: string
}): Promise<{ text: string; candidate: Candidate }> {
  const ai = getGenAIClient()

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await ai.models.generateContent({
      model: params.model,
      contents: params.contents,
      config: params.config,
    })

    const candidates = result.candidates ?? []
    const hit = firstNonEmptyText(candidates)
    if (hit) return hit

    const finishReasons = candidates.map((c) => c.finishReason ?? null)
    const shouldRetry =
      attempt === 0 &&
      (candidates.length === 0 ||
        candidates.some((c) => isRetryableEmptyResponseFinishReason(c.finishReason)))

    if (shouldRetry) {
      logger.warn(`${params.logContext} empty model response, retrying once`, {
        finishReasons,
        candidateCount: candidates.length,
        promptFeedback: result.promptFeedback ?? null,
      })
      continue
    }

    logger.error(
      attempt === 0
        ? `${params.logContext} model returned empty response with non-retryable finish reason`
        : `${params.logContext} model returned empty response after retry`,
      {
        finishReasons,
        candidateCount: candidates.length,
        promptFeedback: result.promptFeedback ?? null,
      },
    )
    break
  }

  throw new HttpsError('internal', 'Model returned an empty response.')
}

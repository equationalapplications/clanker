import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { generateTextWithRetry } from './services/vertexText.js'
import { userRepository } from './services/userRepository.js'
import { creditService } from './services/creditService.js'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'

const DEFAULT_MODEL = 'gemini-3.5-flash'
const DEFAULT_REGION = 'us-central1'
const MAX_INPUT_LENGTH = 16_000
const MAX_OUTPUT_TOKENS = 1_024
const SUMMARIZE_THINKING_BUDGET = 0 // interactive-ish compression; retry (vertexText) covers empties
const SUMMARIZE_TEXT_COST = 100

interface SummarizeTextData {
  text: string
  maxCharacters: number
}

export interface SummarizeTextResponse {
  summary: string
}

type GenerateSummaryFn = (prompt: string) => Promise<string>

interface SummarizeTextOptions {
  generateSummary?: GenerateSummaryFn
  userRepository?: Pick<typeof userRepository, 'getOrCreateUserByFirebaseIdentity'>
  creditService?: Pick<typeof creditService, 'spendCredits' | 'refundCredit'>
}

function truncateSummary(text: string, maxLength: number): string {
  return text.trim().slice(0, maxLength)
}

function buildPrompt(text: string, maxCharacters: number): string {
  return `Summarize the following chat memory text into at most ${maxCharacters} characters.
Focus on stable facts, user preferences, open threads, and actionable memory.
Prioritize recency when details conflict, keep the output concise, and do not add new facts.

Text:
${text}`
}

function parseInput(data: unknown): { text: string; maxCharacters: number } {
  const payload = data as SummarizeTextData | undefined
  const rawText = typeof payload?.text === 'string' ? payload.text.trim() : ''
  const rawMaxCharacters = payload?.maxCharacters

  if (!rawText) {
    throw new HttpsError('invalid-argument', 'text must be a non-empty string.')
  }

  if (rawText.length > MAX_INPUT_LENGTH) {
    throw new HttpsError('invalid-argument', `text must be at most ${MAX_INPUT_LENGTH} characters.`)
  }

  if (
    typeof rawMaxCharacters !== 'number' ||
    !Number.isInteger(rawMaxCharacters) ||
    rawMaxCharacters < 1
  ) {
    throw new HttpsError('invalid-argument', 'maxCharacters must be a positive integer.')
  }

  const maxCharacters = rawMaxCharacters

  return {
    text: rawText,
    maxCharacters,
  }
}

let summaryGenerator: GenerateSummaryFn | undefined

function getSummaryGenerator(): GenerateSummaryFn {
  if (summaryGenerator) {
    return summaryGenerator
  }

  summaryGenerator = async (prompt: string): Promise<string> => {
    const { text } = await generateTextWithRetry({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: SUMMARIZE_THINKING_BUDGET },
      },
      logContext: 'summarizeText',
    })
    return text
  }

  return summaryGenerator
}

/** Test seam — exercises the real generator against the injected client. */
export function getSummaryGeneratorForTests(): GenerateSummaryFn {
  summaryGenerator = undefined
  return getSummaryGenerator()
}

const handler = async (
  request: CallableRequest,
  options: SummarizeTextOptions = {},
): Promise<SummarizeTextResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  const decoded: DecodedIdToken = request.auth.token as DecodedIdToken
  if (!decoded || decoded.uid !== request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Invalid Firebase authentication token.')
  }

  const { text, maxCharacters } = parseInput(request.data)
  const users = options.userRepository ?? userRepository
  const credits = options.creditService ?? creditService

  const email = typeof decoded.email === 'string' ? decoded.email.trim() : ''
  if (!email) {
    throw new HttpsError('failed-precondition', 'Firebase user email is required.')
  }

  const user = await users.getOrCreateUserByFirebaseIdentity({
    firebaseUid: request.auth.uid,
    email,
    displayName: decoded.name,
  })

  const spendAllocations = await credits.spendCredits(user.id, SUMMARIZE_TEXT_COST, 'summarize')
  if (!spendAllocations) {
    throw new HttpsError('failed-precondition', 'Insufficient credits to summarize text.')
  }

  let summary: string
  try {
    const generateSummary = options.generateSummary ?? getSummaryGenerator()
    summary = await generateSummary(buildPrompt(text, maxCharacters))
  } catch (error) {
    logger.error('summarizeText model call failed', { error })
    try {
      await credits.refundCredit(user.id, spendAllocations)
    } catch (refundError) {
      logger.error('Failed to refund credits after summarizeText failure', {
        userId: user.id,
        error: refundError,
      })
    }
    if (error instanceof HttpsError) {
      throw error
    }
    throw new HttpsError('internal', 'Failed to summarize text.')
  }

  const normalizedSummary = truncateSummary(summary, maxCharacters)
  if (!normalizedSummary) {
    try {
      await credits.refundCredit(user.id, spendAllocations)
    } catch (refundError) {
      logger.error('Failed to refund credits after empty summarizeText result', {
        userId: user.id,
        error: refundError,
      })
    }
    throw new HttpsError('internal', 'Model returned an empty summary.')
  }

  return { summary: normalizedSummary }
}

export const summarizeTextHandler = handler

export const summarizeText = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: 'public',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => handler(request),
)

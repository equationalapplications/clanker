import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https'
import * as logger from 'firebase-functions/logger'
import { applicationDefault } from 'firebase-admin/app'
import type { Credential } from 'firebase-admin/app'
import type { DecodedIdToken } from 'firebase-admin/auth'
import { userRepository } from './services/userRepository.js'
import { creditService } from './services/creditService.js'
import { CLOUD_SQL_SECRETS } from './cloudSqlSecrets.js'
import { resolveProjectId } from './services/projectId.js'

const DEFAULT_REGION = 'us-central1'
const MODEL_ID = 'text-embedding-004'
const MAX_TEXT_LENGTH = 8_000
const EMBEDDING_CHARS_PER_CREDIT = 50_000

const EMBEDDING_COST_PER_WINDOW = 100

export function computeEmbeddingCreditCost(textLength: number): number {
  return Math.ceil(textLength / EMBEDDING_CHARS_PER_CREDIT) * EMBEDDING_COST_PER_WINDOW
}
// Keep in sync with GenerateEmbeddingTaskType in src/services/apiClient.ts
export type GenerateEmbeddingTaskType =
  'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY'

const ALLOWED_TASK_TYPES = new Set<GenerateEmbeddingTaskType>([
  'RETRIEVAL_DOCUMENT',
  'RETRIEVAL_QUERY',
  'SEMANTIC_SIMILARITY',
])

// Per-user request throttle, mirrors the pattern in generateImage.ts.
// Note: instance-level memory only; does not enforce limits across Cloud Run instances.
const THROTTLE_WINDOW_MS = 60_000
const THROTTLE_MAX_REQUESTS = 20
const THROTTLE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const throttleBuckets = new Map<string, number[]>()

function startThrottleCleanupTimer(): void {
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [firebaseUid, timestamps] of throttleBuckets.entries()) {
      const recent = timestamps.filter((timestamp) => now - timestamp < THROTTLE_WINDOW_MS)
      if (recent.length === 0) {
        throttleBuckets.delete(firebaseUid)
      } else if (recent.length !== timestamps.length) {
        throttleBuckets.set(firebaseUid, recent)
      }
    }
  }, THROTTLE_CLEANUP_INTERVAL_MS)
  timer.unref()
}

startThrottleCleanupTimer()

function assertWithinRateLimit(firebaseUid: string): void {
  const now = Date.now()
  const timestamps = throttleBuckets.get(firebaseUid) ?? []
  const recent = timestamps.filter((timestamp) => now - timestamp < THROTTLE_WINDOW_MS)

  if (recent.length >= THROTTLE_MAX_REQUESTS) {
    throw new HttpsError(
      'resource-exhausted',
      'Too many embedding requests. Please wait and retry.',
    )
  }

  recent.push(now)
  throttleBuckets.set(firebaseUid, recent)
}

let _appCredential: Credential | null = null

export interface GenerateEmbeddingRequest {
  text: string
  taskType?: GenerateEmbeddingTaskType
}

export interface GenerateEmbeddingResponse {
  embedding: number[]
}

export interface EmbeddingOptions {
  embedder?: (text: string, taskType: string) => Promise<number[]>
  userRepository?: Pick<typeof userRepository, 'getOrCreateUserByFirebaseIdentity'>
  creditService?: Pick<typeof creditService, 'spendCredits' | 'refundCredit'>
}

async function defaultEmbedder(text: string, taskType: string): Promise<number[]> {
  const project = resolveProjectId()
  if (!project) {
    throw new HttpsError(
      'failed-precondition',
      'Missing project env (GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT) for Vertex AI.',
    )
  }

  if (!_appCredential) {
    _appCredential = applicationDefault()
  }
  const token = await _appCredential.getAccessToken()

  const endpoint = `https://${DEFAULT_REGION}-aiplatform.googleapis.com/v1/projects/${project}/locations/${DEFAULT_REGION}/publishers/google/models/${MODEL_ID}:predict`

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      instances: [{ content: text, task_type: taskType }],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    logger.error('Vertex AI embedding error', { status: response.status, body: errorText })
    throw new HttpsError('internal', 'Failed to generate embedding.')
  }

  const data = (await response.json()) as { predictions?: [{ embeddings?: { values?: number[] } }] }
  const values = data?.predictions?.[0]?.embeddings?.values
  if (!Array.isArray(values)) {
    logger.error('Vertex AI returned unexpected shape', {
      keys: Object.keys(data ?? {}),
      predictionCount: Array.isArray(data?.predictions) ? data.predictions.length : undefined,
      firstPredictionHasEmbeddings: Boolean(data?.predictions?.[0]?.embeddings),
      firstPredictionKeys: data?.predictions?.[0]
        ? Object.keys(data.predictions[0] as Record<string, unknown>)
        : undefined,
    })
    throw new HttpsError('internal', 'Failed to generate embedding.')
  }
  return values
}

export const generateEmbeddingHandler = async (
  request: CallableRequest,
  options: EmbeddingOptions = {},
): Promise<GenerateEmbeddingResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.')
  }

  assertWithinRateLimit(request.auth.uid)

  const data = request.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'Request data must be an object.')
  }

  const typedData = data as Record<string, unknown>
  const text = typedData.text
  const rawTaskType = typedData.taskType

  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'text must be a non-empty string.')
  }
  if (text.trim().length > MAX_TEXT_LENGTH) {
    throw new HttpsError('invalid-argument', `text must be at most ${MAX_TEXT_LENGTH} characters.`)
  }

  let taskType: GenerateEmbeddingTaskType = 'RETRIEVAL_DOCUMENT'
  if (rawTaskType !== undefined && rawTaskType !== null) {
    if (typeof rawTaskType !== 'string') {
      throw new HttpsError('invalid-argument', 'taskType must be a string.')
    }
    if (!ALLOWED_TASK_TYPES.has(rawTaskType as GenerateEmbeddingTaskType)) {
      throw new HttpsError(
        'invalid-argument',
        `taskType must be one of: ${[...ALLOWED_TASK_TYPES].join(', ')}.`,
      )
    }
    taskType = rawTaskType as GenerateEmbeddingTaskType
  }

  const trimmedText = text.trim()
  const users = options.userRepository ?? userRepository
  const credits = options.creditService ?? creditService
  const decoded = request.auth.token as DecodedIdToken

  const email = typeof decoded.email === 'string' ? decoded.email.trim() : ''
  if (!email) {
    throw new HttpsError('failed-precondition', 'Firebase user email is required.')
  }

  const user = await users.getOrCreateUserByFirebaseIdentity({
    firebaseUid: request.auth.uid,
    email,
    displayName: decoded.name,
  })

  const cost = computeEmbeddingCreditCost(trimmedText.length)
  const spendAllocations = await credits.spendCredits(user.id, cost, 'embedding')
  if (!spendAllocations) {
    throw new HttpsError('failed-precondition', 'Insufficient credits to generate embedding.')
  }

  const embedder = options.embedder ?? defaultEmbedder
  let embedding: number[]
  try {
    embedding = await embedder(trimmedText, taskType)
  } catch (error) {
    logger.error('generateEmbedding: embedder failed', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    try {
      await credits.refundCredit(user.id, spendAllocations)
    } catch (refundError) {
      logger.error('Failed to refund credits after generateEmbedding failure', {
        userId: user.id,
        error: refundError,
      })
    }
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', 'Failed to generate embedding.')
  }

  return { embedding }
}

export const generateEmbedding = onCall(
  {
    region: DEFAULT_REGION,
    enforceAppCheck: true,
    invoker: 'public',
    memory: '256MiB',
    secrets: [...CLOUD_SQL_SECRETS],
  },
  (request) => generateEmbeddingHandler(request),
)

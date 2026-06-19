import { GoogleGenAI } from '@google/genai'
import type { GroundingMetadata } from '@google/genai'
import { appCheckReady, generateReplyFn } from '~/config/firebaseConfig'
import type { SyncMessage } from '~/services/syncMessage'
import { getSchemasForEdge } from '../../shared/agent-tools-spec'

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
  groundingMetadata?: unknown
}

export interface GenerateChatReplyResult {
  reply: string
  remainingCredits: number | null
  planTier: string | null
  planStatus: 'active' | 'cancelled' | 'expired' | null
  verifiedAt: string
  groundingMetadata?: GroundingMetadata
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function parseGroundingMetadata(raw: unknown): GroundingMetadata | undefined {
  if (!isPlainObject(raw)) {
    return undefined
  }

  const metadata: GroundingMetadata = {}

  if (Array.isArray(raw.webSearchQueries) && raw.webSearchQueries.every((q) => typeof q === 'string')) {
    metadata.webSearchQueries = raw.webSearchQueries as string[]
  }

  if (Array.isArray(raw.groundingChunks)) {
    const chunks = raw.groundingChunks.filter(isPlainObject)
    if (chunks.length > 0) {
      metadata.groundingChunks = chunks as GroundingMetadata['groundingChunks']
    }
  }

  if (Array.isArray(raw.groundingSupports)) {
    const supports = raw.groundingSupports.filter(
      (support): support is NonNullable<GroundingMetadata['groundingSupports']>[number] =>
        isPlainObject(support),
    )
    if (supports.length > 0) {
      metadata.groundingSupports = supports
    }
  }

  if (
    isPlainObject(raw.searchEntryPoint) &&
    typeof raw.searchEntryPoint.renderedContent === 'string'
  ) {
    metadata.searchEntryPoint = raw.searchEntryPoint as GroundingMetadata['searchEntryPoint']
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export async function generateChatReply({
  prompt,
  contents,
  systemInstruction,
  referenceId,
  unsyncedHistory,
  characterId,
}: GenerateChatReplyInput): Promise<GenerateChatReplyResult> {
  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : ''

  // ==========================================
  // 🛠️ THE LOCAL DEV SANDBOX (EDGE AGENT MOCK)
  // ==========================================
  const isDevBuild = typeof __DEV__ !== 'undefined' ? __DEV__ : process.env.NODE_ENV !== 'production'
  if (isDevBuild && process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    console.log('🛠️ Mock Env: Initializing Local Edge Agent...')

    const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY?.trim()
    if (!apiKey) {
      throw new Error('EXPO_PUBLIC_GEMINI_API_KEY is not configured')
    }

    if (contents !== undefined) {
      if (!Array.isArray(contents) || contents.length === 0) {
        throw new Error('contents must be a non-empty array when provided')
      }
      if (typeof systemInstruction !== 'string' || !systemInstruction.trim()) {
        throw new Error('systemInstruction must be a non-empty string when contents are provided')
      }
      validateStructuredPayloadSize(contents, systemInstruction.trim())
    }

    const messageFromContents =
      Array.isArray(contents)
        ? (contents
            .slice()
            .reverse()
            .find((c: any) => c?.role === 'user') as any)
            ?.parts?.find((p: any) => typeof p?.text === 'string')?.text ?? ''
        : ''
    const message = trimmedPrompt || messageFromContents
    if (!message.trim()) {
      throw new Error('Prompt or structured contents are required')
    }

    // 1. Initialize Gemini using the local API key
    const ai = new GoogleGenAI({ apiKey })

    // 2. Ask Gemini to evaluate the prompt and decide whether to escalate
    const geminiContents =
      Array.isArray(contents) ? (contents as any) : [{ role: 'user', parts: [{ text: message }] }]

    // Build edge-visible tool declarations so Gemini can call escalate_to_cloud_agent
    const hasWiki = !!characterId
    const edgeDeclarations = getSchemasForEdge(hasWiki, true).map(
      ({ name, description, parameters }) => ({ name, description, parameters }),
    ) as any[]


    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: geminiContents,
      config: {
        systemInstruction: systemInstruction || 'You are an AI assistant.',
        tools: [{ functionDeclarations: edgeDeclarations }],
      },
    })

    // 3. If Gemini made any function call, escalate to the cloud agent.
    //    The mock doesn't run local tool executors, so any function call
    //    (set_reminder, escalate_to_cloud_agent, etc.) means escalation is needed.
    const functionCalls = response.functionCalls ?? []
    const escalated = functionCalls.length > 0
    if (escalated) {
      console.log("🚀 Edge Agent Escalated! Routing to Docker Cloud Agent...")

      // Resolve the character ID for escalation. In the dev sandbox,
      // cloud_id may be undefined (local SQLite character hasn't been
      // synced). Fall back to the seeded cloud character UUID from
      // cloud-agent/scripts/seedLocal.ts.
      const cloudCharacterId = characterId ?? '22222222-2222-4222-8222-222222222222'
      if (!characterId) {
        console.log(`🛠️ Mock Env: Using seeded cloud characterId ${cloudCharacterId}`)
      }

      const baseUrl = process.env.EXPO_PUBLIC_CLOUD_AGENT_URL?.trim()
      if (!baseUrl) throw new Error('EXPO_PUBLIC_CLOUD_AGENT_URL is not configured')
      const url = `${baseUrl.replace(/\/agent\/run\/?$/, '').replace(/\/$/, '')}/agent/run`

      const cloudRes = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer mock_token_123', // Handled by backend bypass
          'X-Timezone': Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        body: JSON.stringify({
          message,
          characterId: cloudCharacterId,
          unsyncedHistory,
          history: Array.isArray(contents) ? (contents as any) : undefined,
        }),
      })

      if (cloudRes.status === 402) {
        throw new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS')
      }
      if (!cloudRes.ok) {
        throw new Error(`Docker Cloud Agent failed with status ${cloudRes.status}`)
      }

      const cloudData = (await cloudRes.json()) as {
        reply?: unknown
        usageSnapshot?: { remainingCredits?: unknown } | null
      }

      if (typeof cloudData.reply !== 'string' || !cloudData.reply.trim()) {
        throw new Error('Invalid Cloud Agent response')
      }

      const remainingCreditsRaw = cloudData.usageSnapshot?.remainingCredits
      const remainingCredits =
        typeof remainingCreditsRaw === 'number' &&
        Number.isInteger(remainingCreditsRaw) &&
        remainingCreditsRaw >= 0
          ? remainingCreditsRaw
          : null

      return {
        reply: cloudData.reply,
        remainingCredits,
        planTier: 'free',
        planStatus: 'active',
        verifiedAt: new Date().toISOString(),
      }
    }

    // 4. Fallback Path: Edge Agent handled it locally (No credits deducted)
    console.log("⏬ Edge Agent handled the request locally (0 credits spent).")
    return {
      reply: response.text || '[Empty Edge Response]',
      remainingCredits: null,
      planTier: null,
      planStatus: null,
      verifiedAt: new Date().toISOString(),
    }
  }

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
    groundingMetadata: parseGroundingMetadata(data.groundingMetadata),
  }
}

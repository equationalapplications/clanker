import { GoogleGenAI } from '@google/genai'
import { appCheckReady, generateReplyFn } from '~/config/firebaseConfig'
import type { SyncMessage } from '~/services/syncMessage'

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
  if (process.env.EXPO_PUBLIC_USE_MOCK_AUTH === 'true') {
    console.log("🛠️ Mock Env: Initializing Local Edge Agent...")
    
    // 1. Initialize Gemini using the local API key
    const ai = new GoogleGenAI({ apiKey: process.env.EXPO_PUBLIC_GOOGLE_GENAI_API_KEY })

    // 2. Ask Gemini to evaluate the prompt and decide whether to escalate
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: trimmedPrompt,
      config: {
        systemInstruction: systemInstruction || "You are an AI assistant.",
        tools: [{
          functionDeclarations: [{
            name: 'escalateToCloud',
            description: 'Call this tool ONLY when the user requests a complex task, database access, image generation, or heavy reasoning.'
          }]
        }]
      }
    })

    // 3. Check if the LLM decided to invoke the Cloud Agent tool
    const escalated = response.functionCalls && response.functionCalls.some(call => call.name === 'escalateToCloud')

    if (escalated) {
      console.log("🚀 Edge Agent Escalated! Routing to Docker Cloud Agent...")
      
      // Make the HTTP call directly to your local Docker container
      const cloudRes = await fetch(`${process.env.EXPO_PUBLIC_CLOUD_AGENT_URL}/agent/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer mock_token_123' // Handled by backend bypass
        },
        body: JSON.stringify({ 
          message: trimmedPrompt, 
          systemInstruction, 
          history: unsyncedHistory,
          characterId,
          userId: 'local_test_user_123'
        })
      })

      if (cloudRes.status === 402) {
        throw new Error('CLOUD_AGENT_INSUFFICIENT_CREDITS')
      }
      if (!cloudRes.ok) {
        throw new Error(`Docker Cloud Agent failed with status ${cloudRes.status}`)
      }

      const cloudData = await cloudRes.json()
      
      // Return the Cloud Agent's reply and the DEDUCTED credits from Postgres
      return {
        reply: cloudData.reply,
        remainingCredits: cloudData.usageSnapshot?.remainingCredits ?? null,
        planTier: 'free',
        planStatus: 'active',
        verifiedAt: new Date().toISOString()
      }
    }

    // 4. Fallback Path: Edge Agent handled it locally (No credits deducted)
    console.log("⏬ Edge Agent handled the request locally (0 credits spent).")
    return {
      reply: response.text || "[Empty Edge Response]",
      // Return 100 or whatever your mock frontend state expects to show unchanged
      remainingCredits: 100, 
      planTier: 'free',
      planStatus: 'active',
      verifiedAt: new Date().toISOString()
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
  }
}

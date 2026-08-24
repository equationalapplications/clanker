import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import { GoogleGenAI } from '@google/genai'
import { IMAGE_GENERATION_COST } from '../constants/credits.js'
import { CHAT_IMAGE_MODEL_ID, CHAT_IMAGE_REGION } from '../constants/images.js'
import type { CreditService } from '../services/creditService.js'

/** One generated image riding this agent_run's turn response to the client. */
export interface GeneratedImage {
  imageBase64: string
  mimeType: string
}

export type VertexImageGenerator = (prompt: string) => Promise<GeneratedImage>

// Mirrors functions/src/generateImage.ts guard values (no portrait wrapper —
// this tool takes the raw user-intent prompt).
const MAX_PROMPT_LENGTH = 2_000
const MAX_BASE64_LENGTH = 8_000_000
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

let vertexClient: GoogleGenAI | undefined

function getVertexClient(): GoogleGenAI {
  if (!vertexClient) {
    const project = (process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? '').trim()
    if (!project) {
      throw new Error('MISSING_GCP_PROJECT')
    }
    vertexClient = new GoogleGenAI({ vertexai: true, project, location: CHAT_IMAGE_REGION })
  }
  return vertexClient
}

export const defaultVertexImageGenerator: VertexImageGenerator = async (prompt) => {
  const result = await getVertexClient().models.generateContent({
    model: CHAT_IMAGE_MODEL_ID,
    contents: prompt,
    config: { responseModalities: ['TEXT', 'IMAGE'] },
  })
  for (const candidate of result.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const data = part.inlineData?.data?.trim()
      if (data) {
        return { imageBase64: data, mimeType: part.inlineData?.mimeType ?? 'image/png' }
      }
    }
  }
  throw new Error('VERTEX_RETURNED_NO_IMAGE')
}

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(2000),
})

/**
 * House-pattern closure factory (see tools/browserAction.ts). `collector` is
 * minted by buildAgent() per agent_run; pushing onto it is how bytes reach the
 * transport handlers, because ADK forwards only tool NAMES and text tokens —
 * never tool results (spec §5).
 */
export function generateImage(
  userId: string,
  cs: Pick<CreditService, 'spendCredit' | 'refundCredit'>,
  collector: GeneratedImage[],
  vertexGenerate: VertexImageGenerator = defaultVertexImageGenerator,
): FunctionTool {
  // Run-scoped hard cap (decision #4): one successful generation per reply,
  // enforced here regardless of what the model does with the description.
  let generatedThisRun = false

  return new FunctionTool({
    name: 'generate_image',
    description:
      'Create an image and send it to the user in your reply — suited to charts, diagrams, visual plans, or a selfie of yourself. ' +
      'Call it ONLY when the user asks you to create/draw/generate an image, or explicitly says yes right after you offered to draw something. ' +
      'Offering in plain text ("want me to draw that?") is always allowed and costs nothing. ' +
      `At most ONE image per reply; each image costs the user ${IMAGE_GENERATION_COST} credits.`,
    parameters: generateImageSchema,
    execute: async (args: unknown): Promise<string> => {
      const { prompt } = args as z.infer<typeof generateImageSchema>

      if (generatedThisRun) {
        return 'I can only create one image per reply, and I already made one for this message.'
      }

      // Spend BEFORE generating; every later failure branch refunds.
      let allocations
      try {
        allocations = await cs.spendCredit(userId, IMAGE_GENERATION_COST, 'image_generate')
      } catch (err) {
        if (err instanceof Error && err.message === 'INSUFFICIENT_CREDITS') {
          return "I'd love to draw that for you, but you're out of credits right now."
        }
        throw err
      }

      // Outer-loop refunds cover only allocations consumeAgentEvents collected
      // itself (verified: services/agentEventLoop.ts) — this refund path is
      // owned here. A failed refund must still resolve with a sentence so the
      // turn degrades instead of throwing into the event loop.
      const tryRefund = async (): Promise<void> => {
        try {
          await cs.refundCredit(userId, allocations)
        } catch (refundErr) {
          console.warn('[generate_image] refundCredit failed:', {
            allocations,
            error: refundErr instanceof Error ? refundErr.message : refundErr,
          })
        }
      }

      try {
        const trimmed = prompt.trim().slice(0, MAX_PROMPT_LENGTH)
        if (!trimmed) {
          await tryRefund()
          return "I couldn't read that image request — could you describe it again?"
        }

        const { imageBase64, mimeType } = await vertexGenerate(trimmed)

        const data = imageBase64.trim()
        const normalizedMime = mimeType.trim().toLowerCase()
        if (
          !data ||
          data.length > MAX_BASE64_LENGTH ||
          !ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)
        ) {
          await tryRefund()
          return "I'm sorry — I couldn't create that image just now."
        }

        generatedThisRun = true
        collector.push({ imageBase64: data, mimeType: normalizedMime })
        // Never return the base64 here — tool results are tokenized into the
        // model context. The bytes leave through the run-scoped collector.
        return JSON.stringify({ status: 'ok' })
      } catch (err) {
        console.warn('[generate_image] generation failed:', err)
        await tryRefund()
        return "I'm sorry — I couldn't create that image just now. Please try again in a moment."
      }
    },
  })
}

import { GoogleGenAI } from '@google/genai'

const EMBEDDING_MODEL = 'text-embedding-004'

export function isRetryable(err: unknown): boolean {
  if (err instanceof Error) return /429|503|rate.?limit|quota/i.test(err.message)
  return false
}

let genAIClient: GoogleGenAI | undefined

function getGenAIClient(): GoogleGenAI {
  if (genAIClient) return genAIClient
  const project = [
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
  ]
    .map((v) => v?.trim())
    .find((v): v is string => Boolean(v))
  if (!project) {
    throw new Error(
      'Missing project env (GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT) for Vertex AI embeddings',
    )
  }
  const location = process.env.GOOGLE_CLOUD_LOCATION?.trim() || 'global'
  genAIClient = new GoogleGenAI({
    vertexai: true,
    project,
    location,
  })
  return genAIClient
}

export async function embedText(text: string): Promise<number[]> {
  const ai = getGenAIClient()
  try {
    const result = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: text })
    const values = result.embeddings?.[0]?.values
    if (!values) throw new Error('No embedding values returned')
    return values
  } catch (err) {
    if (isRetryable(err)) {
      await new Promise(r => setTimeout(r, 1000))
      const result = await ai.models.embedContent({ model: EMBEDDING_MODEL, contents: text })
      const values = result.embeddings?.[0]?.values
      if (!values) throw new Error('No embedding values returned after retry')
      return values
    }
    throw err
  }
}
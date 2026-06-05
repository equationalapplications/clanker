import { GoogleGenAI } from '@google/genai'

const EMBEDDING_MODEL = 'text-embedding-004'

export function isRetryable(err: unknown): boolean {
  if (err instanceof Error) return /429|503|rate.?limit|quota/i.test(err.message)
  return false
}

export async function embedText(text: string): Promise<number[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })
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
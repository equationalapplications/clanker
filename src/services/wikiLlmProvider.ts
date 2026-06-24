import { isDevSandboxEnabled } from '~/auth/ensureDevSandboxCharacter'
import { wikiLlm, generateEmbedding } from './apiClient'

interface WikiLlmRequest {
  systemPrompt: string
  userPrompt: string
}

const EMBEDDING_DIMENSIONS = 768
const DEV_LIBRARIAN_JSON = '{"facts":[],"tasks":[]}'

function devEmbed(text: string): number[] {
  const vec = new Array(EMBEDDING_DIMENSIONS).fill(0)
  for (let i = 0; i < text.length; i++) {
    vec[i % EMBEDDING_DIMENSIONS] += text.charCodeAt(i) / 1000
  }

  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0)) || 1
  return vec.map((value) => value / norm)
}

export function createWikiLlmProvider() {
  if (isDevSandboxEnabled()) {
    return {
      generateText: async (_request: WikiLlmRequest): Promise<string> => DEV_LIBRARIAN_JSON,
      embed: async (text: string): Promise<number[]> => devEmbed(text),
    }
  }

  return {
    generateText: async ({ systemPrompt, userPrompt }: WikiLlmRequest): Promise<string> => {
      const result = await wikiLlm({ systemPrompt, userPrompt })
      return result.data.text
    },
    embed: async (text: string): Promise<number[]> => {
      // SEMANTIC_SIMILARITY is symmetric — correct for both document storage (embedFact)
      // and query retrieval (read). RETRIEVAL_DOCUMENT paired with itself produces
      // lower cosine similarity for queries than the intended asymmetric pair.
      const result = await generateEmbedding({ text, taskType: 'SEMANTIC_SIMILARITY' })
      return result.data.embedding
    },
  }
}

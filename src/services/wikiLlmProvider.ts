import { wikiLlm, generateEmbedding } from './apiClient'

interface WikiLlmRequest {
  systemPrompt: string
  userPrompt: string
}

export function createWikiLlmProvider() {
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

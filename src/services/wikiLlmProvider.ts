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
      const result = await generateEmbedding({ text, taskType: 'RETRIEVAL_DOCUMENT' })
      return result.data.embedding
    },
  }
}

// src/services/wikiLlmProvider.ts
import { wikiLlm } from './apiClient'

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
  }
}

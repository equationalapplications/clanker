// src/services/wikiLlmProvider.ts
import { wikiLlmFn } from '~/config/firebaseConfig'

interface WikiLlmRequest {
  systemPrompt: string
  userPrompt: string
}

interface WikiLlmResponse {
  text: string
}

export function createWikiLlmProvider(appCheck: Promise<void>) {
  return {
    generateText: async ({ systemPrompt, userPrompt }: WikiLlmRequest): Promise<string> => {
      await appCheck
      const result = await wikiLlmFn({ systemPrompt, userPrompt })
      return (result.data as WikiLlmResponse).text
    },
  }
}

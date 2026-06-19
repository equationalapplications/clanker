import { useCallback } from 'react'
import type { IMessage } from 'react-native-gifted-chat'
import type { Character } from '~/services/aiChatService'
import type { Wiki } from '~/services/wikiService'

export type EscalationState = 'idle' | 'escalating'

export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: IMessage[]
  isCloudSynced: boolean
  wiki: Wiki | null
}

export interface UseEdgeAgentReturn {
  sendMessage: (userText: string, memoryBlock?: string) => Promise<{ escalated: boolean; text?: string }>
  isThinking: boolean
  escalationState: EscalationState
}

// On-device edge-triage (direct client-side Gemini calls) was removed: it required
// shipping a Developer API key in the public JS bundle, which got abuse-flagged and
// revoked, and violated the "zero direct GenAI SDK imports" architecture policy
// (docs/ai-and-chat.md). All chat now routes through the secured backend
// (generateReply / cloud-agent) via useAIChat's existing fallback chain.
export function useEdgeAgent({ isCloudSynced }: UseEdgeAgentOptions): UseEdgeAgentReturn {
  const sendMessage = useCallback(
    async (): Promise<{ escalated: boolean; text?: string }> => {
      return isCloudSynced ? { escalated: true } : { escalated: false }
    },
    [isCloudSynced],
  )

  return { sendMessage, isThinking: false, escalationState: 'idle' }
}

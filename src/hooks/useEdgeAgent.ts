import { useCallback, useState } from 'react'

export type EscalationState = 'idle' | 'escalating'

export interface UseEdgeAgentReturn {
  sendMessage: (userText: string, memoryBlock?: string) => Promise<{ escalated: boolean; text?: string }>
  isThinking: boolean
  escalationState: EscalationState
}

// On-device edge-triage (direct client-side Gemini calls) was removed: it required
// shipping a Developer API key in the public JS bundle, which got abuse-flagged and
// revoked, and violated the "zero direct GenAI SDK imports" architecture policy
// (docs/ai-and-chat.md). All chat now routes through the secured backend
// (generateReply / cloud-agent) via useAIChat's existing fallback chain, so this
// always escalates and takes no inputs.
export function useEdgeAgent(): UseEdgeAgentReturn {
  const [escalationState, setEscalationState] = useState<EscalationState>('idle')

  const sendMessage = useCallback(
    async (): Promise<{ escalated: boolean; text?: string }> => {
      setEscalationState('escalating')
      return { escalated: true }
    },
    [],
  )

  return { sendMessage, isThinking: false, escalationState }
}

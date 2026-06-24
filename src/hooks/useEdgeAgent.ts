import { useState, useCallback, useRef, useEffect } from 'react'
import type { IMessage } from 'react-native-gifted-chat'
import { getSchemasForEdge } from '~/services/clankerManifests'
import type { Character } from '~/services/aiChatService'
import type { Wiki } from '~/services/wikiService'
import { buildSystemInstruction, buildContentHistory } from '~/services/CharacterPromptBuilder'
import { createEdgeToolExecutors } from '~/services/edgeToolExecutors'
import { generateChatReply } from '~/services/chatReplyService'

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

type ContentPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { output: unknown } } }
type ChatContent = { role: 'user' | 'model'; parts: ContentPart[] }

const MAX_ITERATIONS = 5

export function useEdgeAgent({ character, userId, priorMessages, isCloudSynced, wiki }: UseEdgeAgentOptions): UseEdgeAgentReturn {
  const [isThinking, setIsThinking] = useState(false)
  const [escalationState, setEscalationState] = useState<EscalationState>('idle')
  const priorMessagesRef = useRef(priorMessages)

  useEffect(() => {
    priorMessagesRef.current = priorMessages
  }, [priorMessages])

  const sendMessage = useCallback(
    async (userText: string, memoryBlock?: string): Promise<{ escalated: boolean; text?: string }> => {
      setIsThinking(true)
      setEscalationState('idle')

      const systemInstruction = buildSystemInstruction({ character, userId, memoryBlock })
      const historyContents = buildContentHistory(priorMessagesRef.current, userId)
      const toolExecutors = createEdgeToolExecutors(character.id, wiki)
      const tools = getSchemasForEdge(!!wiki, isCloudSynced)

      const contents: ChatContent[] = [
        ...historyContents,
        { role: 'user', parts: [{ text: userText }] },
      ]

      try {
        let iterations = 0

        while (iterations < MAX_ITERATIONS) {
          iterations++

          const result = await generateChatReply({
            contents,
            systemInstruction,
            tools,
          })

          const functionCalls = result.functionCalls

          if (!functionCalls || functionCalls.length === 0) {
            return { escalated: false, text: result.reply }
          }

          if (functionCalls.some((fc) => fc.name === 'escalate_to_cloud_agent')) {
            if (isCloudSynced) {
              setEscalationState('escalating')
              return { escalated: true }
            }
          }

          const responseParts = await Promise.all(
            functionCalls.map(async (fc) => {
              const name = fc.name ?? ''
              const executor = toolExecutors[name]
              const output = executor ? await executor(fc.args ?? {}) : null
              return { functionResponse: { name, response: { output } } }
            }),
          )

          contents.push({
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          })

          contents.push({
            role: 'user',
            parts: responseParts,
          })
        }

        if (isCloudSynced) {
          setEscalationState('escalating')
          return { escalated: true }
        }

        return { escalated: false }
      } catch {
        if (isCloudSynced) {
          setEscalationState('escalating')
          return { escalated: true }
        }
        return { escalated: false }
      } finally {
        setIsThinking(false)
      }
    },
    [character, userId, isCloudSynced, wiki],
  )

  return { sendMessage, isThinking, escalationState }
}

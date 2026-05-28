import { useState, useCallback, useRef, useEffect } from 'react'
import { GoogleGenAI } from '@google/genai'
import type { Content, ToolListUnion } from '@google/genai'
import type { IMessage } from 'react-native-gifted-chat'
import { getCurrentTimeManifest, escalateToCloudManifest } from '@equationalapplications/core-llm-tools'
import type { Character } from '~/services/aiChatService'
import { buildSystemInstruction, buildContentHistory } from '~/services/characterPromptBuilder'
import { edgeToolExecutors } from '~/services/edgeToolExecutors'

export type EscalationState = 'idle' | 'escalating'

export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: IMessage[]
}

export interface UseEdgeAgentReturn {
  sendMessage: (userText: string, memoryBlock?: string) => Promise<{ escalated: boolean; text?: string }>
  isThinking: boolean
  escalationState: EscalationState
}

const MAX_ITERATIONS = 5
const GEMINI_MODEL = 'gemini-2.5-flash'

export function useEdgeAgent({ character, userId, priorMessages }: UseEdgeAgentOptions): UseEdgeAgentReturn {
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

      const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY
      if (!apiKey) {
        setIsThinking(false)
        return { escalated: true }
      }

      const ai = new GoogleGenAI({ apiKey })
      const systemInstruction = buildSystemInstruction({ character, userId, memoryBlock })
      const historyContents = buildContentHistory(priorMessagesRef.current, userId)

      const contents: Content[] = [
        ...historyContents,
        { role: 'user', parts: [{ text: userText }] },
      ] as Content[]

      // Cast required: AgentToolSchema.parameters.properties is Record<string,unknown>
      // but FunctionDeclaration expects Record<string,Schema> — shapes are compatible at runtime
      const tools = [
        {
          functionDeclarations: [
            getCurrentTimeManifest.schema,
            escalateToCloudManifest.schema,
          ],
        },
      ] as unknown as ToolListUnion

      try {
        let iterations = 0

        while (iterations < MAX_ITERATIONS) {
          iterations++

          const result = await ai.models.generateContent({
            model: GEMINI_MODEL,
            contents: contents as Content[],
            config: { systemInstruction, tools },
          })

          const functionCalls = result.functionCalls

          if (!functionCalls || functionCalls.length === 0) {
            return { escalated: false, text: result.text ?? '' }
          }

          const shouldEscalate = functionCalls.some((fc) => fc.name === 'escalate_to_cloud')
          if (shouldEscalate) {
            setEscalationState('escalating')
            return { escalated: true }
          }

          // Append model turn
          contents.push({
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          } as Content)

          // Execute tools and append function responses
          contents.push({
            role: 'user',
            parts: functionCalls.map((fc) => {
              const name = fc.name ?? ''
              const executor = edgeToolExecutors[name]
              const output = executor ? executor(fc.args ?? {}) : null
              return { functionResponse: { name, response: { output } } }
            }),
          } as Content)
        }

        // Iteration cap — escalate
        setEscalationState('escalating')
        return { escalated: true }
      } catch {
        setEscalationState('escalating')
        return { escalated: true }
      } finally {
        setIsThinking(false)
      }
    },
    [character, userId],
  )

  return { sendMessage, isThinking, escalationState }
}

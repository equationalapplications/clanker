import { useState, useCallback, useRef, useEffect } from 'react'
import { GoogleGenAI } from '@google/genai'
import type { Content, Part, ToolListUnion } from '@google/genai'
import type { IMessage } from 'react-native-gifted-chat'
import { clankerTimeSchema, clankerEscalationSchema, clankerMemorySchema } from '~/services/clankerManifests'
import type { Character } from '~/services/aiChatService'
import type { Wiki } from '~/services/wikiService'
import { buildSystemInstruction, buildContentHistory } from '~/services/CharacterPromptBuilder'
import { createEdgeToolExecutors } from '~/services/edgeToolExecutors'

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

const MAX_ITERATIONS = 5
const GEMINI_MODEL = 'gemini-2.5-flash'
const LOCAL_ONLY_FALLBACK_TEXT = "I'm running in local-only mode and can't access your deep cloud memory right now."

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

      const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY
      if (!apiKey) {
        setIsThinking(false)
        if (isCloudSynced) {
          setEscalationState('escalating')
          return { escalated: true }
        }
        return { escalated: false, text: LOCAL_ONLY_FALLBACK_TEXT }
      }

      const ai = new GoogleGenAI({ apiKey })
      const systemInstruction = buildSystemInstruction({ character, userId, memoryBlock })
      const historyContents = buildContentHistory(priorMessagesRef.current, userId)
      const toolExecutors = createEdgeToolExecutors(character.id, wiki)

      const contents: Content[] = [
        ...historyContents,
        { role: 'user', parts: [{ text: userText }] },
      ] as Content[]

      const functionDeclarations = [clankerTimeSchema]
      if (wiki) {
        functionDeclarations.push(clankerMemorySchema)
      }
      if (isCloudSynced) {
        functionDeclarations.push(clankerEscalationSchema)
      }
      const tools = [{ functionDeclarations }] as unknown as ToolListUnion

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

          let didEscalate = false
          const responseParts = await Promise.all(
            functionCalls.map(async (fc) => {
              const name = fc.name ?? ''
              if (name === 'escalate_to_cloud_agent') {
                didEscalate = true
                return null
              }
              const executor = toolExecutors[name]
              const output = executor ? await executor(fc.args ?? {}) : null
              return { functionResponse: { name, response: { output } } }
            }),
          )

          if (didEscalate) {
            setEscalationState('escalating')
            return { escalated: true }
          }

          contents.push({
            role: 'model',
            parts: functionCalls.map((fc) => ({ functionCall: fc })),
          } as Content)

          contents.push({
            role: 'user',
            parts: responseParts.filter(Boolean) as Part[],
          } as Content)
        }

        if (isCloudSynced) {
          setEscalationState('escalating')
          return { escalated: true }
        }

        return { escalated: false, text: LOCAL_ONLY_FALLBACK_TEXT }
      } catch {
        if (isCloudSynced) {
          setEscalationState('escalating')
          return { escalated: true }
        }
        return { escalated: false, text: LOCAL_ONLY_FALLBACK_TEXT }
      } finally {
        setIsThinking(false)
      }
    },
    [character, userId, isCloudSynced, wiki],
  )

  return { sendMessage, isThinking, escalationState }
}

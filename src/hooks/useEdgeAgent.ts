import { useState, useCallback, useRef, useEffect } from 'react'
import type { Message } from '~/types/chat'
import {
  getSchemasForEdge,
  isCloudOnlyToolName,
  isLocallyExecutableCloudTool,
} from '~/services/clankerManifests'
import type { Character } from '~/services/aiChatService'
import type { Wiki } from '~/services/wikiService'
import { buildSystemInstruction, buildContentHistory } from '~/services/CharacterPromptBuilder'
import { createEdgeToolExecutors } from '~/services/edgeToolExecutors'
import { generateChatReply, type GenerateChatReplyResult } from '~/services/chatReplyService'
import type { UsageSnapshotPayload } from '~/services/usageSnapshot'
export type EscalationState = 'idle' | 'escalating'

export interface EdgeAgentSendResult {
  escalated: boolean
  text?: string
  usageSnapshot?: UsageSnapshotPayload | null
  /**
   * Row id of an image the edge agent generated locally this turn, for the
   * caller to persist as the assistant message's render hint. Only ever set for
   * characters that cannot escalate.
   */
  imageId?: string
}

export interface UseEdgeAgentOptions {
  character: Character
  userId: string
  priorMessages: Message[]
  isCloudSynced: boolean
  wiki: Wiki | null
}

export interface UseEdgeAgentReturn {
  sendMessage: (
    userText: string,
    memoryBlock?: string,
    assistantMessageId?: string,
  ) => Promise<EdgeAgentSendResult>
  isThinking: boolean
  escalationState: EscalationState
}

type ContentPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { output: unknown } } }
type ChatContent = { role: 'user' | 'model'; parts: ContentPart[] }

const MAX_ITERATIONS = 5

function toUsageSnapshot(result: GenerateChatReplyResult): UsageSnapshotPayload {
  return {
    remainingCredits: result.remainingCredits,
    planTier: result.planTier,
    planStatus: result.planStatus,
    verifiedAt: result.verifiedAt,
  }
}

export function useEdgeAgent({
  character,
  userId,
  priorMessages,
  isCloudSynced,
  wiki,
}: UseEdgeAgentOptions): UseEdgeAgentReturn {
  const [isThinking, setIsThinking] = useState(false)
  const [escalationState, setEscalationState] = useState<EscalationState>('idle')
  const priorMessagesRef = useRef(priorMessages)

  useEffect(() => {
    priorMessagesRef.current = priorMessages
  }, [priorMessages])

  const sendMessage = useCallback(
    async (
      userText: string,
      memoryBlock?: string,
      assistantMessageId?: string,
    ): Promise<EdgeAgentSendResult> => {
      setIsThinking(true)
      setEscalationState('idle')

      let latestUsageSnapshot: UsageSnapshotPayload | null = null
      // Run-scoped, like cloud-agent's imageCollector: the executor writes the
      // row and reports its id here, and the caller persists it alongside the
      // reply text in one message write.
      let localImageId: string | undefined

      const systemInstruction = buildSystemInstruction({ character, userId, memoryBlock })
      const historyContents = buildContentHistory(priorMessagesRef.current, userId)
      // Image deps only where escalation is impossible. A cloud-synced character
      // routes generate_image to cloud-agent, which owns that spend and refund.
      const canGenerateLocally = !isCloudSynced && !!assistantMessageId
      const toolExecutors = createEdgeToolExecutors(
        character.id,
        wiki,
        canGenerateLocally
          ? {
              userId,
              messageId: assistantMessageId,
              onImageSaved: (imageId: string) => {
                localImageId = imageId
              },
            }
          : undefined,
      )
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
          latestUsageSnapshot = toUsageSnapshot(result)

          const functionCalls = result.functionCalls

          if (!functionCalls || functionCalls.length === 0) {
            return {
              escalated: false,
              text: result.reply,
              usageSnapshot: latestUsageSnapshot,
              ...(localImageId ? { imageId: localImageId } : {}),
            }
          }

          // Cloud-only tools (generate_image, set_reminder) are offered to the edge
          // model as stubs it can call but never executes: calling one IS the
          // escalation. That is what makes a capability gap impossible to answer
          // with a confident refusal, and it costs one edge turn instead of the
          // MAX_ITERATIONS null-executor loop an unhandled call used to burn.
          // A cloud-only tool the edge can run itself (generate_image on a
          // local-only character) is executed below rather than escalated —
          // there is nothing to escalate to, and that is the whole point.
          const escalates = functionCalls.some(
            (fc) =>
              fc.name === 'escalate_to_cloud_agent' ||
              (isCloudOnlyToolName(fc.name ?? '') &&
                !(canGenerateLocally && isLocallyExecutableCloudTool(fc.name ?? ''))),
          )
          if (escalates) {
            if (isCloudSynced) {
              setEscalationState('escalating')
              return { escalated: true, usageSnapshot: latestUsageSnapshot }
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
          return { escalated: true, usageSnapshot: latestUsageSnapshot }
        }

        return { escalated: false, usageSnapshot: latestUsageSnapshot }
      } catch {
        if (isCloudSynced) {
          setEscalationState('escalating')
          return { escalated: true, usageSnapshot: latestUsageSnapshot }
        }
        return { escalated: false, usageSnapshot: latestUsageSnapshot }
      } finally {
        setIsThinking(false)
      }
    },
    [character, userId, isCloudSynced, wiki],
  )

  return { sendMessage, isThinking, escalationState }
}

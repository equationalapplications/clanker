import { isFinalResponse } from '@google/adk'
import type { Event as AdkEvent } from '@google/adk'
import type { GroundingMetadata } from '@google/genai'
import { hasGroundingData } from '../groundingMetadata.js'
import type { CreditService, CreditSpendAllocation } from './creditService.js'
import { AGENT_TURN_CREDIT_COST } from '../constants/credits.js'

export const MAX_LOOP_ITERATIONS = 5
export const DEGRADED_FALLBACK_REPLY =
  "I've done what I can for now — let me know if you'd like me to continue."

export class AgentInsufficientCreditsError extends Error {
  constructor() {
    super('INSUFFICIENT_CREDITS')
    this.name = 'AgentInsufficientCreditsError'
  }
}

export interface ConsumeAgentEventsResult {
  reply: string
  toolCalls: string[]
  groundingMetadata?: GroundingMetadata
  degraded?: boolean
}

export interface ConsumeAgentEventsHooks {
  onToken?: (text: string) => void
  onToolStart?: (name: string) => void
  onToolEnd?: (name: string) => void
  onGroundingMetadata?: (metadata: GroundingMetadata) => void
  shouldAbort?: () => boolean
}

function eventHasFunctionCall(event: AdkEvent): boolean {
  return event.content?.parts?.some((part) => 'functionCall' in part) ?? false
}

function extractText(event: AdkEvent): string {
  if (!event.content?.parts) return ''
  return event.content.parts
    .filter((p): p is { text: string } => 'text' in p)
    .map((p) => p.text)
    .join('')
}

/** Reject agent turns when the user has no credits before any ADK work begins. */
export async function assertAgentTurnCredits(
  userId: string,
  creditService: Pick<CreditService, 'getBalance'>,
): Promise<void> {
  let balance: number
  try {
    balance = await creditService.getBalance(userId)
  } catch {
    // Can't verify balance pre-flight — allow the turn; per-loop spend will gate if needed.
    return
  }
  if (balance < AGENT_TURN_CREDIT_COST) {
    throw new AgentInsufficientCreditsError()
  }
}

/**
 * Consumes one ADK agent run's event stream, billing 1 credit per completed
 * model turn (capped at MAX_LOOP_ITERATIONS) instead of a flat per-turn
 * charge: a plain conversational reply with no tool call is 1 loop; a tool
 * call followed by its synthesis reply is 2. Hitting the cap, or running out
 * of credits mid-loop, stops the stream early and returns a graceful fallback
 * reply rather than throwing — only a genuine ADK error refunds the credits
 * already spent this turn.
 */
export async function consumeAgentEvents(
  events: AsyncIterable<AdkEvent>,
  userId: string,
  creditService: Pick<CreditService, 'spendCredit' | 'refundCredit'>,
  hooks?: ConsumeAgentEventsHooks,
): Promise<ConsumeAgentEventsResult> {
  let reply = ''
  let lastText = ''
  let streamedAnyText = false
  const toolCalls: string[] = []
  let groundingMetadata: GroundingMetadata | undefined
  let loopCount = 0
  let degraded = false
  let lastToolName: string | null = null
  const spentAllocations: CreditSpendAllocation[] = []

  const emitToken = (text: string) => {
    if (!text) return
    streamedAnyText = true
    hooks?.onToken?.(text)
  }

  const endActiveTool = () => {
    if (lastToolName) {
      hooks?.onToolEnd?.(lastToolName)
      lastToolName = null
    }
  }

  /** Bills one loop iteration. Returns false when the turn must stop (cap hit or credits exhausted). */
  const chargeLoopIteration = async (): Promise<boolean> => {
    loopCount += 1
    try {
      const allocations = await creditService.spendCredit(
        userId,
        AGENT_TURN_CREDIT_COST,
        'chat_reply',
      )
      spentAllocations.push(...allocations)
    } catch (creditErr) {
      const msg = creditErr instanceof Error ? creditErr.message : ''
      if (msg === 'INSUFFICIENT_CREDITS') {
        degraded = true
        endActiveTool()
        return false
      }
      throw creditErr
    }

    if (loopCount === MAX_LOOP_ITERATIONS) {
      degraded = true
      endActiveTool()
      return false
    }
    return true
  }

  try {
    for await (const event of events) {
      if (hooks?.shouldAbort?.()) {
        degraded = true
        endActiveTool()
        break
      }

      if (event.errorCode || event.errorMessage) {
        throw new Error(
          `ADK error (${event.errorCode ?? 'unknown'}): ${event.errorMessage ?? 'no message'}`,
        )
      }

      const hasFunctionCall = eventHasFunctionCall(event)

      if (hasFunctionCall) {
        for (const part of event.content!.parts!) {
          if ('functionCall' in part) {
            const fc = (part as { functionCall?: { name?: string } }).functionCall
            if (fc?.name) {
              toolCalls.push(fc.name)
              if (fc.name !== lastToolName) {
                endActiveTool()
                hooks?.onToolStart?.(fc.name)
                lastToolName = fc.name
              }
            }
          }
        }

        if (!(await chargeLoopIteration())) break
      }

      if (lastToolName && event.content && !hasFunctionCall) {
        hooks?.onToolEnd?.(lastToolName)
        lastToolName = null
      }

      if (hasGroundingData(event.groundingMetadata)) {
        groundingMetadata = event.groundingMetadata
        hooks?.onGroundingMetadata?.(event.groundingMetadata)
      }

      const text = extractText(event)
      if (text) {
        lastText = text
        if (event.content?.parts) {
          for (const part of event.content.parts) {
            if ('text' in part) {
              const token = (part as { text: string }).text
              if (token) emitToken(token)
            }
          }
        }
      }

      const isFinal = isFinalResponse(event) && !!event.content?.parts
      if (isFinal) {
        reply = text
        // Tool-call turns are billed above; this bills the no-tool-call and
        // final-synthesis turns, so every completed model turn costs 1 credit.
        if (!hasFunctionCall) {
          if (!(await chargeLoopIteration())) break
        }
      }
    }

    if (!reply.trim()) {
      if (degraded) {
        reply = lastText.trim() || DEGRADED_FALLBACK_REPLY
      } else {
        throw new Error('ADK returned an empty final reply')
      }
    }

    if (degraded && !streamedAnyText && hooks?.onToken) {
      emitToken(reply)
    }
  } catch (err) {
    if (spentAllocations.length > 0) {
      try {
        await creditService.refundCredit(userId, spentAllocations)
      } catch (refundErr) {
        console.error(`[CRITICAL] refundCredit failed user=${userId}`, refundErr)
      }
    }
    throw err
  }

  return { reply, toolCalls, groundingMetadata, degraded: degraded || undefined }
}

import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { DeliveryMode } from '../handlers/proactiveWakeupHandler.js'

export interface WakeupSink {
  mode: DeliveryMode | null
  message: string | null
}

const MODES: DeliveryMode[] = ['notify', 'quiet', 'silent']

/**
 * How a wake-up ends. The model chooses how much of the user's attention this
 * is worth; the handler may downgrade notify to quiet. In Phase 1 nothing is
 * delivered — the choice is recorded so the notify rate can be observed before
 * any user can be interrupted.
 */
export function createDeliverWakeupTool(sink: WakeupSink): FunctionTool {
  return new FunctionTool({
    name: 'deliver_wakeup',
    description:
      'End your wake-up by saying how it should reach the user. Use notify only when it is genuinely worth interrupting them; quiet to leave a message they will see next time they open the app; silent when you only updated your own notes and there is nothing to say.',
    parameters: z.object({
      mode: z.enum(['notify', 'quiet', 'silent']),
      message: z.string().optional().describe('What to say. Omit for silent.'),
    }),
    execute: async (args: unknown): Promise<string> => {
      const { mode, message } = args as { mode: string; message?: string }
      if (!MODES.includes(mode as DeliveryMode)) {
        return 'mode must be one of: notify, quiet, silent.'
      }
      sink.mode = mode as DeliveryMode
      sink.message = message ?? null
      return 'Recorded.'
    },
  })
}

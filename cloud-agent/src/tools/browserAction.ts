import { FunctionTool } from '@google/adk'
import { z } from 'zod'
import type { FirestoreSession } from '../services/firestoreSession.js'
import type { FcmDispatcher } from '../services/fcmDispatcher.js'
import type { CreditService } from '../services/creditService.js'
import type { TaskIntent, TaskDoc } from '../../../shared/dsl-types.js'
import { intentRequiresAuth } from '../../../shared/constants.js'
import { findBlockedNavigation } from '../../../shared/hostPolicy.js'

export interface BrowserActionDeps {
  firebaseUid: string
  userId: string
  firestoreSession: FirestoreSession
  fcmDispatcher: FcmDispatcher
  creditService: CreditService
  instanceId: string
  // Voice-only: pause/resume the wall-clock billing timer while waiting.
  pauseBilling?: () => void
  resumeBilling?: () => void
  // Voice-only: push the final result into the live Gemini session.
  pushToLive?: (taskId: string, sessionId: string, text: string) => void
  /** Voice-only: correlate an in-flight browser_action tool call with its taskId. */
  registerLiveCall?: (taskId: string) => void
  wakeTimeoutMs?: number  // default 12_000
  textTimeoutMs?: number  // default 30_000
}

const browserActionSchema = z.object({
  actionSummary: z.string().describe(
    'Human-readable description of what you are about to do (e.g. "Checking the article on your browser").',
  ),
  intent: z.object({
    action: z.record(z.string(), z.unknown()).describe('SingleAction or SequenceAction — see Task DSL spec.'),
  }),
})

function formatResult(task: TaskDoc): string {
  if (task.status === 'awaiting_auth') {
    return "I've paused this action. Approve it on your phone and I'll finish — I'll let you know when it's done."
  }
  if (task.status === 'complete' && task.result) {
    const data = task.result.data ?? {}
    const body = Object.keys(data).length ? JSON.stringify(data) : '(no extracted data)'
    return `Browser task complete on ${task.result.activeUrl}: ${body}`
  }
  const code = task.error?.code ?? task.result?.error?.code ?? 'EXECUTION_ERROR'
  if (code === 'EXTENSION_OFFLINE') return 'Your browser extension appears to be offline.'
  if (code === 'AUTH_DENIED') return 'Action was denied.'
  return `Browser task failed (${code}): ${task.error?.message ?? task.result?.error?.message ?? 'unknown error'}`
}

function executionTimeoutTask(): TaskDoc {
  return {
    status: 'failed',
    error: { code: 'EXECUTION_TIMEOUT', message: 'Browser task exceeded 30s' },
  } as unknown as TaskDoc
}

export function browserActionTool(
  deps: BrowserActionDeps,
  context: { trigger: 'voice' | 'text'; preBilled: boolean },
): FunctionTool {
  return new FunctionTool({
    name: 'browser_action',
    description:
      'Perform a web task on the user\'s paired desktop browser (read pages, extract data, navigate). ' +
      'Use only when the user asks you to look at or act on something in their browser.',
    parameters: browserActionSchema,
    execute: async (args: unknown): Promise<string> => {
      const { actionSummary, intent } = args as z.infer<typeof browserActionSchema>
      const fs = deps.firestoreSession
      const wakeTimeoutMs = deps.wakeTimeoutMs ?? 12_000
      const textTimeoutMs = deps.textTimeoutMs ?? 30_000

      const sessionId = crypto.randomUUID()
      const taskId = crypto.randomUUID()
      const action = intent.action as TaskIntent['action']
      deps.registerLiveCall?.(taskId)

      const blocked = findBlockedNavigation(action)
      if (blocked) {
        return `Browser task blocked (HOST_NOT_ALLOWED): ${blocked.message}`
      }

      // 1. Resolve device BEFORE spending credit.
      const device = await fs.getActiveDevice(deps.firebaseUid)
      if (!device) {
        return 'No browser extension is paired. Install the Clanker Desktop Bridge extension, or it may be paused — enable it from the extension.'
      }

      // 2. Contextual billing.
      deps.pauseBilling?.()
      let txId: string | null = null
      let sessionCreated = false
      if (!context.preBilled) {
        try { txId = await deps.creditService.spendCredit(deps.userId) }
        catch { deps.resumeBilling?.(); return 'You are out of credits for browser actions.' }
      }

      try {
        // 3. Build intent + persist.
        const requiresAuth = intentRequiresAuth(actionSummary, action)
        const taskIntent: TaskIntent = { version: '1', taskId, sessionId, requiresAuth, actionSummary, action }
        await fs.createSession(deps.firebaseUid, sessionId, { status: 'pending', trigger: context.trigger, voiceInstanceId: deps.instanceId })
        sessionCreated = true
        await fs.writeTask(deps.firebaseUid, sessionId, taskId, taskIntent)

        // 4. Wake.
        await deps.fcmDispatcher.wakeExtension(device.fcmToken, sessionId, taskId)
      } catch (err) {
        if (txId) {
          try { await deps.creditService.refundCredit(deps.userId, txId) } catch { /* logged */ }
        }
        if (sessionCreated) {
          try { await fs.closeSession(deps.firebaseUid, sessionId, 'aborted') } catch { /* ignore */ }
        }
        deps.resumeBilling?.()
        throw err
      }

      // 5. Durable wake timeout (queries Firestore, never sessionBridge).
      const wakeTimer = setTimeout(() => { void enforceWakeTimeout() }, wakeTimeoutMs)
      let settled = false
      async function enforceWakeTimeout(): Promise<void> {
        if (settled) return
        const aborted = await fs.abortPendingTaskIfOffline(deps.firebaseUid, sessionId, taskId, {
          taskId, status: 'failed', data: {}, activeUrl: '',
          error: { code: 'EXTENSION_OFFLINE', message: 'Browser extension did not connect', failedAction: action as never },
        })
        if (aborted) {
          if (txId) { try { await deps.creditService.refundCredit(deps.userId, txId) } catch { /* logged */ } }
          await fs.closeSession(deps.firebaseUid, sessionId, 'aborted')
        }
      }

      // 6. Result delivery.
      const waitForTerminalTask = () => new Promise<TaskDoc>((resolve) => {
        const timeout = setTimeout(() => {
          void (async () => {
            settled = true
            clearTimeout(wakeTimer)
            unsub()
            await fs.writeTaskResult(deps.firebaseUid, sessionId, taskId, {
              taskId, status: 'failed', data: {}, activeUrl: '',
              error: { code: 'EXECUTION_TIMEOUT', message: 'Browser task exceeded 30s', failedAction: action as never },
            })
            if (txId) { try { await deps.creditService.refundCredit(deps.userId, txId) } catch { /* logged */ } }
            await fs.closeSession(deps.firebaseUid, sessionId, 'aborted')
            resolve(executionTimeoutTask())
          })()
        }, textTimeoutMs)

        const unsub = fs.watchTask(deps.firebaseUid, sessionId, taskId, (task) => {
          if (
            task.status === 'awaiting_auth' ||
            task.status === 'complete' ||
            task.status === 'failed' ||
            task.status === 'aborted'
          ) {
            settled = true
            clearTimeout(timeout)
            clearTimeout(wakeTimer)
            unsub()
            resolve(task)
          }
        })
      })

      if (context.trigger === 'text') {
        return formatResult(await waitForTerminalTask())
      }

      // Voice: resolve final result out-of-band into the live session; return interim now.
      void waitForTerminalTask().then((task) => {
        deps.resumeBilling?.()
        deps.pushToLive?.(taskId, sessionId, formatResult(task))
      })
      return 'Sent the task to your browser. I\'ll read the result aloud when it arrives.'
    },
  })
}

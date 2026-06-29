import type { TaskIntent, SingleAction, TaskResult, BridgeErrorCode } from '../shared/dsl-types.js'

export interface Injector {
  runInActiveTab(action: SingleAction, ctx?: { skipLayerTwo?: boolean }): Promise<{ data: Record<string, string>; activeUrl: string } | { awaitingAuth: true }>
  openTab(url: string): Promise<void>
  focusTab(host: string): Promise<void>
}

export type AwaitingAuthOutcome = { status: 'awaiting_auth'; taskId: string; haltedStepIndex: number; partialData: Record<string, string>; partialActiveUrl: string }
export type DispatchOutcome = TaskResult | AwaitingAuthOutcome

function knownCode(msg: string): BridgeErrorCode {
  for (const c of ['SELECTOR_NOT_FOUND', 'HOST_NOT_ALLOWED', 'HOST_PERMISSION_REQUIRED', 'EXECUTION_TIMEOUT'] as const) {
    if (msg.includes(c)) return c
  }
  return 'EXECUTION_ERROR'
}

export async function dispatchTask(intent: TaskIntent, inj: Injector): Promise<DispatchOutcome> {
  const steps: SingleAction[] = intent.action.type === 'sequence' ? intent.action.steps : [intent.action]
  const skipLayerTwoForFirst = !intent.requiresAuth && steps.length > 0 &&
    (steps[0].type === 'fill_field' || steps[0].type === 'click')

  const data: Record<string, string> = {}
  let activeUrl = ''
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (step.type === 'open_tab') { await inj.openTab(step.url); activeUrl = step.url; continue }
      if (step.type === 'focus_tab') { await inj.focusTab(step.host); continue }
      const ctx = { skipLayerTwo: skipLayerTwoForFirst && i === 0 }
      const out = await inj.runInActiveTab(step, ctx)
      if ('awaitingAuth' in out) {
        return { status: 'awaiting_auth', taskId: intent.taskId, haltedStepIndex: i, partialData: data, partialActiveUrl: activeUrl }
      }
      Object.assign(data, out.data)
      activeUrl = out.activeUrl || activeUrl
    }
    return { taskId: intent.taskId, status: 'complete', data, activeUrl }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'execution failed'
    return {
      taskId: intent.taskId, status: 'failed', data, activeUrl,
      error: { code: knownCode(msg), message: msg, failedAction: steps[0] },
    }
  }
}

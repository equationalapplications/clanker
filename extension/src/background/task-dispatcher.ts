import type { TaskIntent, SingleAction, TaskResult, BridgeErrorCode } from '../shared/dsl-types.js'

export interface Injector {
  runInActiveTab(action: SingleAction): Promise<{ data: Record<string, string>; activeUrl: string }>
  openTab(url: string): Promise<void>
  focusTab(host: string): Promise<void>
}

function knownCode(msg: string): BridgeErrorCode {
  for (const c of ['SELECTOR_NOT_FOUND', 'HOST_NOT_ALLOWED', 'HOST_PERMISSION_REQUIRED', 'EXECUTION_TIMEOUT'] as const) {
    if (msg.includes(c)) return c
  }
  return 'EXECUTION_ERROR'
}

export async function dispatchTask(intent: TaskIntent, inj: Injector): Promise<TaskResult> {
  const steps: SingleAction[] = intent.action.type === 'sequence' ? intent.action.steps : [intent.action]
  const data: Record<string, string> = {}
  let activeUrl = ''
  try {
    for (const step of steps) {
      if (step.type === 'open_tab') { await inj.openTab(step.url); activeUrl = step.url; continue }
      if (step.type === 'focus_tab') { await inj.focusTab(step.host); continue }
      const out = await inj.runInActiveTab(step)
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

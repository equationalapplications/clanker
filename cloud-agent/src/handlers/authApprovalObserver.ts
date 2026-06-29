import type { FirestoreSession } from '../services/firestoreSession.js'
import type { FcmDispatcher } from '../services/fcmDispatcher.js'
import type { BridgeErrorCode, TaskIntent } from '../../../shared/dsl-types.js'

export const AUTH_APPROVAL_TTL_MS = 5 * 60 * 1000

export interface AuthApprovalObserverDeps {
  fs: FirestoreSession
  fcmDispatcher?: FcmDispatcher
  verifyToken: (token: string) => Promise<{ uid: string }>
  getExpoPushToken?: (uid: string) => Promise<string | null>
  firebaseUid: string
  sessionId: string
  taskId: string
  intent: TaskIntent
  deviceFcmToken: string | null
  authApprovalTtlMs?: number
  /** Best-effort callback after approval resolves (e.g. session_end if WS still open). */
  onResolved?: () => void
}

async function notifyMobile(
  deps: AuthApprovalObserverDeps,
  summary: string,
): Promise<void> {
  if (!deps.fcmDispatcher || !deps.getExpoPushToken) return
  const expoPushToken = await deps.getExpoPushToken(deps.firebaseUid)
  if (!expoPushToken) return
  await deps.fcmDispatcher.sendTaskComplete(expoPushToken, deps.sessionId, deps.taskId, summary).catch(
    (err) => console.error('sendTaskComplete failed:', err),
  )
}

/** Self-cleaning auth-doc observer — lifetime is independent of the browser WebSocket. */
export function startAuthApprovalObserver(deps: AuthApprovalObserverDeps): void {
  let settled = false
  let unsub: (() => void) | null = null
  const ttlMs = deps.authApprovalTtlMs ?? AUTH_APPROVAL_TTL_MS

  const cleanup = (): void => {
    clearTimeout(ttlTimer)
    unsub?.()
    unsub = null
  }

  const abortTask = async (code: BridgeErrorCode, message: string): Promise<void> => {
    await deps.fs.writeTaskResult(deps.firebaseUid, deps.sessionId, deps.taskId, {
      taskId: deps.taskId, status: 'aborted', data: {}, activeUrl: '',
      error: { code, message, failedAction: deps.intent.action as never },
    })
    await notifyMobile(deps, message)
    deps.onResolved?.()
  }

  const settle = (fn: () => Promise<void>): void => {
    if (settled) return
    clearTimeout(ttlTimer)
    void (async () => {
      try {
        await fn()
        settled = true
        cleanup()
      } catch (err) {
        console.error('auth approval observer error:', err)
      }
    })()
  }

  const ttlTimer = setTimeout(() => {
    settle(() => abortTask('AUTH_TIMEOUT', 'Approval timed out. The action was not completed.'))
  }, ttlMs)
  ttlTimer.unref?.()

  unsub = deps.fs.watchAuth(deps.firebaseUid, deps.sessionId, deps.taskId, (auth) => {
    if (auth.status === 'pending') return

    if (auth.status === 'approved') {
      settle(async () => {
        try {
          const decoded = await deps.verifyToken(auth.approvalToken ?? '')
          if (decoded.uid !== deps.firebaseUid) throw new Error('UID mismatch')
        } catch {
          await abortTask('AUTH_DENIED', 'Approval token invalid. The action was not completed.')
          return
        }

        if (deps.fcmDispatcher && deps.deviceFcmToken) {
          try {
            await deps.fcmDispatcher.wakeExtension(deps.deviceFcmToken, deps.sessionId, deps.taskId, true)
          } catch (err) {
            console.error('FCM resume wake failed:', err)
            await abortTask('EXECUTION_ERROR', 'Failed to wake the extension after approval. The action was not completed.')
            return
          }
        }
        deps.onResolved?.()
      })
      return
    }

    settle(() => abortTask('AUTH_DENIED', 'Action was denied.'))
  })
}

import { getCurrentUser, onAuthStateChanged } from '~/config/firebaseConfig'

const DEFAULT_AUTH_RESOLUTION_TIMEOUT_MS = 800

export async function resolveCheckoutUid(
  timeoutMs: number = DEFAULT_AUTH_RESOLUTION_TIMEOUT_MS,
): Promise<string | null> {
  const currentUid = getCurrentUser()?.uid ?? null
  if (currentUid) {
    return currentUid
  }

  return await new Promise((resolve) => {
    let settled = false
    let unsubscribe: (() => void) | null = null
    let unsubscribeAfterInit = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const finish = (uid: string | null): void => {
      if (settled) {
        return
      }

      settled = true
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
      } else {
        unsubscribeAfterInit = true
      }

      resolve(uid)
    }

    timeoutId = setTimeout(() => {
      timeoutId = null
      finish(getCurrentUser()?.uid ?? null)
    }, timeoutMs)

    try {
      unsubscribe = onAuthStateChanged((user) => {
        if (!user?.uid) {
          return
        }

        finish(user.uid)
      })

      if (unsubscribeAfterInit && unsubscribe) {
        unsubscribe()
        unsubscribe = null
      }
    } catch {
      finish(getCurrentUser()?.uid ?? null)
    }
  })
}

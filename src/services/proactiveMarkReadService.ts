import { markProactiveReadFn } from '~/config/firebaseConfig'
import type { MarkReadCall } from '~/services/proactiveReadQueue'

// The single real binding of the 'markProactiveRead' callable — the sync hook
// (flush) and the chat-open enqueue (Task 8) both share it. The callable handle
// itself is built in firebaseConfig, which is the platform seam: binding it here
// from '@react-native-firebase/app' crashed the web bundle at import time.
export const markProactiveReadViaCallable: MarkReadCall = async (request) => {
  const result = await markProactiveReadFn(request)
  const wrapped = result as { data?: { updated: number } }
  return wrapped.data ?? (result as unknown as { updated: number })
}

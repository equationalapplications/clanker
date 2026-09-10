import { appCheckReady, markProactiveReadFn } from '~/config/firebaseConfig'
import type { MarkReadCall } from '~/services/proactiveReadQueue'

// The single real binding of the 'markProactiveRead' callable — the sync hook
// (flush) and the chat-open enqueue (Task 8) both share it. The callable handle
// itself is built in firebaseConfig, which is the platform seam: binding it here
// from '@react-native-firebase/app' crashed the web bundle at import time.
export const markProactiveReadViaCallable: MarkReadCall = async (request) => {
  // Every other callable service (chatReply, imageGeneration, wakeup, ...)
  // awaits App Check first; this flush is also kicked from cold start
  // (notification tap → post-sync mark-read) and app/_layout.tsx's startup
  // flush, both of which can race initializeAppCheck. Without the await the
  // callable rejects with "App Check token missing" and burns the queue's
  // 3-attempt retry budget before App Check ever completes — and a dropped
  // receipt makes the server treat the user as ignoring this character.
  await appCheckReady
  const result = await markProactiveReadFn(request)
  const wrapped = result as { data?: { updated: number } }
  return wrapped.data ?? (result as unknown as { updated: number })
}

import { getApp } from '@react-native-firebase/app'
import { getFunctions, httpsCallable } from '@react-native-firebase/functions'
import type { MarkReadCall } from '~/services/proactiveReadQueue'

// Module-scope callable, same deliberate pattern as proactiveSync.ts. This is
// the single real binding of httpsCallable('markProactiveRead') — the sync hook
// (flush) and the chat-open enqueue (Task 8) both share it.
const markProactiveReadFn = httpsCallable<{ messageIds: string[] }, { updated: number }>(
  getFunctions(getApp(), 'us-central1'),
  'markProactiveRead',
)

export const markProactiveReadViaCallable: MarkReadCall = async (request) => {
  const result = await markProactiveReadFn(request)
  const wrapped = result as { data?: { updated: number } }
  return wrapped.data ?? (result as unknown as { updated: number })
}

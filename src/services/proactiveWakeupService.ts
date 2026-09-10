import { appCheckReady, scheduleWakeupFn } from '~/config/firebaseConfig'
import type { ScheduleWakeupRequest, ScheduleWakeupResponse } from './proactiveCallableTypes'

// Re-exported so existing consumers (edgeToolExecutors) keep importing these
// from the service they already depend on.
export type { ScheduleWakeupRequest, ScheduleWakeupResponse }

export async function scheduleWakeupViaCallable(
  request: ScheduleWakeupRequest,
): Promise<ScheduleWakeupResponse> {
  await appCheckReady
  const result = await scheduleWakeupFn(request)
  const wrapped = result as { data?: ScheduleWakeupResponse }
  return wrapped.data ?? (result as unknown as ScheduleWakeupResponse)
}

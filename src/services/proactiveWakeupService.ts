import { getApp } from '@react-native-firebase/app'
import { getFunctions, httpsCallable } from '@react-native-firebase/functions'
import { appCheckReady } from '~/config/firebaseConfig'

export interface ScheduleWakeupRequest {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
}

export interface ScheduleWakeupResponse {
  ok: boolean
  message: string
  dueAt?: string
}

// Module-scope callable, mirroring proactiveSync's pattern: the orchestrator's
// only collaborator surface is this file. The brief restricts edits to keep
// firebaseConfig.ts untouched.
const scheduleWakeupFn = httpsCallable<ScheduleWakeupRequest, ScheduleWakeupResponse>(
  getFunctions(getApp(), 'us-central1'),
  'scheduleWakeup',
)

export async function scheduleWakeupViaCallable(
  request: ScheduleWakeupRequest,
): Promise<ScheduleWakeupResponse> {
  await appCheckReady
  const result = await scheduleWakeupFn(request)
  const wrapped = result as { data?: ScheduleWakeupResponse }
  return wrapped.data ?? (result as unknown as ScheduleWakeupResponse)
}

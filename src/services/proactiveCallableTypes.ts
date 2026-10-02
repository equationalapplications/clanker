/**
 * Wire types for the three proactive-scheduler callables.
 *
 * They live in their own module so both `firebaseConfig` twins can type the
 * callable handles without importing the service modules that consume those
 * handles — that would be an import cycle. This module is type-only and emits
 * no runtime code.
 */
import type { ProactiveMessagePayload } from '~/database/messageDatabase'
import type { SyncCursor } from '~/database/syncState'

export interface FetchProactiveMessagesRequest {
  sinceCreatedAt?: string
  sinceMessageId?: string
}

export interface FetchProactiveMessagesResponse {
  messages: ProactiveMessagePayload[]
  nextCursor: SyncCursor | null
}

export interface MarkProactiveReadRequest {
  messageIds: string[]
}

export interface MarkProactiveReadResponse {
  updated: number
}

export interface ScheduleWakeupRequest {
  characterId: string
  reason: string
  remindAt: string
  priority?: number
  /**
   * Client-minted stable operation identifier — required so retries from the
   * same logical set_reminder collapse onto one server row. The edge executor
   * mints one UUID per intent and reuses it on every retry.
   */
  opId: string
}

export interface ScheduleWakeupResponse {
  ok: boolean
  message: string
  dueAt?: string
}

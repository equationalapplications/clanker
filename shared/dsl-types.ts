// Canonical wire types for the browser bridge. Mirrored by extension/shared/dsl-types.ts.

export type SingleAction =
  | { type: 'open_tab'; url: string }
  | { type: 'focus_tab'; host: string }
  | { type: 'extract'; selector: string; label?: string }
  | { type: 'summarize_visible_text'; filter?: 'no_nav' | 'no_ads' | 'all' }
  | { type: 'read_dom'; selector: string }
  | { type: 'scroll'; direction: 'up' | 'down'; pixels?: number }
  // Phase 2 (wire-stable, never executed in Phase 1):
  | { type: 'fill_field'; selector: string; value: string; tier: 'stateful' }
  | { type: 'click'; selector: string; label?: string; tier: 'stateful' }

export interface SequenceAction {
  type: 'sequence'
  steps: SingleAction[] // no nested sequences
}

export interface TaskIntent {
  version: '1'
  taskId: string
  sessionId: string
  requiresAuth: boolean
  actionSummary: string
  action: SingleAction | SequenceAction
}

export type BridgeErrorCode =
  | 'SELECTOR_NOT_FOUND'
  | 'HOST_NOT_ALLOWED'
  | 'HOST_PERMISSION_REQUIRED'
  | 'EXTENSION_OFFLINE'
  | 'AUTH_TIMEOUT'
  | 'EXECUTION_ERROR'
  | 'EXECUTION_TIMEOUT'

export interface TaskResult {
  taskId: string
  status: 'complete' | 'failed' | 'aborted'
  data: Record<string, string> // keyed by `label` from extract steps
  activeUrl: string
  error?: {
    code: BridgeErrorCode
    message: string
    failedAction: SingleAction
  }
}

export type SessionStatus = 'pending' | 'routing' | 'pending_auth' | 'closed' | 'aborted'
export type TaskStatus = 'pending' | 'executing' | 'awaiting_auth' | 'complete' | 'failed' | 'aborted'

export interface SessionDoc {
  status: SessionStatus
  trigger: 'voice' | 'text' | 'scheduler'
  voiceInstanceId: string
  browserInstanceId?: string | null
  browserConnectedAt?: unknown | null // Firestore Timestamp
  createdAt: unknown
  expiresAt: unknown
}

export interface TaskDoc {
  status: TaskStatus
  intent: TaskIntent
  result: TaskResult | null
  error: TaskResult['error'] | null
  authRequired: boolean
  haltedStepIndex: number | null
  createdAt: unknown
  updatedAt: unknown
}

export interface DeviceDoc {
  deviceId: string
  fcmToken: string
  deviceName: string
  registeredAt?: unknown
  lastSeenAt?: unknown
  active: boolean
  isPaused: boolean
}

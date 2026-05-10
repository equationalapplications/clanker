import { createMachine, assign, fromPromise, fromCallback } from 'xstate'
import {
  WikiBusyError,
  type EntityStatus,
  type MemoryDump,
} from '@equationalapplications/expo-llm-wiki'
import type { Wiki } from '~/services/wikiService'
import { reportError } from '~/utilities/reportError'

/**
 * Argument shape accepted by `Wiki.ingestDocument`. The package does not
 * export this as a named type, so we derive it from the method signature.
 */
export type IngestArgs = Parameters<Wiki['ingestDocument']>[1]

/**
 * Argument shape accepted by `Wiki.forget`. Derived from the method
 * signature for the same reason as `IngestArgs`.
 */
export type ForgetArgs = Parameters<Wiki['forget']>[1]

export interface WikiMachineContext {
  entityId: string
  wiki: Wiki
  status: EntityStatus
  lastError: Error | null
  lastReadAt: number | null
}

export type WikiMachineEvents =
  | { type: 'READ'; query: string }
  | { type: 'WRITE'; summary: string }
  | { type: 'INGEST'; doc: IngestArgs }
  | {
      type: 'SYNC'
      cloudId: string
      runRemoteSync: (dump: MemoryDump) => Promise<MemoryDump | null>
    }
  | { type: 'FORGET'; args: ForgetArgs }
  | { type: 'STATUS'; status: EntityStatus }
  | { type: 'RETRY' }

export interface WikiMachineInput {
  entityId: string
  wiki: Wiki
}

// Re-export to silence unused-import warnings until P2a-2/P2a-3 use them.
export type { Wiki }
void createMachine
void assign
void fromPromise
void fromCallback
void WikiBusyError
void reportError
